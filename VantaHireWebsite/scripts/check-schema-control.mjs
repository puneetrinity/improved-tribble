#!/usr/bin/env node
// Gate 1A0-F — repository-wide schema-authority/startup guard. No database.
//
// This guard is deliberately repository-root aware: Flow's deploy descriptors
// live both beside the application and one directory above it. The checked-in
// manifest is an exhaustive caller inventory. A new Docker/Railway/Procfile/
// workflow surface therefore fails CI until it is classified explicitly.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, relative, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultAppRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultRepoRoot = dirname(defaultAppRoot);

export function checkSchemaControl(repoRoot = defaultRepoRoot) {
const appRoot = join(repoRoot, "VantaHireWebsite");
const manifestPath = join(appRoot, "server/schema-control/caller-manifest.json");
const problems = [];

function repoPath(path) {
  return join(repoRoot, path);
}

function readRepo(path) {
  return readFileSync(repoPath(path), "utf8");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if ([".git", "node_modules", "dist", "coverage"].includes(entry)) continue;
    const absolute = join(dir, entry);
    const s = statSync(absolute);
    if (s.isDirectory()) walk(absolute, out);
    else out.push(absolute);
  }
  return out;
}

if (!existsSync(manifestPath)) {
  return ["caller-manifest.json is missing."];
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

// 1. The deployment/workflow census is exact. New surfaces cannot silently
// escape the read-only-startup rule.
const isDeploymentSurface = (path) => {
  const name = basename(path);
  return (
    name === "Procfile" ||
    name === "nixpacks.toml" ||
    /^railway.*\.(?:json|toml)$/.test(name) ||
    /^Dockerfile(?:\..+)?$/.test(name) ||
    /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path)
  );
};
const discovered = walk(repoRoot)
  .map((p) => relative(repoRoot, p).replaceAll("\\", "/"))
  .filter(isDeploymentSurface)
  .sort();
const declared = [...(manifest.deploymentSurfaces ?? [])].sort();
for (const path of declared) {
  if (!existsSync(repoPath(path))) problems.push(`declared deployment surface is missing: ${path}`);
}
for (const path of discovered) {
  if (!declared.includes(path)) problems.push(`unclassified deployment/workflow surface: ${path}`);
}
for (const path of declared) {
  if (!discovered.includes(path)) problems.push(`caller manifest contains a non-surface path: ${path}`);
}

for (const path of manifest.runtimeEntrypoints ?? []) {
  if (!existsSync(repoPath(path))) problems.push(`declared runtime entrypoint is missing: ${path}`);
}
for (const path of manifest.commandSurfaces ?? []) {
  if (!existsSync(repoPath(path))) problems.push(`declared transitive command surface is missing: ${path}`);
}

// 2. Flow package scripts: app/worker startup is readiness-only; release,
// adoption and role provisioning are explicit non-runtime commands; old
// push/migrate aliases are gone.
const packagePath = "VantaHireWebsite/package.json";
const pkg = JSON.parse(readRepo(packagePath));
const scripts = pkg.scripts ?? {};
const expectedRuntime = {
  "start:web": "index.js",
  "start:worker": "worker.js",
  "start:ai-worker": "aiWorker.js",
};
for (const [name, runtime] of Object.entries(expectedRuntime)) {
  const command = String(scripts[name] ?? "");
  if (!new RegExp(`node\\s+dist/schema-ready\\.js\\s+&&[\\s\\S]*node\\s+dist/${runtime.replace(".", "\\.")}$`).test(command)) {
    problems.push(`start script "${name}" does not run schema-ready immediately before ${runtime}.`);
  }
  if (/dist\/migrate\.js|db:(?:push|migrate)(?:\s|$)|runMigrations\.ts/i.test(command)) {
    problems.push(`start script "${name}" still invokes a schema writer: "${command}".`);
  }
}
for (const name of ["db:push", "db:migrate"]) {
  if (scripts[name] !== undefined) {
    problems.push(`legacy Flow schema authority "${name}" still exists: "${scripts[name]}".`);
  }
}
if (!/migrate-release/i.test(String(scripts["db:migrate:release"] ?? ""))) {
  problems.push("db:migrate:release is missing its dedicated release runner.");
}
if (!/adopt-existing/i.test(String(scripts["db:adopt-existing"] ?? ""))) {
  problems.push("db:adopt-existing is missing its one-time adoption entrypoint.");
}
if (!/provision-runtime-role/i.test(String(scripts["db:provision-runtime-role"] ?? ""))) {
  problems.push("db:provision-runtime-role is missing its guarded provisioning entrypoint.");
}
if (/server\/migrate\.ts/.test(String(scripts["build:server"] ?? ""))) {
  problems.push("build:server still emits the legacy mutable dist/migrate.js authority.");
}
for (const requiredBundle of ["schema-ready.ts", "migrate-release.ts", "adopt-existing.ts", "provision-runtime-role.ts"]) {
  if (!String(scripts["build:server"] ?? "").includes(`server/${requiredBundle}`)) {
    problems.push(`build:server does not emit the required ${requiredBundle} entrypoint.`);
  }
}

