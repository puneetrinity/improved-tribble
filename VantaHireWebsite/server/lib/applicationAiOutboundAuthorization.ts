import {
  applications,
  candidateResumes,
  emailTemplates,
  jobRecruiters,
  jobs,
  organizationMembers,
  userAiUsage,
  users,
} from "@shared/schema";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { applicationPrivacyAllowed } from "../storage";

export interface ApplicationAiOutboundPolicy {
  allowPlatformAdmin: boolean;
}

export interface ApplicationAiSummaryContext {
  applicationId: number;
  jobId: number;
  organizationId: number;
  candidateName: string;
  candidateText: string | null;
  jobTitle: string;
  jobDescription: string;
  requiredSkills: string[];
  goodToHaveSkills: string[];
}

export interface SimilarCandidateProjection {
  applicationId: number;
  candidateName: string;
  candidateEmail: string;
  sourceJobId: number;
  sourceJobTitle: string;
  aiFitScore: number;
  aiFitLabel: string | null;
  currentStage: number | null;
}

export interface AuthorizedManualEmailContext {
  applicationId: number;
  templateId: number;
  organizationId: number;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  recruiterName: string;
  templateName: string;
  templateType: string;
  templateSubject: string;
  templateBody: string;
}

export interface AuthorizedEmailDraftContext {
  applicationId: number;
  templateId: number;
  organizationId: number;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  templateSubject: string;
  templateBody: string;
}

export interface ApplicationAiSummaryPublication {
  summary: string;
  suggestedAction: "advance" | "hold" | "reject";
  suggestedActionReason: string;
  strengths: string[];
  concerns: string[];
  keyHighlights: string[];
  requiredSkillsMatched: string[];
  requiredSkillsMissing: string[];
  requiredSkillsMatchPercentage: number;
  requiredSkillsDepthNotes: string;
  goodToHaveSkillsMatched: string[];
  goodToHaveSkillsMissing: string[];
  modelVersion: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  durationMs: number;
}

export interface EmailDraftUsage {
  templateId: number;
  tone: "friendly" | "formal";
  tokensIn: number;
  tokensOut: number;
  costUsd: string;
  durationMs: number;
}

export type AuthorizedResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" | "unavailable" };

export type AuthorizedRowsResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: "not_found" | "unavailable" };

type QueryResult = { rows?: unknown[] };
type UnknownRow = Record<string, unknown>;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validPolicy(value: unknown): value is ApplicationAiOutboundPolicy {
  return typeof value === "object"
    && value !== null
    && typeof (value as ApplicationAiOutboundPolicy).allowPlatformAdmin === "boolean";
}

function rowsFrom(result: unknown): UnknownRow[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows) || !rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
  }
  return rows as UnknownRow[];
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (!isPositiveSafeInteger(parsed)) throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
  return parsed;
}

function nullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : positiveInteger(value);
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (!isNonNegativeSafeInteger(parsed)) throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
  return parsed;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function stringArray(value: unknown): string[] {
  if (value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
  }
  return value;
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
  return parsed.toISOString();
}

function validBaseInputs(actorId: unknown, objectId: unknown, policy: unknown): boolean {
  return isPositiveSafeInteger(actorId) && isPositiveSafeInteger(objectId) && validPolicy(policy);
}

function recruiterOrPlatformGrant(actorId: number, allowPlatformAdmin: boolean): SQL {
  return sql`(
    (${allowPlatformAdmin} AND actor.role = 'super_admin')
    OR (
      actor.role = 'recruiter'
      AND EXISTS (
        SELECT 1
          FROM ${organizationMembers}
         WHERE ${organizationMembers.userId} = ${actorId}
           AND ${organizationMembers.organizationId} = ${applications.organizationId}
           AND ${organizationMembers.seatAssigned} = TRUE
      )
      AND (
        ${jobs.postedBy} = ${actorId}
        OR EXISTS (
          SELECT 1
            FROM ${jobRecruiters}
           WHERE ${jobRecruiters.jobId} = ${jobs.id}
             AND ${jobRecruiters.recruiterId} = ${actorId}
        )
      )
    )
  )`;
}

