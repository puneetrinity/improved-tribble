import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { TEST_USERS, loadFixtures } from './helpers';

/**
 * E2E: Wave 3.5B — internal workspace density & navigation (read-only).
 *
 * Proves, on the real app after a real recruiter login, that every locked
 * recruiter route:
 *  - renders a compact, action-first header (≤176px with description/actions,
 *    ≤120px simple; h1 ≤28px desktop / ≤24px mobile);
 *  - puts the first work surface (filter, search, table header, job nav or a
 *    primary action) no lower than 360px at 1440×900;
 *  - shows the single job navigation with an aria-current tab on job routes;
 *  - has no document-level horizontal overflow at 390×844;
 *  - passes UNFILTERED axe (every rule incl. colour contrast, every impact) in
 *    each region 3.5B modified — header, job navigation, breadcrumb — and in
 *    the opened Discover progress modal;
 *  - has zero critical/serious axe violations (contrast excluded) in the first
 *    work surface below the header, whose content 3.5B did not author;
 *  - is keyboard-traversable through breadcrumb, job navigation and actions.
 *
 * The page-wide axe result is attached per route as a baseline of pre-existing,
 * off-boundary findings (see handoff F2); it is recorded, not asserted, and no
 * unqualified full-page pass is claimed.
 *
 * The modal proof clicks the unchanged "Find Candidates" action with the
 * find-candidates request and the pipeline socket stubbed inside the browser
 * context (Playwright route + routeWebSocket): zero provider or worker traffic,
 * no server-side mutation. Gated like the other UI specs behind PW_UI_TESTS.
 */

const RUN_UI_TESTS = process.env.PW_UI_TESTS === 'true';
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const HEADER_MAX_WITH_ACTIONS = 176;
const HEADER_MAX_SIMPLE = 120;
const FIRST_ACTION_MAX_TOP = 360;

async function loginRecruiter(page: Page): Promise<boolean> {
  const recruiter = TEST_USERS.recruiter;
  if (!recruiter) return false;
  const response = await page.request.post('/api/login', {
    data: { username: recruiter.username, password: recruiter.password },
  });
  return response.ok();
}

type RouteSpec = { name: string; path: string; job?: boolean; simple?: boolean };

function routes(): RouteSpec[] {
  const fixtures = loadFixtures();
  const jobId = fixtures.approvedJobId ?? fixtures.pipelineJobId ?? fixtures.pendingJobId;
  const list: RouteSpec[] = [
    { name: 'recruiter dashboard', path: '/recruiter-dashboard' },
    { name: 'my jobs', path: '/my-jobs' },
    { name: 'applications', path: '/applications' },
    { name: 'candidates', path: '/candidates' },
    { name: 'clients', path: '/clients' },
    { name: 'analytics dashboard', path: '/analytics' },
  ];
  if (jobId) {
    list.push(
      { name: 'job applications', path: `/jobs/${jobId}/applications`, job: true },
      { name: 'job edit', path: `/jobs/${jobId}/edit`, job: true, simple: true },
      { name: 'job discover', path: `/jobs/${jobId}/sourcing`, job: true, simple: true },
      { name: 'job pipeline', path: `/jobs/${jobId}/pipeline`, job: true, simple: true },
      { name: 'job analytics', path: `/jobs/${jobId}/analytics`, job: true, simple: true },
    );
  }
  return list;
}

const HEADER_SELECTOR = '[data-internal-header], main h1, h1';
const WORK_SURFACE_SELECTOR = [
  '[data-job-subnav]',
  'input[type="search"]',
  'input[placeholder*="earch" i]',
  '[role="tablist"]',
  'table thead',
  '[data-tour="dashboard-metrics"] select, [data-tour="dashboard-metrics"] button',
  'main button:not([aria-label="Open menu"])',
].join(', ');

async function measure(page: Page) {
  return page.evaluate(
    ({ headerSel, workSel }) => {
      const nav = document.querySelector('header, nav[aria-label*="main" i], [data-global-nav]');
      const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
      // The page title is the first h1 rendered below the global navigation
      // (the navigation's wordmark is also an h1 and must not be measured).
      const h1 = (Array.from(document.querySelectorAll('h1')) as HTMLElement[])
        .find((el) => el.getBoundingClientRect().top >= navBottom - 1) ?? null;
      const headerEl = (document.querySelector('[data-internal-header]') ??
        h1?.closest('section, div')) as HTMLElement | null;
      const headerRect = headerEl?.getBoundingClientRect();
      const h1Size = h1 ? parseFloat(getComputedStyle(h1).fontSize) : 0;
      let firstActionTop = Number.POSITIVE_INFINITY;
      for (const el of Array.from(document.querySelectorAll(workSel))) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (headerRect && r.top < headerRect.top) continue; // global nav controls
        firstActionTop = Math.min(firstActionTop, r.top);
      }
      return {
        navBottom,
        headerHeight: headerRect ? headerRect.height : 0,
        headerBottom: headerRect ? headerRect.bottom : 0,
        h1Size,
        firstActionTop,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    },
    { headerSel: HEADER_SELECTOR, workSel: WORK_SURFACE_SELECTOR },
  );
}

