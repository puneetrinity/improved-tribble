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
