-- Tier 4 outreach delivery hygiene and per-candidate follow-up scheduling.
--
-- AUTHORITY: server/bootstrapSchema.ts is what actually runs. Nothing executes
-- the files in this directory — `npm run db:migrate` calls ensureAtsSchema().
-- This file is the reviewable record of the same DDL and MUST be kept in step
-- with bootstrapSchema.ts; a constraint that exists in only one of them is a
-- drift bug, not a difference of opinion.

ALTER TABLE sourced_candidate_outreach_log
  ADD COLUMN IF NOT EXISTS delivery_key TEXT,
  ADD COLUMN IF NOT EXISTS delivery_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT,
  ADD COLUMN IF NOT EXISTS delivery_event_at TIMESTAMP;

UPDATE sourced_candidate_outreach_log
SET delivery_status = CASE
  WHEN status = 'sent' THEN 'accepted'
  ELSE status
END
WHERE delivery_status IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS scol_delivery_key_idx
  ON sourced_candidate_outreach_log(delivery_key);
CREATE UNIQUE INDEX IF NOT EXISTS scol_delivery_id_idx
  ON sourced_candidate_outreach_log(delivery_id);
CREATE UNIQUE INDEX IF NOT EXISTS scol_provider_message_idx
  ON sourced_candidate_outreach_log(provider_message_id);
CREATE UNIQUE INDEX IF NOT EXISTS job_sourced_candidates_id_org_job_idx
  ON job_sourced_candidates(id, organization_id, job_id);

