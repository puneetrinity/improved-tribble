import {
  applications,
  clientFeedback,
  clients,
  clientShortlistItems,
  clientShortlists,
  formFields,
  formInvitations,
  formResponses,
  forms,
  hiringManagerInvitations,
  jobRecruiters,
  jobs,
  organizationMembers,
  users,
} from "@shared/schema";
import { sql, type SQL } from "drizzle-orm";

import { db } from "../db";
import { applicationPrivacyAllowed } from "../storage";

export interface ReviewerSharePolicy {
  allowPlatformAdmin: boolean;
}

export type ReviewerShareResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" | "conflict" | "unavailable" };

export type ReviewerShareRowsResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: "not_found" | "unavailable" };

export interface ScopedFormFieldInput {
  type: "short_text" | "long_text" | "yes_no" | "select" | "date" | "file" | "email";
  label: string;
  required: boolean;
  options?: string | null;
  order: number;
}

export interface ScopedFormTemplateInput {
  name: string;
  description?: string | null;
  isPublished: boolean;
  fields: ScopedFormFieldInput[];
}

export interface ScopedFormTemplatePatch {
  name?: string;
  description?: string | null;
  isPublished?: boolean;
  fields?: ScopedFormFieldInput[];
}

export interface ScopedFormFieldProjection extends ScopedFormFieldInput {
  id: number;
  formId: number;
}

export interface ScopedFormTemplateProjection {
  id: number;
  name: string;
  description: string | null;
  isPublished: boolean;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  ownershipScope: "organization" | "personal" | "legacy_private";
  canManage: boolean;
  fields: ScopedFormFieldProjection[];
}

export interface AuthorizedFormResponsesProjection {
  form: { id: number; name: string };
  responses: Array<{
    id: number;
    formName: string;
    submittedAt: string;
    answeredAt: string | null;
    candidateName: string;
  }>;
  total: number;
}

export interface PublicShortlistProjection {
  title: string;
  message: string | null;
  client: { name: string };
  job: { title: string; location: string; type: string };
  candidates: Array<{
    candidateRef: string;
    name: string;
    position: number;
    resumeAvailable: boolean;
    aiSummary: string | null;
    aiFitLabel: string | null;
  }>;
  createdAt: string;
  expiresAt: string | null;
}

export interface PublicResumeLocator {
  locator: string;
  filename: string | null;
  candidateName: string;
}

export interface PublicFeedbackTarget {
  applicationId: number;
  clientId: number;
  shortlistId: number;
  organizationId: number;
}

export interface AuthorizedClientFeedbackProjection {
  id: number;
  recommendation: string;
  notes: string | null;
  rating: number | null;
  createdAt: string;
  clientName: string;
}

export interface InvitationIssuerScope {
  actorId: number;
  actorRole: "recruiter" | "super_admin";
  organizationId: number | null;
  authorityScope: "organization" | "platform";
  inviterName: string;
}

export interface HiringManagerInvitationProjection {
  id: number;
  email: string;
  name: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviterName: string | null;
}

type QueryResult = { rows?: unknown[] };
type UnknownRow = Record<string, unknown>;

const FORM_FIELD_TYPES = new Set([
  "short_text",
  "long_text",
  "yes_no",
  "select",
  "date",
  "file",
  "email",
]);

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseReviewerShareId(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

export function parseCandidateRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}

export function parseShortlistToken(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

function validIssuerScope(value: InvitationIssuerScope): boolean {
  if (!isPositiveSafeInteger(value.actorId)
      || (value.actorRole !== "recruiter" && value.actorRole !== "super_admin")
      || (value.authorityScope !== "organization" && value.authorityScope !== "platform")
      || typeof value.inviterName !== "string" || value.inviterName.trim().length === 0) {
    return false;
  }
  if (value.authorityScope === "organization") {
    return value.actorRole === "recruiter" && isPositiveSafeInteger(value.organizationId);
  }
  return value.actorRole === "super_admin" && value.organizationId === null;
}

function validPolicy(value: unknown): value is ReviewerSharePolicy {
  return typeof value === "object"
    && value !== null
    && typeof (value as ReviewerSharePolicy).allowPlatformAdmin === "boolean";
}

function rowsFrom(result: unknown): UnknownRow[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows)
      || !rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  }
  return rows as UnknownRow[];
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (!isPositiveSafeInteger(parsed)) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  return parsed;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  }
  return parsed;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  return value;
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  return parsed.toISOString();
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function ownershipScope(value: unknown): ScopedFormTemplateProjection["ownershipScope"] {
  if (value !== "organization" && value !== "personal" && value !== "legacy_private") {
    throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  }
  return value;
}

function validFormField(field: unknown): field is ScopedFormFieldInput {
  if (!field || typeof field !== "object" || Array.isArray(field)) return false;
  const value = field as Record<string, unknown>;
  return typeof value.type === "string"
    && FORM_FIELD_TYPES.has(value.type)
    && typeof value.label === "string"
    && value.label.trim().length >= 1
    && value.label.length <= 200
    && typeof value.required === "boolean"
    && (value.options === undefined || value.options === null || typeof value.options === "string")
    && typeof value.order === "number"
    && Number.isSafeInteger(value.order)
    && value.order >= 0;
}

function validFormFields(fields: unknown): fields is ScopedFormFieldInput[] {
  return Array.isArray(fields) && fields.length >= 1 && fields.length <= 50 && fields.every(validFormField);
}

function validTemplateInput(input: unknown): input is ScopedFormTemplateInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as ScopedFormTemplateInput;
  return typeof value.name === "string"
    && value.name.trim().length >= 1
    && value.name.length <= 200
    && (value.description === undefined || value.description === null || typeof value.description === "string")
    && typeof value.isPublished === "boolean"
    && validFormFields(value.fields);
}