// Explicitly classify the provisioning portal as a different database system;
// its package commands are not Flow authorities and are never silently ignored.
for (const item of manifest.separateSchemaAuthorities ?? []) {
  if (!item.path || !item.system || !item.reason) {
    problems.push("separateSchemaAuthorities entries require path, system, and reason.");
  } else if (!existsSync(repoPath(item.path))) {
    problems.push(`declared separate schema authority is missing: ${item.path}`);
  }
}

// 3. Every retired authority is absent. History remains in git/audit evidence,
// never as a fallback executable or dormant SQL directory in the release.
for (const path of manifest.retiredAuthorities ?? []) {
  if (!existsSync(repoPath(path))) continue;
  const target = repoPath(path);
  if (!statSync(target).isDirectory() || walk(target).length > 0) {
    problems.push(`retired schema authority still exists: ${path}`);
  }
}

// No executable source may import/recreate the mutable bootstrap or dev route.
const serverRoot = repoPath("VantaHireWebsite/server");
for (const absolute of walk(serverRoot)) {
  if (!/\.(?:ts|js|mjs|cjs)$/.test(absolute)) continue;
  const source = readFileSync(absolute, "utf8");
  if (
    /(?:import|export)[\s\S]{0,180}from\s+["'][^"']*bootstrapSchema["']/.test(source) ||
    /require\(["'][^"']*bootstrapSchema["']\)/.test(source)
  ) {
    problems.push(
      `${relative(repoRoot, absolute)} imports bootstrapSchema; mutable bootstrap is not an executable authority.`,
    );
  }
  if (/\/api\/dev\/ensure-ats-schema|ENABLE_BOOTSTRAP/.test(source)) {
    problems.push(`${relative(repoRoot, absolute)} restores a runtime bootstrap authority.`);
  }
}

// The checked-in release descriptor is the sole migration deployment surface.
if (JSON.stringify(manifest.releaseSurfaces ?? []) !== JSON.stringify(["VantaHireWebsite/railway.schema-release.json"])) {
  problems.push("caller manifest must declare exactly one Flow release surface.");
} else {
  try {
    const release = JSON.parse(readRepo("VantaHireWebsite/railway.schema-release.json"));
    if (release?.deploy?.startCommand !== "npm run db:migrate:release") {
      problems.push("schema-release service must default to db:migrate:release.");
    }
    if (release?.deploy?.restartPolicyType !== "NEVER") {
      problems.push("schema-release service must be one-shot with restartPolicyType=NEVER.");
    }
    if (release?.deploy?.healthcheckPath !== undefined) {
      problems.push("schema-release service must not define a healthcheck.");
    }
    if (!String(release?.build?.buildCommand ?? "").includes("npm run build:server")) {
      problems.push("schema-release service must build the reviewed server entrypoints.");
    }
  } catch {
    problems.push("railway.schema-release.json is missing or invalid JSON.");
  }
}

