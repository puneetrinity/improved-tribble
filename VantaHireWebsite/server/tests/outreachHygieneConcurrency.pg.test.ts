import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.FLOW_POSTGRES_TEST_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('outreach hygiene/send ordering (real Postgres)', () => {
  const signalCandidateId = 'signal-candidate-default';
  const schemaName = 'outreach_hygiene_concurrency_test';
  let admin: Pool;
  let webhook: PoolClient;
  let runtimePool: Pool;
  let withOutreachDispatchFence: typeof import('../lib/outreachConcurrency').withOutreachDispatchFence;
  let outreachHygieneStore: typeof import('../lib/outreachHygieneProcessor').outreachHygieneStore;
  let purgeSyncedHygieneIntents: typeof import('../lib/outreachHygieneProcessor').purgeSyncedHygieneIntents;
  let processHygieneEvent: typeof import('../webhooks/brevo.webhook').processHygieneEvent;
  let candidateLockNamespace: number;
  let emailLockNamespace: number;

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schemaName}`);
    await admin.query(`
      CREATE TABLE ${schemaName}.jobs (
        id INTEGER PRIMARY KEY
      );
      CREATE TABLE ${schemaName}.organizations (
        id INTEGER PRIMARY KEY
      );
      CREATE TABLE ${schemaName}.job_sourced_candidates (
        id INTEGER PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES ${schemaName}.organizations(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL REFERENCES ${schemaName}.jobs(id) ON DELETE CASCADE,
        signal_candidate_id TEXT
      );
      CREATE TABLE ${schemaName}.sourced_candidate_outreach_log (
        id INTEGER PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES ${schemaName}.organizations(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL REFERENCES ${schemaName}.jobs(id) ON DELETE CASCADE,
        sourced_candidate_id INTEGER NOT NULL REFERENCES ${schemaName}.job_sourced_candidates(id) ON DELETE CASCADE,
        recipient_email TEXT NOT NULL,
        campaign_id TEXT,
        campaign_round INTEGER,
        delivery_id TEXT,
        provider_message_id TEXT,
        delivery_event_at TIMESTAMP,
        sent_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE ${schemaName}.outreach_delivery_correlations (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL,
        delivery_id TEXT NOT NULL,
        provider_message_id TEXT,
        organization_id INTEGER NOT NULL,
        sourced_candidate_id INTEGER NOT NULL,
        signal_tenant_id TEXT NOT NULL,
        signal_candidate_id TEXT NOT NULL,
        email_hash TEXT NOT NULL,
        source_outreach_log_id INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(provider, delivery_id)
      );
      CREATE TABLE ${schemaName}.outreach_hygiene_intents (
        id SERIAL PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'brevo',
        provider_event_id TEXT NOT NULL DEFAULT repeat('a', 64),
        organization_id INTEGER NOT NULL DEFAULT 1,
        sourced_candidate_id INTEGER NOT NULL DEFAULT 1,
        signal_tenant_id TEXT NOT NULL DEFAULT 'org_7',
        signal_candidate_id TEXT NOT NULL DEFAULT 'signal-candidate-7',
        source_outreach_log_id INTEGER,
        email_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
        lease_token TEXT,
        lease_expires_at TIMESTAMP,
        last_error TEXT,
        memory_global_candidate_id TEXT,
        synced_at TIMESTAMP,
        dead_lettered_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(provider, provider_event_id)
      );
      CREATE TABLE ${schemaName}.candidate_outreach_schedules (
        id SERIAL PRIMARY KEY,
        sourced_candidate_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        last_error TEXT,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      INSERT INTO ${schemaName}.jobs(id) VALUES (701);
    `);
    const separator = databaseUrl!.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${databaseUrl}${separator}options=-csearch_path%3D${schemaName}`;
    process.env.DATABASE_SSL = 'false';
    const concurrency = await import('../lib/outreachConcurrency');
    const dbModule = await import('../db');
    const processor = await import('../lib/outreachHygieneProcessor');
    const webhookModule = await import('../webhooks/brevo.webhook');
    withOutreachDispatchFence = concurrency.withOutreachDispatchFence;
    candidateLockNamespace = concurrency.OUTREACH_CANDIDATE_LOCK_NAMESPACE;
    emailLockNamespace = concurrency.OUTREACH_EMAIL_LOCK_NAMESPACE;
    outreachHygieneStore = processor.outreachHygieneStore;
    purgeSyncedHygieneIntents = processor.purgeSyncedHygieneIntents;
    processHygieneEvent = webhookModule.processHygieneEvent;
    runtimePool = dbModule.pool as Pool;
    webhook = await admin.connect();
    await webhook.query(`SET search_path TO ${schemaName}`);
  });

  afterAll(async () => {
    webhook?.release();
    await admin?.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await admin?.end();
    await runtimePool?.end();
  });

  it('cannot dispatch after a webhook commits a complaint under the shared locks', async () => {
    const candidateId = 711;
    const emailHash = 'b'.repeat(64);
    const dispatch = vi.fn(async () => 'sent');

    await webhook.query('BEGIN');
    await webhook.query(
      'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
      [candidateLockNamespace, candidateId],
    );
    await webhook.query(
      'SELECT pg_advisory_xact_lock($1::integer, hashtext($2))',
      [emailLockNamespace, emailHash],
    );
    await webhook.query(
      `INSERT INTO outreach_hygiene_intents(email_hash, reason, status,
         signal_candidate_id)
       VALUES ($1, 'complaint', 'pending', $2)`,
      [emailHash, signalCandidateId],
    );

    const send = withOutreachDispatchFence(701, candidateId, emailHash, signalCandidateId, dispatch);
    await delay(100);
    expect(dispatch).not.toHaveBeenCalled();

    await webhook.query('COMMIT');
    await expect(send).resolves.toEqual({
      status: 'blocked',
      reason: 'hygiene_sync_pending',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('retains hash-only correlation and fences a delayed complaint after hard deletion', async () => {
    await admin.query(`TRUNCATE ${schemaName}.outreach_hygiene_intents`);
    const emailHash = createHash('sha256')
      .update('deleted@example.test')
      .digest('hex');
    const deliveryId = '11111111-1111-4111-8111-111111111111';
    await admin.query(`
      INSERT INTO ${schemaName}.organizations(id) VALUES (91);
      INSERT INTO ${schemaName}.jobs(id) VALUES (791);
      INSERT INTO ${schemaName}.job_sourced_candidates(
        id, organization_id, job_id, signal_candidate_id
      ) VALUES (891, 91, 791, 'signal-891');
      INSERT INTO ${schemaName}.sourced_candidate_outreach_log(
        id, organization_id, job_id, sourced_candidate_id, recipient_email,
        campaign_id, campaign_round, delivery_id
      ) VALUES (
        991, 91, 791, 891, 'deleted@example.test', 'campaign-991', 1,
        '${deliveryId}'
      );
      INSERT INTO ${schemaName}.outreach_delivery_correlations(
        provider, delivery_id, provider_message_id, organization_id,
        sourced_candidate_id, signal_tenant_id, signal_candidate_id,
        email_hash, source_outreach_log_id
      ) VALUES (
        'brevo', '${deliveryId}', 'message-after-delete', 91,
        891, 'org_91', 'signal-891', '${emailHash}', 991
      );
      DELETE FROM ${schemaName}.jobs WHERE id = 791;
    `);

    const retained = await admin.query(`
      SELECT organization_id, sourced_candidate_id, signal_tenant_id,
             signal_candidate_id, email_hash, source_outreach_log_id
      FROM ${schemaName}.outreach_delivery_correlations
      WHERE delivery_id = '${deliveryId}'
    `);
    expect(retained.rows).toEqual([{
      organization_id: 91,
      sourced_candidate_id: 891,
      signal_tenant_id: 'org_91',
      signal_candidate_id: 'signal-891',
      email_hash: emailHash,
      source_outreach_log_id: 991,
    }]);
    const deletedLog = await admin.query(
      `SELECT id FROM ${schemaName}.sourced_candidate_outreach_log WHERE id = 991`,
    );
    expect(deletedLog.rowCount).toBe(0);

    await expect(processHygieneEvent({
      event: 'complaint',
      email: 'deleted@example.test',
      'message-id': 'message-after-delete',
      'X-Mailin-custom': `delivery_id:${deliveryId}`,
    }, 'complaint', '8'.repeat(64))).resolves.toBe('processed');
    const intent = await admin.query(`
      SELECT organization_id, sourced_candidate_id, signal_tenant_id,
             signal_candidate_id, email_hash, reason, status
      FROM ${schemaName}.outreach_hygiene_intents
      WHERE provider_event_id = repeat('8', 64)
    `);
    expect(intent.rows).toEqual([{
      organization_id: 91,
      sourced_candidate_id: 891,
      signal_tenant_id: 'org_91',
      signal_candidate_id: 'signal-891',
      email_hash: emailHash,
      reason: 'complaint',
      status: 'pending',
    }]);
    // The retained correlation still identifies the person, so the delayed
    // complaint fences them at ANY address even though the job, candidate,
    // organization, and delivery log are all gone.
    await expect(withOutreachDispatchFence(
      701,
      999,
      '7'.repeat(64),
      'signal-891',
      async () => 'unexpected',
    )).resolves.toEqual({ status: 'blocked', reason: 'hygiene_sync_pending' });

    // ...and an unrelated person is unaffected by that deletion-era complaint.
    await expect(withOutreachDispatchFence(
      701,
      998,
      '9'.repeat(64),
      'signal-other',
      async () => 'sent-unrelated',
    )).resolves.toEqual({ status: 'ran', value: 'sent-unrelated' });
  });

  it('fails closed when an Ealana delivery header has no retained correlation', async () => {
    await expect(processHygieneEvent({
      event: 'complaint',
      email: 'missing-correlation@example.test',
      'X-Mailin-custom': 'delivery_id:22222222-2222-4222-8222-222222222222',
    }, 'complaint', '9'.repeat(64))).rejects.toThrow(
      'Outreach delivery correlation is missing',
    );
  });

  it('correlates a legacy delivery by provider message id without a custom header', async () => {
    await admin.query(`TRUNCATE ${schemaName}.outreach_hygiene_intents`);
    const emailHash = createHash('sha256')
      .update('legacy-message@example.test')
      .digest('hex');
    await admin.query(
      `INSERT INTO ${schemaName}.outreach_delivery_correlations(
         provider, delivery_id, provider_message_id, organization_id,
         sourced_candidate_id, signal_tenant_id, signal_candidate_id,
         email_hash, source_outreach_log_id
       ) VALUES ('brevo', 'legacy-log:992', 'legacy-provider-message', 92,
                 892, 'org_92', 'signal-892', $1, 992)`,
      [emailHash],
    );

    await expect(processHygieneEvent({
      event: 'hard_bounce',
      email: 'legacy-message@example.test',
      'message-id': '<legacy-provider-message>',
    }, 'hard_bounce', 'a'.repeat(64))).resolves.toBe('processed');
    const intent = await admin.query(
      `SELECT email_hash, reason, status
       FROM ${schemaName}.outreach_hygiene_intents
       WHERE provider_event_id = repeat('a', 64)`,
    );
    expect(intent.rows).toEqual([{
      email_hash: emailHash,
      reason: 'hard_bounce',
      status: 'pending',
    }]);
  });

  it('makes a later webhook wait for an already-started dispatch', async () => {
    await admin.query(`TRUNCATE ${schemaName}.outreach_hygiene_intents`);
    const candidateId = 712;
    const emailHash = 'c'.repeat(64);
    let releaseDispatch!: () => void;
    let markDispatchStarted!: () => void;
    const dispatchStarted = new Promise<void>((resolve) => {
      markDispatchStarted = resolve;
    });
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve;
    });

    const send = withOutreachDispatchFence(
      701,
      candidateId,
      emailHash,
      signalCandidateId,
      async () => {
        markDispatchStarted();
        await dispatchGate;
        return 'sent';
      },
    );
    await dispatchStarted;

    await webhook.query('BEGIN');
    let webhookAcquiredCandidate = false;
    const candidateLock = webhook.query(
      'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
      [candidateLockNamespace, candidateId],
    ).then(() => {
      webhookAcquiredCandidate = true;
    });
    await delay(100);
    expect(webhookAcquiredCandidate).toBe(false);

    releaseDispatch();
    await expect(send).resolves.toEqual({ status: 'ran', value: 'sent' });
    await candidateLock;
    await webhook.query(
      'SELECT pg_advisory_xact_lock($1::integer, hashtext($2))',
      [emailLockNamespace, emailHash],
    );
    await webhook.query(
      `INSERT INTO outreach_hygiene_intents(email_hash, reason, status,
         signal_candidate_id)
       VALUES ($1, 'hard_bounce', 'synced', $2)`,
      [emailHash, signalCandidateId],
    );
    await webhook.query('COMMIT');

    await expect(withOutreachDispatchFence(
      701,
      candidateId,
      emailHash,
      signalCandidateId,
      async () => 'unexpected',
    )).resolves.toEqual({ status: 'blocked', reason: 'hard_bounce' });
  });

  it('never reclaims dead letters but reclaims an expired processing lease', async () => {
    await admin.query(`TRUNCATE ${schemaName}.outreach_hygiene_intents`);
    const now = new Date('2026-07-31T12:00:00Z');
    await admin.query(
      `INSERT INTO ${schemaName}.outreach_hygiene_intents
         (id, provider_event_id, email_hash, reason, status, next_attempt_at,
          lease_token, lease_expires_at, dead_lettered_at, signal_candidate_id)
       VALUES
         (801, $1, $2, 'complaint', 'dead_letter', $3, NULL, NULL, $3, 'sc-801'),
         (802, $4, $5, 'hard_bounce', 'processing', $3, 'stale-lease', $6, NULL, 'sc-802'),
         (803, $7, $8, 'hard_bounce', 'pending', $3, NULL, NULL, NULL, 'sc-803')`,
      [
        '1'.repeat(64),
        'a'.repeat(64),
        now,
        '2'.repeat(64),
        'b'.repeat(64),
        new Date(now.getTime() - 1_000),
        '3'.repeat(64),
        'c'.repeat(64),
      ],
    );

    const claimed = await outreachHygieneStore.claimDue({
      limit: 10,
      now,
      leaseToken: 'fresh-lease',
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    });

    expect(claimed.map((row) => row.id).sort()).toEqual([802, 803]);
    await expect(outreachHygieneStore.markDeadLetter({
      id: 802,
      leaseToken: 'fresh-lease',
      deadLetteredAt: now,
      errorCode: 'memory_http_422',
    })).resolves.toBe(true);
    const newlyDeadLettered = await admin.query(
      `SELECT status, dead_lettered_at IS NOT NULL AS has_dead_letter_time,
              last_error
       FROM ${schemaName}.outreach_hygiene_intents WHERE id = 802`,
    );
    expect(newlyDeadLettered.rows[0]).toMatchObject({
      status: 'dead_letter',
      has_dead_letter_time: true,
      last_error: 'memory_http_422',
    });
    const deadLetter = await admin.query(
      `SELECT status, lease_token FROM ${schemaName}.outreach_hygiene_intents WHERE id = 801`,
    );
    expect(deadLetter.rows[0]).toMatchObject({ status: 'dead_letter', lease_token: null });

    await admin.query(
      `UPDATE ${schemaName}.outreach_hygiene_intents
       SET status = 'pending', dead_lettered_at = NULL, attempt_count = 0,
           next_attempt_at = $1
       WHERE id = 801`,
      [now],
    );
    const requeued = await outreachHygieneStore.claimDue({
      limit: 10,
      now,
      leaseToken: 'operator-requeue-lease',
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    });
    expect(requeued.map((row) => row.id)).toEqual([801]);
  });

  it('keeps dead-lettered suppression fenced without blocking another address', async () => {
    await admin.query(`TRUNCATE ${schemaName}.outreach_hygiene_intents`);
    const candidateId = 713;
    const badHash = 'd'.repeat(64);
    const alternateHash = 'e'.repeat(64);
    await admin.query(
      `INSERT INTO ${schemaName}.outreach_hygiene_intents
         (provider_event_id, email_hash, reason, status, dead_lettered_at,
          signal_candidate_id)
       VALUES ($1, $2, 'hard_bounce', 'dead_letter', NOW(), $3)`,
      ['4'.repeat(64), badHash, 'signal-candidate-bad'],
    );

    const badDispatch = vi.fn(async () => 'unexpected');
    await expect(withOutreachDispatchFence(
      701,
      candidateId,
      badHash,
      'signal-candidate-bad',
      badDispatch,
    )).resolves.toEqual({ status: 'blocked', reason: 'hygiene_sync_pending' });
    expect(badDispatch).not.toHaveBeenCalled();

    await expect(withOutreachDispatchFence(
      701,
      candidateId,
      alternateHash,
      'signal-candidate-bad',
      async () => 'sent-alternate',
    )).resolves.toEqual({ status: 'ran', value: 'sent-alternate' });
  });

  it('fences a stuck complaint to the affected person, not the whole platform', async () => {
    // A complaint that cannot reach Memory must still stop THAT person
    // everywhere — but blocking every other candidate would turn one poison
    // record into a permanent platform-wide outage with no way back.
    await admin.query(`TRUNCATE ${schemaName}.outreach_hygiene_intents`);
    const complainedHash = 'f'.repeat(64);
    const complainant = 'signal-candidate-complained';
    await admin.query(
      `INSERT INTO ${schemaName}.outreach_hygiene_intents
         (provider_event_id, email_hash, reason, status, dead_lettered_at,
          signal_candidate_id)
       VALUES ($1, $2, 'complaint', 'dead_letter', NOW(), $3)`,
      ['5'.repeat(64), complainedHash, complainant],
    );

    // The complained address is blocked.
    const toComplainedAddress = vi.fn(async () => 'unexpected');
    await expect(withOutreachDispatchFence(
      701, 714, complainedHash, complainant, toComplainedAddress,
    )).resolves.toEqual({ status: 'blocked', reason: 'hygiene_sync_pending' });
    expect(toComplainedAddress).not.toHaveBeenCalled();

    // The same PERSON is blocked at a different address: a complaint is
    // person-terminal, so another mailbox is not an escape hatch.
    const toSamePersonElsewhere = vi.fn(async () => 'unexpected');
    await expect(withOutreachDispatchFence(
      701, 714, '1'.repeat(64), complainant, toSamePersonElsewhere,
    )).resolves.toEqual({ status: 'blocked', reason: 'hygiene_sync_pending' });
    expect(toSamePersonElsewhere).not.toHaveBeenCalled();

    // THE REGRESSION: an unrelated person still receives outreach.
    await expect(withOutreachDispatchFence(
      701, 715, '2'.repeat(64), 'signal-candidate-unrelated',
      async () => 'sent-unrelated',
    )).resolves.toEqual({ status: 'ran', value: 'sent-unrelated' });
  });

  it('purges only suppressions Memory has durably recorded', async () => {
    // Retention must never destroy a suppression that was never honored:
    // deleting an unsynced or dead-lettered row would silently un-block someone
    // who complained, which is the failure this whole mechanism prevents.
    await admin.query(`TRUNCATE ${schemaName}.outreach_hygiene_intents`);
    const old = new Date('2020-01-01T00:00:00Z');
    await admin.query(
      `INSERT INTO ${schemaName}.outreach_hygiene_intents
         (provider_event_id, email_hash, reason, status, synced_at,
          dead_lettered_at, signal_candidate_id)
       VALUES
         ($1, $2, 'complaint',   'synced',      $5,   NULL, 'sc-synced'),
         ($3, $4, 'complaint',   'dead_letter', NULL, $5,   'sc-dead'),
         ($6, $7, 'hard_bounce', 'pending',     NULL, NULL, 'sc-pending')`,
      [
        'a1'.repeat(32), '1a'.repeat(32),
        'b2'.repeat(32), '2b'.repeat(32),
        old,
        'c3'.repeat(32), '3c'.repeat(32),
      ],
    );

    const purged = await purgeSyncedHygieneIntents(30, new Date('2026-08-01T00:00:00Z'));
    expect(purged).toBe(1);

    const survivors = await admin.query(
      `SELECT status FROM ${schemaName}.outreach_hygiene_intents ORDER BY status`,
    );
    expect(survivors.rows.map((row: { status: string }) => row.status))
      .toEqual(['dead_letter', 'pending']);
  });

  it('falls back to a global hold only when the person cannot be identified', async () => {
    // Defence in depth: signal_candidate_id is NOT NULL, so this should be
    // unreachable. If it ever is reachable we cannot tell who must not be
    // mailed, and stopping everything is the only safe answer.
    await admin.query(`TRUNCATE ${schemaName}.outreach_hygiene_intents`);
    await admin.query(
      `INSERT INTO ${schemaName}.outreach_hygiene_intents
         (provider_event_id, email_hash, reason, status, dead_lettered_at,
          signal_candidate_id)
       VALUES ($1, $2, 'complaint', 'dead_letter', NOW(), '')`,
      ['6'.repeat(64), '7'.repeat(64)],
    );

    const dispatch = vi.fn(async () => 'unexpected');
    await expect(withOutreachDispatchFence(
      701, 716, '8'.repeat(64), 'signal-candidate-anyone', dispatch,
    )).resolves.toEqual({ status: 'blocked', reason: 'hygiene_sync_pending' });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
