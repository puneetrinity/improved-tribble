ALTER TABLE job_sourced_candidates
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS applied_from_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS applied_after_round INTEGER;
