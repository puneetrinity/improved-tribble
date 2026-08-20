#!/usr/bin/env node

// Compare a protected normalized Flow catalog with the committed stable
// semantic catalog lock. No database/network access and no catalog payloads
// are printed. PostgreSQL-generated/internal and environment-owned metadata is
// deliberately projected out; exact constraints retain the same semantics.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`[schema catalog comparator] FAILED: ${message}`);
  process.exit(1);
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

function assertProtected(path) {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    fail(`actual normalized artifact must be protected (observed mode ${mode.toString(8)}).`);
  }
}

function projectRecord(record) {
  // Database/default ACLs are environment role provisioning, not portable
  // application schema. Effective runtime privileges are checked at readiness.
  if (record.record_type === "database_acl" || record.record_type === "default_acl") return null;
  if (record.record_type === "trigger" && record.payload?.internal === true) return null;
  const payload = { ...(record.payload ?? {}) };
  for (const key of ["owner", "acl", "extension_owner"]) delete payload[key];
  if (record.record_type === "column") {
    delete payload.acl;
    // PostgreSQL 16 represents the inherited/default statistics target as -1;
    // production PostgreSQL 17 represents the same state as null.
    if (payload.statistics_target === -1) payload.statistics_target = null;
  }
  if (record.record_type === "routine") delete payload.acl;
  return stable({ record_type: record.record_type, key: record.key, payload });
}

function loadJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(`${label} is missing or invalid JSON.`);
  }
}

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--actual" || args[2] !== "--lock") {
  fail("usage: --actual <protected-normalized.json> --lock <catalog.lock.json>");
}
const actualPath = resolve(args[1]);
const lockPath = resolve(args[3]);
assertProtected(actualPath);
const actualBytes = readFileSync(actualPath);
const actual = loadJson(actualPath, "actual normalized catalog");
const lock = loadJson(lockPath, "catalog lock");
if (
  actual.format_version !== 1 ||
  !Array.isArray(actual.records) ||
  lock.format_version !== 1 ||
  lock.projection_version !== 1 ||
  !Array.isArray(lock.records)
) {
  fail("catalog input has an unsupported format.");
}

const projected = actual.records
  .map(projectRecord)
  .filter(Boolean)
  .sort((a, b) => a.record_type.localeCompare(b.record_type) || a.key.localeCompare(b.key));
const expected = lock.records.map(stable);
const identity = (record) => `${record.record_type}\u0000${record.key}`;
const actualMap = new Map(projected.map((record) => [identity(record), record]));
const expectedMap = new Map(expected.map((record) => [identity(record), record]));
if (actualMap.size !== projected.length || expectedMap.size !== expected.length) {
  fail("catalog contains a duplicate semantic identity.");
}

const actualBytesProjected = `${JSON.stringify(projected)}\n`;
const expectedBytesProjected = `${JSON.stringify(expected)}\n`;
if (actualBytesProjected !== expectedBytesProjected) {
  const missing = [...expectedMap.keys()].filter((key) => !actualMap.has(key));
  const extra = [...actualMap.keys()].filter((key) => !expectedMap.has(key));
  const changed = [...expectedMap.keys()].filter(
    (key) => actualMap.has(key) && JSON.stringify(expectedMap.get(key)) !== JSON.stringify(actualMap.get(key)),
  );
  const safeKeys = (values) => values.slice(0, 20).map((value) => value.replace("\u0000", "/"));
  fail(
    `semantic catalog drift (missing=${missing.length}, extra=${extra.length}, changed=${changed.length}; ` +
      `sample_missing=${JSON.stringify(safeKeys(missing))}, sample_extra=${JSON.stringify(safeKeys(extra))}, ` +
      `sample_changed=${JSON.stringify(safeKeys(changed))}).`,
  );
}

console.log(JSON.stringify({
  status: "ok",
  source_sha: actual.expected_source_sha,
  normalized_sha256: createHash("sha256").update(actualBytes).digest("hex"),
  semantic_record_count: projected.length,
  semantic_records_sha256: createHash("sha256").update(actualBytesProjected).digest("hex"),
}));