function validTemplatePatch(input: unknown): input is ScopedFormTemplatePatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as ScopedFormTemplatePatch;
  return (value.name === undefined
      || (typeof value.name === "string" && value.name.trim().length >= 1 && value.name.length <= 200))
    && (value.description === undefined || value.description === null || typeof value.description === "string")
    && (value.isPublished === undefined || typeof value.isPublished === "boolean")
    && (value.fields === undefined || validFormFields(value.fields));
}

function formGrant(actorId: number, allowPlatformAdmin: boolean, manage: boolean): SQL {
  return sql`(
    (${allowPlatformAdmin} AND actor.role = 'super_admin')
    OR (
      actor.role = 'recruiter'
      AND (
        (
          ${forms.ownershipScope} = 'organization'
          AND ${forms.organizationId} IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM ${organizationMembers}
             WHERE ${organizationMembers.userId} = ${actorId}
               AND ${organizationMembers.organizationId} = ${forms.organizationId}
               AND ${organizationMembers.seatAssigned} = TRUE
          )
          AND ${manage ? sql`${forms.createdBy} = ${actorId}` : sql`(${forms.isPublished} = TRUE OR ${forms.createdBy} = ${actorId})`}
        )
        OR (
          ${forms.ownershipScope} IN ('personal', 'legacy_private')
          AND ${forms.organizationId} IS NULL
          AND ${forms.createdBy} = ${actorId}
        )
      )
    )
  )`;
}

function applicationGrant(actorId: number, allowPlatformAdmin: boolean): SQL {
  return sql`(
    (${allowPlatformAdmin} AND actor.role = 'super_admin')
    OR (
      actor.role = 'recruiter'
      AND EXISTS (
        SELECT 1 FROM ${organizationMembers}
         WHERE ${organizationMembers.userId} = ${actorId}
           AND ${organizationMembers.organizationId} = ${applications.organizationId}
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
  )`;
}

function fieldsJson(fields: ScopedFormFieldInput[]): string {
  return JSON.stringify(fields.map((field) => ({
    type: field.type,
    label: field.label,
    required: field.required,
    options: field.options ?? null,
    field_order: field.order,
  })));
}

function formFieldProjection(value: unknown): ScopedFormFieldProjection {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  }
  const row = value as UnknownRow;
  const type = text(row.type);
  if (!FORM_FIELD_TYPES.has(type)) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  return {
    id: positiveInteger(row.id),
    formId: positiveInteger(row.formId),
    type: type as ScopedFormFieldProjection["type"],
    label: text(row.label),
    required: bool(row.required),
    options: nullableText(row.options),
    order: nonNegativeInteger(row.order),
  };
}

function formTemplateProjection(row: UnknownRow): ScopedFormTemplateProjection {
  if (!Array.isArray(row.fields)) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
  return {
    id: positiveInteger(row.id),
    name: text(row.name),
    description: nullableText(row.description),
    isPublished: bool(row.isPublished),
    createdBy: positiveInteger(row.createdBy),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
    ownershipScope: ownershipScope(row.ownershipScope),
    canManage: bool(row.canManage),
    fields: row.fields.map(formFieldProjection),
  };
}

function templateProjectionSql(): SQL {
  return sql`
    SELECT authorized_form.id AS id,
           authorized_form.name AS name,
           authorized_form.description AS description,
           authorized_form.is_published AS "isPublished",
           authorized_form.created_by AS "createdBy",
           authorized_form.created_at AS "createdAt",
           authorized_form.updated_at AS "updatedAt",
           authorized_form.ownership_scope AS "ownershipScope",
           authorized_form.can_manage AS "canManage",
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id', ${formFields.id},
                 'formId', ${formFields.formId},
                 'type', ${formFields.type},
                 'label', ${formFields.label},
                 'required', ${formFields.required},
                 'options', ${formFields.options},
                 'order', ${formFields.order}
               ) ORDER BY ${formFields.order}, ${formFields.id}
             ) FILTER (WHERE ${formFields.id} IS NOT NULL),
             '[]'::jsonb
           ) AS fields
      FROM authorized_form
      LEFT JOIN ${formFields} ON ${formFields.formId} = authorized_form.id
     GROUP BY authorized_form.id,
              authorized_form.name,
              authorized_form.description,
              authorized_form.is_published,
              authorized_form.created_by,
              authorized_form.created_at,
              authorized_form.updated_at,
              authorized_form.ownership_scope,
              authorized_form.can_manage
     ORDER BY authorized_form.created_at DESC, authorized_form.id DESC
  `;
}

