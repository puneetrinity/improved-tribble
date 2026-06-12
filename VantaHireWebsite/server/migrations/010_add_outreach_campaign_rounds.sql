ALTER TABLE job_sourced_candidates
  ADD COLUMN IF NOT EXISTS outreach_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_outreach_round INTEGER,
  ADD COLUMN IF NOT EXISTS last_outreach_campaign_id TEXT;

CREATE TABLE IF NOT EXISTS sourced_candidate_outreach_campaigns (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL UNIQUE,
  round INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  audience_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  subject_template TEXT,
  html_body_template TEXT,
  extra_context TEXT,
  launched_by INTEGER NOT NULL REFERENCES users(id),
  launched_at TIMESTAMP DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS scoc_job_round_idx
  ON sourced_candidate_outreach_campaigns(job_id, round);
CREATE INDEX IF NOT EXISTS scoc_job_idx
  ON sourced_candidate_outreach_campaigns(job_id);
CREATE INDEX IF NOT EXISTS scoc_org_idx
  ON sourced_candidate_outreach_campaigns(organization_id);
CREATE INDEX IF NOT EXISTS scoc_launched_by_idx
  ON sourced_candidate_outreach_campaigns(launched_by);

ALTER TABLE sourced_candidate_outreach_log
  ADD COLUMN IF NOT EXISTS campaign_round INTEGER,
  ADD COLUMN IF NOT EXISTS body_html TEXT;
