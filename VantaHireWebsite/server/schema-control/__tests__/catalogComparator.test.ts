import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const comparator = join(appRoot, "scripts", "compare-schema-catalog.mjs");
const lockPath = join(appRoot, "server", "schema-migrations", "catalog.lock.json");

function run(actual: string) {
  return spawnSync(process.execPath, [comparator, "--actual", actual, "--lock", lockPath], {
    encoding: "utf8",
  });
}

describe("catalog comparator", () => {
  it("accepts exact semantics and rejects changed definitions plus unexpected objects", () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-catalog-comparator-"));
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8"));
      const base = {
        format_version: 1,
        expected_source_sha: lock.source_sha,
        server_version_num: "170011",
        records: lock.records,
      };
      const exact = join(dir, "exact.json");
      writeFileSync(exact, `${JSON.stringify(base)}\n`, { mode: 0o600 });
      chmodSync(exact, 0o600);
      const good = run(exact);
      expect(good.status).toBe(0);

      const environmentAcl = structuredClone(base);
      environmentAcl.records.push({
        record_type: "default_acl",
        key: "flow_schema_control_test_runner/public/tables",
        payload: { role: "flow_schema_control_test_runner", schema: "public", object_type: "r", acl: [] },
      });
      const acl = join(dir, "environment-acl.json");
      writeFileSync(acl, `${JSON.stringify(environmentAcl)}\n`, { mode: 0o600 });
      chmodSync(acl, 0o600);
      expect(run(acl).status).toBe(0);

      const changedRecord = structuredClone(base);
      const changedIndex = changedRecord.records.findIndex((record: any) =>
        record.record_type === "column",
      );
      expect(changedIndex).toBeGreaterThanOrEqual(0);
      changedRecord.records[changedIndex].payload.nullable =
        !changedRecord.records[changedIndex].payload.nullable;
      const changed = join(dir, "changed.json");
      writeFileSync(changed, `${JSON.stringify(changedRecord)}\n`, { mode: 0o600 });
      chmodSync(changed, 0o600);
      const changedResult = run(changed);
      expect(changedResult.status).toBe(1);

      const extraRecord = structuredClone(base);
      extraRecord.records.push({
        record_type: "relation",
        key: "public.unexpected_schema_object",
        payload: { kind: "table" },
      });
      const extra = join(dir, "extra.json");
      writeFileSync(extra, `${JSON.stringify(extraRecord)}\n`, { mode: 0o600 });
      chmodSync(extra, 0o600);
      const extraResult = run(extra);
      expect(extraResult.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects group/world-readable evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "flow-catalog-permissions-"));
    try {
      const actual = join(dir, "actual.json");
      writeFileSync(actual, "{}\n", { mode: 0o644 });
      chmodSync(actual, 0o644);
      const result = run(actual);
      expect(result.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
