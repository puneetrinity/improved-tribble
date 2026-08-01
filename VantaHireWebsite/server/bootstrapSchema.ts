import { db } from './db';
import { sql } from 'drizzle-orm';
import {
  BUSINESS_CREDITS_PER_SEAT_PER_MONTH,
  BUSINESS_CREDITS_ROLLOVER_MONTHS,
  BUSINESS_PLAN_DESCRIPTION,
  BUSINESS_PRICE_PER_SEAT_ANNUAL,
  BUSINESS_PRICE_PER_SEAT_MONTHLY,
  FREE_CREDITS_PER_MONTH,
  FREE_CREDITS_ROLLOVER_MONTHS,
  FREE_PLAN_DESCRIPTION,
  FREE_PRICE_PER_SEAT_ANNUAL,
  FREE_PRICE_PER_SEAT_MONTHLY,
  PRO_CREDITS_PER_SEAT_PER_MONTH,
  PRO_CREDITS_ROLLOVER_MONTHS,
  PRO_PLAN_DESCRIPTION,
  PRO_PRICE_PER_SEAT_ANNUAL,
  PRO_PRICE_PER_SEAT_MONTHLY,
} from './lib/planConfig';

export async function ensureAtsSchema(): Promise<void> {
  console.log('🔧 Ensuring ATS schema exists...');
  const lockId = Number(process.env.DB_MIGRATION_LOCK_ID || '72499101');

  await db.transaction(async (db: any) => {
    await db.execute(sql`SELECT pg_advisory_xact_lock(${lockId});`);

    // Resilient per-statement execution: each DDL runs inside its own
    // SAVEPOINT so one failure rolls back only that statement and the
    // bootstrap continues (all statements are idempotent IF NOT EXISTS).
    // Without this, a single failing statement aborts the whole transaction
    // and every column after it silently never gets created (the exact cause
    // of the Jul-2026 prod schema drift).
    let bootstrapFailures = 0;
    const execSafe = async (query: any): Promise<void> => {
      await db.execute(sql`SAVEPOINT bootstrap_sp;`);
      try {
        await db.execute(query);
        await db.execute(sql`RELEASE SAVEPOINT bootstrap_sp;`);
      } catch (e) {
        await db.execute(sql`ROLLBACK TO SAVEPOINT bootstrap_sp;`);
        bootstrapFailures++;
        console.error(`[bootstrap] statement failed (continuing): ${(e as Error).message}`);
      }
    };

    // Create base tables first (from schema.ts)
    console.log('  Creating base tables (users, jobs, applications, etc.)...');

    await execSafe(sql`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        role TEXT NOT NULL DEFAULT 'candidate'
      );
    `);

    await execSafe(sql`
      CREATE TABLE IF NOT EXISTS contact_submissions (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        company TEXT,
        location TEXT,
        message TEXT NOT NULL,
        submitted_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    await execSafe(sql`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        skills TEXT[],
        deadline DATE,
        posted_by INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        status TEXT NOT NULL DEFAULT 'pending',
        review_comments TEXT,
        expires_at TIMESTAMP,
        reviewed_by INTEGER REFERENCES users(id),
        reviewed_at TIMESTAMP,
        slug TEXT,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    await execSafe(sql`
      CREATE TABLE IF NOT EXISTS saved_jobs (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await execSafe(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS saved_jobs_candidate_job_unique_idx
      ON saved_jobs(candidate_id, job_id);
    `);
    await execSafe(sql`
      CREATE INDEX IF NOT EXISTS saved_jobs_candidate_created_at_idx
      ON saved_jobs(candidate_id, created_at DESC);
    `);
    await execSafe(sql`
      CREATE INDEX IF NOT EXISTS saved_jobs_job_id_idx
      ON saved_jobs(job_id);
    `);

  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      bio TEXT,
      skills TEXT[],
      linkedin TEXT,
      location TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      user_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      resume_url TEXT NOT NULL,
      resume_filename TEXT,
      extracted_resume_text TEXT,
      cover_letter TEXT,
      status TEXT DEFAULT 'submitted' NOT NULL,
      notes TEXT,
      last_viewed_at TIMESTAMP,
      downloaded_at TIMESTAMP,
      applied_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
      current_stage INTEGER,
      interview_date TIMESTAMP,
      interview_time TEXT,
      interview_location TEXT,
      interview_notes TEXT,
      recruiter_notes TEXT[],
      rating INTEGER,
      tags TEXT[],
      stage_changed_at TIMESTAMP,
      stage_changed_by INTEGER,
      submitted_by_recruiter BOOLEAN DEFAULT FALSE,
      created_by_user_id INTEGER REFERENCES users(id),
      source TEXT DEFAULT 'public_apply',
      source_metadata JSONB,
      sync_skipped_reason TEXT
    );
  `);

  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS job_analytics (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      views INTEGER NOT NULL DEFAULT 0,
      apply_clicks INTEGER NOT NULL DEFAULT 0,
      conversion_rate NUMERIC(5, 2) DEFAULT 0.00,
      ai_score_cache INTEGER,
      ai_model_version TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // Create ATS tables if they do not exist
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      color TEXT DEFAULT '#3b82f6',
      is_default BOOLEAN DEFAULT FALSE,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS email_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      template_type TEXT NOT NULL,
      created_by INTEGER,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS application_stage_history (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      from_stage INTEGER,
      to_stage INTEGER NOT NULL,
      changed_by INTEGER NOT NULL,
      notes TEXT,
      changed_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS email_audit_log (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
      template_id INTEGER,
      template_type TEXT,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      sent_at TIMESTAMP DEFAULT NOW() NOT NULL,
      sent_by INTEGER,
      status TEXT NOT NULL DEFAULT 'success',
      error_message TEXT,
      preview_url TEXT
    );
  `);

  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS automation_settings (
      id SERIAL PRIMARY KEY,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value BOOLEAN NOT NULL DEFAULT TRUE,
      description TEXT,
      updated_by INTEGER,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS consultants (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      experience TEXT NOT NULL,
      linkedin_url TEXT,
      domains TEXT NOT NULL,
      description TEXT,
      photo_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // Add ATS columns to applications table if missing
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS current_stage INTEGER;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS interview_date TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS interview_time TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS interview_location TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS interview_notes TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS recruiter_notes TEXT[];`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS hm_review_requested_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS hm_review_requested_by INTEGER REFERENCES users(id);`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS hm_review_note TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS rating INTEGER;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS tags TEXT[];`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS stage_changed_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS stage_changed_by INTEGER;`);

  // Phase 5: Add userId column for robust candidate authorization (binds applications to user accounts)
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id);`);

  // Add resumeFilename column for proper file download headers
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_filename TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS extracted_resume_text TEXT;`);

  // Add recruiter metadata columns for "Add Candidate" feature
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS submitted_by_recruiter BOOLEAN DEFAULT FALSE;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'public_apply';`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS source_metadata JSONB;`);

  // Phase 5: Create performance indexes for hotspot queries
  // Jobs table indexes (status, postedBy, isActive for filtering)
  await execSafe(sql`CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS jobs_posted_by_idx ON jobs(posted_by);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS jobs_is_active_idx ON jobs(is_active);`);

  // Applications table indexes (userId for auth, status for filtering)
  await execSafe(sql`CREATE INDEX IF NOT EXISTS applications_user_id_idx ON applications(user_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS applications_hm_review_requested_at_idx ON applications(hm_review_requested_at);`);

  // Functional index for case-insensitive duplicate detection (recruiter-add)
  await execSafe(sql`CREATE INDEX IF NOT EXISTS applications_job_email_idx ON applications(job_id, LOWER(email));`);
  await execSafe(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS applications_job_lower_email_unique
    ON applications(job_id, LOWER(email));
  `);

  // Fix jobs table: pending jobs should not be active by default
  await execSafe(sql`ALTER TABLE jobs ALTER COLUMN is_active SET DEFAULT FALSE;`);

  // Clean up existing data: pending jobs should not be active
  await execSafe(sql`UPDATE jobs SET is_active = FALSE WHERE status = 'pending' AND is_active = TRUE;`);

  // Phase 2 (SEO): Add slug and updatedAt columns for SEO-friendly URLs
  console.log('  Adding SEO columns to jobs table...');
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS slug TEXT;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW() NOT NULL;`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS jobs_slug_idx ON jobs(slug);`);

  // Phase 7 (Job Lifecycle): Add deactivation/reactivation tracking columns
  console.log('  Adding job lifecycle tracking columns...');
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS reactivation_count INTEGER DEFAULT 0 NOT NULL;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS warning_email_sent BOOLEAN DEFAULT FALSE NOT NULL;`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS jobs_deactivated_at_idx ON jobs(deactivated_at);`);

  // Backfill deactivatedAt for existing inactive jobs
  console.log('  Backfilling deactivation timestamps for existing inactive jobs...');
  await execSafe(sql`
    UPDATE jobs
    SET deactivated_at = updated_at,
        deactivation_reason = 'manual'
    WHERE is_active = FALSE
      AND deactivated_at IS NULL
      AND status IN ('approved', 'declined');
  `);

  // Phase 7 (Job Audit): Create audit log table for compliance and debugging
  console.log('  Creating job audit log table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS job_audit_log (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      performed_by INTEGER NOT NULL REFERENCES users(id),
      reason TEXT,
      metadata JSONB,
      timestamp TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_audit_log_job_id_idx ON job_audit_log(job_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_audit_log_timestamp_idx ON job_audit_log(timestamp);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_audit_log_action_idx ON job_audit_log(action);`);

  // Forms Feature: Create forms tables in dependency order
  console.log('  Creating forms tables...');

  // 1. forms table (no dependencies)
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS forms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_published BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // 2. form_fields table (depends on forms)
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS form_fields (
      id SERIAL PRIMARY KEY,
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      required BOOLEAN NOT NULL DEFAULT FALSE,
      options TEXT,
      "order" INTEGER NOT NULL
    );
  `);

  // 3. form_invitations table (depends on forms, applications)
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS form_invitations (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      form_id INTEGER NOT NULL REFERENCES forms(id),
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_by INTEGER NOT NULL REFERENCES users(id),
      sent_at TIMESTAMP,
      viewed_at TIMESTAMP,
      answered_at TIMESTAMP,
      field_snapshot TEXT NOT NULL,
      custom_message TEXT,
      reminder_sent_at TIMESTAMP,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // 4. form_responses table (depends on form_invitations, applications)
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS form_responses (
      id SERIAL PRIMARY KEY,
      invitation_id INTEGER NOT NULL REFERENCES form_invitations(id) ON DELETE CASCADE UNIQUE,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      submitted_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // 5. form_response_answers table (depends on form_responses, form_fields)
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS form_response_answers (
      id SERIAL PRIMARY KEY,
      response_id INTEGER NOT NULL REFERENCES form_responses(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL REFERENCES form_fields(id),
      value TEXT,
      file_url TEXT
    );
  `);

  // Forms Feature: Create indexes
  console.log('  Creating forms indexes...');
  await execSafe(sql`CREATE INDEX IF NOT EXISTS forms_created_by_idx ON forms(created_by);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS forms_is_published_idx ON forms(is_published);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS form_fields_form_id_order_idx ON form_fields(form_id, "order");`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS form_invitations_token_idx ON form_invitations(token);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS form_invitations_app_status_idx ON form_invitations(application_id, status);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS form_invitations_created_at_idx ON form_invitations(created_at);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS form_invitations_form_id_idx ON form_invitations(form_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS form_responses_application_id_idx ON form_responses(application_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS form_response_answers_response_id_idx ON form_response_answers(response_id);`);

  // Forms Feature: Create partial unique index for active invitations (prevents duplicates)
  console.log('  Creating partial unique index for active form invitations...');
  await execSafe(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS form_invitations_active_unique
    ON form_invitations (application_id, form_id)
    WHERE status IN ('pending', 'sent', 'viewed');
  `);

  // External Invites Feature: Add columns to form_invitations for external candidate invites
  console.log('  Adding external invite columns to form_invitations...');
  // Make application_id nullable (external invites have no application yet)
  await execSafe(sql`ALTER TABLE form_invitations ALTER COLUMN application_id DROP NOT NULL;`);
  // Add email column for external candidate
  await execSafe(sql`ALTER TABLE form_invitations ADD COLUMN IF NOT EXISTS email TEXT;`);
  // Add candidate_name column for external candidate
  await execSafe(sql`ALTER TABLE form_invitations ADD COLUMN IF NOT EXISTS candidate_name TEXT;`);
  // Add job_id column for optional job association
  await execSafe(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'form_invitations' AND column_name = 'job_id'
      ) THEN
        ALTER TABLE form_invitations ADD COLUMN job_id INTEGER REFERENCES jobs(id);
        CREATE INDEX IF NOT EXISTS form_invitations_job_id_idx ON form_invitations(job_id);
      END IF;
    END $$;
  `);
  // Create index for external invite lookups by email
  await execSafe(sql`CREATE INDEX IF NOT EXISTS form_invitations_email_idx ON form_invitations(email);`);

  // Talent Pool Feature: Create talent_pool table for managing external candidates
  console.log('  Creating talent_pool table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS talent_pool (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      recruiter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'external_form',
      form_response_id INTEGER REFERENCES form_responses(id),
      notes TEXT,
      resume_url TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // Talent Pool: Create indexes
  console.log('  Creating talent_pool indexes...');
  await execSafe(sql`CREATE INDEX IF NOT EXISTS talent_pool_recruiter_id_idx ON talent_pool(recruiter_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS talent_pool_email_idx ON talent_pool(email);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS talent_pool_source_idx ON talent_pool(source);`);

  // Talent Pool: Create unique index for email per recruiter
  await execSafe(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS talent_pool_recruiter_email_unique
    ON talent_pool(recruiter_id, LOWER(email));
  `);

  // AI Matching Feature: Add columns to existing tables
  console.log('  Adding AI matching columns to existing tables...');

  // Users table: AI feature tracking
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_content_free_used BOOLEAN DEFAULT FALSE;`);
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_onboarded_at TIMESTAMP;`);

  // Users table: Profile completion tracking
  console.log('  Adding profile completion columns to users table...');
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_prompt_snooze_until TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed_at TIMESTAMP;`);

  // Users table: Onboarding tracking
  console.log('  Adding onboarding tracking column to users table...');
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_skipped_at TIMESTAMP;`);

  // Jobs table: JD digest caching
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS jd_digest JSONB;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS jd_digest_version INTEGER DEFAULT 1;`);

  // Applications table: AI fit scoring
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_fit_score INTEGER;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_fit_label TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_fit_reasons JSONB;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_model_version TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_computed_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_stale_reason TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_digest_version_used INTEGER;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_summary TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_summary_version INTEGER DEFAULT 1;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_suggested_action TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_suggested_action_reason TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_summary_computed_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_summary_model_version TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_strengths TEXT[];`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_concerns TEXT[];`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_key_highlights TEXT[];`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_required_skills_matched TEXT[];`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_required_skills_missing TEXT[];`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_required_skills_match_percentage INTEGER;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_required_skills_depth_notes TEXT;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_good_to_have_skills_matched TEXT[];`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_good_to_have_skills_missing TEXT[];`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_id INTEGER;`);

  // AI Matching Feature: Create new tables
  console.log('  Creating AI matching tables...');

  // Candidate resumes table
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS candidate_resumes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      gcs_path TEXT NOT NULL,
      extracted_text TEXT,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // User AI usage tracking table
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS user_ai_usage (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      tokens_in INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      cost_usd DECIMAL(10, 8) NOT NULL,
      computed_at TIMESTAMP DEFAULT NOW() NOT NULL,
      metadata JSONB
    );
  `);

  // AI Matching Feature: Create indexes
  console.log('  Creating AI matching indexes...');
  await execSafe(sql`CREATE INDEX IF NOT EXISTS candidate_resumes_user_id_idx ON candidate_resumes(user_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS user_ai_usage_user_id_idx ON user_ai_usage(user_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS user_ai_usage_kind_idx ON user_ai_usage(kind);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS user_ai_usage_computed_at_idx ON user_ai_usage(computed_at);`);

  // AI Matching Feature: Create partial unique index for default resume
  console.log('  Creating partial unique index for default resume per user...');
  await execSafe(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS candidate_resumes_unique_default_per_user
    ON candidate_resumes(user_id)
    WHERE is_default = true;
  `);

  // AI Matching Feature: Create trigger to enforce max 3 resumes per user
  console.log('  Creating trigger to enforce max 3 resumes per user...');
  await execSafe(sql`
    CREATE OR REPLACE FUNCTION check_resume_limit()
    RETURNS TRIGGER AS $$
    BEGIN
      IF (SELECT COUNT(*) FROM candidate_resumes WHERE user_id = NEW.user_id) >= 3 THEN
        RAISE EXCEPTION 'Maximum 3 resumes allowed per user';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await execSafe(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'enforce_resume_limit'
      ) THEN
        CREATE TRIGGER enforce_resume_limit
        BEFORE INSERT ON candidate_resumes
        FOR EACH ROW EXECUTE FUNCTION check_resume_limit();
      END IF;
    END $$;
  `);

  // AI Matching Feature: Add foreign key constraint for resume_id in applications
  console.log('  Adding foreign key constraint for resume_id in applications...');
  await execSafe(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'applications_resume_id_fkey'
      ) THEN
        ALTER TABLE applications
        ADD CONSTRAINT applications_resume_id_fkey
        FOREIGN KEY (resume_id) REFERENCES candidate_resumes(id);
      END IF;
    END $$;
  `);

  // ATS: Application feedback (hiring manager feedback)
  console.log('  Creating application_feedback table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS application_feedback (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      overall_score INTEGER NOT NULL,
      recommendation TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS application_feedback_application_id_idx ON application_feedback(application_id);
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS application_feedback_author_id_idx ON application_feedback(author_id);
  `);

  // Consulting/Agency Feature: Clients
  console.log('  Creating clients table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      primary_contact_name TEXT,
      primary_contact_email TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id)
    );
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS clients_created_by_idx ON clients(created_by);
  `);

  // Consulting/Agency Feature: Client Shortlists
  console.log('  Creating client_shortlists table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS client_shortlists (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      title TEXT,
      message TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      expires_at TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS client_shortlists_client_id_idx ON client_shortlists(client_id);
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS client_shortlists_job_id_idx ON client_shortlists(job_id);
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS client_shortlists_token_idx ON client_shortlists(token);
  `);

  // Consulting/Agency Feature: Client Shortlist Items
  console.log('  Creating client_shortlist_items table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS client_shortlist_items (
      id SERIAL PRIMARY KEY,
      shortlist_id INTEGER NOT NULL REFERENCES client_shortlists(id) ON DELETE CASCADE,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS client_shortlist_items_shortlist_id_idx ON client_shortlist_items(shortlist_id);
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS client_shortlist_items_application_id_idx ON client_shortlist_items(application_id);
  `);

  // Consulting/Agency Feature: Client Feedback
  console.log('  Creating client_feedback table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS client_feedback (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      shortlist_id INTEGER REFERENCES client_shortlists(id) ON DELETE SET NULL,
      recommendation TEXT NOT NULL,
      notes TEXT,
      rating INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS client_feedback_application_id_idx ON client_feedback(application_id);
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS client_feedback_client_id_idx ON client_feedback(client_id);
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS client_feedback_shortlist_id_idx ON client_feedback(shortlist_id);
  `);

  // ATS: Add hiring_manager_id column to jobs table
  console.log('  Adding hiring_manager_id column to jobs table...');
  await execSafe(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'jobs' AND column_name = 'hiring_manager_id'
      ) THEN
        ALTER TABLE jobs ADD COLUMN hiring_manager_id INTEGER REFERENCES users(id);
        CREATE INDEX IF NOT EXISTS jobs_hiring_manager_idx ON jobs(hiring_manager_id);
      END IF;
    END $$;
  `);

  // Consulting/Agency Feature: Add clientId column to jobs table
  console.log('  Adding client_id column to jobs table...');
  await execSafe(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'jobs' AND column_name = 'client_id'
      ) THEN
        ALTER TABLE jobs ADD COLUMN client_id INTEGER REFERENCES clients(id);
        CREATE INDEX IF NOT EXISTS jobs_client_id_idx ON jobs(client_id);
      END IF;
    END $$;
  `);

  // Migration: Rename admin role to super_admin (idempotent)
  console.log('  Migrating admin role to super_admin...');
  await execSafe(sql`
    UPDATE users SET role = 'super_admin' WHERE role = 'admin';
  `);

  // Migration: Update admin username to email format for login compatibility
  console.log('  Updating admin username to email format...');
  await execSafe(sql`
    UPDATE users SET username = 'admin@vantahire.local'
    WHERE username = 'admin' AND role = 'super_admin';
  `);

  // Operations Command Center: Add rejection_reason column to applications
  console.log('  Adding rejection_reason column to applications table...');
  await execSafe(sql`
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS applications_rejection_reason_idx ON applications(rejection_reason);
  `);

  // WhatsApp consent: Add whatsapp_consent column to applications
  console.log('  Adding whatsapp_consent column to applications table...');
  await execSafe(sql`
    ALTER TABLE applications ADD COLUMN IF NOT EXISTS whatsapp_consent BOOLEAN NOT NULL DEFAULT TRUE;
  `);

  // Operations Command Center: Create automation_events table for tracking automation activity
  console.log('  Creating automation_events table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS automation_events (
      id SERIAL PRIMARY KEY,
      automation_key TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      outcome TEXT NOT NULL DEFAULT 'success',
      error_message TEXT,
      metadata JSONB,
      triggered_at TIMESTAMP DEFAULT NOW() NOT NULL,
      triggered_by INTEGER REFERENCES users(id)
    );
  `);

  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS automation_events_key_idx ON automation_events(automation_key);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS automation_events_target_type_idx ON automation_events(target_type);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS automation_events_triggered_at_idx ON automation_events(triggered_at);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS automation_events_outcome_idx ON automation_events(outcome);
  `);

  // Seed default automation settings if they don't exist
  console.log('  Seeding default automation settings...');
  const defaultSettings = [
    { key: 'auto_send_application_received', description: 'Automatically send confirmation when a candidate submits an application' },
    { key: 'auto_send_status_update', description: 'Notify candidates when their application moves to a new stage' },
    { key: 'auto_send_interview_invite', description: 'Automatically send interview invitations when scheduled' },
    { key: 'auto_send_offer_letter', description: 'Send offer email when candidate reaches Offer stage' },
    { key: 'auto_send_rejection', description: 'Send rejection email when candidate is rejected' },
    { key: 'notify_recruiter_new_application', description: 'Email recruiters when a new application is submitted for their job' },
    { key: 'reminder_interview_upcoming', description: 'Send reminder emails before scheduled interviews' },
  ];

  for (const setting of defaultSettings) {
    await execSafe(sql`
      INSERT INTO automation_settings (setting_key, setting_value, description)
      VALUES (${setting.key}, false, ${setting.description})
      ON CONFLICT (setting_key) DO NOTHING
    `);
  }

  // Email Verification: Add verification columns to users table
  console.log('  Adding email verification columns to users table...');
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;`);
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token TEXT;`);
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP;`);

  // Password Reset: Add password reset columns to users table
  console.log('  Adding password reset columns to users table...');
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT;`);
  await execSafe(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;`);

  // Recruiter Profiles: Add profile columns to user_profiles table
  console.log('  Adding recruiter profile columns to user_profiles table...');
  await execSafe(sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS display_name TEXT;`);
  await execSafe(sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS company TEXT;`);
  await execSafe(sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await execSafe(sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;`);
  await execSafe(sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE;`);

  // URL Security: Add publicId column for non-enumerable recruiter URLs
  console.log('  Adding publicId column to user_profiles table...');
  await execSafe(sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS public_id TEXT;`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_public_id_idx ON user_profiles(public_id);`);

  // WhatsApp Integration: Create WhatsApp templates table
  console.log('  Creating whatsapp_templates table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      meta_template_name TEXT NOT NULL UNIQUE,
      meta_template_id TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      template_type TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'UTILITY',
      body_template TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // WhatsApp Integration: Create indexes for whatsapp_templates
  console.log('  Creating whatsapp_templates indexes...');
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS whatsapp_templates_type_idx ON whatsapp_templates(template_type);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS whatsapp_templates_status_idx ON whatsapp_templates(status);
  `);

  // WhatsApp Integration: Create WhatsApp audit log table
  console.log('  Creating whatsapp_audit_log table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_audit_log (
      id SERIAL PRIMARY KEY,
      application_id INTEGER REFERENCES applications(id) ON DELETE CASCADE,
      template_id INTEGER REFERENCES whatsapp_templates(id),
      template_type TEXT,
      recipient_phone TEXT NOT NULL,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_code TEXT,
      error_message TEXT,
      template_variables JSONB,
      sent_at TIMESTAMP DEFAULT NOW() NOT NULL,
      delivered_at TIMESTAMP,
      read_at TIMESTAMP,
      sent_by INTEGER REFERENCES users(id)
    );
  `);

  // WhatsApp Integration: Create indexes for whatsapp_audit_log
  console.log('  Creating whatsapp_audit_log indexes...');
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS whatsapp_audit_log_application_id_idx ON whatsapp_audit_log(application_id);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS whatsapp_audit_log_status_idx ON whatsapp_audit_log(status);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS whatsapp_audit_log_message_id_idx ON whatsapp_audit_log(message_id);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS whatsapp_audit_log_sent_at_idx ON whatsapp_audit_log(sent_at);
  `);

  // Hiring Manager Invitations: Create table for inviting hiring managers
  console.log('  Creating hiring_manager_invitations table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS hiring_manager_invitations (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      token TEXT NOT NULL,
      invited_by INTEGER NOT NULL REFERENCES users(id),
      inviter_name TEXT,
      expires_at TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      accepted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // Hiring Manager Invitations: Create indexes
  console.log('  Creating hiring_manager_invitations indexes...');
  await execSafe(sql`CREATE INDEX IF NOT EXISTS hm_invitations_email_idx ON hiring_manager_invitations(email);`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS hm_invitations_token_idx ON hiring_manager_invitations(token);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS hm_invitations_invited_by_idx ON hiring_manager_invitations(invited_by);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS hm_invitations_status_idx ON hiring_manager_invitations(status);`);

  // Job Recruiters: Many-to-many table for co-recruiters on jobs
  console.log('  Creating job_recruiters table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS job_recruiters (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      recruiter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_by INTEGER REFERENCES users(id),
      added_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // Job Recruiters: Create indexes
  console.log('  Creating job_recruiters indexes...');
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS job_recruiter_unique_idx ON job_recruiters(job_id, recruiter_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_recruiters_job_idx ON job_recruiters(job_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_recruiters_recruiter_idx ON job_recruiters(recruiter_id);`);

  // Co-Recruiter Invitations: Invite recruiters to collaborate on jobs
  console.log('  Creating co_recruiter_invitations table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS co_recruiter_invitations (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      invited_by INTEGER NOT NULL REFERENCES users(id),
      inviter_name TEXT,
      job_title TEXT,
      expires_at TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      accepted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // Co-Recruiter Invitations: Create indexes
  console.log('  Creating co_recruiter_invitations indexes...');
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS co_recruiter_invite_token_idx ON co_recruiter_invitations(token);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS co_recruiter_invite_job_email_idx ON co_recruiter_invitations(job_id, email);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS co_recruiter_invite_status_idx ON co_recruiter_invitations(status);`);

  // AI Fit Jobs: Async job processing for AI fit scoring
  console.log('  Creating ai_fit_jobs table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS ai_fit_jobs (
      id SERIAL PRIMARY KEY,
      bull_job_id TEXT NOT NULL,
      queue_name TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      application_id INTEGER REFERENCES applications(id),
      application_ids INTEGER[],
      status TEXT NOT NULL DEFAULT 'pending',
      progress INTEGER DEFAULT 0,
      processed_count INTEGER DEFAULT 0,
      total_count INTEGER,
      result JSONB,
      error TEXT,
      error_code TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      started_at TIMESTAMP,
      completed_at TIMESTAMP
    );
  `);

  // AI Fit Jobs: Create indexes
  console.log('  Creating ai_fit_jobs indexes...');
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS ai_fit_jobs_bull_job_id_idx ON ai_fit_jobs(bull_job_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS ai_fit_jobs_user_status_idx ON ai_fit_jobs(user_id, status);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS ai_fit_jobs_application_id_idx ON ai_fit_jobs(application_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS ai_fit_jobs_created_at_idx ON ai_fit_jobs(created_at);`);

  // Client Shortlists: Add missing columns for existing tables
  console.log('  Adding missing columns to client_shortlists table...');
  await execSafe(sql`ALTER TABLE client_shortlists ADD COLUMN IF NOT EXISTS title TEXT;`);
  await execSafe(sql`ALTER TABLE client_shortlists ADD COLUMN IF NOT EXISTS message TEXT;`);

  // Structured Job Requirements: Add salary, skills, education, experience columns
  console.log('  Adding structured job requirement columns to jobs table...');
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_min INTEGER;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_max INTEGER;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salary_period TEXT;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS good_to_have_skills TEXT[];`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS education_requirement TEXT;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_years INTEGER;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS experience_years_max INTEGER;`);
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS original_jd TEXT;`);

  // ============= ORGANIZATION & SUBSCRIPTION TABLES =============

  // Organizations table
  console.log('  Creating organizations table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo TEXT,
      domain TEXT UNIQUE,
      domain_verified BOOLEAN DEFAULT FALSE,
      domain_approved_by INTEGER REFERENCES users(id),
      domain_approved_at TIMESTAMP,
      gstin TEXT,
      billing_name TEXT,
      billing_address TEXT,
      billing_city TEXT,
      billing_state TEXT,
      billing_pincode TEXT,
      billing_contact_email TEXT,
      billing_contact_name TEXT,
      settings JSONB,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // Organization Members table
  console.log('  Creating organization_members table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS organization_members (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      seat_assigned BOOLEAN DEFAULT TRUE NOT NULL,
      last_activity_at TIMESTAMP,
      credits_allocated INTEGER DEFAULT 0 NOT NULL,
      credits_used INTEGER DEFAULT 0 NOT NULL,
      credits_rollover INTEGER DEFAULT 0 NOT NULL,
      credits_period_start TIMESTAMP,
      credits_period_end TIMESTAMP,
      joined_at TIMESTAMP DEFAULT NOW() NOT NULL,
      invited_by INTEGER REFERENCES users(id)
    );
  `);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_user_idx ON organization_members(organization_id, user_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS org_members_user_idx ON organization_members(user_id);`);

  console.log('  Creating mautic_contact_links table...');
  await execSafe(sql`
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
  `);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS mautic_contact_links_email_idx ON mautic_contact_links(email);`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS mautic_contact_links_user_idx ON mautic_contact_links(user_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS mautic_contact_links_contact_idx ON mautic_contact_links(mautic_contact_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS mautic_contact_links_org_idx ON mautic_contact_links(organization_id);`);

  // Organization Invites table
  console.log('  Creating organization_invites table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS organization_invites (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      invited_by INTEGER NOT NULL REFERENCES users(id),
      accepted_at TIMESTAMP,
      accepted_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS org_invites_org_email_idx ON organization_invites(organization_id, email);`);

  // Organization Join Requests table
  console.log('  Creating organization_join_requests table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS organization_join_requests (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TIMESTAMP DEFAULT NOW() NOT NULL,
      responded_at TIMESTAMP,
      responded_by INTEGER REFERENCES users(id),
      rejection_reason TEXT
    );
  `);

  // Domain Claim Requests table
  console.log('  Creating domain_claim_requests table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS domain_claim_requests (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by INTEGER NOT NULL REFERENCES users(id),
      requested_at TIMESTAMP DEFAULT NOW() NOT NULL,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TIMESTAMP,
      rejection_reason TEXT
    );
  `);

  // Subscription Plans table
  console.log('  Creating subscription_plans table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT,
      price_per_seat_monthly INTEGER NOT NULL,
      price_per_seat_annual INTEGER NOT NULL,
      ai_credits_per_seat_monthly INTEGER NOT NULL,
      max_credit_rollover_months INTEGER DEFAULT 3,
      features JSONB NOT NULL,
      is_active BOOLEAN DEFAULT TRUE NOT NULL,
      sort_order INTEGER DEFAULT 0 NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // Organization Subscriptions table
  console.log('  Creating organization_subscriptions table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS organization_subscriptions (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
      seats INTEGER NOT NULL DEFAULT 1,
      billing_cycle TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TIMESTAMP NOT NULL,
      current_period_start TIMESTAMP NOT NULL,
      current_period_end TIMESTAMP NOT NULL,
      cancelled_at TIMESTAMP,
      cancel_at_period_end BOOLEAN DEFAULT FALSE,
      cashfree_subscription_id TEXT,
      cashfree_customer_id TEXT,
      grace_period_end_date TIMESTAMP,
      payment_failure_count INTEGER DEFAULT 0,
      admin_override BOOLEAN DEFAULT FALSE,
      admin_override_reason TEXT,
      admin_override_by INTEGER REFERENCES users(id),
      feature_overrides JSONB,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // Organization Credit Balances table
  console.log('  Creating organization_credit_balances table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS organization_credit_balances (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
      recurring_allocated INTEGER NOT NULL DEFAULT 0,
      recurring_used INTEGER NOT NULL DEFAULT 0,
      rollover_credits INTEGER NOT NULL DEFAULT 0,
      purchased_credits INTEGER NOT NULL DEFAULT 0,
      purchased_used INTEGER NOT NULL DEFAULT 0,
      period_start TIMESTAMP,
      period_end TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await execSafe(sql`ALTER TABLE organization_credit_balances ADD COLUMN IF NOT EXISTS purchased_used INTEGER NOT NULL DEFAULT 0;`);

  // Organization Credit Transactions table
  console.log('  Creating organization_credit_transactions table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS organization_credit_transactions (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      metadata JSONB,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS org_credit_balances_org_idx ON organization_credit_balances(organization_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS org_credit_transactions_org_idx ON organization_credit_transactions(organization_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS org_credit_transactions_type_idx ON organization_credit_transactions(type);`);

  // Payment Transactions table
  console.log('  Creating payment_transactions table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      subscription_id INTEGER REFERENCES organization_subscriptions(id),
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      tax_amount INTEGER DEFAULT 0 NOT NULL,
      total_amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR' NOT NULL,
      status TEXT NOT NULL,
      cashfree_order_id TEXT UNIQUE,
      cashfree_payment_id TEXT,
      cashfree_payment_method TEXT,
      metadata JSONB,
      failure_reason TEXT,
      invoice_number TEXT,
      invoice_url TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      completed_at TIMESTAMP
    );
  `);

  // Webhook Events table (for idempotency)
  console.log('  Creating webhook_events table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS webhook_events (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      processed_at TIMESTAMP DEFAULT NOW() NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT
    );
  `);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_event_id_idx ON webhook_events(provider, event_id);`);

  // Subscription Alerts table
  console.log('  Creating subscription_alerts table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS subscription_alerts (
      id SERIAL PRIMARY KEY,
      subscription_id INTEGER NOT NULL REFERENCES organization_subscriptions(id),
      alert_type TEXT NOT NULL,
      sent_at TIMESTAMP DEFAULT NOW() NOT NULL,
      recipient_email TEXT NOT NULL,
      email_status TEXT DEFAULT 'sent' NOT NULL
    );
  `);

  // Subscription Audit Log table
  console.log('  Creating subscription_audit_log table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS subscription_audit_log (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      subscription_id INTEGER REFERENCES organization_subscriptions(id),
      action TEXT NOT NULL,
      previous_value JSONB,
      new_value JSONB,
      performed_by INTEGER REFERENCES users(id),
      performed_at TIMESTAMP DEFAULT NOW() NOT NULL,
      reason TEXT
    );
  `);

  // Checkout Intents table (for public checkout flow)
  console.log('  Creating checkout_intents table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS checkout_intents (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      org_name TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      organization_id INTEGER REFERENCES organizations(id),
      plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
      seats INTEGER NOT NULL DEFAULT 1,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly',
      gstin TEXT,
      billing_name TEXT,
      billing_address TEXT,
      billing_city TEXT,
      billing_state TEXT,
      billing_pincode TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      cashfree_order_id TEXT UNIQUE,
      claim_token TEXT UNIQUE,
      claimed_at TIMESTAMP,
      claimed_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      paid_at TIMESTAMP
    );
  `);
  console.log('  Creating checkout_intents indexes...');
  await execSafe(sql`CREATE INDEX IF NOT EXISTS checkout_intents_email_idx ON checkout_intents(email);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS checkout_intents_status_idx ON checkout_intents(status);`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_claim_token_idx ON checkout_intents(claim_token) WHERE claim_token IS NOT NULL;`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_cashfree_order_idx ON checkout_intents(cashfree_order_id) WHERE cashfree_order_id IS NOT NULL;`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS checkout_intents_expires_at_idx ON checkout_intents(expires_at);`);

  // Add organizationId to existing tables
  console.log('  Adding organization_id to existing tables...');
  await execSafe(sql`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE forms ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE form_invitations ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE form_responses ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE automation_settings ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE talent_pool ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE user_ai_usage ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE job_analytics ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE job_audit_log ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE co_recruiter_invitations ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE job_recruiters ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE automation_events ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE client_feedback ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE client_shortlist_items ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);
  await execSafe(sql`ALTER TABLE client_shortlists ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);

  // Create indexes for organization_id columns
  console.log('  Creating organization indexes...');
  await execSafe(sql`CREATE INDEX IF NOT EXISTS jobs_org_idx ON jobs(organization_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS applications_org_idx ON applications(organization_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS clients_org_idx ON clients(organization_id);`);

  // Seed default subscription plans
  console.log('  Seeding default subscription plans...');
  const freePlanFeatures = JSON.stringify({
    basicAts: true,
    jobPosting: true,
    applicationManagement: true,
    aiMatching: true,
    aiContent: true,
    advancedAnalytics: false,
    customBranding: false,
    apiAccess: false,
    prioritySupport: false,
  });
  const growthPlanFeatures = JSON.stringify({
    basicAts: true,
    jobPosting: true,
    applicationManagement: true,
    aiMatching: true,
    aiContent: true,
    advancedAnalytics: true,
    customBranding: true,
    apiAccess: false,
    prioritySupport: true,
  });
  const businessPlanFeatures = JSON.stringify({
    basicAts: true,
    jobPosting: true,
    applicationManagement: true,
    aiMatching: true,
    aiContent: true,
    advancedAnalytics: true,
    customBranding: true,
    apiAccess: true,
    prioritySupport: true,
  });
  await execSafe(sql`
    INSERT INTO subscription_plans (
      name,
      display_name,
      description,
      price_per_seat_monthly,
      price_per_seat_annual,
      ai_credits_per_seat_monthly,
      max_credit_rollover_months,
      features,
      sort_order
    )
    VALUES
      ('free', 'Free', ${FREE_PLAN_DESCRIPTION}, ${FREE_PRICE_PER_SEAT_MONTHLY}, ${FREE_PRICE_PER_SEAT_ANNUAL}, ${FREE_CREDITS_PER_MONTH}, ${FREE_CREDITS_ROLLOVER_MONTHS}, ${freePlanFeatures}::jsonb, 0),
      ('pro', 'Growth', ${PRO_PLAN_DESCRIPTION}, ${PRO_PRICE_PER_SEAT_MONTHLY}, ${PRO_PRICE_PER_SEAT_ANNUAL}, ${PRO_CREDITS_PER_SEAT_PER_MONTH}, ${PRO_CREDITS_ROLLOVER_MONTHS}, ${growthPlanFeatures}::jsonb, 1),
      ('business', 'Enterprise', ${BUSINESS_PLAN_DESCRIPTION}, ${BUSINESS_PRICE_PER_SEAT_MONTHLY}, ${BUSINESS_PRICE_PER_SEAT_ANNUAL}, ${BUSINESS_CREDITS_PER_SEAT_PER_MONTH}, ${BUSINESS_CREDITS_ROLLOVER_MONTHS}, ${businessPlanFeatures}::jsonb, 2)
    ON CONFLICT (name) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      price_per_seat_monthly = EXCLUDED.price_per_seat_monthly,
      price_per_seat_annual = EXCLUDED.price_per_seat_annual,
      ai_credits_per_seat_monthly = EXCLUDED.ai_credits_per_seat_monthly,
      max_credit_rollover_months = EXCLUDED.max_credit_rollover_months,
      features = EXCLUDED.features,
      sort_order = EXCLUDED.sort_order;
  `);

  // Fix duplicate job slugs by prepending job ID (e.g., "123-relationship-manager")
  // ID-first format allows the router to extract ID for direct lookup
  console.log('  Fixing duplicate job slugs...');
  await execSafe(sql`
    UPDATE jobs
    SET slug = CONCAT(id::text, '-', slug)
    WHERE slug IS NOT NULL
    AND slug !~ ('^' || id::text || '-');
  `);

  // Admin Org Controls: Add bonus credits fields to organization_subscriptions
  console.log('  Adding bonus credits columns to organization_subscriptions...');
  await execSafe(sql`ALTER TABLE organization_subscriptions ADD COLUMN IF NOT EXISTS bonus_credits INTEGER DEFAULT 0;`);
  await execSafe(sql`ALTER TABLE organization_subscriptions ADD COLUMN IF NOT EXISTS bonus_credits_granted_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE organization_subscriptions ADD COLUMN IF NOT EXISTS bonus_credits_reason TEXT;`);
  await execSafe(sql`ALTER TABLE organization_subscriptions ADD COLUMN IF NOT EXISTS bonus_credits_granted_by INTEGER REFERENCES users(id);`);
  await execSafe(sql`ALTER TABLE organization_subscriptions ADD COLUMN IF NOT EXISTS custom_credit_limit INTEGER;`);

  // Add paid_seats column for accurate MRR calculation (tracks seats actually paid for)
  console.log('  Adding paid_seats column to organization_subscriptions...');
  await execSafe(sql`ALTER TABLE organization_subscriptions ADD COLUMN IF NOT EXISTS paid_seats INTEGER NOT NULL DEFAULT 0;`);

  // ============= SIGNAL SOURCING TABLES =============

  // Add signal_tenant_id to organizations
  console.log('  Adding signal_tenant_id to organizations...');
  await execSafe(sql`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS signal_tenant_id TEXT UNIQUE;`);

  // Job Sourcing Runs table
  console.log('  Creating job_sourcing_runs table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS job_sourcing_runs (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL UNIQUE,
      external_job_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      context_hash TEXT NOT NULL,
      callback_url TEXT,
      meta JSONB,
      error_message TEXT,
      candidate_count INTEGER DEFAULT 0,
      expires_at TIMESTAMP,
      submitted_at TIMESTAMP,
      completed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_sourcing_runs_org_job_idx ON job_sourcing_runs(organization_id, job_id);`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS job_sourcing_runs_request_id_idx ON job_sourcing_runs(request_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_sourcing_runs_status_idx ON job_sourcing_runs(status);`);
  // Partial unique: only one non-terminal run per org+job+context. Terminal runs (completed/failed/expired) don't block reruns.
  // DROP first: IF NOT EXISTS won't replace an existing non-partial index with the same name.
  await execSafe(sql`DROP INDEX IF EXISTS job_sourcing_runs_active_idx;`);
  await execSafe(sql`CREATE UNIQUE INDEX job_sourcing_runs_active_idx ON job_sourcing_runs(organization_id, external_job_id, context_hash) WHERE status NOT IN ('completed', 'failed', 'expired');`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_sourcing_runs_expires_at_idx ON job_sourcing_runs(expires_at);`);

  // Job Sourced Candidates table
  console.log('  Creating job_sourced_candidates table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS job_sourced_candidates (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL REFERENCES job_sourcing_runs(request_id),
      signal_candidate_id TEXT NOT NULL,
      fit_score INTEGER,
      fit_breakdown JSONB,
      source_type TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'new',
      candidate_summary JSONB,
      found_email TEXT,
      found_emails JSONB,
      email_resolved_at TIMESTAMP,
      email_resolve_status TEXT,
      email_resolve_attempts INTEGER NOT NULL DEFAULT 0,
      email_resolve_next_attempt_at TIMESTAMP,
      email_resolve_lease_token TEXT,
      email_resolve_lease_expires_at TIMESTAMP,
      email_resolve_last_error_code TEXT,
      outreach_count INTEGER NOT NULL DEFAULT 0,
      last_outreach_round INTEGER,
      last_outreach_campaign_id TEXT,
      last_outreach_at TIMESTAMP,
      last_outreach_status TEXT,
      converted_application_id INTEGER REFERENCES applications(id),
      applied_at TIMESTAMP,
      applied_from_campaign_id TEXT,
      applied_after_round INTEGER,
      last_synced_at TIMESTAMP DEFAULT NOW() NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS found_email TEXT;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS found_emails JSONB;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS email_resolved_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS email_resolve_status TEXT;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS email_resolve_attempts INTEGER NOT NULL DEFAULT 0;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS email_resolve_next_attempt_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS email_resolve_lease_token TEXT;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS email_resolve_lease_expires_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS email_resolve_last_error_code TEXT;`);
  await execSafe(sql`
    UPDATE job_sourced_candidates
    SET email_resolve_status = 'failed',
        email_resolved_at = COALESCE(email_resolved_at, NOW()),
        email_resolve_next_attempt_at = NULL,
        email_resolve_lease_token = NULL,
        email_resolve_lease_expires_at = NULL,
        email_resolve_last_error_code = 'missing_signal_candidate_id'
    WHERE email_resolve_status = 'pending'
      AND btrim(COALESCE(signal_candidate_id, '')) = '';
  `);
  await execSafe(sql`
    UPDATE job_sourced_candidates
    SET email_resolve_next_attempt_at = COALESCE(
          email_resolve_next_attempt_at,
          updated_at,
          NOW()
    )
    WHERE email_resolve_status = 'pending'
      AND btrim(COALESCE(signal_candidate_id, '')) <> ''
      AND email_resolve_next_attempt_at IS NULL;
  `);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS outreach_count INTEGER NOT NULL DEFAULT 0;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS last_outreach_round INTEGER;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS last_outreach_campaign_id TEXT;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS last_outreach_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS last_outreach_status TEXT;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS applied_from_campaign_id TEXT;`);
  await execSafe(sql`ALTER TABLE job_sourced_candidates ADD COLUMN IF NOT EXISTS applied_after_round INTEGER;`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS job_sourced_candidates_job_candidate_idx ON job_sourced_candidates(job_id, signal_candidate_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_sourced_candidates_org_job_idx ON job_sourced_candidates(organization_id, job_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_sourced_candidates_request_idx ON job_sourced_candidates(request_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_sourced_candidates_state_idx ON job_sourced_candidates(state);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_sourced_candidates_fit_score_idx ON job_sourced_candidates(fit_score);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS job_sourced_candidates_source_type_idx ON job_sourced_candidates(source_type);`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS job_sourced_candidates_id_org_job_idx ON job_sourced_candidates(id, organization_id, job_id);`);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS job_sourced_candidates_email_resolution_due_idx
    ON job_sourced_candidates(email_resolve_next_attempt_at, id)
    WHERE email_resolve_status = 'pending';
  `);
  await execSafe(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'job_sourced_candidates_email_resolve_attempts_nonnegative'
          AND conrelid = 'job_sourced_candidates'::regclass
      ) THEN
        ALTER TABLE job_sourced_candidates
          ADD CONSTRAINT job_sourced_candidates_email_resolve_attempts_nonnegative
          CHECK (email_resolve_attempts >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
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
  `);

  console.log('  Creating sourced_candidate_outreach_campaigns table...');
  await execSafe(sql`
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
  `);
  await execSafe(sql`DROP INDEX IF EXISTS scoc_job_round_idx;`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS scoc_job_round_idx ON sourced_candidate_outreach_campaigns(job_id, round);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS scoc_job_idx ON sourced_candidate_outreach_campaigns(job_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS scoc_org_idx ON sourced_candidate_outreach_campaigns(organization_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS scoc_launched_by_idx ON sourced_candidate_outreach_campaigns(launched_by);`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS campaign_id TEXT;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS round INTEGER;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS audience_count INTEGER NOT NULL DEFAULT 0;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS sent_count INTEGER NOT NULL DEFAULT 0;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS failed_count INTEGER NOT NULL DEFAULT 0;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS subject_template TEXT;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS html_body_template TEXT;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS extra_context TEXT;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS launched_by INTEGER REFERENCES users(id);`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS launched_at TIMESTAMP DEFAULT NOW();`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_campaigns ALTER COLUMN campaign_id SET NOT NULL;`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS scoc_campaign_id_idx ON sourced_candidate_outreach_campaigns(campaign_id);`);

  console.log('  Creating sourced_candidate_outreach_log table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS sourced_candidate_outreach_log (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      sourced_candidate_id INTEGER NOT NULL REFERENCES job_sourced_candidates(id) ON DELETE CASCADE,
      campaign_id TEXT,
      campaign_round INTEGER,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      body_html TEXT,
      ai_draft_body TEXT,
      ai_draft_subject TEXT,
      was_edited BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL,
      delivery_key TEXT,
      delivery_id TEXT,
      provider_message_id TEXT,
      delivery_status TEXT,
      delivery_event_at TIMESTAMP,
      error_message TEXT,
      sent_by INTEGER NOT NULL REFERENCES users(id),
      sent_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_log ADD COLUMN IF NOT EXISTS campaign_round INTEGER;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_log ADD COLUMN IF NOT EXISTS body_html TEXT;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_log ADD COLUMN IF NOT EXISTS delivery_key TEXT;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_log ADD COLUMN IF NOT EXISTS delivery_id TEXT;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_log ADD COLUMN IF NOT EXISTS provider_message_id TEXT;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_log ADD COLUMN IF NOT EXISTS delivery_status TEXT;`);
  await execSafe(sql`ALTER TABLE sourced_candidate_outreach_log ADD COLUMN IF NOT EXISTS delivery_event_at TIMESTAMP;`);
  await execSafe(sql`
    UPDATE sourced_candidate_outreach_log
    SET delivery_status = CASE WHEN status = 'sent' THEN 'accepted' ELSE status END
    WHERE delivery_status IS NULL;
  `);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS scol_job_idx ON sourced_candidate_outreach_log(job_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS scol_candidate_idx ON sourced_candidate_outreach_log(sourced_candidate_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS scol_campaign_idx ON sourced_candidate_outreach_log(campaign_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS scol_org_idx ON sourced_candidate_outreach_log(organization_id);`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS scol_delivery_key_idx ON sourced_candidate_outreach_log(delivery_key);`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS scol_delivery_id_idx ON sourced_candidate_outreach_log(delivery_id);`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS scol_provider_message_idx ON sourced_candidate_outreach_log(provider_message_id);`);

  console.log('  Creating outreach_delivery_correlations table...');
  await execSafe(sql`
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
  `);
  await execSafe(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_delivery_correlations_delivery_idx
    ON outreach_delivery_correlations(provider, delivery_id);
  `);
  await execSafe(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_delivery_correlations_message_idx
    ON outreach_delivery_correlations(provider, provider_message_id)
    WHERE provider_message_id IS NOT NULL;
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS outreach_delivery_correlations_email_idx
    ON outreach_delivery_correlations(email_hash);
  `);
  await execSafe(sql`
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
  `);
  await execSafe(sql`
    INSERT INTO outreach_delivery_correlations (
      provider, delivery_id, provider_message_id, organization_id,
      sourced_candidate_id, signal_tenant_id, signal_candidate_id, email_hash,
      source_outreach_log_id, created_at, updated_at
    )
    SELECT
      'brevo',
      COALESCE(NULLIF(btrim(log.delivery_id), ''), 'legacy-log:' || log.id::text),
      NULLIF(lower(btrim(log.provider_message_id, '<> ')), ''),
      log.organization_id,
      log.sourced_candidate_id, org.signal_tenant_id, candidate.signal_candidate_id,
      encode(sha256(convert_to(lower(btrim(log.recipient_email)), 'UTF8')), 'hex'),
      log.id, COALESCE(log.sent_at, NOW()), NOW()
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
  `);

  console.log('  Creating outreach_org_suppressions table...');
  await execSafe(sql`
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
      CONSTRAINT outreach_org_suppressions_reason_check CHECK (reason = 'unsubscribe')
    );
  `);
  await execSafe(sql`ALTER TABLE outreach_org_suppressions ADD COLUMN IF NOT EXISTS signal_candidate_id TEXT;`);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS outreach_org_suppressions_org_email_idx ON outreach_org_suppressions(organization_id, email_hash);`);
  await execSafe(sql`DROP INDEX IF EXISTS outreach_org_suppressions_org_candidate_idx;`);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS outreach_org_suppressions_org_candidate_lookup_idx
    ON outreach_org_suppressions(organization_id, signal_candidate_id)
    WHERE signal_candidate_id IS NOT NULL;
  `);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS outreach_org_suppressions_provider_event_idx ON outreach_org_suppressions(provider_event_id);`);

  console.log('  Creating outreach_hygiene_intents table...');
  await execSafe(sql`
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
        CHECK ((status = 'dead_letter') = (dead_lettered_at IS NOT NULL))
    );
  `);
  await execSafe(sql`
    ALTER TABLE outreach_hygiene_intents
    ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMP;
  `);
  await execSafe(sql`
    ALTER TABLE outreach_hygiene_intents
    DROP CONSTRAINT IF EXISTS outreach_hygiene_intents_source_outreach_log_id_fkey;
  `);
  await execSafe(sql`
    ALTER TABLE outreach_hygiene_intents
    DROP CONSTRAINT IF EXISTS outreach_hygiene_intents_status_check;
  `);
  await execSafe(sql`
    ALTER TABLE outreach_hygiene_intents
    ADD CONSTRAINT outreach_hygiene_intents_status_check
    CHECK (status IN ('pending', 'processing', 'synced', 'dead_letter'));
  `);
  await execSafe(sql`
    ALTER TABLE outreach_hygiene_intents
    DROP CONSTRAINT IF EXISTS outreach_hygiene_intents_dead_letter_pair_check;
  `);
  await execSafe(sql`
    ALTER TABLE outreach_hygiene_intents
    ADD CONSTRAINT outreach_hygiene_intents_dead_letter_pair_check
    CHECK ((status = 'dead_letter') = (dead_lettered_at IS NOT NULL));
  `);
  await execSafe(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS outreach_hygiene_intents_provider_event_idx
    ON outreach_hygiene_intents(provider, provider_event_id);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS outreach_hygiene_intents_due_idx
    ON outreach_hygiene_intents(status, next_attempt_at);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS outreach_hygiene_intents_email_idx
    ON outreach_hygiene_intents(email_hash);
  `);
  await execSafe(sql`
    CREATE INDEX IF NOT EXISTS outreach_hygiene_intents_pending_complaint_idx
    ON outreach_hygiene_intents(status)
    WHERE reason = 'complaint' AND status <> 'synced';
  `);

  console.log('  Creating candidate_outreach_schedules table...');
  await execSafe(sql`
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
  `);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS candidate_outreach_schedules_candidate_idx ON candidate_outreach_schedules(sourced_candidate_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS candidate_outreach_schedules_due_idx ON candidate_outreach_schedules(status, due_at);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS candidate_outreach_schedules_org_job_idx ON candidate_outreach_schedules(organization_id, job_id);`);
  await execSafe(sql`
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
  `);

  // Scheduled outreach campaigns (auto-send rounds 2 & 3 after 3-day intervals)
  console.log('  Creating scheduled_outreach_campaigns table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS scheduled_outreach_campaigns (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      round INTEGER NOT NULL CHECK (round BETWEEN 2 AND 3),
      scheduled_at TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      triggered_by INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMP,
      result_campaign_id TEXT,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT uq_scheduled_job_round UNIQUE (job_id, round)
    );
  `);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS soc_status_scheduled_idx ON scheduled_outreach_campaigns(status, scheduled_at);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS soc_job_idx ON scheduled_outreach_campaigns(job_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS soc_org_idx ON scheduled_outreach_campaigns(organization_id);`);
  await execSafe(sql`
    INSERT INTO candidate_outreach_schedules (
      organization_id, job_id, sourced_candidate_id, next_round, due_at, status, triggered_by
    )
    SELECT
      soc.organization_id, soc.job_id, jsc.id, soc.round, soc.scheduled_at, 'pending', soc.triggered_by
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
  `);
  await execSafe(sql`UPDATE scheduled_outreach_campaigns SET status = 'cancelled' WHERE status = 'pending';`);

  // ActiveKG Graph Sync: Application resume sync jobs
  console.log('  Creating application_graph_sync_jobs table...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS application_graph_sync_jobs (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE UNIQUE,
      organization_id INTEGER REFERENCES organizations(id),
      job_id INTEGER NOT NULL REFERENCES jobs(id),
      effective_recruiter_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_error TEXT,
      activekg_tenant_id TEXT NOT NULL,
      activekg_parent_node_id TEXT,
      chunk_count INTEGER,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  console.log('  Creating application_graph_sync_jobs indexes...');
  await execSafe(sql`CREATE INDEX IF NOT EXISTS app_graph_sync_status_next_attempt_idx ON application_graph_sync_jobs(status, next_attempt_at);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS app_graph_sync_org_idx ON application_graph_sync_jobs(organization_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS app_graph_sync_recruiter_idx ON application_graph_sync_jobs(effective_recruiter_id);`);

  console.log('  Creating resume import staging tables...');
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS resume_import_batches (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'queued',
      file_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      ready_count INTEGER NOT NULL DEFAULT 0,
      needs_review_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS resume_import_items (
      id SERIAL PRIMARY KEY,
      batch_id INTEGER NOT NULL REFERENCES resume_import_batches(id) ON DELETE CASCADE,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      uploaded_by_user_id INTEGER NOT NULL REFERENCES users(id),
      original_filename TEXT NOT NULL,
      gcs_path TEXT,
      content_hash TEXT,
      extracted_text TEXT,
      extraction_method TEXT NOT NULL DEFAULT 'failed',
      parsed_name TEXT,
      parsed_email TEXT,
      parsed_phone TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error_reason TEXT,
      application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
      source_metadata JSONB,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_processed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS resume_import_batches_org_job_idx ON resume_import_batches(organization_id, job_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS resume_import_batches_uploader_idx ON resume_import_batches(uploaded_by_user_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS resume_import_batches_status_idx ON resume_import_batches(status);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS resume_import_items_batch_idx ON resume_import_items(batch_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS resume_import_items_status_attempt_idx ON resume_import_items(status, next_attempt_at);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS resume_import_items_batch_status_idx ON resume_import_items(batch_id, status);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS resume_import_items_job_email_idx ON resume_import_items(job_id, parsed_email);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS resume_import_items_content_hash_idx ON resume_import_items(batch_id, content_hash);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS resume_import_items_application_idx ON resume_import_items(application_id);`);
  await execSafe(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS resume_import_items_batch_content_hash_unique
    ON resume_import_items(batch_id, content_hash)
    WHERE content_hash IS NOT NULL;
  `);

  // Migration 005: Add sync_skipped_reason to applications
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS sync_skipped_reason TEXT;`);

  // Migration 006: Recruiter feedback events + platform discovery consent
  await execSafe(sql`
    CREATE TABLE IF NOT EXISTS recruiter_feedback_events (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      signal_candidate_id TEXT NOT NULL,
      action TEXT NOT NULL,
      event_id TEXT NOT NULL UNIQUE,
      rank_at_time INTEGER,
      fit_score_at_time INTEGER,
      source_type_at_time TEXT,
      match_tier_at_time TEXT,
      location_match_at_time TEXT,
      role_family TEXT,
      location_country_code TEXT,
      seniority_band TEXT,
      synced_to_signal_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await execSafe(sql`CREATE UNIQUE INDEX IF NOT EXISTS rfb_event_id_idx ON recruiter_feedback_events(event_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS rfb_org_job_idx ON recruiter_feedback_events(organization_id, job_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS rfb_candidate_idx ON recruiter_feedback_events(signal_candidate_id);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS rfb_action_idx ON recruiter_feedback_events(action);`);
  await execSafe(sql`CREATE INDEX IF NOT EXISTS rfb_unsynced_idx ON recruiter_feedback_events(synced_to_signal_at);`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS platform_discovery_consent BOOLEAN DEFAULT FALSE;`);
  await execSafe(sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS consent_captured_at TIMESTAMP;`);

  if (bootstrapFailures > 0) {
    throw new Error(
      `ATS schema migration failed for ${bootstrapFailures} statement(s); transaction rolled back`,
    );
  }

  });

  console.log('✅ ATS schema ready');
}
