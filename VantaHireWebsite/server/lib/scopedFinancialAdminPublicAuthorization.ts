import {
  organizationMembers,
  organizations,
  organizationSubscriptions,
  paymentTransactions,
  userAiUsage,
  users,
} from "@shared/schema";
import { sql } from "drizzle-orm";

import { db } from "../db";

export const ORGANIZATION_AI_ACTIVITY_WINDOW_DAYS = 30 as const;

export const USER_ROLES = ["candidate", "recruiter", "super_admin", "hiring_manager"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface AuthorizedSeatChange {
  memberId: number;
  seatAssigned: boolean;
  changed: boolean;
  organizationId: number;
  organizationName: string;
  userId: number;
  email: string;
  firstName: string | null;
}

export type AuthorizedSeatCommandResult =
  | { ok: true; value: AuthorizedSeatChange }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" }
  | { ok: false; reason: "conflict"; code: "no_seats_available" | "owner_seat_required" };

export interface AuthorizedInvoiceProjection {
  id: number;
  invoiceNumber: string;
  type: string;
  totalAmount: number;
  completedAt: string;
  downloadPath: string;
}

export interface AuthorizedInvoiceLocator {
  id: number;
  invoiceNumber: string;
  invoiceUrl: string | null;
}

export type AuthorizedInvoiceListResult =
  | { ok: true; rows: AuthorizedInvoiceProjection[] }
  | { ok: false; reason: "forbidden" | "unavailable" };

export type AuthorizedInvoiceReadResult =
  | { ok: true; value: AuthorizedInvoiceLocator }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" };

export interface OrganizationAiActivityProjection {
  windowDays: typeof ORGANIZATION_AI_ACTIVITY_WINDOW_DAYS;
  totals: {
    operations: number;
    tokensIn: number;
    tokensOut: number;
  };
  byKind: Array<{
    kind: string;
    operations: number;
    tokensIn: number;
    tokensOut: number;
  }>;
}

export type AuthorizedOrganizationAiActivityResult =
  | { ok: true; value: OrganizationAiActivityProjection }
  | { ok: false; reason: "forbidden" | "unavailable" };

export interface AuthorizedRoleUpdateProjection {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  emailVerified: boolean;
}

export type AuthorizedRoleUpdateResult =
  | { ok: true; value: AuthorizedRoleUpdateProjection }
  | { ok: false; reason: "forbidden" | "not_found" | "unavailable" };

type QueryResult = { rows?: unknown[] };
type UnknownRow = Record<string, unknown>;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseScopedFinancialId(value: unknown): number | null {
  if (typeof value === "number") return isPositiveSafeInteger(value) ? value : null;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number(value);
  return isPositiveSafeInteger(parsed) ? parsed : null;
}

export function parseAuthorizedInvoiceFileName(value: unknown): string | null {
  return typeof value === "string" && /^INV-[0-9]{6}-[1-9][0-9]*-[0-9]+\.pdf$/.test(value)
    ? value
    : null;
}

export function parseAuthorizedUserRole(value: unknown): UserRole | null {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value)
    ? value as UserRole
    : null;
}

function rowsFrom(result: unknown): UnknownRow[] {
  const rows = (result as QueryResult | null)?.rows;
  if (!Array.isArray(rows)
      || !rows.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) {
    throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  }
  return rows as UnknownRow[];
}

function exactlyOneRow(result: unknown): UnknownRow {
  const rows = rowsFrom(result);
  if (rows.length !== 1) throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  return rows[0]!;
}

function positiveInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value;
  if (!isPositiveSafeInteger(parsed)) throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  return parsed;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  }
  return parsed;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  return value;
}

function nonEmptyText(value: unknown): string {
  const parsed = text(value);
  if (parsed.length === 0) throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  return parsed;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  return value;
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  }
  return parsed.toISOString();
}

function role(value: unknown): UserRole {
  const parsed = parseAuthorizedUserRole(value);
  if (parsed === null) throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  return parsed;
}

