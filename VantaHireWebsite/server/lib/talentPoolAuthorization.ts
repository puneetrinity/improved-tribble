import {
  organizationMembers,
  talentPool,
  talentPoolMembershipEvents,
  users,
} from "@shared/schema";
import { sql } from "drizzle-orm";

import { privacyAllowedSql } from "../candidate-privacy/decision";
import { db } from "../db";

export const TALENT_POOL_SOURCES = ["external_form", "manual", "import"] as const;
export type TalentPoolSource = (typeof TALENT_POOL_SOURCES)[number];

export interface TalentPoolCandidateProjection {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  source: TalentPoolSource;
  notes: string | null;
  resumeUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TalentPoolObjectPolicy {
  allowPlatformAdmin: boolean;
}

export interface TalentPoolCreateInput {
  name: string;
  email: string;
  phone?: string | null | undefined;
  source: TalentPoolSource;
  notes?: string | null | undefined;
  resumeUrl?: string | null | undefined;
}

export interface TalentPoolEffectivePatch {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
  resumeUrl?: string;
}

export type TalentPoolListResult =
  | { ok: true; rows: TalentPoolCandidateProjection[] }
  | { ok: false; reason: "forbidden" | "unavailable" };

export type TalentPoolReadResult =
  | { ok: true; value: TalentPoolCandidateProjection }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" };

export type TalentPoolCreateContextResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "unavailable" };

export type TalentPoolWriteResult =
  | { ok: true; value: TalentPoolCandidateProjection }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" }
  | { ok: false; reason: "conflict"; code: "candidate_exists" };

export type TalentPoolRemoveResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" };

type QueryResult = { rows?: unknown[] };
type UnknownRow = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVACY_ALLOWED = sql.raw(privacyAllowedSql("talent_pool", "pool.id", { globalUse: false }));

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseTalentPoolId(value: unknown): number | null {
  if (typeof value === "number") return isPositiveSafeInteger(value) ? value : null;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function rowsFrom(result: unknown): UnknownRow[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows)
      || !rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("TALENT_POOL_AUTHORIZATION_RESULT_INVALID");
  }
  return rows as UnknownRow[];
}

function exactlyOneRow(result: unknown): UnknownRow {
  const rows = rowsFrom(result);
  if (rows.length !== 1) throw new Error("TALENT_POOL_AUTHORIZATION_RESULT_INVALID");
  return rows[0]!;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("TALENT_POOL_AUTHORIZATION_RESULT_INVALID");
  return value;
}

function nonEmptyText(value: unknown): string {
  const parsed = text(value);
  if (parsed.length === 0) throw new Error("TALENT_POOL_AUTHORIZATION_RESULT_INVALID");
  return parsed;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (!isPositiveSafeInteger(parsed)) throw new Error("TALENT_POOL_AUTHORIZATION_RESULT_INVALID");
  return parsed;
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error("TALENT_POOL_AUTHORIZATION_RESULT_INVALID");
  }
  return parsed.toISOString();
}

function source(value: unknown): TalentPoolSource {
  if (typeof value !== "string" || !(TALENT_POOL_SOURCES as readonly string[]).includes(value)) {
    throw new Error("TALENT_POOL_AUTHORIZATION_RESULT_INVALID");
  }
  return value as TalentPoolSource;
}

function outcome(value: unknown): string {
  return nonEmptyText(value);
}

function parseCandidate(row: UnknownRow): TalentPoolCandidateProjection {
  return {
    id: positiveInteger(row.id),
    name: nonEmptyText(row.name),
    email: nonEmptyText(row.email),
    phone: nullableText(row.phone),
    source: source(row.source),
    notes: nullableText(row.notes),
    resumeUrl: nullableText(row.resumeUrl),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
  };
}

function parseCandidateArray(value: unknown): TalentPoolCandidateProjection[] {
  if (!Array.isArray(value)
      || !value.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("TALENT_POOL_AUTHORIZATION_RESULT_INVALID");
  }
  return (value as UnknownRow[]).map(parseCandidate);
}

