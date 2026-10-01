import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { toPublicJob } from '@shared/publicJob';

const ownerUrl = process.env.FLOW_F2_OWNER_URL ?? '';
const runtimeUrl = process.env.FLOW_F2_RUNTIME_URL ?? '';
const enabled = process.env.FLOW_F2_DISPOSABLE === '1' && !!ownerUrl && !!runtimeUrl;
const now = new Date('2030-01-01T00:00:00Z');
let owner: Client;
let storage: typeof import('../../storage')['storage'];
let pool: { end(): Promise<void> };
let seeded = false;

describe.skipIf(!enabled)('F-2 real PostgreSQL public collection', () => {
  beforeAll(async () => {
    for (const value of [ownerUrl, runtimeUrl]) {
      const u = new URL(value);
      if (u.hostname !== '127.0.0.1' || !u.pathname.endsWith('_test')) throw Error('disposable target required');
    }
    if (new URL(ownerUrl).host !== new URL(runtimeUrl).host || new URL(ownerUrl).pathname !== new URL(runtimeUrl).pathname) throw Error('same target required');
    owner = new Client({ connectionString: ownerUrl }); await owner.connect();
    const runtime = new Client({ connectionString: runtimeUrl }); await runtime.connect();
    expect((await runtime.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    await runtime.end();
    if ((await owner.query('SELECT id FROM users WHERE id BETWEEN 92001 AND 92002')).rowCount ||
        (await owner.query('SELECT id FROM jobs WHERE id BETWEEN 92001 AND 92200')).rowCount) throw Error('fixture collision');
    await owner.query('BEGIN');
    try {
      await owner.query(`INSERT INTO users(id,username,password,role,email_verified) VALUES
        (92001,'f2-recruiter@fixture.invalid','inert','recruiter',true),
        (92002,'f2-other@fixture.invalid','inert','recruiter',true);
        INSERT INTO user_profiles(user_id,is_public,public_id) VALUES(92001,false,NULL);
        INSERT INTO jobs(id,posted_by,title,location,type,description,status,is_active,expires_at,created_at,salary_min,salary_max,salary_period)
        SELECT 92000+n,92001,'F2CollectionFixture '||n,'F2Remote','full-time','Real fixture prose','approved',true,
          NULL,'2029-01-01',100000,200000,'per_year' FROM generate_series(1,110) n;
        INSERT INTO jobs(id,posted_by,title,location,type,description,status,is_active,expires_at) VALUES
        (92111,92001,'F2CollectionFixture pending','F2Remote','full-time','prose','pending',true,NULL),
        (92112,92001,'F2CollectionFixture declined','F2Remote','full-time','prose','declined',true,NULL),
        (92113,92001,'F2CollectionFixture inactive','F2Remote','full-time','prose','approved',false,NULL),
        (92114,92001,'F2CollectionFixture past','F2Remote','full-time','prose','approved',true,'2029-12-31T23:59:59.999Z'),
        (92115,92001,'F2CollectionFixture equal','F2Remote','full-time','prose','approved',true,'2030-01-01T00:00:00Z'),
        (92116,92001,'F2CollectionFixture future','F2Remote','full-time','prose','approved',true,'2030-01-01T00:00:00.001Z'),
        (92117,92002,'F2CollectionFixture other','F2Other','contract','prose','approved',true,NULL);`);
      await owner.query('COMMIT'); seeded = true;
    } catch (error) { await owner.query('ROLLBACK'); throw error; }
    process.env.DATABASE_URL = runtimeUrl; process.env.NODE_ENV = 'test';
    storage = (await import('../../storage')).storage;
    pool = (await import('../../db')).pool;
  }, 30_000);
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    await owner?.query('ROLLBACK');
    if (seeded) {
      await owner.query('DELETE FROM jobs WHERE id BETWEEN 92001 AND 92117');
      await owner.query('DELETE FROM user_profiles WHERE user_id=92001');
      await owner.query('DELETE FROM users WHERE id BETWEEN 92001 AND 92002');
    }
    await pool?.end(); await owner?.end();
  });
  const freezeDate = () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); };
  it('filters eligibility before rows and count; storage clamps large limits', async () => {
    freezeDate();
    const first = await storage.getJobs({ search: 'F2CollectionFixture', limit: 1000 });
    expect(Number(first.total)).toBe(113); expect(first.jobs).toHaveLength(100);
    const second = await storage.getJobs({ search: 'F2CollectionFixture', limit: 1000, page: 2 });
    expect(Number(second.total)).toBe(113); expect(second.jobs).toHaveLength(13);
    const ids = [...first.jobs, ...second.jobs].map(j => j.id);
    expect(new Set(ids).size).toBe(113);
    for (const id of [92111, 92112, 92113, 92114]) expect(ids).not.toContain(id);
    for (const id of [92115, 92116, 92117]) expect(ids).toContain(id);
    expect(ids.filter(id => id <= 92110)).toEqual(Array.from({ length: 110 }, (_, i) => 92110 - i));
    for (const job of first.jobs.filter(j => j.postedBy === 92001)) {
      expect(job.isRecruiterProfilePublic).toBe(false);
      expect(toPublicJob(job).postedById).toBeNull();
    }
  });
  it('keeps default pages and refuses invalid direct storage input', async () => {
    freezeDate();
    expect((await storage.getJobs({ search: 'F2CollectionFixture' })).jobs).toHaveLength(10);
    for (const filters of [{ page: 0 }, { limit: -1 }, { page: 1.5 }, { page: Number.MAX_SAFE_INTEGER, limit: 100 }]) {
      await expect(storage.getJobs(filters)).rejects.toThrow('positive safe integers');
    }
  });
  it('keeps filters and cannot override approval', async () => {
    freezeDate();
    for (const filters of [{ status: 'pending' }, { type: 'internship' }, { minSalary: 999999 }, { maxSalary: 1 }]) {
      const result = await storage.getJobs({ search: 'F2CollectionFixture', ...filters });
      expect(result.jobs).toEqual([]); expect(Number(result.total)).toBe(0);
    }
    const result = await storage.getJobs({ search: 'F2CollectionFixture', location: 'F2Remote', type: 'full-time', minSalary: 150000, maxSalary: 180000, salaryPeriod: 'per_year' });
    expect(Number(result.total)).toBe(110);
    expect(result.jobs).toHaveLength(10);
  });
  it('applies exact expiry to recruiter lists without changing recruiter binding', async () => {
    freezeDate();
    const result = await storage.getPublicJobsByRecruiter(92001);
    expect(result).toHaveLength(112);
    const ids = result.map(j => j.id);
    for (const id of [92111, 92112, 92113, 92114, 92117]) expect(ids).not.toContain(id);
    for (const id of [92001, 92115, 92116]) expect(ids).toContain(id);
    expect((await storage.getPublicJobsByRecruiter(92002)).map(j => j.id)).toEqual([92117]);
  });
});
