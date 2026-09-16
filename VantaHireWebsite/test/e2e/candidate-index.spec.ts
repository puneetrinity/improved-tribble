/**
 * Wave 4D — candidates page private-index adoption, real seeded stack (desktop + Pixel 5 via playwright.config projects).
 *
 * A recruiter is registered through the real API, verified in the seeded database, given an organisation through the
 * real organisation route, and logged in through the real session. The page and its actions are real. The index
 * states (ready / updating / refresh failed / pending counts / saturation / reranker) are served at the browser's
 * network boundary in the server's exact response shape because the disposable stack has no Memory; the
 * unavailability path is the real server's 503 when the private index cannot be reached.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "";
const PASSWORD = "Index-e2e-passw0rd!";
const EMAIL = `index-lead-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.invalid`;
const LONG = "x".repeat(240);

async function sql(text: string, params: unknown[] = []) {
  const client = new Client({ connectionString: DATABASE_URL }); await client.connect();
  try { return (await client.query(text, params)).rows; } finally { await client.end(); }
}
async function login(page: Page) {
  // The first-visit product tour is outside the 4D surface; mark it seen through the product's own storage key so the
  // welcome prompt (1.5 s after mount) never overlaps the audited moments. Nothing on the reserved page is hidden.
  await page.addInitScript(() => { window.localStorage.setItem("vantahire_first_visit", "true"); });
  const r = await page.request.post("/api/login", { data: { username: EMAIL, password: PASSWORD } });
  expect(r.ok(), `login ${r.status()}`).toBeTruthy();
}
const counts = (o: Partial<Record<string, number>> = {}) => ({ ready: 0, updating: 0, refresh_failed: 0, pending: 0, needs_review: 0, failed: 0, ...o });
function hit(applicationId: number, state: string, generation: number | null, observed: string | null, name = `Applicant ${applicationId}`) {
  return {
    applicationId, name, email: `a${applicationId}@example.invalid`, phone: null, currentJobId: 1, currentJobTitle: "Backend Engineer",
    currentStageId: 1, currentStageName: "Applied", matchScoreRaw: 0.77, matchScore: 77, matchedChunks: 2,
    highlights: ["Built payment services", LONG], resume: { resumeFilename: "resume.pdf", signedUrl: null, expiresAt: null },
    canMoveToJob: true, canOpenResume: true, indexState: state, indexGeneration: generation, sourceObservedAt: observed,
  };
}
async function serveIndexStates(page: Page) {
  await page.route("**/api/candidates/semantic-search", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      query: "payments", count: 4, scoreType: "cross_encoder", displayScoreType: "cosine",
      indexProcessing: { counts: counts({ ready: 38, updating: 2, refresh_failed: 1, pending: 6, needs_review: 1 }), bounded: true, limit: 1000 },
      indexReranker: "applied", indexSaturated: true,
      results: [hit(101, "ready", 4, "2026-09-12T10:00:00.000Z", LONG), hit(102, "updating", 3, "2026-09-11T10:00:00.000Z"),
        hit(103, "refresh_failed", 2, "2026-09-10T10:00:00.000Z"), { ...hit(104, "legacy", null, null), indexState: "legacy" }],
      candidates: [],
    }) });
  });
}

