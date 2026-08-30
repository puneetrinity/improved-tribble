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
    "INNER JOIN ${organizationMembers} AS inviter_membership",
    "inviter_membership.organization_id = actor_context.organization_id",
    "LOWER(${hiringManagerInvitations.email}) = LOWER(hiring_manager.username)",
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

  for (const row of manifestFrozenRouteBlocks(root)) {
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
  for (const anchor of ["0002_resume_access_attempts.sql", 'const file = `0004_${name}.sql`', 'applied: ["0000", "0001", "0002", "0003"]'])
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
  if (!Array.isArray(manifest.routes) || manifest.routes.length !== 20) {
    problems.push("exactly twenty object/membership/workflow/AI-outbound routes must be governed.");
  }
  if (!Array.isArray(manifest.retired_routes) || manifest.retired_routes.length !== 2) {
    problems.push("exactly two resume registrations must be retired.");
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
    "server/lib/__tests__/objectAuthorizationSurfaceGuard.test.ts",
    "scripts/check-object-authorization.mjs", "server/candidate-privacy/surfaces.json",
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
