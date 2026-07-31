-- Tier 4 outreach delivery hygiene and per-candidate follow-up scheduling.

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
