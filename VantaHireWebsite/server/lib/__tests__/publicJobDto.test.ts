import { describe, expect, it, vi } from 'vitest';
import { toPublicJob, toManagementJob, type PublicJobSource } from '@shared/publicJob';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../db', () => ({ db: { select: () => { throw Error('synthetic DB failure'); } } }));
import { parseManagementJobId, readManagementJob } from '../jobManagementRead';

const keys = 'id title location type description skills goodToHaveSkills educationRequirement experienceYears salaryMin salaryMax salaryPeriod deadline createdAt updatedAt slug isActive status expiresAt postedByName postedById isRecruiterProfilePublic clientName clientDomain'.split(' ').sort();
const source = {
  id: 1, title: 'Engineer', location: 'Remote', type: 'full-time', description: '{"eliteSchools":"CANARY_RAW"}',
  originalJD: '[Remote] Build reliable systems.', skills: ['Python'], goodToHaveSkills: [],
  educationRequirement: null, experienceYears: 3, salaryMin: 1, salaryMax: 2, salaryPeriod: 'per_month',
  deadline: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
  slug: 'engineer', isActive: true, status: 'approved', expiresAt: null,
  postedBy: 987, postedById: 987, organizationId: 88, hiringManagerId: 89, clientId: 90,
  reviewComments: 'CANARY_REVIEW', jdDigest: { text: 'CANARY_DIGEST' }, experienceYearsMax: 999,
  deactivationReason: 'CANARY_REASON', futureColumn: 'CANARY_FUTURE',
  client: { name: 'Public company', domain: 'example.invalid', contact: 'CANARY_CONTACT' },
  recruiter: { firstName: 'Public', lastName: 'Recruiter', isProfilePublic: true, publicId: 'public-person', secret: 'CANARY_PERSON' },
};

describe('public job positive allowlist', () => {
  it('publishes exactly 24 keys; no unknown keys or internal values escape', () => {
    const result = toPublicJob(source);
    expect(Object.keys(result).sort()).toEqual(keys);
    expect(JSON.stringify(result)).not.toMatch(/CANARY|987|999|eliteSchools/);
    expect(result).toMatchObject({ description: '[Remote] Build reliable systems.', postedById: 'public-person', clientName: 'Public company' });
  });
  it.each([false, true])('never substitutes a numeric user identifier (public=%s)', isRecruiterProfilePublic => {
    expect(toPublicJob({ ...source, recruiter: null, isRecruiterProfilePublic }).postedById).toBeNull();
  });
  it('does not expose a private profile identifier', () => {
    expect(toPublicJob({ ...source, recruiter: { ...source.recruiter, isProfilePublic: false } }).postedById).toBeNull();
  });
  it('management adds exactly three identifiers, not the original row', () => {
    const result = toManagementJob(source);
    expect(Object.keys(result).sort()).toEqual([...keys, 'organizationId', 'hiringManagerId', 'clientId'].sort());
    expect(JSON.stringify(result)).not.toMatch(/CANARY|originalJD|jdDigest|experienceYearsMax/);
  });
  it('retains the frozen bracket/encoded/truncated prose behavior', () => {
    for (const originalJD of ['[Remote] Build.', '{Acme} Build.']) expect(toPublicJob({ ...source, originalJD }).description).toBe(originalJD);
    for (const originalJD of ['{"roleTitle":', '{\\"roleTitle\\":\\"x\\"}', '&quot;{\\"roleTitle\\":1}&quot;']) {
      expect(toPublicJob({ ...source, originalJD }).description).toBe('Job description unavailable.');
    }
  });
  it('uses separate actor/job-scoped, unpersisted management caches', () => {
    for (const file of ['job-edit-page', 'application-management-page']) {
      const text = readFileSync(resolve(`client/src/pages/${file}.tsx`), 'utf8');
      expect(text).toContain('queryKey: ["job-management", user.id, jobId]');
      expect(text).toContain('gcTime: 0');
      expect(text).toContain('cache: \'no-store\'');
      expect(text).toContain('/management`');
    }
    const ssr = readFileSync(resolve('server/vite.ts'), 'utf8');
    expect(ssr).toContain('[JSON.stringify(["/api/jobs", param])]: toPublicJob(job)');
  });
});

describe('management closed failures', () => {
  it.each(['0', '-1', '1.0', '1e2', '1-extra', 'slug', '9007199254740992', ''])('refuses identifier %s', value => {
    expect(parseManagementJobId(value)).toBeNull();
  });
  it('accepts positive numeric IDs only', () => expect(parseManagementJobId('123')).toBe(123));
  it('never returns public data as a fallback on database failure', async () => {
    expect(await readManagementJob(1, 1)).toEqual({ ok: false, reason: 'unavailable' });
    expect(await readManagementJob(NaN, 1)).toEqual({ ok: false, reason: 'not_found' });
  });
});
