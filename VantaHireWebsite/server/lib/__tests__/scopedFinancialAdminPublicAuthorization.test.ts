import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../db", () => ({ db: { execute } }));

import {
  assignAuthorizedSeat,
  listAuthorizedInvoices,
  parseAuthorizedInvoiceFileName,
  parseAuthorizedUserRole,
  parseScopedFinancialId,
  readAuthorizedInvoiceByFileName,
  readAuthorizedInvoiceById,
  readAuthorizedOrganizationAiActivity,
  unassignAuthorizedSeat,
  updateAuthorizedUserRole,
} from "../scopedFinancialAdminPublicAuthorization";

const completedAt = new Date("2026-08-31T12:00:00.000Z");
const seatRow = {
  memberId: 21,
  organizationId: 7,
  organizationName: "Fixture Organization",
  userId: 31,
  email: "member@example.invalid",
  firstName: "Fixture",
};

beforeEach(() => execute.mockReset());

describe("scoped financial/admin strict inputs", () => {
  it("accepts only canonical ids, generated invoice filenames and enumerated roles", () => {
    expect(parseScopedFinancialId("42")).toBe(42);
    expect(parseScopedFinancialId(42)).toBe(42);
    expect(parseAuthorizedInvoiceFileName("INV-202608-7-123456.pdf"))
      .toBe("INV-202608-7-123456.pdf");
    expect(parseAuthorizedUserRole("hiring_manager")).toBe("hiring_manager");

    for (const value of [undefined, "", "0", "01", "+1", " 1", "1.0", "9007199254740992", ["1"]]) {
      expect(parseScopedFinancialId(value)).toBeNull();
    }
    for (const value of [
      "../INV-202608-7-123.pdf", "INV-2026-7-123.pdf", "INV-202608-0-123.pdf",
      "INV-202608-7-123.PDF", "INV-202608-7-123.pdf?x=1", ["INV-202608-7-123.pdf"],
    ]) expect(parseAuthorizedInvoiceFileName(value)).toBeNull();
    for (const value of [undefined, "owner", "admin", " recruiter ", ["recruiter"]]) {
      expect(parseAuthorizedUserRole(value)).toBeNull();
    }
  });

  it("refuses malformed commands before touching the database", async () => {
    await expect(assignAuthorizedSeat(0, 1)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(unassignAuthorizedSeat(1, 0)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(listAuthorizedInvoices(1, 19)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(readAuthorizedInvoiceById(1, -1)).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(readAuthorizedInvoiceByFileName(1, "../invoice.pdf"))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(readAuthorizedOrganizationAiActivity(0))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(updateAuthorizedUserRole(1, 2, "owner" as never))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("same-organization seat commands", () => {
  it("returns the minimum public seat result while retaining bounded side-effect context internally", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ outcome: "changed", seatAssigned: true, ...seatRow }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "changed", seatAssigned: false, ...seatRow }] });

    await expect(assignAuthorizedSeat(11, 21)).resolves.toEqual({
      ok: true,
      value: { changed: true, seatAssigned: true, ...seatRow },
    });
    await expect(unassignAuthorizedSeat(11, 21)).resolves.toEqual({
      ok: true,
      value: { changed: true, seatAssigned: false, ...seatRow },
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("maps unchanged and conflict outcomes without extra statements", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ outcome: "unchanged", seatAssigned: true, ...seatRow }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "no_seats_available", memberId: null }] })
      .mockResolvedValueOnce({ rows: [{ outcome: "owner_seat_required", memberId: null }] });

    await expect(assignAuthorizedSeat(11, 21)).resolves.toMatchObject({ ok: true, value: { changed: false } });
    await expect(assignAuthorizedSeat(11, 21)).resolves.toEqual({
      ok: false, reason: "conflict", code: "no_seats_available",
    });
    await expect(unassignAuthorizedSeat(11, 21)).resolves.toEqual({
      ok: false, reason: "conflict", code: "owner_seat_required",
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it.each(["forbidden", "not_found"] as const)("collapses %s without parsing target identity", async (outcome) => {
    execute.mockResolvedValueOnce({ rows: [{ outcome, memberId: null, email: "do-not-parse" }] });
    await expect(assignAuthorizedSeat(11, 21)).resolves.toEqual({ ok: false, reason: outcome });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("financial and usage minimum projections", () => {
  it("returns only six invoice fields and a server-derived authenticated path", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorized: true,
      id: 81,
      invoiceNumber: "INV-202608-7-123456",
      type: "subscription",
      totalAmount: "19900",
      completedAt,
      invoiceUrl: "https://provider.example.invalid/private",
      cashfreeOrderId: "secret-order",
      metadata: { candidate: "secret" },
    }] });

    const result = await listAuthorizedInvoices(11);
    expect(result).toEqual({ ok: true, rows: [{
      id: 81,
      invoiceNumber: "INV-202608-7-123456",
      type: "subscription",
      totalAmount: 19900,
      completedAt: completedAt.toISOString(),
      downloadPath: "/api/subscription/invoices/81/pdf",
    }] });
    expect(Object.keys(result.ok ? result.rows[0]! : {})).toEqual([
      "id", "invoiceNumber", "type", "totalAmount", "completedAt", "downloadPath",
    ]);
    expect(JSON.stringify(result)).not.toContain("provider");
    expect(JSON.stringify(result)).not.toContain("metadata");
  });

  it("distinguishes authorized-empty, actor denial and unavailable invoice results", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ authorized: true, id: null }] })
      .mockResolvedValueOnce({ rows: [{ authorized: false, id: null }] })
      .mockResolvedValueOnce({ rows: [{ authorized: "yes", id: null }] });
    await expect(listAuthorizedInvoices(11)).resolves.toEqual({ ok: true, rows: [] });
    await expect(readAuthorizedInvoiceById(11, 81)).resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(readAuthorizedInvoiceById(11, 81)).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("returns an internal exact invoice locator from one statement", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{
        authorized: true, id: 81, invoiceNumber: "INV-202608-7-123456", invoiceUrl: null,
      }] })
      .mockResolvedValueOnce({ rows: [{
        authorized: true, id: 81, invoiceNumber: "INV-202608-7-123456",
        invoiceUrl: "/api/invoices/INV-202608-7-123456.pdf",
      }] });
    await expect(readAuthorizedInvoiceById(11, 81)).resolves.toMatchObject({ ok: true, value: { id: 81 } });
    await expect(readAuthorizedInvoiceByFileName(11, "INV-202608-7-123456.pdf"))
      .resolves.toMatchObject({ ok: true, value: { id: 81 } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("returns only current-organization aggregate activity with deterministic kinds", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      authorized: true,
      operations: "3",
      tokensIn: "30",
      tokensOut: "45",
      byKind: [
        { kind: "email_draft", operations: 1, tokensIn: 10, tokensOut: 15 },
        { kind: "summary", operations: 2, tokensIn: 20, tokensOut: 30 },
      ],
      userId: 99,
      metadata: { candidateEmail: "forbidden@example.invalid" },
      costUsd: "9.99",
    }] });
    const result = await readAuthorizedOrganizationAiActivity(11);
    expect(result).toEqual({ ok: true, value: {
      windowDays: 30,
      totals: { operations: 3, tokensIn: 30, tokensOut: 45 },
      byKind: [
        { kind: "email_draft", operations: 1, tokensIn: 10, tokensOut: 15 },
        { kind: "summary", operations: 2, tokensIn: 20, tokensOut: 30 },
      ],
    } });
    expect(JSON.stringify(result)).not.toContain("forbidden");
    expect(JSON.stringify(result)).not.toContain("costUsd");
  });

  it("fails closed on nondeterministic or malformed activity rows", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{
        authorized: true, operations: 2, tokensIn: 2, tokensOut: 2,
        byKind: [
          { kind: "summary", operations: 1, tokensIn: 1, tokensOut: 1 },
          { kind: "email_draft", operations: 1, tokensIn: 1, tokensOut: 1 },
        ],
      }] })
      .mockRejectedValueOnce(new Error("postgres://secret"));
    await expect(readAuthorizedOrganizationAiActivity(11))
      .resolves.toEqual({ ok: false, reason: "unavailable" });
    const result = await readAuthorizedOrganizationAiActivity(11);
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("minimum role mutation response", () => {
  it("returns exactly six safe account fields and never credentials", async () => {
    execute.mockResolvedValueOnce({ rows: [{
      outcome: "changed",
      id: 31,
      email: "user@example.invalid",
      firstName: "Fixture",
      lastName: null,
      role: "hiring_manager",
      emailVerified: true,
      password: "forbidden",
      resetPasswordToken: "forbidden",
      providerMetadata: { secret: true },
    }] });
    const result = await updateAuthorizedUserRole(1, 31, "hiring_manager");
    expect(result).toEqual({ ok: true, value: {
      id: 31,
      email: "user@example.invalid",
      firstName: "Fixture",
      lastName: null,
      role: "hiring_manager",
      emailVerified: true,
    } });
    expect(Object.keys(result.ok ? result.value : {})).toEqual([
      "id", "email", "firstName", "lastName", "role", "emailVerified",
    ]);
    expect(JSON.stringify(result)).not.toContain("forbidden");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(["forbidden", "not_found"] as const)("maps %s without parsing credential fields", async (outcome) => {
    execute.mockResolvedValueOnce({ rows: [{ outcome, password: "do-not-parse" }] });
    await expect(updateAuthorizedUserRole(1, 31, "recruiter"))
      .resolves.toEqual({ ok: false, reason: outcome });
  });

  it("maps invalid result shapes to unavailable without leaking raw errors", async () => {
    execute.mockResolvedValueOnce({ rows: [{ outcome: "changed", id: 31, password: "secret" }] });
    const result = await updateAuthorizedUserRole(1, 31, "recruiter");
    expect(result).toEqual({ ok: false, reason: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
