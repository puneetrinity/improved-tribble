import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "../../..");
const subscription = readFileSync(join(ROOT, "server/subscription.routes.ts"), "utf8");
const admin = readFileSync(join(ROOT, "server/admin.routes.ts"), "utf8");
const routes = readFileSync(join(ROOT, "server/routes.ts"), "utf8");

function route(source: string, method: string, path: string): string {
  const marker = `app.${method}("${path}"`;
  const start = source.indexOf(marker);
  expect(start, `${method.toUpperCase()} ${path} is registered`).toBeGreaterThanOrEqual(0);
  const candidates = [source.indexOf("\n  });", start), source.indexOf("\n  );", start)]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  expect(candidates.length).toBeGreaterThan(0);
  return source.slice(start, candidates[0]! + 6);
}

function expectOrdered(source: string, ...anchors: string[]): void {
  let prior = -1;
  for (const anchor of anchors) {
    const next = source.indexOf(anchor);
    expect(next, `missing ordered anchor: ${anchor}`).toBeGreaterThan(prior);
    prior = next;
  }
}

describe("same-organization seat route adoption", () => {
  it("rejects malformed assignment before the one statement-bound command", () => {
    const block = route(subscription, "post", "/api/subscription/seats/assign");
    expect(block).toContain("requireAuth, csrfProtection");
    expectOrdered(block,
      "parseScopedFinancialId(req.body.memberId)",
      "INVALID_MEMBER_ID",
      "assignAuthorizedSeat(req.user!.id, memberId)",
      "if (result.value.changed)",
      "initializeMemberCredits(result.value.memberId, result.value.organizationId)",
      "res.json({ memberId: result.value.memberId, seatAssigned: result.value.seatAssigned })",
    );
    for (const forbidden of ["assignSeat(", "getUserOrganization(", "canManageBilling(", "req.body.organizationId"]) {
      expect(block).not.toContain(forbidden);
    }
    for (const code of ["BILLING_ACCESS_DENIED", "MEMBER_NOT_FOUND", "NO_SEATS_AVAILABLE", "SEAT_COMMAND_UNAVAILABLE"]) {
      expect(block).toContain(code);
    }
  });

  it("sends no unassignment email until an authorized changed result", () => {
    const block = route(subscription, "post", "/api/subscription/seats/unassign");
    expect(block).toContain("requireAuth, csrfProtection");
    expectOrdered(block,
      "parseScopedFinancialId(req.body.memberId)",
      "unassignAuthorizedSeat(req.user!.id, memberId)",
      "if (result.value.changed)",
      "getEmailService()",
      "emailService.sendEmail",
      "res.json({ memberId: result.value.memberId, seatAssigned: result.value.seatAssigned })",
    );
    for (const forbidden of ["unassignSeat(", "getUserOrganization(", "req.body.organizationId"]) {
      expect(block).not.toContain(forbidden);
    }
    for (const code of ["BILLING_ACCESS_DENIED", "MEMBER_NOT_FOUND", "OWNER_SEAT_REQUIRED", "SEAT_COMMAND_UNAVAILABLE"]) {
      expect(block).toContain(code);
    }
  });
});

describe("invoice and usage route ordering", () => {
  it("lists only the statement-authorized invoice projection", () => {
    const block = route(subscription, "get", "/api/subscription/invoices");
    expect(block).toContain("listAuthorizedInvoices(req.user!.id)");
    expect(block).toContain("BILLING_ACCESS_DENIED");
    expect(block).toContain("INVOICE_AUTHORIZATION_UNAVAILABLE");
    for (const forbidden of ["getInvoices(", "getUserOrganization(", "invoiceUrl", "cashfreeOrderId", "metadata"]) {
      expect(block).not.toContain(forbidden);
    }
  });

  it("authorizes an exact invoice id before generation, path, file or redirect work", () => {
    const block = route(subscription, "get", "/api/subscription/invoices/:transactionId/pdf");
    expectOrdered(block,
      "parseScopedFinancialId(req.params.transactionId)",
      "INVALID_TRANSACTION_ID",
      "readAuthorizedInvoiceById(req.user!.id, transactionId)",
      "INVOICE_NOT_FOUND",
      "let invoiceUrl = result.value.invoiceUrl",
      "generateAndStoreInvoicePdf(transactionId)",
      "getLocalInvoicePath(fileName)",
      "res.sendFile(filePath)",
    );
    expect(block.indexOf("res.redirect(invoiceUrl)")).toBeGreaterThan(block.indexOf("readAuthorizedInvoiceById"));
    expect(block).toContain("redirectUrl.protocol !== 'https:'");
    expect(block).toContain("redirectUrl.username || redirectUrl.password");
    for (const forbidden of ["getInvoices(", "getTransactionByCashfreeOrder(", "req.params.organizationId"]) {
      expect(block).not.toContain(forbidden);
    }
  });

  it("authorizes a canonical invoice filename before any local lookup", () => {
    const block = route(subscription, "get", "/api/invoices/:fileName");
    expectOrdered(block,
      "parseAuthorizedInvoiceFileName(req.params.fileName)",
      "INVALID_INVOICE_FILE_NAME",
      "readAuthorizedInvoiceByFileName(req.user!.id, fileName)",
      "INVOICE_NOT_FOUND",
      "getLocalInvoicePath(fileName)",
      "res.sendFile(filePath)",
    );
    expect(block).not.toContain("getInvoices(");
  });

  it("returns only the organization aggregate and invokes no legacy credit history helper", () => {
    const block = route(subscription, "get", "/api/ai/credits/usage");
    expect(block).toContain("readAuthorizedOrganizationAiActivity(req.user!.id)");
    expect(block).toContain("BILLING_ACCESS_DENIED");
    expect(block).toContain("USAGE_UNAVAILABLE");
    for (const forbidden of [
      "getCreditUsageHistory", "getOrgCreditSummary", "getOrgCreditDetails", "getOrgCreditLedger",
      "req.query", "metadata", "costUsd", "applicationId", "candidate",
    ]) expect(block).not.toContain(forbidden);
  });

  it("publishes only the authenticated invoice path from the already organization-bound order route", () => {
    const block = route(subscription, "get", "/api/subscription/order/:orderId/status");
    expect(block).toContain("downloadPath:");
    expect(block).toContain("`/api/subscription/invoices/${transaction.id}/pdf`");
    expect(block).not.toContain("invoiceUrl:");
  });
});

