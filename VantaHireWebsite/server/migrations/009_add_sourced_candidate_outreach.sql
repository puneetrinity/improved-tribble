ALTER TABLE job_sourced_candidates
ADD COLUMN IF NOT EXISTS found_email TEXT,
ADD COLUMN IF NOT EXISTS found_emails JSONB,
ADD COLUMN IF NOT EXISTS email_resolved_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS email_resolve_status TEXT,
ADD COLUMN IF NOT EXISTS last_outreach_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_outreach_status TEXT;

CREATE TABLE IF NOT EXISTS sourced_candidate_outreach_log (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sourced_candidate_id INTEGER NOT NULL REFERENCES job_sourced_candidates(id) ON DELETE CASCADE,
  campaign_id TEXT,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  ai_draft_body TEXT,
  ai_draft_subject TEXT,
  was_edited BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL,
  error_message TEXT,
  sent_by INTEGER NOT NULL REFERENCES users(id),
  sent_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS scol_job_idx ON sourced_candidate_outreach_log(job_id);
CREATE INDEX IF NOT EXISTS scol_candidate_idx ON sourced_candidate_outreach_log(sourced_candidate_id);
CREATE INDEX IF NOT EXISTS scol_campaign_idx ON sourced_candidate_outreach_log(campaign_id);
CREATE INDEX IF NOT EXISTS scol_org_idx ON sourced_candidate_outreach_log(organization_id);
