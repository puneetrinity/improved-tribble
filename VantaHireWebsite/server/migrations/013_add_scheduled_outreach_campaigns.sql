-- Scheduled auto-send for outreach campaign rounds 2 and 3
CREATE TABLE IF NOT EXISTS scheduled_outreach_campaigns (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  round INTEGER NOT NULL CHECK (round BETWEEN 2 AND 3),
  scheduled_at TIMESTAMP NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | cancelled | failed
  triggered_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP,
  result_campaign_id TEXT,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_scheduled_job_round UNIQUE (job_id, round)
);

CREATE INDEX IF NOT EXISTS soc_status_scheduled_idx ON scheduled_outreach_campaigns (status, scheduled_at);
CREATE INDEX IF NOT EXISTS soc_job_idx ON scheduled_outreach_campaigns (job_id);
CREATE INDEX IF NOT EXISTS soc_org_idx ON scheduled_outreach_campaigns (organization_id);
