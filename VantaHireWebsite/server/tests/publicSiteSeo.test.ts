// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { existsSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateJobPostingSchema } from '../seoUtils';
import { generateJobMetaDescription, generateJobPostingJsonLd } from '../../client/src/lib/seoHelpers';
import { jobMetaDescription } from '../../shared/jobDescription';

const fixtures = vi.hoisted(() => ({ jobs: new Map<number, any>() }));
vi.mock('../storage', () => ({ storage: {
  getJobWithRecruiter: async (id: number) => fixtures.jobs.get(id),
  getJobBySlug: async (slug: string) => [...fixtures.jobs.values()].find(j => j.slug === slug),
} }));

describe('built public job HTML and client projections', () => {
  const prose = 'Build reliable systems and collaborate with the engineering team.';
  const job = { id: 90001, title: 'Synthetic engineer', location: 'Bengaluru', type: 'full-time',
    description: '{"eliteSchools":["private"],"rejectTitleRegex":"secret","roleTitle":"Engineer"}',
    originalJD: prose, createdAt: new Date('2026-01-01'), status: 'approved', isActive: true, slug: 'synthetic-engineer-90001', skills: [] };
  const app = express();
  let ownedAssetLink = false;
  beforeAll(async () => {
    // Source-module invocation has a different dirname than the built server.
    // Link only our built assets; never overwrite an existing source directory.
    if (!existsSync(resolve('server/public'))) {
      symlinkSync(resolve('dist/public'), resolve('server/public'), 'dir');
      ownedAssetLink = true;
    }
    fixtures.jobs.set(job.id, job);
    fixtures.jobs.set(90002, { ...job, id: 90002, isActive: false });
    fixtures.jobs.set(90003, { ...job, id: 90003, originalJD: null });
    fixtures.jobs.set(90004, { ...job, id: 90004, originalJD: '[Remote] Build backend systems.' });
    fixtures.jobs.set(90005, { ...job, id: 90005, originalJD: '{Company} is hiring.' });
    fixtures.jobs.set(90006, { ...job, id: 90006, originalJD: null, description: '{"roleTitle":' });
    const { serveStatic } = await import('../vite');
    await serveStatic(app);
  });
  afterAll(() => { if (ownedAssetLink) unlinkSync(resolve('server/public')); });
  it('has exactly one server metadata value and safe prose', async () => {
    const res = await request(app).get('/jobs/90001');
    expect(res.status).toBe(200);
    for (const key of ['description', 'og:description', 'twitter:description']) {
      expect(res.text.match(new RegExp(`(?:name|property)="${key}"`, 'g'))).toHaveLength(1);
    }
    expect(res.text).toContain(prose);
    expect(res.text).not.toMatch(/eliteSchools|rejectTitleRegex|roleTitle/);
    expect(res.text).toContain('data-rh="true"');
    expect(generateJobMetaDescription(job as any)).toBe(jobMetaDescription(job));
    expect(generateJobPostingJsonLd(job as any)?.description).toBe(prose);
  });
  it('omits JobPosting when only internal JSON exists', async () => {
    const res = await request(app).get('/jobs/90003');
    expect(res.text).not.toContain('data-schema="jobposting"');
    expect(res.text).not.toMatch(/eliteSchools|rejectTitleRegex|roleTitle/);
    expect(generateJobPostingSchema({ ...job, originalJD: undefined } as any)).toBeNull();
  });
  for (const [id, text] of [[90004, '[Remote] Build backend systems.'], [90005, '{Company} is hiring.']] as const) {
    it(`retains bracketed prose in metadata and server/client JobPosting (${id})`, async () => {
      const res = await request(app).get(`/jobs/${id}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain(text);
      expect(res.text).toContain('data-schema="jobposting"');
      expect(res.text).not.toMatch(/eliteSchools|rejectTitleRegex|roleTitle/);
      const fixture = fixtures.jobs.get(id);
      expect(generateJobMetaDescription(fixture)).toContain(text);
      expect(generateJobPostingJsonLd(fixture)?.description).toBe(text);
      expect(generateJobPostingSchema({ ...fixture, description: text })?.description).toBe(text);
    });
  }
  it('still omits JobPosting and internal keys for truncated structured content', async () => {
    const res = await request(app).get('/jobs/90006');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('data-schema="jobposting"');
    expect(res.text).not.toContain('roleTitle');
  });
  it('preserves closed statuses and raw unknown-route noindex', async () => {
    expect((await request(app).get('/jobs/90002')).status).toBe(410);
    expect((await request(app).get('/jobs/99999')).status).toBe(404);
    const missing = await request(app).get('/this-page-does-not-exist');
    expect(missing.status).toBe(404); expect(missing.text).toContain('noindex, nofollow');
    expect(missing.text).toContain('Page Not Found');
  });
  it('preserves static sitemap URLs without fictional modification dates', () => {
    const xml = readFileSync(resolve('client/public/sitemap.xml'), 'utf8');
    expect(xml).not.toContain('<lastmod>'); expect(xml).toContain('https://ealana.com/');
  });
});
