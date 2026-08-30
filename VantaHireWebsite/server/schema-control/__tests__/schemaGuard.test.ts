import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error The checked-in CLI intentionally has no generated declaration file.
import { checkSchemaControl } from "../../../scripts/check-schema-control.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const repoRoot = dirname(appRoot);
const retiredBootstrapModule = "bootstrap" + "Schema";

const fixtureFiles = [
  ".github/workflows/ci.yml",
  "Procfile",
  "railway.json",
  "package.json",
  "start.sh",
  "VantaHireWebsite/Procfile",
  "VantaHireWebsite/nixpacks.toml",
  "VantaHireWebsite/railway.json",
  "VantaHireWebsite/railway.schema-release.json",
  "VantaHireWebsite/package.json",
  "VantaHireWebsite/provisioning-portal/package.json",
  "VantaHireWebsite/server/index.ts",
  "VantaHireWebsite/server/worker.ts",
  "VantaHireWebsite/server/aiWorker.ts",
  "VantaHireWebsite/server/schema-control/caller-manifest.json",
  "VantaHireWebsite/server/schema-migrations/0000_baseline.sql",
  "VantaHireWebsite/server/schema-migrations/0001_candidate_privacy_flow.sql",
  "VantaHireWebsite/server/schema-migrations/0002_resume_access_attempts.sql",
  "VantaHireWebsite/server/schema-migrations/0003_application_workflow_assessments.sql",
  "VantaHireWebsite/server/schema-migrations/catalog.lock.json",
  "VantaHireWebsite/server/schema-migrations/checksums.lock",
  "VantaHireWebsite/scripts/check-schema-control.mjs",
];

function copyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "flow-schema-guard-"));
  for (const relative of fixtureFiles) {
    const destination = join(root, relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repoRoot, relative), destination);
  }
  return root;
}

