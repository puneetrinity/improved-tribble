import { createHash } from "node:crypto";

import {
  hiringManagerInvitations,
  organizationInvites,
  organizationMembers,
  organizations,
  organizationSubscriptions,
  users,
} from "@shared/schema";
import { sql } from "drizzle-orm";

import { db } from "../db";
import { backfillUserRecordsToOrg } from "./organizationService";

export interface OrganizationInviteIssuerProjection {
  id: number;
  email: string;
  role: "member";
  expiresAt: Date;
  createdAt: Date;
}

export interface OrganizationInviteDeliveryContext {
  email: string;
  organizationName: string;
  inviterName: string;
}

export interface OrganizationInvitePreviewProjection {
  organizationName: string;
  email: string;
  role: "member";
  expiresAt: Date;
  inviterName: string;
}

export interface AcceptedOrganizationMembershipProjection {
  id: number;
  organizationId: number;
  userId: number;
  role: "member";
  seatAssigned: true;
}

export interface HiringManagerRegistrationGrant {
  id: number;
  email: string;
  grantVersion: number;
}

export type CreateOrganizationInviteResult =
  | {
      ok: true;
      value: OrganizationInviteIssuerProjection;
      delivery: OrganizationInviteDeliveryContext;
    }
  | { ok: false; reason: "forbidden" | "unavailable" }
  | { ok: false; reason: "conflict"; code: "accepted_history" | "already_member" | "no_seats" };

export type ListOrganizationInvitesResult =
  | { ok: true; rows: OrganizationInviteIssuerProjection[] }
  | { ok: false; reason: "forbidden" | "unavailable" };

export type ReadOrganizationInvitePreviewResult =
  | { ok: true; value: OrganizationInvitePreviewProjection }
  | { ok: false; reason: "not_found" | "unavailable" };

export type CancelOrganizationInviteResult =
  | { ok: true }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" };

export type AcceptOrganizationInviteResult =
  | { ok: true; value: AcceptedOrganizationMembershipProjection }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" }
  | { ok: false; reason: "conflict"; code: "already_member" | "no_seats" };

export type ReadHiringManagerRegistrationGrantResult =
  | { ok: true; value: HiringManagerRegistrationGrant }
  | { ok: false; reason: "not_found" | "unavailable" };

export type AcceptHiringManagerRegistrationGrantResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "unavailable" };

