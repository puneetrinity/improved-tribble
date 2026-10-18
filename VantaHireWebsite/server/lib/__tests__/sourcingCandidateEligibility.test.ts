import { randomUUID } from 'node:crypto';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import type { Pool, PoolClient } from 'pg';
import { clearKeyCache, verifySignalCandidateEligibilityJwt } from '../services/jwt-signer';
import { candidateEligibilityBody, candidateEligibilityHash } from '../../sourcing-authority/candidate-eligibility-contract';
import { readCandidateEligibility } from '../../sourcing-authority/candidate-eligibility';

const body = () => ({ version: 1, flowRunId: randomUUID(), revisionId: randomUUID(), requestId: 'request',
  externalJobId: 189, items: [{ key: 'one', identity: { candidateId: randomUUID(), referenceId: randomUUID(),
    applicationId: 123, applicationJobId: 188, resumeVersionId: randomUUID(), sourceId: randomUUID(),
    generationId: randomUUID(), sourceHash: 'a'.repeat(64) } }] });
const claims = (value: ReturnType<typeof body>) => ({ tenantId: 'org_32', requestId: value.requestId,
  executionAttemptId: randomUUID(), flowRunId: value.flowRunId, bodyHash: candidateEligibilityHash(value) });
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256', { extractable: true });
  vi.stubEnv('SIGNAL_JWT_PUBLIC_KEY', await exportSPKI(keys.publicKey));
  clearKeyCache();
});
afterEach(() => vi.useRealTimers());

describe('dedicated signed candidate eligibility', () => {
  const sign = async (change: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: 'signal', aud: 'vantahire', sub: 'sourcing', scopes: 'sourcing:candidates:read',
      tenant_id: 'org_32', request_id: 'request', flow_run_id: randomUUID(), execution_attempt_id: randomUUID(),
      jti: randomUUID(), body_hash: 'a'.repeat(64), iat: now, exp: now + 300, ...change })
      .setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey);
  };
  it('accepts only the dedicated, bounded service authority', async () => {
    expect(await verifySignalCandidateEligibilityJwt(await sign())).toMatchObject({ tenantId: 'org_32', requestId: 'request' });
  });
  it.each([
    { scopes: 'callbacks:write' }, { scopes: 'sourcing:grant' },
    { scopes: ['sourcing:candidates:read'] }, { scopes: 'sourcing:candidates:read callbacks:write' },
    { sub: 'browser' }, { aud: 'signal' }, { iss: 'vantahire' }, { body_hash: null },
    { flow_run_id: '00000000-0000-0000-0000-000000000000' }, { execution_attempt_id: null },
    { exp: Math.floor(Date.now() / 1000) + 600 }, { iat: Math.floor(Date.now() / 1000) + 60 },
  ])('rejects changed authority %j', async change => {
    await expect(verifySignalCandidateEligibilityJwt(await sign(change))).rejects.toThrow();
  });
  it('hashes parsed fields consistently, rejects unknown fields and duplicates', () => {
    const value = body();
    expect(candidateEligibilityHash(Object.fromEntries(Object.entries(value).reverse()))).toBe(candidateEligibilityHash(value));
    expect(() => candidateEligibilityBody.parse({ ...value, organizationId: 5 })).toThrow();
    expect(() => candidateEligibilityBody.parse({ ...value, items: [value.items[0], value.items[0]] })).toThrow();
  });
});

describe('bounded eligibility read', () => {
  const setup = () => {
    const value = body(), authority = claims(value);
    const response = { version: 1, bodyHash: authority.bodyHash, checkedAt: new Date().toISOString(),
      results: [{ key: 'one', decision: 'allow' }] };
    const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT') ? [{ result: response }] : [] }));
    const release = vi.fn();
    const client = { query, release } as unknown as PoolClient;
    const connect = vi.fn().mockResolvedValue(client);
    return { value, authority, response, query, release, client, connect, pool: { connect } as unknown as Pool };
  };
  it('uses a fixed read-only statement and checks the ordered response', async () => {
    const fixture = setup();
    expect(await readCandidateEligibility(fixture.value, fixture.authority, fixture.pool)).toEqual(fixture.response);
    expect(fixture.query.mock.calls[0][0]).toBe('BEGIN READ ONLY');
    expect(fixture.query.mock.calls[2][0]).toContain('flow_sourcing_candidate_eligibility');
    expect(fixture.release).toHaveBeenCalledWith(false);
  });
  it('refuses a mismatched signed body before acquiring a connection', async () => {
    const fixture = setup();
    await expect(readCandidateEligibility({ ...fixture.value, externalJobId: 5 }, fixture.authority, fixture.pool)).rejects.toThrow('AUTH_INVALID');
    expect(fixture.connect).not.toHaveBeenCalled();
  });
  it('destroys a late pool connection without issuing SQL', async () => {
    vi.useFakeTimers();
    const fixture = setup();
    let resolve!: (value: PoolClient) => void;
    fixture.connect.mockReturnValue(new Promise<PoolClient>(done => { resolve = done; }));
    const result = expect(readCandidateEligibility(fixture.value, fixture.authority, fixture.pool)).rejects.toThrow('UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    resolve(fixture.client);
    await Promise.resolve();
    expect(fixture.release).toHaveBeenCalledWith(true);
    expect(fixture.query).not.toHaveBeenCalled();
  });
  it('counts connection wait against the same SQL deadline', async () => {
    vi.useFakeTimers();
    const fixture = setup();
    fixture.connect.mockImplementation(() => new Promise(done => setTimeout(() => done(fixture.client), 4000)));
    fixture.query.mockImplementation(() => new Promise(() => {}));
    const result = expect(readCandidateEligibility(fixture.value, fixture.authority, fixture.pool)).rejects.toThrow('UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(5000);
    await result;
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('never returns a partial or reordered database result', async () => {
    const fixture = setup();
    fixture.response.results[0]!.key = 'different';
    await expect(readCandidateEligibility(fixture.value, fixture.authority, fixture.pool)).rejects.toThrow('UNAVAILABLE');
    expect(fixture.release).toHaveBeenCalledWith(true);
  });
});
