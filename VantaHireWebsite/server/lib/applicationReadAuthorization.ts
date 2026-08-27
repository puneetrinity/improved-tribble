import {
  applicationStageHistory,
  applications,
  emailAuditLog,
  emailTemplates,
  jobRecruiters,
  jobs,
  organizationMembers,
  users,
  whatsappAuditLog,
  whatsappTemplates,
} from "@shared/schema";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { applicationPrivacyAllowed } from "../storage";

export interface ApplicationStageHistoryProjection {
  fromStage: number | null;
  toStage: number;
  changedAt: string;
  notes: string | null;
}

export interface ApplicationEmailHistoryProjection {
  id: number;
  templateName: string;
  templateType: string;
  recipientEmail: string;
  sentAt: string;
  status: string;
  sentBy: { firstName: string; lastName: string } | null;
}

export interface InterviewInviteProjection {
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  interviewDate: string | null;
  interviewTime: string | null;
  interviewLocation: string | null;
  interviewNotes: string | null;
}

export interface ApplicationWhatsAppHistoryProjection {
  templateName: string;
  templateType: string;
  status: string;
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  sentBy: { firstName: string; lastName: string } | null;
}

export type AuthorizedApplicationRead<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: "not_found" | "unavailable" };

export type AuthorizedApplicationInterviewInviteRead =
  | { ok: true; interview: InterviewInviteProjection }
  | { ok: false; reason: "not_found" | "unavailable" };

export interface ApplicationReadPolicy {
  allowPlatformAdmin: boolean;
}

type QueryResult = { rows?: unknown[] };
type UnknownRow = Record<string, unknown>;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parsePositiveDecimalApplicationId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function rowsFrom(result: unknown): UnknownRow[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows)) throw new Error("APPLICATION_AUTHORIZATION_RESULT_INVALID");
  if (!rows.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) {
    throw new Error("APPLICATION_AUTHORIZATION_RESULT_INVALID");
  }
  return rows as UnknownRow[];
}

function positiveInteger(value: unknown): number {
  if (!isPositiveSafeInteger(value)) throw new Error("APPLICATION_AUTHORIZATION_RESULT_INVALID");
  return value;
}

function nullablePositiveInteger(value: unknown): number | null {
  return value === null ? null : positiveInteger(value);
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("APPLICATION_AUTHORIZATION_RESULT_INVALID");
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function isoTimestamp(value: unknown): string {
  const date = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error("APPLICATION_AUTHORIZATION_RESULT_INVALID");
  }
  return date.toISOString();
}

function nullableIsoTimestamp(value: unknown): string | null {
  return value === null ? null : isoTimestamp(value);
}

function sender(value: unknown): { firstName: string; lastName: string } | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("APPLICATION_AUTHORIZATION_RESULT_INVALID");
  }
  const row = value as Record<string, unknown>;
  return {
    firstName: text(row.firstName),
    lastName: text(row.lastName),
  };
}

function validInputs(actorId: unknown, applicationId: unknown, policy: ApplicationReadPolicy): boolean {
  return isPositiveSafeInteger(actorId)
    && isPositiveSafeInteger(applicationId)
    && typeof policy?.allowPlatformAdmin === "boolean";
}

function authorizedApplicationCte(
  actorId: number,
  applicationId: number,
  allowPlatformAdmin: boolean,
  projection: SQL = sql``,
) {
  return sql`
    SELECT ${applications.id} AS application_id
           ${projection}
      FROM ${applications}
      INNER JOIN ${jobs}
        ON ${jobs.id} = ${applications.jobId}
      INNER JOIN ${users} AS actor
        ON actor.id = ${actorId}
     WHERE ${applications.id} = ${applicationId}
       AND ${applications.organizationId} IS NOT NULL
       AND ${jobs.organizationId} IS NOT NULL
       AND ${applications.organizationId} = ${jobs.organizationId}
       AND ${applicationPrivacyAllowed(false)}
       AND (
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
       )
  `;
}

