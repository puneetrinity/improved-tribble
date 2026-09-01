import { jobs, organizationMembers, users } from "@shared/schema";
import { sql } from "drizzle-orm";

import { db } from "../db";

export interface AuthorizationSessionPayload {
  id: number;
  authVersion: number;
}

export type RemoveOrganizationMemberResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" }
  | { ok: false; reason: "conflict"; code: "owner_protected" | "jobs_owned" };

export interface OrganizationMemberRoleProjection {
  id: number;
  userId: number;
  role: "admin" | "member";
  seatAssigned: boolean;
}

export type ChangeOrganizationMemberRoleResult =
  | { ok: true; value: OrganizationMemberRoleProjection }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" }
  | { ok: false; reason: "conflict"; code: "owner_protected" | "role_unchanged" };

export type ReassignOrganizationJobsResult =
  | { ok: true; reassignedCount: number }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" }
  | { ok: false; reason: "conflict"; code: "owner_source" | "invalid_target" };

export type PasswordAuthorizationAdvanceResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "unavailable" };

type QueryResult = { rows?: unknown[] };
type UnknownRow = Record<string, unknown>;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parsePrivilegeGrantId(value: unknown): number | null {
  if (isPositiveSafeInteger(value)) return value;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

export function createAuthorizationSessionPayload(
  user: { id: unknown; authVersion: unknown },
): AuthorizationSessionPayload | null {
  if (!isPositiveSafeInteger(user?.id) || !isPositiveSafeInteger(user?.authVersion)) return null;
  return { id: user.id, authVersion: user.authVersion };
}

export function parseAuthorizationSessionPayload(value: unknown): AuthorizationSessionPayload | null {
  if (isPositiveSafeInteger(value)) return { id: value, authVersion: 1 };
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "authVersion" || keys[1] !== "id") return null;
  if (!isPositiveSafeInteger(record.id) || !isPositiveSafeInteger(record.authVersion)) return null;
  return { id: record.id, authVersion: record.authVersion };
}

function rowsFrom(result: unknown): UnknownRow[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows)
      || !rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("PRIVILEGE_GRANT_REVOCATION_RESULT_INVALID");
  }
  return rows as UnknownRow[];
}

function exactlyOneRow(result: unknown): UnknownRow {
  const rows = rowsFrom(result);
  if (rows.length !== 1) throw new Error("PRIVILEGE_GRANT_REVOCATION_RESULT_INVALID");
  return rows[0]!;
}

function outcome(row: UnknownRow): string {
  if (typeof row.outcome !== "string" || row.outcome.length === 0) {
    throw new Error("PRIVILEGE_GRANT_REVOCATION_RESULT_INVALID");
  }
  return row.outcome;
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (!isPositiveSafeInteger(parsed)) throw new Error("PRIVILEGE_GRANT_REVOCATION_RESULT_INVALID");
  return parsed;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("PRIVILEGE_GRANT_REVOCATION_RESULT_INVALID");
  }
  return parsed;
}

function memberActorContext(actorUserId: number, roles: readonly ("owner" | "admin")[]) {
  return sql`
    seated_actor_memberships AS MATERIALIZED (
      SELECT actor.id AS actor_user_id,
             membership.organization_id AS organization_id
        FROM ${users} AS actor
        INNER JOIN ${organizationMembers} AS membership
          ON membership.user_id = actor.id
         AND membership.seat_assigned = TRUE
       WHERE actor.id = ${actorUserId}
         AND actor.role = 'recruiter'
         AND membership.role IN (${sql.join(roles.map((role) => sql`${role}`), sql`, `)})
    ),
    actor_context AS MATERIALIZED (
      SELECT MIN(actor_user_id)::int AS actor_user_id,
             MIN(organization_id)::int AS organization_id
        FROM seated_actor_memberships
      HAVING COUNT(*) = 1
    )`;
}

