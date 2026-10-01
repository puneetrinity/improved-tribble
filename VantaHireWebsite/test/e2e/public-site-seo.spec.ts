import { test, expect } from '@playwright/test';

// Explicitly opt in against the disposable seeded stack described in the handoff.
// Never register/apply, upload, contact a provider, or run against a public host.
const enabled = process.env.SEO_DISPOSABLE_TEST === '1';
const prose = 'Build reliable systems and collaborate with our engineering team.';
const internal = /eliteSchools|rejectTitleRegex|roleTitle/;

test.describe('public prose and candidate projections on the built app', () => {
  test.skip(!enabled, 'Requires the isolated SEO fixture database, not production.');
  test.beforeEach(async ({ page, baseURL }) => {
    if (!baseURL || !['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname)) throw Error('local target required');
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(baseURL).origin) await route.continue();
      else await route.abort();
    });
  });

  test('raw crawler HTML, public APIs and hydrated job agree without duplicate metadata', async ({ page, request }) => {
    for (const url of ['/api/jobs/90001', '/api/jobs/seo-fixture-90001']) {
      const res = await request.get(url);
      expect(res.status()).toBe(200);
      expect(await res.text()).toContain(prose);
      expect(await res.text()).not.toMatch(internal);
    }
    const collection = await request.get('/api/jobs');
    expect(collection.status()).toBe(200);
    expect(await collection.text()).not.toMatch(internal);
    const raw = await request.get('/jobs/90001', { headers: { 'user-agent': 'Googlebot' } });
    expect(raw.status()).toBe(200);
    expect(await raw.text()).not.toMatch(internal);
    for (const key of ['description', 'og:description', 'twitter:description']) {
      expect((await raw.text()).match(new RegExp(`(?:name|property)="${key}"`, 'g'))).toHaveLength(1);
    }
    await page.goto('/jobs/90001');
    await expect(page.getByText(prose, { exact: false }).first()).toBeVisible();
    for (const key of ['description', 'og:description', 'twitter:description']) {
      await expect(page.locator(`meta[name="${key}"],meta[property="${key}"]`)).toHaveCount(1);
    }
    await expect(page.locator('script[data-schema="jobposting"]')).toHaveCount(1);
    expect(await page.content()).not.toMatch(internal);
  });

  test('JSON-only, inactive and missing pages stay closed and honest', async ({ page, request }) => {
    expect((await request.get('/jobs/90002')).status()).toBe(410);
    expect((await request.get('/jobs/999999')).status()).toBe(404);
    await page.goto('/jobs/90003');
    await expect(page.getByText('Job description unavailable.', { exact: true })).toBeVisible();
    await expect(page.locator('script[data-schema="jobposting"]')).toHaveCount(0);
    expect(await page.content()).not.toMatch(internal);
    const raw = await request.get('/seo-nonexistent-page');
    expect(raw.status()).toBe(404);
    expect(await raw.text()).toContain('noindex, nofollow');
    await page.goto('/seo-nonexistent-page');
    await expect(page).toHaveTitle(/Page Not Found/i);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('homepage landmarks, heading order, image dimensions and no premature analytics', async ({ page }, testInfo) => {
    const analytics: string[] = [];
    page.on('request', request => { if (/google-analytics|googletagmanager/.test(request.url())) analytics.push('attempt'); });
    await page.goto('/');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('footer h5')).toHaveCount(0);
    expect(await page.locator('footer h2').count()).toBeGreaterThan(0);
    await expect(page.locator('link[rel="preconnect"][href*="google-analytics"],link[rel="preconnect"][href*="googletagmanager"]')).toHaveCount(0);
    // Scope intrinsic-dimension proof to the approved CTA, not frozen sections.
    const images = page.locator('main section').last().locator('img');
    await expect(images).toHaveCount(1);
    for (const img of await images.all()) {
      expect(Number(await img.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(await img.getAttribute('height'))).toBeGreaterThan(0);
    }
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    expect(analytics).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  });

  test('real candidate APIs and dashboard expose prose, never extra raw fields', async ({ page }, testInfo) => {
    expect((await page.request.get('/api/my-applications')).status()).toBe(401);
    expect((await page.request.get('/api/candidate/saved-jobs')).status()).toBe(401);
    const login = await page.request.post('/api/login', { data: { username: 'candidate90002@fixture.invalid', password: 'seo-fixture-password' } });
    expect(login.status()).toBe(200);
    for (const url of ['/api/my-applications', '/api/candidate/saved-jobs']) {
      const res = await page.request.get(url);
      expect(res.status()).toBe(200);
      expect(await res.text()).toContain(prose);
      expect(await res.text()).not.toMatch(internal);
      expect(await res.text()).not.toMatch(/originalJD|jobDescriptionOriginal/);
    }
    await page.goto('/my-dashboard?tab=applications');
    await expect(page.getByText(prose, { exact: false }).first()).toBeVisible();
    await page.getByRole('tab', { name: /^Saved/ }).click();
    await expect(page.getByText(prose, { exact: false }).first()).toBeVisible();
    expect(await page.locator('body').innerText()).not.toMatch(internal);
    await page.screenshot({ path: testInfo.outputPath('candidate-saved.png'), fullPage: true });
  });

  test('another candidate cannot see the saved job or application', async ({ page }) => {
    expect((await page.request.post('/api/login', { data: { username: 'candidate90003@fixture.invalid', password: 'seo-fixture-password' } })).status()).toBe(200);
    expect(await (await page.request.get('/api/my-applications')).json()).toEqual([]);
    expect(await (await page.request.get('/api/candidate/saved-jobs')).json()).toEqual({ savedJobs: [] });
  });

  test('erased candidate cannot retrieve either projection', async ({ page }) => {
    expect((await page.request.post('/api/login', { data: { username: 'candidate90004@fixture.invalid', password: 'seo-fixture-password' } })).status()).toBe(200);
    const applications = await page.request.get('/api/my-applications');
    expect(applications.status()).toBe(200);
    expect(await applications.json()).toEqual([]);
    const saved = await page.request.get('/api/candidate/saved-jobs');
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toEqual({ restricted: true, savedJobs: [] });
  });
});