export async function createScopedFormTemplate(
  actorId: number,
  input: ScopedFormTemplateInput,
  policy: ReviewerSharePolicy,
): Promise<ReviewerShareResult<ScopedFormTemplateProjection>> {
  if (!isPositiveSafeInteger(actorId) || !validTemplateInput(input) || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT actor.id AS actor_id,
               actor.role AS actor_role,
               CASE WHEN count(seated_membership.organization_id) = 1
                    THEN max(seated_membership.organization_id) END AS organization_id,
               count(seated_membership.organization_id)::integer AS membership_count
          FROM ${users} AS actor
          LEFT JOIN ${organizationMembers} AS seated_membership
            ON seated_membership.user_id = actor.id
           AND seated_membership.seat_assigned = TRUE
         WHERE actor.id = ${actorId}
         GROUP BY actor.id, actor.role
      ),
      inserted_form AS (
        INSERT INTO ${forms}
          (organization_id,name,description,is_published,created_by,ownership_scope)
        SELECT CASE WHEN actor_role = 'recruiter' THEN organization_id ELSE NULL END,
               ${input.name.trim()},
               ${input.description ?? null},
               ${input.isPublished},
               actor_id,
               CASE WHEN actor_role = 'recruiter' THEN 'organization' ELSE 'personal' END
          FROM actor_context
         WHERE (actor_role = 'recruiter' AND membership_count = 1 AND organization_id IS NOT NULL)
            OR (${policy.allowPlatformAdmin} AND actor_role = 'super_admin')
        RETURNING *
      ),
      inserted_fields AS (
        INSERT INTO ${formFields} (form_id,type,label,required,options,"order")
        SELECT inserted_form.id,
               field.type,
               field.label,
               field.required,
               field.options,
               field.field_order
          FROM inserted_form
          CROSS JOIN jsonb_to_recordset(${fieldsJson(input.fields)}::jsonb)
            AS field(type text,label text,required boolean,options text,field_order integer)
        RETURNING *
      ),
      authorized_form AS MATERIALIZED (
        SELECT inserted_form.*,
               TRUE AS can_manage
          FROM inserted_form
          INNER JOIN inserted_fields ON inserted_fields.form_id = inserted_form.id
         GROUP BY inserted_form.id,
                  inserted_form.organization_id,
                  inserted_form.name,
                  inserted_form.description,
                  inserted_form.is_published,
                  inserted_form.created_by,
                  inserted_form.created_at,
                  inserted_form.updated_at,
                  inserted_form.ownership_scope
      )
      SELECT authorized_form.id AS id,
             authorized_form.name AS name,
             authorized_form.description AS description,
             authorized_form.is_published AS "isPublished",
             authorized_form.created_by AS "createdBy",
             authorized_form.created_at AS "createdAt",
             authorized_form.updated_at AS "updatedAt",
             authorized_form.ownership_scope AS "ownershipScope",
             authorized_form.can_manage AS "canManage",
             jsonb_agg(
               jsonb_build_object(
                 'id', inserted_fields.id,
                 'formId', inserted_fields.form_id,
                 'type', inserted_fields.type,
                 'label', inserted_fields.label,
                 'required', inserted_fields.required,
                 'options', inserted_fields.options,
                 'order', inserted_fields."order"
               ) ORDER BY inserted_fields."order", inserted_fields.id
             ) AS fields
        FROM authorized_form
        INNER JOIN inserted_fields ON inserted_fields.form_id = authorized_form.id
       GROUP BY authorized_form.id,
                authorized_form.name,
                authorized_form.description,
                authorized_form.is_published,
                authorized_form.created_by,
                authorized_form.created_at,
                authorized_form.updated_at,
                authorized_form.ownership_scope,
                authorized_form.can_manage
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    return { ok: true, value: formTemplateProjection(rows[0]!) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function listAuthorizedFormTemplates(
  actorId: number,
  policy: ReviewerSharePolicy,
): Promise<ReviewerShareRowsResult<ScopedFormTemplateProjection>> {
  if (!isPositiveSafeInteger(actorId) || !validPolicy(policy)) return { ok: false, reason: "unavailable" };
  try {
    const result = await db.execute(sql`
      WITH authorized_form AS MATERIALIZED (
        SELECT ${forms.id} AS id,
               ${forms.name} AS name,
               ${forms.description} AS description,
               ${forms.isPublished} AS is_published,
               ${forms.createdBy} AS created_by,
               ${forms.createdAt} AS created_at,
               ${forms.updatedAt} AS updated_at,
               ${forms.ownershipScope} AS ownership_scope,
               (${forms.createdBy} = ${actorId} OR (${policy.allowPlatformAdmin} AND actor.role = 'super_admin')) AS can_manage
          FROM ${forms}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
         WHERE ${formGrant(actorId, policy.allowPlatformAdmin, false)}
      )
      ${templateProjectionSql()}
    `);
    return { ok: true, rows: rowsFrom(result).map(formTemplateProjection) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedFormTemplate(
  actorId: number,
  formId: number,
  policy: ReviewerSharePolicy,
): Promise<ReviewerShareResult<ScopedFormTemplateProjection>> {
  if (!isPositiveSafeInteger(actorId) || !isPositiveSafeInteger(formId) || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH authorized_form AS MATERIALIZED (
        SELECT ${forms.id} AS id,
               ${forms.name} AS name,
               ${forms.description} AS description,
               ${forms.isPublished} AS is_published,
               ${forms.createdBy} AS created_by,
               ${forms.createdAt} AS created_at,
               ${forms.updatedAt} AS updated_at,
               ${forms.ownershipScope} AS ownership_scope,
               (${forms.createdBy} = ${actorId} OR (${policy.allowPlatformAdmin} AND actor.role = 'super_admin')) AS can_manage
          FROM ${forms}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
         WHERE ${forms.id} = ${formId}
           AND ${formGrant(actorId, policy.allowPlatformAdmin, false)}
      )
      ${templateProjectionSql()}
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    return { ok: true, value: formTemplateProjection(rows[0]!) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function updateAuthorizedFormTemplate(
  actorId: number,
  formId: number,
  patch: ScopedFormTemplatePatch,
  policy: ReviewerSharePolicy,
): Promise<ReviewerShareResult<ScopedFormTemplateProjection>> {
  if (!isPositiveSafeInteger(actorId) || !isPositiveSafeInteger(formId)
      || !validTemplatePatch(patch) || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }
  const replaceFields = patch.fields !== undefined;
  try {
    const result = await db.execute(sql`
      WITH authorized_target AS MATERIALIZED (
        SELECT ${forms.id} AS id
          FROM ${forms}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
         WHERE ${forms.id} = ${formId}
           AND ${formGrant(actorId, policy.allowPlatformAdmin, true)}
         FOR UPDATE OF ${forms}
      ),
      updated_form AS (
        UPDATE ${forms}
           SET name = CASE WHEN ${patch.name !== undefined} THEN ${patch.name ?? ""} ELSE ${forms.name} END,
               description = CASE WHEN ${patch.description !== undefined} THEN ${patch.description ?? null} ELSE ${forms.description} END,
               is_published = CASE WHEN ${patch.isPublished !== undefined} THEN ${patch.isPublished ?? false} ELSE ${forms.isPublished} END,
               updated_at = now()
          FROM authorized_target
         WHERE ${forms.id} = authorized_target.id
        RETURNING ${forms}.*
      ),
      deleted_fields AS (
        DELETE FROM ${formFields}
         USING authorized_target
         WHERE ${replaceFields}
           AND ${formFields.formId} = authorized_target.id
        RETURNING ${formFields.id}
      ),
      inserted_fields AS (
        INSERT INTO ${formFields} (form_id,type,label,required,options,"order")
        SELECT authorized_target.id,
               field.type,
               field.label,
               field.required,
               field.options,
               field.field_order
          FROM authorized_target
          CROSS JOIN jsonb_to_recordset(${fieldsJson(patch.fields ?? [{ type: "short_text", label: "unused", required: false, order: 0 }])}::jsonb)
            AS field(type text,label text,required boolean,options text,field_order integer)
         WHERE ${replaceFields}
        RETURNING ${formFields}.*
      ),
      authorized_form AS MATERIALIZED (
        SELECT updated_form.*,
               TRUE AS can_manage
          FROM updated_form
          LEFT JOIN inserted_fields ON TRUE
         GROUP BY updated_form.id,
                  updated_form.organization_id,
                  updated_form.name,
                  updated_form.description,
                  updated_form.is_published,
                  updated_form.created_by,
                  updated_form.created_at,
                  updated_form.updated_at,
                  updated_form.ownership_scope
      ),
      projected_fields AS MATERIALIZED (
        SELECT inserted_fields.id AS id,
               inserted_fields.form_id AS form_id,
               inserted_fields.type AS type,
               inserted_fields.label AS label,
               inserted_fields.required AS required,
               inserted_fields.options AS options,
               inserted_fields."order" AS field_order
          FROM inserted_fields
         WHERE ${replaceFields}
        UNION ALL
        SELECT ${formFields.id},
               ${formFields.formId},
               ${formFields.type},
               ${formFields.label},
               ${formFields.required},
               ${formFields.options},
               ${formFields.order}
          FROM ${formFields}
          INNER JOIN authorized_form ON ${formFields.formId} = authorized_form.id
         WHERE NOT ${replaceFields}
      )
      SELECT authorized_form.id AS id,
             authorized_form.name AS name,
             authorized_form.description AS description,
             authorized_form.is_published AS "isPublished",
             authorized_form.created_by AS "createdBy",
             authorized_form.created_at AS "createdAt",
             authorized_form.updated_at AS "updatedAt",
             authorized_form.ownership_scope AS "ownershipScope",
             authorized_form.can_manage AS "canManage",
             COALESCE(
               jsonb_agg(
                 jsonb_build_object(
                   'id', projected_fields.id,
                   'formId', projected_fields.form_id,
                   'type', projected_fields.type,
                   'label', projected_fields.label,
                   'required', projected_fields.required,
                   'options', projected_fields.options,
                   'order', projected_fields.field_order
                 ) ORDER BY projected_fields.field_order, projected_fields.id
               ) FILTER (WHERE projected_fields.id IS NOT NULL),
               '[]'::jsonb
             ) AS fields
        FROM authorized_form
        LEFT JOIN projected_fields ON projected_fields.form_id = authorized_form.id
       GROUP BY authorized_form.id,
                authorized_form.name,
                authorized_form.description,
                authorized_form.is_published,
                authorized_form.created_by,
                authorized_form.created_at,
                authorized_form.updated_at,
                authorized_form.ownership_scope,
                authorized_form.can_manage
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    return { ok: true, value: formTemplateProjection(rows[0]!) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function deleteAuthorizedFormTemplate(
  actorId: number,
  formId: number,
  policy: ReviewerSharePolicy,
): Promise<ReviewerShareResult<{ id: number }>> {
  if (!isPositiveSafeInteger(actorId) || !isPositiveSafeInteger(formId) || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH authorized_target AS MATERIALIZED (
        SELECT ${forms.id} AS id
          FROM ${forms}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
         WHERE ${forms.id} = ${formId}
           AND ${formGrant(actorId, policy.allowPlatformAdmin, true)}
         FOR UPDATE OF ${forms}
      ),
      deleted_form AS (
        DELETE FROM ${forms}
         USING authorized_target
         WHERE ${forms.id} = authorized_target.id
           AND NOT EXISTS (
             SELECT 1 FROM ${formInvitations}
              WHERE ${formInvitations.formId} = authorized_target.id
           )
        RETURNING ${forms.id} AS id
      )
      SELECT authorized_target.id AS "authorizedId",
             deleted_form.id AS "deletedId"
        FROM authorized_target
        LEFT JOIN deleted_form ON TRUE
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    if (rows[0]!.deletedId === null) return { ok: false, reason: "conflict" };
    return { ok: true, value: { id: positiveInteger(rows[0]!.deletedId) } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedResponsesForForm(
  actorId: number,
  formId: number,
  policy: ReviewerSharePolicy,
): Promise<ReviewerShareResult<AuthorizedFormResponsesProjection>> {
  if (!isPositiveSafeInteger(actorId) || !isPositiveSafeInteger(formId) || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH authorized_form AS MATERIALIZED (
        SELECT ${forms.id} AS form_id,
               ${forms.name} AS form_name,
               ${forms.organizationId} AS organization_id
          FROM ${forms}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
         WHERE ${forms.id} = ${formId}
           AND ${formGrant(actorId, policy.allowPlatformAdmin, false)}
      ),
      authorized_response AS (
        SELECT ${formResponses.id} AS response_id,
               authorized_form.form_name,
               ${formResponses.submittedAt} AS submitted_at,
               ${formInvitations.answeredAt} AS answered_at,
               ${applications.name} AS candidate_name
          FROM authorized_form
          INNER JOIN ${formInvitations}
             ON ${formInvitations.formId} = authorized_form.form_id
            AND ${formInvitations.organizationId} = authorized_form.organization_id
          INNER JOIN ${formResponses}
             ON ${formResponses.invitationId} = ${formInvitations.id}
            AND ${formResponses.organizationId} = authorized_form.organization_id
          INNER JOIN ${applications}
             ON ${applications.id} = ${formResponses.applicationId}
            AND ${applications.id} = ${formInvitations.applicationId}
            AND ${applications.organizationId} = authorized_form.organization_id
          INNER JOIN ${jobs}
             ON ${jobs.id} = ${applications.jobId}
            AND ${jobs.organizationId} = authorized_form.organization_id
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
         WHERE authorized_form.organization_id IS NOT NULL
           AND ${applicationPrivacyAllowed(false)}
           AND ${applicationGrant(actorId, policy.allowPlatformAdmin)}
         ORDER BY ${formResponses.submittedAt} DESC, ${formResponses.id} DESC
      )
      SELECT authorized_form.form_id AS "formId",
             authorized_form.form_name AS "formName",
             authorized_response.response_id AS "responseId",
             authorized_response.form_name AS "responseFormName",
             authorized_response.submitted_at AS "submittedAt",
             authorized_response.answered_at AS "answeredAt",
             authorized_response.candidate_name AS "candidateName"
        FROM authorized_form
        LEFT JOIN authorized_response ON TRUE
       ORDER BY authorized_response.submitted_at DESC NULLS LAST,
                authorized_response.response_id DESC NULLS LAST
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    const header = rows[0]!;
    const responses = rows[0]!.responseId === null
      ? []
      : rows.map((row) => ({
          id: positiveInteger(row.responseId),
          formName: text(row.responseFormName),
          submittedAt: timestamp(row.submittedAt),
          answeredAt: nullableTimestamp(row.answeredAt),
          candidateName: text(row.candidateName),
        }));
    return { ok: true, value: {
      form: { id: positiveInteger(header.formId), name: text(header.formName) },
      responses,
      total: responses.length,
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readPublicClientShortlist(
  token: string,
  resumeKillSwitchEnabled: boolean,
  aiKillSwitchEnabled: boolean,
): Promise<ReviewerShareResult<PublicShortlistProjection>> {
  if (!parseShortlistToken(token)
      || typeof resumeKillSwitchEnabled !== "boolean"
      || typeof aiKillSwitchEnabled !== "boolean") {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH authorized_shortlist AS MATERIALIZED (
        SELECT ${clientShortlists.id} AS shortlist_id,
               COALESCE(${clientShortlists.title}, ${jobs.title}) AS title,
               ${clientShortlists.message} AS message,
               ${clients.name} AS client_name,
               ${jobs.title} AS job_title,
               ${jobs.location} AS job_location,
               ${jobs.type} AS job_type,
               ${clientShortlists.createdAt} AS created_at,
               ${clientShortlists.expiresAt} AS expires_at,
               ${clientShortlists.organizationId} AS organization_id,
               ${clientShortlists.shareResume} AS share_resume,
               ${clientShortlists.shareAiSummary} AS share_ai_summary
          FROM ${clientShortlists}
          INNER JOIN ${clients}
             ON ${clients.id} = ${clientShortlists.clientId}
            AND ${clients.organizationId} = ${clientShortlists.organizationId}
          INNER JOIN ${jobs}
             ON ${jobs.id} = ${clientShortlists.jobId}
            AND ${jobs.clientId} = ${clients.id}
            AND ${jobs.organizationId} = ${clientShortlists.organizationId}
         WHERE ${clientShortlists.token} = ${token}
           AND ${clientShortlists.organizationId} IS NOT NULL
           AND (${clientShortlists.expiresAt} IS NULL OR ${clientShortlists.expiresAt} > now())
      ),
      authorized_item AS (
        SELECT ${clientShortlistItems.publicRef}::text AS candidate_ref,
               ${applications.name} AS candidate_name,
               ${clientShortlistItems.position} AS position,
               (
                 authorized_shortlist.share_resume
                 AND ${resumeKillSwitchEnabled}
                 AND (
                   ${applications.resumeUrl} LIKE 'gs://%'
                   OR ${applications.resumeUrl} ~* '^https?://'
                 )
               ) AS resume_available,
               CASE WHEN authorized_shortlist.share_ai_summary AND ${aiKillSwitchEnabled}
                    THEN ${applications.aiSummary} ELSE NULL END AS ai_summary,
               CASE WHEN authorized_shortlist.share_ai_summary AND ${aiKillSwitchEnabled}
                    THEN ${applications.aiFitLabel} ELSE NULL END AS ai_fit_label
          FROM authorized_shortlist
          INNER JOIN ${clientShortlistItems}
             ON ${clientShortlistItems.shortlistId} = authorized_shortlist.shortlist_id
            AND ${clientShortlistItems.organizationId} = authorized_shortlist.organization_id
          INNER JOIN ${applications}
             ON ${applications.id} = ${clientShortlistItems.applicationId}
            AND ${applications.organizationId} = authorized_shortlist.organization_id
          INNER JOIN ${jobs} AS item_job
             ON item_job.id = ${applications.jobId}
            AND item_job.organization_id = authorized_shortlist.organization_id
         WHERE ${applicationPrivacyAllowed(false)}
         ORDER BY ${clientShortlistItems.position}, ${clientShortlistItems.id}
      )
      SELECT authorized_shortlist.title AS title,
             authorized_shortlist.message AS message,
             authorized_shortlist.client_name AS "clientName",
             authorized_shortlist.job_title AS "jobTitle",
             authorized_shortlist.job_location AS "jobLocation",
             authorized_shortlist.job_type AS "jobType",
             authorized_shortlist.created_at AS "createdAt",
             authorized_shortlist.expires_at AS "expiresAt",
             authorized_item.candidate_ref AS "candidateRef",
             authorized_item.candidate_name AS "candidateName",
             authorized_item.position AS position,
             authorized_item.resume_available AS "resumeAvailable",
             authorized_item.ai_summary AS "aiSummary",
             authorized_item.ai_fit_label AS "aiFitLabel"
        FROM authorized_shortlist
        LEFT JOIN authorized_item ON TRUE
       ORDER BY authorized_item.position NULLS LAST,
                authorized_item.candidate_ref NULLS LAST
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    const header = rows[0]!;
    const candidates = header.candidateRef === null
      ? []
      : rows.map((row) => ({
          candidateRef: text(row.candidateRef),
          name: text(row.candidateName),
          position: nonNegativeInteger(row.position),
          resumeAvailable: bool(row.resumeAvailable),
          aiSummary: nullableText(row.aiSummary),
          aiFitLabel: nullableText(row.aiFitLabel),
        }));
    return { ok: true, value: {
      title: text(header.title),
      message: nullableText(header.message),
      client: { name: text(header.clientName) },
      job: {
        title: text(header.jobTitle),
        location: text(header.jobLocation),
        type: text(header.jobType),
      },
      candidates,
      createdAt: timestamp(header.createdAt),
      expiresAt: nullableTimestamp(header.expiresAt),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readPublicResumeLocator(
  token: string,
  candidateRef: string,
  resumeKillSwitchEnabled: boolean,
): Promise<ReviewerShareResult<PublicResumeLocator>> {
  if (!parseShortlistToken(token) || !parseCandidateRef(candidateRef)
      || typeof resumeKillSwitchEnabled !== "boolean") {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH authorized_resume AS MATERIALIZED (
        SELECT ${applications.resumeUrl} AS locator,
               ${applications.resumeFilename} AS filename,
               ${applications.name} AS candidate_name
          FROM ${clientShortlists}
          INNER JOIN ${clients}
             ON ${clients.id} = ${clientShortlists.clientId}
            AND ${clients.organizationId} = ${clientShortlists.organizationId}
          INNER JOIN ${jobs}
             ON ${jobs.id} = ${clientShortlists.jobId}
            AND ${jobs.clientId} = ${clients.id}
            AND ${jobs.organizationId} = ${clientShortlists.organizationId}
          INNER JOIN ${clientShortlistItems}
             ON ${clientShortlistItems.shortlistId} = ${clientShortlists.id}
            AND ${clientShortlistItems.organizationId} = ${clientShortlists.organizationId}
          INNER JOIN ${applications}
             ON ${applications.id} = ${clientShortlistItems.applicationId}
            AND ${applications.organizationId} = ${clientShortlists.organizationId}
          INNER JOIN ${jobs} AS item_job
             ON item_job.id = ${applications.jobId}
            AND item_job.organization_id = ${clientShortlists.organizationId}
         WHERE ${clientShortlists.token} = ${token}
           AND ${clientShortlistItems.publicRef} = ${candidateRef}::uuid
           AND ${clientShortlists.organizationId} IS NOT NULL
           AND (${clientShortlists.expiresAt} IS NULL OR ${clientShortlists.expiresAt} > now())
           AND ${clientShortlists.shareResume} = TRUE
           AND ${resumeKillSwitchEnabled}
           AND (
             ${applications.resumeUrl} LIKE 'gs://%'
             OR ${applications.resumeUrl} ~* '^https?://'
           )
           AND ${applicationPrivacyAllowed(false)}
      )
      SELECT locator AS locator,
             filename AS filename,
             candidate_name AS "candidateName"
        FROM authorized_resume
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    return { ok: true, value: {
      locator: text(rows[0]!.locator),
      filename: nullableText(rows[0]!.filename),
      candidateName: text(rows[0]!.candidateName),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function resolvePublicFeedbackTarget(
  token: string,
  candidateRef: string,
): Promise<ReviewerShareResult<PublicFeedbackTarget>> {
  if (!parseShortlistToken(token) || !parseCandidateRef(candidateRef)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      SELECT ${applications.id} AS "applicationId",
             ${clients.id} AS "clientId",
             ${clientShortlists.id} AS "shortlistId",
             ${clientShortlists.organizationId} AS "organizationId"
        FROM ${clientShortlists}
        INNER JOIN ${clients}
           ON ${clients.id} = ${clientShortlists.clientId}
          AND ${clients.organizationId} = ${clientShortlists.organizationId}
        INNER JOIN ${jobs}
           ON ${jobs.id} = ${clientShortlists.jobId}
          AND ${jobs.clientId} = ${clients.id}
          AND ${jobs.organizationId} = ${clientShortlists.organizationId}
        INNER JOIN ${clientShortlistItems}
           ON ${clientShortlistItems.shortlistId} = ${clientShortlists.id}
          AND ${clientShortlistItems.organizationId} = ${clientShortlists.organizationId}
        INNER JOIN ${applications}
           ON ${applications.id} = ${clientShortlistItems.applicationId}
          AND ${applications.organizationId} = ${clientShortlists.organizationId}
        INNER JOIN ${jobs} AS item_job
           ON item_job.id = ${applications.jobId}
          AND item_job.organization_id = ${clientShortlists.organizationId}
       WHERE ${clientShortlists.token} = ${token}
         AND ${clientShortlistItems.publicRef} = ${candidateRef}::uuid
         AND ${clientShortlists.organizationId} IS NOT NULL
         AND (${clientShortlists.expiresAt} IS NULL OR ${clientShortlists.expiresAt} > now())
         AND ${applicationPrivacyAllowed(false)}
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    return { ok: true, value: {
      applicationId: positiveInteger(rows[0]!.applicationId),
      clientId: positiveInteger(rows[0]!.clientId),
      shortlistId: positiveInteger(rows[0]!.shortlistId),
      organizationId: positiveInteger(rows[0]!.organizationId),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedClientFeedback(
  actorId: number,
  applicationId: number,
  policy: ReviewerSharePolicy,
): Promise<ReviewerShareRowsResult<AuthorizedClientFeedbackProjection>> {
  if (!isPositiveSafeInteger(actorId) || !isPositiveSafeInteger(applicationId) || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH authorized_application AS MATERIALIZED (
        SELECT ${applications.id} AS application_id,
               ${applications.jobId} AS job_id,
               ${applications.organizationId} AS organization_id
          FROM ${applications}
          INNER JOIN ${jobs} ON ${jobs.id} = ${applications.jobId}
          INNER JOIN ${users} AS actor ON actor.id = ${actorId}
         WHERE ${applications.id} = ${applicationId}
           AND ${applications.organizationId} IS NOT NULL
           AND ${jobs.organizationId} = ${applications.organizationId}
           AND ${applicationPrivacyAllowed(false)}
           AND ${applicationGrant(actorId, policy.allowPlatformAdmin)}
      ),
      authorized_feedback AS (
        SELECT ${clientFeedback.id} AS id,
               ${clientFeedback.recommendation} AS recommendation,
               ${clientFeedback.notes} AS notes,
               ${clientFeedback.rating} AS rating,
               ${clientFeedback.createdAt} AS created_at,
               ${clients.name} AS client_name
          FROM authorized_application
          INNER JOIN ${clientFeedback}
             ON ${clientFeedback.applicationId} = authorized_application.application_id
            AND ${clientFeedback.organizationId} = authorized_application.organization_id
          INNER JOIN ${clients}
             ON ${clients.id} = ${clientFeedback.clientId}
            AND ${clients.organizationId} = authorized_application.organization_id
          INNER JOIN ${clientShortlists}
             ON ${clientShortlists.id} = ${clientFeedback.shortlistId}
            AND ${clientShortlists.clientId} = ${clients.id}
            AND ${clientShortlists.jobId} = authorized_application.job_id
            AND ${clientShortlists.organizationId} = authorized_application.organization_id
         WHERE EXISTS (
           SELECT 1 FROM ${clientShortlistItems}
            WHERE ${clientShortlistItems.shortlistId} = ${clientShortlists.id}
              AND ${clientShortlistItems.applicationId} = authorized_application.application_id
              AND ${clientShortlistItems.organizationId} = authorized_application.organization_id
         )
         ORDER BY ${clientFeedback.createdAt} DESC, ${clientFeedback.id} DESC
      )
      SELECT authorized_application.application_id AS "authorizedApplicationId",
             authorized_feedback.id AS id,
             authorized_feedback.recommendation AS recommendation,
             authorized_feedback.notes AS notes,
             authorized_feedback.rating AS rating,
             authorized_feedback.created_at AS "createdAt",
             authorized_feedback.client_name AS "clientName"
        FROM authorized_application
        LEFT JOIN authorized_feedback ON TRUE
       ORDER BY authorized_feedback.created_at DESC NULLS LAST,
                authorized_feedback.id DESC NULLS LAST
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.some((row) => positiveInteger(row.authorizedApplicationId) !== applicationId)) {
      throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    }
    if (rows.length === 1 && rows[0]!.id === null) return { ok: true, rows: [] };
    return { ok: true, rows: rows.map((row) => ({
      id: positiveInteger(row.id),
      recommendation: text(row.recommendation),
      notes: nullableText(row.notes),
      rating: row.rating === null ? null : positiveInteger(row.rating),
      createdAt: timestamp(row.createdAt),
      clientName: text(row.clientName),
    })) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function resolveInvitationIssuerScope(
  actorId: number,
  policy: ReviewerSharePolicy,
): Promise<ReviewerShareResult<InvitationIssuerScope>> {
  if (!isPositiveSafeInteger(actorId) || !validPolicy(policy)) return { ok: false, reason: "unavailable" };
  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT actor.id AS actor_id,
               actor.role AS actor_role,
               actor.username AS username,
               actor.first_name AS first_name,
               actor.last_name AS last_name,
               CASE WHEN count(seated_membership.organization_id) = 1
                    THEN max(seated_membership.organization_id) END AS organization_id,
               count(seated_membership.organization_id)::integer AS membership_count
          FROM ${users} AS actor
          LEFT JOIN ${organizationMembers} AS seated_membership
            ON seated_membership.user_id = actor.id
           AND seated_membership.seat_assigned = TRUE
         WHERE actor.id = ${actorId}
         GROUP BY actor.id, actor.role, actor.username, actor.first_name, actor.last_name
      )
      SELECT actor_id AS "actorId",
             actor_role AS "actorRole",
             CASE WHEN actor_role = 'recruiter' THEN organization_id ELSE NULL END AS "organizationId",
             CASE WHEN actor_role = 'recruiter' THEN 'organization' ELSE 'platform' END AS "authorityScope",
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), ''), username) AS "inviterName"
        FROM actor_context
       WHERE (actor_role = 'recruiter' AND membership_count = 1 AND organization_id IS NOT NULL)
          OR (${policy.allowPlatformAdmin} AND actor_role = 'super_admin')
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    const actorRole = text(rows[0]!.actorRole);
    const authorityScope = text(rows[0]!.authorityScope);
    if ((actorRole !== "recruiter" && actorRole !== "super_admin")
        || (authorityScope !== "organization" && authorityScope !== "platform")) {
      throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    }
    return { ok: true, value: {
      actorId: positiveInteger(rows[0]!.actorId),
      actorRole,
      organizationId: rows[0]!.organizationId === null ? null : positiveInteger(rows[0]!.organizationId),
      authorityScope,
      inviterName: text(rows[0]!.inviterName),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function invitationProjection(row: UnknownRow): HiringManagerInvitationProjection {
  return {
    id: positiveInteger(row.id),
    email: text(row.email),
    name: nullableText(row.name),
    status: text(row.status),
    expiresAt: timestamp(row.expiresAt),
    createdAt: timestamp(row.createdAt),
    inviterName: nullableText(row.inviterName),
  };
}

export async function replaceAuthorizedHiringManagerInvitation(
  issuer: InvitationIssuerScope,
  email: string,
  name: string | null,
  tokenHash: string,
  expiresAt: Date,
): Promise<ReviewerShareResult<HiringManagerInvitationProjection>> {
  if (!validIssuerScope(issuer)
      || typeof email !== "string" || !email.includes("@") || email.length > 255
      || (name !== null && typeof name !== "string")
      || !/^[0-9a-f]{64}$/.test(tokenHash)
      || !(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT actor.id AS actor_id
          FROM ${users} AS actor
         WHERE actor.id = ${issuer.actorId}
           AND (
             (
               ${issuer.authorityScope} = 'organization'
               AND actor.role = 'recruiter'
               AND EXISTS (
                 SELECT 1 FROM ${organizationMembers}
                  WHERE ${organizationMembers.userId} = actor.id
                    AND ${organizationMembers.organizationId} = ${issuer.organizationId}
                    AND ${organizationMembers.seatAssigned} = TRUE
               )
             )
             OR (${issuer.authorityScope} = 'platform' AND actor.role = 'super_admin')
           )
      ),
      invalidated AS (
        UPDATE ${hiringManagerInvitations}
           SET status = 'expired'
          FROM actor_context
         WHERE ${hiringManagerInvitations.invitedBy} = actor_context.actor_id
           AND ${hiringManagerInvitations.authorityScope} = ${issuer.authorityScope}
           AND ${hiringManagerInvitations.organizationId} IS NOT DISTINCT FROM ${issuer.organizationId}
           AND lower(${hiringManagerInvitations.email}) = lower(${email})
           AND ${hiringManagerInvitations.status} = 'pending'
        RETURNING ${hiringManagerInvitations.id}
      ),
      inserted_invitation AS (
        INSERT INTO ${hiringManagerInvitations}
          (organization_id,authority_scope,email,name,token,invited_by,inviter_name,expires_at,status)
        SELECT ${issuer.organizationId},
               ${issuer.authorityScope},
               lower(${email}),
               ${name},
               ${tokenHash},
               actor_context.actor_id,
               ${issuer.inviterName},
               ${expiresAt},
               'pending'
          FROM actor_context
        RETURNING id,email,name,status,expires_at,created_at,inviter_name
      )
      SELECT id AS id,
             email AS email,
             name AS name,
             status AS status,
             expires_at AS "expiresAt",
             created_at AS "createdAt",
             inviter_name AS "inviterName"
        FROM inserted_invitation
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    return { ok: true, value: invitationProjection(rows[0]!) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function listAuthorizedHiringManagerInvitations(
  issuer: InvitationIssuerScope,
): Promise<ReviewerShareRowsResult<HiringManagerInvitationProjection>> {
  if (!validIssuerScope(issuer)) return { ok: false, reason: "unavailable" };
  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT actor.id AS actor_id,
               actor.role AS actor_role
          FROM ${users} AS actor
         WHERE actor.id = ${issuer.actorId}
           AND (
             (
               ${issuer.authorityScope} = 'organization'
               AND actor.role = 'recruiter'
               AND EXISTS (
                 SELECT 1 FROM ${organizationMembers}
                  WHERE ${organizationMembers.userId} = actor.id
                    AND ${organizationMembers.organizationId} = ${issuer.organizationId}
                    AND ${organizationMembers.seatAssigned} = TRUE
               )
             )
             OR (${issuer.authorityScope} = 'platform' AND actor.role = 'super_admin')
           )
      )
      SELECT ${hiringManagerInvitations.id} AS id,
             ${hiringManagerInvitations.email} AS email,
             ${hiringManagerInvitations.name} AS name,
             ${hiringManagerInvitations.status} AS status,
             ${hiringManagerInvitations.expiresAt} AS "expiresAt",
             ${hiringManagerInvitations.createdAt} AS "createdAt",
             ${hiringManagerInvitations.inviterName} AS "inviterName"
        FROM actor_context
        INNER JOIN ${hiringManagerInvitations} ON TRUE
       WHERE ${hiringManagerInvitations.status} = 'pending'
         AND (
           (actor_context.actor_role = 'super_admin' AND ${issuer.authorityScope} = 'platform')
           OR (
             ${hiringManagerInvitations.authorityScope} = 'organization'
             AND ${hiringManagerInvitations.organizationId} = ${issuer.organizationId}
             AND ${hiringManagerInvitations.invitedBy} = actor_context.actor_id
           )
         )
       ORDER BY ${hiringManagerInvitations.createdAt} DESC, ${hiringManagerInvitations.id} DESC
    `);
    return { ok: true, rows: rowsFrom(result).map(invitationProjection) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function cancelAuthorizedHiringManagerInvitation(
  issuer: InvitationIssuerScope,
  invitationId: number,
): Promise<ReviewerShareResult<{ id: number }>> {
  if (!validIssuerScope(issuer) || !isPositiveSafeInteger(invitationId)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT actor.id AS actor_id,
               actor.role AS actor_role
          FROM ${users} AS actor
         WHERE actor.id = ${issuer.actorId}
           AND (
             (
               ${issuer.authorityScope} = 'organization'
               AND actor.role = 'recruiter'
               AND EXISTS (
                 SELECT 1 FROM ${organizationMembers}
                  WHERE ${organizationMembers.userId} = actor.id
                    AND ${organizationMembers.organizationId} = ${issuer.organizationId}
                    AND ${organizationMembers.seatAssigned} = TRUE
               )
             )
             OR (${issuer.authorityScope} = 'platform' AND actor.role = 'super_admin')
           )
      ),
      deleted_invitation AS (
        DELETE FROM ${hiringManagerInvitations}
         USING actor_context
         WHERE ${hiringManagerInvitations.id} = ${invitationId}
           AND ${hiringManagerInvitations.status} = 'pending'
           AND (
             (actor_context.actor_role = 'super_admin' AND ${issuer.authorityScope} = 'platform')
             OR (
               ${hiringManagerInvitations.authorityScope} = 'organization'
               AND ${hiringManagerInvitations.organizationId} = ${issuer.organizationId}
               AND ${hiringManagerInvitations.invitedBy} = actor_context.actor_id
             )
           )
        RETURNING ${hiringManagerInvitations.id} AS id
      )
      SELECT id AS id FROM deleted_invitation
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) throw new Error("REVIEWER_SHARE_RESULT_INVALID");
    return { ok: true, value: { id: positiveInteger(rows[0]!.id) } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