export async function removeOrganizationMemberAndRevoke(
  actorUserId: number,
  memberId: number,
): Promise<RemoveOrganizationMemberResult> {
  if (!isPositiveSafeInteger(actorUserId) || !isPositiveSafeInteger(memberId)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH ${memberActorContext(actorUserId, ["owner", "admin"])},
      target AS MATERIALIZED (
        SELECT membership.id, membership.user_id, membership.role
          FROM ${organizationMembers} AS membership
          INNER JOIN actor_context AS actor ON actor.organization_id = membership.organization_id
         WHERE membership.id = ${memberId}
      ),
      deleted AS (
        DELETE FROM ${organizationMembers} AS membership
         USING target
         WHERE membership.id = target.id
           AND target.role <> 'owner'
           AND NOT EXISTS (
             SELECT 1 FROM ${jobs} AS job
              WHERE job.organization_id = (SELECT organization_id FROM actor_context)
                AND job.posted_by = target.user_id
           )
        RETURNING membership.user_id
      ),
      advanced AS (
        UPDATE ${users} AS target_user
           SET auth_version = target_user.auth_version + 1
          FROM deleted
         WHERE target_user.id = deleted.user_id
        RETURNING target_user.id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM actor_context) THEN 'forbidden'
        WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
        WHEN EXISTS (SELECT 1 FROM target WHERE role = 'owner') THEN 'owner_protected'
        WHEN EXISTS (
          SELECT 1 FROM ${jobs} AS job, target
           WHERE job.organization_id = (SELECT organization_id FROM actor_context)
             AND job.posted_by = target.user_id
        ) THEN 'jobs_owned'
        WHEN EXISTS (SELECT 1 FROM advanced) THEN 'ok'
        ELSE 'unavailable'
      END AS outcome
    `);
    switch (outcome(exactlyOneRow(result))) {
      case "ok": return { ok: true };
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      case "owner_protected": return { ok: false, reason: "conflict", code: "owner_protected" };
      case "jobs_owned": return { ok: false, reason: "conflict", code: "jobs_owned" };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function changeOrganizationMemberRoleAndRevoke(
  actorUserId: number,
  memberId: number,
  requestedRole: "admin" | "member",
): Promise<ChangeOrganizationMemberRoleResult> {
  if (!isPositiveSafeInteger(actorUserId)
      || !isPositiveSafeInteger(memberId)
      || !["admin", "member"].includes(requestedRole)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH ${memberActorContext(actorUserId, ["owner"])},
      target AS MATERIALIZED (
        SELECT membership.id, membership.user_id, membership.role, membership.seat_assigned
          FROM ${organizationMembers} AS membership
          INNER JOIN actor_context AS actor ON actor.organization_id = membership.organization_id
         WHERE membership.id = ${memberId}
      ),
      changed AS (
        UPDATE ${organizationMembers} AS membership
           SET role = ${requestedRole}
          FROM target
         WHERE membership.id = target.id
           AND target.role <> 'owner'
           AND target.role <> ${requestedRole}
        RETURNING membership.id,
                  membership.user_id AS "userId",
                  membership.role,
                  membership.seat_assigned AS "seatAssigned"
      ),
      advanced AS (
        UPDATE ${users} AS target_user
           SET auth_version = target_user.auth_version + 1
          FROM changed
         WHERE target_user.id = changed."userId"
        RETURNING target_user.id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM actor_context) THEN 'forbidden'
        WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
        WHEN EXISTS (SELECT 1 FROM target WHERE role = 'owner') THEN 'owner_protected'
        WHEN EXISTS (SELECT 1 FROM target WHERE role = ${requestedRole}) THEN 'role_unchanged'
        WHEN EXISTS (SELECT 1 FROM advanced) THEN 'ok'
        ELSE 'unavailable'
      END AS outcome,
      changed.id,
      changed."userId",
      changed.role,
      changed."seatAssigned"
      FROM (SELECT 1) AS one
      LEFT JOIN changed ON TRUE
    `);
    const row = exactlyOneRow(result);
    switch (outcome(row)) {
      case "ok":
        if ((row.role !== "admin" && row.role !== "member") || typeof row.seatAssigned !== "boolean") {
          return { ok: false, reason: "unavailable" };
        }
        return { ok: true, value: {
          id: positiveInteger(row.id),
          userId: positiveInteger(row.userId),
          role: row.role,
          seatAssigned: row.seatAssigned,
        } };
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      case "owner_protected": return { ok: false, reason: "conflict", code: "owner_protected" };
      case "role_unchanged": return { ok: false, reason: "conflict", code: "role_unchanged" };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function reassignOrganizationJobs(
  actorUserId: number,
  sourceMemberId: number,
  targetUserId: number,
): Promise<ReassignOrganizationJobsResult> {
  if (!isPositiveSafeInteger(actorUserId)
      || !isPositiveSafeInteger(sourceMemberId)
      || !isPositiveSafeInteger(targetUserId)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH ${memberActorContext(actorUserId, ["owner", "admin"])},
      source_member AS MATERIALIZED (
        SELECT membership.id, membership.user_id, membership.role
          FROM ${organizationMembers} AS membership
          INNER JOIN actor_context AS actor ON actor.organization_id = membership.organization_id
         WHERE membership.id = ${sourceMemberId}
      ),
      target_member AS MATERIALIZED (
        SELECT membership.user_id, membership.seat_assigned
          FROM ${organizationMembers} AS membership
          INNER JOIN actor_context AS actor ON actor.organization_id = membership.organization_id
         WHERE membership.user_id = ${targetUserId}
      ),
      reassigned AS (
        UPDATE ${jobs} AS job
           SET posted_by = target_member.user_id,
               updated_at = now()
          FROM source_member, target_member, actor_context
         WHERE job.organization_id = actor_context.organization_id
           AND job.posted_by = source_member.user_id
           AND source_member.role <> 'owner'
           AND target_member.seat_assigned = TRUE
           AND target_member.user_id <> source_member.user_id
        RETURNING job.id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM actor_context) THEN 'forbidden'
        WHEN NOT EXISTS (SELECT 1 FROM source_member)
          OR NOT EXISTS (SELECT 1 FROM target_member) THEN 'not_found'
        WHEN EXISTS (SELECT 1 FROM source_member WHERE role = 'owner') THEN 'owner_source'
        WHEN EXISTS (SELECT 1 FROM target_member WHERE seat_assigned = FALSE)
          OR EXISTS (
            SELECT 1 FROM source_member, target_member
             WHERE source_member.user_id = target_member.user_id
          ) THEN 'invalid_target'
        ELSE 'ok'
      END AS outcome,
      (SELECT COUNT(*)::integer FROM reassigned) AS "reassignedCount"
    `);
    const row = exactlyOneRow(result);
    switch (outcome(row)) {
      case "ok": return { ok: true, reassignedCount: nonNegativeInteger(row.reassignedCount) };
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      case "owner_source": return { ok: false, reason: "conflict", code: "owner_source" };
      case "invalid_target": return { ok: false, reason: "conflict", code: "invalid_target" };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function resetPasswordAndAdvanceAuthorization(
  userId: number,
  passwordHash: string,
): Promise<PasswordAuthorizationAdvanceResult> {
  if (!isPositiveSafeInteger(userId) || typeof passwordHash !== "string" || passwordHash.length === 0) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      UPDATE ${users}
         SET password = ${passwordHash},
             auth_version = auth_version + 1
       WHERE id = ${userId}
      RETURNING id
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1 || positiveInteger(rows[0]!.id) !== userId) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