function authorizedApplicationSelect(
  actorId: number,
  applicationId: number,
  policy: ApplicationAiOutboundPolicy,
  projection: SQL,
  joins: SQL = sql``,
): SQL {
  return sql`
    SELECT ${applications.id} AS application_id,
           ${applications.jobId} AS job_id,
           ${applications.organizationId} AS organization_id
           ${projection}
      FROM ${applications}
      INNER JOIN ${jobs} ON ${jobs.id} = ${applications.jobId}
      INNER JOIN ${users} AS actor ON actor.id = ${actorId}
      ${joins}
     WHERE ${applications.id} = ${applicationId}
       AND ${applications.organizationId} IS NOT NULL
       AND ${jobs.organizationId} IS NOT NULL
       AND ${applications.organizationId} = ${jobs.organizationId}
       AND ${applicationPrivacyAllowed(false)}
       AND ${recruiterOrPlatformGrant(actorId, policy.allowPlatformAdmin)}
  `;
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validCost(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value);
}

function textArraySql(values: string[]): SQL {
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

function validSummaryPublication(value: unknown): value is ApplicationAiSummaryPublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as ApplicationAiSummaryPublication;
  return typeof item.summary === "string"
    && (item.suggestedAction === "advance" || item.suggestedAction === "hold" || item.suggestedAction === "reject")
    && typeof item.suggestedActionReason === "string"
    && validStringArray(item.strengths)
    && validStringArray(item.concerns)
    && validStringArray(item.keyHighlights)
    && validStringArray(item.requiredSkillsMatched)
    && validStringArray(item.requiredSkillsMissing)
    && Number.isInteger(item.requiredSkillsMatchPercentage)
    && item.requiredSkillsMatchPercentage >= 0
    && item.requiredSkillsMatchPercentage <= 100
    && typeof item.requiredSkillsDepthNotes === "string"
    && validStringArray(item.goodToHaveSkillsMatched)
    && validStringArray(item.goodToHaveSkillsMissing)
    && typeof item.modelVersion === "string"
    && isNonNegativeSafeInteger(item.tokensIn)
    && isNonNegativeSafeInteger(item.tokensOut)
    && validCost(item.costUsd)
    && isNonNegativeSafeInteger(item.durationMs);
}

function validDraftUsage(value: unknown): value is EmailDraftUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as EmailDraftUsage;
  return isPositiveSafeInteger(item.templateId)
    && (item.tone === "friendly" || item.tone === "formal")
    && isNonNegativeSafeInteger(item.tokensIn)
    && isNonNegativeSafeInteger(item.tokensOut)
    && validCost(item.costUsd)
    && isNonNegativeSafeInteger(item.durationMs);
}

export function parsePositiveDecimalJobId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

export function parseSimilarCandidateQuery(query: Record<string, unknown>):
  | { ok: true; minFitScore: number; limit: number }
  | { ok: false } {
  const parse = (value: unknown, fallback: number): number | null => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };
  const minFitScore = parse(query.minFitScore, 70);
  const limit = parse(query.limit, 20);
  if (minFitScore === null || minFitScore < 0 || minFitScore > 100
      || limit === null || limit < 1 || limit > 50) {
    return { ok: false };
  }
  return { ok: true, minFitScore, limit };
}

