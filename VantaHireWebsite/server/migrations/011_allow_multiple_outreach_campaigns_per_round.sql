DROP INDEX IF EXISTS scoc_job_round_idx;

CREATE INDEX IF NOT EXISTS scoc_job_round_idx
  ON sourced_candidate_outreach_campaigns(job_id, round);
