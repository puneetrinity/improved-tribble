-- Durable recovery for shortlist-triggered Signal contact resolution.
--
-- Signal owns provider idempotency. Flow owns delivery durability: these
-- columns let every web replica atomically lease pending work and retry it
-- after a crash without issuing concurrent calls for the same candidate.

ALTER TABLE job_sourced_candidates
  ADD COLUMN IF NOT EXISTS email_resolve_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS email_resolve_next_attempt_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS email_resolve_lease_token TEXT,
  ADD COLUMN IF NOT EXISTS email_resolve_lease_expires_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS email_resolve_last_error_code TEXT;

-- A legacy/corrupt row without a Signal identity can never be resolved.
-- Terminalize it explicitly instead of leasing the empty string forever.
UPDATE job_sourced_candidates
SET email_resolve_status = 'failed',
    email_resolved_at = COALESCE(email_resolved_at, NOW()),
    email_resolve_next_attempt_at = NULL,
    email_resolve_lease_token = NULL,
    email_resolve_lease_expires_at = NULL,
    email_resolve_last_error_code = 'missing_signal_candidate_id'
WHERE email_resolve_status = 'pending'
  AND btrim(COALESCE(signal_candidate_id, '')) = '';

-- Existing valid pending rows are the exact jobs this migration is intended
-- to recover. Make them immediately claimable after deploy.
UPDATE job_sourced_candidates
SET email_resolve_next_attempt_at = COALESCE(
      email_resolve_next_attempt_at,
      updated_at,
      NOW()
    )
WHERE email_resolve_status = 'pending'
  AND btrim(COALESCE(signal_candidate_id, '')) <> ''
  AND email_resolve_next_attempt_at IS NULL;

CREATE INDEX IF NOT EXISTS job_sourced_candidates_email_resolution_due_idx
  ON job_sourced_candidates (email_resolve_next_attempt_at, id)
  WHERE email_resolve_status = 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_sourced_candidates_email_resolve_attempts_nonnegative'
      AND conrelid = 'job_sourced_candidates'::regclass
  ) THEN
    ALTER TABLE job_sourced_candidates
      ADD CONSTRAINT job_sourced_candidates_email_resolve_attempts_nonnegative
      CHECK (email_resolve_attempts >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_sourced_candidates_email_resolve_lease_pair'
      AND conrelid = 'job_sourced_candidates'::regclass
  ) THEN
    ALTER TABLE job_sourced_candidates
      ADD CONSTRAINT job_sourced_candidates_email_resolve_lease_pair
      CHECK (
        (email_resolve_lease_token IS NULL AND email_resolve_lease_expires_at IS NULL)
        OR
        (email_resolve_lease_token IS NOT NULL AND email_resolve_lease_expires_at IS NOT NULL)
      );
  END IF;
END
$$;