type QueryResult = { rows?: unknown[] };
type UnknownRow = Record<string, unknown>;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseVersionedInvitationId(value: unknown): number | null {
  if (isPositiveSafeInteger(value)) return value;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

export function parseVersionedInvitationToken(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export function hashVersionedInvitationToken(token: string): string | null {
  const canonical = parseVersionedInvitationToken(token);
  return canonical === null ? null : createHash("sha256").update(canonical).digest("hex");
}

export function normalizeVersionedInvitationEmail(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const normalized = value.toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function rowsFrom(result: unknown): UnknownRow[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows)
      || !rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
  }
  return rows as UnknownRow[];
}

function exactlyOneRow(result: unknown): UnknownRow {
  const rows = rowsFrom(result);
  if (rows.length !== 1) throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
  return rows[0]!;
}

function outcome(row: UnknownRow): string {
  if (typeof row.outcome !== "string" || row.outcome.length === 0) {
    throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
  }
  return row.outcome;
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (!isPositiveSafeInteger(parsed)) throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
  return parsed;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
  return value;
}

function date(value: unknown): Date {
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (parsed === null || Number.isNaN(parsed.getTime())) throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
  return parsed;
}

function memberActorContext(actorUserId: number) {
  return sql`
    seated_actor_memberships AS MATERIALIZED (
      SELECT actor.id AS actor_user_id,
             membership.organization_id AS organization_id,
             COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', actor.first_name, actor.last_name)), ''), actor.username) AS inviter_name
        FROM ${users} AS actor
        INNER JOIN ${organizationMembers} AS membership
          ON membership.user_id = actor.id
         AND membership.seat_assigned = TRUE
       WHERE actor.id = ${actorUserId}
         AND actor.role = 'recruiter'
         AND membership.role IN ('owner', 'admin')
    ),
    actor_context AS MATERIALIZED (
      SELECT MIN(actor_user_id)::integer AS actor_user_id,
             MIN(organization_id)::integer AS organization_id,
             MIN(inviter_name) AS inviter_name
        FROM seated_actor_memberships
      HAVING COUNT(*) = 1
    )`;
}

function issuerProjection(row: UnknownRow): OrganizationInviteIssuerProjection {
  if (row.role !== "member") throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
  return {
    id: positiveInteger(row.id),
    email: text(row.email),
    role: "member",
    expiresAt: date(row.expiresAt),
    createdAt: date(row.createdAt),
  };
}

export async function createOrResendOrganizationInvite(
  actorUserId: number,
  emailInput: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<CreateOrganizationInviteResult> {
  const email = normalizeVersionedInvitationEmail(emailInput);
  if (!isPositiveSafeInteger(actorUserId)
      || email === null
      || !/^[0-9a-f]{64}$/.test(tokenHash)
      || !(expiresAt instanceof Date)
      || Number.isNaN(expiresAt.getTime())
      || expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH ${memberActorContext(actorUserId)},
      locked_history AS MATERIALIZED (
        SELECT invitation.id, invitation.version, invitation.state
          FROM ${organizationInvites} AS invitation
          INNER JOIN actor_context AS actor
            ON actor.organization_id = invitation.organization_id
         WHERE LOWER(invitation.email) = ${email}
         ORDER BY invitation.version DESC, invitation.id DESC
         FOR UPDATE
      ),
      accepted_history AS MATERIALIZED (
        SELECT 1 FROM locked_history WHERE state = 'accepted' LIMIT 1
      ),
      current_pending AS MATERIALIZED (
        SELECT invitation.id, invitation.version
          FROM ${organizationInvites} AS invitation
          INNER JOIN actor_context AS actor
            ON actor.organization_id = invitation.organization_id
         WHERE LOWER(invitation.email) = ${email}
           AND invitation.state = 'pending'
         ORDER BY invitation.version DESC, invitation.id DESC
         LIMIT 1
      ),
      existing_member AS MATERIALIZED (
        SELECT 1
          FROM ${users} AS target_user
          INNER JOIN ${organizationMembers} AS membership ON membership.user_id = target_user.id
         WHERE LOWER(target_user.username) = ${email}
         LIMIT 1
      ),
      seat_capacity AS MATERIALIZED (
        SELECT COALESCE(subscription.seats, 1)::integer AS seats,
               COUNT(membership.id) FILTER (WHERE membership.seat_assigned = TRUE)::integer AS assigned
          FROM actor_context AS actor
          LEFT JOIN ${organizationSubscriptions} AS subscription
            ON subscription.organization_id = actor.organization_id
          LEFT JOIN ${organizationMembers} AS membership
            ON membership.organization_id = actor.organization_id
         GROUP BY subscription.seats
      ),
      eligible AS MATERIALIZED (
        SELECT actor.actor_user_id, actor.organization_id, actor.inviter_name
          FROM actor_context AS actor, seat_capacity
         WHERE NOT EXISTS (SELECT 1 FROM accepted_history)
           AND NOT EXISTS (SELECT 1 FROM existing_member)
           AND seat_capacity.assigned < seat_capacity.seats
      ),
      superseded AS (
        UPDATE ${organizationInvites} AS invitation
           SET state = 'superseded',
               superseded_at = now()
          FROM current_pending, eligible
         WHERE invitation.id = current_pending.id
           AND invitation.version = current_pending.version
           AND invitation.state = 'pending'
        RETURNING invitation.id
      ),
      inserted AS (
        INSERT INTO ${organizationInvites} (
          organization_id, email, role, token, expires_at, invited_by,
          state, version, created_at
        )
        SELECT eligible.organization_id,
               ${email},
               'member',
               ${tokenHash},
               ${expiresAt},
               eligible.actor_user_id,
               'pending',
               COALESCE((SELECT MAX(version) FROM locked_history), 0) + 1,
               now()
          FROM eligible
         WHERE NOT EXISTS (SELECT 1 FROM current_pending)
            OR EXISTS (SELECT 1 FROM superseded)
        RETURNING id, email, role, expires_at, created_at, organization_id, invited_by
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM actor_context) THEN 'forbidden'
        WHEN EXISTS (SELECT 1 FROM accepted_history) THEN 'accepted_history'
        WHEN EXISTS (SELECT 1 FROM existing_member) THEN 'already_member'
        WHEN EXISTS (SELECT 1 FROM seat_capacity WHERE assigned >= seats) THEN 'no_seats'
        WHEN EXISTS (SELECT 1 FROM inserted) THEN 'ok'
        ELSE 'unavailable'
      END AS outcome,
      inserted.id,
      inserted.email,
      inserted.role,
      inserted.expires_at AS "expiresAt",
      inserted.created_at AS "createdAt",
      organization.name AS "organizationName",
      actor_context.inviter_name AS "inviterName"
      FROM (SELECT 1) AS one
      LEFT JOIN inserted ON TRUE
      LEFT JOIN actor_context ON TRUE
      LEFT JOIN ${organizations} AS organization
        ON organization.id = actor_context.organization_id
    `);
    const row = exactlyOneRow(result);
    switch (outcome(row)) {
      case "ok":
        return {
          ok: true,
          value: issuerProjection(row),
          delivery: {
            email: text(row.email),
            organizationName: text(row.organizationName),
            inviterName: text(row.inviterName),
          },
        };
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "accepted_history": return { ok: false, reason: "conflict", code: "accepted_history" };
      case "already_member": return { ok: false, reason: "conflict", code: "already_member" };
      case "no_seats": return { ok: false, reason: "conflict", code: "no_seats" };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function listOrganizationInvites(
  actorUserId: number,
): Promise<ListOrganizationInvitesResult> {
  if (!isPositiveSafeInteger(actorUserId)) return { ok: false, reason: "unavailable" };
  try {
    const result = await db.execute(sql`
      WITH ${memberActorContext(actorUserId)},
      visible AS MATERIALIZED (
        SELECT invitation.id,
               invitation.email,
               invitation.role,
               invitation.expires_at AS "expiresAt",
               invitation.created_at AS "createdAt"
          FROM ${organizationInvites} AS invitation
          INNER JOIN actor_context AS actor
            ON actor.organization_id = invitation.organization_id
         WHERE invitation.state = 'pending'
         ORDER BY invitation.created_at DESC, invitation.id DESC
      )
      SELECT CASE WHEN EXISTS (SELECT 1 FROM actor_context) THEN 'ok' ELSE 'forbidden' END AS outcome,
             COALESCE(
               (SELECT jsonb_agg(jsonb_build_object(
                 'id', visible.id,
                 'email', visible.email,
                 'role', visible.role,
                 'expiresAt', visible."expiresAt",
                 'createdAt', visible."createdAt"
               ) ORDER BY visible."createdAt" DESC, visible.id DESC) FROM visible),
               '[]'::jsonb
             ) AS invitations
    `);
    const row = exactlyOneRow(result);
    if (outcome(row) === "forbidden") return { ok: false, reason: "forbidden" };
    if (outcome(row) !== "ok" || !Array.isArray(row.invitations)) {
      return { ok: false, reason: "unavailable" };
    }
    return {
      ok: true,
      rows: row.invitations.map((value) => {
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
        }
        return issuerProjection(value as UnknownRow);
      }),
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readOrganizationInvitePreview(
  token: string,
): Promise<ReadOrganizationInvitePreviewResult> {
  const tokenHash = hashVersionedInvitationToken(token);
  if (tokenHash === null) return { ok: false, reason: "not_found" };
  try {
    const result = await db.execute(sql`
      SELECT organization.name AS "organizationName",
             invitation.email AS email,
             invitation.role AS role,
             invitation.expires_at AS "expiresAt",
             COALESCE(
               NULLIF(BTRIM(CONCAT_WS(' ', inviter.first_name, inviter.last_name)), ''),
               inviter.username,
               'A team member'
             ) AS "inviterName"
        FROM ${organizationInvites} AS invitation
        INNER JOIN ${organizations} AS organization ON organization.id = invitation.organization_id
        LEFT JOIN ${users} AS inviter ON inviter.id = invitation.invited_by
       WHERE invitation.token = ${tokenHash}
         AND invitation.state = 'pending'
         AND invitation.expires_at > now()
       LIMIT 1
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1 || rows[0]!.role !== "member") return { ok: false, reason: "unavailable" };
    const row = rows[0]!;
    return { ok: true, value: {
      organizationName: text(row.organizationName),
      email: text(row.email),
      role: "member",
      expiresAt: date(row.expiresAt),
      inviterName: text(row.inviterName),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function cancelOrganizationInvite(
  actorUserId: number,
  invitationId: number,
): Promise<CancelOrganizationInviteResult> {
  if (!isPositiveSafeInteger(actorUserId) || !isPositiveSafeInteger(invitationId)) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const result = await db.execute(sql`
      WITH ${memberActorContext(actorUserId)},
      target AS MATERIALIZED (
        SELECT invitation.id, invitation.version
          FROM ${organizationInvites} AS invitation
          INNER JOIN actor_context AS actor
            ON actor.organization_id = invitation.organization_id
         WHERE invitation.id = ${invitationId}
           AND invitation.state = 'pending'
      ),
      changed AS (
        UPDATE ${organizationInvites} AS invitation
           SET state = 'cancelled',
               cancelled_at = now(),
               cancelled_by = actor_context.actor_user_id
          FROM target, actor_context
         WHERE invitation.id = target.id
           AND invitation.version = target.version
           AND invitation.state = 'pending'
        RETURNING invitation.id
      )
      SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM actor_context) THEN 'forbidden'
        WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
        WHEN EXISTS (SELECT 1 FROM changed) THEN 'ok'
        ELSE 'not_found'
      END AS outcome
    `);
    switch (outcome(exactlyOneRow(result))) {
      case "ok": return { ok: true };
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function acceptOrganizationInvite(
  token: string,
  actorUserId: number,
): Promise<AcceptOrganizationInviteResult> {
  const tokenHash = hashVersionedInvitationToken(token);
  if (tokenHash === null || !isPositiveSafeInteger(actorUserId)) {
    return { ok: false, reason: "not_found" };
  }

  try {
    return await db.transaction(async (tx: any): Promise<AcceptOrganizationInviteResult> => {
      const result = await tx.execute(sql`
        WITH presented AS MATERIALIZED (
          SELECT invitation.id,
                 invitation.organization_id,
                 invitation.email,
                 invitation.role,
                 invitation.invited_by,
                 invitation.version
            FROM ${organizationInvites} AS invitation
           WHERE invitation.token = ${tokenHash}
             AND invitation.state = 'pending'
             AND invitation.expires_at > now()
           FOR UPDATE
        ),
        account AS MATERIALIZED (
          SELECT account.id, account.username, account.email_verified
            FROM ${users} AS account
           WHERE account.id = ${actorUserId}
           FOR UPDATE
        ),
        existing_membership AS MATERIALIZED (
          SELECT membership.id
            FROM ${organizationMembers} AS membership
           WHERE membership.user_id = ${actorUserId}
           LIMIT 1
        ),
        seat_capacity AS MATERIALIZED (
          SELECT COALESCE(subscription.seats, 1)::integer AS seats,
                 COUNT(membership.id) FILTER (WHERE membership.seat_assigned = TRUE)::integer AS assigned
            FROM presented
            LEFT JOIN ${organizationSubscriptions} AS subscription
              ON subscription.organization_id = presented.organization_id
            LEFT JOIN ${organizationMembers} AS membership
              ON membership.organization_id = presented.organization_id
           GROUP BY subscription.seats
        ),
        accepted AS (
          UPDATE ${organizationInvites} AS invitation
             SET state = 'accepted',
                 accepted_at = now(),
                 accepted_by = account.id
            FROM presented, account, seat_capacity
           WHERE invitation.id = presented.id
             AND invitation.version = presented.version
             AND invitation.state = 'pending'
             AND account.email_verified = TRUE
             AND LOWER(account.username) = LOWER(presented.email)
             AND presented.role = 'member'
             AND NOT EXISTS (SELECT 1 FROM existing_membership)
             AND seat_capacity.assigned < seat_capacity.seats
          RETURNING invitation.id,
                    invitation.organization_id,
                    invitation.invited_by,
                    invitation.role
        ),
        inserted AS (
          INSERT INTO ${organizationMembers} (
            organization_id, user_id, role, seat_assigned, invited_by, joined_at
          )
          SELECT accepted.organization_id,
                 ${actorUserId},
                 accepted.role,
                 TRUE,
                 accepted.invited_by,
                 now()
            FROM accepted
          RETURNING id,
                    organization_id AS "organizationId",
                    user_id AS "userId",
                    role,
                    seat_assigned AS "seatAssigned"
        )
        SELECT CASE
          WHEN NOT EXISTS (SELECT 1 FROM presented) THEN 'not_found'
          WHEN NOT EXISTS (
            SELECT 1 FROM account, presented
             WHERE account.email_verified = TRUE
               AND LOWER(account.username) = LOWER(presented.email)
          ) THEN 'forbidden'
          WHEN EXISTS (SELECT 1 FROM existing_membership) THEN 'already_member'
          WHEN EXISTS (SELECT 1 FROM seat_capacity WHERE assigned >= seats) THEN 'no_seats'
          WHEN EXISTS (SELECT 1 FROM inserted) THEN 'ok'
          ELSE 'unavailable'
        END AS outcome,
        inserted.id,
        inserted."organizationId",
        inserted."userId",
        inserted.role,
        inserted."seatAssigned"
        FROM (SELECT 1) AS one
        LEFT JOIN inserted ON TRUE
      `);
      const row = exactlyOneRow(result);
      switch (outcome(row)) {
        case "ok": {
          if (row.role !== "member" || row.seatAssigned !== true) {
            throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
          }
          const value: AcceptedOrganizationMembershipProjection = {
            id: positiveInteger(row.id),
            organizationId: positiveInteger(row.organizationId),
            userId: positiveInteger(row.userId),
            role: "member",
            seatAssigned: true,
          };
          await backfillUserRecordsToOrg(tx, value.userId, value.organizationId);
          return { ok: true, value };
        }
        case "forbidden": return { ok: false, reason: "forbidden" };
        case "not_found": return { ok: false, reason: "not_found" };
        case "already_member": return { ok: false, reason: "conflict", code: "already_member" };
        case "no_seats": return { ok: false, reason: "conflict", code: "no_seats" };
        default: throw new Error("VERSIONED_INVITATION_RESULT_INVALID");
      }
    });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readHiringManagerRegistrationGrant(
  token: string,
): Promise<ReadHiringManagerRegistrationGrantResult> {
  const tokenHash = hashVersionedInvitationToken(token);
  if (tokenHash === null) return { ok: false, reason: "not_found" };
  try {
    const result = await db.execute(sql`
      SELECT invitation.id,
             invitation.email,
             invitation.grant_version AS "grantVersion"
        FROM ${hiringManagerInvitations} AS invitation
       WHERE invitation.token = ${tokenHash}
         AND invitation.status = 'pending'
         AND invitation.expires_at > now()
         AND invitation.authority_scope = 'organization'
         AND invitation.organization_id IS NOT NULL
         AND invitation.revoked_at IS NULL
       LIMIT 1
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1) return { ok: false, reason: "unavailable" };
    return { ok: true, value: {
      id: positiveInteger(rows[0]!.id),
      email: text(rows[0]!.email),
      grantVersion: positiveInteger(rows[0]!.grantVersion),
    } };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function acceptHiringManagerRegistrationGrant(
  userId: number,
  invitationId: number,
  grantVersion: number,
  token: string,
): Promise<AcceptHiringManagerRegistrationGrantResult> {
  const tokenHash = hashVersionedInvitationToken(token);
  if (!isPositiveSafeInteger(userId)
      || !isPositiveSafeInteger(invitationId)
      || !isPositiveSafeInteger(grantVersion)
      || tokenHash === null) {
    return { ok: false, reason: "not_found" };
  }
  try {
    const result = await db.execute(sql`
      UPDATE ${hiringManagerInvitations} AS invitation
         SET status = 'accepted',
             accepted_at = now(),
             accepted_by_user_id = account.id
        FROM ${users} AS account
       WHERE invitation.id = ${invitationId}
         AND invitation.token = ${tokenHash}
         AND invitation.grant_version = ${grantVersion}
         AND invitation.status = 'pending'
         AND invitation.expires_at > now()
         AND invitation.authority_scope = 'organization'
         AND invitation.organization_id IS NOT NULL
         AND invitation.revoked_at IS NULL
         AND account.id = ${userId}
         AND account.role = 'hiring_manager'
         AND LOWER(account.username) = LOWER(invitation.email)
      RETURNING invitation.id
    `);
    const rows = rowsFrom(result);
    if (rows.length === 0) return { ok: false, reason: "not_found" };
    if (rows.length !== 1 || positiveInteger(rows[0]!.id) !== invitationId) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
