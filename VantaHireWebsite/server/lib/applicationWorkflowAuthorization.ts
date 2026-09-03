import {
  applicationFeedback,
  applicationReviewerNotes,
  applicationReviewerRatings,
  applications,
  applicationStageHistory,
  decisionEvents,
  decisionProjectionOutbox,
  jobRecruiters,
  jobs,
  organizationMembers,
  pipelineStages,
  users,
} from "@shared/schema";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { applicationPrivacyAllowed } from "../storage";

export interface ApplicationWorkflowPolicy {
  allowPlatformAdmin: boolean;
}

export interface StageCommandProjection {
  applicationId: number;
  stageId: number;
  stageName: string;
  changedAt: string | null;
  changed: boolean;
}

export interface InterviewCommandProjection {
  applicationId: number;
  interviewDate: string | null;
  interviewTime: string | null;
  interviewLocation: string | null;
  interviewNotes: string | null;
  updatedAt: string;
}

export interface BulkInterviewItem {
  applicationId: number;
  interviewDate: Date;
  interviewTime: string | null;
  interviewLocation: string;
  interviewNotes: string | null;
}

export interface ReviewerNoteProjection {
  applicationId: number;
  note: {
    id: number;
    authorId: number;
    createdAt: string;
  };
}

export interface ReviewerRatingProjection {
  applicationId: number;
  reviewerId: number;
  rating: number;
  rubricVersion: "application-rating-v1";
  updatedAt: string;
}

export interface FeedbackProjection {
  id: number;
  applicationId: number;
  authorId: number;
  overallScore: number;
  recommendation: "advance" | "hold" | "reject";
  notes: string | null;
  rubricVersion: string;
  createdAt: string;
  updatedAt: string;
  author: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    role: string;
  };
}

export type WorkflowCommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" | "unavailable" };

export type WorkflowReadResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: "not_found" | "unavailable" };

type QueryResult = { rows?: unknown[] };
type UnknownRow = Record<string, unknown>;

const RATING_RUBRIC = "application-rating-v1" as const;
const FEEDBACK_RUBRIC = "team-feedback-v1";

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validPolicy(value: unknown): value is ApplicationWorkflowPolicy {
  return typeof value === "object"
    && value !== null
    && typeof (value as ApplicationWorkflowPolicy).allowPlatformAdmin === "boolean";
}

function rowsFrom(result: unknown): UnknownRow[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows) || !rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
  }
  return rows as UnknownRow[];
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (!isPositiveSafeInteger(parsed)) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
  return parsed;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
  }
  return parsed;
}

