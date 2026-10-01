import { test, expect } from '@playwright/test';

// Explicitly opt in against the disposable seeded stack described in the handoff.
// Never register/apply, upload, contact a provider, or run against a public host.
const enabled = process.env.SEO_DISPOSABLE_TEST === '1';
const prose = 'Build reliable systems and collaborate with our engineering team.';
const internal = /eliteSchools|rejectTitleRegex|roleTitle|F1_CANARY/;

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
      expect(await res.text()).not.toMatch(/reviewComments|jdDigest|organizationId|hiringManagerId|clientId|originalJD|experienceYearsMax/);
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

test.describe('F-1 built public/management contract', () => {
  test.skip(!enabled || process.env.FLOW_F1_DISPOSABLE !== '1', 'Requires F-1 synthetic additions.');
  const publicKeys = 'id title location type description skills goodToHaveSkills educationRequirement experienceYears salaryMin salaryMax salaryPeriod deadline createdAt updatedAt slug isActive status expiresAt postedByName postedById isRecruiterProfilePublic clientName clientDomain'.split(' ').sort();
  test.beforeEach(async ({ page, baseURL }) => {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw Error('local target required');
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort());
  });
  for (const username of [null, 'candidate90002@fixture.invalid', 'recruiter90001@fixture.invalid', 'admin90008@fixture.invalid']) {
    test(`same exact public DTO for ${username ?? 'anonymous'}`, async ({ page }) => {
      if (username) expect((await page.request.post('/api/login', { data: { username, password: 'seo-fixture-password' } })).status()).toBe(200);
      for (const path of ['/api/jobs/90001', '/api/jobs/seo-fixture-90001?admin=true']) {
        const res = await page.request.get(path);
        expect(res.status()).toBe(200);
        expect(Object.keys(await res.json()).sort()).toEqual(publicKeys);
        expect(await res.text()).not.toMatch(internal);
      }
      const list = await (await page.request.get('/api/jobs?limit=1000&admin=true')).json();
      for (const job of list.jobs) expect(Object.keys(job).sort()).toEqual(publicKeys);
      expect(list.jobs.map((job: { id: number }) => job.id)).not.toEqual(expect.arrayContaining([90006]));
      expect(list.jobs.map((job: { id: number }) => job.id)).not.toEqual(expect.arrayContaining([90007]));
      expect(list.pagination.limit).toBe(100);
      expect(list.jobs.length).toBeLessThanOrEqual(100);
      const defaults = await (await page.request.get('/api/jobs')).json();
      expect(defaults.pagination.limit).toBe(10);
      const recruiterJobsResponse = await page.request.get('/api/recruiters/90001/jobs');
      expect(recruiterJobsResponse.status()).toBe(200);
      const recruiterJobs = (await recruiterJobsResponse.json()).jobs;
      expect(recruiterJobs.map((job: { id: number }) => job.id)).toContain(90001);
      for (const excluded of [90005, 90006, 90007]) {
        expect(recruiterJobs.map((job: { id: number }) => job.id)).not.toContain(excluded);
      }
      expect((await page.request.get('/api/recruiters/90005/jobs')).status()).toBe(404);
      for (const query of ['page=0', 'limit=-1', 'page=1.5', 'limit=2junk', 'page=1&page=2', 'limit[x]=2', 'page=9007199254740991&limit=100']) {
        expect((await page.request.get(`/api/jobs?${query}`)).status()).toBe(400);
      }
      await page.goto('/jobs/90001');
      await expect(page.getByText(prose, { exact: false }).first()).toBeVisible();
      expect(await page.content()).not.toMatch(internal);
    });
  }
  test('real authentication and private response headers refuse anonymous/candidate/foreign readers', async ({ page }) => {
    let res = await page.request.get('/api/jobs/90001/management');
    expect(res.status()).toBe(401);
    expect(res.headers()['cache-control']).toBe('private, no-store');
    for (const [username, status] of [['candidate90002@fixture.invalid', 403], ['recruiter90007@fixture.invalid', 404]] as const) {
      expect((await page.request.post('/api/login', { data: { username, password: 'seo-fixture-password' } })).status()).toBe(200);
      res = await page.request.get('/api/jobs/90001/management');
      expect(res.status()).toBe(status);
      expect(res.headers()['cache-control']).toBe('private, no-store');
      expect(await res.text()).not.toMatch(/organizationId|F1_CANARY/);
    }
  });
  test('authorized editor and application management retain HM/client IDs; public reads never inherit them', async ({ page }) => {
    expect((await page.request.post('/api/login', { data: { username: 'recruiter90001@fixture.invalid', password: 'seo-fixture-password' } })).status()).toBe(200);
    const management = await page.request.get('/api/jobs/90001/management');
    expect(management.status()).toBe(200);
    expect(management.headers()['cache-control']).toBe('private, no-store');
    expect(Object.keys(await management.json()).sort()).toEqual([...publicKeys, 'organizationId', 'hiringManagerId', 'clientId'].sort());
    expect(await management.json()).toMatchObject({ organizationId: 90001, hiringManagerId: 90006, clientId: 90001 });
    // Real directory responses arrive after the job; late options must not clear assignments.
    await page.route(/\/api\/(?:users\?|clients(?:\?|$))/, async route => {
      const response = await route.fetch();
      await new Promise(resolve => setTimeout(resolve, 700));
      await route.fulfill({ response });
    });
    await page.goto('/jobs/90001/edit');
    await expect(page.locator('#description')).toHaveValue(/Build reliable systems/);
    await expect(page.getByRole('combobox').filter({ hasText: 'Manager Fixture' })).toBeVisible();
    await expect(page.getByRole('combobox').filter({ hasText: 'Public Fixture Company' })).toBeVisible();
    const response = page.waitForResponse(r => r.url().endsWith('/api/jobs/90001/management'));
    await page.goto('/jobs/90001/applications');
    expect((await response).status()).toBe(200);
    await expect(page.getByText('Synthetic engineer', { exact: true }).first()).toBeVisible();
    expect((await page.request.get('/api/jobs/90004/management')).status()).toBe(404);
    expect((await page.request.get('/api/jobs/90005/management')).status()).toBe(404);
    expect((await page.request.get('/api/jobs/not-a-number/management')).status()).toBe(404);
    expect(Object.keys(await (await page.request.get('/api/jobs/90001')).json()).sort()).toEqual(publicKeys);
    // Change actor in the same browser context; no former actor's job read is reused.
    expect((await page.request.post('/api/login', { data: { username: 'recruiter90007@fixture.invalid', password: 'seo-fixture-password' } })).status()).toBe(200);
    await page.goto('/jobs/90001/edit');
    await expect(page.locator('#description')).toHaveCount(0);
    await expect(page.getByText(/Job Not Found/i)).toBeVisible();
    expect((await page.request.get('/api/jobs/90005/management')).status()).toBe(200);
    expect(Object.keys(await (await page.request.get('/api/jobs/90001')).json()).sort()).toEqual(publicKeys);
  });
});
