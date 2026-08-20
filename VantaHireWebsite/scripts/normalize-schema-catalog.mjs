#!/usr/bin/env node

// Gate 1A0-P / Flow-only preflight verifier + deterministic normalizer.
// No dependencies, network or database access. It never prints catalog rows.

import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  throw new Error(message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function assertProtectedFile(path, label) {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    fail(`${label} must not be group/world accessible (required mode 0600; observed ${mode.toString(8)}).`);
  }
}

const STRUCTURAL_SCHEMA_FIELDS = Object.freeze({
  schema: ["name"],
  extension: ["schema"],
  type: ["schema"],
  domain_constraint: ["schema"],
  relation: ["schema"],
  column: ["schema"],
  constraint: ["schema"],
  index: ["schema", "index_schema"],
  sequence: ["schema"],
  view: ["schema"],
  inheritance: ["child_schema", "parent_schema"],
  routine: ["schema"],
  trigger: ["schema"],
  policy: ["schema"],
  statistics: ["schema"],
  default_acl: ["schema"],
  database_acl: [],
});

/**
 * Reject actual schema_control catalog objects without searching arbitrary
 * owner/ACL/comment/definition strings. The census has a closed record-type
 * vocabulary; an unknown or malformed shape fails closed.
 */
function assertNoControlPlaneRecord(record) {
  const fields = STRUCTURAL_SCHEMA_FIELDS[record.record_type];
  if (!fields) fail(`unknown catalog record type: ${record.record_type}`);
  for (const field of fields) {
    const value = record.payload[field];
    if (record.record_type === "default_acl" && field === "schema" && value === null) continue;
    if (typeof value !== "string") {
      fail(`catalog record ${record.record_type} has an invalid structural ${field} field.`);
    }
    if (value === "schema_control") {
      fail("schema_control leaked into the application-catalog artifact.");
    }
  }
}

function lintSql(path) {
  const source = readFileSync(path, "utf8");
  const withoutLineComments = source.replace(/--[^\n]*/g, "");

  const required = [
    /\\set\s+ON_ERROR_STOP\s+on/i,
    /BEGIN\s+TRANSACTION\s+ISOLATION\s+LEVEL\s+REPEATABLE\s+READ\s+READ\s+ONLY/i,
    /SET\s+LOCAL\s+statement_timeout/i,
    /SET\s+LOCAL\s+lock_timeout/i,
    /SET\s+LOCAL\s+idle_in_transaction_session_timeout/i,
    /current_setting\('transaction_read_only'\)/i,
    /expected_source_sha/i,
    /'preflight_meta'/i,
    /'preflight_end'/i,
    /ROLLBACK\s*;/i,
  ];
  for (const pattern of required) {
    if (!pattern.test(withoutLineComments)) fail(`SQL contract is missing ${pattern}.`);
  }

  if (/\b(?:INSERT\s+INTO|UPDATE\s+[^;]+\s+SET|DELETE\s+FROM|MERGE\s+INTO|CREATE\s+(?:TABLE|SCHEMA|INDEX|TYPE|FUNCTION|TRIGGER)|ALTER\s+(?:TABLE|SCHEMA|TYPE|FUNCTION)|DROP\s+(?:TABLE|SCHEMA|INDEX|TYPE|FUNCTION|TRIGGER)|TRUNCATE|GRANT\s+|REVOKE\s+|COPY\s+)\b/i.test(withoutLineComments)) {
    fail("SQL contains a mutation/DDL/copy token.");
  }
  if (/\\(?:copy|gexec|include|ir)\b/i.test(withoutLineComments)) {
    fail("SQL contains a prohibited psql execution/include command.");
  }
  if (/\\(?:q|quit)\b/i.test(withoutLineComments)) {
    fail("SQL must not depend on psql quit arguments for refusal exit status.");
  }

  const refusalGuardCount = (
    withoutLineComments.match(/SELECT\s+1\s*\/\s*0\s+AS\s+forced_nonzero_exit\s*;/gi) ?? []
  ).length;
  if (refusalGuardCount !== 3) {
    fail(`SQL must contain exactly three side-effect-free nonzero refusal guards (observed ${refusalGuardCount}).`);
  }

  // pg_sequence counters/bounds are bigint. JSON.parse would otherwise round
  // values above Number.MAX_SAFE_INTEGER before hashing or baseline rendering.
  for (const [jsonKey, catalogColumn] of [
    ["start", "seqstart"],
    ["increment", "seqincrement"],
    ["minimum", "seqmin"],
    ["maximum", "seqmax"],
    ["cache", "seqcache"],
  ]) {
    const lossless = new RegExp(`'${jsonKey}'\\s*,\\s*s\\.${catalogColumn}::text`, "i");
    if (!lossless.test(withoutLineComments)) {
      fail(`sequence bigint field ${catalogColumn} must be emitted as lossless text.`);
    }
  }

  // Every FROM/JOIN authority must be catalog-only or an in-query unnest/
  // lateral source. This prevents an unqualified application table from being
  // introduced later while leaving the script superficially READ ONLY.
  for (const match of withoutLineComments.matchAll(/\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_.]*)/gi)) {
    const authority = match[1].toLowerCase();
    if (
      !authority.startsWith("pg_catalog.") &&
      authority !== "unnest" &&
      authority !== "lateral"
    ) {
      fail(`non-catalog FROM/JOIN authority detected: ${authority}`);
    }
  }

  const selectCount = (withoutLineComments.match(/\bSELECT\b/gi) ?? []).length;
  if (selectCount < 15) fail(`catalog census unexpectedly small (${selectCount} SELECT statements).`);

  console.log(
    JSON.stringify({
      status: "ok",
      mode: "lint-sql",
      select_count: selectCount,
      catalog_select_count: selectCount - refusalGuardCount,
      refusal_guard_count: refusalGuardCount,
      sha256: createHash("sha256").update(source).digest("hex"),
    }),
  );
}