function boundedRating(value: unknown): number {
  const rating = positiveInteger(value);
  if (rating > 5) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
  return rating;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
  return value;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function timestamp(value: unknown): string {
  const date = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  if (!date || Number.isNaN(date.getTime())) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
  return date.toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function recommendation(value: unknown): "advance" | "hold" | "reject" {
  if (value !== "advance" && value !== "hold" && value !== "reject") {
    throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
  }
  return value;
}

function actorProjection(value: unknown): FeedbackProjection["author"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
  }
  const actor = value as UnknownRow;
  return {
    id: positiveInteger(actor.id),
    firstName: nullableText(actor.firstName),
    lastName: nullableText(actor.lastName),
    role: text(actor.role),
  };
}

function feedbackProjection(row: UnknownRow): FeedbackProjection {
  return {
    id: positiveInteger(row.id),
    applicationId: positiveInteger(row.applicationId),
    authorId: positiveInteger(row.authorId),
    overallScore: boundedRating(row.overallScore),
    recommendation: recommendation(row.recommendation),
    notes: nullableText(row.notes),
    rubricVersion: text(row.rubricVersion),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
    author: actorProjection(row.author),
  };
}

function recruiterOrPlatformGrant(actorId: number, allowPlatformAdmin: boolean, allowHiringManager: boolean): SQL {
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
    OR (${allowHiringManager} AND actor.role = 'hiring_manager' AND ${jobs.hiringManagerId} = ${actorId})
  )`;
}

function authorizedApplicationSelect(
  actorId: number,
  applicationId: number,
  policy: ApplicationWorkflowPolicy,
  allowHiringManager: boolean,
  projection: SQL = sql``,
  lockRow = true,
): SQL {
  return sql`
    SELECT ${applications.id} AS application_id,
           ${applications.organizationId} AS organization_id,
           ${applications.currentStage} AS current_stage
           ${projection}
      FROM ${applications}
      INNER JOIN ${jobs} ON ${jobs.id} = ${applications.jobId}
      INNER JOIN ${users} AS actor ON actor.id = ${actorId}
     WHERE ${applications.id} = ${applicationId}
       AND ${applications.organizationId} IS NOT NULL
       AND ${jobs.organizationId} IS NOT NULL
       AND ${applications.organizationId} = ${jobs.organizationId}
       AND ${applicationPrivacyAllowed(false)}
       AND ${recruiterOrPlatformGrant(actorId, policy.allowPlatformAdmin, allowHiringManager)}
     ${lockRow ? sql`FOR UPDATE OF ${applications}` : sql``}
  `;
}

function validBaseInputs(actorId: unknown, applicationId: unknown, policy: unknown): boolean {
  return isPositiveSafeInteger(actorId) && isPositiveSafeInteger(applicationId) && validPolicy(policy);
}

export async function moveAuthorizedApplicationStage(
  actorId: number,
  applicationId: number,
  stageId: number,
  notes: string | null,
  eventId: string,
  policy: ApplicationWorkflowPolicy,
): Promise<WorkflowCommandResult<StageCommandProjection>> {
  if (!validBaseInputs(actorId, applicationId, policy) || !isPositiveSafeInteger(stageId) || !validUuid(eventId)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH locked_application AS MATERIALIZED (
        ${authorizedApplicationSelect(actorId, applicationId, policy, false, sql`,
          ${jobs.id} AS job_id,
          CASE
            WHEN ${jobs.jdDigest} IS NOT NULL AND ${jobs.jdDigestVersion} > 0
              THEN ${jobs.jdDigestVersion}
            ELSE NULL
          END AS jd_digest_version,
          ${applications.aiSuggestedAction} AS recommendation_action,
          ${applications.aiSummaryModelVersion} AS recommendation_model_version,
          ${applications.aiDigestVersionUsed} AS recommendation_input_version
        `)}
      ),
      authorized_stage AS MATERIALIZED (
        SELECT ${pipelineStages.id} AS stage_id,
               ${pipelineStages.name} AS stage_name
          FROM ${pipelineStages}
          INNER JOIN locked_application ON TRUE
         WHERE ${pipelineStages.id} = ${stageId}
           AND (
             ${pipelineStages.organizationId} = locked_application.organization_id
             OR (${pipelineStages.organizationId} IS NULL AND ${pipelineStages.isDefault} = TRUE)
           )
      ),
      transition AS MATERIALIZED (
        SELECT locked_application.*,
               authorized_stage.stage_id,
               authorized_stage.stage_name,
               now() AS changed_at,
               nextval('public.decision_event_sequence') AS event_sequence,
               nextval('public.decision_projection_outbox_sequence') AS delivery_sequence
          FROM locked_application
          INNER JOIN authorized_stage ON TRUE
         WHERE locked_application.current_stage IS DISTINCT FROM authorized_stage.stage_id
      ),
      updated_application AS (
        UPDATE ${applications}
           SET current_stage = transition.stage_id,
               stage_changed_at = transition.changed_at,
               stage_changed_by = ${actorId},
               updated_at = transition.changed_at
          FROM transition
         WHERE ${applications.id} = transition.application_id
        RETURNING ${applications.id} AS application_id,
                  ${applications.currentStage} AS stage_id,
                  ${applications.stageChangedAt} AS changed_at
      ),
      inserted_history AS (
        INSERT INTO ${applicationStageHistory} (
          application_id,
          from_stage,
          to_stage,
          changed_by,
          notes,
          changed_at
        )
        SELECT updated_application.application_id,
               transition.current_stage,
               updated_application.stage_id,
               ${actorId},
               ${notes},
               updated_application.changed_at
          FROM updated_application
          INNER JOIN transition ON transition.application_id = updated_application.application_id
        RETURNING 1 AS inserted
      ),
      inserted_event AS (
        INSERT INTO ${decisionEvents} (
          event_id,
          event_sequence,
          aggregate_sequence,
          organization_id,
          aggregate_type,
          aggregate_id,
          job_id,
          actor_user_id,
          requesting_actor_user_id,
          action_code,
          source_surface,
          event_schema_version,
          taxonomy_version,
          rubric_id,
          rubric_version,
          rubric_approval_mode,
          jd_digest_version,
          rating_contract_version,
          recommendation_action,
          recommendation_model_version,
          recommendation_input_version,
          reason_code,
          idempotency_key,
          before_state,
          after_state,
          occurred_at
        )
        SELECT ${eventId}::uuid,
               transition.event_sequence,
               transition.event_sequence,
               transition.organization_id,
               'application',
               transition.application_id,
               transition.job_id,
               ${actorId},
               NULL,
               'application_stage_moved',
               'applications.stage_patch',
               1,
               1,
               NULL,
               NULL,
               NULL,
               transition.jd_digest_version,
               NULL,
               CASE
                 WHEN transition.recommendation_action IN ('advance', 'hold', 'reject')
                   THEN transition.recommendation_action
                 ELSE NULL
               END,
               CASE
                 WHEN transition.recommendation_action IN ('advance', 'hold', 'reject')
                  AND transition.recommendation_model_version IS NOT NULL
                  AND octet_length(btrim(transition.recommendation_model_version)) BETWEEN 1 AND 120
                   THEN btrim(transition.recommendation_model_version)
                 ELSE NULL
               END,
               CASE
                 WHEN transition.recommendation_action IN ('advance', 'hold', 'reject')
                  AND transition.recommendation_input_version > 0
                   THEN transition.recommendation_input_version
                 ELSE NULL
               END,
               NULL,
               NULL,
               jsonb_build_object('stage_id', transition.current_stage),
               jsonb_build_object('stage_id', transition.stage_id),
               transition.changed_at
          FROM transition
          INNER JOIN updated_application
            ON updated_application.application_id = transition.application_id
          INNER JOIN inserted_history ON inserted_history.inserted = 1
        RETURNING 1 AS inserted
      ),
      inserted_intent AS (
        INSERT INTO ${decisionProjectionOutbox} (
          event_id,
          delivery_sequence,
          source_event_sequence,
          organization_id,
          destination,
          payload_schema_version,
          source_system,
          subject_type,
          subject_id,
          job_id,
          action_code,
          taxonomy_version,
          rubric_id,
          rubric_version,
          rubric_approval_mode,
          jd_digest_version,
          recommendation_action,
          reason_code,
          before_state,
          after_state,
          occurred_at
        )
        SELECT ${eventId}::uuid,
               transition.delivery_sequence,
               transition.event_sequence,
               transition.organization_id,
               'memory.organization_decision_inbox.v1',
               1,
               'flow',
               'application',
               transition.application_id,
               transition.job_id,
               'application_stage_moved',
               1,
               NULL,
               NULL,
               NULL,
               transition.jd_digest_version,
               CASE
                 WHEN transition.recommendation_action IN ('advance', 'hold', 'reject')
                   THEN transition.recommendation_action
                 ELSE NULL
               END,
               NULL,
               jsonb_build_object('stage_id', transition.current_stage),
               jsonb_build_object('stage_id', transition.stage_id),
               transition.changed_at
          FROM inserted_event
          INNER JOIN transition ON inserted_event.inserted = 1
        RETURNING 1 AS inserted
      )
      SELECT locked_application.application_id AS "applicationId",
             authorized_stage.stage_id AS "stageId",
             authorized_stage.stage_name AS "stageName",
             updated_application.changed_at AS "changedAt",
             (updated_application.application_id IS NOT NULL) AS "changed"
        FROM locked_application
        INNER JOIN authorized_stage ON TRUE
        LEFT JOIN updated_application
          ON updated_application.application_id = locked_application.application_id
        LEFT JOIN inserted_history
          ON updated_application.application_id IS NOT NULL
        LEFT JOIN inserted_event
          ON updated_application.application_id IS NOT NULL
        LEFT JOIN inserted_intent
          ON updated_application.application_id IS NOT NULL
       WHERE updated_application.application_id IS NULL
          OR (inserted_history.inserted = 1 AND inserted_intent.inserted = 1)
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    const row = rows[0]!;
    return {
      ok: true,
      value: {
        applicationId: positiveInteger(row.applicationId),
        stageId: positiveInteger(row.stageId),
        stageName: text(row.stageName),
        changedAt: row.changedAt === null ? null : timestamp(row.changedAt),
        changed: booleanValue(row.changed),
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function interviewProjection(row: UnknownRow): InterviewCommandProjection {
  return {
    applicationId: positiveInteger(row.applicationId),
    interviewDate: nullableTimestamp(row.interviewDate),
    interviewTime: nullableText(row.interviewTime),
    interviewLocation: nullableText(row.interviewLocation),
    interviewNotes: nullableText(row.interviewNotes),
    updatedAt: timestamp(row.updatedAt),
  };
}

export async function scheduleAuthorizedApplicationInterview(
  actorId: number,
  applicationId: number,
  fields: {
    date: Date | null;
    time: string | null;
    location: string | null;
    notes: string | null;
  },
  policy: ApplicationWorkflowPolicy,
): Promise<WorkflowCommandResult<InterviewCommandProjection>> {
  if (!validBaseInputs(actorId, applicationId, policy) || (fields.date !== null && Number.isNaN(fields.date.getTime()))) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH locked_application AS MATERIALIZED (
        ${authorizedApplicationSelect(actorId, applicationId, policy, false)}
      ),
      updated_application AS (
        UPDATE ${applications}
           SET interview_date = ${fields.date},
               interview_time = ${fields.time},
               interview_location = ${fields.location},
               interview_notes = ${fields.notes},
               updated_at = now()
          FROM locked_application
         WHERE ${applications.id} = locked_application.application_id
        RETURNING ${applications.id} AS "applicationId",
                  ${applications.interviewDate} AS "interviewDate",
                  ${applications.interviewTime} AS "interviewTime",
                  ${applications.interviewLocation} AS "interviewLocation",
                  ${applications.interviewNotes} AS "interviewNotes",
                  ${applications.updatedAt} AS "updatedAt"
      )
      SELECT * FROM updated_application
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    return { ok: true, value: interviewProjection(rows[0]!) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function scheduleAuthorizedBulkApplicationInterviews(
  actorId: number,
  items: BulkInterviewItem[],
  targetStageId: number | null,
  stageNotes: string | null,
  policy: ApplicationWorkflowPolicy,
): Promise<WorkflowCommandResult<InterviewCommandProjection[]>> {
  const ids = items.map((item) => item.applicationId);
  if (
    !isPositiveSafeInteger(actorId)
    || !validPolicy(policy)
    || items.length === 0
    || ids.some((id) => !isPositiveSafeInteger(id))
    || new Set(ids).size !== ids.length
    || items.some((item) => Number.isNaN(item.interviewDate.getTime()))
    || (targetStageId !== null && !isPositiveSafeInteger(targetStageId))
  ) {
    return { ok: false, reason: "unavailable" };
  }

  const valueRows = items.map((item, ordinal) => sql`(
    ${ordinal}::integer,
    ${item.applicationId}::integer,
    ${item.interviewDate}::timestamp,
    ${item.interviewTime}::text,
    ${item.interviewLocation}::text,
    ${item.interviewNotes}::text
  )`);

  try {
    const result = await db.execute(sql`
      WITH requested (
        ordinal,
        application_id,
        interview_date,
        interview_time,
        interview_location,
        interview_notes
      ) AS MATERIALIZED (
        VALUES ${sql.join(valueRows, sql`, `)}
      ),
      locked_application AS MATERIALIZED (
        SELECT requested.*,
               ${applications.organizationId} AS organization_id,
               ${applications.currentStage} AS current_stage_id,
               current_stage."order" AS current_stage_order,
               target_stage.id AS target_stage_id,
               target_stage."order" AS target_stage_order,
               (
                 target_stage.id IS NOT NULL
                 AND (
                   ${applications.currentStage} IS NULL
                   OR current_stage."order" IS NULL
                   OR current_stage."order" < target_stage."order"
                 )
               ) AS should_advance_stage
          FROM requested
          INNER JOIN ${applications} ON ${applications.id} = requested.application_id
          INNER JOIN ${jobs} ON ${jobs.id} = ${applications.jobId}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
          LEFT JOIN ${pipelineStages} AS current_stage
            ON current_stage.id = ${applications.currentStage}
          LEFT JOIN ${pipelineStages} AS target_stage
            ON target_stage.id = ${targetStageId}
           AND (
             target_stage.organization_id = ${applications.organizationId}
             OR (target_stage.organization_id IS NULL AND target_stage.is_default = TRUE)
           )
         WHERE ${applications.organizationId} IS NOT NULL
           AND ${jobs.organizationId} IS NOT NULL
           AND ${applications.organizationId} = ${jobs.organizationId}
           AND ${applicationPrivacyAllowed(false)}
           AND ${recruiterOrPlatformGrant(actorId, policy.allowPlatformAdmin, false)}
           AND (${targetStageId}::integer IS NULL OR target_stage.id IS NOT NULL)
         FOR UPDATE OF ${applications}
      ),
      authorization_count AS MATERIALIZED (
        SELECT (SELECT count(*) FROM requested) AS requested_count,
               (SELECT count(*) FROM locked_application) AS authorized_count
      ),
      updated_application AS (
        UPDATE ${applications}
           SET interview_date = locked_application.interview_date,
               interview_time = locked_application.interview_time,
               interview_location = locked_application.interview_location,
               interview_notes = locked_application.interview_notes,
               current_stage = CASE
                 WHEN locked_application.should_advance_stage THEN locked_application.target_stage_id
                 ELSE ${applications.currentStage}
               END,
               stage_changed_at = CASE
                 WHEN locked_application.should_advance_stage THEN now()
                 ELSE ${applications.stageChangedAt}
               END,
               stage_changed_by = CASE
                 WHEN locked_application.should_advance_stage THEN ${actorId}
                 ELSE ${applications.stageChangedBy}
               END,
               updated_at = now()
          FROM locked_application, authorization_count
         WHERE authorization_count.requested_count = authorization_count.authorized_count
           AND ${applications.id} = locked_application.application_id
        RETURNING ${applications.id} AS application_id,
                  ${applications.interviewDate} AS interview_date,
                  ${applications.interviewTime} AS interview_time,
                  ${applications.interviewLocation} AS interview_location,
                  ${applications.interviewNotes} AS interview_notes,
                  ${applications.updatedAt} AS updated_at
      ),
      inserted_history AS (
        INSERT INTO ${applicationStageHistory} (
          application_id,
          from_stage,
          to_stage,
          changed_by,
          notes,
          changed_at
        )
        SELECT locked_application.application_id,
               locked_application.current_stage_id,
               locked_application.target_stage_id,
               ${actorId},
               ${stageNotes},
               now()
          FROM locked_application
          INNER JOIN updated_application
            ON updated_application.application_id = locked_application.application_id
         WHERE locked_application.should_advance_stage
        RETURNING ${applicationStageHistory.applicationId} AS application_id
      )
      SELECT authorization_count.requested_count AS "requestedCount",
             authorization_count.authorized_count AS "authorizedCount",
             updated_application.application_id AS "applicationId",
             updated_application.interview_date AS "interviewDate",
             updated_application.interview_time AS "interviewTime",
             updated_application.interview_location AS "interviewLocation",
             updated_application.interview_notes AS "interviewNotes",
             updated_application.updated_at AS "updatedAt"
        FROM authorization_count
        LEFT JOIN requested
          ON authorization_count.requested_count = authorization_count.authorized_count
        LEFT JOIN updated_application
          ON updated_application.application_id = requested.application_id
        LEFT JOIN inserted_history
          ON inserted_history.application_id = updated_application.application_id
       ORDER BY requested.ordinal
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    const requestedCount = nonNegativeInteger(rows[0]!.requestedCount);
    const authorizedCount = nonNegativeInteger(rows[0]!.authorizedCount);
    if (requestedCount !== items.length) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    if (authorizedCount !== requestedCount) return { ok: false, reason: "not_found" };
    if (rows.length !== requestedCount || rows.some((row) => row.applicationId === null)) {
      throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    }
    return { ok: true, value: rows.map(interviewProjection) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function addAuthorizedApplicationReviewerNote(
  actorId: number,
  applicationId: number,
  note: string,
  policy: ApplicationWorkflowPolicy,
): Promise<WorkflowCommandResult<ReviewerNoteProjection>> {
  const normalized = typeof note === "string" ? note.trim() : "";
  if (!validBaseInputs(actorId, applicationId, policy) || normalized.length < 1 || normalized.length > 2_000) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH locked_application AS MATERIALIZED (
        ${authorizedApplicationSelect(actorId, applicationId, policy, false)}
      ),
      compatibility_projection AS (
        UPDATE ${applications}
           SET recruiter_notes =
                 COALESCE(${applications.recruiterNotes}, ARRAY[]::text[]) || ARRAY[${normalized}]::text[],
               updated_at = now()
          FROM locked_application
         WHERE ${applications.id} = locked_application.application_id
        RETURNING ${applications.id} AS application_id
      ),
      inserted_note AS (
        INSERT INTO ${applicationReviewerNotes} (
          application_id,
          organization_id,
          author_id,
          note,
          visibility,
          created_at
        )
        SELECT locked_application.application_id,
               locked_application.organization_id,
               ${actorId},
               ${normalized},
               'organization_private',
               now()
          FROM locked_application
          INNER JOIN compatibility_projection
            ON compatibility_projection.application_id = locked_application.application_id
        RETURNING ${applicationReviewerNotes.id} AS "noteId",
                  ${applicationReviewerNotes.applicationId} AS "applicationId",
                  ${applicationReviewerNotes.authorId} AS "authorId",
                  ${applicationReviewerNotes.createdAt} AS "createdAt"
      )
      SELECT * FROM inserted_note
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    const row = rows[0]!;
    return {
      ok: true,
      value: {
        applicationId: positiveInteger(row.applicationId),
        note: {
          id: positiveInteger(row.noteId),
          authorId: positiveInteger(row.authorId),
          createdAt: timestamp(row.createdAt),
        },
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function setAuthorizedApplicationReviewerRating(
  actorId: number,
  applicationId: number,
  rating: number,
  policy: ApplicationWorkflowPolicy,
): Promise<WorkflowCommandResult<ReviewerRatingProjection>> {
  if (!validBaseInputs(actorId, applicationId, policy) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH locked_application AS MATERIALIZED (
        ${authorizedApplicationSelect(actorId, applicationId, policy, false)}
      ),
      upserted_rating AS (
        INSERT INTO ${applicationReviewerRatings} (
          application_id,
          organization_id,
          reviewer_id,
          rating,
          rubric_version,
          created_at,
          updated_at
        )
        SELECT locked_application.application_id,
               locked_application.organization_id,
               ${actorId},
               ${rating},
               ${RATING_RUBRIC},
               now(),
               now()
          FROM locked_application
        ON CONFLICT (application_id, reviewer_id)
        DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          rating = EXCLUDED.rating,
          rubric_version = EXCLUDED.rubric_version,
          updated_at = now()
        RETURNING ${applicationReviewerRatings.applicationId} AS "applicationId",
                  ${applicationReviewerRatings.reviewerId} AS "reviewerId",
                  ${applicationReviewerRatings.rating} AS "rating",
                  ${applicationReviewerRatings.rubricVersion} AS "rubricVersion",
                  ${applicationReviewerRatings.updatedAt} AS "updatedAt"
      )
      SELECT * FROM upserted_rating
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    const row = rows[0]!;
    if (row.rubricVersion !== RATING_RUBRIC) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    return {
      ok: true,
      value: {
        applicationId: positiveInteger(row.applicationId),
        reviewerId: positiveInteger(row.reviewerId),
        rating: boundedRating(row.rating),
        rubricVersion: RATING_RUBRIC,
        updatedAt: timestamp(row.updatedAt),
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedApplicationFeedback(
  actorId: number,
  applicationId: number,
  policy: ApplicationWorkflowPolicy,
): Promise<WorkflowReadResult<FeedbackProjection>> {
  if (!validBaseInputs(actorId, applicationId, policy)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH authorized_application AS MATERIALIZED (
        ${authorizedApplicationSelect(actorId, applicationId, policy, true, sql``, false)}
      )
      SELECT authorized_application.application_id AS "authorizedApplicationId",
             ${applicationFeedback.id} AS "id",
             ${applicationFeedback.applicationId} AS "applicationId",
             ${applicationFeedback.authorId} AS "authorId",
             ${applicationFeedback.overallScore} AS "overallScore",
             ${applicationFeedback.recommendation} AS "recommendation",
             ${applicationFeedback.notes} AS "notes",
             ${applicationFeedback.rubricVersion} AS "rubricVersion",
             ${applicationFeedback.createdAt} AS "createdAt",
             ${applicationFeedback.updatedAt} AS "updatedAt",
             CASE WHEN ${applicationFeedback.id} IS NULL THEN NULL ELSE jsonb_build_object(
               'id', feedback_author.id,
               'firstName', feedback_author.first_name,
               'lastName', feedback_author.last_name,
               'role', feedback_author.role
             ) END AS "author"
        FROM authorized_application
        LEFT JOIN ${applicationFeedback}
          ON ${applicationFeedback.applicationId} = authorized_application.application_id
        LEFT JOIN ${users} AS feedback_author
          ON feedback_author.id = ${applicationFeedback.authorId}
       ORDER BY ${applicationFeedback.createdAt} DESC NULLS LAST, ${applicationFeedback.id} DESC NULLS LAST
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    rows.forEach((row) => {
      if (positiveInteger(row.authorizedApplicationId) !== applicationId) {
        throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
      }
    });
    if (rows.length === 1 && rows[0]!.id === null) return { ok: true, rows: [] };
    if (rows.some((row) => row.id === null)) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    return { ok: true, rows: rows.map(feedbackProjection) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function addAuthorizedApplicationFeedback(
  actorId: number,
  applicationId: number,
  input: {
    overallScore: number;
    recommendation: "advance" | "hold" | "reject";
    notes: string | null;
  },
  policy: ApplicationWorkflowPolicy,
): Promise<WorkflowCommandResult<FeedbackProjection>> {
  if (
    !validBaseInputs(actorId, applicationId, policy)
    || !Number.isInteger(input.overallScore)
    || input.overallScore < 1
    || input.overallScore > 5
    || !["advance", "hold", "reject"].includes(input.recommendation)
    || (input.notes !== null && input.notes.length > 2_000)
  ) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH locked_application AS MATERIALIZED (
        ${authorizedApplicationSelect(actorId, applicationId, policy, true)}
      ),
      inserted_feedback AS (
        INSERT INTO ${applicationFeedback} (
          application_id,
          author_id,
          overall_score,
          recommendation,
          notes,
          rubric_version,
          created_at,
          updated_at
        )
        SELECT locked_application.application_id,
               ${actorId},
               ${input.overallScore},
               ${input.recommendation},
               ${input.notes},
               ${FEEDBACK_RUBRIC},
               now(),
               now()
          FROM locked_application
        RETURNING ${applicationFeedback.id} AS "id",
                  ${applicationFeedback.applicationId} AS "applicationId",
                  ${applicationFeedback.authorId} AS "authorId",
                  ${applicationFeedback.overallScore} AS "overallScore",
                  ${applicationFeedback.recommendation} AS "recommendation",
                  ${applicationFeedback.notes} AS "notes",
                  ${applicationFeedback.rubricVersion} AS "rubricVersion",
                  ${applicationFeedback.createdAt} AS "createdAt",
                  ${applicationFeedback.updatedAt} AS "updatedAt"
      )
      SELECT inserted_feedback.*,
             jsonb_build_object(
               'id', feedback_author.id,
               'firstName', feedback_author.first_name,
               'lastName', feedback_author.last_name,
               'role', feedback_author.role
             ) AS "author"
        FROM inserted_feedback
        INNER JOIN ${users} AS feedback_author ON feedback_author.id = inserted_feedback."authorId"
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    const feedback = feedbackProjection(rows[0]!);
    if (feedback.rubricVersion !== FEEDBACK_RUBRIC) throw new Error("APPLICATION_WORKFLOW_RESULT_INVALID");
    return { ok: true, value: feedback };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