export async function readAuthorizedApplicationInterviewInvite(
  actorId: number,
  applicationId: number,
  policy: ApplicationReadPolicy,
): Promise<AuthorizedApplicationInterviewInviteRead> {
  if (!validInputs(actorId, applicationId, policy)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH authorized_application AS (
        ${authorizedApplicationCte(
          actorId,
          applicationId,
          policy.allowPlatformAdmin,
          sql`,
            ${applications.name} AS candidate_name,
            ${applications.email} AS candidate_email,
            ${jobs.title} AS job_title,
            ${applications.interviewDate} AS interview_date,
            ${applications.interviewTime} AS interview_time,
            ${applications.interviewLocation} AS interview_location,
            ${applications.interviewNotes} AS interview_notes
          `,
        )}
      )
      SELECT authorized_application.candidate_name AS "candidateName",
             authorized_application.candidate_email AS "candidateEmail",
             authorized_application.job_title AS "jobTitle",
             authorized_application.interview_date AS "interviewDate",
             authorized_application.interview_time AS "interviewTime",
             authorized_application.interview_location AS "interviewLocation",
             authorized_application.interview_notes AS "interviewNotes"
        FROM authorized_application
    `);
    const rawRows = rowsFrom(result);
    if (rawRows.length === 0) return { ok: false, reason: "not_found" };
    if (rawRows.length !== 1) throw new Error("APPLICATION_AUTHORIZATION_RESULT_INVALID");
    const row = rawRows[0]!;
    return {
      ok: true,
      interview: {
        candidateName: text(row.candidateName),
        candidateEmail: text(row.candidateEmail),
        jobTitle: text(row.jobTitle),
        interviewDate: nullableIsoTimestamp(row.interviewDate),
        interviewTime: nullableText(row.interviewTime),
        interviewLocation: nullableText(row.interviewLocation),
        interviewNotes: nullableText(row.interviewNotes),
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedApplicationStageHistory(
  actorId: number,
  applicationId: number,
  policy: ApplicationReadPolicy,
): Promise<AuthorizedApplicationRead<ApplicationStageHistoryProjection>> {
  if (!validInputs(actorId, applicationId, policy)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH authorized_application AS (
        ${authorizedApplicationCte(actorId, applicationId, policy.allowPlatformAdmin)}
      )
      SELECT authorized_application.application_id AS "authorizedApplicationId",
             ${applicationStageHistory.fromStage} AS "fromStage",
             ${applicationStageHistory.toStage} AS "toStage",
             ${applicationStageHistory.changedAt} AS "changedAt",
             ${applicationStageHistory.notes} AS notes
        FROM authorized_application
        LEFT JOIN ${applicationStageHistory}
          ON ${applicationStageHistory.applicationId} = authorized_application.application_id
       ORDER BY ${applicationStageHistory.changedAt} DESC NULLS LAST,
                ${applicationStageHistory.id} DESC NULLS LAST
    `);
    const rawRows = rowsFrom(result);
    if (rawRows.length === 0) return { ok: false, reason: "not_found" };

    const rows = rawRows
      .filter((row) => row.toStage !== null)
      .map((row): ApplicationStageHistoryProjection => ({
        fromStage: nullablePositiveInteger(row.fromStage),
        toStage: positiveInteger(row.toStage),
        changedAt: isoTimestamp(row.changedAt),
        notes: nullableText(row.notes),
      }));
    return { ok: true, rows };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedApplicationEmailHistory(
  actorId: number,
  applicationId: number,
  policy: ApplicationReadPolicy,
): Promise<AuthorizedApplicationRead<ApplicationEmailHistoryProjection>> {
  if (!validInputs(actorId, applicationId, policy)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH authorized_application AS (
        ${authorizedApplicationCte(actorId, applicationId, policy.allowPlatformAdmin)}
      )
      SELECT authorized_application.application_id AS "authorizedApplicationId",
             ${emailAuditLog.id} AS id,
             COALESCE(${emailTemplates.name}, 'Manual email') AS "templateName",
             COALESCE(${emailAuditLog.templateType}, 'manual') AS "templateType",
             ${emailAuditLog.recipientEmail} AS "recipientEmail",
             ${emailAuditLog.sentAt} AS "sentAt",
             ${emailAuditLog.status} AS status,
             CASE WHEN sender.id IS NULL THEN NULL
                  ELSE json_build_object(
                    'firstName', COALESCE(sender.first_name, ''),
                    'lastName', COALESCE(sender.last_name, '')
                  )
             END AS "sentBy"
        FROM authorized_application
        LEFT JOIN ${emailAuditLog}
          ON ${emailAuditLog.applicationId} = authorized_application.application_id
        LEFT JOIN ${emailTemplates}
          ON ${emailTemplates.id} = ${emailAuditLog.templateId}
        LEFT JOIN ${users} AS sender
          ON sender.id = ${emailAuditLog.sentBy}
       ORDER BY ${emailAuditLog.sentAt} DESC NULLS LAST,
                ${emailAuditLog.id} DESC NULLS LAST
    `);
    const rawRows = rowsFrom(result);
    if (rawRows.length === 0) return { ok: false, reason: "not_found" };

    const rows = rawRows
      .filter((row) => row.id !== null)
      .map((row): ApplicationEmailHistoryProjection => ({
        id: positiveInteger(row.id),
        templateName: text(row.templateName),
        templateType: text(row.templateType),
        recipientEmail: text(row.recipientEmail),
        sentAt: isoTimestamp(row.sentAt),
        status: text(row.status),
        sentBy: sender(row.sentBy),
      }));
    return { ok: true, rows };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedApplicationWhatsAppHistory(
  actorId: number,
  applicationId: number,
  policy: ApplicationReadPolicy,
): Promise<AuthorizedApplicationRead<ApplicationWhatsAppHistoryProjection>> {
  if (!validInputs(actorId, applicationId, policy)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH authorized_application AS (
        ${authorizedApplicationCte(actorId, applicationId, policy.allowPlatformAdmin)}
      )
      SELECT authorized_application.application_id AS "authorizedApplicationId",
             COALESCE(
               ${whatsappTemplates.name},
               ${whatsappAuditLog.templateType},
               'WhatsApp update'
             ) AS "templateName",
             COALESCE(
               ${whatsappAuditLog.templateType},
               ${whatsappTemplates.templateType},
               'unknown'
             ) AS "templateType",
             ${whatsappAuditLog.status} AS status,
             ${whatsappAuditLog.sentAt} AS "sentAt",
             ${whatsappAuditLog.deliveredAt} AS "deliveredAt",
             ${whatsappAuditLog.readAt} AS "readAt",
             CASE WHEN sender.id IS NULL THEN NULL
                  ELSE json_build_object(
                    'firstName', COALESCE(sender.first_name, ''),
                    'lastName', COALESCE(sender.last_name, '')
                  )
             END AS "sentBy"
        FROM authorized_application
        LEFT JOIN ${whatsappAuditLog}
          ON ${whatsappAuditLog.applicationId} = authorized_application.application_id
        LEFT JOIN ${whatsappTemplates}
          ON ${whatsappTemplates.id} = ${whatsappAuditLog.templateId}
        LEFT JOIN ${users} AS sender
          ON sender.id = ${whatsappAuditLog.sentBy}
       ORDER BY ${whatsappAuditLog.sentAt} DESC NULLS LAST,
                ${whatsappAuditLog.id} DESC NULLS LAST
    `);
    const rawRows = rowsFrom(result);
    if (rawRows.length === 0) return { ok: false, reason: "not_found" };

    const rows = rawRows
      .filter((row) => row.status !== null)
      .map((row): ApplicationWhatsAppHistoryProjection => ({
        templateName: text(row.templateName),
        templateType: text(row.templateType),
        status: text(row.status),
        sentAt: isoTimestamp(row.sentAt),
        deliveredAt: nullableIsoTimestamp(row.deliveredAt),
        readAt: nullableIsoTimestamp(row.readAt),
        sentBy: sender(row.sentBy),
      }));
    return { ok: true, rows };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