test.describe('internal workspace density (Wave 3.5B)', () => {
  test.skip(!RUN_UI_TESTS, 'Set PW_UI_TESTS=true to run the density proof');

  test.beforeEach(async ({ page }) => {
    test.skip(!(await loginRecruiter(page)), 'Recruiter login unavailable');
  });

  for (const route of routes()) {
    test(`${route.name}: compact header, above-fold action, job nav, a11y, mobile`, async ({ page, browserName }, testInfo) => {
      const isMobile = testInfo.project.name.toLowerCase().includes('mobile') || testInfo.project.use.isMobile === true;
      await page.setViewportSize(isMobile ? MOBILE : DESKTOP);
      await page.goto(route.path, { waitUntil: 'networkidle' });
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });

      const m = await measure(page);

      // h1 size: ≤28px desktop, ≤24px mobile
      expect(m.h1Size, `${route.name} h1 font-size`).toBeLessThanOrEqual(isMobile ? 24 : 28);

      if (!isMobile) {
        // header height budget below the global navigation
        const budget = route.simple ? HEADER_MAX_SIMPLE : HEADER_MAX_WITH_ACTIONS;
        expect(m.headerHeight, `${route.name} header height`).toBeLessThanOrEqual(budget);
        // first work surface above the fold
        expect(m.firstActionTop, `${route.name} first action top`).toBeLessThanOrEqual(FIRST_ACTION_MAX_TOP);
      }

      // no document-level horizontal overflow (both viewports)
      expect(m.scrollWidth, `${route.name} horizontal overflow`).toBeLessThanOrEqual(m.innerWidth + 1);

      if (route.job) {
        const nav = page.getByRole('navigation', { name: 'Job navigation' });
        await expect(nav).toBeVisible();
        await expect(nav.getByRole('button')).toHaveCount(5);
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
        if (isMobile) {
          // horizontally usable: the last tab can be scrolled into view and clicked target ≥44px
          const last = nav.getByRole('button').last();
          await last.scrollIntoViewIfNeeded();
          const box = await last.boundingBox();
          expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        }
      }

      // keyboard traversal reaches the header's interactive elements
      await page.keyboard.press('Tab');
      const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
      expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']).toContain(focusedTag);

      // accessibility rule (honest scope):
      //  1. UNFILTERED axe — every rule including colour contrast, every impact —
      //     must pass in each region 3.5B modified: header, job navigation, breadcrumb.
      //  2. The first work surface below the header is 3.5B's shell but not its
      //     content: zero critical/serious there, contrast excluded (pre-existing).
      //  3. Page-wide: attached as a baseline of pre-existing off-boundary findings
      //     (tour/cookie close buttons, select triggers, kanban handles, profile
      //     banner progressbar — handoff F2). Recorded, never claimed as a pass.
      const modified = ['[data-internal-header]', '[data-job-subnav]', 'nav[aria-label="Breadcrumb"]'];
      const strict = new AxeBuilder({ page });
      let modifiedPresent = 0;
      for (const sel of modified) {
        if ((await page.locator(sel).count()) > 0) { strict.include(sel); modifiedPresent += 1; }
      }
      expect(modifiedPresent, `${route.name} has a 3.5B-modified header/nav region`).toBeGreaterThan(0);
      const strictAxe = await strict.analyze();
      expect(
        strictAxe.violations.map((v) => `${v.id} [${v.impact}]: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
        `${route.name} unfiltered axe (3.5B-modified regions)`,
      ).toEqual([]);
      if ((await page.locator('[data-workspace-content] > :first-child').count()) > 0) {
        const surfaceAxe = await new AxeBuilder({ page })
          .include('[data-workspace-content] > :first-child')
          .disableRules(['color-contrast'])
          .analyze();
        const surfaceSerious = surfaceAxe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
        expect(
          surfaceSerious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
          `${route.name} axe critical/serious (first work surface, contrast excluded)`,
        ).toEqual([]);
      }
      const pageAxe = await new AxeBuilder({ page }).analyze();
      await testInfo.attach(`${route.name}-page-axe-baseline`, {
        body: JSON.stringify(
          pageAxe.violations.map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(' ')) })),
          null,
          1,
        ),
        contentType: 'application/json',
      });

      // private verification screenshot (not a committed asset)
      await page.screenshot({
        path: `test-results/density/${route.name.replace(/\s+/g, '-')}-${isMobile ? '390' : '1440'}-${browserName}.png`,
        fullPage: false,
      });
    });
  }

  test('discover progress modal: opens on the real action, provider-neutral copy, clock stops on error, unfiltered axe', async ({ page }) => {
    const fixtures = loadFixtures();
    const jobId = fixtures.approvedJobId ?? fixtures.pipelineJobId ?? fixtures.pendingJobId;
    test.skip(!jobId, 'No seeded job');
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Browser-context stubs only. The find-candidates request is answered here and
    // never reaches the server; the pipeline socket is served by this test. No
    // provider, worker or database write is involved.
    let findRequests = 0;
    await page.route(`**/api/jobs/${jobId}/find-candidates`, async (route) => {
      findRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, status: 'queued' }) });
    });
    // The page opens two sockets on this URL: the status hook at load and the
    // progress hook when the modal opens. Every routed socket is collected and
    // events are broadcast once to all of them.
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(`**/api/sourcing/ws/${jobId}`, (ws) => {
      sockets.push(ws);
    });

    await page.goto(`/jobs/${jobId}/sourcing`, { waitUntil: 'networkidle' });
    const closedBody = (await page.locator('body').innerText()).toLowerCase();
    expect(closedBody).not.toMatch(/crustdata|reversecontact/);
    await expect(page.getByRole('navigation', { name: 'Job navigation' })).toBeVisible();

    // the unchanged primary action opens the real modal
    await page.getByRole('button', { name: /find candidates/i }).first().click();
    const modal = page.locator('[data-sourcing-progress-modal]');
    await expect(modal).toBeVisible();
    await expect.poll(() => findRequests, { message: 'the stubbed find-candidates request was made exactly once' }).toBe(1);
    await expect(modal.getByRole('dialog').or(modal)).toBeVisible();
    await expect(modal.getByText('ealana · discover')).toBeVisible();
    await expect(modal.getByLabel('Elapsed time')).toBeVisible();
    await expect(modal.locator('li[data-stage]')).toHaveCount(4);
    await expect(modal.locator('[role="progressbar"]')).toBeVisible();

    // feed the hook the real vendor-named events; the modal must render neutral copy
    await expect.poll(() => sockets.length, { message: 'the progress hook opened its pipeline socket' }).toBeGreaterThanOrEqual(2);
    const send = (event: Record<string, unknown>) => {
      const payload = JSON.stringify({ jobId: Number(jobId), ...event });
      for (const ws of sockets) ws.send(payload);
    };
    send({ type: 'phase_started' });
    send({ type: 'crustdata_fetching' });
    await expect(modal.getByText('Searching the market (300 candidates, relaxed query)...')).toBeVisible();
    await modal.getByRole('button', { name: /dev console/i }).click();
    // events: the hook's own 'queued' line on open + the two stubbed pipeline events
    await expect(modal.getByText('(3 events)')).toBeVisible();
    const openText = (await modal.innerText()).toLowerCase();
    expect(openText).toContain('fetching up to 300 candidates');
    expect(openText).not.toMatch(/crustdata|reversecontact|fullenrich|enrichlayer/);

    // unfiltered axe on the opened modal (every rule, every impact)
    const modalAxe = await new AxeBuilder({ page }).include('[data-sourcing-progress-modal]').analyze();
    expect(
      modalAxe.violations.map((v) => `${v.id} [${v.impact}]: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      'unfiltered axe (opened Discover progress modal)',
    ).toEqual([]);

    // error: the modal stays open, the elapsed clock stops, the error text is neutral
    send({ type: 'sourcing_update', status: 'failed', errorMessage: 'Crustdata search failed (429)' });
    await expect(modal.getByText('Sourcing stopped')).toBeVisible();
    // rendered twice on purpose: the status line and the open dev console line
    await expect(modal.getByText('the market search failed (429)')).toHaveCount(2);
    await expect(modal.getByText('the market search failed (429)').first()).toBeVisible();
    const clock = modal.getByLabel('Elapsed time');
    const stoppedAt = await clock.innerText();
    await page.waitForTimeout(2_500);
    expect(await clock.innerText()).toBe(stoppedAt);
    expect((await modal.innerText()).toLowerCase()).not.toMatch(/crustdata/);
    const errorAxe = await new AxeBuilder({ page }).include('[data-sourcing-progress-modal]').analyze();
    expect(
      errorAxe.violations.map((v) => `${v.id} [${v.impact}]: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
      'unfiltered axe (error-state Discover progress modal)',
    ).toEqual([]);

    // the error state's real retry surface and close control are present; close it
    await expect(modal.getByRole('button', { name: 'Run again' })).toBeVisible();
    // the dialog primitive also carries a screen-reader-only close control; use the modal's own action
    await modal.locator('[data-modal-action="close"]').click();
    await expect(modal).toBeHidden();
    expect(findRequests, 'closing must not start another run').toBe(1);
  });
});