export async function readAuthorizedApplicationAiSummaryContext(
  actorId: number,
  applicationId: number,
  policy: ApplicationAiOutboundPolicy,
): Promise<AuthorizedResult<ApplicationAiSummaryContext>> {
  if (!validBaseInputs(actorId, applicationId, policy)) return { ok: false, reason: "unavailable" };
  try {
    const result = await db.execute(sql`
      WITH authorized_application AS MATERIALIZED (
        ${authorizedApplicationSelect(actorId, applicationId, policy, sql`,
          ${applications.name} AS candidate_name,
          COALESCE(
            NULLIF(${applications.extractedResumeText}, ''),
            NULLIF(${candidateResumes.extractedText}, ''),
            NULLIF(${applications.coverLetter}, '')
          ) AS candidate_text,
          ${jobs.title} AS job_title,
          ${jobs.description} AS job_description,
          ${jobs.skills} AS required_skills,
          ${jobs.goodToHaveSkills} AS good_to_have_skills
        `, sql`
          LEFT JOIN ${candidateResumes} ON ${candidateResumes.id} = ${applications.resumeId}
        `)}
      )
      SELECT application_id AS "applicationId",
             job_id AS "jobId",
             organization_id AS "organizationId",
             candidate_name AS "candidateName",
             candidate_text AS "candidateText",
             job_title AS "jobTitle",
             job_description AS "jobDescription",
             required_skills AS "requiredSkills",
             good_to_have_skills AS "goodToHaveSkills"
        FROM authorized_application
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
    const row = rows[0]!;
    return { ok: true, value: {
      applicationId: positiveInteger(row.applicationId),
      jobId: positiveInteger(row.jobId),
      organizationId: positiveInteger(row.organizationId),
      candidateName: text(row.candidateName),
      candidateText: nullableText(row.candidateText),
      jobTitle: text(row.jobTitle),
      jobDescription: text(row.jobDescription),
      requiredSkills: stringArray(row.requiredSkills),
      goodToHaveSkills: stringArray(row.goodToHaveSkills),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function publishAuthorizedApplicationAiSummary(
  actorId: number,
  applicationId: number,
  publication: ApplicationAiSummaryPublication,
  policy: ApplicationAiOutboundPolicy,
): Promise<AuthorizedResult<{ applicationId: number; computedAt: string }>> {
  if (!validBaseInputs(actorId, applicationId, policy) || !validSummaryPublication(publication)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH authorized_application AS MATERIALIZED (
        ${authorizedApplicationSelect(actorId, applicationId, policy, sql``)}
      ),
      updated_application AS (
        UPDATE ${applications}
           SET ai_summary = ${publication.summary},
               ai_summary_version = 1,
               ai_suggested_action = ${publication.suggestedAction},
               ai_suggested_action_reason = ${publication.suggestedActionReason},
               ai_summary_computed_at = now(),
               ai_summary_model_version = ${publication.modelVersion},
               ai_strengths = ${textArraySql(publication.strengths)},
               ai_concerns = ${textArraySql(publication.concerns)},
               ai_key_highlights = ${textArraySql(publication.keyHighlights)},
               ai_required_skills_matched = ${textArraySql(publication.requiredSkillsMatched)},
               ai_required_skills_missing = ${textArraySql(publication.requiredSkillsMissing)},
               ai_required_skills_match_percentage = ${publication.requiredSkillsMatchPercentage},
               ai_required_skills_depth_notes = ${publication.requiredSkillsDepthNotes},
               ai_good_to_have_skills_matched = ${textArraySql(publication.goodToHaveSkillsMatched)},
               ai_good_to_have_skills_missing = ${textArraySql(publication.goodToHaveSkillsMissing)}
          FROM authorized_application
         WHERE ${applications.id} = authorized_application.application_id
        RETURNING ${applications.id} AS application_id,
                  ${applications.aiSummaryComputedAt} AS computed_at
      ),
      inserted_usage AS (
        INSERT INTO ${userAiUsage}
          (organization_id,user_id,kind,tokens_in,tokens_out,cost_usd,metadata)
        SELECT authorized_application.organization_id,
               ${actorId},
               'summary',
               ${publication.tokensIn},
               ${publication.tokensOut},
               ${publication.costUsd},
               jsonb_build_object(
                 'applicationId', authorized_application.application_id,
                 'durationMs', ${publication.durationMs}::integer
               )
          FROM authorized_application
          INNER JOIN updated_application
             ON updated_application.application_id = authorized_application.application_id
        RETURNING id
      )
      SELECT updated_application.application_id AS "applicationId",
             updated_application.computed_at AS "computedAt"
        FROM updated_application
        INNER JOIN inserted_usage ON TRUE
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
    return { ok: true, value: {
      applicationId: positiveInteger(rows[0]!.applicationId),
      computedAt: timestamp(rows[0]!.computedAt),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedSimilarCandidates(
  actorId: number,
  jobId: number,
  minFitScore: number,
  limit: number,
  policy: ApplicationAiOutboundPolicy,
): Promise<AuthorizedRowsResult<SimilarCandidateProjection>> {
  if (!validBaseInputs(actorId, jobId, policy)
      || !Number.isSafeInteger(minFitScore) || minFitScore < 0 || minFitScore > 100
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH authorized_target AS MATERIALIZED (
        SELECT ${jobs.id} AS job_id,
               ${jobs.organizationId} AS organization_id,
               ${jobs.skills} AS skills,
               actor.role AS actor_role
          FROM ${jobs}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
         WHERE ${jobs.id} = ${jobId}
           AND ${jobs.organizationId} IS NOT NULL
           AND (
             (${policy.allowPlatformAdmin} AND actor.role = 'super_admin')
             OR (
               actor.role = 'recruiter'
               AND EXISTS (
                 SELECT 1 FROM ${organizationMembers}
                  WHERE ${organizationMembers.userId} = ${actorId}
                    AND ${organizationMembers.organizationId} = ${jobs.organizationId}
                    AND ${organizationMembers.seatAssigned} = TRUE
               )
               AND (
                 ${jobs.postedBy} = ${actorId}
                 OR EXISTS (
                   SELECT 1 FROM ${jobRecruiters}
                    WHERE ${jobRecruiters.jobId} = ${jobs.id}
                      AND ${jobRecruiters.recruiterId} = ${actorId}
                 )
               )
             )
           )
      ),
      candidates AS (
        SELECT ${applications.id} AS application_id,
               ${applications.name} AS candidate_name,
               ${applications.email} AS candidate_email,
               ${jobs.id} AS source_job_id,
               ${jobs.title} AS source_job_title,
               ${applications.aiFitScore} AS ai_fit_score,
               ${applications.aiFitLabel} AS ai_fit_label,
               ${applications.currentStage} AS current_stage
          FROM authorized_target
          INNER JOIN ${jobs}
             ON ${jobs.organizationId} = authorized_target.organization_id
            AND ${jobs.id} <> authorized_target.job_id
          INNER JOIN ${applications} ON ${applications.jobId} = ${jobs.id}
         WHERE ${applications.organizationId} IS NOT NULL
           AND ${applications.organizationId} = ${jobs.organizationId}
           AND ${applications.aiFitScore} IS NOT NULL
           AND ${applications.aiFitScore} >= ${minFitScore}
           AND ${applicationPrivacyAllowed(false)}
           AND (
             authorized_target.actor_role = 'super_admin'
             OR ${jobs.postedBy} = ${actorId}
             OR EXISTS (
               SELECT 1 FROM ${jobRecruiters}
                WHERE ${jobRecruiters.jobId} = ${jobs.id}
                  AND ${jobRecruiters.recruiterId} = ${actorId}
             )
           )
           AND (
             COALESCE(cardinality(authorized_target.skills), 0) = 0
             OR ${jobs.skills} && authorized_target.skills
           )
         ORDER BY ${applications.aiFitScore} DESC, ${applications.id} ASC
         LIMIT ${limit}
      )
      SELECT authorized_target.job_id AS "authorizedJobId",
             application_id AS "applicationId",
             candidate_name AS "candidateName",
             candidate_email AS "candidateEmail",
             source_job_id AS "sourceJobId",
             source_job_title AS "sourceJobTitle",
             ai_fit_score AS "aiFitScore",
             ai_fit_label AS "aiFitLabel",
             current_stage AS "currentStage"
        FROM authorized_target
        LEFT JOIN candidates ON TRUE
       ORDER BY ai_fit_score DESC NULLS LAST, application_id ASC NULLS LAST
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.some((row) => positiveInteger(row.authorizedJobId) !== jobId)) {
      throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
    }
    if (rows.length === 1 && rows[0]!.applicationId === null) return { ok: true, rows: [] };
    if (rows.some((row) => row.applicationId === null)) throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
    return { ok: true, rows: rows.map((row) => ({
      applicationId: positiveInteger(row.applicationId),
      candidateName: text(row.candidateName),
      candidateEmail: text(row.candidateEmail),
      sourceJobId: positiveInteger(row.sourceJobId),
      sourceJobTitle: text(row.sourceJobTitle),
      aiFitScore: nonNegativeInteger(row.aiFitScore),
      aiFitLabel: nullableText(row.aiFitLabel),
      currentStage: nullablePositiveInteger(row.currentStage),
    })) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function visibleTemplateJoin(actorId: number): SQL {
  return sql`
    INNER JOIN ${emailTemplates}
      ON ${emailTemplates.id} = selected_template_id.value
     AND (
       ${emailTemplates.organizationId} = ${applications.organizationId}
       OR (
         ${emailTemplates.organizationId} IS NULL
         AND (${emailTemplates.isDefault} = TRUE OR ${emailTemplates.createdBy} = ${actorId})
       )
     )
  `;
}

export async function readAuthorizedManualEmailContext(
  actorId: number,
  applicationId: number,
  templateId: number,
  policy: ApplicationAiOutboundPolicy,
): Promise<AuthorizedResult<AuthorizedManualEmailContext>> {
  if (!validBaseInputs(actorId, applicationId, policy) || !isPositiveSafeInteger(templateId)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH selected_template_id(value) AS (VALUES (${templateId}::integer)),
      authorized_context AS MATERIALIZED (
        SELECT ${applications.id} AS application_id,
               ${applications.organizationId} AS organization_id,
               ${applications.name} AS candidate_name,
               ${applications.email} AS candidate_email,
               ${jobs.title} AS job_title,
               COALESCE(NULLIF(TRIM(CONCAT_WS(' ', poster.first_name, poster.last_name)), ''), 'Hiring Team') AS recruiter_name,
               ${emailTemplates.id} AS template_id,
               ${emailTemplates.name} AS template_name,
               ${emailTemplates.templateType} AS template_type,
               ${emailTemplates.subject} AS template_subject,
               ${emailTemplates.body} AS template_body
          FROM ${applications}
          INNER JOIN ${jobs} ON ${jobs.id} = ${applications.jobId}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
          INNER JOIN ${users} AS poster ON poster.id = ${jobs.postedBy}
          CROSS JOIN selected_template_id
          ${visibleTemplateJoin(actorId)}
         WHERE ${applications.id} = ${applicationId}
           AND ${applications.organizationId} IS NOT NULL
           AND ${jobs.organizationId} IS NOT NULL
           AND ${applications.organizationId} = ${jobs.organizationId}
           AND ${applicationPrivacyAllowed(false)}
           AND ${recruiterOrPlatformGrant(actorId, policy.allowPlatformAdmin)}
      )
      SELECT application_id AS "applicationId",
             template_id AS "templateId",
             organization_id AS "organizationId",
             candidate_name AS "candidateName",
             candidate_email AS "candidateEmail",
             job_title AS "jobTitle",
             recruiter_name AS "recruiterName",
             template_name AS "templateName",
             template_type AS "templateType",
             template_subject AS "templateSubject",
             template_body AS "templateBody"
        FROM authorized_context
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
    const row = rows[0]!;
    return { ok: true, value: {
      applicationId: positiveInteger(row.applicationId),
      templateId: positiveInteger(row.templateId),
      organizationId: positiveInteger(row.organizationId),
      candidateName: text(row.candidateName),
      candidateEmail: text(row.candidateEmail),
      jobTitle: text(row.jobTitle),
      recruiterName: text(row.recruiterName),
      templateName: text(row.templateName),
      templateType: text(row.templateType),
      templateSubject: text(row.templateSubject),
      templateBody: text(row.templateBody),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedEmailDraftContext(
  actorId: number,
  applicationId: number,
  templateId: number,
  policy: ApplicationAiOutboundPolicy,
): Promise<AuthorizedResult<AuthorizedEmailDraftContext>> {
  if (!validBaseInputs(actorId, applicationId, policy) || !isPositiveSafeInteger(templateId)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH selected_template_id(value) AS (VALUES (${templateId}::integer)),
      authorized_context AS MATERIALIZED (
        SELECT ${applications.id} AS application_id,
               ${applications.organizationId} AS organization_id,
               ${applications.name} AS candidate_name,
               ${applications.email} AS candidate_email,
               ${jobs.title} AS job_title,
               ${emailTemplates.id} AS template_id,
               ${emailTemplates.subject} AS template_subject,
               ${emailTemplates.body} AS template_body
          FROM ${applications}
          INNER JOIN ${jobs} ON ${jobs.id} = ${applications.jobId}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
          CROSS JOIN selected_template_id
          ${visibleTemplateJoin(actorId)}
         WHERE ${applications.id} = ${applicationId}
           AND ${applications.organizationId} IS NOT NULL
           AND ${jobs.organizationId} IS NOT NULL
           AND ${applications.organizationId} = ${jobs.organizationId}
           AND ${applicationPrivacyAllowed(false)}
           AND ${recruiterOrPlatformGrant(actorId, policy.allowPlatformAdmin)}
      )
      SELECT application_id AS "applicationId",
             template_id AS "templateId",
             organization_id AS "organizationId",
             candidate_name AS "candidateName",
             candidate_email AS "candidateEmail",
             job_title AS "jobTitle",
             template_subject AS "templateSubject",
             template_body AS "templateBody"
        FROM authorized_context
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
    const row = rows[0]!;
    return { ok: true, value: {
      applicationId: positiveInteger(row.applicationId),
      templateId: positiveInteger(row.templateId),
      organizationId: positiveInteger(row.organizationId),
      candidateName: text(row.candidateName),
      candidateEmail: text(row.candidateEmail),
      jobTitle: text(row.jobTitle),
      templateSubject: text(row.templateSubject),
      templateBody: text(row.templateBody),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function recordAuthorizedEmailDraftUsage(
  actorId: number,
  applicationId: number,
  usage: EmailDraftUsage,
  policy: ApplicationAiOutboundPolicy,
): Promise<AuthorizedResult<{ applicationId: number; usageId: number }>> {
  if (!validBaseInputs(actorId, applicationId, policy) || !validDraftUsage(usage)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH selected_template_id(value) AS (VALUES (${usage.templateId}::integer)),
      authorized_context AS MATERIALIZED (
        SELECT ${applications.id} AS application_id,
               ${applications.organizationId} AS organization_id
          FROM ${applications}
          INNER JOIN ${jobs} ON ${jobs.id} = ${applications.jobId}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
          CROSS JOIN selected_template_id
          ${visibleTemplateJoin(actorId)}
         WHERE ${applications.id} = ${applicationId}
           AND ${applications.organizationId} IS NOT NULL
           AND ${jobs.organizationId} IS NOT NULL
           AND ${applications.organizationId} = ${jobs.organizationId}
           AND ${applicationPrivacyAllowed(false)}
           AND ${recruiterOrPlatformGrant(actorId, policy.allowPlatformAdmin)}
      ),
      inserted_usage AS (
        INSERT INTO ${userAiUsage}
          (organization_id,user_id,kind,tokens_in,tokens_out,cost_usd,metadata)
        SELECT organization_id,
               ${actorId},
               'email_draft',
               ${usage.tokensIn},
               ${usage.tokensOut},
               ${usage.costUsd},
               jsonb_build_object(
                 'applicationId', application_id,
                 'templateId', ${usage.templateId}::integer,
                 'tone', ${usage.tone}::text,
                 'durationMs', ${usage.durationMs}::integer
               )
          FROM authorized_context
        RETURNING id
      )
      SELECT authorized_context.application_id AS "applicationId",
             inserted_usage.id AS "usageId"
        FROM authorized_context
        INNER JOIN inserted_usage ON TRUE
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_AI_OUTBOUND_RESULT_INVALID");
    return { ok: true, value: {
      applicationId: positiveInteger(rows[0]!.applicationId),
      usageId: positiveInteger(rows[0]!.usageId),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
