#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = "server/object-authorization/surfaces.json";
const SOURCE_COMMIT = "5449d7b13f80b6fbca56daebb7dc9ccdd965e335";
const ROUTE_METHOD = /\bapp\.(?:get|post|put|patch|delete)\s*\(/g;
const SKIP_ROUTE_PARTS = new Set(["__tests__", "tests", "scripts", "dist", "node_modules"]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function read(root, file) {
  return readFileSync(join(root, file), "utf8");
}

function walk(path, output = []) {
  if (!existsSync(path)) return output;
  for (const entry of readdirSync(path)) {
    if (SKIP_ROUTE_PARTS.has(entry)) continue;
    const absolute = join(path, entry);
    const metadata = statSync(absolute);
    if (metadata.isDirectory()) walk(absolute, output);
    else output.push(absolute);
  }
  return output;
}

function exportedFunctionSource(source, symbol) {
  const startPattern = new RegExp(`export\\s+async\\s+function\\s+${symbol}\\b`);
  const match = startPattern.exec(source);
  if (!match) return "";
  const tail = source.slice(match.index + match[0].length);
  const next = /\nexport\s+async\s+function\s+\w+\b/.exec(tail);
  return next ? source.slice(match.index, match.index + match[0].length + next.index) : source.slice(match.index);
}

function routeCall(source, method, path) {
  const pattern = new RegExp(`app\\.${method}\\(\\s*["']${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "g");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) return { count: matches.length, source: "" };
  const start = matches[0].index;
  const endings = ["\n  });", "\n  );"]
    .map((closing) => ({ closing, index: source.indexOf(closing, start) }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index);
  const end = endings[0];
  return {
    count: 1,
    source: end ? source.slice(start, end.index + end.closing.length) : "",
  };
}

function routeRegistrationCount(root) {
  let count = 0;
  for (const absolute of walk(join(root, "server"))) {
    if (!absolute.endsWith(".ts")) continue;
    const file = relative(root, absolute).replaceAll("\\", "/");
    if (file === "server/testRunner.routes.ts") continue;
    const source = readFileSync(absolute, "utf8").replace('app.get("env")', "app.readEnvironment(");
    count += (source.match(ROUTE_METHOD) ?? []).length;
  }
  return count;
}

function count(source, needle) {
  return source.split(needle).length - 1;
}

function requireAnchor(problems, source, anchor, label) {
  if (!source.includes(anchor)) problems.push(label);
}

function validateKernel(root, problems) {
  const kernel = read(root, "server/lib/applicationReadAuthorization.ts");
  const storage = read(root, "server/storage.ts");
  const auth = read(root, "server/auth.ts");
  const routes = read(root, "server/applications.routes.ts");
  const whatsappRoutes = read(root, "server/whatsapp.routes.ts");
  const testConfig = read(root, "vitest.server.config.ts");

  for (const anchor of [
    "function parsePositiveDecimalApplicationId",
    "typeof value !== 'string'",
    "!/^[1-9][0-9]*$/.test(value)",
    "Number.isSafeInteger(parsed)",
  ]) requireAnchor(problems, routes, anchor, `strict application-id parser lost required anchor: ${anchor}`);

  for (const anchor of [
    "export function parsePositiveDecimalApplicationId",
    'typeof value !== "string"',
    "!/^[1-9][0-9]*$/.test(value)",
    "Number.isSafeInteger(parsed)",
  ]) requireAnchor(problems, kernel, anchor, `shared strict application-id parser lost required anchor: ${anchor}`);

  const sharedAnchors = [
    ["WITH authorized_application AS", "authorization read lost its protected CTE."],
    ["applicationPrivacyAllowed(false)", "authorization read lost the candidate-privacy predicate."],
    ["actor.role = 'recruiter'", "authorization read lost the current recruiter-role predicate."],
    ["actor.role = 'super_admin'", "authorization read lost the explicit platform-admin predicate."],
    ["${allowPlatformAdmin} AND actor.role", "platform-admin access is no longer controlled by the explicit policy."],
    ["${applications.organizationId} IS NOT NULL", "application organization can be null."],
    ["${jobs.organizationId} IS NOT NULL", "job organization can be null."],
    ["${applications.organizationId} = ${jobs.organizationId}", "application and job organization can diverge."],
    ["FROM ${organizationMembers}", "authorization read lost current organization membership."],
    ["${organizationMembers.seatAssigned} = TRUE", "authorization read lost current seat enforcement."],
    ["${jobs.postedBy} = ${actorId}", "authorization read lost primary-recruiter authority."],
    ["FROM ${jobRecruiters}", "authorization read lost exact co-recruiter authority."],
    ["${jobRecruiters.jobId} = ${jobs.id}", "co-recruiter authority is not bound to the exact job."],
    ["FROM authorized_application", "history is no longer selected through the authorized CTE."],
  ];
  for (const [anchor, label] of sharedAnchors) requireAnchor(problems, kernel, anchor, label);
  if (count(kernel, "FROM authorized_application") !== 4) {
    problems.push("all four protected application readers must read through the authorized CTE.");
  }
  if (count(kernel, "LEFT JOIN ${applicationStageHistory}") !== 1
    || count(kernel, "LEFT JOIN ${emailAuditLog}") !== 1
    || count(kernel, "LEFT JOIN ${whatsappAuditLog}") !== 1) {
    problems.push("authorized-empty sentinel joins are incomplete.");
  }
  if (/\bLIMIT\b/.test(kernel)) problems.push("authorization read introduced a pre-fence limit.");

  for (const symbol of [
    "readAuthorizedApplicationStageHistory",
    "readAuthorizedApplicationEmailHistory",
    "readAuthorizedApplicationInterviewInvite",
    "readAuthorizedApplicationWhatsAppHistory",
  ]) {
    const source = exportedFunctionSource(kernel, symbol);
    if (!source) problems.push(`authorization reader is missing: ${symbol}`);
    else if (count(source, "db.execute(") !== 1) {
      problems.push(`${symbol} must execute exactly one database statement.`);
    }
  }

  requireAnchor(problems, kernel, "fromStage: nullablePositiveInteger(row.fromStage)", "stage projection lost fromStage.");
  requireAnchor(problems, kernel, "toStage: positiveInteger(row.toStage)", "stage projection lost toStage.");
  requireAnchor(problems, kernel, "changedAt: isoTimestamp(row.changedAt)", "stage projection lost changedAt.");
  requireAnchor(problems, kernel, "notes: nullableText(row.notes)", "stage projection lost notes.");
  for (const anchor of [
    "id: positiveInteger(row.id)",
    "templateName: text(row.templateName)",
    "templateType: text(row.templateType)",
    "recipientEmail: text(row.recipientEmail)",
    "sentAt: isoTimestamp(row.sentAt)",
    "status: text(row.status)",
    "sentBy: sender(row.sentBy)",
  ]) requireAnchor(problems, kernel, anchor, `email projection anchor is missing: ${anchor}`);

  const interviewReader = exportedFunctionSource(kernel, "readAuthorizedApplicationInterviewInvite");
  for (const anchor of [
    "${applications.name} AS candidate_name",
    "${applications.email} AS candidate_email",
    "${jobs.title} AS job_title",
    "${applications.interviewDate} AS interview_date",
    "${applications.interviewTime} AS interview_time",
    "${applications.interviewLocation} AS interview_location",
    "${applications.interviewNotes} AS interview_notes",
    'authorized_application.candidate_name AS "candidateName"',
    'authorized_application.candidate_email AS "candidateEmail"',
    'authorized_application.job_title AS "jobTitle"',
    'authorized_application.interview_date AS "interviewDate"',
    'authorized_application.interview_time AS "interviewTime"',
    'authorized_application.interview_location AS "interviewLocation"',
    'authorized_application.interview_notes AS "interviewNotes"',
  ]) requireAnchor(problems, interviewReader, anchor, `interview projection anchor is missing: ${anchor}`);
  if (/\b(?:JOIN|FROM)\s+\$\{(?:applications|jobs)\}/.test(interviewReader)) {
    problems.push("interview target fields are re-read outside the authorized CTE.");
  }
  const interviewSelect = interviewReader.match(/SELECT authorized_application\.candidate_name[\s\S]*?FROM authorized_application/)?.[0] ?? "";
  const interviewAliases = [...interviewSelect.matchAll(/AS\s+"([A-Za-z]+)"/g)].map((match) => match[1]);
  if (JSON.stringify(interviewAliases) !== JSON.stringify([
    "candidateName",
    "candidateEmail",
    "jobTitle",
    "interviewDate",
    "interviewTime",
    "interviewLocation",
    "interviewNotes",
  ])) {
    problems.push("interview reader no longer returns the exact seven-field projection.");
  }
  if (/\b(?:phone|resume|organization|applicationId|jobId|userId|score|consent|source)\b/i.test(interviewSelect)) {
    problems.push("interview reader selects a forbidden target field.");
  }

  const whatsappReader = exportedFunctionSource(kernel, "readAuthorizedApplicationWhatsAppHistory");
  for (const anchor of [
    "LEFT JOIN ${whatsappAuditLog}",
    "${whatsappAuditLog.applicationId} = authorized_application.application_id",
    "LEFT JOIN ${whatsappTemplates}",
    "LEFT JOIN ${users} AS sender",
    "${whatsappAuditLog.sentAt} DESC NULLS LAST",
    "${whatsappAuditLog.id} DESC NULLS LAST",
    "templateName: text(row.templateName)",
    "templateType: text(row.templateType)",
    "status: text(row.status)",
    "sentAt: isoTimestamp(row.sentAt)",
    "deliveredAt: nullableIsoTimestamp(row.deliveredAt)",
    "readAt: nullableIsoTimestamp(row.readAt)",
    "sentBy: sender(row.sentBy)",
  ]) requireAnchor(problems, whatsappReader, anchor, `WhatsApp projection anchor is missing: ${anchor}`);
  const whatsappSelect = whatsappReader.match(
    /SELECT authorized_application\.application_id AS "authorizedApplicationId",[\s\S]*?FROM authorized_application/,
  )?.[0] ?? "";
  const whatsappAliases = [...whatsappSelect.matchAll(/AS\s+"([A-Za-z]+)"/g)]
    .map((match) => match[1])
    .filter((alias) => alias !== "authorizedApplicationId");
  if (JSON.stringify(whatsappAliases) !== JSON.stringify([
    "templateName",
    "templateType",
    "sentAt",
    "deliveredAt",
    "readAt",
    "sentBy",
  ])) {
    problems.push("WhatsApp reader no longer returns the exact seven-field projection.");
  }
  if (/\$\{whatsappAuditLog\.(?:recipientPhone|messageId|errorCode|errorMessage|templateVariables)\}/.test(whatsappSelect)
    || /\$\{whatsappTemplates\.(?:metaTemplateName|metaTemplateId|bodyTemplate|status|rejectionReason|category|language)\}/.test(whatsappSelect)
    || /AS\s+"?(?:id|applicationId|templateId|recipientPhone|messageId|errorCode|errorMessage|templateVariables)"?/i.test(whatsappSelect)) {
    problems.push("WhatsApp history selects a forbidden raw audit or template field.");
  }
  if (count(whatsappReader, "db.execute(") !== 1) {
    problems.push("WhatsApp history must execute exactly one database statement.");
  }

  const emailSelect = kernel.match(/SELECT authorized_application\.application_id AS "authorizedApplicationId",[\s\S]*?FROM authorized_application/g)?.[1] ?? "";
  if (/AS\s+"?(?:subject|errorMessage|previewUrl|templateId|senderId|username)"?/i.test(emailSelect)) {
    problems.push("email history selects a forbidden raw audit field.");
  }

  if (storage.includes("getApplicationStageHistory") || storage.includes("getApplicationEmailHistory")) {
    problems.push("an id-only application history storage method remains reachable.");
  }
  if (!storage.includes("export const applicationPrivacyAllowed")) {
    problems.push("the kernel no longer reuses the shipped application privacy expression.");
  }
  if (auth.includes("withOrgContext")) problems.push("dead fail-open withOrgContext remains defined.");

  for (const route of [
    ["get", "/api/applications/:id/history", "readAuthorizedApplicationStageHistory"],
    ["get", "/api/applications/:id/email-history", "readAuthorizedApplicationEmailHistory"],
  ]) {
    const registration = routeCall(routes, route[0], route[1]);
    if (registration.count !== 1 || !registration.source) {
      problems.push(`route registration must exist exactly once: ${route[0].toUpperCase()} ${route[1]}`);
      continue;
    }
    const handler = registration.source;
    for (const anchor of [
      "requireRole(['recruiter', 'super_admin'])",
      "requireSeat()",
      "parsePositiveDecimalApplicationId",
      "INVALID_APPLICATION_ID",
      route[2],
      "allowPlatformAdmin: true",
      "APPLICATION_NOT_FOUND",
      "AUTHORIZATION_UNAVAILABLE",
      "res.json(result.rows)",
    ]) requireAnchor(problems, handler, anchor, `${route[1]} lost required handler anchor: ${anchor}`);
    if (handler.includes("storage.getApplication(")
      || handler.includes("getApplicationStageHistory(")
      || handler.includes("getApplicationEmailHistory(")) {
      problems.push(`${route[1]} reaches an id-only application/history read.`);
    }
    if (handler.indexOf(route[2]) > handler.indexOf("res.json(result.rows)")) {
      problems.push(`${route[1]} responds before its authorization read.`);
    }
  }

  const interviewRoute = routeCall(routes, "get", "/api/applications/:id/interview/ics");
  if (interviewRoute.count !== 1 || !interviewRoute.source) {
    problems.push("route registration must exist exactly once: GET /api/applications/:id/interview/ics");
  } else {
    const handler = interviewRoute.source;
    for (const anchor of [
      "requireRole(['recruiter', 'super_admin'])",
      "requireSeat()",
      "parsePositiveDecimalApplicationId",
      "INVALID_APPLICATION_ID",
      "readAuthorizedApplicationInterviewInvite",
      "allowPlatformAdmin: true",
      "APPLICATION_NOT_FOUND",
      "AUTHORIZATION_UNAVAILABLE",
      "INTERVIEW_NOT_SCHEDULED",
      "generateInterviewICS(interviewDetails)",
      "getICSFilename(interview.jobTitle, interview.candidateName)",
    ]) requireAnchor(problems, handler, anchor, `/api/applications/:id/interview/ics lost required handler anchor: ${anchor}`);
    if (handler.includes("storage.getApplication(")
      || handler.includes("storage.getJob(")
      || /\bdb\.(?:query|select|execute)\b/.test(handler)) {
      problems.push("/api/applications/:id/interview/ics reaches an id-only or raw target read.");
    }
    if (count(handler, "generateInterviewICS(") !== 1) {
      problems.push("the ICS route must invoke its generator exactly once.");
    }
    const authorizationAt = handler.indexOf("readAuthorizedApplicationInterviewInvite");
    const generatorAt = handler.indexOf("generateInterviewICS(interviewDetails)");
    if (authorizationAt < 0 || generatorAt < 0 || authorizationAt > generatorAt) {
      problems.push("ICS generation occurs before statement-bound authorization.");
    }
  }

  const whatsappRoute = routeCall(whatsappRoutes, "get", "/api/applications/:id/whatsapp-history");
  if (whatsappRoute.count !== 1 || !whatsappRoute.source) {
    problems.push("route registration must exist exactly once: GET /api/applications/:id/whatsapp-history");
  } else {
    const handler = whatsappRoute.source;
    for (const anchor of [
      "requireRole(['recruiter', 'super_admin'])",
      "requireSeat()",
      "parsePositiveDecimalApplicationId",
      "INVALID_APPLICATION_ID",
      "readAuthorizedApplicationWhatsAppHistory",
      "allowPlatformAdmin: true",
      "APPLICATION_NOT_FOUND",
      "AUTHORIZATION_UNAVAILABLE",
      "res.json(result.rows)",
    ]) requireAnchor(problems, handler, anchor, `/api/applications/:id/whatsapp-history lost required handler anchor: ${anchor}`);
    if (handler.includes("storage.getApplication(")
      || handler.includes("db.query.whatsappAuditLog")
      || handler.includes("whatsappAuditLog.findMany")) {
      problems.push("/api/applications/:id/whatsapp-history reaches an id-only or raw history read.");
    }
    const authorizationAt = handler.indexOf("readAuthorizedApplicationWhatsAppHistory");
    const responseAt = handler.indexOf("res.json(result.rows)");
    if (authorizationAt < 0 || responseAt < 0 || authorizationAt > responseAt) {
      problems.push("WhatsApp history responds before statement-bound authorization.");
    }
  }

  for (const row of manifestFrozenRouteBlocks(root)) {
    const registration = routeCall(whatsappRoutes, row.method, row.path);
    if (registration.count !== 1 || !registration.source) {
      problems.push(`frozen WhatsApp route block is missing: ${row.method.toUpperCase()} ${row.path}`);
    } else if (sha256(registration.source) !== row.sha256) {
      problems.push(`frozen WhatsApp route block drifted: ${row.method.toUpperCase()} ${row.path}`);
    }
  }

  requireAnchor(
    problems,
    testConfig,
    "'server/tests/interviewIcsAuthorization.routes.test.ts'",
    "the focused ICS authorization route test is not collected by Vitest.",
  );
}

function manifestFrozenRouteBlocks(root) {
  const manifest = JSON.parse(readFileSync(join(root, "server/object-authorization/surfaces.json"), "utf8"));
  return Array.isArray(manifest.frozen_route_blocks) ? manifest.frozen_route_blocks : [];
}

export function checkObjectAuthorization(root = DEFAULT_ROOT, manifestRelative = DEFAULT_MANIFEST) {
  const problems = [];
  const manifestPath = join(root, manifestRelative);
  if (!existsSync(manifestPath)) return ["object authorization manifest is missing."];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return ["object authorization manifest is invalid JSON."];
  }
  if (manifest.format_version !== 1 || manifest.source_commit !== SOURCE_COMMIT) {
    problems.push("object authorization manifest pin or format is invalid.");
  }
  if (manifest.route_registration_census !== 316) {
    problems.push("object authorization route census contract is invalid.");
  }
  if (!Array.isArray(manifest.frozen_route_blocks) || manifest.frozen_route_blocks.length !== 5) {
    problems.push("exactly five non-history WhatsApp route blocks must be frozen.");
  }

  for (const row of [...(manifest.governed_files ?? []), ...(manifest.frozen_files ?? [])]) {
    if (!row.file || !/^[a-f0-9]{64}$/.test(row.sha256 ?? "")) {
      problems.push("every governed/frozen file requires a path and SHA-256.");
      continue;
    }
    const path = join(root, row.file);
    if (!existsSync(path)) problems.push(`governed/frozen file is missing: ${row.file}`);
    else if (sha256(readFileSync(path)) !== row.sha256) problems.push(`governed/frozen file drifted: ${row.file}`);
  }

  const routeCount = routeRegistrationCount(root);
  if (routeCount !== manifest.route_registration_census) {
    problems.push(`Flow route registration census drifted (expected 316, found ${routeCount}).`);
  }

  try {
    validateKernel(root, problems);
  } catch (error) {
    problems.push(`object authorization static contract could not be checked: ${error.constructor.name}`);
  }
  return [...new Set(problems)].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkObjectAuthorization();
  if (problems.length) {
    console.error("[object-authorization guard] FAILED:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("[object-authorization guard] OK");
  }
}