function outcome(value: unknown): string {
  return nonEmptyText(value);
}

function parseSeatSuccess(row: UnknownRow, changed: boolean): AuthorizedSeatChange {
  if (row.seatAssigned !== true) throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  return {
    memberId: positiveInteger(row.memberId),
    seatAssigned: true,
    changed,
    organizationId: positiveInteger(row.organizationId),
    organizationName: nonEmptyText(row.organizationName),
    userId: positiveInteger(row.userId),
    email: nonEmptyText(row.email),
    firstName: nullableText(row.firstName),
  };
}

function parseUnseatSuccess(row: UnknownRow, changed: boolean): AuthorizedSeatChange {
  if (row.seatAssigned !== false) throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  return {
    memberId: positiveInteger(row.memberId),
    seatAssigned: false,
    changed,
    organizationId: positiveInteger(row.organizationId),
    organizationName: nonEmptyText(row.organizationName),
    userId: positiveInteger(row.userId),
    email: nonEmptyText(row.email),
    firstName: nullableText(row.firstName),
  };
}

export async function assignAuthorizedSeat(
  actorUserId: number,
  memberId: number,
): Promise<AuthorizedSeatCommandResult> {
  if (!isPositiveSafeInteger(actorUserId) || !isPositiveSafeInteger(memberId)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT actor_membership.organization_id AS organization_id
          FROM ${users} AS actor
          INNER JOIN ${organizationMembers} AS actor_membership
            ON actor_membership.user_id = actor.id
           AND actor_membership.role = 'owner'
           AND actor_membership.seat_assigned = TRUE
         WHERE actor.id = ${actorUserId}
           AND actor.role = 'recruiter'
      ),
      target_context AS MATERIALIZED (
        SELECT target.id AS member_id,
               target.organization_id AS organization_id,
               target.user_id AS user_id,
               target.seat_assigned AS seat_assigned,
               target_user.username AS email,
               target_user.first_name AS first_name,
               organization.name AS organization_name,
               COALESCE(subscription.seats, 1) AS seat_limit,
               (
                 SELECT COUNT(*)::int
                   FROM ${organizationMembers} AS seated
                  WHERE seated.organization_id = target.organization_id
                    AND seated.seat_assigned = TRUE
               ) AS assigned_seats
          FROM ${organizationMembers} AS target
          INNER JOIN actor_context
            ON actor_context.organization_id = target.organization_id
          INNER JOIN ${users} AS target_user
            ON target_user.id = target.user_id
          INNER JOIN ${organizations} AS organization
            ON organization.id = target.organization_id
          LEFT JOIN ${organizationSubscriptions} AS subscription
            ON subscription.organization_id = target.organization_id
         WHERE target.id = ${memberId}
      ),
      updated AS (
        UPDATE ${organizationMembers} AS member
           SET seat_assigned = TRUE
          FROM target_context
         WHERE member.id = target_context.member_id
           AND target_context.seat_assigned = FALSE
           AND target_context.assigned_seats < target_context.seat_limit
        RETURNING member.id
      )
      SELECT CASE
               WHEN NOT EXISTS (SELECT 1 FROM actor_context) THEN 'forbidden'
               WHEN NOT EXISTS (SELECT 1 FROM target_context) THEN 'not_found'
               WHEN (SELECT seat_assigned FROM target_context) = TRUE THEN 'unchanged'
               WHEN (SELECT assigned_seats >= seat_limit FROM target_context) THEN 'no_seats_available'
               WHEN EXISTS (SELECT 1 FROM updated) THEN 'changed'
               ELSE 'unavailable'
             END AS outcome,
             target_context.member_id AS "memberId",
             CASE WHEN EXISTS (SELECT 1 FROM updated) THEN TRUE ELSE target_context.seat_assigned END AS "seatAssigned",
             target_context.organization_id AS "organizationId",
             target_context.organization_name AS "organizationName",
             target_context.user_id AS "userId",
             target_context.email AS email,
             target_context.first_name AS "firstName"
        FROM (SELECT 1) AS anchor
        LEFT JOIN target_context ON TRUE
    `);

    const row = exactlyOneRow(result);
    switch (outcome(row.outcome)) {
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      case "no_seats_available": return { ok: false, reason: "conflict", code: "no_seats_available" };
      case "unchanged": return { ok: true, value: parseSeatSuccess(row, false) };
      case "changed": return { ok: true, value: parseSeatSuccess(row, true) };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function unassignAuthorizedSeat(
  actorUserId: number,
  memberId: number,
): Promise<AuthorizedSeatCommandResult> {
  if (!isPositiveSafeInteger(actorUserId) || !isPositiveSafeInteger(memberId)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT actor_membership.organization_id AS organization_id
          FROM ${users} AS actor
          INNER JOIN ${organizationMembers} AS actor_membership
            ON actor_membership.user_id = actor.id
           AND actor_membership.role = 'owner'
           AND actor_membership.seat_assigned = TRUE
         WHERE actor.id = ${actorUserId}
           AND actor.role = 'recruiter'
      ),
      target_context AS MATERIALIZED (
        SELECT target.id AS member_id,
               target.organization_id AS organization_id,
               target.user_id AS user_id,
               target.role AS member_role,
               target.seat_assigned AS seat_assigned,
               target_user.username AS email,
               target_user.first_name AS first_name,
               organization.name AS organization_name
          FROM ${organizationMembers} AS target
          INNER JOIN actor_context
            ON actor_context.organization_id = target.organization_id
          INNER JOIN ${users} AS target_user
            ON target_user.id = target.user_id
          INNER JOIN ${organizations} AS organization
            ON organization.id = target.organization_id
         WHERE target.id = ${memberId}
      ),
      updated AS (
        UPDATE ${organizationMembers} AS member
           SET seat_assigned = FALSE
          FROM target_context
         WHERE member.id = target_context.member_id
           AND target_context.member_role <> 'owner'
           AND target_context.seat_assigned = TRUE
        RETURNING member.id
      )
      SELECT CASE
               WHEN NOT EXISTS (SELECT 1 FROM actor_context) THEN 'forbidden'
               WHEN NOT EXISTS (SELECT 1 FROM target_context) THEN 'not_found'
               WHEN (SELECT member_role FROM target_context) = 'owner' THEN 'owner_seat_required'
               WHEN (SELECT seat_assigned FROM target_context) = FALSE THEN 'unchanged'
               WHEN EXISTS (SELECT 1 FROM updated) THEN 'changed'
               ELSE 'unavailable'
             END AS outcome,
             target_context.member_id AS "memberId",
             CASE WHEN EXISTS (SELECT 1 FROM updated) THEN FALSE ELSE target_context.seat_assigned END AS "seatAssigned",
             target_context.organization_id AS "organizationId",
             target_context.organization_name AS "organizationName",
             target_context.user_id AS "userId",
             target_context.email AS email,
             target_context.first_name AS "firstName"
        FROM (SELECT 1) AS anchor
        LEFT JOIN target_context ON TRUE
    `);

    const row = exactlyOneRow(result);
    switch (outcome(row.outcome)) {
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      case "owner_seat_required": return { ok: false, reason: "conflict", code: "owner_seat_required" };
      case "unchanged": return { ok: true, value: parseUnseatSuccess(row, false) };
      case "changed": return { ok: true, value: parseUnseatSuccess(row, true) };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function parseInvoiceProjection(row: UnknownRow): AuthorizedInvoiceProjection {
  const id = positiveInteger(row.id);
  return {
    id,
    invoiceNumber: nonEmptyText(row.invoiceNumber),
    type: nonEmptyText(row.type),
    totalAmount: nonNegativeInteger(row.totalAmount),
    completedAt: timestamp(row.completedAt),
    downloadPath: `/api/subscription/invoices/${id}/pdf`,
  };
}

function parseInvoiceLocator(row: UnknownRow): AuthorizedInvoiceLocator {
  return {
    id: positiveInteger(row.id),
    invoiceNumber: nonEmptyText(row.invoiceNumber),
    invoiceUrl: nullableText(row.invoiceUrl),
  };
}

export async function listAuthorizedInvoices(
  actorUserId: number,
  limit: number = 20,
): Promise<AuthorizedInvoiceListResult> {
  if (!isPositiveSafeInteger(actorUserId) || !Number.isSafeInteger(limit) || limit !== 20) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT membership.organization_id AS organization_id
          FROM ${users} AS actor
          INNER JOIN ${organizationMembers} AS membership
            ON membership.user_id = actor.id
           AND membership.role = 'owner'
           AND membership.seat_assigned = TRUE
         WHERE actor.id = ${actorUserId}
           AND actor.role = 'recruiter'
      ),
      authorized_invoices AS (
        SELECT invoice.id AS id,
               invoice.invoice_number AS invoice_number,
               invoice.type AS type,
               invoice.total_amount AS total_amount,
               invoice.completed_at AS completed_at
          FROM ${paymentTransactions} AS invoice
          INNER JOIN actor_context
            ON actor_context.organization_id = invoice.organization_id
         WHERE invoice.status = 'completed'
           AND invoice.invoice_number IS NOT NULL
           AND invoice.completed_at IS NOT NULL
         ORDER BY invoice.completed_at DESC, invoice.id DESC
         LIMIT ${limit}
      )
      SELECT EXISTS (SELECT 1 FROM actor_context) AS authorized,
             authorized_invoices.id AS id,
             authorized_invoices.invoice_number AS "invoiceNumber",
             authorized_invoices.type AS type,
             authorized_invoices.total_amount AS "totalAmount",
             authorized_invoices.completed_at AS "completedAt"
        FROM (SELECT 1) AS anchor
        LEFT JOIN authorized_invoices ON TRUE
       ORDER BY authorized_invoices.completed_at DESC NULLS LAST,
                authorized_invoices.id DESC NULLS LAST
    `);

    const rows = rowsFrom(result);
    const first = rows[0];
    if (!first || typeof first.authorized !== "boolean") {
      return { ok: false, reason: "unavailable" };
    }
    if (!first.authorized) return { ok: false, reason: "forbidden" };
    if (!rows.every((row) => row.authorized === true)) return { ok: false, reason: "unavailable" };
    return {
      ok: true,
      rows: rows.filter((row) => row.id !== null).map(parseInvoiceProjection),
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedInvoiceById(
  actorUserId: number,
  transactionId: number,
): Promise<AuthorizedInvoiceReadResult> {
  if (!isPositiveSafeInteger(actorUserId) || !isPositiveSafeInteger(transactionId)) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT membership.organization_id AS organization_id
          FROM ${users} AS actor
          INNER JOIN ${organizationMembers} AS membership
            ON membership.user_id = actor.id
           AND membership.role = 'owner'
           AND membership.seat_assigned = TRUE
         WHERE actor.id = ${actorUserId}
           AND actor.role = 'recruiter'
      ),
      authorized_invoice AS (
        SELECT invoice.id AS id,
               invoice.invoice_number AS invoice_number,
               invoice.invoice_url AS invoice_url
          FROM ${paymentTransactions} AS invoice
          INNER JOIN actor_context
            ON actor_context.organization_id = invoice.organization_id
         WHERE invoice.id = ${transactionId}
           AND invoice.status = 'completed'
           AND invoice.invoice_number IS NOT NULL
      )
      SELECT EXISTS (SELECT 1 FROM actor_context) AS authorized,
             authorized_invoice.id AS id,
             authorized_invoice.invoice_number AS "invoiceNumber",
             authorized_invoice.invoice_url AS "invoiceUrl"
        FROM (SELECT 1) AS anchor
        LEFT JOIN authorized_invoice ON TRUE
    `);

    const row = exactlyOneRow(result);
    if (typeof row.authorized !== "boolean") return { ok: false, reason: "unavailable" };
    if (!row.authorized) return { ok: false, reason: "forbidden" };
    if (row.id === null) return { ok: false, reason: "not_found" };
    return { ok: true, value: parseInvoiceLocator(row) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function readAuthorizedInvoiceByFileName(
  actorUserId: number,
  fileName: string,
): Promise<AuthorizedInvoiceReadResult> {
  if (!isPositiveSafeInteger(actorUserId) || parseAuthorizedInvoiceFileName(fileName) === null) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT membership.organization_id AS organization_id
          FROM ${users} AS actor
          INNER JOIN ${organizationMembers} AS membership
            ON membership.user_id = actor.id
           AND membership.role = 'owner'
           AND membership.seat_assigned = TRUE
         WHERE actor.id = ${actorUserId}
           AND actor.role = 'recruiter'
      ),
      authorized_invoice AS (
        SELECT invoice.id AS id,
               invoice.invoice_number AS invoice_number,
               invoice.invoice_url AS invoice_url
          FROM ${paymentTransactions} AS invoice
          INNER JOIN actor_context
            ON actor_context.organization_id = invoice.organization_id
         WHERE invoice.status = 'completed'
           AND invoice.invoice_number IS NOT NULL
           AND invoice.invoice_number || '.pdf' = ${fileName}
      )
      SELECT EXISTS (SELECT 1 FROM actor_context) AS authorized,
             authorized_invoice.id AS id,
             authorized_invoice.invoice_number AS "invoiceNumber",
             authorized_invoice.invoice_url AS "invoiceUrl"
        FROM (SELECT 1) AS anchor
        LEFT JOIN authorized_invoice ON TRUE
    `);

    const row = exactlyOneRow(result);
    if (typeof row.authorized !== "boolean") return { ok: false, reason: "unavailable" };
    if (!row.authorized) return { ok: false, reason: "forbidden" };
    if (row.id === null) return { ok: false, reason: "not_found" };
    return { ok: true, value: parseInvoiceLocator(row) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function parseByKind(value: unknown): OrganizationAiActivityProjection["byKind"] {
  if (!Array.isArray(value)) throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  const rows = value.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
    }
    const row = entry as UnknownRow;
    return {
      kind: nonEmptyText(row.kind),
      operations: nonNegativeInteger(row.operations),
      tokensIn: nonNegativeInteger(row.tokensIn),
      tokensOut: nonNegativeInteger(row.tokensOut),
    };
  });
  if (!rows.every((row, index) => index === 0 || rows[index - 1]!.kind < row.kind)) {
    throw new Error("SCOPED_FINANCIAL_ADMIN_RESULT_INVALID");
  }
  return rows;
}

export async function readAuthorizedOrganizationAiActivity(
  actorUserId: number,
): Promise<AuthorizedOrganizationAiActivityResult> {
  if (!isPositiveSafeInteger(actorUserId)) return { ok: false, reason: "unavailable" };

  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT membership.organization_id AS organization_id
          FROM ${users} AS actor
          INNER JOIN ${organizationMembers} AS membership
            ON membership.user_id = actor.id
           AND membership.role = 'owner'
           AND membership.seat_assigned = TRUE
         WHERE actor.id = ${actorUserId}
           AND actor.role = 'recruiter'
      ),
      grouped AS (
        SELECT usage.kind AS kind,
               COUNT(*)::int AS operations,
               COALESCE(SUM(usage.tokens_in), 0)::bigint AS tokens_in,
               COALESCE(SUM(usage.tokens_out), 0)::bigint AS tokens_out
          FROM ${userAiUsage} AS usage
          INNER JOIN actor_context
            ON actor_context.organization_id = usage.organization_id
         WHERE usage.computed_at >= NOW() - INTERVAL '30 days'
         GROUP BY usage.kind
      )
      SELECT EXISTS (SELECT 1 FROM actor_context) AS authorized,
             COALESCE((SELECT SUM(operations) FROM grouped), 0)::bigint AS operations,
             COALESCE((SELECT SUM(tokens_in) FROM grouped), 0)::bigint AS "tokensIn",
             COALESCE((SELECT SUM(tokens_out) FROM grouped), 0)::bigint AS "tokensOut",
             COALESCE((
               SELECT jsonb_agg(
                 jsonb_build_object(
                   'kind', grouped.kind,
                   'operations', grouped.operations,
                   'tokensIn', grouped.tokens_in,
                   'tokensOut', grouped.tokens_out
                 ) ORDER BY grouped.kind
               )
                 FROM grouped
             ), '[]'::jsonb) AS "byKind"
    `);

    const row = exactlyOneRow(result);
    if (typeof row.authorized !== "boolean") return { ok: false, reason: "unavailable" };
    if (!row.authorized) return { ok: false, reason: "forbidden" };
    return {
      ok: true,
      value: {
        windowDays: ORGANIZATION_AI_ACTIVITY_WINDOW_DAYS,
        totals: {
          operations: nonNegativeInteger(row.operations),
          tokensIn: nonNegativeInteger(row.tokensIn),
          tokensOut: nonNegativeInteger(row.tokensOut),
        },
        byKind: parseByKind(row.byKind),
      },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function updateAuthorizedUserRole(
  actorUserId: number,
  targetUserId: number,
  nextRole: UserRole,
): Promise<AuthorizedRoleUpdateResult> {
  if (!isPositiveSafeInteger(actorUserId)
      || !isPositiveSafeInteger(targetUserId)
      || parseAuthorizedUserRole(nextRole) === null) {
    return { ok: false, reason: "unavailable" };
  }

  try {
    const result = await db.execute(sql`
      WITH actor_context AS MATERIALIZED (
        SELECT actor.id AS actor_id
          FROM ${users} AS actor
         WHERE actor.id = ${actorUserId}
           AND actor.role = 'super_admin'
      ),
      target_context AS MATERIALIZED (
        SELECT target.id AS target_id
          FROM ${users} AS target
         WHERE target.id = ${targetUserId}
      ),
      updated AS (
        UPDATE ${users} AS target
           SET role = ${nextRole}
          FROM actor_context
         WHERE target.id = ${targetUserId}
        RETURNING target.id AS id,
                  target.username AS email,
                  target.first_name AS first_name,
                  target.last_name AS last_name,
                  target.role AS role,
                  target.email_verified AS email_verified
      )
      SELECT CASE
               WHEN NOT EXISTS (SELECT 1 FROM actor_context) THEN 'forbidden'
               WHEN NOT EXISTS (SELECT 1 FROM target_context) THEN 'not_found'
               WHEN EXISTS (SELECT 1 FROM updated) THEN 'changed'
               ELSE 'unavailable'
             END AS outcome,
             updated.id AS id,
             updated.email AS email,
             updated.first_name AS "firstName",
             updated.last_name AS "lastName",
             updated.role AS role,
             updated.email_verified AS "emailVerified"
        FROM (SELECT 1) AS anchor
        LEFT JOIN updated ON TRUE
    `);

    const row = exactlyOneRow(result);
    switch (outcome(row.outcome)) {
      case "forbidden": return { ok: false, reason: "forbidden" };
      case "not_found": return { ok: false, reason: "not_found" };
      case "changed":
        return {
          ok: true,
          value: {
            id: positiveInteger(row.id),
            email: nonEmptyText(row.email),
            firstName: nullableText(row.firstName),
            lastName: nullableText(row.lastName),
            role: role(row.role),
            emailVerified: bool(row.emailVerified),
          },
        };
      default: return { ok: false, reason: "unavailable" };
    }
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
