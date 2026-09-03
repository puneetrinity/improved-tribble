#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = "server/object-authorization/surfaces.json";
const SOURCE_COMMIT = "ae84dcf9af22ac15cca0fe1eaf546ee338fff779";
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
  const startPattern = new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbol}\\b`);
  const match = startPattern.exec(source);
  if (!match) return "";
  const tail = source.slice(match.index + match[0].length);
  const next = /\nexport\s+(?:async\s+)?function\s+\w+\b/.exec(tail);
  return next ? source.slice(match.index, match.index + match[0].length + next.index) : source.slice(match.index);
}

function classMethodSource(source, symbol) {
  const startPattern = new RegExp(`\\n\\s{2}async\\s+${symbol}\\b`);
  const match = startPattern.exec(source);
  if (!match) return "";
  const tail = source.slice(match.index + match[0].length);
  const next = /\n\s{2}async\s+\w+\b/.exec(tail);
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

function validateApplicationAiOutboundAuthority(root, problems) {
  const authority = read(root, "server/lib/applicationAiOutboundAuthorization.ts");
  const applicationRoutes = read(root, "server/applications.routes.ts");
  const communicationRoutes = read(root, "server/communications.routes.ts");
  const emailService = read(root, "server/emailTemplateService.ts");

  for (const anchor of [
    "${applications.organizationId} IS NOT NULL",
    "${jobs.organizationId} IS NOT NULL",
    "${applications.organizationId} = ${jobs.organizationId}",
    "applicationPrivacyAllowed(false)",
    "actor.role = 'recruiter'",
    "${organizationMembers.seatAssigned} = TRUE",
    "${jobs.postedBy} = ${actorId}",
    "FROM ${jobRecruiters}",
    "policy.allowPlatformAdmin",
  ]) requireAnchor(problems, authority, anchor, `AI/outbound authorization anchor is missing: ${anchor}`);
  for (const [anchor, expected] of [
    ["${applications.organizationId} IS NOT NULL", 5],
    ["${jobs.organizationId} IS NOT NULL", 5],
    ["${applications.organizationId} = ${jobs.organizationId}", 5],
    ["applicationPrivacyAllowed(false)", 5],
    ["actor.role = 'recruiter'", 2],
    ["${organizationMembers.seatAssigned} = TRUE", 2],
    ["${jobs.postedBy} = ${actorId}", 3],
    ["FROM ${jobRecruiters}", 3],
    ["policy.allowPlatformAdmin", 5],
  ]) {
    if (count(authority, anchor) !== expected) {
      problems.push(`AI/outbound authorization anchor count drifted: ${anchor}`);
    }
  }

  for (const symbol of [
    "readAuthorizedApplicationAiSummaryContext",
    "publishAuthorizedApplicationAiSummary",
    "readAuthorizedSimilarCandidates",
    "readAuthorizedManualEmailContext",
    "readAuthorizedEmailDraftContext",
    "recordAuthorizedEmailDraftUsage",
  ]) {
    const source = exportedFunctionSource(authority, symbol);
    if (!source) problems.push(`AI/outbound authorization operation is missing: ${symbol}`);
    else if (count(source, "db.execute(") !== 1) problems.push(`${symbol} must execute exactly one database statement.`);
  }

  for (const anchor of [
    "COALESCE(",
    "NULLIF(${applications.extractedResumeText}, '')",
    "NULLIF(${candidateResumes.extractedText}, '')",
    "NULLIF(${applications.coverLetter}, '')",
    "WITH authorized_application AS MATERIALIZED",
    "updated_application AS (",
    "INSERT INTO ${userAiUsage}",
    "'summary'",
    "INNER JOIN inserted_usage ON TRUE",
  ]) requireAnchor(problems, authority, anchor, `AI-summary authority anchor is missing: ${anchor}`);

  for (const anchor of [
    "WITH authorized_target AS MATERIALIZED",
    "${jobs.organizationId} = authorized_target.organization_id",
    "${applications.organizationId} = ${jobs.organizationId}",
    "authorized_target.actor_role = 'super_admin'",
    "ORDER BY ${applications.aiFitScore} DESC, ${applications.id} ASC",
    "LIMIT ${limit}",
    'authorized_target.job_id AS "authorizedJobId"',
  ]) requireAnchor(problems, authority, anchor, `similar-candidate authority anchor is missing: ${anchor}`);

  for (const anchor of [
    "${emailTemplates.organizationId} = ${applications.organizationId}",
    "${emailTemplates.organizationId} IS NULL",
    "${emailTemplates.isDefault} = TRUE OR ${emailTemplates.createdBy} = ${actorId}",
    "readAuthorizedManualEmailContext",
    "readAuthorizedEmailDraftContext",
    "recordAuthorizedEmailDraftUsage",
    "'email_draft'",
  ]) requireAnchor(problems, authority, anchor, `email-context authority anchor is missing: ${anchor}`);

  if (/\b(?:resumeUrl|resumeFilename|phone|password|sourceMetadata)\b/.test(
    exportedFunctionSource(authority, "readAuthorizedApplicationAiSummaryContext"),
  )) problems.push("AI-summary context selects a forbidden candidate/source field.");

  const routeContracts = [
    [applicationRoutes, "post", "/api/applications/:id/ai-summary", "readAuthorizedApplicationAiSummaryContext"],
    [applicationRoutes, "get", "/api/jobs/:id/ai-similar-candidates", "readAuthorizedSimilarCandidates"],
    [communicationRoutes, "post", "/api/applications/:id/send-email", "readAuthorizedManualEmailContext"],
    [communicationRoutes, "post", "/api/email/draft", "readAuthorizedEmailDraftContext"],
  ];
  for (const [routes, method, path, operation] of routeContracts) {
    const registration = routeCall(routes, method, path);
    if (registration.count !== 1 || !registration.source) {
      problems.push(`AI/outbound route registration must exist exactly once: ${method.toUpperCase()} ${path}`);
      continue;
    }
    for (const anchor of ["requireSeat()", operation, "AUTHORIZATION_UNAVAILABLE"]) {
      requireAnchor(problems, registration.source, anchor, `${path} lost AI/outbound route anchor: ${anchor}`);
    }
    if (/storage\.(?:getApplication|getJob|getSimilarCandidatesForJob|getEmailTemplates)|downloadFromGCS|extractResumeText|\bdb\.(?:query|execute|select|insert|update|delete)\b/.test(registration.source)) {
      problems.push(`${path} restores a global/id-only candidate read or route-owned write.`);
    }
    if (/\b(?:hasEnoughCredits|getAiCreditExhaustionPayload|useCredits)\b/.test(registration.source)) {
      problems.push(`${path} restores a customer AI-credit check/debit.`);
    }
    if (/console\.(?:log|warn|error)/.test(registration.source)) {
      problems.push(`${path} logs raw candidate, template, provider or database data.`);
    }
  }
  const summaryRoute = routeCall(applicationRoutes, "post", "/api/applications/:id/ai-summary").source;
  for (const anchor of [
    "parsePositiveDecimalApplicationId", "INVALID_APPLICATION_ID", "APPLICATION_NOT_FOUND",
    "NO_CANDIDATE_CONTENT", "requireCandidatePrivacyAllowed", "generateCandidateSummary",
    "publishAuthorizedApplicationAiSummary",
  ]) requireAnchor(problems, summaryRoute, anchor, `AI-summary route anchor is missing: ${anchor}`);
  const summaryReadAt = summaryRoute.indexOf("readAuthorizedApplicationAiSummaryContext");
  const summaryPrivacyAt = summaryRoute.indexOf("requireCandidatePrivacyAllowed");
  const summaryProviderAt = summaryRoute.indexOf("generateCandidateSummary");
  const summaryPublishAt = summaryRoute.indexOf("publishAuthorizedApplicationAiSummary");
  if (!(summaryReadAt >= 0 && summaryPrivacyAt > summaryReadAt && summaryProviderAt > summaryPrivacyAt && summaryPublishAt > summaryProviderAt)) {
    problems.push("AI-summary authorization/privacy/provider/publication order is unsafe.");
  }

  const similarRoute = routeCall(applicationRoutes, "get", "/api/jobs/:id/ai-similar-candidates").source;
  for (const anchor of [
    "parsePositiveDecimalJobId", "parseSimilarCandidateQuery", "INVALID_JOB_ID",
    "INVALID_SIMILAR_CANDIDATE_QUERY", "JOB_NOT_FOUND", "res.json(result.rows)",
  ]) requireAnchor(problems, similarRoute, anchor, `similar-candidate route anchor is missing: ${anchor}`);

  const manualRoute = routeCall(communicationRoutes, "post", "/api/applications/:id/send-email").source;
  for (const anchor of [
    "parsePositiveDecimalApplicationId", "INVALID_APPLICATION_ID", "APPLICATION_NOT_FOUND",
    "sendAuthorizedTemplatedEmail(context.value", "queueMauticOutreachSync",
  ]) requireAnchor(problems, manualRoute, anchor, `manual-email route anchor is missing: ${anchor}`);
  if (manualRoute.indexOf("sendAuthorizedTemplatedEmail") < manualRoute.indexOf("readAuthorizedManualEmailContext")) {
    problems.push("manual email can reach the provider before statement-bound authorization.");
  }

  const draftRoute = routeCall(communicationRoutes, "post", "/api/email/draft").source;
  for (const anchor of [
    "requireCandidatePrivacyAllowed", "generateEmailDraft", "recordAuthorizedEmailDraftUsage",
    "APPLICATION_NOT_FOUND", "AUTHORIZATION_UNAVAILABLE",
  ]) requireAnchor(problems, draftRoute, anchor, `email-draft route anchor is missing: ${anchor}`);
  const draftReadAt = draftRoute.indexOf("readAuthorizedEmailDraftContext");
  const draftPrivacyAt = draftRoute.indexOf("requireCandidatePrivacyAllowed");
  const draftProviderAt = draftRoute.indexOf("generateEmailDraft");
  const draftUsageAt = draftRoute.indexOf("recordAuthorizedEmailDraftUsage");
  if (!(draftReadAt >= 0 && draftPrivacyAt > draftReadAt && draftProviderAt > draftPrivacyAt && draftUsageAt > draftProviderAt)) {
    problems.push("email-draft authorization/privacy/provider/usage order is unsafe.");
  }

  const sender = exportedFunctionSource(emailService, "sendAuthorizedTemplatedEmail");
  for (const anchor of [
    "isAuthorizedTemplatedEmailContext", "requireCandidatePrivacyAllowed", "getEmailService",
    "const result = await svc.sendEmail", "context.candidateEmail", "db.insert(emailAuditLog)", "Email provider unavailable",
  ]) requireAnchor(problems, sender, anchor, `authorized email sender anchor is missing: ${anchor}`);
  if (/db\.query\.(?:applications|jobs|emailTemplates)|storage\.(?:getApplication|getJob|getEmailTemplates)/.test(sender)) {
    problems.push("authorized email sender restores an id-only application/job/template read.");
  }
  const senderPrivacyAt = sender.indexOf("requireCandidatePrivacyAllowed");
  const senderProviderAt = sender.indexOf("const result = await svc.sendEmail");
  if (senderPrivacyAt < 0 || senderProviderAt < senderPrivacyAt) {
    problems.push("authorized email sender reaches the provider before its final privacy fence.");
  }
  if (/console\.(?:log|warn|error)|error\?\.message|error\.message/.test(sender)) {
    problems.push("authorized email sender logs or persists a raw provider/candidate error.");
  }
}

function validateWorkflowAuthority(root, problems) {
  const workflow = read(root, "server/lib/applicationWorkflowAuthorization.ts");
  const routes = read(root, "server/applications.routes.ts");
  const migration = read(root, "server/schema-migrations/0003_application_workflow_assessments.sql");
  const migrationLock = JSON.parse(read(root, "server/schema-migrations/checksums.lock"));
  const catalog = read(root, "server/schema-migrations/catalog.lock.json");
  const schema = read(root, "shared/schema.ts");

  for (const anchor of [
    "${applications.organizationId} IS NOT NULL",
    "${jobs.organizationId} IS NOT NULL",
    "${applications.organizationId} = ${jobs.organizationId}",
    "applicationPrivacyAllowed(false)",
    "actor.role = 'recruiter'",
    "${organizationMembers.seatAssigned} = TRUE",
    "${jobs.postedBy} = ${actorId}",
    "FROM ${jobRecruiters}",
    "${jobRecruiters.jobId} = ${jobs.id}",
    "policy.allowPlatformAdmin",
  ]) requireAnchor(problems, workflow, anchor, `workflow authorization anchor is missing: ${anchor}`);
  for (const anchor of [
    "${applications.organizationId} IS NOT NULL",
    "${jobs.organizationId} IS NOT NULL",
    "${applications.organizationId} = ${jobs.organizationId}",
    "applicationPrivacyAllowed(false)",
    "policy.allowPlatformAdmin",
  ]) {
    if (count(workflow, anchor) !== 2) {
      problems.push(`workflow authorization anchor must occur in both authorization CTEs: ${anchor}`);
    }
  }

  for (const symbol of [
    "moveAuthorizedApplicationStage",
    "scheduleAuthorizedApplicationInterview",
    "scheduleAuthorizedBulkApplicationInterviews",
    "addAuthorizedApplicationReviewerNote",
    "setAuthorizedApplicationReviewerRating",
    "readAuthorizedApplicationFeedback",
    "addAuthorizedApplicationFeedback",
  ]) {
    const source = exportedFunctionSource(workflow, symbol);
    if (!source) problems.push(`workflow authorization operation is missing: ${symbol}`);
    else if (count(source, "db.execute(") !== 1) problems.push(`${symbol} must execute exactly one database statement.`);
  }

  for (const anchor of [
    "WITH locked_application AS MATERIALIZED",
    "authorized_stage AS MATERIALIZED",
    "UPDATE ${applications}",
    "INSERT INTO ${applicationStageHistory}",
    "changed_by,",
    "${actorId}",
    "${pipelineStages.organizationId} = locked_application.organization_id",
    "${pipelineStages.organizationId} IS NULL AND ${pipelineStages.isDefault} = TRUE",
  ]) requireAnchor(problems, workflow, anchor, `stage workflow anchor is missing: ${anchor}`);

  for (const anchor of [
    "authorization_count AS MATERIALIZED",
    "authorization_count.requested_count = authorization_count.authorized_count",
    "FOR UPDATE OF ${applications}",
    "target_stage.organization_id = ${applications.organizationId}",
    "target_stage.organization_id IS NULL AND target_stage.is_default = TRUE",
    "LEFT JOIN updated_application",
    "ORDER BY requested.ordinal",
  ]) requireAnchor(problems, workflow, anchor, `bulk workflow anchor is missing: ${anchor}`);
  if (count(workflow, "authorization_count.requested_count = authorization_count.authorized_count") !== 2) {
    problems.push("bulk workflow must fence both mutation and result assembly on complete authorization.");
  }

  for (const anchor of [
    "compatibility_projection AS",
    "COALESCE(${applications.recruiterNotes}, ARRAY[]::text[])",
    "INSERT INTO ${applicationReviewerNotes}",
    "'organization_private'",
    "ON CONFLICT (application_id, reviewer_id)",
    "application-rating-v1",
  ]) requireAnchor(problems, workflow, anchor, `assessment workflow anchor is missing: ${anchor}`);
  if (workflow.includes("${applications.rating}")) {
    problems.push("workflow rating writes the legacy shared applications.rating field.");
  }

  for (const anchor of [
    "actor.role = 'hiring_manager' AND ${jobs.hiringManagerId} = ${actorId}",
    "LEFT JOIN ${applicationFeedback}",
    "authorizedApplicationId",
    "jsonb_build_object(",
    "team-feedback-v1",
    "${applicationFeedback.rubricVersion}",
  ]) requireAnchor(problems, workflow, anchor, `team-feedback workflow anchor is missing: ${anchor}`);
  if (/\b(?:password|emailVerificationToken|passwordResetToken)\b/.test(
    exportedFunctionSource(workflow, "readAuthorizedApplicationFeedback"),
  )) problems.push("team-feedback projection includes a forbidden identity field.");

  const routeContracts = [
    ["patch", "/api/applications/:id/stage", "moveAuthorizedApplicationStage"],
    ["patch", "/api/applications/:id/interview", "scheduleAuthorizedApplicationInterview"],
    ["patch", "/api/applications/bulk/interview", "scheduleAuthorizedBulkApplicationInterviews"],
    ["post", "/api/applications/:id/notes", "addAuthorizedApplicationReviewerNote"],
    ["patch", "/api/applications/:id/rating", "setAuthorizedApplicationReviewerRating"],
    ["get", "/api/applications/:id/feedback", "readAuthorizedApplicationFeedback"],
    ["post", "/api/applications/:id/feedback", "addAuthorizedApplicationFeedback"],
  ];
  for (const [method, path, operation] of routeContracts) {
    const registration = routeCall(routes, method, path);
    if (registration.count !== 1 || !registration.source) {
      problems.push(`workflow route registration must exist exactly once: ${method.toUpperCase()} ${path}`);
      continue;
    }
    for (const anchor of ["requireSeat()", operation, "APPLICATION_NOT_FOUND", "AUTHORIZATION_UNAVAILABLE"]) {
      requireAnchor(problems, registration.source, anchor, `${path} lost workflow route anchor: ${anchor}`);
    }
    if (path.includes(":id")) {
      for (const anchor of ["parsePositiveDecimalApplicationId", "INVALID_APPLICATION_ID"])
        requireAnchor(problems, registration.source, anchor, `${path} lost workflow route anchor: ${anchor}`);
    }
    if (/storage\.(?:getApplication|getJob|updateApplicationStage|scheduleInterview|scheduleInterviewWithStage|addRecruiterNote|setApplicationRating)|\bdb\.(?:execute|select|insert|update|delete)\b/.test(registration.source)) {
      problems.push(`${path} restores an id-only or route-owned workflow read/write.`);
    }
    if (/console\.(?:log|warn|error)/.test(registration.source)) {
      problems.push(`${path} logs raw workflow or database data.`);
    }
    const commandAt = registration.source.indexOf(operation);
    const finalResponseAt = Math.max(registration.source.lastIndexOf("res.json("), registration.source.lastIndexOf(".json("));
    if (commandAt < 0 || finalResponseAt < commandAt) problems.push(`${path} has no response after its statement-bound workflow command.`);
    const providerAt = registration.source.search(/runPrivacyCheckedApplicationSideEffect|send(?:StatusUpdate|InterviewInvitation|Offer|Rejection)Notification/);
    if (providerAt >= 0 && providerAt < commandAt) problems.push(`${path} can contact a candidate before its workflow command succeeds.`);
  }
  for (const anchor of [
    "requireRole(['recruiter', 'super_admin'])",
    "requireRole(['recruiter', 'super_admin', 'hiring_manager'])",
  ]) requireAnchor(problems, routes, anchor, `workflow route role gate is missing: ${anchor}`);

  for (const anchor of [
    "CREATE TABLE public.application_reviewer_notes",
    "application_reviewer_notes_note_length_check",
    "application_reviewer_notes_visibility_check",
    "CREATE TABLE public.application_reviewer_ratings",
    "PRIMARY KEY (application_id, reviewer_id)",
    "application_reviewer_ratings_rating_check",
    "application_reviewer_ratings_rubric_version_check",
    "ADD COLUMN rubric_version text NOT NULL DEFAULT 'legacy-unversioned-v1'",
    "application_feedback_rubric_version_check",
  ]) requireAnchor(problems, migration, anchor, `workflow migration anchor is missing: ${anchor}`);
  if (!/^[a-f0-9]{64}$/.test(migrationLock?.migrations?.["0003"] ?? "")) {
    problems.push("workflow migration is missing from checksums.lock.");
  } else if (sha256(migration) !== migrationLock.migrations["0003"]) {
    problems.push("workflow migration checksum does not match migration 0003.");
  }
  if (migrationLock.catalog_lock_sha256 !== sha256(catalog)) {
    problems.push("immutable adoption catalog checksum drifted.");
  }
  for (const anchor of [
    'pgTable("application_reviewer_notes"',
    'pgTable("application_reviewer_ratings"',
    'primaryKey({ columns: [table.applicationId, table.reviewerId] })',
    'rubricVersion: text("rubric_version").notNull().default("legacy-unversioned-v1")',
  ]) requireAnchor(problems, schema, anchor, `workflow Drizzle schema anchor is missing: ${anchor}`);
}

function validateKernel(root, problems) {
  const kernel = read(root, "server/lib/applicationReadAuthorization.ts");
  const membershipKernel = read(root, "server/lib/membershipScopedReadAuthorization.ts");
  const storage = read(root, "server/storage.ts");
  const auth = read(root, "server/auth.ts");
  const routes = read(root, "server/applications.routes.ts");
  const mainRoutes = read(root, "server/routes.ts");
  const subscriptionRoutes = read(root, "server/subscription.routes.ts");
  const whatsappRoutes = read(root, "server/whatsapp.routes.ts");
  const resumeRoutes = read(root, "server/resume.routes.ts");
  const semanticRoutes = read(root, "server/candidates.semantic.routes.ts");
  const gcsStorage = read(root, "server/gcs-storage.ts");
  const candidatesClient = read(root, "client/src/pages/candidates-page.tsx");
  const applicationsClient = read(root, "client/src/pages/applications-page.tsx");
  const managementClient = read(root, "client/src/pages/application-management-page.tsx");
  const internalCopy = read(root, "client/src/lib/internal-copy.ts");
  const migration = read(root, "server/schema-migrations/0002_resume_access_attempts.sql");
  const migrationLock = JSON.parse(read(root, "server/schema-migrations/checksums.lock"));
  const schema = read(root, "shared/schema.ts");
  const schemaControlTest = read(root, "server/schema-control/__tests__/schemaControl.pg.test.ts");
  const schemaGuardTest = read(root, "server/schema-control/__tests__/schemaGuard.test.ts");
  const testConfig = read(root, "vitest.server.config.ts");

  const directoryReader = exportedFunctionSource(membershipKernel, "readAuthorizedHiringManagerDirectory");
  for (const anchor of [
    "export function parseHiringManagerRoleFilter",
    'value === "hiring_manager"',
    "WITH actor_context AS MATERIALIZED",
    "seated_membership.user_id = actor.id",
    "seated_membership.seat_assigned = TRUE",
    "actor_context.actor_role = 'recruiter'",
    "actor_context.organization_id IS NOT NULL",
    "hiring_manager.role = 'hiring_manager'",
    "${jobs.organizationId} = actor_context.organization_id",
    "${jobs.hiringManagerId} = hiring_manager.id",
    "${hiringManagerInvitations.authorityScope} = 'organization'",
    "${hiringManagerInvitations.organizationId} = actor_context.organization_id",
    "${hiringManagerInvitations.acceptedByUserId} = hiring_manager.id",
    "${hiringManagerInvitations.revokedAt} IS NULL",
    "${hiringManagerInvitations.status} = 'accepted'",
    "${policy.allowPlatformAdmin} AND actor_context.actor_role = 'super_admin'",
    "SELECT DISTINCT hiring_manager.id AS id",
    'first_name AS "firstName"',
    'last_name AS "lastName"',
    "ORDER BY normalized_username, id",
  ]) requireAnchor(problems, membershipKernel, anchor, `membership-scoped directory anchor is missing: ${anchor}`);
  if (!directoryReader || count(directoryReader, "db.execute(") !== 1) {
    problems.push("hiring-manager directory must execute exactly one database statement.");
  }
  if (/\b(?:password|emailVerification|passwordReset|aiContent|billing|credit|profile|token)\b/i.test(
    directoryReader,
  )) {
    problems.push("hiring-manager directory selects a forbidden identity field.");
  }
  for (const anchor of [
    "id: positiveInteger(row.id)", "username: text(row.username)", "firstName: nullableText(row.firstName)",
    "lastName: nullableText(row.lastName)", 'role: "hiring_manager"',
  ]) requireAnchor(problems, directoryReader, anchor, `hiring-manager projection anchor is missing: ${anchor}`);

  const jobApplicationsRoute = routeCall(routes, "get", "/api/jobs/:id/applications");
  if (jobApplicationsRoute.count !== 1 || !jobApplicationsRoute.source) {
    problems.push("route registration must exist exactly once: GET /api/jobs/:id/applications");
  } else {
    for (const anchor of ["requireRole(['recruiter', 'super_admin'])", "requireSeat()", "getUserOrganization",
      "isRecruiterOnJob", "getApplicationsByJob"]) {
      requireAnchor(problems, jobApplicationsRoute.source, anchor,
        `/api/jobs/:id/applications lost required handler anchor: ${anchor}`);
    }
    if (jobApplicationsRoute.source.includes("allowNoOrg")) {
      problems.push("/api/jobs/:id/applications restores the no-organization seat exception.");
    }
  }

  const seatUsageRoute = routeCall(subscriptionRoutes, "get", "/api/subscription/seats/usage");
  if (seatUsageRoute.count !== 1 || !seatUsageRoute.source) {
    problems.push("route registration must exist exactly once: GET /api/subscription/seats/usage");
  } else {
    for (const anchor of ["requireRole(['recruiter'])", "requireSeat()", "getUserOrganization",
      "getSeatUsage", "getMembersForSeatSelection"]) {
      requireAnchor(problems, seatUsageRoute.source, anchor,
        `/api/subscription/seats/usage lost required handler anchor: ${anchor}`);
    }
    if (seatUsageRoute.source.includes("requireAuth,")) {
      problems.push("/api/subscription/seats/usage restores requireAuth-only admission.");
    }
  }

  const userDirectoryRoute = routeCall(mainRoutes, "get", "/api/users");
  if (userDirectoryRoute.count !== 1 || !userDirectoryRoute.source) {
    problems.push("route registration must exist exactly once: GET /api/users");
  } else {
    for (const anchor of [
      "requireRole(['recruiter', 'super_admin'])", "requireSeat()", "parseHiringManagerRoleFilter",
      "ROLE_FILTER_REQUIRED", "readAuthorizedHiringManagerDirectory", "allowPlatformAdmin: true",
      "USER_DIRECTORY_UNAVAILABLE", "res.json(result.rows)",
    ]) requireAnchor(problems, userDirectoryRoute.source, anchor, `/api/users lost required handler anchor: ${anchor}`);
    if (/storage\.getUsers|db\.(?:query|select|execute)|\.filter\s*\(/.test(userDirectoryRoute.source)) {
      problems.push("/api/users restores a global or post-read identity filter.");
    }
    const parserAt = userDirectoryRoute.source.indexOf("parseHiringManagerRoleFilter");
    const readerAt = userDirectoryRoute.source.indexOf("readAuthorizedHiringManagerDirectory");
    const responseAt = userDirectoryRoute.source.indexOf("res.json(result.rows)");
    const preReader = parserAt >= 0 && readerAt > parserAt
      ? userDirectoryRoute.source.slice(parserAt, readerAt)
      : "";
    if (parserAt < 0 || readerAt < parserAt || responseAt < readerAt
        || /res\.(?:json|send)\s*\(/.test(preReader)) {
      problems.push("/api/users parser/authorization/response order is unsafe.");
    }
    if (/console\.(?:log|warn|error)/.test(userDirectoryRoute.source)) {
      problems.push("/api/users logs raw directory or database data.");
    }
  }

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

  const primaryCteStart = kernel.indexOf("function authorizedApplicationCte(");
  const resumeCteStart = kernel.indexOf("function authorizedResumeApplicationCte(");
  const primaryCte = primaryCteStart >= 0 && resumeCteStart > primaryCteStart
    ? kernel.slice(primaryCteStart, resumeCteStart)
    : "";
  requireAnchor(problems, kernel, "WITH authorized_application AS", "authorization read lost its protected CTE.");
  const sharedAnchors = [
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
  ];
  for (const [anchor, label] of sharedAnchors) requireAnchor(problems, primaryCte, anchor, label);
  requireAnchor(problems, kernel, "FROM authorized_application", "history is no longer selected through the authorized CTE.");
  if (count(kernel, "FROM authorized_application") !== 6) {
    problems.push("all six protected application readers must read through the authorized CTE.");
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
    "readAuthorizedApplicationResumeFile",
    "readAuthorizedApplicationResumeText",
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

  const resumeFileReader = exportedFunctionSource(kernel, "readAuthorizedApplicationResumeFile");
  for (const anchor of [
    "function authorizedResumeApplicationCte",
    "actor.role = 'candidate'",
    "${applications.userId} = ${actorId}",
    "actor.role = 'hiring_manager'",
    "${jobs.hiringManagerId} = ${actorId}",
    "${allowPlatformAdmin} AND actor.role = 'super_admin'",
    "${applications.resumeUrl} AS resume_url",
    "${applications.resumeFilename} AS resume_filename",
    'authorized_application.application_id AS "applicationId"',
    'authorized_application.organization_id AS "organizationId"',
    'authorized_application.resume_url AS "resumeUrl"',
    'authorized_application.resume_filename AS "resumeFilename"',
  ]) requireAnchor(problems, kernel, anchor, `resume-file authorization anchor is missing: ${anchor}`);
  if (count(resumeFileReader, "db.execute(") !== 1) {
    problems.push("resume-file authorization must execute exactly one database statement.");
  }
  const resumeFileSelect = resumeFileReader.match(
    /SELECT authorized_application\.application_id AS "applicationId"[\s\S]*?FROM authorized_application/,
  )?.[0] ?? "";
  if (/\b(?:JOIN|FROM)\s+\$\{(?:applications|jobs|users)\}/.test(resumeFileSelect)) {
    problems.push("resume-file target fields are re-read outside the authorized CTE.");
  }

  const resumeTextReader = exportedFunctionSource(kernel, "readAuthorizedApplicationResumeText");
  for (const anchor of [
    "${applications.resumeId} AS resume_id",
    "${applications.extractedResumeText} AS application_resume_text",
    "COALESCE(",
    "NULLIF(authorized_application.application_resume_text, '')",
    "NULLIF(${candidateResumes.extractedText}, '')",
    "LEFT JOIN ${candidateResumes}",
    "${candidateResumes.id} = authorized_application.resume_id",
    "text: nullableText(row.text)",
  ]) requireAnchor(problems, resumeTextReader, anchor, `resume-text authorization anchor is missing: ${anchor}`);
  if (count(resumeTextReader, "db.execute(") !== 1) {
    problems.push("resume-text authorization must execute exactly one database statement.");
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

  for (const row of manifestFrozenRouteBlocks(root).filter((entry) =>
    entry.path.includes("whatsapp") || entry.path.includes("webhooks/whatsapp")
  )) {
    const registration = routeCall(whatsappRoutes, row.method, row.path);
    if (registration.count !== 1 || !registration.source) {
      problems.push(`frozen WhatsApp route block is missing: ${row.method.toUpperCase()} ${row.path}`);
    } else if (sha256(registration.source) !== row.sha256) {
      problems.push(`frozen WhatsApp route block drifted: ${row.method.toUpperCase()} ${row.path}`);
    }
  }

  const resumeFileRoute = routeCall(routes, "get", "/api/applications/:id/resume");
  if (resumeFileRoute.count !== 1 || !resumeFileRoute.source) {
    problems.push("route registration must exist exactly once: GET /api/applications/:id/resume");
  } else {
    const handler = resumeFileRoute.source;
    for (const anchor of [
      "requireAuth", "requireSeat()", "parsePositiveDecimalApplicationId", "INVALID_APPLICATION_ID",
      "readAuthorizedApplicationResumeFile", "allowPlatformAdmin: true", "APPLICATION_NOT_FOUND",
      "AUTHORIZATION_UNAVAILABLE", "createResumeAttempt", "downloadBoundApplicationResumeFromGCS",
      "bindResumeResponseTerminal", "RESUME_NOT_AVAILABLE", "RESUME_UNAVAILABLE",
    ]) requireAnchor(problems, handler, anchor, `/api/applications/:id/resume lost required handler anchor: ${anchor}`);
    if (/storage\.(?:getApplication|isRecruiterOnJob)|getUserOrganization|ensureHiringManagerOwnsApplication/.test(handler)) {
      problems.push("/api/applications/:id/resume restores a check-then-read authorization path.");
    }
    if (count(handler, "APPLICATION_NOT_FOUND") !== 2) {
      problems.push("/api/applications/:id/resume must use APPLICATION_NOT_FOUND for both denied actor and denied object.");
    }
    const authorizedAt = handler.indexOf("readAuthorizedApplicationResumeFile");
    const auditAt = handler.indexOf("createResumeAttempt");
    const providerAt = handler.indexOf("downloadBoundApplicationResumeFromGCS");
    if (authorizedAt < 0 || auditAt < authorizedAt || providerAt < auditAt) {
      problems.push("resume-file authorization/audit/provider order is unsafe.");
    }
    if (/console\.(?:log|warn|error)/.test(handler)) {
      problems.push("resume-file route logs target or provider data.");
    }
  }

  const resumeTextRoute = routeCall(resumeRoutes, "get", "/api/applications/:id/resume-text");
  if (resumeTextRoute.count !== 1 || !resumeTextRoute.source) {
    problems.push("route registration must exist exactly once: GET /api/applications/:id/resume-text");
  } else {
    const handler = resumeTextRoute.source;
    for (const anchor of [
      "requireAuth", "requireRole(['recruiter', 'super_admin'])", "requireSeat()",
      "parsePositiveDecimalApplicationId", "readAuthorizedApplicationResumeText",
      "APPLICATION_NOT_FOUND", "AUTHORIZATION_UNAVAILABLE", "RESUME_TEXT_NOT_AVAILABLE",
      "createResumeAccessAttempt", "bindTextResponseTerminal",
    ]) requireAnchor(problems, handler, anchor, `/api/applications/:id/resume-text lost required handler anchor: ${anchor}`);
    if (/downloadFromGCS|extractResumeText|storage\.getApplication|db\.(?:query|select|execute)/.test(handler)) {
      problems.push("resume-text route restores a global or provider-backed read.");
    }
  }

  const retiredPatch = routeCall(routes, "patch", "/api/applications/:id/download");
  if (retiredPatch.count !== 1 || !retiredPatch.source) {
    problems.push("retired resume download-tracking PATCH registration is missing.");
  } else {
    for (const anchor of ["csrfProtection", "requireRole(['recruiter', 'super_admin'])", "requireSeat()", "RESUME_DOWNLOAD_TRACKING_RETIRED"])
      requireAnchor(problems, retiredPatch.source, anchor, `retired PATCH lost required anchor: ${anchor}`);
    if (/storage\.|db\.|parsePositiveDecimalApplicationId/.test(retiredPatch.source)) {
      problems.push("retired resume download-tracking PATCH performs an object read or write.");
    }
  }

  const externalProxy = routeCall(semanticRoutes, "get", "/api/candidates/external-resume");
  if (externalProxy.count !== 1 || !externalProxy.source || !externalProxy.source.includes("EXTERNAL_RESUME_PROXY_RETIRED")) {
    problems.push("external resume proxy is not a fixed retired registration.");
  } else if (/req\.query|downloadFromGCS|getSignedDownloadUrl/.test(externalProxy.source)) {
    problems.push("external resume proxy still consumes a caller locator or provider.");
  }
  if (/\blocator\s*:|getSignedDownloadUrl|generateSignedUrl/.test(semanticRoutes)) {
    problems.push("semantic resume results still emit locators or signed URLs.");
  }
  for (const anchor of ["previewUrl: null", "signedUrl: null", "canOpenResume: false"])
    requireAnchor(problems, semanticRoutes, anchor, `semantic external resume contract lost anchor: ${anchor}`);

  const boundParser = exportedFunctionSource(gcsStorage, "parseBoundApplicationResumeGcsPath");
  const boundDownload = exportedFunctionSource(gcsStorage, "downloadBoundApplicationResumeFromGCS");
  for (const anchor of [
    "GCS_BUCKET_NAME", "GCS_RESUME_CONFIGURATION_UNAVAILABLE", "GCS_RESUME_LOCATOR_REFUSED",
    "^gs:\\/\\/([^/]+)\\/(resumes\\/(.+))$", "match[1] !== configuredBucket",
  ]) requireAnchor(problems, boundParser, anchor, `bound GCS parser lost anchor: ${anchor}`);
  for (const anchor of [
    "parseBoundApplicationResumeGcsPath(gcsPath)", "storage.bucket(bound.bucket)",
    "file(bound.object)", "GCS_RESUME_PROVIDER_UNAVAILABLE",
  ]) requireAnchor(problems, boundDownload, anchor, `bound GCS downloader lost anchor: ${anchor}`);
  if (/storage\.bucket\(match|storage\.bucket\(parsed/.test(boundDownload)) {
    problems.push("bound GCS downloader trusts a parsed caller bucket.");
  }

  if (storage.includes("markApplicationDownloaded")) {
    problems.push("the dishonest resume download writer remains reachable.");
  }
  for (const anchor of [
    "createResumeAccessAttempt", "terminalizeResumeAccessAttempt", "eq(resumeAccessAttempts.status, 'attempted')",
    "input.status !== 'completed'", "attempt.deliveryMode !== 'gcs_stream'",
    "['recruiter', 'hiring_manager'].includes(attempt.actorRole)", "applicationPrivacyAllowed(false)",
  ]) requireAnchor(problems, storage, anchor, `resume audit repository lost anchor: ${anchor}`);

  for (const anchor of [
    "CREATE TABLE public.resume_access_attempts", "attempt_id uuid NOT NULL UNIQUE", "ON DELETE SET NULL",
    "resume_access_attempts_actor_role_check", "resume_access_attempts_delivery_mode_check",
    "resume_access_attempts_status_check", "resume_access_attempts_terminal_check",
    "application_id, attempted_at DESC", "actor_user_id, attempted_at DESC",
  ]) requireAnchor(problems, migration, anchor, `resume audit migration lost anchor: ${anchor}`);
  for (const anchor of [
    'pgTable("resume_access_attempts"', 'uuid("attempt_id").notNull().unique()',
    'index("resume_access_attempts_application_idx")', 'index("resume_access_attempts_actor_idx")',
    '"resume_access_attempts_terminal_check"',
  ]) requireAnchor(problems, schema, anchor, `resume audit Drizzle schema lost anchor: ${anchor}`);
  if (!/^[a-f0-9]{64}$/.test(migrationLock?.migrations?.["0002"] ?? "")) {
    problems.push("resume audit migration is missing from checksums.lock.");
  } else if (sha256(migration) !== migrationLock.migrations["0002"]) {
    problems.push("resume audit migration checksum does not match migration 0002.");
  }
  for (const anchor of ["0002_resume_access_attempts.sql", 'const file = `0009_${name}.sql`', 'applied: ["0000", "0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]'])
    requireAnchor(problems, schemaControlTest, anchor, `schema-control integration lost 2E anchor: ${anchor}`);
  requireAnchor(problems, schemaGuardTest, "0002_resume_access_attempts.sql", "schema guard no longer freezes migration 0002.");

  if (/\/api\/candidates\/external-resume|\blocator\b/.test(candidatesClient)) {
    problems.push("candidate client still constructs an external locator/proxy request.");
  }
  if (!/\/api\/applications\/\$\{[^}]+\.applicationId\}\/resume/.test(candidatesClient)) {
    problems.push("candidate client lost the authorized local application resume route.");
  }
  for (const [file, source] of [["applications-page", applicationsClient], ["application-management-page", managementClient]]) {
    if (/\/api\/applications\/\$\{[^}]+\}\/download/.test(source)) {
      problems.push(`${file} restores the retired download-tracking PATCH.`);
    }
  }
  if (/downloadTracked|Download tracked|Download recorded/.test(internalCopy)) {
    problems.push("client copy still claims human download tracking.");
  }

  requireAnchor(
    problems,
    testConfig,
    "'server/tests/interviewIcsAuthorization.routes.test.ts'",
    "the focused ICS authorization route test is not collected by Vitest.",
  );
}

function validateReviewerShareAuthority(root, problems) {
  const authority = read(root, "server/lib/reviewerShareAuthorization.ts");
  const formsRoutes = read(root, "server/forms.routes.ts");
  const clientRoutes = read(root, "server/clients.routes.ts");
  const invitationRoutes = read(root, "server/hiringManagerInvitations.routes.ts");
  const storage = read(root, "server/storage.ts");
  const schema = read(root, "shared/schema.ts");
  const migration = read(root, "server/schema-migrations/0004_reviewer_share_authority.sql");
  const migrationLock = JSON.parse(read(root, "server/schema-migrations/checksums.lock"));
  const catalog = read(root, "server/schema-migrations/catalog.lock.json");
  const formsClient = read(root, "client/src/pages/admin-forms-page.tsx");
  const managementClient = read(root, "client/src/pages/application-management-page.tsx");
  const shortlistClient = read(root, "client/src/pages/client-shortlist-page.tsx");
  const schemaControlTest = read(root, "server/schema-control/__tests__/schemaControl.pg.test.ts");

  for (const symbol of [
    "createScopedFormTemplate", "listAuthorizedFormTemplates", "readAuthorizedFormTemplate",
    "updateAuthorizedFormTemplate", "deleteAuthorizedFormTemplate", "readAuthorizedResponsesForForm",
    "readPublicClientShortlist", "readPublicResumeLocator", "resolvePublicFeedbackTarget",
    "readAuthorizedClientFeedback", "resolveInvitationIssuerScope",
    "replaceAuthorizedHiringManagerInvitation", "listAuthorizedHiringManagerInvitations",
    "cancelAuthorizedHiringManagerInvitation",
  ]) {
    const source = exportedFunctionSource(authority, symbol);
    if (!source) problems.push(`reviewer/share authorization operation is missing: ${symbol}`);
    else if (count(source, "db.execute(") !== 1) problems.push(`${symbol} must execute exactly one database statement.`);
  }

  for (const anchor of [
    "export function parseReviewerShareId", "export function parseCandidateRef", "export function parseShortlistToken",
    "${forms.ownershipScope} = 'organization'", "${forms.organizationId} IS NOT NULL",
    "${organizationMembers.seatAssigned} = TRUE", "${forms.createdBy} = ${actorId}",
    "${forms.ownershipScope} IN ('personal', 'legacy_private')", "policy.allowPlatformAdmin",
    "WITH authorized_form AS MATERIALIZED", "applicationPrivacyAllowed(false)",
    "${applications.organizationId} = authorized_form.organization_id",
    "${jobs.organizationId} = authorized_form.organization_id",
  ]) requireAnchor(problems, authority, anchor, `reviewer/share authority anchor is missing: ${anchor}`);
  if (count(authority, "${organizationMembers.seatAssigned} = TRUE") !== 5) {
    problems.push("reviewer/share authority anchor is missing: ${organizationMembers.seatAssigned} = TRUE");
  }

  for (const anchor of [
    "${clientShortlistItems.publicRef}::text AS candidate_ref",
    "${clientShortlists.shareResume}", "${clientShortlists.shareAiSummary}",
    "${clientShortlistItems.publicRef} = ${candidateRef}::uuid",
    "${clientShortlists.shareResume} = TRUE", "authorizedApplicationId",
    "${clientFeedback.organizationId} = authorized_application.organization_id",
    "${clientShortlists.organizationId} = authorized_application.organization_id",
  ]) requireAnchor(problems, authority, anchor, `public/client-feedback authority anchor is missing: ${anchor}`);
  if (count(authority, "${clientShortlistItems.publicRef} = ${candidateRef}::uuid") !== 2) {
    problems.push("public/client-feedback authority anchor is missing: ${clientShortlistItems.publicRef} = ${candidateRef}::uuid");
  }

  const publicReader = exportedFunctionSource(authority, "readPublicClientShortlist");
  for (const forbidden of [
    "${applications.email}", "${applications.phone}", "${applications.coverLetter}",
    "${applications.resumeUrl} AS", "${applications.extractedResumeText}",
    "${clientShortlistItems.notes}", "${applications.aiFitScore}",
  ]) {
    if (publicReader.includes(forbidden)) problems.push(`public shortlist restores forbidden projection: ${forbidden}`);
  }

  for (const anchor of [
    "WITH actor_context AS MATERIALIZED", "membership_count = 1", "authorityScope",
    "invalidated AS (", "inserted_invitation AS (", "lower(${email})",
    "${hiringManagerInvitations.authorityScope} = 'organization'",
    "${hiringManagerInvitations.organizationId} = ${issuer.organizationId}",
    "${hiringManagerInvitations.invitedBy} = actor_context.actor_id",
    "${hiringManagerInvitations.status} = 'pending'",
  ]) requireAnchor(problems, authority, anchor, `HM invitation authority anchor is missing: ${anchor}`);
  if (/console\.(?:log|warn|error)|error\?\.message|error\.message/.test(authority)) {
    problems.push("reviewer/share authority logs raw data or errors.");
  }

  const routeContracts = [
    [formsRoutes, "post", "/api/forms/templates", "createScopedFormTemplate"],
    [formsRoutes, "get", "/api/forms/templates", "listAuthorizedFormTemplates"],
    [formsRoutes, "get", "/api/forms/templates/:id", "readAuthorizedFormTemplate"],
    [formsRoutes, "patch", "/api/forms/templates/:id", "updateAuthorizedFormTemplate"],
    [formsRoutes, "delete", "/api/forms/templates/:id", "deleteAuthorizedFormTemplate"],
    [formsRoutes, "get", "/api/forms/:id/responses", "readAuthorizedResponsesForForm"],
    [clientRoutes, "get", "/api/client-shortlist/:token", "readPublicClientShortlist"],
    [clientRoutes, "post", "/api/client-shortlist/:token/feedback", "resolvePublicFeedbackTarget"],
    [clientRoutes, "get", "/api/client-shortlist/:token/resume/:candidateRef", "readPublicResumeLocator"],
    [clientRoutes, "get", "/api/applications/:id/client-feedback", "readAuthorizedClientFeedback"],
    [invitationRoutes, "post", "/api/hiring-manager-invitations", "replaceAuthorizedHiringManagerInvitation"],
    [invitationRoutes, "get", "/api/hiring-manager-invitations", "listAuthorizedHiringManagerInvitations"],
    [invitationRoutes, "delete", "/api/hiring-manager-invitations/:id", "cancelAuthorizedHiringManagerInvitation"],
  ];
  for (const [routes, method, path, operation] of routeContracts) {
    const registration = routeCall(routes, method, path);
    if (registration.count !== 1 || !registration.source) {
      problems.push(`reviewer/share route registration must exist exactly once: ${method.toUpperCase()} ${path}`);
      continue;
    }
    requireAnchor(problems, registration.source, operation, `${path} lost statement-bound command: ${operation}`);
    const withoutApprovedConstantLogs = registration.source
      .replace("console.error('Hiring manager invitation email delivery failed');", "")
      .replace("console.warn('Email service not available. Invitation created but email not sent.');", "");
    if (/console\.(?:log|warn|error)|error\?\.message|error\.message/.test(withoutApprovedConstantLogs)) {
      problems.push(`${path} logs raw reviewer/share data or errors.`);
    }
  }

  for (const [method, path] of [
    ["post", "/api/forms/templates"], ["get", "/api/forms/templates"],
    ["get", "/api/forms/templates/:id"], ["patch", "/api/forms/templates/:id"],
    ["delete", "/api/forms/templates/:id"], ["get", "/api/forms/:id/responses"],
  ]) {
    const source = routeCall(formsRoutes, method, path).source;
    for (const anchor of ["requireRole(['recruiter', 'super_admin'])", "requireSeat()", "AUTHORIZATION_UNAVAILABLE"]) {
      requireAnchor(problems, source, anchor, `${path} lost form route anchor: ${anchor}`);
    }
    if (["post", "patch", "delete"].includes(method)) requireAnchor(problems, source, "csrf", `${path} lost CSRF middleware.`);
  }
  const feedbackRoute = routeCall(clientRoutes, "get", "/api/applications/:id/client-feedback").source;
  for (const anchor of ["requireRole(['recruiter', 'super_admin'])", "requireSeat()", "APPLICATION_NOT_FOUND", "AUTHORIZATION_UNAVAILABLE"]) {
    requireAnchor(problems, feedbackRoute, anchor, `client-feedback route lost anchor: ${anchor}`);
  }
  for (const [method, path] of [
    ["post", "/api/hiring-manager-invitations"], ["get", "/api/hiring-manager-invitations"],
    ["delete", "/api/hiring-manager-invitations/:id"],
  ]) {
    const source = routeCall(invitationRoutes, method, path).source;
    for (const anchor of ["requireRole(['recruiter', 'super_admin'])", "requireSeat()", "INVITATION_NOT_FOUND", "AUTHORIZATION_UNAVAILABLE"]) {
      requireAnchor(problems, source, anchor, `${path} lost HM route anchor: ${anchor}`);
    }
    if (["post", "delete"].includes(method)) requireAnchor(problems, source, "csrfProtection", `${path} lost CSRF middleware.`);
  }

  for (const [source, path] of [
    [formsRoutes, "/api/forms/templates"],
    [clientRoutes, "/api/applications/:id/client-feedback"],
    [invitationRoutes, "/api/hiring-manager-invitations/:id"],
  ]) {
    if (/storage\.(?:getFormTemplate|getFormResponses|updateFormTemplate|deleteFormTemplate|getClientFeedbackForApplication|getHiringManagerInvitationsByInviter|deleteHiringManagerInvitation)\s*\(/.test(source)) {
      problems.push(`${path} restores a target global read or id-only write.`);
    }
  }

  const hmCreate = routeCall(invitationRoutes, "post", "/api/hiring-manager-invitations").source;
  const issuerAt = hmCreate.indexOf("resolveInvitationIssuerScope");
  const userAt = hmCreate.indexOf("storage.getUserByUsername");
  const replaceAt = hmCreate.indexOf("replaceAuthorizedHiringManagerInvitation");
  const firstProviderAt = hmCreate.indexOf("getEmailService");
  const emailAt = hmCreate.lastIndexOf("emailService.sendEmail");
  if (!(issuerAt >= 0 && userAt > issuerAt && replaceAt > userAt
      && firstProviderAt > issuerAt && emailAt > replaceAt)) {
    problems.push("HM issuer/user/replacement/provider order is unsafe.");
  }

  for (const anchor of [
    "CREATE INDEX forms_authority_scope_idx", "ownership_scope = CASE",
    "ADD COLUMN share_resume boolean NOT NULL DEFAULT FALSE",
    "ADD COLUMN share_ai_summary boolean NOT NULL DEFAULT FALSE",
    "ADD COLUMN public_ref uuid NOT NULL DEFAULT gen_random_uuid()",
    "CREATE UNIQUE INDEX client_shortlist_items_public_ref_idx",
    "ADD COLUMN organization_id integer NULL", "SET authority_scope = 'legacy_private'",
    "hiring_manager_invitations_authority_scope_shape_check",
    "CREATE INDEX hm_invitations_authority_issuer_idx", "CREATE INDEX hm_invitations_authority_email_idx",
  ]) requireAnchor(problems, migration, anchor, `reviewer/share migration anchor is missing: ${anchor}`);
  if (!/^[a-f0-9]{64}$/.test(migrationLock?.migrations?.["0004"] ?? "")) {
    problems.push("reviewer/share migration is missing from checksums.lock.");
  } else if (sha256(migration) !== migrationLock.migrations["0004"]) {
    problems.push("reviewer/share migration checksum does not match migration 0004.");
  }
  if (/organization_members|\busers\b|current_user|current membership/i.test(migration)) {
    problems.push("reviewer/share migration infers legacy authority from current identity or membership.");
  }
  if (migrationLock.catalog_lock_sha256 !== sha256(catalog)) problems.push("immutable adoption catalog checksum drifted.");
  for (const anchor of [
    'ownershipScope: text("ownership_scope").notNull()',
    'shareResume: boolean("share_resume").notNull().default(false)',
    'shareAiSummary: boolean("share_ai_summary").notNull().default(false)',
    'publicRef: uuid("public_ref").notNull().defaultRandom()',
    'authorityScope: text("authority_scope").notNull()',
    "candidateRef: z.string().uuid()",
  ]) requireAnchor(problems, schema, anchor, `reviewer/share Drizzle schema anchor is missing: ${anchor}`);

  for (const anchor of [
    'const file = `0009_${name}.sql`', '"0004_reviewer_share_authority.sql"',
    'applied: ["0000", "0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"]',
  ]) requireAnchor(problems, schemaControlTest, anchor, `schema-control integration lost 2I anchor: ${anchor}`);

  requireAnchor(problems, formsClient, "return template.canManage", "forms UI does not consume server-derived canManage.");
  if (formsClient.includes("user?.role === 'super_admin' || template.createdBy === user?.id")) {
    problems.push("forms UI restores creator-id authority inference.");
  }
  for (const anchor of [
    "const [shareShortlistResumes, setShareShortlistResumes] = useState(false)",
    "const [shareShortlistAiSummaries, setShareShortlistAiSummaries] = useState(false)",
    "shareResume: shareShortlistResumes", "shareAiSummary: shareShortlistAiSummaries",
  ]) requireAnchor(problems, managementClient, anchor, `shortlist sharing control is missing: ${anchor}`);
  for (const anchor of [
    "candidateRef: string", "Record<string, CandidateFeedbackState>", "candidate.resumeAvailable",
    "/resume/${candidate.candidateRef}", "candidateRef,",
  ]) requireAnchor(problems, shortlistClient, anchor, `public shortlist client anchor is missing: ${anchor}`);
  for (const forbidden of [
    "candidate.email", "candidate.phone", "candidate.notes", "candidate.coverLetter",
    "candidate.appliedAt", "candidate.resumeUrl", "applicationId: Number",
  ]) if (shortlistClient.includes(forbidden)) problems.push(`public shortlist client restores forbidden field: ${forbidden}`);

  const shortlistCreate = classMethodSource(storage, "createClientShortlist");
  for (const anchor of ["shareResume", "shareAiSummary"]) {
    requireAnchor(problems, shortlistCreate, anchor, `shortlist create plumbing lost ${anchor}.`);
  }
}

function validateScopedFinancialAdminPublicAuthority(root, problems) {
  const authority = read(root, "server/lib/scopedFinancialAdminPublicAuthorization.ts");
  const subscription = read(root, "server/subscription.routes.ts");
  const admin = read(root, "server/admin.routes.ts");
  const routes = read(root, "server/routes.ts");

  const operations = [
    "assignAuthorizedSeat",
    "unassignAuthorizedSeat",
    "listAuthorizedInvoices",
    "readAuthorizedInvoiceById",
    "readAuthorizedInvoiceByFileName",
    "readAuthorizedOrganizationAiActivity",
    "updateAuthorizedUserRole",
  ];
  for (const symbol of operations) {
    const source = exportedFunctionSource(authority, symbol);
    if (!source) problems.push(`2J scoped authority operation is missing: ${symbol}`);
    else if (count(source, "db.execute(") !== 1) problems.push(`${symbol} must execute exactly one database statement.`);
  }
  if (count(authority, "db.execute(") !== operations.length) {
    problems.push("2J scoped authority must contain exactly seven protected statements.");
  }

  for (const [anchor, expected] of [
    ["actor.role = 'recruiter'", 6],
    ["membership.role = 'owner'", 6],
    ["membership.seat_assigned = TRUE", 6],
    ["actor.role = 'super_admin'", 1],
  ]) {
    if (count(authority, anchor) !== expected) problems.push(`2J scoped authority anchor count drifted: ${anchor}`);
  }
  for (const anchor of [
    "actor_context.organization_id = target.organization_id",
    "COALESCE(subscription.seats, 1)",
    "target_context.assigned_seats < target_context.seat_limit",
    "target_context.member_role <> 'owner'",
    "invoice.status = 'completed'",
    "invoice.invoice_number || '.pdf' = ${fileName}",
    "LIMIT ${limit}",
    "usage.organization_id",
    "NOW() - INTERVAL '30 days'",
    "ORDER BY grouped.kind",
    "SET role = ${nextRole}",
    "target.email_verified AS email_verified",
  ]) requireAnchor(problems, authority, anchor, `2J scoped authority anchor is missing: ${anchor}`);
  for (const forbidden of [
    "assignSeat(", "unassignSeat(", "getInvoices(", "getTransactionByCashfreeOrder(",
    "getCreditUsageHistory", "getOrgCreditSummary", "getOrgCreditDetails", "getOrgCreditLedger",
    "console.", "logger.", "req.body", "targetOrganizationId",
  ]) if (authority.includes(forbidden)) problems.push(`2J scoped authority restores forbidden dependency/input/logging: ${forbidden}`);

  const listSource = exportedFunctionSource(authority, "listAuthorizedInvoices");
  for (const forbidden of [
    "invoice.cashfree_order_id", "invoice.cashfree_payment_id", "invoice.metadata", "invoice.failure_reason",
  ]) if (listSource.includes(forbidden)) problems.push(`invoice list restores forbidden financial field: ${forbidden}`);
  const usageSource = exportedFunctionSource(authority, "readAuthorizedOrganizationAiActivity");
  for (const forbidden of [
    "usage.user_id", "usage.cost_usd", "usage.metadata", "usage.id", "application_id", "candidate",
  ]) if (usageSource.includes(forbidden)) problems.push(`organization AI activity restores forbidden detail: ${forbidden}`);
  const roleSource = exportedFunctionSource(authority, "updateAuthorizedUserRole");
  for (const forbidden of [
    "target.password", "verification_token", "password_reset", "onboarding", "provider", ".returning()",
  ]) if (roleSource.includes(forbidden)) problems.push(`role update restores forbidden account field/write: ${forbidden}`);

  const routeContracts = [
    [subscription, "post", "/api/subscription/seats/assign", "assignAuthorizedSeat", ["INVALID_MEMBER_ID", "BILLING_ACCESS_DENIED", "MEMBER_NOT_FOUND", "NO_SEATS_AVAILABLE", "SEAT_COMMAND_UNAVAILABLE"]],
    [subscription, "post", "/api/subscription/seats/unassign", "unassignAuthorizedSeat", ["INVALID_MEMBER_ID", "BILLING_ACCESS_DENIED", "MEMBER_NOT_FOUND", "OWNER_SEAT_REQUIRED", "SEAT_COMMAND_UNAVAILABLE"]],
    [subscription, "get", "/api/subscription/invoices", "listAuthorizedInvoices", ["BILLING_ACCESS_DENIED", "INVOICE_AUTHORIZATION_UNAVAILABLE"]],
    [subscription, "get", "/api/subscription/invoices/:transactionId/pdf", "readAuthorizedInvoiceById", ["INVALID_TRANSACTION_ID", "BILLING_ACCESS_DENIED", "INVOICE_NOT_FOUND", "INVOICE_AUTHORIZATION_UNAVAILABLE"]],
    [subscription, "get", "/api/invoices/:fileName", "readAuthorizedInvoiceByFileName", ["INVALID_INVOICE_FILE_NAME", "BILLING_ACCESS_DENIED", "INVOICE_NOT_FOUND", "INVOICE_AUTHORIZATION_UNAVAILABLE"]],
    [subscription, "get", "/api/ai/credits/usage", "readAuthorizedOrganizationAiActivity", ["BILLING_ACCESS_DENIED", "USAGE_UNAVAILABLE"]],
    [admin, "patch", "/api/admin/users/:id/role", "updateAuthorizedUserRole", ["INVALID_ROLE_UPDATE", "USER_NOT_FOUND", "ROLE_UPDATE_UNAVAILABLE"]],
  ];
  for (const [source, method, path, operation, codes] of routeContracts) {
    const block = routeCall(source, method, path);
    if (block.count !== 1 || !block.source) {
      problems.push(`2J protected route is missing or duplicated: ${method.toUpperCase()} ${path}`);
      continue;
    }
    requireAnchor(problems, block.source, operation, `${method.toUpperCase()} ${path} lost statement-bound operation ${operation}.`);
    for (const code of codes) requireAnchor(problems, block.source, code, `${method.toUpperCase()} ${path} lost fixed response code ${code}.`);
    if (/console\.(?:log|warn|error)\s*\(\s*(?:error|req\.|result|memberId|transactionId|fileName)/.test(block.source)) {
      problems.push(`${method.toUpperCase()} ${path} logs protected identity, financial, path or raw-error data.`);
    }
  }

  const assign = routeCall(subscription, "post", "/api/subscription/seats/assign").source;
  const unassign = routeCall(subscription, "post", "/api/subscription/seats/unassign").source;
  for (const [block, operation, sideEffect] of [
    [assign, "assignAuthorizedSeat", "initializeMemberCredits"],
    [unassign, "unassignAuthorizedSeat", "getEmailService"],
  ]) {
    if (block.indexOf(operation) < 0 || block.indexOf("if (result.value.changed)") < block.indexOf(operation)
        || block.indexOf(sideEffect) < block.indexOf("if (result.value.changed)")) {
      problems.push(`${operation} side effects are not ordered after an authorized changed result.`);
    }
    for (const forbidden of ["assignSeat(", "unassignSeat(", "getUserOrganization(", "canManageBilling(", "req.body.organizationId"]) {
      if (block.includes(forbidden)) problems.push(`${operation} restores caller-org or global seat authority: ${forbidden}`);
    }
  }

  const pdf = routeCall(subscription, "get", "/api/subscription/invoices/:transactionId/pdf").source;
  const localFile = routeCall(subscription, "get", "/api/invoices/:fileName").source;
  for (const [block, operation] of [[pdf, "readAuthorizedInvoiceById"], [localFile, "readAuthorizedInvoiceByFileName"]]) {
    const authorization = block.indexOf(operation);
    for (const work of ["generateAndStoreInvoicePdf", "getLocalInvoicePath", "sendFile", "res.redirect"]) {
      const index = block.indexOf(work);
      if (index >= 0 && index < authorization) problems.push(`${operation} reaches invoice provider/file work before exact authorization.`);
    }
    for (const forbidden of ["getInvoices(", "getTransactionByCashfreeOrder(", "req.params.organizationId"]) {
      if (block.includes(forbidden)) problems.push(`${operation} restores global/list/caller invoice authorization: ${forbidden}`);
    }
  }
  requireAnchor(problems, pdf, "redirectUrl.protocol !== 'https:'", "invoice redirect lost HTTPS-only enforcement.");
  requireAnchor(problems, pdf, "redirectUrl.username || redirectUrl.password", "invoice redirect permits credentialed locators.");

  const invoiceList = routeCall(subscription, "get", "/api/subscription/invoices").source;
  if (invoiceList.includes("invoiceUrl") || invoiceList.includes("getInvoices(")) {
    problems.push("invoice list route restores stored locators or newest-list authorization.");
  }
  const usage = routeCall(subscription, "get", "/api/ai/credits/usage").source;
  for (const forbidden of ["getCreditUsageHistory", "getOrgCreditSummary", "getOrgCreditDetails", "getOrgCreditLedger", "req.query"]) {
    if (usage.includes(forbidden)) problems.push(`AI activity route restores private/unbounded usage access: ${forbidden}`);
  }
  const orderStatus = routeCall(subscription, "get", "/api/subscription/order/:orderId/status").source;
  requireAnchor(problems, orderStatus, "downloadPath:", "order status lost its authenticated invoice path.");
  if (orderStatus.includes("invoiceUrl:")) problems.push("order status serializes a stored invoice locator.");

  const roleRoute = routeCall(admin, "patch", "/api/admin/users/:id/role").source;
  for (const anchor of ["csrfProtection", "requireRole(['super_admin'])", "parseScopedFinancialId", "parseAuthorizedUserRole", "res.json(result.value)"]) {
    requireAnchor(problems, roleRoute, anchor, `role route lost minimum command anchor: ${anchor}`);
  }
  for (const forbidden of ["storage.updateUserRole", "res.json({ ...", "res.json(user)"]) {
    if (roleRoute.includes(forbidden)) problems.push(`role route restores global/full-row response: ${forbidden}`);
  }

  const tombstones = [
    [admin, "get", "/api/admin/applications/all", "ADMIN_APPLICATION_COLLECTION_RETIRED", "requireRole(['super_admin'])"],
    [admin, "get", "/api/admin/consultants", "CONSULTANT_PRODUCT_RETIRED", "requireRole(['super_admin'])"],
    [admin, "post", "/api/admin/consultants", "CONSULTANT_PRODUCT_RETIRED", "csrfProtection"],
    [admin, "patch", "/api/admin/consultants/:id", "CONSULTANT_PRODUCT_RETIRED", "csrfProtection"],
    [admin, "delete", "/api/admin/consultants/:id", "CONSULTANT_PRODUCT_RETIRED", "csrfProtection"],
    [routes, "get", "/api/consultants", "CONSULTANT_PRODUCT_RETIRED", "res.status(410)"],
    [routes, "get", "/api/consultants/:id", "CONSULTANT_PRODUCT_RETIRED", "res.status(410)"],
  ];
  for (const [source, method, path, code, middleware] of tombstones) {
    const block = routeCall(source, method, path);
    if (block.count !== 1 || !block.source) {
      problems.push(`2J retired route is missing or duplicated: ${method.toUpperCase()} ${path}`);
      continue;
    }
    for (const anchor of ["res.status(410)", code, middleware]) {
      requireAnchor(problems, block.source, anchor, `${method.toUpperCase()} ${path} lost fixed tombstone anchor: ${anchor}`);
    }
    for (const forbidden of ["storage.", "db.", "fetch(", "sendFile", "req.params", "req.body"]) {
      if (block.source.includes(forbidden)) problems.push(`${method.toUpperCase()} ${path} tombstone restores work: ${forbidden}`);
    }
  }

  for (const absolute of walk(join(root, "server"))) {
    if (!absolute.endsWith(".ts")) continue;
    const file = relative(root, absolute).replaceAll("\\", "/");
    if (file !== "server/storage.ts" && readFileSync(absolute, "utf8").includes("getAllApplicationsWithDetails")) {
      problems.push(`retired admin application collection has a production caller: ${file}`);
    }
  }

  for (const deleted of [
    "client/src/pages/unified-admin-dashboard.tsx",
    "client/src/pages/admin-consultants-page.tsx",
  ]) if (existsSync(join(root, deleted))) problems.push(`retired client artifact still exists: ${deleted}`);

  let client = "";
  for (const absolute of walk(join(root, "client", "src"))) {
    if (/\.(?:ts|tsx)$/.test(absolute)) client += `\n${readFileSync(absolute, "utf8")}`;
  }
  for (const forbidden of [
    "/api/admin/applications/all", "/api/admin/consultants", "/api/consultants", 'path="/consultants"',
    "admin-consultants-page", "unified-admin-dashboard", "invoice.invoiceUrl",
  ]) if (client.includes(forbidden)) problems.push(`client restores retired/private surface: ${forbidden}`);

  const dashboard = read(root, "client/src/pages/admin-super-dashboard.tsx");
  for (const forbidden of [
    "ApplicationWithDetails", "selectedApplication", "filteredApplications", 'value="applications"',
    "applicationPrivacyAnchor", "updateApplicationMutation",
  ]) if (dashboard.includes(forbidden)) problems.push(`admin dashboard restores application collection/detail state: ${forbidden}`);
  const billing = read(root, "client/src/pages/org-billing-page.tsx");
  for (const anchor of ["useInvoices(isOwner)", "useAiCreditUsage(isOwner)", "invoice.downloadPath"]) {
    requireAnchor(problems, billing, anchor, `billing UI lost minimum owner-scoped contract: ${anchor}`);
  }
  for (const forbidden of ["invoice.invoiceUrl", "getCreditUsageHistory", "costUsd", "candidateEmail"]) {
    if (billing.includes(forbidden)) problems.push(`billing UI restores private invoice/usage detail: ${forbidden}`);
  }
}

function validateTalentPoolAuthority(root, problems) {
  const authority = read(root, "server/lib/talentPoolAuthorization.ts");
  const routes = read(root, "server/talent-pool.routes.ts");
  const operations = [
    "listAuthorizedTalentPoolCandidates",
    "readAuthorizedTalentPoolCandidate",
    "readAuthorizedTalentPoolCreateContext",
    "createAuthorizedTalentPoolCandidate",
    "updateAuthorizedTalentPoolCandidate",
    "removeAuthorizedTalentPoolCandidate",
    "restoreAuthorizedTalentPoolCandidate",
  ];
  if (count(authority, "db.execute(") !== operations.length) {
    problems.push("talent-pool authority must contain exactly seven statement-bound commands.");
  }
  for (const operation of operations) {
    const source = exportedFunctionSource(authority, operation);
    if (!source || count(source, "db.execute(") !== 1) {
      problems.push(`talent-pool operation is not exactly one statement: ${operation}`);
    }
  }

  for (const anchor of [
    "actor.role = 'recruiter'",
    "membership.seat_assigned = TRUE",
    "HAVING COUNT(*) = 1",
    "pool.organization_id IS NOT NULL",
    "privacyAllowedSql(\"talent_pool\", \"pool.id\", { globalUse: false })",
    "actor_grant.organization_id = pool.organization_id",
    "stored_actor.actor_role = 'super_admin'",
    "INSERT INTO ${talentPoolMembershipEvents}",
    "'removed', 'organization_pool_removal'",
    "'restored', 'operator_restore'",
  ]) requireAnchor(problems, authority, anchor, `talent-pool authority lost invariant: ${anchor}`);
  for (const forbidden of [
    "allowNoOrg", "globalUse: true", "LIMIT 1", "pool.recruiter_id =", "pool.recruiterId",
    "organizationId:", "console.", "logger.", "storage.",
  ]) if (authority.includes(forbidden)) problems.push(`talent-pool authority restores forbidden pattern: ${forbidden}`);
  if (count(authority, "AND ${PRIVACY_ALLOWED}") !== 5) {
    problems.push("talent-pool active object/list operations must apply exactly five SQL privacy fences.");
  }

  const listSource = exportedFunctionSource(authority, operations[0]);
  if (listSource.indexOf("AND ${PRIVACY_ALLOWED}") < 0
      || listSource.indexOf("AND ${PRIVACY_ALLOWED}") > listSource.indexOf("ORDER BY authorized_candidate")) {
    problems.push("talent-pool list privacy fence must precede deterministic ordering.");
  }
  const listAndCreate = `${listSource}\n${exportedFunctionSource(authority, operations[2])}\n${exportedFunctionSource(authority, operations[3])}`;
  if (listAndCreate.includes("allowPlatformAdmin") || listAndCreate.includes("super_admin")) {
    problems.push("talent-pool collection/create restores platform scope.");
  }

  const projection = /export interface TalentPoolCandidateProjection\s*\{([\s\S]*?)\n\}/.exec(authority)?.[1] ?? "";
  const projectionKeys = [...projection.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
  const expectedProjection = [
    "id", "name", "email", "phone", "source", "notes", "resumeUrl", "createdAt", "updatedAt",
  ];
  if (JSON.stringify(projectionKeys) !== JSON.stringify(expectedProjection)) {
    problems.push(`talent-pool candidate projection drifted: ${projectionKeys.join(",")}`);
  }
  for (const forbidden of [
    "organizationId", "recruiterId", "formResponseId", "removedAt", "removedByUserId", "removalReason",
  ]) if (projection.includes(forbidden)) problems.push(`talent-pool public projection exposes ${forbidden}.`);

  const update = exportedFunctionSource(authority, "updateAuthorizedTalentPoolCandidate");
  for (const anchor of [
    "validEffectivePatch(patch)",
    "SET name = CASE WHEN",
    "email = CASE WHEN",
    "phone = CASE WHEN",
    "notes = CASE WHEN",
    "resume_url = CASE WHEN",
    "updated_at = NOW()",
  ]) requireAnchor(problems, update, anchor, `talent-pool update lost allowlist/effective-patch invariant: ${anchor}`);
  for (const forbidden of ["form_response_id", "SET organization_id", "organization_id = CASE", "recruiter_id = CASE", "SET recruiter_id"] ) {
    if (update.includes(forbidden)) problems.push(`talent-pool update expands F290/authority scope: ${forbidden}`);
  }

  for (const [operation, eventType] of [
    ["removeAuthorizedTalentPoolCandidate", "'removed'"],
    ["restoreAuthorizedTalentPoolCandidate", "'restored'"],
  ]) {
    const source = exportedFunctionSource(authority, operation);
    if (count(source, "INSERT INTO ${talentPoolMembershipEvents}") !== 1 || !source.includes(eventType)) {
      problems.push(`talent-pool ${operation} lost its atomic membership event.`);
    }
  }

  const managementEnd = routes.indexOf("POST /api/talent-pool/:id/convert");
  const management = managementEnd > 0 ? routes.slice(0, managementEnd) : "";
  if (count(management, "requireSeat()") !== 6 || management.includes("allowNoOrg")) {
    problems.push("all six talent-pool management routes require strict seat middleware.");
  }
  for (const legacy of [
    "storage.getTalentPoolByRecruiter", "storage.getTalentPoolCandidate", "storage.getRemovedTalentPoolCandidate",
    "storage.getTalentPoolByEmail", "storage.createTalentPoolCandidate", "storage.updateTalentPoolCandidate",
    "storage.removeTalentPoolCandidate", "storage.restoreTalentPoolCandidate",
  ]) if (management.includes(legacy)) problems.push(`talent-pool management route restores id/recruiter storage path: ${legacy}`);
  for (const anchor of [
    "createTalentPoolCandidateSchema", "updateTalentPoolCandidateSchema", ").strict()",
    "parseTalentPoolId(req.params.id)", "TALENT_POOL_UPDATE_REQUIRED",
    "INVALID_TALENT_POOL_ID", "TALENT_POOL_ACCESS_DENIED", "TALENT_POOL_CANDIDATE_NOT_FOUND",
    "TALENT_POOL_CANDIDATE_EXISTS", "TALENT_POOL_AUTHORIZATION_UNAVAILABLE",
    "requireNewCandidateIdentityAllowed", "Object.keys(patch).length === 0",
  ]) requireAnchor(problems, management, anchor, `talent-pool routes lost invariant: ${anchor}`);
  for (const forbidden of ["existingId", "parseInt(req.params.id", "Number(req.params.id)"]) {
    if (management.includes(forbidden)) problems.push(`talent-pool management route restores oracle/permissive input: ${forbidden}`);
  }
  const createContextAt = management.indexOf("readAuthorizedTalentPoolCreateContext(req.user!.id)");
  const createPrivacyAt = management.indexOf("await requireNewCandidateIdentityAllowed", createContextAt);
  const createWriteAt = management.indexOf("createAuthorizedTalentPoolCandidate(req.user!.id", createPrivacyAt);
  if (!(createContextAt >= 0 && createContextAt < createPrivacyAt && createPrivacyAt < createWriteAt)) {
    problems.push("talent-pool create must authorize before privacy and reauthorize in its final write.");
  }
  const updateContextAt = management.indexOf("readAuthorizedTalentPoolCandidate(req.user!.id, candidateId");
  const updatePrivacyAt = management.indexOf("await requireNewCandidateIdentityAllowed", updateContextAt);
  const updateWriteAt = management.indexOf("updateAuthorizedTalentPoolCandidate(", updatePrivacyAt);
  if (!(updateContextAt >= 0 && updateContextAt < updatePrivacyAt && updatePrivacyAt < updateWriteAt)) {
    problems.push("talent-pool identity update must authorize before privacy and reauthorize in its final write.");
  }

  for (const [method, path, expected] of [
    ["post", "/api/talent-pool/:id/convert", "50709054de9122d6ade65822d15a059cd35df2d41491c524c7f6cd1f5484a090"],
    ["get", "/api/jobs/:jobId/talent-pool/suggestions", "56d2ddc38fb60c5074318aa501457e97933a0e83face6472b80cfed45f629363"],
  ]) {
    const block = routeCall(routes, method, path);
    if (block.count !== 1 || sha256(block.source) !== expected) {
      problems.push(`frozen talent-pool route drifted: ${method.toUpperCase()} ${path}`);
    }
  }
}

function validatePrivilegeGrantRevocation(root, problems) {
  const authority = read(root, "server/lib/privilegeGrantRevocation.ts");
  const auth = read(root, "server/auth.ts");
  const routes = read(root, "server/organization.routes.ts");
  const service = read(root, "server/lib/organizationService.ts");
  const schema = read(root, "shared/schema.ts");
  const migration = read(root, "server/schema-migrations/0005_privilege_authorization_version.sql");
  const migrationLock = JSON.parse(read(root, "server/schema-migrations/checksums.lock"));
  const catalog = read(root, "server/schema-migrations/catalog.lock.json");

  for (const forbidden of [
    "LIMIT 1", "allowNoOrg", "DELETE FROM session", "DELETE FROM public.session",
    "updateMemberRole(", "removeMember(", "reassignJobs(", "authVersion: req.",
  ]) {
    if (authority.includes(forbidden)) problems.push(`privilege authority restores forbidden pattern: ${forbidden}`);
  }

  for (const anchor of [
    "HAVING COUNT(*) = 1",
    "membership.seat_assigned = TRUE",
    "actor.role = 'recruiter'",
    "target.role <> 'owner'",
    "auth_version = target_user.auth_version + 1",
    "job.organization_id = actor_context.organization_id",
    "target_member.seat_assigned = TRUE",
    "auth_version = auth_version + 1",
  ]) requireAnchor(problems, authority, anchor, `privilege authority anchor is missing: ${anchor}`);
  if (count(authority, "auth_version = target_user.auth_version + 1") !== 2) {
    problems.push("member removal and role change must each advance the target authorization version.");
  }

  for (const symbol of [
    "removeOrganizationMemberAndRevoke",
    "changeOrganizationMemberRoleAndRevoke",
    "reassignOrganizationJobs",
    "resetPasswordAndAdvanceAuthorization",
  ]) {
    const source = exportedFunctionSource(authority, symbol);
    if (!source) problems.push(`privilege authority operation is missing: ${symbol}`);
    else if (count(source, "db.execute(") !== 1) {
      problems.push(`privilege authority operation is not exactly one statement: ${symbol}`);
    }
  }
  if (count(authority, "db.execute(") !== 4) {
    problems.push("privilege authority must contain exactly four statement-bound commands.");
  }

  for (const anchor of [
    "createAuthorizationSessionPayload(user)",
    "parseAuthorizationSessionPayload(payload)",
    "user.authVersion !== serialized.authVersion",
    "done(null, false)",
    "resetPasswordAndAdvanceAuthorization(",
    "storage.clearPasswordResetToken(user.id)",
  ]) requireAnchor(problems, auth, anchor, `authorization session/reset anchor is missing: ${anchor}`);
  for (const anchor of [
    "return { id: user.id, authVersion: user.authVersion }",
    "return { id: value, authVersion: 1 }",
    'keys.length !== 2 || keys[0] !== "authVersion" || keys[1] !== "id"',
  ]) requireAnchor(problems, authority, anchor, `authorization session payload anchor is missing: ${anchor}`);
  if (auth.includes("passport.serializeUser((user, done) => done(null, user.id))")
      || /passport\.deserializeUser\(async \(id: number/.test(auth)
      || /DELETE\s+FROM\s+(?:public\.)?session/i.test(auth)) {
    problems.push("authorization session compatibility restores bare-id or destructive revocation.");
  }
  const reset = routeCall(auth, "post", "/api/reset-password");
  const passwordAt = reset.source.indexOf("resetPasswordAndAdvanceAuthorization(");
  const clearAt = reset.source.indexOf("storage.clearPasswordResetToken(user.id)", passwordAt);
  if (reset.count !== 1 || passwordAt < 0 || clearAt <= passwordAt
      || reset.source.includes("storage.updateUserPassword(")) {
    problems.push("password reset must advance authorization with the password before separate token clearing.");
  }
  if (/\b(?:authVersion|password|session)\s*:/.test(reset.source)) {
    problems.push("password reset exposes password/session/version state.");
  }

  const create = routeCall(routes, "post", "/api/organizations");
  if (create.count !== 1
      || !create.source.includes("requireAuth, requireRole(['recruiter']), csrfProtection")
      || create.source.includes("isUserInOrganization(")
      || !create.source.includes("createOrganization(validatedData, user.id)")) {
    problems.push("organization creation lost stored recruiter admission or restored a pre-read grant.");
  }
  if (create.source.includes("res.status(201).json(org)")) {
    problems.push("organization creation exposes internal authority provenance.");
  }

  for (const [method, path, operation] of [
    ["delete", "/api/organizations/members/:id", "removeOrganizationMemberAndRevoke"],
    ["patch", "/api/organizations/members/:id/role", "changeOrganizationMemberRoleAndRevoke"],
    ["post", "/api/organizations/members/:id/reassign", "reassignOrganizationJobs"],
  ]) {
    const block = routeCall(routes, method, path);
    if (block.count !== 1 || !block.source.includes("parsePrivilegeGrantId(req.params.id)")
        || !block.source.includes(`${operation}(user.id`)) {
      problems.push(`privilege route lost strict statement-bound adoption: ${method.toUpperCase()} ${path}`);
    }
    for (const legacy of ["getUserOrganization(", "getOrganizationMember(", "updateMemberRole(", "removeMember(", "reassignJobs("]) {
      if (block.source.includes(legacy)) problems.push(`privilege route restores split/global helper: ${legacy}`);
    }
  }

  const createService = exportedFunctionSource(service, "createOrganization");
  for (const anchor of [
    ".for('update')", "storedUser.role !== 'recruiter'", "storedUser.emailVerified !== true",
    "existingMemberships.length !== 0", "existingSelfServiceOrganizations.length !== 0",
    "authorityOrigin: 'self_service_recruiter'", "selfCreatedByUserId: ownerId",
  ]) requireAnchor(problems, createService, anchor, `organization creation service anchor is missing: ${anchor}`);
  if (createService.includes("...data")) problems.push("organization creation accepts caller-supplied authority fields.");

  for (const anchor of [
    'authVersion: integer("auth_version").notNull().default(1)',
    'authorityOrigin: text("authority_origin")',
    'selfCreatedByUserId: integer("self_created_by_user_id")',
    'users_auth_version_positive_check',
    'organizations_authority_origin_shape_check',
    'organizations_self_service_creator_idx',
  ]) requireAnchor(problems, schema, anchor, `2L-A schema model anchor is missing: ${anchor}`);
  for (const anchor of [
    "ADD COLUMN auth_version integer NOT NULL DEFAULT 1",
    "CHECK (auth_version > 0)",
    "SET authority_origin = 'legacy_unknown'",
    "self_created_by_user_id = NULL",
    "organizations_authority_origin_shape_check",
    "organizations_self_service_creator_idx",
    "WHERE authority_origin = 'self_service_recruiter'",
  ]) requireAnchor(problems, migration, anchor, `2L-A migration anchor is missing: ${anchor}`);
  if (!/^[a-f0-9]{64}$/.test(migrationLock?.migrations?.["0005"] ?? "")) {
    problems.push("2L-A migration is missing from checksums.lock.");
  } else if (sha256(migration) !== migrationLock.migrations["0005"]) {
    problems.push("2L-A migration checksum does not match migration 0005.");
  }
  if (migrationLock.catalog_lock_sha256 !== sha256(catalog)) {
    problems.push("immutable adoption catalog checksum drifted.");
  }
  if (/UPDATE\s+public\.(?:users|organization_members|session)\b/i.test(migration)
      || /DELETE\s+FROM/i.test(migration)) {
    problems.push("2L-A migration rewrites privilege/session rows.");
  }
  if (/organization_members|current_user|current membership/i.test(migration)) {
    problems.push("2L-A migration infers organization provenance from current identity or membership.");
  }
}

function validateVersionedInvitationGrants(root, problems) {
  const authority = read(root, "server/lib/versionedInvitationGrantAuthorization.ts");
  const routes = read(root, "server/organization.routes.ts");
  const service = read(root, "server/lib/organizationService.ts");
  const auth = read(root, "server/auth.ts");
  const directory = read(root, "server/lib/membershipScopedReadAuthorization.ts");
  const schema = read(root, "shared/schema.ts");
  const migration = read(root, "server/schema-migrations/0006_versioned_invitation_grants.sql");
  const migrationLock = JSON.parse(read(root, "server/schema-migrations/checksums.lock"));

  for (const [symbol, statement] of [
    ["createOrResendOrganizationInvite", "db.execute("],
    ["listOrganizationInvites", "db.execute("],
    ["readOrganizationInvitePreview", "db.execute("],
    ["cancelOrganizationInvite", "db.execute("],
    ["readHiringManagerRegistrationGrant", "db.execute("],
    ["acceptHiringManagerRegistrationGrant", "db.execute("],
  ]) {
    const source = exportedFunctionSource(authority, symbol);
    if (!source || count(source, statement) !== 1) {
      problems.push(`versioned invitation operation is not exactly one statement: ${symbol}`);
    }
  }
  const accept = exportedFunctionSource(authority, "acceptOrganizationInvite");
  if (count(accept, "db.transaction(") !== 1 || count(accept, "tx.execute(") !== 1
      || /backfill|repair|reconcile|attribut|mergeDuplicatePipelineStages/i.test(accept)) {
    problems.push("organization invitation acceptance must use one transaction and one state/member statement with no legacy-attribution callback.");
  }

  for (const anchor of [
    "HAVING COUNT(*) = 1",
    "membership.seat_assigned = TRUE",
    "membership.role IN ('owner', 'admin')",
    "invitation.token = ${tokenHash}",
    "invitation.state = 'pending'",
    "invitation.version = target.version",
    "invitation.expires_at > now()",
    "state = 'superseded'",
    "state = 'cancelled'",
    "state = 'accepted'",
    "accepted_by = account.id",
    "INSERT INTO ${organizationMembers}",
    "account.email_verified = TRUE",
    "LOWER(account.username) = LOWER(presented.email)",
    "accepted_by_user_id = account.id",
    "invitation.grant_version = ${grantVersion}",
    "account.role = 'hiring_manager'",
    "accepted_history AS MATERIALIZED",
    "WHEN EXISTS (SELECT 1 FROM accepted_history) THEN 'accepted_history'",
  ]) requireAnchor(problems, authority, anchor, `versioned invitation authority anchor is missing: ${anchor}`);
  for (const forbidden of [
    "parseInt(", "allowNoOrg", "deleteOrganizationInvite", "getOrganizationInviteByToken",
    "createOrganizationInvite(", "cancelOrganizationInviteById", "console.", "logger.",
  ]) if (authority.includes(forbidden)) problems.push(`versioned invitation authority restores forbidden pattern: ${forbidden}`);
  if (!authority.includes("createHash(\"sha256\").update(canonical).digest(\"hex\")")
      || /invitation\.token\s*=\s*\$\{token\}(?!Hash)/.test(authority)) {
    problems.push("versioned invitation token lookup is not strict SHA-256-only.");
  }
  const issuerProjection = authority.slice(
    authority.indexOf("export interface OrganizationInviteIssuerProjection"),
    authority.indexOf("export interface OrganizationInviteDeliveryContext"),
  );
  const previewProjection = authority.slice(
    authority.indexOf("export interface OrganizationInvitePreviewProjection"),
    authority.indexOf("export interface AcceptedOrganizationMembershipProjection"),
  );
  for (const forbidden of ["token", "version", "organizationId", "invitedBy", "cancelledAt", "supersededAt"]) {
    if (issuerProjection.includes(forbidden) || previewProjection.includes(forbidden)) {
      problems.push(`versioned invitation public projection exposes ${forbidden}.`);
    }
  }
  for (const removed of [
    "createOrganizationInvite", "getOrganizationInviteByToken", "getPendingInvitesForOrganization",
    "acceptOrganizationInvite", "cancelOrganizationInvite",
  ]) {
    if (exportedFunctionSource(service, removed)) problems.push(`vulnerable organization invitation service remains exported: ${removed}`);
  }

  const routeContracts = [
    ["post", "/api/organizations/members/invite", "createOrResendOrganizationInvite"],
    ["get", "/api/organizations/invites", "listOrganizationInvites"],
    ["delete", "/api/organizations/invites/:id", "cancelOrganizationInvite"],
    ["get", "/api/invites/:token", "readOrganizationInvitePreview"],
    ["post", "/api/invites/:token/accept", "acceptOrganizationInvite"],
  ];
  for (const [method, path, operation] of routeContracts) {
    const block = routeCall(routes, method, path);
    if (block.count !== 1 || !block.source.includes(`${operation}(`)) {
      problems.push(`versioned invitation route lost protected operation: ${method.toUpperCase()} ${path}`);
    }
    for (const legacy of ["getOrganizationInviteByToken(", "createOrganizationInvite(", "acceptOrganizationInviteById(", "parseInt("]) {
      if (block.source.includes(legacy)) problems.push(`versioned invitation route restores legacy/global behavior: ${legacy}`);
    }
  }
  const create = routeCall(routes, "post", "/api/organizations/members/invite").source;
  const authorizeAt = create.indexOf("createOrResendOrganizationInvite(");
  const providerAt = create.indexOf(".sendEmail(");
  const responseAt = create.indexOf("res.status(201).json(invite.value)");
  if (!create.includes('randomBytes(32).toString("hex")')
      || !create.includes("hashVersionedInvitationToken(plaintextToken)")
      || !(authorizeAt >= 0 && authorizeAt < providerAt && providerAt < responseAt)
      || create.includes("json(invite)") || create.includes("json(plaintextToken)")) {
    problems.push("organization invite create/hash/commit/provider/projection order is unsafe.");
  }
  if (/console\.\w+\([^)]*plaintextToken/.test(create)) {
    problems.push("organization invite route logs the plaintext bearer.");
  }
  const cancel = routeCall(routes, "delete", "/api/organizations/invites/:id").source;
  if (!cancel.includes("parseVersionedInvitationId(req.params.id)")) {
    problems.push("organization invitation cancellation lost the strict id parser.");
  }
  for (const [method, path] of [["get", "/api/invites/:token"], ["post", "/api/invites/:token/accept"]]) {
    if (!routeCall(routes, method, path).source.includes("parseVersionedInvitationToken(token)")) {
      problems.push(`${method.toUpperCase()} ${path} lost strict token parsing.`);
    }
  }

  const register = routeCall(auth, "post", "/api/register").source;
  for (const forbidden of ["getOrganizationInviteByToken", "verifyUserEmail(user.id)", "req.login(user"]) {
    if (register.includes(forbidden)) problems.push(`organization registration restores bearer-to-account authority: ${forbidden}`);
  }
  for (const anchor of [
    "storage.setVerificationToken(user.id, hash, expires)",
    "sendVerificationEmail(username, token, firstName, inviteToken)",
    "readHiringManagerRegistrationGrant(invitationToken)",
    "acceptHiringManagerRegistrationGrant(",
  ]) requireAnchor(problems, register, anchor, `registration invitation anchor is missing: ${anchor}`);

  for (const anchor of [
    "hiringManagerInvitations.authorityScope} = 'organization'",
    "hiringManagerInvitations.organizationId} = actor_context.organization_id",
    "hiringManagerInvitations.status} = 'accepted'",
    "hiringManagerInvitations.acceptedByUserId} = hiring_manager.id",
    "hiringManagerInvitations.revokedAt} IS NULL",
  ]) requireAnchor(problems, directory, anchor, `HM accepted-user provenance anchor is missing: ${anchor}`);
  for (const forbidden of ["hiringManagerInvitations.invitedBy", "inviter_membership", "hiringManagerInvitations.email} = hiring_manager.username"]) {
    if (directory.includes(forbidden)) problems.push(`HM directory restores inferred invitation provenance: ${forbidden}`);
  }

  for (const anchor of [
    'state: text("state").notNull()', 'version: integer("version").notNull().default(1)',
    'acceptedByUserId: integer("accepted_by_user_id")', 'grantVersion: integer("grant_version").notNull().default(1)',
    'organization_invites_state_shape_check', 'hiring_manager_invitations_accepted_user_shape_check',
    'org_invites_pending_email_idx', 'hm_invitations_eligibility_idx',
  ]) requireAnchor(problems, schema, anchor, `2L-B schema model anchor is missing: ${anchor}`);
  for (const anchor of [
    "sha256(convert_to(token, 'UTF8'))", "ELSE 'legacy_revoked'", "ALTER COLUMN state SET NOT NULL",
    "organization_invites_state_shape_check", "org_invites_pending_email_idx",
    "accepted_by_user_id = unique_hiring_manager.user_id", "HAVING count(*) = 1",
    "hiring_manager_invitations_accepted_user_shape_check", "hm_invitations_eligibility_idx",
  ]) requireAnchor(problems, migration, anchor, `2L-B migration anchor is missing: ${anchor}`);
  if (/organization_members|inviter_membership|\bjobs\b|email_domain|current membership/i.test(migration)) {
    problems.push("2L-B migration infers invitation authority from current mutable relationships.");
  }
  if (!/^[a-f0-9]{64}$/.test(migrationLock?.migrations?.["0006"] ?? "")) {
    problems.push("2L-B migration is missing from checksums.lock.");
  } else if (sha256(migration) !== migrationLock.migrations["0006"]) {
    problems.push("2L-B migration checksum does not match migration 0006.");
  }
}

function validateUnsafeOrgAttributionRetirement(root, problems) {
  const admin = read(root, "server/admin.routes.ts");
  const cli = read(root, "server/scripts/backfill-org-ids.ts");
  const service = read(root, "server/lib/organizationService.ts");
  const invitation = read(root, "server/lib/versionedInvitationGrantAuthorization.ts");
  const tombstone = routeCall(admin, "post", "/api/admin/ops/backfill-org-ids");
  const expectedCli = 'const CODE = "ORG_ATTRIBUTION_REPAIR_RETIRED";\n\n'
    + 'process.stderr.write(`${CODE}\\n`);\n'
    + 'process.exitCode = 1;\n';

  if (tombstone.count !== 1 || !tombstone.source) {
    problems.push("retired organization-attribution route must exist exactly once.");
  } else {
    const csrfAt = tombstone.source.indexOf("csrfProtection");
    const roleAt = tombstone.source.indexOf("requireRole(['super_admin'])");
    const statusAt = tombstone.source.indexOf("res.status(410).json(");
    const codeAt = tombstone.source.indexOf('code: "ORG_ATTRIBUTION_REPAIR_RETIRED"');
    if (!(csrfAt >= 0 && roleAt > csrfAt && statusAt > roleAt && codeAt > statusAt)) {
      problems.push("retired organization-attribution route lost CSRF/admin ordering or its fixed 410 code.");
    }
    for (const forbidden of [
      "dryRun", "req.body", "req.params", "req.query", "db.", "storage.", "sql`", "execute(",
      "organization_members", "mergeDuplicatePipelineStages", "console.", "logger.", "next(",
    ]) {
      if (tombstone.source.includes(forbidden)) {
        problems.push(`retired organization-attribution tombstone restores work: ${forbidden}`);
      }
    }
    if (/\b(?:for|while)\s*\(/.test(tombstone.source) || /error\?*\.message|String\(error\)/.test(tombstone.source)) {
      problems.push("retired organization-attribution tombstone restores loops or raw-error output.");
    }
  }

  if (cli !== expectedCli) {
    problems.push("retired organization-attribution CLI is not the exact import-free refusal.");
  }
  for (const forbidden of [
    "import ", "import(", "require(", "DATABASE_URL", "process.env", "DRY_RUN", "db", "sql", "schema",
    "organizationId", "userId", "organization_members", "merge", "backfill", "process.argv", "console.",
  ]) {
    if (cli.includes(forbidden)) problems.push(`retired organization-attribution CLI restores work: ${forbidden}`);
  }

  const create = exportedFunctionSource(service, "createOrganization");
  const joinApproval = exportedFunctionSource(service, "respondToJoinRequest");
  const accept = exportedFunctionSource(invitation, "acceptOrganizationInvite");
  for (const [label, source] of [
    ["organization creation", create],
    ["join approval", joinApproval],
    ["versioned invitation acceptance", accept],
  ]) {
    if (!source) {
      problems.push(`${label} entrypoint is missing from attribution-retirement coverage.`);
      continue;
    }
    if (/backfill|repair|reconcile|attribut|mergeDuplicatePipelineStages|import\s*\(/i.test(source)) {
      problems.push(`${label} restores an automatic legacy-attribution or merge callback.`);
    }
    if (/\b(?:jobs|clients|applications|job_analytics|job_audit_log|pipeline_stages|email_templates|forms|form_invitations|form_responses)\b/i.test(source)
        || /SET\s+["']?organization_id|UPDATE[\s\S]{0,300}FROM\s+organization_members/i.test(source)) {
      problems.push(`${label} modifies or infers authority for an unrelated legacy table.`);
    }
  }

  const productionSources = walk(join(root, "server"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  if (/backfillUserRecordsToOrg/.test(productionSources)) {
    problems.push("retired backfillUserRecordsToOrg still has a production definition or caller.");
  }
  if (/UPDATE[\s\S]{0,240}organization_id[\s\S]{0,240}FROM\s+organization_members/i.test(
    [admin, cli, service, invitation].join("\n"),
  )) {
    problems.push("retired organization attribution is reconstructed from current membership.");
  }

  for (const file of [
    "server/lib/__tests__/unsafeOrgAttributionRetirement.routes.test.ts",
    "server/lib/__tests__/unsafeOrgAttributionRetirement.cli.test.ts",
    "server/lib/__tests__/unsafeOrgAttributionRetirement.pg.test.ts",
  ]) {
    const test = read(root, file);
    if (/https:\/\/(?![^\s"']*\.invalid)|railway|flow_db\.url|ACTIVEKG|GROQ|BREVO|SENDGRID|customer@/i.test(test)) {
      problems.push(`2M retirement test contacts a production, provider or customer surface: ${file}`);
    }
  }
  const pgTest = read(root, "server/lib/__tests__/unsafeOrgAttributionRetirement.pg.test.ts");
  for (const anchor of [
    "legacySnapshot", "organization_id IS NULL", "createOrganization(", "acceptOrganizationInvite(",
    "respondToJoinRequest(", "duplicate_stages", "legacyAfter).toEqual(legacyBefore)",
  ]) requireAnchor(problems, pgTest, anchor, `2M PostgreSQL conservation anchor is missing: ${anchor}`);

  for (const [method, path, expected] of [
    ["get", "/api/admin/ops/org-health", "5f396aa2fed43024096dd1e09c8bdf6d1afa011bf8790e69343b52fd9da460da"],
    ["post", "/api/admin/ops/merge-duplicate-stages", "c14687779045cca381d79c5954ba625a0c7bc084f1671edc98e695846845c507"],
  ]) {
    const block = routeCall(admin, method, path);
    if (block.count !== 1 || sha256(block.source) !== expected) {
      problems.push(`frozen 2M neighboring route drifted: ${method.toUpperCase()} ${path}`);
    }
  }
}

function validateDecisionEventSpine(root, problems) {
  const workflow = read(root, "server/lib/applicationWorkflowAuthorization.ts");
  const routes = read(root, "server/applications.routes.ts");
  const migration = read(root, "server/schema-migrations/0007_decision_event_spine.sql");
  const lock = JSON.parse(read(root, "server/schema-migrations/checksums.lock"));
  const schema = read(root, "shared/schema.ts");
  const runtimeRole = read(root, "server/schema-control/runtimeRole.ts");
  const readiness = read(root, "server/schema-control/readiness.ts");
  const packageJson = read(root, "package.json");
  const ci = read(root, "../.github/workflows/ci.yml");
  const pgTest = read(root, "server/lib/__tests__/decisionEventSpine.pg.test.ts");
  const stageCommand = exportedFunctionSource(workflow, "moveAuthorizedApplicationStage");
  const stageRoute = routeCall(routes, "patch", "/api/applications/:id/stage");

  for (const anchor of [
    "CREATE SEQUENCE public.decision_event_sequence", "CREATE TABLE public.decision_events",
    "organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT",
    "decision_events_aggregate_sequence_unique", "decision_events_idempotency_key_unique",
    "octet_length(before_state::text) <= 1024", "octet_length(after_state::text) <= 1024",
    "rubric_id IS NULL AND rubric_version IS NULL AND rubric_approval_mode IS NULL",
    "recommendation_action IS NOT NULL\n    OR (recommendation_model_version IS NULL AND recommendation_input_version IS NULL)",
    "flow_reject_decision_event_mutation", "decision_events_append_only",
    "decision_events_truncate_append_only", "DECISION_EVENT_APPEND_ONLY",
  ]) requireAnchor(problems, migration, anchor, `decision-event migration anchor is missing: ${anchor}`);
  if (/REFERENCES public\.(?:applications|jobs|pipeline_stages|users)/.test(migration)) {
    problems.push("decision-event migration restores a mutable aggregate/user foreign key.");
  }
  if (/\b(?:candidate_name|email|phone|resume|notes|narrative|free_text)\b/i.test(
    migration.replace(/COMMENT ON[\s\S]*$/m, ""),
  )) problems.push("decision-event relation persists a private or free-text field.");
  if (!/^[a-f0-9]{64}$/.test(lock?.migrations?.["0007"] ?? "")
      || sha256(migration) !== lock.migrations["0007"]) {
    problems.push("decision-event migration checksum does not match migration 0007.");
  }

  for (const anchor of [
    'pgSequence("decision_event_sequence"', 'pgTable("decision_events"',
    'aggregateType: text("aggregate_type").notNull()', 'beforeState: jsonb("before_state").notNull()',
    'afterState: jsonb("after_state").notNull()', "decision_events_rubric_shape",
  ]) requireAnchor(problems, schema, anchor, `decision-event Drizzle schema anchor is missing: ${anchor}`);

  if (!stageCommand || count(stageCommand, "db.execute(") !== 1) {
    problems.push("moveAuthorizedApplicationStage must keep exactly one database statement.");
  }
  for (const anchor of [
    "validUuid(eventId)", "transition AS MATERIALIZED", "nextval('public.decision_event_sequence')",
    "INSERT INTO ${applicationStageHistory}", "inserted_event AS", "INSERT INTO ${decisionEvents}",
    "'application_stage_moved'", "'applications.stage_patch'", "jsonb_build_object('stage_id', transition.current_stage)",
    "jsonb_build_object('stage_id', transition.stage_id)", "INNER JOIN inserted_history",
    "inserted_history.inserted = 1 AND inserted_intent.inserted = 1", 'AS "changed"',
  ]) requireAnchor(problems, stageCommand, anchor, `decision-event adopter anchor is missing: ${anchor}`);
  const eventStart = stageCommand.indexOf("inserted_event AS");
  const eventEnd = stageCommand.indexOf("RETURNING 1 AS inserted", eventStart);
  const eventInsert = eventStart >= 0 && eventEnd > eventStart ? stageCommand.slice(eventStart, eventEnd) : "";
  for (const forbidden of ["${notes}", "aiSuggestedActionReason", "stage_name", "rejectionReason", "rubricVersion}"]) {
    if (eventInsert.includes(forbidden)) problems.push(`decision event copies forbidden inferred/private evidence: ${forbidden}`);
  }
  for (const anchor of [
    "NULL,\n               NULL,\n               NULL,\n               transition.jd_digest_version",
    "transition.jd_digest_version,\n               NULL,", "NULL,\n               NULL,\n               jsonb_build_object",
  ]) requireAnchor(problems, eventInsert, anchor, `decision-event null/proxy contract is missing: ${anchor}`);

  if (stageRoute.count !== 1 || !stageRoute.source) {
    problems.push("decision-event stage route is missing or duplicated.");
  } else {
    for (const anchor of ["randomUUID()", "moveAuthorizedApplicationStage(", "result.value.changed && autoNotifications", "res.json({ success: true })"]) {
      requireAnchor(problems, stageRoute.source, anchor, `decision-event stage route anchor is missing: ${anchor}`);
    }
    if (/validation\.data\.(?:event|organization|actor|action|source|taxonomy|rubric|recommendation|reason|idempotency)/.test(stageRoute.source)) {
      problems.push("decision-event stage route accepts request-authored event provenance.");
    }
  }

  for (const anchor of [
    "c.relname IN ('decision_events','decision_projection_outbox')", "has_table_privilege($1,c.oid,'INSERT')",
    "NOT has_table_privilege($1,c.oid,'SELECT')", "NOT has_table_privilege($1,c.oid,'UPDATE')",
    "NOT has_table_privilege($1,c.oid,'DELETE')", "NOT has_table_privilege($1,c.oid,'TRUNCATE')",
    "c.relname IN ('decision_event_sequence','decision_projection_outbox_sequence')", "has_sequence_privilege($1,c.oid,'USAGE')",
    "NOT has_sequence_privilege($1,c.oid,'SELECT')", "NOT has_sequence_privilege($1,c.oid,'UPDATE')",
    "GRANT INSERT ON TABLE ${DECISION_EVENT_TABLE}", "GRANT USAGE ON SEQUENCE ${DECISION_EVENT_SEQUENCE}",
  ]) requireAnchor(problems, runtimeRole, anchor, `decision-event runtime-role anchor is missing: ${anchor}`);
  for (const anchor of [
    '"public.decision_events"', "to_regclass('public.decision_event_sequence')",
    "decision_events_append_only", "decision_events_truncate_append_only",
    "c.relname IN ('decision_events','decision_projection_outbox')",
    "c.relname IN ('decision_event_sequence','decision_projection_outbox_sequence')",
  ]) requireAnchor(problems, readiness, anchor, `decision-event readiness anchor is missing: ${anchor}`);

  for (const [script, file] of [
    ["test:versioned-invitation-grants:pg", "versionedInvitationGrantAuthorization.pg.test.ts"],
    ["test:unsafe-org-attribution-retirement:pg", "unsafeOrgAttributionRetirement.pg.test.ts"],
    ["test:decision-event-spine:pg", "decisionEventSpine.pg.test.ts"],
  ]) {
    requireAnchor(problems, packageJson, `"${script}"`, `decision-event package script is missing: ${script}`);
    requireAnchor(problems, packageJson, file, `decision-event package script target is missing: ${file}`);
    requireAnchor(problems, ci, `npm run ${script}`, `decision-event CI step is missing: ${script}`);
  }
  for (const anchor of [
    "pre0007Manifest", "upgrade.applied.join(\",\") !== \"0007,0008\"", "readinessAsRuntime",
    "same-stage a zero-write", "event insert fails", "history insertion fails", "concurrent moves",
    "runtime insert-only ACL", "evidence-preserving owner guards", "minimized evidence outlive mutable rows",
  ]) requireAnchor(problems, pgTest, anchor, `decision-event PostgreSQL lifecycle anchor is missing: ${anchor}`);

  for (const [symbol, expected] of [
    ["scheduleAuthorizedBulkApplicationInterviews", "adcd82d7a208907b758719aac776eba4a751a78484cff5c37ac219505067bfa9"],
    ["scheduleAuthorizedApplicationInterview", "37ad0877d884d1d326904c570575c24a3fd81e120a6fa7243c5a7c853554144b"],
  ]) if (sha256(exportedFunctionSource(workflow, symbol)) !== expected) {
    problems.push(`frozen 3A workflow writer drifted: ${symbol}`);
  }
  for (const [method, path, expected] of [
    ["patch", "/api/applications/bulk/interview", "87de7930dfd9ccd1b10d8af99de8d9d12a0179cccade7ef918ad2f210d110dfa"],
    ["patch", "/api/applications/:id/interview", "ffd5e0117e3d14849b0811831b6e4ff087470a3faef3b97cc13a59e9dde2fbc1"],
    ["patch", "/api/applications/:id/status", "cfec4be22ed2f1e688fe73122a2ef3eded26b5092a6bae380bd26a9fbc2613f4"],
    ["patch", "/api/applications/bulk", "a6743ecb4b117ce192164d166b3665c536d6fff973b065e76094776c134636b2"],
  ]) if (sha256(routeCall(routes, method, path).source) !== expected) {
    problems.push(`frozen 3A route writer drifted: ${method.toUpperCase()} ${path}`);
  }
}

function validateDecisionProjectionOutbox(root, problems) {
  const workflow = read(root, "server/lib/applicationWorkflowAuthorization.ts");
  const migration = read(root, "server/schema-migrations/0008_decision_projection_outbox.sql");
  const lock = JSON.parse(read(root, "server/schema-migrations/checksums.lock"));
  const schema = read(root, "shared/schema.ts");
  const runtimeRole = read(root, "server/schema-control/runtimeRole.ts");
  const readiness = read(root, "server/schema-control/readiness.ts");
  const packageJson = read(root, "package.json");
  const ci = read(root, "../.github/workflows/ci.yml");
  const pgTest = read(root, "server/lib/__tests__/decisionProjectionOutbox.pg.test.ts");
  const stageCommand = exportedFunctionSource(workflow, "moveAuthorizedApplicationStage");

  for (const anchor of [
    "CREATE SEQUENCE public.decision_projection_outbox_sequence",
    "CREATE TABLE public.decision_projection_outbox",
    "event_id uuid PRIMARY KEY REFERENCES public.decision_events(event_id) ON DELETE RESTRICT",
    "organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT",
    "memory.organization_decision_inbox.v1", "payload_schema_version = 1",
    "source_system = 'flow'", "subject_type = 'application'",
    "decision_projection_outbox_delivery_sequence_unique",
    "decision_projection_outbox_source_event_sequence_unique",
    "octet_length(before_state::text) <= 1024", "octet_length(after_state::text) <= 1024",
    "before_state->'stage_id' IS DISTINCT FROM after_state->'stage_id'",
    "flow_reject_decision_projection_outbox_mutation", "decision_projection_outbox_append_only",
    "decision_projection_outbox_truncate_append_only", "DECISION_OUTBOX_APPEND_ONLY",
  ]) requireAnchor(problems, migration, anchor, `decision-projection outbox migration anchor is missing: ${anchor}`);
  if (/REFERENCES public\.(?:applications|jobs|pipeline_stages|users)/.test(migration)) {
    problems.push("decision-projection outbox restores a mutable aggregate/user foreign key.");
  }
  if (/\b(?:candidate_name|canonical_candidate|signal_candidate|email|phone|resume|notes|narrative|free_text|attempt|lease|acknowledge|error_text)\b/i.test(
    migration.replace(/COMMENT ON[\s\S]*$/m, ""),
  )) problems.push("decision-projection outbox persists PII, inferred identity, free text, or mutable delivery state.");
  if (!/^[a-f0-9]{64}$/.test(lock?.migrations?.["0008"] ?? "")
      || sha256(migration) !== lock.migrations["0008"]) {
    problems.push("decision-projection outbox checksum does not match migration 0008.");
  }

  for (const anchor of [
    'pgSequence("decision_projection_outbox_sequence"', 'pgTable("decision_projection_outbox"',
    'eventId: uuid("event_id").primaryKey().references(() => decisionEvents.eventId',
    'destination: text("destination").notNull()', 'beforeState: jsonb("before_state").notNull()',
    'afterState: jsonb("after_state").notNull()', "decision_projection_outbox_state_changed",
  ]) requireAnchor(problems, schema, anchor, `decision-projection Drizzle schema anchor is missing: ${anchor}`);

  if (!stageCommand || count(stageCommand, "db.execute(") !== 1) {
    problems.push("3B adopter must keep exactly one database statement.");
  }
  for (const anchor of [
    "nextval('public.decision_event_sequence')", "nextval('public.decision_projection_outbox_sequence')",
    "inserted_event AS", "inserted_intent AS", "INSERT INTO ${decisionProjectionOutbox}",
    "FROM inserted_event", "'memory.organization_decision_inbox.v1'", "'flow'", "'application'",
    "inserted_history.inserted = 1 AND inserted_intent.inserted = 1",
  ]) requireAnchor(problems, stageCommand, anchor, `decision-projection adopter anchor is missing: ${anchor}`);
  const intentStart = stageCommand.indexOf("inserted_intent AS");
  const intentEnd = stageCommand.indexOf("RETURNING 1 AS inserted", intentStart);
  const intentInsert = intentStart >= 0 && intentEnd > intentStart ? stageCommand.slice(intentStart, intentEnd) : "";
  for (const forbidden of ["actor_user_id", "requesting_actor_user_id", "source_surface", "idempotency_key",
    "recommendation_model_version", "recommendation_input_version", "${notes}", "stage_name", "fetch(",
    "ACTIVEKG", "MEMORY_", "setTimeout", "setInterval"]) {
    if (intentInsert.includes(forbidden)) problems.push(`decision projection copies or invokes forbidden material: ${forbidden}`);
  }
  if (/\bfetch\s*\(|ACTIVEKG|MEMORY_|setTimeout|setInterval|jwt-signer|activekg-client/.test(stageCommand)) {
    problems.push("decision projection copies or invokes forbidden material: fetch(");
  }

  for (const anchor of [
    "DECISION_OUTBOX_TABLE", "DECISION_OUTBOX_SEQUENCE",
    "GRANT INSERT ON TABLE ${DECISION_OUTBOX_TABLE}",
    "GRANT USAGE ON SEQUENCE ${DECISION_OUTBOX_SEQUENCE}",
    "Decision-outbox table/sequence presence is inconsistent.",
  ]) requireAnchor(problems, runtimeRole, anchor, `decision-projection runtime-role anchor is missing: ${anchor}`);
  for (const anchor of [
    '"public.decision_projection_outbox"', "to_regclass('public.decision_projection_outbox_sequence')",
    "flow_reject_decision_projection_outbox_mutation", "decision_projection_outbox_append_only",
    "decision_projection_outbox_truncate_append_only",
  ]) requireAnchor(problems, readiness, anchor, `decision-projection readiness anchor is missing: ${anchor}`);

  for (const anchor of [
    '"test:decision-projection-outbox:pg"', "decisionProjectionOutbox.pg.test.ts",
  ]) requireAnchor(problems, packageJson, anchor, `decision-projection package script is missing: ${anchor}`);
  requireAnchor(problems, ci, "npm run test:decision-projection-outbox:pg",
    "decision-projection CI step is missing.");
  for (const anchor of [
    "pre0008Manifest", "pre0008EventStayedUnprojected", "four writes back", "concurrent moves",
    "INSERT-only/USAGE-only", "owner-level append-only", "outlive mutable rows", "fails readiness",
  ]) requireAnchor(problems, pgTest, anchor, `decision-projection PostgreSQL lifecycle anchor is missing: ${anchor}`);
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
  if (!Array.isArray(manifest.frozen_route_blocks) || manifest.frozen_route_blocks.length !== 7) {
    problems.push("exactly five WhatsApp and two talent-pool route blocks must be frozen.");
  }
  if (!Array.isArray(manifest.routes) || manifest.routes.length !== 57) {
    problems.push("exactly fifty-seven protected authorization routes must be governed.");
  }
  if (!Array.isArray(manifest.retired_routes) || manifest.retired_routes.length !== 10) {
    problems.push("exactly ten resume/application/consultant/attribution registrations must be retired.");
  }
  if (!Array.isArray(manifest.governed_files) || manifest.governed_files.length !== 97) {
    problems.push("exactly ninety-seven authorization files must be governed.");
  }

  for (const [path, reader] of [
    ["/api/jobs/:id/applications", "requireSeat+isRecruiterOnJob"],
    ["/api/subscription/seats/usage", "requireSeat+getSeatUsage"],
    ["/api/users", "readAuthorizedHiringManagerDirectory"],
  ]) {
    const matches = (manifest.routes ?? []).filter((row) => row.method === "get" && row.path === path && row.reader === reader);
    if (matches.length !== 1) problems.push(`membership-scoped manifest route is missing or duplicated: GET ${path}`);
  }

  for (const [method, path, reader] of [
    ["patch", "/api/applications/:id/stage", "moveAuthorizedApplicationStage"],
    ["patch", "/api/applications/:id/interview", "scheduleAuthorizedApplicationInterview"],
    ["patch", "/api/applications/bulk/interview", "scheduleAuthorizedBulkApplicationInterviews"],
    ["post", "/api/applications/:id/notes", "addAuthorizedApplicationReviewerNote"],
    ["patch", "/api/applications/:id/rating", "setAuthorizedApplicationReviewerRating"],
    ["get", "/api/applications/:id/feedback", "readAuthorizedApplicationFeedback"],
    ["post", "/api/applications/:id/feedback", "addAuthorizedApplicationFeedback"],
  ]) {
    const matches = (manifest.routes ?? []).filter((row) => row.method === method && row.path === path && row.reader === reader);
    if (matches.length !== 1) problems.push(`workflow manifest route is missing or duplicated: ${method.toUpperCase()} ${path}`);
  }

  for (const [method, path, reader, projection] of [
    ["post", "/api/organizations", "createOrganization", ["id", "name", "slug", "logo", "domain", "domainVerified", "domainApprovedBy", "domainApprovedAt", "gstin", "billingName", "billingAddress", "billingCity", "billingState", "billingPincode", "billingContactEmail", "billingContactName", "settings", "isActive", "createdAt", "updatedAt", "signalTenantId"]],
    ["delete", "/api/organizations/members/:id", "removeOrganizationMemberAndRevoke", ["success"]],
    ["patch", "/api/organizations/members/:id/role", "changeOrganizationMemberRoleAndRevoke", ["id", "userId", "role", "seatAssigned"]],
    ["post", "/api/organizations/members/:id/reassign", "reassignOrganizationJobs", ["success", "reassignedCount"]],
    ["post", "/api/reset-password", "resetPasswordAndAdvanceAuthorization", ["message"]],
  ]) {
    const matches = (manifest.routes ?? []).filter((row) => row.method === method
      && row.path === path
      && row.reader === reader
      && JSON.stringify(row.projection) === JSON.stringify(projection));
    if (matches.length !== 1) problems.push(`privilege manifest route is missing or duplicated: ${method.toUpperCase()} ${path}`);
  }

  for (const [method, path, reader, projection] of [
    ["post", "/api/organizations/members/invite", "createOrResendOrganizationInvite", ["id", "email", "role", "expiresAt", "createdAt"]],
    ["get", "/api/organizations/invites", "listOrganizationInvites", ["id", "email", "role", "expiresAt", "createdAt"]],
    ["delete", "/api/organizations/invites/:id", "cancelOrganizationInvite", ["success"]],
    ["get", "/api/invites/:token", "readOrganizationInvitePreview", ["organizationName", "email", "role", "expiresAt", "inviterName"]],
    ["post", "/api/invites/:token/accept", "acceptOrganizationInvite", ["success", "membership"]],
    ["post", "/api/register", "ordinaryVerification+versionedHiringManagerGrant", ["message", "requiresVerification", "emailDeliveryFailed"]],
  ]) {
    const matches = (manifest.routes ?? []).filter((row) => row.method === method
      && row.path === path && row.reader === reader
      && JSON.stringify(row.projection) === JSON.stringify(projection));
    if (matches.length !== 1) problems.push(`versioned invitation manifest route is missing or duplicated: ${method.toUpperCase()} ${path}`);
  }

  for (const [method, path, reader] of [
    ["get", "/api/talent-pool", "listAuthorizedTalentPoolCandidates"],
    ["get", "/api/talent-pool/:id", "readAuthorizedTalentPoolCandidate"],
    ["post", "/api/talent-pool", "readAuthorizedTalentPoolCreateContext+createAuthorizedTalentPoolCandidate"],
    ["put", "/api/talent-pool/:id", "readAuthorizedTalentPoolCandidate+updateAuthorizedTalentPoolCandidate"],
    ["delete", "/api/talent-pool/:id", "removeAuthorizedTalentPoolCandidate"],
    ["post", "/api/talent-pool/:id/restore", "restoreAuthorizedTalentPoolCandidate"],
  ]) {
    const matches = (manifest.routes ?? []).filter((row) => row.method === method && row.path === path && row.reader === reader);
    if (matches.length !== 1) problems.push(`talent-pool manifest route is missing or duplicated: ${method.toUpperCase()} ${path}`);
  }

  for (const [method, path, reader] of [
    ["post", "/api/subscription/seats/assign", "assignAuthorizedSeat"],
    ["post", "/api/subscription/seats/unassign", "unassignAuthorizedSeat"],
    ["get", "/api/subscription/invoices", "listAuthorizedInvoices"],
    ["get", "/api/subscription/invoices/:transactionId/pdf", "readAuthorizedInvoiceById"],
    ["get", "/api/invoices/:fileName", "readAuthorizedInvoiceByFileName"],
    ["get", "/api/ai/credits/usage", "readAuthorizedOrganizationAiActivity"],
    ["patch", "/api/admin/users/:id/role", "updateAuthorizedUserRole"],
  ]) {
    const matches = (manifest.routes ?? []).filter((row) => row.method === method && row.path === path && row.reader === reader);
    if (matches.length !== 1) problems.push(`financial/admin manifest route is missing or duplicated: ${method.toUpperCase()} ${path}`);
  }

  for (const [method, path, code] of [
    ["get", "/api/admin/applications/all", "ADMIN_APPLICATION_COLLECTION_RETIRED"],
    ["get", "/api/consultants", "CONSULTANT_PRODUCT_RETIRED"],
    ["get", "/api/consultants/:id", "CONSULTANT_PRODUCT_RETIRED"],
    ["get", "/api/admin/consultants", "CONSULTANT_PRODUCT_RETIRED"],
    ["post", "/api/admin/consultants", "CONSULTANT_PRODUCT_RETIRED"],
    ["patch", "/api/admin/consultants/:id", "CONSULTANT_PRODUCT_RETIRED"],
    ["delete", "/api/admin/consultants/:id", "CONSULTANT_PRODUCT_RETIRED"],
    ["post", "/api/admin/ops/backfill-org-ids", "ORG_ATTRIBUTION_REPAIR_RETIRED"],
  ]) {
    const matches = (manifest.retired_routes ?? []).filter((row) => row.method === method && row.path === path && row.code === code);
    if (matches.length !== 1) problems.push(`retired manifest route is missing or duplicated: ${method.toUpperCase()} ${path}`);
  }

  for (const [method, path, reader] of [
    ["post", "/api/forms/templates", "createScopedFormTemplate"],
    ["get", "/api/forms/templates", "listAuthorizedFormTemplates"],
    ["get", "/api/forms/templates/:id", "readAuthorizedFormTemplate"],
    ["patch", "/api/forms/templates/:id", "updateAuthorizedFormTemplate"],
    ["delete", "/api/forms/templates/:id", "deleteAuthorizedFormTemplate"],
    ["get", "/api/forms/:id/responses", "readAuthorizedResponsesForForm"],
    ["get", "/api/client-shortlist/:token", "readPublicClientShortlist"],
    ["post", "/api/client-shortlist/:token/feedback", "resolvePublicFeedbackTarget"],
    ["get", "/api/client-shortlist/:token/resume/:candidateRef", "readPublicResumeLocator"],
    ["get", "/api/applications/:id/client-feedback", "readAuthorizedClientFeedback"],
    ["post", "/api/hiring-manager-invitations", "replaceAuthorizedHiringManagerInvitation"],
    ["get", "/api/hiring-manager-invitations", "listAuthorizedHiringManagerInvitations"],
    ["delete", "/api/hiring-manager-invitations/:id", "cancelAuthorizedHiringManagerInvitation"],
  ]) {
    const matches = (manifest.routes ?? []).filter((row) => row.method === method && row.path === path && row.reader === reader);
    if (matches.length !== 1) problems.push(`reviewer/share manifest route is missing or duplicated: ${method.toUpperCase()} ${path}`);
  }

  for (const [method, path, reader] of [
    ["post", "/api/applications/:id/ai-summary", "readAuthorizedApplicationAiSummaryContext+publishAuthorizedApplicationAiSummary"],
    ["get", "/api/jobs/:id/ai-similar-candidates", "readAuthorizedSimilarCandidates"],
    ["post", "/api/applications/:id/send-email", "readAuthorizedManualEmailContext+sendAuthorizedTemplatedEmail"],
    ["post", "/api/email/draft", "readAuthorizedEmailDraftContext+recordAuthorizedEmailDraftUsage"],
  ]) {
    const matches = (manifest.routes ?? []).filter((row) => row.method === method && row.path === path && row.reader === reader);
    if (matches.length !== 1) problems.push(`AI/outbound manifest route is missing or duplicated: ${method.toUpperCase()} ${path}`);
  }

  const governedPaths = new Set((manifest.governed_files ?? []).map((row) => row.file));
  for (const file of [
    "server/applications.routes.ts", "server/subscription.routes.ts", "server/routes.ts",
    "server/lib/membershipScopedReadAuthorization.ts",
    "server/lib/__tests__/membershipScopedReadAuthorization.test.ts",
    "server/lib/__tests__/membershipScopedReadAuthorization.routes.test.ts",
    "server/tests/applicationReadAuthorization.pg.test.ts",
    "server/lib/applicationWorkflowAuthorization.ts",
    "server/lib/__tests__/applicationWorkflowAuthorization.test.ts",
    "server/lib/__tests__/applicationWorkflowAuthorization.routes.test.ts",
    "server/lib/__tests__/applicationWorkflowAuthorization.pg.test.ts",
    "server/communications.routes.ts", "server/emailTemplateService.ts",
    "server/lib/applicationAiOutboundAuthorization.ts",
    "server/lib/__tests__/applicationAiOutboundAuthorization.test.ts",
    "server/lib/__tests__/applicationAiOutboundAuthorization.routes.test.ts",
    "server/lib/__tests__/applicationAiOutboundAuthorization.pg.test.ts",
    "server/lib/__tests__/authorizedTemplatedEmail.test.ts",
    "server/schema-migrations/0003_application_workflow_assessments.sql",
    "server/forms.routes.ts", "server/clients.routes.ts", "server/hiringManagerInvitations.routes.ts",
    "server/lib/reviewerShareAuthorization.ts", "server/schema-migrations/0004_reviewer_share_authority.sql",
    "server/lib/__tests__/reviewerShareAuthorization.test.ts",
    "server/lib/__tests__/reviewerShareAuthorization.routes.test.ts",
    "server/lib/__tests__/reviewerShareAuthorization.pg.test.ts",
    "client/src/pages/admin-forms-page.tsx", "client/src/pages/application-management-page.tsx",
    "client/src/pages/client-shortlist-page.tsx", "client/src/lib/internal-copy.ts",
    "server/lib/__tests__/objectAuthorizationSurfaceGuard.test.ts",
    "scripts/check-object-authorization.mjs", "server/candidate-privacy/surfaces.json",
    "server/lib/scopedFinancialAdminPublicAuthorization.ts",
    "server/lib/__tests__/scopedFinancialAdminPublicAuthorization.test.ts",
    "server/lib/__tests__/scopedFinancialAdminPublicAuthorization.routes.test.ts",
    "server/lib/__tests__/scopedFinancialAdminPublicAuthorization.pg.test.ts",
    "server/admin.routes.ts", "client/src/hooks/use-subscription.ts", "client/src/hooks/use-ai-credits.ts",
    "client/src/pages/org-billing-page.tsx", "client/src/pages/admin-super-dashboard.tsx",
    "client/src/App.tsx", "client/src/components/QuickAccessBar.tsx",
    "server/talent-pool.routes.ts", "server/lib/talentPoolAuthorization.ts",
    "server/lib/__tests__/talentPoolAuthorization.test.ts",
    "server/lib/__tests__/talentPoolAuthorization.routes.test.ts",
    "server/lib/__tests__/talentPoolAuthorization.pg.test.ts",
    "test/integration/backward-compatibility.test.ts",
    "server/organization.routes.ts", "server/lib/organizationService.ts",
    "server/lib/privilegeGrantRevocation.ts", "server/schema-migrations/0005_privilege_authorization_version.sql",
    "server/lib/__tests__/privilegeGrantRevocation.test.ts",
    "server/lib/__tests__/privilegeGrantRevocation.routes.test.ts",
    "server/lib/__tests__/privilegeGrantRevocation.pg.test.ts",
    "server/tests/org-team-member-removal.routes.test.ts",
    "server/lib/__tests__/candidatePortalAuthQuotaContracts.test.ts",
    "server/schema-migrations/0006_versioned_invitation_grants.sql",
    "server/lib/versionedInvitationGrantAuthorization.ts",
    "server/lib/__tests__/versionedInvitationGrantAuthorization.test.ts",
    "server/lib/__tests__/versionedInvitationGrantAuthorization.routes.test.ts",
    "server/lib/__tests__/versionedInvitationGrantAuthorization.pg.test.ts",
    "test/integration/invite-and-webhook.test.ts",
    "test/integration/invite-seat-edge.test.ts",
    "server/scripts/backfill-org-ids.ts",
    "server/lib/__tests__/unsafeOrgAttributionRetirement.routes.test.ts",
    "server/lib/__tests__/unsafeOrgAttributionRetirement.cli.test.ts",
    "server/lib/__tests__/unsafeOrgAttributionRetirement.pg.test.ts",
    "server/lib/__tests__/decisionEventSpine.pg.test.ts",
    "server/lib/__tests__/decisionProjectionOutbox.pg.test.ts",
  ]) {
    if (!governedPaths.has(file)) problems.push(`membership-scoped governed file is missing: ${file}`);
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
    validateWorkflowAuthority(root, problems);
    validateApplicationAiOutboundAuthority(root, problems);
    validateReviewerShareAuthority(root, problems);
    validateScopedFinancialAdminPublicAuthority(root, problems);
    validateTalentPoolAuthority(root, problems);
    validatePrivilegeGrantRevocation(root, problems);
    validateVersionedInvitationGrants(root, problems);
    validateUnsafeOrgAttributionRetirement(root, problems);
    validateDecisionEventSpine(root, problems);
    validateDecisionProjectionOutbox(root, problems);
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
