// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(APP_ROOT, "server/scripts/backfill-org-ids.ts");
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");
const CODE = "ORG_ATTRIBUTION_REPAIR_RETIRED";

function run(extraEnv: Record<string, string> = {}, args: string[] = []) {
  return spawnSync(process.execPath, ["--import", TSX_LOADER, SCRIPT, ...args], {
    cwd: APP_ROOT,
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, ...extraEnv },
  });
}

describe("unsafe organization-attribution CLI retirement", () => {
  it.each([
    ["default", {}, []],
    ["dry run true", { DRY_RUN: "true" }, []],
    ["dry run false", { DRY_RUN: "false" }, []],
    ["database target", { DATABASE_URL: "postgresql://forbidden.invalid/production" }, []],
    ["former arguments", {}, ["--organization-id=10", "--user-id=20", "--execute"]],
  ] as const)("fails closed for %s invocation", (_label, env, args) => {
    const result = run(env, [...args]);
    if (result.error) throw result.error;
    expect(result.status).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${CODE}\n`);
    expect(result.stderr).not.toMatch(/traceback|error:|node_modules|database|postgres/i);
  });

  it("has no database, environment, merge, inference or target-id surface", () => {
    const source = readFileSync(SCRIPT, "utf8");
    expect(source).toBe(
      'const CODE = "ORG_ATTRIBUTION_REPAIR_RETIRED";\n\n'
      + 'process.stderr.write(`${CODE}\\n`);\n'
      + 'process.exitCode = 1;\n',
    );
    for (const forbidden of [
      "DATABASE_URL", "DRY_RUN", "process.env", "organizationId", "userId", "db", "sql", "merge",
      "backfillUserRecordsToOrg", "organization_members", "SET organization_id",
    ]) expect(source).not.toContain(forbidden);
  });
});
