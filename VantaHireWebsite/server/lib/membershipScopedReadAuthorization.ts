import { hiringManagerInvitations, jobs, organizationMembers, users } from "@shared/schema";
import { sql } from "drizzle-orm";

import { db } from "../db";

export interface HiringManagerDirectoryProjection {
  id: number;
  username: string;
  firstName: string | null;
  lastName: string | null;
  role: "hiring_manager";
}

export interface MembershipScopedReadPolicy {
  allowPlatformAdmin: boolean;
}

export type AuthorizedHiringManagerDirectoryRead =
  | { ok: true; rows: HiringManagerDirectoryProjection[] }
  | { ok: false; reason: "unavailable" };

type QueryResult = { rows?: unknown[] };
type UnknownRow = Record<string, unknown>;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("MEMBERSHIP_SCOPED_RESULT_INVALID");
  return value;
}

function nullableText(value: unknown): string | null {
  if (value === null) return null;
  return text(value);
}

function positiveInteger(value: unknown): number {
  if (!isPositiveSafeInteger(value)) throw new Error("MEMBERSHIP_SCOPED_RESULT_INVALID");
  return value;
}

function rowsFrom(result: unknown): UnknownRow[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows)
      || !rows.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) {
    throw new Error("MEMBERSHIP_SCOPED_RESULT_INVALID");
  }
  return rows as UnknownRow[];
}

export function parseHiringManagerRoleFilter(value: unknown): "hiring_manager" | null {
  return typeof value === "string" && value === "hiring_manager" ? value : null;
}

export async function readAuthorizedHiringManagerDirectory(
  actorId: number,
  policy: MembershipScopedReadPolicy,
): Promise<AuthorizedHiringManagerDirectoryRead> {
  if (!isPositiveSafeInteger(actorId) || typeof policy?.allowPlatformAdmin !== "boolean") {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT actor.id AS actor_id,
               actor.role AS actor_role,
               seated_membership.organization_id AS organization_id
          FROM ${users} AS actor
          LEFT JOIN ${organizationMembers} AS seated_membership
            ON seated_membership.user_id = actor.id
           AND seated_membership.seat_assigned = TRUE
         WHERE actor.id = ${actorId}
      ),
      eligible_hiring_manager AS (
        SELECT DISTINCT hiring_manager.id AS id,
               hiring_manager.username AS username,
               hiring_manager.first_name AS first_name,
               hiring_manager.last_name AS last_name,
               hiring_manager.role AS role,
               LOWER(hiring_manager.username) AS normalized_username
          FROM ${users} AS hiring_manager
          CROSS JOIN actor_context
         WHERE hiring_manager.role = 'hiring_manager'
           AND (
             (${policy.allowPlatformAdmin} AND actor_context.actor_role = 'super_admin')
             OR (
               actor_context.actor_role = 'recruiter'
               AND actor_context.organization_id IS NOT NULL
               AND (
                 EXISTS (
                   SELECT 1
                     FROM ${jobs}
                    WHERE ${jobs.organizationId} = actor_context.organization_id
                      AND ${jobs.hiringManagerId} = hiring_manager.id
                 )
                 OR EXISTS (
                   SELECT 1
                     FROM ${hiringManagerInvitations}
                    WHERE ${hiringManagerInvitations.authorityScope} = 'organization'
                      AND ${hiringManagerInvitations.organizationId} = actor_context.organization_id
                      AND ${hiringManagerInvitations.status} = 'accepted'
                      AND ${hiringManagerInvitations.acceptedAt} IS NOT NULL
                      AND ${hiringManagerInvitations.acceptedByUserId} = hiring_manager.id
                      AND ${hiringManagerInvitations.revokedAt} IS NULL
                      AND ${hiringManagerInvitations.grantVersion} >= 1
                 )
               )
             )
           )
      )
      SELECT id AS id,
             username AS username,
             first_name AS "firstName",
             last_name AS "lastName",
             role AS role
        FROM eligible_hiring_manager
       ORDER BY normalized_username, id
    `);

    const rows = rowsFrom(result).map((row): HiringManagerDirectoryProjection => {
      if (row.role !== "hiring_manager") throw new Error("MEMBERSHIP_SCOPED_RESULT_INVALID");
      return {
        id: positiveInteger(row.id),
        username: text(row.username),
        firstName: nullableText(row.firstName),
        lastName: nullableText(row.lastName),
        role: "hiring_manager",
      };
    });
    return { ok: true, rows };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