describe("admin projection and retired surfaces", () => {
  it("updates a role through the stored-admin command and returns only its value", () => {
    const block = route(admin, "patch", "/api/admin/users/:id/role");
    expect(block).toContain("csrfProtection, requireRole(['super_admin'])");
    expectOrdered(block,
      "parseScopedFinancialId(req.params.id)",
      "parseAuthorizedUserRole(req.body?.role)",
      "INVALID_ROLE_UPDATE",
      "updateAuthorizedUserRole(req.user!.id, userId, role)",
      "USER_NOT_FOUND",
      "res.json(result.value)",
    );
    expect(block).not.toContain("storage.updateUserRole");
    expect(block).not.toContain("res.json({ ...");
  });

  it("retires the application collection with zero data/provider/file work", () => {
    const block = route(admin, "get", "/api/admin/applications/all");
    expect(block).toContain("requireRole(['super_admin'])");
    expect(block).toContain("res.status(410)");
    expect(block).toContain("ADMIN_APPLICATION_COLLECTION_RETIRED");
    for (const forbidden of ["storage.", "db.", "fetch(", "sendFile", "req.params", "req.body"]) {
      expect(block).not.toContain(forbidden);
    }
  });

  it.each([
    [admin, "get", "/api/admin/consultants", "requireRole(['super_admin'])"],
    [admin, "post", "/api/admin/consultants", "csrfProtection, requireRole(['super_admin'])"],
    [admin, "patch", "/api/admin/consultants/:id", "csrfProtection, requireRole(['super_admin'])"],
    [admin, "delete", "/api/admin/consultants/:id", "csrfProtection, requireRole(['super_admin'])"],
    [routes, "get", "/api/consultants", "async"],
    [routes, "get", "/api/consultants/:id", "async"],
  ])("retires %s %s with the fixed zero-read tombstone", (source, method, path, middleware) => {
    const block = route(source, method, path);
    expect(block).toContain(middleware);
    expect(block).toContain("res.status(410)");
    expect(block).toContain("CONSULTANT_PRODUCT_RETIRED");
    for (const forbidden of ["storage.", "db.", "fetch(", "sendFile", "req.params", "req.body"]) {
      expect(block).not.toContain(forbidden);
    }
  });
});

describe("client minimum contracts and dead-surface removal", () => {
  const files = [
    "client/src/App.tsx",
    "client/src/components/QuickAccessBar.tsx",
    "client/src/hooks/use-subscription.ts",
    "client/src/hooks/use-ai-credits.ts",
    "client/src/pages/org-billing-page.tsx",
    "client/src/pages/admin-super-dashboard.tsx",
  ];
  const client = files.map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n");

  it("has no retired API, route or navigation reference and both dead pages are absent", () => {
    for (const forbidden of [
      "/api/admin/applications/all", "/api/admin/consultants", "/api/consultants", 'path="/consultants"',
      "admin-consultants-page", "unified-admin-dashboard",
    ]) expect(client).not.toContain(forbidden);
    expect(existsSync(join(ROOT, "client/src/pages/admin-consultants-page.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "client/src/pages/unified-admin-dashboard.tsx"))).toBe(false);
  });

  it("keeps invoice and AI activity types minimum and owner-enabled", () => {
    const subscriptions = readFileSync(join(ROOT, "client/src/hooks/use-subscription.ts"), "utf8");
    const credits = readFileSync(join(ROOT, "client/src/hooks/use-ai-credits.ts"), "utf8");
    const billing = readFileSync(join(ROOT, "client/src/pages/org-billing-page.tsx"), "utf8");
    for (const anchor of ["downloadPath: string", "useInvoices(enabled: boolean)", "enabled,"]) {
      expect(subscriptions).toContain(anchor);
    }
    for (const anchor of ["windowDays: 30", "byKind:", "useAiCreditUsage(enabled: boolean)"]) {
      expect(credits).toContain(anchor);
    }
    expect(billing).toContain("useInvoices(isOwner)");
    expect(billing).toContain("useAiCreditUsage(isOwner)");
    expect(billing).toContain("invoice.downloadPath");
    for (const forbidden of ["invoice.invoiceUrl", "getCreditUsageHistory", "metadata", "costUsd", "candidateEmail"]) {
      expect(billing).not.toContain(forbidden);
    }
  });

  it("removes the admin application collection, tab, detail and mutation surface", () => {
    const dashboard = readFileSync(join(ROOT, "client/src/pages/admin-super-dashboard.tsx"), "utf8");
    for (const forbidden of [
      "/api/admin/applications/all", "ApplicationWithDetails", "selectedApplication", "filteredApplications",
      "applicationDetails", 'value="applications"', "applicationPrivacyAnchor", "updateApplicationMutation",
    ]) expect(dashboard).not.toContain(forbidden);
  });
});