-- Provider callbacks can arrive long after an org/job/candidate or verbose send
-- log was deleted. Retain only the identity snapshots and email hash required to
-- apply hygiene; deliberately do not attach foreign keys to lifecycle tables.
CREATE TABLE IF NOT EXISTS outreach_delivery_correlations (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'brevo',
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
  CONSTRAINT outreach_delivery_correlations_delivery_nonblank
    CHECK (btrim(delivery_id) <> ''),
  CONSTRAINT outreach_delivery_correlations_tenant_nonblank
    CHECK (btrim(signal_tenant_id) <> ''),
  CONSTRAINT outreach_delivery_correlations_candidate_nonblank
    CHECK (btrim(signal_candidate_id) <> ''),
  CONSTRAINT outreach_delivery_correlations_email_hash_check
    CHECK (email_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_delivery_correlations_delivery_idx
  ON outreach_delivery_correlations(provider, delivery_id);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_delivery_correlations_message_idx
  ON outreach_delivery_correlations(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS outreach_delivery_correlations_email_idx
  ON outreach_delivery_correlations(email_hash);

-- Every provider-addressable historical delivery must have enough immutable
-- identity to survive lifecycle deletion. Fail the deploy instead of silently
-- accepting a callback gap that would acknowledge a later complaint without a
-- suppression fence.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM sourced_candidate_outreach_log AS log
    LEFT JOIN organizations AS org ON org.id = log.organization_id
    LEFT JOIN job_sourced_candidates AS candidate
      ON candidate.id = log.sourced_candidate_id
    WHERE (
      NULLIF(btrim(log.delivery_id), '') IS NOT NULL
      OR NULLIF(btrim(log.provider_message_id), '') IS NOT NULL
    )
      AND (
        NULLIF(btrim(org.signal_tenant_id), '') IS NULL
        OR NULLIF(btrim(candidate.signal_candidate_id), '') IS NULL
      )
  ) THEN
    RAISE EXCEPTION
      'cannot preserve outreach callback correlation: historical delivery lacks Memory identity';
  END IF;
END $$;

-- Preserve correlation for deliveries created before this release. Core
-- PostgreSQL sha256() avoids adding an extension dependency to Flow.
INSERT INTO outreach_delivery_correlations (
  provider,
  delivery_id,
  provider_message_id,
  organization_id,
  sourced_candidate_id,
  signal_tenant_id,
  signal_candidate_id,
  email_hash,
  source_outreach_log_id,
  created_at,
  updated_at
)
SELECT
  'brevo',
  COALESCE(NULLIF(btrim(log.delivery_id), ''), 'legacy-log:' || log.id::text),
  NULLIF(lower(btrim(log.provider_message_id, '<> ')), ''),
  log.organization_id,
  log.sourced_candidate_id,
  org.signal_tenant_id,
  candidate.signal_candidate_id,
  encode(sha256(convert_to(lower(btrim(log.recipient_email)), 'UTF8')), 'hex'),
  log.id,
  COALESCE(log.sent_at, NOW()),
  NOW()
FROM sourced_candidate_outreach_log AS log
JOIN organizations AS org ON org.id = log.organization_id
JOIN job_sourced_candidates AS candidate ON candidate.id = log.sourced_candidate_id
WHERE (
    NULLIF(btrim(log.delivery_id), '') IS NOT NULL
    OR NULLIF(btrim(log.provider_message_id), '') IS NOT NULL
  )
  AND org.signal_tenant_id IS NOT NULL
  AND btrim(org.signal_tenant_id) <> ''
  AND candidate.signal_candidate_id IS NOT NULL
  AND btrim(candidate.signal_candidate_id) <> ''
ON CONFLICT (provider, delivery_id) DO UPDATE SET
  provider_message_id = COALESCE(
    EXCLUDED.provider_message_id,
    outreach_delivery_correlations.provider_message_id
  ),
  source_outreach_log_id = COALESCE(
    outreach_delivery_correlations.source_outreach_log_id,
    EXCLUDED.source_outreach_log_id
  ),
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS outreach_org_suppressions (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL,
  signal_candidate_id TEXT,
  reason TEXT NOT NULL DEFAULT 'unsubscribe',
  source_outreach_log_id INTEGER REFERENCES sourced_candidate_outreach_log(id) ON DELETE SET NULL,
  provider_event_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Unsubscribe only. Hard bounce and complaint are platform-wide and live in
  -- Memory's hash-keyed tombstone table, never here.
  CONSTRAINT outreach_org_suppressions_reason_check
    CHECK (reason = 'unsubscribe')
);

ALTER TABLE outreach_org_suppressions
  ADD COLUMN IF NOT EXISTS signal_candidate_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS outreach_org_suppressions_org_email_idx
  ON outreach_org_suppressions(organization_id, email_hash);
DROP INDEX IF EXISTS outreach_org_suppressions_org_candidate_idx;
CREATE INDEX IF NOT EXISTS outreach_org_suppressions_org_candidate_lookup_idx
  ON outreach_org_suppressions(organization_id, signal_candidate_id)
  WHERE signal_candidate_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS outreach_org_suppressions_provider_event_idx
  ON outreach_org_suppressions(provider_event_id);

-- Provider hygiene events must become a local send fence in the same
-- transaction as the delivery-state update. Memory synchronization happens
-- asynchronously from this hash-only durable intent.
CREATE TABLE IF NOT EXISTS outreach_hygiene_intents (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'brevo',
  provider_event_id TEXT NOT NULL,
  organization_id INTEGER NOT NULL,
  sourced_candidate_id INTEGER NOT NULL,
  signal_tenant_id TEXT NOT NULL,
  signal_candidate_id TEXT NOT NULL,
  source_outreach_log_id INTEGER,
  email_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
  lease_token TEXT,
  lease_expires_at TIMESTAMP,
  last_error TEXT,
  memory_global_candidate_id TEXT,
  synced_at TIMESTAMP,
  dead_lettered_at TIMESTAMP,
  replay_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT outreach_hygiene_intents_reason_check
    CHECK (reason IN ('hard_bounce', 'complaint')),
  CONSTRAINT outreach_hygiene_intents_status_check
    CHECK (status IN ('pending', 'processing', 'synced', 'dead_letter')),
  CONSTRAINT outreach_hygiene_intents_event_id_check
    CHECK (provider_event_id ~ '^[0-9a-f]{64}$'),
  CONSTRAINT outreach_hygiene_intents_email_hash_check
    CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT outreach_hygiene_intents_attempts_check
    CHECK (attempt_count >= 0),
  CONSTRAINT outreach_hygiene_intents_dead_letter_pair_check
    CHECK ((status = 'dead_letter') = (dead_lettered_at IS NOT NULL)),
  -- NOT NULL still admits ''. An intent naming no person would trip the send
  -- fence's "unidentifiable" fallback, which stops ALL outreach.
  CONSTRAINT outreach_hygiene_intents_candidate_nonblank
    CHECK (btrim(signal_candidate_id) <> ''),
  CONSTRAINT outreach_hygiene_intents_tenant_nonblank
    CHECK (btrim(signal_tenant_id) <> '')
);

-- Idempotent upgrade for tables created before these constraints existed.
ALTER TABLE outreach_hygiene_intents
  ADD COLUMN IF NOT EXISTS replay_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE outreach_hygiene_intents
  DROP CONSTRAINT IF EXISTS outreach_hygiene_intents_candidate_nonblank;
ALTER TABLE outreach_hygiene_intents
  ADD CONSTRAINT outreach_hygiene_intents_candidate_nonblank
  CHECK (btrim(signal_candidate_id) <> '');
ALTER TABLE outreach_hygiene_intents
  DROP CONSTRAINT IF EXISTS outreach_hygiene_intents_tenant_nonblank;
ALTER TABLE outreach_hygiene_intents
  ADD CONSTRAINT outreach_hygiene_intents_tenant_nonblank
  CHECK (btrim(signal_tenant_id) <> '');

ALTER TABLE outreach_hygiene_intents
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMP;
ALTER TABLE outreach_hygiene_intents
  DROP CONSTRAINT IF EXISTS outreach_hygiene_intents_source_outreach_log_id_fkey;
ALTER TABLE outreach_hygiene_intents
  DROP CONSTRAINT IF EXISTS outreach_hygiene_intents_status_check;
ALTER TABLE outreach_hygiene_intents
  ADD CONSTRAINT outreach_hygiene_intents_status_check
  CHECK (status IN ('pending', 'processing', 'synced', 'dead_letter'));
ALTER TABLE outreach_hygiene_intents
  DROP CONSTRAINT IF EXISTS outreach_hygiene_intents_dead_letter_pair_check;
ALTER TABLE outreach_hygiene_intents
  ADD CONSTRAINT outreach_hygiene_intents_dead_letter_pair_check
  CHECK ((status = 'dead_letter') = (dead_lettered_at IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS outreach_hygiene_intents_provider_event_idx
  ON outreach_hygiene_intents(provider, provider_event_id);
CREATE INDEX IF NOT EXISTS outreach_hygiene_intents_due_idx
  ON outreach_hygiene_intents(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS outreach_hygiene_intents_email_idx
  ON outreach_hygiene_intents(email_hash);
CREATE INDEX IF NOT EXISTS outreach_hygiene_intents_pending_complaint_idx
  ON outreach_hygiene_intents(status)
  WHERE reason = 'complaint' AND status <> 'synced';

CREATE TABLE IF NOT EXISTS candidate_outreach_schedules (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sourced_candidate_id INTEGER NOT NULL REFERENCES job_sourced_candidates(id) ON DELETE CASCADE,
  next_round INTEGER NOT NULL CHECK (next_round BETWEEN 2 AND 3),
  due_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'completed', 'cancelled')),
  triggered_by INTEGER NOT NULL REFERENCES users(id),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS candidate_outreach_schedules_candidate_idx
  ON candidate_outreach_schedules(sourced_candidate_id);
CREATE INDEX IF NOT EXISTS candidate_outreach_schedules_due_idx
  ON candidate_outreach_schedules(status, due_at);
CREATE INDEX IF NOT EXISTS candidate_outreach_schedules_org_job_idx
  ON candidate_outreach_schedules(organization_id, job_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'candidate_outreach_schedules_candidate_owner_fk'
      AND conrelid = 'candidate_outreach_schedules'::regclass
  ) THEN
    ALTER TABLE candidate_outreach_schedules
      ADD CONSTRAINT candidate_outreach_schedules_candidate_owner_fk
      FOREIGN KEY (sourced_candidate_id, organization_id, job_id)
      REFERENCES job_sourced_candidates(id, organization_id, job_id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- Preserve still-pending legacy job-level follow-ups as candidate-owned schedules.
INSERT INTO candidate_outreach_schedules (
  organization_id,
  job_id,
  sourced_candidate_id,
  next_round,
  due_at,
  status,
  triggered_by
)
SELECT
  soc.organization_id,
  soc.job_id,
  jsc.id,
  soc.round,
  soc.scheduled_at,
  'pending',
  soc.triggered_by
FROM scheduled_outreach_campaigns soc
JOIN job_sourced_candidates jsc
  ON jsc.organization_id = soc.organization_id
 AND jsc.job_id = soc.job_id
WHERE soc.status = 'pending'
  AND soc.round BETWEEN 2 AND 3
  AND jsc.state = 'shortlisted'
  AND jsc.applied_at IS NULL
  AND jsc.outreach_count = soc.round - 1
ON CONFLICT (sourced_candidate_id) DO NOTHING;

UPDATE scheduled_outreach_campaigns
SET status = 'cancelled'
WHERE status = 'pending';
