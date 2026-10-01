import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';

const ownerUrl = process.env.FLOW_F1_OWNER_URL ?? '';
const runtimeUrl = process.env.FLOW_F1_RUNTIME_URL ?? '';
const enabled = process.env.FLOW_F1_DISPOSABLE === '1' && !!ownerUrl && !!runtimeUrl;
let owner: Client;
let reader: typeof import('../jobManagementRead');
let runtimePool: { end(): Promise<void> };
let seeded = false;

describe.skipIf(!enabled)('F-1 real PostgreSQL statement-bound management read', () => {
  beforeAll(async () => {
    for (const value of [ownerUrl, runtimeUrl]) {
      const u = new URL(value);
      if (u.hostname !== '127.0.0.1' || !u.pathname.endsWith('_test')) throw Error('disposable target required');
    }
    if (new URL(ownerUrl).host !== new URL(runtimeUrl).host || new URL(ownerUrl).pathname !== new URL(runtimeUrl).pathname) throw Error('same target required');
    owner = new Client({ connectionString: ownerUrl }); await owner.connect();
    const runtime = new Client({ connectionString: runtimeUrl }); await runtime.connect();
    const role = await runtime.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    await runtime.end();
    expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    if ((await owner.query('SELECT id FROM users WHERE id BETWEEN 91001 AND 91009')).rowCount) throw Error('fixture collision');
    await owner.query('BEGIN');
    try {
      await owner.query(`INSERT INTO users(id,username,password,role,email_verified) VALUES
        (91001,'f1-primary@example.invalid','inert','recruiter',true),
        (91002,'f1-co@example.invalid','inert','recruiter',true),
        (91003,'f1-unassigned@example.invalid','inert','recruiter',true),
        (91004,'f1-unseated@example.invalid','inert','recruiter',true),
        (91005,'f1-removed@example.invalid','inert','recruiter',true),
        (91006,'f1-foreign@example.invalid','inert','recruiter',true),
        (91007,'f1-candidate@example.invalid','inert','candidate',true),
        (91008,'f1-hm@example.invalid','inert','hiring_manager',true),
        (91009,'f1-admin@example.invalid','inert','super_admin',true);
        INSERT INTO organizations(id,name,slug) VALUES(91001,'F1 test','f1-test'),(91002,'F1 other','f1-other');
        INSERT INTO organization_members(organization_id,user_id,role,seat_assigned) VALUES
        (91001,91001,'owner',true),(91001,91002,'member',true),(91001,91003,'member',true),
        (91001,91004,'member',false),(91002,91006,'owner',true);
        INSERT INTO jobs(id,organization_id,posted_by,hiring_manager_id,title,location,type,description,original_jd,review_comments,jd_digest)
        VALUES(91001,91001,91001,91008,'F1 fixture','Remote','full-time','{"roleTitle":"CANARY_RAW"}','Real prose','CANARY_REVIEW','{"x":"CANARY_DIGEST"}'),
        (91002,NULL,91001,NULL,'F1 legacy','Remote','full-time','Legacy prose',NULL,NULL,NULL);
        INSERT INTO job_recruiters(organization_id,job_id,recruiter_id,added_by) VALUES
        (91001,91001,91002,91001),(91001,91001,91004,91001),(91001,91001,91005,91001),(91001,91001,91006,91001);`);
      await owner.query('COMMIT'); seeded = true;
    } catch (error) { await owner.query('ROLLBACK'); throw error; }
    process.env.DATABASE_URL = runtimeUrl; process.env.NODE_ENV = 'test';
    reader = await import('../jobManagementRead');
    runtimePool = (await import('../../db')).pool;
  }, 30_000);
  afterAll(async () => {
    await owner?.query('ROLLBACK');
    if (seeded) {
      await owner.query('DELETE FROM job_recruiters WHERE job_id=91001');
      await owner.query('DELETE FROM jobs WHERE id IN (91001,91002)');
      await owner.query('DELETE FROM organization_members WHERE organization_id IN (91001,91002)');
      await owner.query('DELETE FROM organizations WHERE id IN (91001,91002)');
      await owner.query('DELETE FROM user_profiles WHERE user_id=91001');
      await owner.query('DELETE FROM users WHERE id BETWEEN 91001 AND 91009');
    }
    await runtimePool?.end(); await owner?.end();
  });
  it.each([91001, 91002, 91009])('admits authorized actor %s with only management fields', async actor => {
    const result = await reader.readManagementJob(actor, 91001);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.job)).toHaveLength(27);
      expect(result.job).toMatchObject({ organizationId: 91001, hiringManagerId: 91008, description: 'Real prose' });
      expect(JSON.stringify(result)).not.toMatch(/CANARY|jdDigest|reviewComments/);
    }
  });
  it.each([91003, 91004, 91005, 91006, 91007, 91008])('refuses unassigned/unseated/removed/foreign/candidate/HM actor %s', async actor => {
    expect(await reader.readManagementJob(actor, 91001)).toEqual({ ok: false, reason: 'not_found' });
  });
  it('refuses null-org recruiter and missing targets; retains explicit live admin exception', async () => {
    expect((await reader.readManagementJob(91001, 91002)).ok).toBe(false);
    expect((await reader.readManagementJob(91009, 91002)).ok).toBe(true);
    expect((await reader.readManagementJob(91001, 99999999)).ok).toBe(false);
  });
  it('revokes seats, assignments and platform role using current committed authority', async () => {
    await owner.query('UPDATE organization_members SET seat_assigned=false WHERE user_id=91002');
    expect((await reader.readManagementJob(91002, 91001)).ok).toBe(false);
    await owner.query('UPDATE organization_members SET seat_assigned=true WHERE user_id=91002');
    await owner.query('DELETE FROM job_recruiters WHERE recruiter_id=91002');
    expect((await reader.readManagementJob(91002, 91001)).ok).toBe(false);
    await owner.query("UPDATE users SET role='candidate' WHERE id=91009");
    expect((await reader.readManagementJob(91009, 91001)).ok).toBe(false);
  });
  it('legacy duplicate profiles do not multiply or block an authorized job', async () => {
    await owner.query("INSERT INTO user_profiles(user_id,company,is_public,public_id) VALUES(91001,'First profile',false,NULL),(91001,'Second profile',true,'synthetic-second-profile')");
    const result = await reader.readManagementJob(91001, 91001);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.postedById).toBeNull();
      expect(result.job.isRecruiterProfilePublic).toBe(false);
    }
  });
  it('uses the statement snapshot during a concurrent revocation, then refuses after commit', async () => {
    await owner.query('BEGIN');
    await owner.query('UPDATE organization_members SET seat_assigned=false WHERE user_id=91001');
    // Uncommitted changes cannot revoke a previously committed grant in another snapshot.
    expect((await reader.readManagementJob(91001, 91001)).ok).toBe(true);
    await owner.query('COMMIT');
    expect((await reader.readManagementJob(91001, 91001)).ok).toBe(false);
  });
});