async function serveResponse(page: Page, status: number, body: unknown) {
  await page.unroute("**/api/candidates/semantic-search");
  await page.route("**/api/candidates/semantic-search", (route) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
}
/**
 * Whole-page, unfiltered axe (lock §7/§10.8, including opened dialogs). Violations that pre-exist at HEAD on nodes
 * OUTSIDE the 4D allowance are listed here by rule and target, not hidden: any other violation fails, and no node of
 * the reserved page (search bar, results, status region, empty/error panels, dialog) may appear.
 */
const PRE_EXISTING_OUTSIDE_ALLOWANCE: Array<{ id: string; html: RegExp }> = [
  // cookie banner (shared component, unchanged at HEAD): accept button white-on-brand contrast, label and text outside a landmark
  { id: "color-contrast", html: /hover:brightness-110/ },
  { id: "region", html: /Cookie Preferences/ },
  { id: "region", html: /We use cookies/ },
  // app sidebar (shared shadcn sidebar, unchanged at HEAD): avatar initials contrast, group label outside a landmark
  { id: "color-contrast", html: /bg-sidebar-primary/ },
  { id: "region", html: /data-sidebar="group-label"/ },
  // shared empty-state primitive (unchanged at HEAD) renders its title as an h3 under the page h1
  { id: "heading-order", html: /^<h3 class="font-satoshi/ },
];
async function auditPage(page: Page, moment: string) {
  await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page }).analyze();
  const nodes = axe.violations.flatMap(v => v.nodes.map(n => ({ id: v.id, impact: v.impact, target: String(n.target[0]), html: n.html.slice(0, 160) })));
  const unexpected = nodes.filter(n => !PRE_EXISTING_OUTSIDE_ALLOWANCE.some(p => p.id === n.id && p.html.test(n.html)));
  expect(unexpected, `${moment}: ${JSON.stringify(unexpected)}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test.describe("Wave 4D candidates page index adoption", () => {
  test.skip(!DATABASE_URL, "DATABASE_URL is required to verify the seeded recruiter");

  test.beforeAll(async ({ request }) => {
    const register = await request.post("/api/register", { data: { username: EMAIL, password: PASSWORD, firstName: "Index", lastName: "Lead", role: "recruiter" } });
    expect(register.status(), `register ${register.status()}`).toBeLessThan(400);
    await sql("UPDATE users SET email_verified=true WHERE lower(username)=lower($1)", [EMAIL]);
    // The organisation route attaches the free plan; the seeded stack carries no plans, so seed exactly that row.
    await sql(`INSERT INTO subscription_plans (name, display_name, description, price_per_seat_monthly, price_per_seat_annual,
               ai_credits_per_seat_monthly, features, is_active, sort_order)
               VALUES ('free', 'Free', 'e2e fixture plan', 0, 0, 0, '{}'::jsonb, true, 0) ON CONFLICT (name) DO NOTHING`);
    const login = await request.post("/api/login", { data: { username: EMAIL, password: PASSWORD } });
    expect(login.ok()).toBeTruthy();
    const csrf = await (await request.get("/api/csrf-token")).json();
    const org = await request.post("/api/organizations", { headers: { "x-csrf-token": csrf.token }, data: { name: `Index Fixture Org ${Date.now()}` } });
    expect(org.status(), `organization ${org.status()}`).toBeLessThan(400);
    // The recruiter route guard sends incomplete recruiters to onboarding; mark the fixture recruiter complete the way
    // the real flow does (timestamp plus an existing membership), so /candidates renders the real page.
    await sql("UPDATE users SET onboarding_completed_at=now(), first_name='Index', last_name='Lead' WHERE lower(username)=lower($1)", [EMAIL]);
  });

  test("honest index states, counts, actions, keyboard reach, 44px controls, no overflow and unfiltered axe", async ({ page }) => {
    await login(page); await serveIndexStates(page);
    await page.goto("/candidates");
    await expect(page.getByTestId("search-results").or(page.getByPlaceholder(/./).first())).toBeVisible();
    await expect(page.getByText("Welcome to ealana")).toHaveCount(0);
    const input = page.getByRole("textbox").first();
    await expect(input).toBeVisible();
    await input.fill("payments");
    await page.keyboard.press("Enter");
    const results = page.getByTestId("search-results");
    await expect(results).toBeVisible();
    const badges = page.getByTestId("index-state");
    await expect(badges).toHaveCount(4);
    await expect(badges.nth(0)).toHaveAttribute("data-state", "ready");
    await expect(badges.nth(0)).toContainText("v4");
    await expect(badges.nth(1)).toContainText("showing v3");
    await expect(badges.nth(2)).toHaveAttribute("data-state", "refresh_failed");
    await expect(badges.nth(3)).toHaveAttribute("data-state", "legacy");
    const processing = page.getByTestId("index-processing");
    await expect(processing).toHaveAttribute("role", "status");
    await expect(processing).toContainText("38 indexed");
    await expect(processing).toContainText("6 pending");
    await expect(processing).toContainText("not searchable yet");
    await expect(processing).toContainText("capped at 1,000");
    await expect(page.getByText("Showing the first 100 matches", { exact: false })).toBeVisible();
    await expect(page.getByText(/all applicants|fully indexed|every applicant/i)).toHaveCount(0);
    // retained actions
    await expect(page.getByRole("button", { name: /resume/i })).toHaveCount(4);
    await expect(page.getByRole("button", { name: /add to job|move/i })).toHaveCount(4);
    // keyboard: Tab from the query input reaches the first result's actions
    await input.focus();
    const reached = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const label = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim().slice(0, 30) || "");
      if (label) reached.add(label);
      if (/add to job|move/i.test(label)) break;
    }
    expect([...reached].some(l => /resume/i.test(l)), "resume action reachable by Tab").toBe(true);
    // 44px controls and no clipping, both devices
    const viewport = page.viewportSize()!;
    for (const control of await results.locator("button").all()) {
      const box = await control.boundingBox(); if (!box) continue;
      expect(box.height, "touch target height").toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    for (const badge of await badges.all()) {
      const box = (await badge.boundingBox())!; expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await auditPage(page, "results");
    // opened Add-to-job dialog, audited unfiltered as well
    await page.getByRole("button", { name: /add to job|move/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await auditPage(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("empty result keeps the processing counts, claims nothing and is audited", async ({ page }) => {
    await login(page);
    await serveResponse(page, 200, { query: "nobody", count: 0, scoreType: "cosine", displayScoreType: "cosine",
      indexProcessing: { counts: counts({ ready: 3, pending: 2 }), bounded: false, limit: 1000 }, indexReranker: "skipped", indexSaturated: false, results: [], candidates: [] });
    await page.goto("/candidates");
    await page.getByRole("textbox").first().fill("nobody");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("search-empty")).toBeVisible();
    await expect(page.getByTestId("index-processing")).toContainText("2 pending");
    await auditPage(page, "empty");
  });

  test("every closed code and any vendor or raw body renders closed copy only", async ({ page }) => {
    await login(page);
    await page.goto("/candidates");
    const cases: Array<[string, number, unknown, RegExp]> = [
      ["conflict", 422, { code: "candidate_index_filter_conflict" }, /filters conflict/i],
      ["long", 422, { code: "candidate_index_query_too_long" }, /too long/i],
      ["privacy", 503, { code: "candidate_privacy_reconciliation_required" }, /privacy settings are being updated/i],
      ["legacy", 500, { error: "ActiveKG /search returned 503" }, /Search failed\. Try again\./],
    ];
    for (const [query, status, body, copy] of cases) {
      await serveResponse(page, status, body);
      const input = page.getByRole("textbox").first();
      await input.fill(query);
      await page.keyboard.press("Enter");
      const error = page.getByTestId("search-error");
      await expect(error, query).toBeVisible();
      await expect(error, query).toContainText(copy);
      await expect(page.getByText(/candidate_index|candidate_privacy|activekg|crustdata|\{"/i), query).toHaveCount(0);
    }
    await auditPage(page, "error");
  });

  test("unavailability from the real server is shown as closed copy, never a raw code", async ({ page }) => {
    await login(page);
    await page.goto("/candidates");
    await page.getByRole("textbox").first().fill("anything");
    await page.keyboard.press("Enter");
    // Dual mode with an unreachable Memory origin: the real server answers 503 with a closed code, the page shows closed copy.
    const error = page.getByTestId("search-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("Search is temporarily unavailable");
    await expect(page.getByText("candidate_index_search_unavailable")).toHaveCount(0);
    await expect(page.getByText(/crustdata|activekg|memory api/i)).toHaveCount(0);
    await auditPage(page, "error-real");
  });
});
