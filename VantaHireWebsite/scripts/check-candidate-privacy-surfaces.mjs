#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = "server/candidate-privacy/surfaces.json";

const GOVERNED_TABLE = "(?:applications|candidateResumes|talentPool|jobSourcedCandidates|clientShortlistItems|clientFeedback|formInvitations|formResponses|resumeImportItems|candidateOutreachSchedules|sourcedCandidateOutreachLog|applicationGraphSyncJobs)";
const GOVERNED_SERVER_REFERENCE = new RegExp(
  `(?:db\\.query\\.${GOVERNED_TABLE}\\b|(?:from|join|insert|update|delete)\\s*\\(\\s*${GOVERNED_TABLE}\\s*\\)|\\b(?:candidatePrivacy[A-Z]|candidate_privacy_))`,
);
const GOVERNED_CLIENT_REFERENCE = /(?:\/api\/(?:applications|candidates|talent-pool|candidate\/privacy)|\bCandidatePrivacy[A-Z_a-z]*)/;
const CODE_SUFFIX = /\.(?:ts|tsx)$/;
const SKIPPED_PARTS = new Set([
  "__tests__",
  "coverage",
  "dist",
  "node_modules",
  "schema-migrations",
  "scripts",
  "tests",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function walk(path, output = []) {
  if (!existsSync(path)) return output;
  for (const entry of readdirSync(path)) {
    if (SKIPPED_PARTS.has(entry)) continue;
    const absolute = join(path, entry);
    const metadata = statSync(absolute);
    if (metadata.isDirectory()) walk(absolute, output);
    else output.push(absolute);
  }
  return output;
}

function parseManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function read(root, file) {
  return readFileSync(join(root, file), "utf8");
}

function candidateBearingFiles(root) {
  const discovered = [];
  const families = [
    ["server", GOVERNED_SERVER_REFERENCE],
    ["client/src", GOVERNED_CLIENT_REFERENCE],
  ];
  for (const [directory, pattern] of families) {
    for (const absolute of walk(join(root, directory))) {
      if (!CODE_SUFFIX.test(absolute)) continue;
      const file = relative(root, absolute).replaceAll("\\", "/");
      if (file === "scripts/check-candidate-privacy-surfaces.mjs") continue;
      if (pattern.test(readFileSync(absolute, "utf8"))) discovered.push(file);
    }
  }
  return [...new Set(discovered)].sort();
}

function assertBefore(problems, source, before, after, label) {
  const beforeAt = source.indexOf(before);
  const afterAt = source.indexOf(after);
  if (beforeAt < 0 || afterAt < 0 || beforeAt > afterAt) {
    problems.push(`${label} is missing or ordered after the protected action.`);
  }
}

function exportedFunctionSource(source, symbol) {
  const startPattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbol}\\b`);
  const match = startPattern.exec(source);
  if (!match) return "";
  const tail = source.slice(match.index + match[0].length);
  const next = /\nexport\s+(?:async\s+)?function\s+\w+\b/.exec(tail);
  return next ? source.slice(match.index, match.index + match[0].length + next.index) : source.slice(match.index);
}

function assertMinimumCount(problems, source, needle, minimum, label) {
  const count = source.split(needle).length - 1;
  if (count < minimum) problems.push(`${label} is incomplete (expected at least ${minimum}, found ${count}).`);
}

function validateStaticContracts(root, problems) {
  const storage = read(root, "server/storage.ts");
  const semantic = read(root, "server/candidates.semantic.routes.ts");
  const aiWorker = read(root, "server/aiWorker.ts");
  const graphWorker = read(root, "server/lib/applicationGraphSyncProcessor.ts");
  const resumeWorker = read(root, "server/lib/resumeImportProcessor.ts");
  const sourcing = read(root, "server/lib/services/sourcing-sync.ts");
  const emailProvider = read(root, "server/emailTemplateService.ts");
  const whatsappProvider = read(root, "server/whatsappTemplateService.ts");
  const jobAnalytics = read(root, "server/lib/analyticsHelper.ts");
  const orgAnalytics = read(root, "server/lib/orgAnalyticsService.ts");
  const routes = read(root, "server/candidate-privacy/routes.ts");
  const repository = read(root, "server/candidate-privacy/repository.ts");
  const migration = read(root, "server/schema-migrations/0001_candidate_privacy_flow.sql");

  for (const absolute of walk(join(root, "server"))) {
    if (!CODE_SUFFIX.test(absolute)) continue;
    const source = readFileSync(absolute, "utf8");
    if (/\.(?:delete|remove)\s*\(\s*talentPool\s*\)/.test(source)) {
      problems.push(`physical talent-pool deletion is reachable in ${relative(root, absolute)}.`);
    }
  }

  const outboxBlock = migration.match(/CREATE TABLE (?:public\.)?candidate_privacy_outbox\b[\s\S]*?;\n/i)?.[0] ?? "";
  if (!outboxBlock || /\b(?:body|payload|email|phone|evidence_ref)\b/i.test(outboxBlock)) {
    problems.push("privacy outbox persists a raw request or identity field.");
  }
  if (/candidate_privacy_outbox[\s\S]{0,120}\bDELETE\b/i.test(repository)) {
    problems.push("privacy outbox has a destructive dequeue path.");
  }
  if (!repository.includes("transientIdentifiersForRequest") || !repository.includes("evidence_ref")) {
    problems.push("privacy delivery no longer reconstructs its transient body from durable authority rows.");
  }

  assertBefore(
    problems,
    semantic,
    "privacyAllowedSql('application'",
    "privacyFilteredResults.slice(0, requestedTopK)",
    "semantic-search SQL privacy predicate",
  );
  const healthStart = storage.indexOf("async getJobHealthSummary");
  const healthEnd = storage.indexOf("async getAnalyticsNudges", healthStart);
  const healthSource = healthStart >= 0 && healthEnd > healthStart
    ? storage.slice(healthStart, healthEnd)
    : "";
  assertBefore(problems, healthSource, "applicationPrivacyAllowed(false)", ".groupBy(", "application aggregate privacy predicate");
  if ((storage.match(/applicationPrivacyAllowed\(false\)/g) ?? []).length < 5) {
    problems.push("application repository reader census lost a SQL privacy predicate.");
  }

  if ((aiWorker.match(/requireCandidatePrivacyAllowed\(/g) ?? []).length < 9) {
    problems.push("AI worker load/provider/publication privacy rechecks are incomplete.");
  }
  if ((graphWorker.match(/requireCandidatePrivacyAllowed\(/g) ?? []).length < 6) {
    problems.push("graph worker load/download/publication privacy rechecks are incomplete.");
  }
  if ((resumeWorker.match(/requireNewCandidateIdentityAllowed\(/g) ?? []).length < 2) {
    problems.push("resume import worker identity rechecks are incomplete.");
  }
  if (!sourcing.includes("privacyAllowedCandidates") || !sourcing.includes("checkMemoryEligibilityBatch")) {
    problems.push("sourcing materialization no longer batch-filters before persistence.");
  }
  assertMinimumCount(
    problems,
    exportedFunctionSource(emailProvider, "sendTemplatedEmail"),
    "requireCandidatePrivacyAllowed(",
    2,
    "templated email load/provider-boundary privacy rechecks",
  );
  assertMinimumCount(
    problems,
    exportedFunctionSource(emailProvider, "notifyRecruitersNewApplication"),
    "requireCandidatePrivacyAllowed(",
    2,
    "recruiter notification load/provider-boundary privacy rechecks",
  );
  assertBefore(
    problems,
    emailProvider,
    "requireCandidatePrivacyAllowed(",
    "await svc.sendEmail({",
    "email provider privacy recheck",
  );
  assertMinimumCount(
    problems,
    exportedFunctionSource(whatsappProvider, "sendWhatsAppTemplatedMessage"),
    "requireCandidatePrivacyAllowed(",
    2,
    "WhatsApp load/provider-boundary privacy rechecks",
  );
  assertBefore(
    problems,
    whatsappProvider,
    "requireCandidatePrivacyAllowed(",
    "await svc.sendTemplateMessage({",
    "WhatsApp provider privacy recheck",
  );
  for (const [symbol, minimum] of [
    ["calculateTimeToFill", 1],
    ["calculateTimeInStage", 1],
    ["getHiringMetrics", 1],
  ]) {
    assertMinimumCount(
      problems,
      exportedFunctionSource(jobAnalytics, symbol),
      "applicationPrivacyAllowed()",
      minimum,
      `${symbol} SQL-before-aggregate privacy predicates`,
    );
  }
  for (const [symbol, minimum] of [
    ["getOrgAnalyticsOverview", 2],
    ["getTimeToFillByJob", 2],
    ["getTimeInStageBreakdown", 3],
    ["getSourcePerformance", 1],
    ["getRecruiterPerformance", 2],
    ["getHiringManagerPerformance", 1],
    ["getTeamActivity", 1],
    ["getHiringFunnel", 2],
  ]) {
    assertMinimumCount(
      problems,
      exportedFunctionSource(orgAnalytics, symbol),
      "applicationPrivacyAllowed(",
      minimum,
      `${symbol} SQL-before-aggregate privacy predicates`,
    );
  }

  const candidateCreateBlock = routes.match(/"\/api\/candidate\/privacy\/requests"[\s\S]*?\n\s*\);/m)?.[0] ?? "";
  const adminCreateBlock = routes.match(/"\/api\/admin\/privacy\/requests"[\s\S]*?\n\s*\);/m)?.[0] ?? "";
  if (!candidateCreateBlock.includes("requireVerifiedCandidate")
    || !candidateCreateBlock.includes("requireRecentPrivacyAuth")) {
    problems.push("candidate global privacy action lost self-service/recent-auth authority.");
  }
  if (!adminCreateBlock.includes("requireRole([\"super_admin\"])")
    || /recruiter|organization_admin/.test(adminCreateBlock)) {
    problems.push("recruiter or organization authority can mint a global privacy action.");
  }
}

export function checkCandidatePrivacySurfaces(
  root = DEFAULT_ROOT,
  manifestRelative = DEFAULT_MANIFEST,
) {
  const problems = [];
  const manifestPath = join(root, manifestRelative);
  if (!existsSync(manifestPath)) return ["candidate privacy surface manifest is missing."];
  let manifest;
  try {
    manifest = parseManifest(manifestPath);
  } catch {
    return ["candidate privacy surface manifest is invalid JSON."];
  }
  if (manifest.format_version !== 1 || manifest.source_commit !== "8ef31cada4ed2169528d2da6c8f075cde77eb26e") {
    problems.push("candidate privacy manifest pin or format is invalid.");
  }

  const sources = new Map();
  for (const row of manifest.sources ?? []) {
    if (!row.file || !["fenced", "excluded", "ui_consumer"].includes(row.classification)) {
      problems.push("every source row requires file and a supported classification.");
      continue;
    }
    if (sources.has(row.file)) {
      problems.push(`duplicate candidate privacy source row: ${row.file}`);
      continue;
    }
    sources.set(row.file, row);
    const absolute = join(root, row.file);
    if (!existsSync(absolute)) {
      problems.push(`classified candidate privacy source is missing: ${row.file}`);
      continue;
    }
  }
  const censusHash = sha256(
    [...sources.keys()].sort().map((file) => `${file}\0${sha256(readFileSync(join(root, file)))}\n`).join(""),
  );
  if (manifest.source_census_sha256 !== censusHash) {
    problems.push(`candidate privacy source census drifted (actual ${censusHash}).`);
  }

  const discovered = candidateBearingFiles(root);
  for (const file of discovered) {
    if (!sources.has(file)) problems.push(`unclassified candidate-bearing source: ${file}`);
  }
  for (const file of manifest.mandatory_files ?? []) {
    if (!sources.has(file)) problems.push(`mandatory candidate privacy source is unclassified: ${file}`);
  }

  const surfaceIds = new Set();
  for (const row of manifest.surfaces ?? []) {
    const required = [
      "id", "file", "symbol", "models", "direction", "privacy_action",
      "organization_scope", "enforcement", "anchors",
    ];
    if (required.some((key) => row[key] === undefined)
      || !Array.isArray(row.models)
      || !Array.isArray(row.privacy_action)
      || !Array.isArray(row.anchors)) {
      problems.push("candidate privacy surface row is incomplete.");
      continue;
    }
    if (surfaceIds.has(row.id)) problems.push(`duplicate candidate privacy surface id: ${row.id}`);
    surfaceIds.add(row.id);
    const sourceRow = sources.get(row.file);
    if (!sourceRow || sourceRow.classification === "excluded") {
      problems.push(`surface ${row.id} does not reference a fenced/UI source.`);
      continue;
    }
    const source = read(root, row.file);
    if (row.symbol !== "<module>" && !source.includes(row.symbol)) {
      problems.push(`surface symbol is missing: ${row.file}::${row.symbol}`);
    }
    for (const anchor of row.anchors) {
      if (!source.includes(anchor)) {
        problems.push(`surface enforcement anchor is missing: ${row.file}::${anchor}`);
      }
    }
  }

  for (const row of manifest.exclusions ?? []) {
    if (!row.id || !row.file || !row.symbol || !row.reason || !Array.isArray(row.anchors)) {
      problems.push("candidate privacy exclusion row is incomplete.");
      continue;
    }
    const sourceRow = sources.get(row.file);
    if (!sourceRow || !["excluded", "ui_consumer"].includes(sourceRow.classification)) {
      problems.push(`exclusion ${row.id} does not reference an excluded source.`);
      continue;
    }
    const source = read(root, row.file);
    if (row.symbol !== "<module>" && !source.includes(row.symbol)) {
      problems.push(`excluded symbol is missing: ${row.file}::${row.symbol}`);
    }
    for (const anchor of row.anchors) {
      if (!source.includes(anchor)) problems.push(`exclusion anchor is missing: ${row.file}::${anchor}`);
    }
  }

  const classifiedSurfaceFiles = new Set((manifest.surfaces ?? []).map((row) => row.file));
  const classifiedExcludedFiles = new Set((manifest.exclusions ?? []).map((row) => row.file));
  for (const [file, row] of sources) {
    if (["excluded", "ui_consumer"].includes(row.classification)
      && !classifiedExcludedFiles.has(file)
      && !classifiedSurfaceFiles.has(file)) {
      problems.push(`non-enforcement source lacks a classification contract: ${file}`);
    }
    if (row.classification === "fenced" && !classifiedSurfaceFiles.has(file)) {
      problems.push(`candidate privacy source lacks a surface contract: ${file}`);
    }
  }

  try {
    validateStaticContracts(root, problems);
  } catch (error) {
    problems.push(`candidate privacy static contract could not be checked: ${error.constructor.name}`);
  }
  return [...new Set(problems)].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--discover")) {
    console.log(candidateBearingFiles(DEFAULT_ROOT).join("\n"));
  } else {
    const problems = checkCandidatePrivacySurfaces();
    if (problems.length) {
      console.error("[candidate-privacy surface guard] FAILED:");
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
    } else {
      console.log("[candidate-privacy surface guard] OK");
    }
  }
}
