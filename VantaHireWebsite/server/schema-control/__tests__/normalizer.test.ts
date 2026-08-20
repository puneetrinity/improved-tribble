import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The production CLI is dependency-free JavaScript; tests exercise its exported
// pure implementation in-process so a blocked child-process API cannot false-green.
// @ts-expect-error The checked-in CLI intentionally has no generated declaration file.
import { normalizeCatalog } from "../../../scripts/normalize-schema-catalog.mjs";

const sourceSha = "a".repeat(40);
const requiredRelations = [
  "users",
  "organizations",
  "organization_members",
  "jobs",
  "applications",
  "pipeline_stages",
  "candidate_resumes",
];

function record(record_type: string, key: string, payload: Record<string, unknown>) {
  return { record_type, key, payload };
}

function base(extra: Array<Record<string, unknown>> = []) {
  return [
    record("preflight_meta", "start", {
      format_version: 1,
      expected_source_sha: sourceSha,
      server_version_num: "170011",
      transaction_read_only: "on",
    }),
    ...requiredRelations.map((name) =>
      record("relation", `public.${name}`, { schema: "public", name }),
    ),
    ...extra,
    record("preflight_end", "complete", { complete: true, transaction_read_only: "on" }),
  ];
}

function run(records: Array<Record<string, unknown>>) {
  const dir = mkdtempSync(join(tmpdir(), "flow-normalizer-"));
  const raw = join(dir, "raw.ndjson");
  const output = join(dir, "normalized.json");
  writeFileSync(raw, `${records.map((item) => JSON.stringify(item)).join("\n")}\n`, { mode: 0o600 });
  chmodSync(raw, 0o600);
  try {
    normalizeCatalog(raw, output, sourceSha);
    return { status: 0, bytes: readFileSync(output, "utf8"), errorMessage: "" };
  } catch (error) {
    return {
      status: 1,
      bytes: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("schema catalog structural leak guard", () => {
  it("allows environment role names containing schema_control", () => {
    const result = run(
      base([
        record("default_acl", "flow_schema_control_test_runner/public/r", {
          role: "flow_schema_control_test_runner",
          schema: "public",
          object_type: "r",
          acl: ["flow_schema_control_test_runtime=r/flow_schema_control_test_runner"],
        }),
      ]),
    );
    expect(result.status).toBe(0);
    expect(result.bytes).toContain("flow_schema_control_test_runner");
  });

  it("rejects an actual schema_control object", () => {
    const result = run(base([record("relation", "schema_control.identity", {
      schema: "schema_control",
      name: "identity",
    })]));
    expect(result.status).toBe(1);
    expect(result.errorMessage).toContain("schema_control leaked");
  });

  it("fails closed on an unknown record type", () => {
    const result = run(base([record("mystery", "public.unknown", { schema: "public" })]));
    expect(result.status).toBe(1);
    expect(result.errorMessage).toContain("unknown catalog record type");
  });
});