function mutateJson(root: string, relative: string, update: (value: any) => void): void {
  const path = join(root, relative);
  const value = JSON.parse(readFileSync(path, "utf8"));
  update(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function write(root: string, relative: string, source: string): void {
  const path = join(root, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

function guard(root: string) {
  return checkSchemaControl(root) as string[];
}

const mutations: Array<{
  name: string;
  expected: RegExp;
  apply: (root: string) => void;
}> = [
  ...(["start:web", "start:worker", "start:ai-worker"] as const).flatMap((name) => {
    const runtime = name === "start:web" ? "index.js" : name === "start:worker" ? "worker.js" : "aiWorker.js";
    return [
      {
        name: `${name} omits readiness`,
        expected: /does not run schema-ready immediately/,
        apply(root: string) {
          mutateJson(root, "VantaHireWebsite/package.json", (pkg) => {
            pkg.scripts[name] = `cross-env NODE_ENV=production node dist/${runtime}`;
          });
        },
      },
      {
        name: `${name} restores startup migration`,
        expected: /still invokes a schema writer/,
        apply(root: string) {
          mutateJson(root, "VantaHireWebsite/package.json", (pkg) => {
            pkg.scripts[name] =
              `cross-env NODE_ENV=production node dist/schema-ready.js && ` +
              `node dist/migrate.js && cross-env NODE_ENV=production node dist/${runtime}`;
          });
        },
      },
    ];
  }),
  {
    name: "app db:push alias",
    expected: /legacy Flow schema authority "db:push"/,
    apply(root) { mutateJson(root, "VantaHireWebsite/package.json", (pkg) => { pkg.scripts["db:push"] = "tsx server/scripts/runMigrations.ts"; }); },
  },
  {
    name: "resume-access migration edited after checksum",
    expected: /applied migration 0002 .* was edited/,
    apply(root) {
      const relative = "VantaHireWebsite/server/schema-migrations/0002_resume_access_attempts.sql";
      write(root, relative, `${readFileSync(join(root, relative), "utf8")}\n-- forbidden drift\n`);
    },
  },
  {
    name: "resume-access migration omitted from checksum lock",
    expected: /checksums\.lock versions do not exactly match migration files/,
    apply(root) {
      mutateJson(root, "VantaHireWebsite/server/schema-migrations/checksums.lock", (lock) => {
        delete lock.migrations["0002"];
      });
    },
  },
  {
    name: "application-workflow migration edited after checksum",
    expected: /applied migration 0003 .* was edited/,
    apply(root) {
      const relative = "VantaHireWebsite/server/schema-migrations/0003_application_workflow_assessments.sql";
      write(root, relative, `${readFileSync(join(root, relative), "utf8")}\n-- forbidden drift\n`);
    },
  },
  {
    name: "application-workflow migration omitted from checksum lock",
    expected: /checksums\.lock versions do not exactly match migration files/,
    apply(root) {
      mutateJson(root, "VantaHireWebsite/server/schema-migrations/checksums.lock", (lock) => {
        delete lock.migrations["0003"];
      });
    },
  },
  {
    name: "app db:migrate alias",
    expected: /legacy Flow schema authority "db:migrate"/,
    apply(root) { mutateJson(root, "VantaHireWebsite/package.json", (pkg) => { pkg.scripts["db:migrate"] = "node dist/migrate.js"; }); },
  },
  {
    name: "legacy migrate bundle",
    expected: /build:server still emits/,
    apply(root) { mutateJson(root, "VantaHireWebsite/package.json", (pkg) => { pkg.scripts["build:server"] += " && esbuild server/migrate.ts"; }); },
  },
  {
    name: "index bootstrap import",
    expected: /index\.ts imports bootstrapSchema/,
    apply(root) { write(root, "VantaHireWebsite/server/index.ts", `import { ensureAtsSchema } from "./${retiredBootstrapModule}";\n`); },
  },
  {
    name: "migrate bootstrap import",
    expected: /migrate\.ts imports bootstrapSchema/,
    apply(root) { write(root, "VantaHireWebsite/server/migrate.ts", `import { ensureAtsSchema } from "./${retiredBootstrapModule}";\n`); },
  },
  {
    name: "routes bootstrap import",
    expected: /routes\.ts imports bootstrapSchema/,
    apply(root) { write(root, "VantaHireWebsite/server/routes.ts", `import { ensureAtsSchema } from "./${retiredBootstrapModule}";\n`); },
  },
  {
    name: "script bootstrap import",
    expected: /runMigrations\.ts imports bootstrapSchema/,
    apply(root) { write(root, "VantaHireWebsite/server/scripts/runMigrations.ts", `import { ensureAtsSchema } from "../${retiredBootstrapModule}";\n`); },
  },
  {
    name: "legacy migrate executable",
    expected: /retired schema authority still exists: VantaHireWebsite\/server\/migrate\.ts/,
    apply(root) { write(root, "VantaHireWebsite/server/migrate.ts", "export {};\n"); },
  },
  {
    name: "legacy runMigrations executable",
    expected: /retired schema authority still exists: VantaHireWebsite\/server\/scripts\/runMigrations\.ts/,
    apply(root) { write(root, "VantaHireWebsite/server/scripts/runMigrations.ts", "export {};\n"); },
  },
  {
    name: "inactive nested workflow",
    expected: /retired schema authority still exists: VantaHireWebsite\/\.github\/workflows\/ci\.yml/,
    apply(root) { write(root, "VantaHireWebsite/.github/workflows/ci.yml", "jobs: {}\n"); },
  },
  {
    name: "root package legacy command",
    expected: /package\.json still invokes a retired Flow schema authority/,
    apply(root) { mutateJson(root, "package.json", (pkg) => { pkg.scripts.legacy = "cd VantaHireWebsite && npm run db:push"; }); },
  },
  {
    name: "start.sh migration flag",
    expected: /start\.sh still invokes a retired Flow schema authority/,
    apply(root) { write(root, "start.sh", "if [ \"${MIGRATE_ON_START:-}\" = true ]; then npm --prefix VantaHireWebsite run db:push; fi\n"); },
  },
  {
    name: "app package transitive legacy command",
    expected: /VantaHireWebsite\/package\.json still invokes a retired Flow schema authority/,
    apply(root) { mutateJson(root, "VantaHireWebsite/package.json", (pkg) => { pkg.scripts.legacy = "npm run db:push"; }); },
  },
];

describe("schema-control caller guard mutation coverage", () => {
  it("accepts the cutover fixture", () => {
    const root = copyFixture();
    try {
      expect(guard(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(mutations)("fails when $name is restored", ({ apply, expected }) => {
    const root = copyFixture();
    try {
      apply(root);
      const problems = guard(root);
      expect(problems).not.toEqual([]);
      expect(problems.join("\n")).toMatch(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("schema-control CI isolation", () => {
  it("runs the PostgreSQL matrix on runner loopback instead of a service-container bridge", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

    expect(workflow).not.toMatch(/^\s+services:\s*$/m);
    expect(workflow).toContain("sudo systemctl start postgresql");
    expect(workflow).toContain("SHOW server_version_num");
    expect(workflow).toContain("pg_isready -h 127.0.0.1");
    expect(workflow).toMatch(
      /FLOW_SCHEMA_TEST_DATABASE_URL:\s+postgresql:\/\/[^\s]+@127\.0\.0\.1:5432\/flow_schema_control_test_ci/,
    );
    expect(workflow).toMatch(
      /FLOW_SCHEMA_TEST_RUNTIME_DATABASE_URL:\s+postgresql:\/\/[^\s]+@127\.0\.0\.1:5432\/flow_schema_control_test_ci/,
    );
  });

  it("compares PostgreSQL server hosts without inet network-mask suffixes", () => {
    const integration = readFileSync(
      join(appRoot, "server/schema-control/__tests__/schemaControl.pg.test.ts"),
      "utf8",
    );

    expect(integration.match(/host\(inet_server_addr\(\)\) AS server_addr/g)).toHaveLength(2);
    expect(integration).not.toContain("inet_server_addr()::text AS server_addr");
    expect(integration).toContain('[null, "127.0.0.1", "::1"].includes');
  });
});
