/**
 * Wave 4C — candidate consent panel, real seeded stack (desktop + Pixel 5 via playwright.config projects).
 *
 * Exercises the real candidate routes with a candidate registered through the API and verified directly in the
 * seeded test database (DATABASE_URL of the web server). No provider, e-mail or Memory call is made: with no
 * acknowledged 4B application the source list is empty, so this proves the profile-only path, the privacy-sync
 * freshness refusals, honest pending/unavailable copy, retained dashboard features and accessibility.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "";
const PASSWORD = "Consent-e2e-passw0rd!";
// One candidate per worker; the privacy-sync row is global to the stack, so the cases run serially (CI uses one worker).
const EMAIL = `consent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.invalid`;

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try { return (await client.query(text, params)).rows as T[]; } finally { await client.end(); }
}

async function setPrivacySync(state: "healthy" | "stale" | "unhealthy" | "missing") {
  if (state === "missing") { await sql("DELETE FROM candidate_privacy_sync_state WHERE consumer_name='flow'"); return; }
  const age = state === "stale" ? "now() - interval '10 minutes'" : "now()";
  const status = state === "unhealthy" ? "needs_reconciliation" : "healthy";
  await sql(`INSERT INTO candidate_privacy_sync_state (consumer_name,cursor,status,last_success_at,updated_at)
             VALUES ('flow',0,$1,${age},now())
             ON CONFLICT (consumer_name) DO UPDATE SET status=EXCLUDED.status,last_success_at=EXCLUDED.last_success_at,updated_at=now()`, [status]);
}

async function login(page: Page) {
  const response = await page.request.post("/api/login", { data: { username: EMAIL, password: PASSWORD } });
  expect(response.ok(), `login ${response.status()}`).toBeTruthy();
}

async function openPanel(page: Page) {
  await page.goto("/my-dashboard?tab=privacy");
  const panel = page.getByTestId("candidate-consent-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Ealana-wide matching permission", { exact: true })).toBeVisible();
  return panel;
}

async function confirmWithPassword(page: Page) {
  await page.locator("#consent-password").fill(PASSWORD);
  await page.getByTestId("consent-confirm").click();
}

test.describe.configure({ mode: "serial" });

test.describe("Wave 4C candidate consent panel", () => {
  test.skip(!DATABASE_URL, "DATABASE_URL is required to verify the seeded candidate");

  test.beforeAll(async ({ request }) => {
    const register = await request.post("/api/register", { data: { username: EMAIL, password: PASSWORD, firstName: "Consent", lastName: "Candidate", role: "candidate" } });
    expect(register.status(), `register ${register.status()}`).toBeLessThan(400);
    await sql("UPDATE users SET email_verified=true WHERE lower(username)=lower($1)", [EMAIL]);
    await setPrivacySync("healthy");
  });

  test.afterAll(async () => { await setPrivacySync("healthy"); });

  test("optional, unchecked, profile-only permission with honest saved/pending copy and persisted truth", async ({ page }) => {
    await login(page);
    const panel = await openPanel(page);

    // Retained dashboard features and the existing privacy controls remain present.
    for (const tab of ["Profile", "My Applications", "Saved", "Resume Library", "Privacy & Data"]) {
      await expect(page.getByRole("tab", { name: new RegExp(tab) })).toBeVisible();
    }
    await expect(page.getByText("Stop global matching and recommendations")).toBeVisible();

    const agree = panel.locator("#consent-agree");
    await expect(agree).toHaveAttribute("aria-checked", "false");
    await expect(panel.getByTestId("consent-grant")).toBeDisabled();
    await expect(panel.locator("#consent-resume-none")).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByTestId("consent-no-sources")).toBeVisible();
    await expect(panel.getByTestId("consent-copy")).toContainText("I can withdraw this permission later");

    // Editable preview with populated skills: a short one and a maximum-length unbroken one (UI-V4).
    await panel.locator("#consent-display-name").fill("Consent Candidate");
    await panel.locator("#consent-headline").fill("Test headline");
    for (const skill of ["typescript", "x".repeat(100)]) {
      await panel.locator("#consent-skill").fill(skill);
      await panel.getByRole("button", { name: "Add", exact: true }).click();
    }
    const removeButtons = panel.getByRole("button", { name: /^Remove skill/ });
    await expect(removeButtons).toHaveCount(2);

    // Genuine Tab navigation from the display name reaches the remove buttons and the approval checkbox.
    await panel.locator("#consent-display-name").focus();
    const reached = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.id || (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") || "");
      if (id) reached.add(id);
      if (id === "consent-agree") break;
    }
    expect([...reached].some((v) => v.startsWith("Remove skill")), "remove buttons reachable by Tab").toBe(true);
    expect(reached.has("consent-agree"), "approval checkbox reachable by Tab").toBe(true);
    await page.keyboard.press("Space");
    await expect(agree).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByTestId("consent-grant")).toBeEnabled();

    // Every control in the populated panel is at least 44px high and lies inside the viewport (no clipping), on both devices.
    const viewport = page.viewportSize()!;
    for (const control of await panel.locator("button, input, [role=radio], [role=checkbox]").all()) {
      const box = await control.boundingBox();
      if (!box) continue;
      const role = await control.getAttribute("role");
      const tag = await control.evaluate((el) => el.tagName.toLowerCase());
      if (role === "checkbox" || role === "radio") {
        // Radix renders a 16px indicator; its 44px hit area is the row (min-h-11) plus the associated label.
        const row = await control.evaluate((el) => (el.closest(".min-h-11") as HTMLElement | null)?.getBoundingClientRect().height ?? 0);
        expect(row, `${role} row height`).toBeGreaterThanOrEqual(44);
      } else if (tag === "button") expect(box.height, "touch target height").toBeGreaterThanOrEqual(44);
      if (tag === "button" || tag === "input" || role) {
        expect(box.x, "control left edge inside viewport").toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, "control right edge inside viewport").toBeLessThanOrEqual(viewport.width + 1);
      }
    }
    const copyBox = (await panel.getByTestId("consent-copy").boundingBox())!;
    expect(copyBox.x + copyBox.width).toBeLessThanOrEqual(viewport.width + 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Unfiltered axe on the populated panel, then on the owned reauth dialog (a portal outside the panel).
    const axe = await new AxeBuilder({ page }).include('[data-testid="candidate-consent-panel"]').analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
    await panel.getByTestId("consent-grant").click();
    await expect(page.locator("#consent-password")).toBeVisible();
    // Owned reauth dialog, unfiltered: wait for the open animation (overlay + content) to settle first, otherwise
    // axe composites the fading content against the overlay and reports a contrast artefact.
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    await expect(dialog).toHaveCSS("opacity", "1");
    const dialogAxe = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(dialogAxe.violations, JSON.stringify(dialogAxe.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })))).toEqual([]);
    const confirmBox = (await page.getByTestId("consent-confirm").boundingBox())!;
    expect(confirmBox.height).toBeGreaterThanOrEqual(44);

    // Real grant through reauth; no Memory in this stack, so the truthful outcome is pending or saved, never "active matching".
    await confirmWithPassword(page);
    const notice = panel.getByTestId("consent-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(/saved locally.*Delivery is pending|matching from this approved copy is not active yet/);
    await expect(page.getByText(/matching is active/i)).toHaveCount(0);

    // Refresh restores the persisted truth from GET, not optimistic state.
    await page.reload();
    const after = await openPanel(page);
    const status = await page.request.get("/api/candidate/consent").then((r) => r.json());
    expect(status.version).toBe(1);
    expect(status.desired?.action).toBe("grant");
    if (status.effective?.version === 1) {
      await expect(after.getByTestId("consent-effective")).toContainText("Permission active · version 1");
      await expect(after.getByTestId("consent-effective")).toContainText("not active yet");
      await expect(after.getByTestId("consent-approved-snapshot")).toContainText("LinkedIn");
      await expect(after.getByTestId("consent-approved-resume")).toContainText("None (profile only)");
    } else {
      await expect(after.getByTestId("consent-delivery")).toContainText(/being delivered|needs attention/);
      await expect(after.locator('[data-testid="consent-effective"]')).toHaveCount(0);
    }
  });

  test("stale, unhealthy or missing privacy sync is shown as temporarily unavailable, never as a saved permission", async ({ page }) => {
    await login(page);
    for (const state of ["stale", "unhealthy", "missing"] as const) {
      await setPrivacySync(state);
      const panel = await openPanel(page);
      const before = await page.request.get("/api/candidate/consent").then((r) => r.json());
      await panel.locator("#consent-display-name").fill("Consent Candidate");
      await panel.locator("#consent-agree").check();
      await panel.getByTestId("consent-grant").click();
      await confirmWithPassword(page);
      await expect(panel.getByTestId("consent-notice")).toContainText("Temporarily unavailable, try again");
      await expect(panel.getByTestId("consent-retry"), "safe retry of the same request is offered").toBeVisible();
      await expect(page.getByText(/denied/i)).toHaveCount(0);
      const afterAttempt = await page.request.get("/api/candidate/consent").then((r) => r.json());
      expect(afterAttempt.version, `no consent write while ${state}`).toBe(before.version);
    }
    await setPrivacySync("healthy");
  });

  test("withdrawal is shown as pending until confirmed and never as effective from a 202", async ({ page }) => {
    await login(page);
    const status = await page.request.get("/api/candidate/consent").then((r) => r.json());
    test.skip(status.desired?.action !== "grant", "needs the grant from the first test");
    const panel = await openPanel(page);
    await panel.getByTestId("consent-withdraw").click();
    await confirmWithPassword(page);
    const notice = panel.getByTestId("consent-notice");
    await expect(notice).toHaveText(/Withdrawal \(version \d+\) pending|Permission withdrawn/);
    const after = await page.request.get("/api/candidate/consent").then((r) => r.json());
    expect(after.desired?.action).toBe("withdraw");
    if (after.effective?.action !== "withdraw" || after.effective?.version !== after.version) {
      await expect(notice).toHaveText(/Withdrawal \(version \d+\) pending/);
      await expect(page.getByText(/Permission withdrawn\./)).toHaveCount(0);
    }
  });
});