// 4. Every deployment/workflow caller and each transitive command surface
// (for example root Procfile -> start.sh -> app package) is scanned.
for (const path of [...declared, ...(manifest.commandSurfaces ?? [])]) {
  if (!existsSync(repoPath(path))) continue;
  const source = readRepo(path);
  if (
    /dist\/migrate\.js|npm(?:\s+--prefix\s+\S+)?\s+run\s+db:(?:push|migrate)(?:[\s"']|$)|runMigrations\.ts|MIGRATE_ON_START|ENABLE_BOOTSTRAP/i.test(
      source,
    )
  ) {
    problems.push(`${path} still invokes a retired Flow schema authority.`);
  }
}

// 5. Applied-migration immutability.
const migDir = join(appRoot, "server/schema-migrations");
const lockPath = join(migDir, "checksums.lock");
const catalogLockPath = join(migDir, "catalog.lock.json");
if (!existsSync(lockPath) || !existsSync(catalogLockPath)) {
  problems.push("schema-migrations requires checksums.lock and catalog.lock.json.");
} else {
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    problems.push("checksums.lock is invalid JSON.");
  }
  if (
    lock?.format_version !== 1 ||
    typeof lock?.catalog_lock_sha256 !== "string" ||
    !lock?.migrations ||
    typeof lock.migrations !== "object" ||
    Array.isArray(lock.migrations)
  ) {
    problems.push("checksums.lock has an unsupported shape.");
  } else {
    const catalogActual = createHash("sha256")
      .update(readFileSync(catalogLockPath))
      .digest("hex");
    if (catalogActual !== lock.catalog_lock_sha256) {
      problems.push("catalog.lock.json was edited without its approved checksum lock.");
    }
    const migrationFiles = readdirSync(migDir)
      .filter((file) => /^\d{4,}_.+\.sql$/.test(file))
      .sort();
    const pinnedVersions = Object.keys(lock.migrations).sort((a, b) => Number(a) - Number(b));
    const fileVersions = migrationFiles.map((file) => file.split("_", 1)[0]);
    if (JSON.stringify(pinnedVersions) !== JSON.stringify(fileVersions)) {
      problems.push("checksums.lock versions do not exactly match migration files.");
    }
    for (const [version, expected] of Object.entries(lock.migrations)) {
      const file = migrationFiles.find((candidate) => candidate.startsWith(`${version}_`));
      if (!file) {
        problems.push(`applied migration ${version} is missing on disk; applied history must never be removed.`);
        continue;
      }
      const actual = createHash("sha256").update(readFileSync(join(migDir, file))).digest("hex");
      if (actual !== expected) {
        problems.push(`applied migration ${version} (${file}) was edited; write a new forward migration instead.`);
      }
    }
  }
}

// Wave 3B: lifecycle resets may never switch off every user trigger. Historical
// partial-manifest assertions remain explicit, while suites that install the
// full directory must derive the latest count from the manifest.
for (const absolute of walk(serverRoot)) {
  if (!/\.pg\.test\.ts$/.test(absolute)) continue;
  const source = readFileSync(absolute, "utf8");
  const path = relative(appRoot, absolute).replaceAll("\\", "/");
  if (/\bDISABLE\s+TRIGGER\s+USER\b/i.test(source)) {
    problems.push(`PostgreSQL lifecycle broadly disables production triggers: ${path}`);
  }
}
for (const path of [
  "server/lib/__tests__/applicationWorkflowAuthorization.pg.test.ts",
  "server/lib/__tests__/decisionEventSpine.pg.test.ts",
  "server/lib/__tests__/decisionProjectionOutbox.pg.test.ts",
  "server/lib/__tests__/decisionProjectionDelivery.pg.test.ts",
  "server/lib/__tests__/versionedInvitationGrantAuthorization.pg.test.ts",
  "server/lib/__tests__/unsafeOrgAttributionRetirement.pg.test.ts",
  "server/lib/__tests__/privilegeGrantRevocation.pg.test.ts",
  "server/lib/__tests__/applicationAiOutboundAuthorization.pg.test.ts",
  "server/lib/__tests__/reviewerShareAuthorization.pg.test.ts",
  "server/lib/__tests__/talentPoolAuthorization.pg.test.ts",
  "server/lib/__tests__/scopedFinancialAdminPublicAuthorization.pg.test.ts",
  "server/tests/candidatePrivacy.pg.test.ts",
  "server/tests/applicationReadAuthorization.pg.test.ts",
]) {
  const source = readFileSync(join(appRoot, path), "utf8");
  if (!/loadManifest\(migrationsDir\)\.length/.test(source)) {
    problems.push(`full-ledger PostgreSQL lifecycle does not derive the current manifest count: ${path}`);
  }
}

return [...new Set(problems)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkSchemaControl();
  if (problems.length) {
  console.error("[schema-control guard] FAILED:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("[schema-control guard] OK");
  }
}
