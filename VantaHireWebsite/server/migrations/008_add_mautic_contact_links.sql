CREATE TABLE IF NOT EXISTS mautic_contact_links (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  mautic_contact_id INTEGER,
  last_known_segment_id INTEGER,
  first_login_synced_at TIMESTAMP,
  first_job_created_synced_at TIMESTAMP,
  last_synced_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS mautic_contact_links_email_idx ON mautic_contact_links(email);
CREATE UNIQUE INDEX IF NOT EXISTS mautic_contact_links_user_idx ON mautic_contact_links(user_id);
CREATE INDEX IF NOT EXISTS mautic_contact_links_contact_idx ON mautic_contact_links(mautic_contact_id);
CREATE INDEX IF NOT EXISTS mautic_contact_links_org_idx ON mautic_contact_links(organization_id);