export function normalizeCatalog(rawPath, outputPath, expectedSourceSha) {
  if (!/^[0-9a-f]{40}$/.test(expectedSourceSha)) {
    fail("--expected-source-sha must be 40 lowercase hex characters.");
  }
  assertProtectedFile(rawPath, "raw catalog artifact");
  const raw = readFileSync(rawPath, "utf8");

  // Catalog definitions can theoretically contain a hard-coded credential.
  // Fail without echoing the matched value; the protected raw file then needs
  // a separately handled secret review/rotation decision.
  const sensitivePatterns = [
    /postgres(?:ql)?:\/\//i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;"}]+/i,
  ];
  if (sensitivePatterns.some((pattern) => pattern.test(raw))) {
    fail("protected raw catalog contains a credential-like literal; no normalized artifact was written.");
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 3) fail("raw artifact is empty/incomplete.");

  const records = lines.map((line, index) => {
    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("not an object");
      if (typeof record.record_type !== "string" || typeof record.key !== "string") {
        throw new Error("missing record_type/key");
      }
      if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
        throw new Error("missing object payload");
      }
      return record;
    } catch {
      fail(`raw artifact line ${index + 1} is not a valid preflight JSON record.`);
    }
  });

  const meta = records[0];
  const end = records.at(-1);
  if (meta.record_type !== "preflight_meta" || end.record_type !== "preflight_end") {
    fail("preflight start/end sentinel is missing or out of order.");
  }
  if (
    meta.payload.format_version !== 1 ||
    meta.payload.expected_source_sha !== expectedSourceSha ||
    meta.payload.transaction_read_only !== "on" ||
    end.payload.complete !== true ||
    end.payload.transaction_read_only !== "on"
  ) {
    fail("preflight metadata/source/read-only/completion assertion failed.");
  }

  const catalog = records.slice(1, -1);
  const unique = new Set();
  for (const record of catalog) {
    if (record.record_type === "preflight_meta" || record.record_type === "preflight_end") {
      fail("preflight sentinel occurs inside catalog records.");
    }
    assertNoControlPlaneRecord(record);
    const identity = `${record.record_type}\u0000${record.key}`;
    if (unique.has(identity)) fail(`duplicate catalog identity: ${record.record_type}/${record.key}`);
    unique.add(identity);
  }

  const requiredRelations = [
    "public.users",
    "public.organizations",
    "public.organization_members",
    "public.jobs",
    "public.applications",
    "public.pipeline_stages",
    "public.candidate_resumes",
  ];
  const relationKeys = new Set(
    catalog.filter((record) => record.record_type === "relation").map((record) => record.key),
  );
  for (const key of requiredRelations) {
    if (!relationKeys.has(key)) fail(`required Flow relation is absent from normalized catalog: ${key}`);
  }

  const sortedCatalog = catalog
    .map(stable)
    .sort((a, b) =>
      a.record_type.localeCompare(b.record_type) || a.key.localeCompare(b.key),
    );
  const normalized = stable({
    format_version: 1,
    expected_source_sha: expectedSourceSha,
    server_version_num: String(meta.payload.server_version_num),
    records: sortedCatalog,
  });
  const bytes = `${JSON.stringify(normalized)}\n`;
  const output = resolve(outputPath);
  writeFileSync(output, bytes, { encoding: "utf8", mode: 0o600, flag: "wx" });
  assertProtectedFile(output, "normalized catalog artifact");

  const sectionCounts = {};
  for (const record of sortedCatalog) {
    sectionCounts[record.record_type] = (sectionCounts[record.record_type] ?? 0) + 1;
  }
  console.log(
    JSON.stringify({
      status: "ok",
      mode: "normalize",
      expected_source_sha: expectedSourceSha,
      record_count: sortedCatalog.length,
      section_counts: sectionCounts,
      normalized_sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--lint-sql" && args.length === 2) {
      lintSql(resolve(args[1]));
    } else if (
      args[0] === "--normalize" &&
      args[3] === "--expected-source-sha" &&
      args.length === 5
    ) {
      normalizeCatalog(resolve(args[1]), resolve(args[2]), args[4]);
    } else {
      fail(
        "usage: --lint-sql <sql> OR --normalize <raw.ndjson> <normalized.json> --expected-source-sha <sha>",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown verifier failure";
    console.error(`[1A0-P verifier] FAILED: ${message}`);
    process.exitCode = 1;
  }
}