function validPolicy(policy: TalentPoolObjectPolicy): boolean {
  return policy !== null && typeof policy === "object" && typeof policy.allowPlatformAdmin === "boolean";
}

function validOptionalText(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function validCreateInput(input: TalentPoolCreateInput): boolean {
  return input !== null
    && typeof input === "object"
    && typeof input.name === "string"
    && input.name.length > 0
    && typeof input.email === "string"
    && input.email.length > 0
    && (TALENT_POOL_SOURCES as readonly string[]).includes(input.source)
    && validOptionalText(input.phone)
    && validOptionalText(input.notes)
    && validOptionalText(input.resumeUrl);
}

const PATCH_KEYS = new Set<keyof TalentPoolEffectivePatch>(["name", "email", "phone", "notes", "resumeUrl"]);

function validEffectivePatch(patch: TalentPoolEffectivePatch): boolean {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return false;
  const keys = Object.keys(patch) as Array<keyof TalentPoolEffectivePatch>;
  if (keys.length === 0 || keys.some((key) => !PATCH_KEYS.has(key))) return false;
  return keys.every((key) => typeof patch[key] === "string");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

const candidateReturning = sql.raw(`pool.id AS id,
  pool.name AS name,
  pool.email AS email,
  pool.phone AS phone,
  pool.source AS source,
  pool.notes AS notes,
  pool.resume_url AS "resumeUrl",
  pool.created_at AS "createdAt",
  pool.updated_at AS "updatedAt"`);

function recruiterContext(actorUserId: number) {
  return sql`
    seated_memberships AS MATERIALIZED (
      SELECT actor.id AS actor_user_id,
             membership.organization_id AS organization_id
        FROM ${users} AS actor
        INNER JOIN ${organizationMembers} AS membership
          ON membership.user_id = actor.id
         AND membership.seat_assigned = TRUE
       WHERE actor.id = ${actorUserId}
         AND actor.role = 'recruiter'
    ),
    recruiter_context AS MATERIALIZED (
      SELECT MIN(actor_user_id)::int AS actor_user_id,
             MIN(organization_id)::int AS organization_id
        FROM seated_memberships
      HAVING COUNT(*) = 1
    )`;
}

function objectActorGrant(actorUserId: number, allowPlatformAdmin: boolean) {
  return sql`
    ${recruiterContext(actorUserId)},
    stored_actor AS MATERIALIZED (
      SELECT actor.id AS actor_user_id,
             actor.role AS actor_role
        FROM ${users} AS actor
       WHERE actor.id = ${actorUserId}
    ),
    actor_grant AS MATERIALIZED (
      SELECT stored_actor.actor_user_id AS actor_user_id,
             stored_actor.actor_role AS actor_role,
             recruiter_context.organization_id AS organization_id
        FROM stored_actor
        LEFT JOIN recruiter_context
          ON recruiter_context.actor_user_id = stored_actor.actor_user_id
       WHERE (stored_actor.actor_role = 'recruiter' AND recruiter_context.organization_id IS NOT NULL)
          OR (${allowPlatformAdmin} AND stored_actor.actor_role = 'super_admin')
    )`;
}

export async function listAuthorizedTalentPoolCandidates(
  actorUserId: number,
): Promise<TalentPoolListResult> {
  if (!isPositiveSafeInteger(actorUserId)) return { ok: false, reason: "unavailable" };

  try {
    const result = await db.execute(sql`
      WITH ${recruiterContext(actorUserId)},
      authorized_candidates AS MATERIALIZED (
        SELECT ${candidateReturning}
          FROM ${talentPool} AS pool
          INNER JOIN recruiter_context
            ON recruiter_context.organization_id = pool.organization_id
         WHERE pool.organization_id IS NOT NULL
           AND pool.removed_at IS NULL
           AND ${PRIVACY_ALLOWED}
      )
      SELECT CASE WHEN EXISTS (SELECT 1 FROM recruiter_context) THEN 'ok' ELSE 'forbidden' END AS outcome,
             COALESCE((
               SELECT jsonb_agg(to_jsonb(authorized_candidate)
                                ORDER BY authorized_candidate."createdAt" DESC, authorized_candidate.id DESC)
                 FROM authorized_candidates AS authorized_candidate
             ), '[]'::jsonb) AS candidates
    `);
    const row = exactlyOneRow(result);
    if (outcome(row.outcome) === "forbidden") return { ok: false, reason: "forbidden" };
    if (outcome(row.outcome) !== "ok") return { ok: false, reason: "unavailable" };
    return { ok: true, rows: parseCandidateArray(row.candidates) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedTalentPoolCandidate(
  actorUserId: number,
  candidateId: number,
  policy: TalentPoolObjectPolicy,
): Promise<TalentPoolReadResult> {
  if (!isPositiveSafeInteger(actorUserId) || !isPositiveSafeInteger(candidateId) || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH ${objectActorGrant(actorUserId, policy.allowPlatformAdmin)},
      authorized_candidate AS MATERIALIZED (
        SELECT ${candidateReturning}
          FROM ${talentPool} AS pool
          INNER JOIN actor_grant ON TRUE
         WHERE pool.id = ${candidateId}
           AND pool.organization_id IS NOT NULL
           AND pool.removed_at IS NULL
           AND (
             actor_grant.actor_role = 'super_admin'
             OR actor_grant.organization_id = pool.organization_id
           )
           AND ${PRIVACY_ALLOWED}
      )
      SELECT CASE
               WHEN NOT EXISTS (SELECT 1 FROM actor_grant) THEN 'forbidden'
               WHEN NOT EXISTS (SELECT 1 FROM authorized_candidate) THEN 'not_found'
               ELSE 'ok'
             END AS outcome,
             authorized_candidate.*
        FROM (SELECT 1) AS anchor
        LEFT JOIN authorized_candidate ON TRUE
    `);
    const row = exactlyOneRow(result);
    switch (outcome(row.outcome)) {
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      case "ok": return { ok: true, value: parseCandidate(row) };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedTalentPoolCreateContext(
  actorUserId: number,
): Promise<TalentPoolCreateContextResult> {
  if (!isPositiveSafeInteger(actorUserId)) return { ok: false, reason: "unavailable" };

  try {
    const result = await db.execute(sql`
      WITH ${recruiterContext(actorUserId)}
      SELECT CASE WHEN EXISTS (SELECT 1 FROM recruiter_context) THEN 'ok' ELSE 'forbidden' END AS outcome
    `);
    const row = exactlyOneRow(result);
    switch (outcome(row.outcome)) {
      case "ok": return { ok: true };
      case "forbidden": return { ok: false, reason: "forbidden" };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function createAuthorizedTalentPoolCandidate(
  actorUserId: number,
  input: TalentPoolCreateInput,
): Promise<TalentPoolWriteResult> {
  if (!isPositiveSafeInteger(actorUserId) || !validCreateInput(input)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH ${recruiterContext(actorUserId)},
      inserted_candidate AS (
        INSERT INTO ${talentPool} (
          organization_id, email, name, phone, recruiter_id, source, notes, resume_url
        )
        SELECT recruiter_context.organization_id,
               LOWER(${input.email}),
               ${input.name},
               ${input.phone ?? null},
               recruiter_context.actor_user_id,
               ${input.source},
               ${input.notes ?? null},
               ${input.resumeUrl ?? null}
          FROM recruiter_context
        RETURNING id, name, email, phone, source, notes, resume_url AS "resumeUrl",
                  created_at AS "createdAt", updated_at AS "updatedAt"
      )
      SELECT CASE
               WHEN NOT EXISTS (SELECT 1 FROM recruiter_context) THEN 'forbidden'
               WHEN NOT EXISTS (SELECT 1 FROM inserted_candidate) THEN 'unavailable'
               ELSE 'ok'
             END AS outcome,
             inserted_candidate.*
        FROM (SELECT 1) AS anchor
        LEFT JOIN inserted_candidate ON TRUE
    `);
    const row = exactlyOneRow(result);
    switch (outcome(row.outcome)) {
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "ok": return { ok: true, value: parseCandidate(row) };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "conflict", code: "candidate_exists" };
    return { ok: false, reason: "unavailable" };
  }
}

export async function updateAuthorizedTalentPoolCandidate(
  actorUserId: number,
  candidateId: number,
  patch: TalentPoolEffectivePatch,
  policy: TalentPoolObjectPolicy,
): Promise<TalentPoolWriteResult> {
  if (!isPositiveSafeInteger(actorUserId)
      || !isPositiveSafeInteger(candidateId)
      || !validEffectivePatch(patch)
      || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }

  const changeName = patch.name !== undefined;
  const changeEmail = patch.email !== undefined;
  const changePhone = patch.phone !== undefined;
  const changeNotes = patch.notes !== undefined;
  const changeResumeUrl = patch.resumeUrl !== undefined;

  try {
    const result = await db.execute(sql`
      WITH ${objectActorGrant(actorUserId, policy.allowPlatformAdmin)},
      updated_candidate AS (
        UPDATE ${talentPool} AS pool
           SET name = CASE WHEN ${changeName} THEN ${patch.name ?? null} ELSE pool.name END,
               email = CASE WHEN ${changeEmail} THEN LOWER(${patch.email ?? null}) ELSE pool.email END,
               phone = CASE WHEN ${changePhone} THEN ${patch.phone ?? null} ELSE pool.phone END,
               notes = CASE WHEN ${changeNotes} THEN ${patch.notes ?? null} ELSE pool.notes END,
               resume_url = CASE WHEN ${changeResumeUrl} THEN ${patch.resumeUrl ?? null} ELSE pool.resume_url END,
               updated_at = NOW()
          FROM actor_grant
         WHERE pool.id = ${candidateId}
           AND pool.organization_id IS NOT NULL
           AND pool.removed_at IS NULL
           AND (
             actor_grant.actor_role = 'super_admin'
             OR actor_grant.organization_id = pool.organization_id
           )
           AND ${PRIVACY_ALLOWED}
        RETURNING pool.id, pool.name, pool.email, pool.phone, pool.source, pool.notes,
                  pool.resume_url AS "resumeUrl", pool.created_at AS "createdAt",
                  pool.updated_at AS "updatedAt"
      )
      SELECT CASE
               WHEN NOT EXISTS (SELECT 1 FROM actor_grant) THEN 'forbidden'
               WHEN NOT EXISTS (SELECT 1 FROM updated_candidate) THEN 'not_found'
               ELSE 'ok'
             END AS outcome,
             updated_candidate.*
        FROM (SELECT 1) AS anchor
        LEFT JOIN updated_candidate ON TRUE
    `);
    const row = exactlyOneRow(result);
    switch (outcome(row.outcome)) {
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      case "ok": return { ok: true, value: parseCandidate(row) };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "conflict", code: "candidate_exists" };
    return { ok: false, reason: "unavailable" };
  }
}

export async function removeAuthorizedTalentPoolCandidate(
  actorUserId: number,
  candidateId: number,
  eventId: string,
  policy: TalentPoolObjectPolicy,
): Promise<TalentPoolRemoveResult> {
  if (!isPositiveSafeInteger(actorUserId)
      || !isPositiveSafeInteger(candidateId)
      || !isUuid(eventId)
      || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH ${objectActorGrant(actorUserId, policy.allowPlatformAdmin)},
      updated_candidate AS (
        UPDATE ${talentPool} AS pool
           SET removed_at = NOW(),
               removed_by_user_id = ${actorUserId},
               removal_reason = 'organization_pool_removal',
               updated_at = NOW()
          FROM actor_grant
         WHERE pool.id = ${candidateId}
           AND pool.organization_id IS NOT NULL
           AND pool.removed_at IS NULL
           AND (
             actor_grant.actor_role = 'super_admin'
             OR actor_grant.organization_id = pool.organization_id
           )
           AND ${PRIVACY_ALLOWED}
        RETURNING pool.id, pool.organization_id
      ),
      inserted_event AS (
        INSERT INTO ${talentPoolMembershipEvents} (
          event_id, talent_pool_id, organization_id, actor_user_id, event_type, reason_code
        )
        SELECT ${eventId}, updated_candidate.id, updated_candidate.organization_id,
               ${actorUserId}, 'removed', 'organization_pool_removal'
          FROM updated_candidate
        RETURNING event_id
      )
      SELECT CASE
               WHEN NOT EXISTS (SELECT 1 FROM actor_grant) THEN 'forbidden'
               WHEN NOT EXISTS (SELECT 1 FROM updated_candidate) THEN 'not_found'
               WHEN NOT EXISTS (SELECT 1 FROM inserted_event) THEN 'unavailable'
               ELSE 'ok'
             END AS outcome
    `);
    const row = exactlyOneRow(result);
    switch (outcome(row.outcome)) {
      case "ok": return { ok: true };
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function restoreAuthorizedTalentPoolCandidate(
  actorUserId: number,
  candidateId: number,
  eventId: string,
  policy: TalentPoolObjectPolicy,
): Promise<TalentPoolWriteResult> {
  if (!isPositiveSafeInteger(actorUserId)
      || !isPositiveSafeInteger(candidateId)
      || !isUuid(eventId)
      || !validPolicy(policy)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH ${objectActorGrant(actorUserId, policy.allowPlatformAdmin)},
      updated_candidate AS (
        UPDATE ${talentPool} AS pool
           SET removed_at = NULL,
               removed_by_user_id = NULL,
               removal_reason = NULL,
               updated_at = NOW()
          FROM actor_grant
         WHERE pool.id = ${candidateId}
           AND pool.organization_id IS NOT NULL
           AND pool.removed_at IS NOT NULL
           AND (
             actor_grant.actor_role = 'super_admin'
             OR actor_grant.organization_id = pool.organization_id
           )
           AND ${PRIVACY_ALLOWED}
        RETURNING pool.id, pool.organization_id, pool.name, pool.email, pool.phone, pool.source, pool.notes,
                  pool.resume_url AS "resumeUrl", pool.created_at AS "createdAt",
                  pool.updated_at AS "updatedAt"
      ),
      inserted_event AS (
        INSERT INTO ${talentPoolMembershipEvents} (
          event_id, talent_pool_id, organization_id, actor_user_id, event_type, reason_code
        )
        SELECT ${eventId}, updated_candidate.id, updated_candidate.organization_id,
               ${actorUserId}, 'restored', 'operator_restore'
          FROM updated_candidate
        RETURNING event_id
      )
      SELECT CASE
               WHEN NOT EXISTS (SELECT 1 FROM actor_grant) THEN 'forbidden'
               WHEN NOT EXISTS (SELECT 1 FROM updated_candidate) THEN 'not_found'
               WHEN NOT EXISTS (SELECT 1 FROM inserted_event) THEN 'unavailable'
               ELSE 'ok'
             END AS outcome,
             updated_candidate.id,
             updated_candidate.name,
             updated_candidate.email,
             updated_candidate.phone,
             updated_candidate.source,
             updated_candidate.notes,
             updated_candidate."resumeUrl",
             updated_candidate."createdAt",
             updated_candidate."updatedAt"
        FROM (SELECT 1) AS anchor
        LEFT JOIN updated_candidate ON TRUE
    `);
    const row = exactlyOneRow(result);
    switch (outcome(row.outcome)) {
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      case "ok": return { ok: true, value: parseCandidate(row) };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "conflict", code: "candidate_exists" };
    return { ok: false, reason: "unavailable" };
  }
}
