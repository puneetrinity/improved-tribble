-- Flow immutable exact-catalog baseline (Gate 1A0-F / 1A0-P).
-- Deployed source: 926c1d56eb965265a480b911e390164886386cc7
-- Baseline-authoritative catalog SHA-256: 6c80a60c9364543e1b01b20d339bd5fe4a49d2c5354c5d107fb6349643916546
-- Stable semantic catalog-lock SHA-256: 999636b7722cc305b10f71b9a096cc75701400ff49aea91435f839cadf13b90c
-- Generated mechanically from the protected lossless catalog artifact; no application rows.
-- Production adoption MUST NOT execute this file; it records version 0000 only after exact comparison.

SET LOCAL search_path = public, pg_catalog;
CREATE EXTENSION IF NOT EXISTS plpgsql WITH SCHEMA pg_catalog;

-- Sequences precede tables because serial-style column defaults reference them.
CREATE SEQUENCE "public"."ai_fit_jobs_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."application_feedback_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."application_graph_sync_jobs_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."application_stage_history_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."applications_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."automation_events_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."automation_settings_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."candidate_outreach_schedules_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."candidate_resumes_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."checkout_intents_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."client_feedback_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."client_shortlist_items_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."client_shortlists_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."clients_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."co_recruiter_invitations_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."consultants_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."contact_submissions_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."domain_claim_requests_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."email_audit_log_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."email_templates_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."form_fields_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."form_invitations_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."form_response_answers_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."form_responses_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."forms_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."hiring_manager_invitations_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."job_analytics_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."job_audit_log_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."job_recruiters_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."job_sourced_candidates_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."job_sourcing_runs_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."jobs_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."mautic_contact_links_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."organization_credit_balances_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."organization_credit_transactions_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."organization_invites_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."organization_join_requests_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."organization_members_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."organization_subscriptions_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."organizations_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."outreach_delivery_correlations_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."outreach_hygiene_intents_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."outreach_org_suppressions_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."payment_transactions_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."pipeline_stages_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."recruiter_feedback_events_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."resume_import_batches_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."resume_import_items_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."saved_jobs_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."scheduled_outreach_campaigns_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."sourced_candidate_outreach_campaigns_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."sourced_candidate_outreach_log_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."subscription_alerts_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."subscription_audit_log_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."subscription_plans_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."talent_pool_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."user_ai_usage_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."user_profiles_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."users_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."users_password_audit_id_seq"
  AS bigint
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 9223372036854775807
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."webhook_events_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."whatsapp_audit_log_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

CREATE SEQUENCE "public"."whatsapp_templates_id_seq"
  AS integer
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 2147483647
  START WITH 1
  CACHE 1
  NO CYCLE;

-- Tables and columns. Constraints are added after every table exists.
CREATE TABLE "public"."ai_fit_jobs" (
  "id" integer DEFAULT nextval('ai_fit_jobs_id_seq'::regclass) NOT NULL,
  "bull_job_id" text NOT NULL,
  "queue_name" text NOT NULL,
  "user_id" integer NOT NULL,
  "application_id" integer,
  "application_ids" integer[],
  "status" text DEFAULT 'pending'::text NOT NULL,
  "progress" integer DEFAULT 0,
  "processed_count" integer DEFAULT 0,
  "total_count" integer,
  "result" jsonb,
  "error" text,
  "error_code" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "started_at" timestamp without time zone,
  "completed_at" timestamp without time zone
);

CREATE TABLE "public"."application_feedback" (
  "id" integer DEFAULT nextval('application_feedback_id_seq'::regclass) NOT NULL,
  "application_id" integer NOT NULL,
  "author_id" integer NOT NULL,
  "overall_score" integer NOT NULL,
  "recommendation" text NOT NULL,
  "notes" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."application_graph_sync_jobs" (
  "id" integer DEFAULT nextval('application_graph_sync_jobs_id_seq'::regclass) NOT NULL,
  "application_id" integer NOT NULL,
  "organization_id" integer,
  "job_id" integer NOT NULL,
  "effective_recruiter_id" integer NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp without time zone DEFAULT now() NOT NULL,
  "last_error" text,
  "activekg_tenant_id" text NOT NULL,
  "activekg_parent_node_id" text,
  "chunk_count" integer,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."application_stage_history" (
  "id" integer DEFAULT nextval('application_stage_history_id_seq'::regclass) NOT NULL,
  "application_id" integer NOT NULL,
  "from_stage" integer,
  "to_stage" integer NOT NULL,
  "changed_by" integer NOT NULL,
  "notes" text,
  "changed_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."applications" (
  "id" integer DEFAULT nextval('applications_id_seq'::regclass) NOT NULL,
  "job_id" integer NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text NOT NULL,
  "resume_url" text NOT NULL,
  "cover_letter" text,
  "status" text DEFAULT 'submitted'::text NOT NULL,
  "notes" text,
  "last_viewed_at" timestamp without time zone,
  "downloaded_at" timestamp without time zone,
  "applied_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "current_stage" integer,
  "interview_date" timestamp without time zone,
  "interview_time" text,
  "interview_location" text,
  "interview_notes" text,
  "recruiter_notes" text[],
  "rating" integer,
  "tags" text[],
  "stage_changed_at" timestamp without time zone,
  "stage_changed_by" integer,
  "user_id" integer,
  "resume_filename" text,
  "submitted_by_recruiter" boolean DEFAULT false,
  "created_by_user_id" integer,
  "source" text DEFAULT 'public_apply'::text,
  "source_metadata" jsonb,
  "ai_fit_score" integer,
  "ai_fit_label" text,
  "ai_fit_reasons" jsonb,
  "ai_model_version" text,
  "ai_computed_at" timestamp without time zone,
  "ai_stale_reason" text,
  "ai_digest_version_used" integer,
  "resume_id" integer,
  "ai_summary" text,
  "ai_summary_version" integer DEFAULT 1,
  "ai_suggested_action" text,
  "ai_summary_computed_at" timestamp without time zone,
  "ai_suggested_action_reason" text,
  "rejection_reason" text,
  "whatsapp_consent" boolean DEFAULT true NOT NULL,
  "extracted_resume_text" text,
  "ai_summary_model_version" text,
  "ai_strengths" text[],
  "ai_concerns" text[],
  "ai_key_highlights" text[],
  "ai_required_skills_matched" text[],
  "ai_required_skills_missing" text[],
  "ai_required_skills_match_percentage" integer,
  "ai_required_skills_depth_notes" text,
  "ai_good_to_have_skills_matched" text[],
  "ai_good_to_have_skills_missing" text[],
  "organization_id" integer,
  "sync_skipped_reason" text,
  "platform_discovery_consent" boolean DEFAULT false,
  "consent_captured_at" timestamp without time zone,
  "hm_review_requested_at" timestamp without time zone,
  "hm_review_requested_by" integer,
  "hm_review_note" text
);

CREATE TABLE "public"."automation_events" (
  "id" integer DEFAULT nextval('automation_events_id_seq'::regclass) NOT NULL,
  "automation_key" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" integer NOT NULL,
  "outcome" text DEFAULT 'success'::text NOT NULL,
  "error_message" text,
  "metadata" jsonb,
  "triggered_at" timestamp without time zone DEFAULT now() NOT NULL,
  "triggered_by" integer,
  "organization_id" integer
);

CREATE TABLE "public"."automation_settings" (
  "id" integer DEFAULT nextval('automation_settings_id_seq'::regclass) NOT NULL,
  "setting_key" text NOT NULL,
  "setting_value" boolean DEFAULT true NOT NULL,
  "description" text,
  "updated_by" integer,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."candidate_outreach_schedules" (
  "id" integer DEFAULT nextval('candidate_outreach_schedules_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "sourced_candidate_id" integer NOT NULL,
  "next_round" integer NOT NULL,
  "due_at" timestamp without time zone NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "triggered_by" integer NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."candidate_resumes" (
  "id" integer DEFAULT nextval('candidate_resumes_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "label" text NOT NULL,
  "gcs_path" text NOT NULL,
  "extracted_text" text,
  "is_default" boolean DEFAULT false,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."checkout_intents" (
  "id" integer DEFAULT nextval('checkout_intents_id_seq'::regclass) NOT NULL,
  "email" text NOT NULL,
  "org_name" text NOT NULL,
  "user_id" integer,
  "organization_id" integer,
  "plan_id" integer NOT NULL,
  "seats" integer DEFAULT 1 NOT NULL,
  "billing_cycle" text DEFAULT 'monthly'::text NOT NULL,
  "gstin" text,
  "billing_name" text,
  "billing_address" text,
  "billing_city" text,
  "billing_state" text,
  "billing_pincode" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "cashfree_order_id" text,
  "claim_token" text,
  "claimed_at" timestamp without time zone,
  "claimed_by" integer,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp without time zone NOT NULL,
  "paid_at" timestamp without time zone
);

CREATE TABLE "public"."client_feedback" (
  "id" integer DEFAULT nextval('client_feedback_id_seq'::regclass) NOT NULL,
  "application_id" integer NOT NULL,
  "client_id" integer NOT NULL,
  "shortlist_id" integer,
  "recommendation" text NOT NULL,
  "notes" text,
  "rating" integer,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."client_shortlist_items" (
  "id" integer DEFAULT nextval('client_shortlist_items_id_seq'::regclass) NOT NULL,
  "shortlist_id" integer NOT NULL,
  "application_id" integer NOT NULL,
  "position" integer NOT NULL,
  "notes" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."client_shortlists" (
  "id" integer DEFAULT nextval('client_shortlists_id_seq'::regclass) NOT NULL,
  "client_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "token" text NOT NULL,
  "created_by" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp without time zone,
  "status" text DEFAULT 'active'::text NOT NULL,
  "title" text,
  "message" text,
  "organization_id" integer
);

CREATE TABLE "public"."clients" (
  "id" integer DEFAULT nextval('clients_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "domain" text,
  "primary_contact_name" text,
  "primary_contact_email" text,
  "notes" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "created_by" integer NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."co_recruiter_invitations" (
  "id" integer DEFAULT nextval('co_recruiter_invitations_id_seq'::regclass) NOT NULL,
  "job_id" integer NOT NULL,
  "email" text NOT NULL,
  "token" text NOT NULL,
  "invited_by" integer NOT NULL,
  "inviter_name" text,
  "job_title" text,
  "expires_at" timestamp without time zone NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "accepted_at" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."consultants" (
  "id" integer DEFAULT nextval('consultants_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "experience" text NOT NULL,
  "linkedin_url" text,
  "domains" text NOT NULL,
  "description" text,
  "photo_url" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."contact_submissions" (
  "id" integer DEFAULT nextval('contact_submissions_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "company" text,
  "location" text,
  "message" text NOT NULL,
  "submitted_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."domain_claim_requests" (
  "id" integer DEFAULT nextval('domain_claim_requests_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "domain" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "requested_by" integer NOT NULL,
  "requested_at" timestamp without time zone DEFAULT now() NOT NULL,
  "reviewed_by" integer,
  "reviewed_at" timestamp without time zone,
  "rejection_reason" text
);

CREATE TABLE "public"."email_audit_log" (
  "id" integer DEFAULT nextval('email_audit_log_id_seq'::regclass) NOT NULL,
  "application_id" integer,
  "template_id" integer,
  "template_type" text,
  "recipient_email" text NOT NULL,
  "subject" text NOT NULL,
  "sent_at" timestamp without time zone DEFAULT now() NOT NULL,
  "sent_by" integer,
  "status" text DEFAULT 'success'::text NOT NULL,
  "error_message" text,
  "preview_url" text
);

CREATE TABLE "public"."email_templates" (
  "id" integer DEFAULT nextval('email_templates_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "template_type" text NOT NULL,
  "created_by" integer,
  "is_default" boolean DEFAULT false,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."form_fields" (
  "id" integer DEFAULT nextval('form_fields_id_seq'::regclass) NOT NULL,
  "form_id" integer NOT NULL,
  "type" text NOT NULL,
  "label" text NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "options" text,
  "order" integer NOT NULL
);

CREATE TABLE "public"."form_invitations" (
  "id" integer DEFAULT nextval('form_invitations_id_seq'::regclass) NOT NULL,
  "application_id" integer,
  "form_id" integer NOT NULL,
  "token" text NOT NULL,
  "expires_at" timestamp without time zone NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "sent_by" integer NOT NULL,
  "sent_at" timestamp without time zone,
  "viewed_at" timestamp without time zone,
  "answered_at" timestamp without time zone,
  "field_snapshot" text NOT NULL,
  "custom_message" text,
  "reminder_sent_at" timestamp without time zone,
  "error_message" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "email" text,
  "candidate_name" text,
  "job_id" integer,
  "organization_id" integer
);

CREATE TABLE "public"."form_response_answers" (
  "id" integer DEFAULT nextval('form_response_answers_id_seq'::regclass) NOT NULL,
  "response_id" integer NOT NULL,
  "field_id" integer NOT NULL,
  "value" text,
  "file_url" text
);

CREATE TABLE "public"."form_responses" (
  "id" integer DEFAULT nextval('form_responses_id_seq'::regclass) NOT NULL,
  "invitation_id" integer NOT NULL,
  "application_id" integer NOT NULL,
  "submitted_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."forms" (
  "id" integer DEFAULT nextval('forms_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_published" boolean DEFAULT true NOT NULL,
  "created_by" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."hiring_manager_invitations" (
  "id" integer DEFAULT nextval('hiring_manager_invitations_id_seq'::regclass) NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "token" text NOT NULL,
  "invited_by" integer NOT NULL,
  "inviter_name" text,
  "expires_at" timestamp without time zone NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "accepted_at" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."job_analytics" (
  "id" integer DEFAULT nextval('job_analytics_id_seq'::regclass) NOT NULL,
  "job_id" integer NOT NULL,
  "views" integer DEFAULT 0 NOT NULL,
  "apply_clicks" integer DEFAULT 0 NOT NULL,
  "conversion_rate" numeric(5,2) DEFAULT 0.00,
  "ai_score_cache" integer,
  "ai_model_version" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."job_audit_log" (
  "id" integer DEFAULT nextval('job_audit_log_id_seq'::regclass) NOT NULL,
  "job_id" integer NOT NULL,
  "action" text NOT NULL,
  "performed_by" integer NOT NULL,
  "reason" text,
  "metadata" jsonb,
  "timestamp" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."job_recruiters" (
  "id" integer DEFAULT nextval('job_recruiters_id_seq'::regclass) NOT NULL,
  "job_id" integer NOT NULL,
  "recruiter_id" integer NOT NULL,
  "added_by" integer,
  "added_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."job_sourced_candidates" (
  "id" integer DEFAULT nextval('job_sourced_candidates_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "request_id" text NOT NULL,
  "signal_candidate_id" text NOT NULL,
  "fit_score" integer,
  "fit_breakdown" jsonb,
  "source_type" text NOT NULL,
  "state" text DEFAULT 'new'::text NOT NULL,
  "candidate_summary" jsonb,
  "converted_application_id" integer,
  "last_synced_at" timestamp without time zone DEFAULT now() NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "found_email" text,
  "found_emails" jsonb,
  "email_resolved_at" timestamp without time zone,
  "email_resolve_status" text,
  "outreach_count" integer DEFAULT 0 NOT NULL,
  "last_outreach_round" integer,
  "last_outreach_campaign_id" text,
  "last_outreach_at" timestamp without time zone,
  "last_outreach_status" text,
  "applied_at" timestamp without time zone,
  "applied_from_campaign_id" text,
  "applied_after_round" integer,
  "email_resolve_attempts" integer DEFAULT 0 NOT NULL,
  "email_resolve_next_attempt_at" timestamp without time zone,
  "email_resolve_lease_token" text,
  "email_resolve_lease_expires_at" timestamp without time zone,
  "email_resolve_last_error_code" text
);

CREATE TABLE "public"."job_sourcing_runs" (
  "id" integer DEFAULT nextval('job_sourcing_runs_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "request_id" text NOT NULL,
  "external_job_id" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "context_hash" text NOT NULL,
  "callback_url" text,
  "meta" jsonb,
  "error_message" text,
  "candidate_count" integer DEFAULT 0,
  "expires_at" timestamp without time zone,
  "submitted_at" timestamp without time zone,
  "completed_at" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."jobs" (
  "id" integer DEFAULT nextval('jobs_id_seq'::regclass) NOT NULL,
  "title" text NOT NULL,
  "location" text NOT NULL,
  "type" text NOT NULL,
  "description" text NOT NULL,
  "skills" text[],
  "deadline" date,
  "posted_by" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "review_comments" text,
  "expires_at" timestamp without time zone,
  "reviewed_by" integer,
  "reviewed_at" timestamp without time zone,
  "slug" text,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "deactivated_at" timestamp without time zone,
  "reactivated_at" timestamp without time zone,
  "reactivation_count" integer DEFAULT 0 NOT NULL,
  "deactivation_reason" text,
  "warning_email_sent" boolean DEFAULT false NOT NULL,
  "jd_digest" jsonb,
  "jd_digest_version" integer DEFAULT 1,
  "client_id" integer,
  "hiring_manager_id" integer,
  "salary_min" integer,
  "salary_max" integer,
  "salary_period" text,
  "good_to_have_skills" text[],
  "education_requirement" text,
  "experience_years" integer,
  "organization_id" integer,
  "original_jd" text,
  "experience_years_max" integer
);

CREATE TABLE "public"."mautic_contact_links" (
  "id" integer DEFAULT nextval('mautic_contact_links_id_seq'::regclass) NOT NULL,
  "user_id" integer,
  "organization_id" integer,
  "email" text NOT NULL,
  "mautic_contact_id" integer,
  "last_known_segment_id" integer,
  "first_login_synced_at" timestamp without time zone,
  "first_job_created_synced_at" timestamp without time zone,
  "last_synced_at" timestamp without time zone,
  "last_error" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."organization_credit_balances" (
  "id" integer DEFAULT nextval('organization_credit_balances_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "recurring_allocated" integer DEFAULT 0 NOT NULL,
  "recurring_used" integer DEFAULT 0 NOT NULL,
  "rollover_credits" integer DEFAULT 0 NOT NULL,
  "purchased_credits" integer DEFAULT 0 NOT NULL,
  "purchased_used" integer DEFAULT 0 NOT NULL,
  "period_start" timestamp without time zone,
  "period_end" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."organization_credit_transactions" (
  "id" integer DEFAULT nextval('organization_credit_transactions_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "user_id" integer,
  "type" text NOT NULL,
  "amount" integer NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."organization_invites" (
  "id" integer DEFAULT nextval('organization_invites_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "email" text NOT NULL,
  "role" text DEFAULT 'member'::text NOT NULL,
  "token" text NOT NULL,
  "expires_at" timestamp without time zone NOT NULL,
  "invited_by" integer NOT NULL,
  "accepted_at" timestamp without time zone,
  "accepted_by" integer,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."organization_join_requests" (
  "id" integer DEFAULT nextval('organization_join_requests_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "requested_at" timestamp without time zone DEFAULT now() NOT NULL,
  "responded_at" timestamp without time zone,
  "responded_by" integer,
  "rejection_reason" text
);

CREATE TABLE "public"."organization_members" (
  "id" integer DEFAULT nextval('organization_members_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "role" text DEFAULT 'member'::text NOT NULL,
  "seat_assigned" boolean DEFAULT true NOT NULL,
  "last_activity_at" timestamp without time zone,
  "credits_allocated" integer DEFAULT 0 NOT NULL,
  "credits_used" integer DEFAULT 0 NOT NULL,
  "credits_rollover" integer DEFAULT 0 NOT NULL,
  "credits_period_start" timestamp without time zone,
  "credits_period_end" timestamp without time zone,
  "joined_at" timestamp without time zone DEFAULT now() NOT NULL,
  "invited_by" integer
);

CREATE TABLE "public"."organization_subscriptions" (
  "id" integer DEFAULT nextval('organization_subscriptions_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "plan_id" integer NOT NULL,
  "seats" integer DEFAULT 1 NOT NULL,
  "billing_cycle" text NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "start_date" timestamp without time zone NOT NULL,
  "current_period_start" timestamp without time zone NOT NULL,
  "current_period_end" timestamp without time zone NOT NULL,
  "cancelled_at" timestamp without time zone,
  "cancel_at_period_end" boolean DEFAULT false,
  "cashfree_subscription_id" text,
  "cashfree_customer_id" text,
  "grace_period_end_date" timestamp without time zone,
  "payment_failure_count" integer DEFAULT 0,
  "admin_override" boolean DEFAULT false,
  "admin_override_reason" text,
  "admin_override_by" integer,
  "feature_overrides" jsonb,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "bonus_credits" integer DEFAULT 0,
  "bonus_credits_granted_at" timestamp without time zone,
  "bonus_credits_reason" text,
  "bonus_credits_granted_by" integer,
  "custom_credit_limit" integer,
  "paid_seats" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "public"."organizations" (
  "id" integer DEFAULT nextval('organizations_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "logo" text,
  "domain" text,
  "domain_verified" boolean DEFAULT false,
  "domain_approved_by" integer,
  "domain_approved_at" timestamp without time zone,
  "gstin" text,
  "billing_name" text,
  "billing_address" text,
  "billing_city" text,
  "billing_state" text,
  "billing_pincode" text,
  "billing_contact_email" text,
  "billing_contact_name" text,
  "settings" jsonb,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "signal_tenant_id" text
);

CREATE TABLE "public"."outreach_delivery_correlations" (
  "id" integer DEFAULT nextval('outreach_delivery_correlations_id_seq'::regclass) NOT NULL,
  "provider" text DEFAULT 'brevo'::text NOT NULL,
  "delivery_id" text NOT NULL,
  "provider_message_id" text,
  "organization_id" integer NOT NULL,
  "sourced_candidate_id" integer NOT NULL,
  "signal_tenant_id" text NOT NULL,
  "signal_candidate_id" text NOT NULL,
  "email_hash" text NOT NULL,
  "source_outreach_log_id" integer,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."outreach_hygiene_intents" (
  "id" integer DEFAULT nextval('outreach_hygiene_intents_id_seq'::regclass) NOT NULL,
  "provider" text DEFAULT 'brevo'::text NOT NULL,
  "provider_event_id" text NOT NULL,
  "organization_id" integer NOT NULL,
  "sourced_candidate_id" integer NOT NULL,
  "signal_tenant_id" text NOT NULL,
  "signal_candidate_id" text NOT NULL,
  "source_outreach_log_id" integer,
  "email_hash" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp without time zone DEFAULT now() NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp without time zone,
  "last_error" text,
  "memory_global_candidate_id" text,
  "synced_at" timestamp without time zone,
  "dead_lettered_at" timestamp without time zone,
  "replay_count" integer DEFAULT 0 NOT NULL,
  "replay_release" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."outreach_org_suppressions" (
  "id" integer DEFAULT nextval('outreach_org_suppressions_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "email_hash" text NOT NULL,
  "signal_candidate_id" text,
  "reason" text DEFAULT 'unsubscribe'::text NOT NULL,
  "source_outreach_log_id" integer,
  "provider_event_id" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."payment_transactions" (
  "id" integer DEFAULT nextval('payment_transactions_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "subscription_id" integer,
  "type" text NOT NULL,
  "amount" integer NOT NULL,
  "tax_amount" integer DEFAULT 0 NOT NULL,
  "total_amount" integer NOT NULL,
  "currency" text DEFAULT 'INR'::text NOT NULL,
  "status" text NOT NULL,
  "cashfree_order_id" text,
  "cashfree_payment_id" text,
  "cashfree_payment_method" text,
  "metadata" jsonb,
  "failure_reason" text,
  "invoice_number" text,
  "invoice_url" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp without time zone
);

CREATE TABLE "public"."pipeline_stages" (
  "id" integer DEFAULT nextval('pipeline_stages_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "order" integer NOT NULL,
  "color" text DEFAULT '#3b82f6'::text,
  "is_default" boolean DEFAULT false,
  "created_by" integer,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."recruiter_feedback_events" (
  "id" integer DEFAULT nextval('recruiter_feedback_events_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "user_id" integer,
  "signal_candidate_id" text NOT NULL,
  "action" text NOT NULL,
  "event_id" text NOT NULL,
  "rank_at_time" integer,
  "fit_score_at_time" integer,
  "source_type_at_time" text,
  "match_tier_at_time" text,
  "location_match_at_time" text,
  "role_family" text,
  "location_country_code" text,
  "seniority_band" text,
  "synced_to_signal_at" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."resume_import_batches" (
  "id" integer DEFAULT nextval('resume_import_batches_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "uploaded_by_user_id" integer NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "file_count" integer DEFAULT 0 NOT NULL,
  "processed_count" integer DEFAULT 0 NOT NULL,
  "ready_count" integer DEFAULT 0 NOT NULL,
  "needs_review_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."resume_import_items" (
  "id" integer DEFAULT nextval('resume_import_items_id_seq'::regclass) NOT NULL,
  "batch_id" integer NOT NULL,
  "organization_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "uploaded_by_user_id" integer NOT NULL,
  "original_filename" text NOT NULL,
  "gcs_path" text,
  "content_hash" text,
  "extracted_text" text,
  "extraction_method" text DEFAULT 'failed'::text NOT NULL,
  "parsed_name" text,
  "parsed_email" text,
  "parsed_phone" text,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "error_reason" text,
  "application_id" integer,
  "source_metadata" jsonb,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp without time zone DEFAULT now() NOT NULL,
  "last_processed_at" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."saved_jobs" (
  "id" integer DEFAULT nextval('saved_jobs_id_seq'::regclass) NOT NULL,
  "candidate_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."scheduled_outreach_campaigns" (
  "id" integer DEFAULT nextval('scheduled_outreach_campaigns_id_seq'::regclass) NOT NULL,
  "job_id" integer NOT NULL,
  "organization_id" integer NOT NULL,
  "round" integer NOT NULL,
  "scheduled_at" timestamp without time zone NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "triggered_by" integer NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp without time zone,
  "result_campaign_id" text,
  "sent_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "public"."session" (
  "sid" character varying NOT NULL,
  "sess" json NOT NULL,
  "expire" timestamp(6) without time zone NOT NULL
);

CREATE TABLE "public"."sourced_candidate_outreach_campaigns" (
  "id" integer DEFAULT nextval('sourced_candidate_outreach_campaigns_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "campaign_id" text NOT NULL,
  "round" integer NOT NULL,
  "status" text DEFAULT 'completed'::text NOT NULL,
  "audience_count" integer DEFAULT 0 NOT NULL,
  "sent_count" integer DEFAULT 0 NOT NULL,
  "failed_count" integer DEFAULT 0 NOT NULL,
  "subject_template" text,
  "html_body_template" text,
  "extra_context" text,
  "launched_by" integer NOT NULL,
  "launched_at" timestamp without time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp without time zone
);

CREATE TABLE "public"."sourced_candidate_outreach_log" (
  "id" integer DEFAULT nextval('sourced_candidate_outreach_log_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "job_id" integer NOT NULL,
  "sourced_candidate_id" integer NOT NULL,
  "campaign_id" text,
  "campaign_round" integer,
  "recipient_email" text NOT NULL,
  "recipient_name" text,
  "subject" text NOT NULL,
  "body" text NOT NULL,
  "body_html" text,
  "ai_draft_body" text,
  "ai_draft_subject" text,
  "was_edited" boolean DEFAULT false NOT NULL,
  "status" text NOT NULL,
  "error_message" text,
  "sent_by" integer NOT NULL,
  "sent_at" timestamp without time zone DEFAULT now() NOT NULL,
  "delivery_key" text,
  "delivery_id" text,
  "provider_message_id" text,
  "delivery_status" text,
  "delivery_event_at" timestamp without time zone
);

CREATE TABLE "public"."subscription_alerts" (
  "id" integer DEFAULT nextval('subscription_alerts_id_seq'::regclass) NOT NULL,
  "subscription_id" integer NOT NULL,
  "alert_type" text NOT NULL,
  "sent_at" timestamp without time zone DEFAULT now() NOT NULL,
  "recipient_email" text NOT NULL,
  "email_status" text DEFAULT 'sent'::text NOT NULL
);

CREATE TABLE "public"."subscription_audit_log" (
  "id" integer DEFAULT nextval('subscription_audit_log_id_seq'::regclass) NOT NULL,
  "organization_id" integer NOT NULL,
  "subscription_id" integer,
  "action" text NOT NULL,
  "previous_value" jsonb,
  "new_value" jsonb,
  "performed_by" integer,
  "performed_at" timestamp without time zone DEFAULT now() NOT NULL,
  "reason" text
);

CREATE TABLE "public"."subscription_plans" (
  "id" integer DEFAULT nextval('subscription_plans_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "display_name" text NOT NULL,
  "description" text,
  "price_per_seat_monthly" integer NOT NULL,
  "price_per_seat_annual" integer NOT NULL,
  "ai_credits_per_seat_monthly" integer NOT NULL,
  "max_credit_rollover_months" integer DEFAULT 3,
  "features" jsonb NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE "public"."talent_pool" (
  "id" integer DEFAULT nextval('talent_pool_id_seq'::regclass) NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "phone" text,
  "recruiter_id" integer NOT NULL,
  "source" text DEFAULT 'external_form'::text NOT NULL,
  "form_response_id" integer,
  "notes" text,
  "resume_url" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "organization_id" integer
);

CREATE TABLE "public"."user_ai_usage" (
  "id" integer DEFAULT nextval('user_ai_usage_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "kind" text NOT NULL,
  "tokens_in" integer NOT NULL,
  "tokens_out" integer NOT NULL,
  "cost_usd" numeric(10,8) NOT NULL,
  "computed_at" timestamp without time zone DEFAULT now() NOT NULL,
  "metadata" jsonb,
  "organization_id" integer
);

CREATE TABLE "public"."user_profiles" (
  "id" integer DEFAULT nextval('user_profiles_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "bio" text,
  "skills" text[],
  "linkedin" text,
  "location" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp without time zone DEFAULT now() NOT NULL,
  "display_name" text,
  "company" text,
  "photo_url" text,
  "is_public" boolean DEFAULT false,
  "phone" text,
  "public_id" text
);

CREATE TABLE "public"."users" (
  "id" integer DEFAULT nextval('users_id_seq'::regclass) NOT NULL,
  "username" text NOT NULL,
  "password" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "role" text DEFAULT 'candidate'::text NOT NULL,
  "ai_content_free_used" boolean DEFAULT false,
  "ai_onboarded_at" timestamp without time zone,
  "email_verified" boolean DEFAULT false,
  "email_verification_token" text,
  "email_verification_expires" timestamp without time zone,
  "password_reset_token" text,
  "password_reset_expires" timestamp without time zone,
  "profile_prompt_snooze_until" timestamp without time zone,
  "profile_completed_at" timestamp without time zone,
  "onboarding_completed_at" timestamp without time zone,
  "profile_skipped_at" timestamp without time zone
);

CREATE TABLE "public"."users_password_audit" (
  "id" bigint DEFAULT nextval('users_password_audit_id_seq'::regclass) NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "user_id" integer NOT NULL,
  "username" text NOT NULL,
  "old_hash_prefix" text,
  "new_hash_prefix" text,
  "db_user" text NOT NULL,
  "client_addr" inet,
  "client_port" integer,
  "application_name" text,
  "pid" integer
);

CREATE TABLE "public"."webhook_events" (
  "id" integer DEFAULT nextval('webhook_events_id_seq'::regclass) NOT NULL,
  "provider" text NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "processed_at" timestamp without time zone DEFAULT now() NOT NULL,
  "status" text NOT NULL,
  "error_message" text
);

CREATE TABLE "public"."whatsapp_audit_log" (
  "id" integer DEFAULT nextval('whatsapp_audit_log_id_seq'::regclass) NOT NULL,
  "application_id" integer,
  "template_id" integer,
  "template_type" text,
  "recipient_phone" text NOT NULL,
  "message_id" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "error_code" text,
  "error_message" text,
  "template_variables" jsonb,
  "sent_at" timestamp without time zone DEFAULT now() NOT NULL,
  "delivered_at" timestamp without time zone,
  "read_at" timestamp without time zone,
  "sent_by" integer
);

CREATE TABLE "public"."whatsapp_templates" (
  "id" integer DEFAULT nextval('whatsapp_templates_id_seq'::regclass) NOT NULL,
  "name" text NOT NULL,
  "meta_template_name" text NOT NULL,
  "meta_template_id" text,
  "language" text DEFAULT 'en'::text NOT NULL,
  "template_type" text NOT NULL,
  "category" text DEFAULT 'UTILITY'::text NOT NULL,
  "body_template" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "rejection_reason" text,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL
);

-- Named checks and primary/unique constraints.
ALTER TABLE ONLY "public"."candidate_outreach_schedules" ADD CONSTRAINT "candidate_outreach_schedules_attempt_count_check" CHECK (attempt_count >= 0);
ALTER TABLE ONLY "public"."candidate_outreach_schedules" ADD CONSTRAINT "candidate_outreach_schedules_next_round_check" CHECK (next_round >= 2 AND next_round <= 3);
ALTER TABLE ONLY "public"."candidate_outreach_schedules" ADD CONSTRAINT "candidate_outreach_schedules_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'sending'::text, 'completed'::text, 'cancelled'::text]));
ALTER TABLE ONLY "public"."job_sourced_candidates" ADD CONSTRAINT "job_sourced_candidates_email_resolve_attempts_nonnegative" CHECK (email_resolve_attempts >= 0);
ALTER TABLE ONLY "public"."job_sourced_candidates" ADD CONSTRAINT "job_sourced_candidates_email_resolve_lease_pair" CHECK (email_resolve_lease_token IS NULL AND email_resolve_lease_expires_at IS NULL OR email_resolve_lease_token IS NOT NULL AND email_resolve_lease_expires_at IS NOT NULL);
ALTER TABLE ONLY "public"."outreach_delivery_correlations" ADD CONSTRAINT "outreach_delivery_correlations_candidate_nonblank" CHECK (btrim(signal_candidate_id) <> ''::text);
ALTER TABLE ONLY "public"."outreach_delivery_correlations" ADD CONSTRAINT "outreach_delivery_correlations_delivery_nonblank" CHECK (btrim(delivery_id) <> ''::text);
ALTER TABLE ONLY "public"."outreach_delivery_correlations" ADD CONSTRAINT "outreach_delivery_correlations_email_hash_check" CHECK (email_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE ONLY "public"."outreach_delivery_correlations" ADD CONSTRAINT "outreach_delivery_correlations_tenant_nonblank" CHECK (btrim(signal_tenant_id) <> ''::text);
ALTER TABLE ONLY "public"."outreach_hygiene_intents" ADD CONSTRAINT "outreach_hygiene_intents_attempts_check" CHECK (attempt_count >= 0);
ALTER TABLE ONLY "public"."outreach_hygiene_intents" ADD CONSTRAINT "outreach_hygiene_intents_candidate_nonblank" CHECK (btrim(signal_candidate_id) <> ''::text);
ALTER TABLE ONLY "public"."outreach_hygiene_intents" ADD CONSTRAINT "outreach_hygiene_intents_dead_letter_pair_check" CHECK ((status = 'dead_letter'::text) = (dead_lettered_at IS NOT NULL));
ALTER TABLE ONLY "public"."outreach_hygiene_intents" ADD CONSTRAINT "outreach_hygiene_intents_email_hash_check" CHECK (email_hash ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE ONLY "public"."outreach_hygiene_intents" ADD CONSTRAINT "outreach_hygiene_intents_event_id_check" CHECK (provider_event_id ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE ONLY "public"."outreach_hygiene_intents" ADD CONSTRAINT "outreach_hygiene_intents_reason_check" CHECK (reason = ANY (ARRAY['hard_bounce'::text, 'complaint'::text]));
ALTER TABLE ONLY "public"."outreach_hygiene_intents" ADD CONSTRAINT "outreach_hygiene_intents_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'synced'::text, 'dead_letter'::text]));
ALTER TABLE ONLY "public"."outreach_hygiene_intents" ADD CONSTRAINT "outreach_hygiene_intents_tenant_nonblank" CHECK (btrim(signal_tenant_id) <> ''::text);
ALTER TABLE ONLY "public"."outreach_org_suppressions" ADD CONSTRAINT "outreach_org_suppressions_reason_check" CHECK (reason = 'unsubscribe'::text);
ALTER TABLE ONLY "public"."scheduled_outreach_campaigns" ADD CONSTRAINT "scheduled_outreach_campaigns_round_check" CHECK (round >= 2 AND round <= 3);
ALTER TABLE ONLY "public"."users_password_audit" ADD CONSTRAINT "users_password_audit_new_hash_prefix_check" CHECK (length(new_hash_prefix) <= 32);
ALTER TABLE ONLY "public"."users_password_audit" ADD CONSTRAINT "users_password_audit_old_hash_prefix_check" CHECK (length(old_hash_prefix) <= 32);
ALTER TABLE ONLY "public"."ai_fit_jobs" ADD CONSTRAINT "ai_fit_jobs_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."application_feedback" ADD CONSTRAINT "application_feedback_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."application_graph_sync_jobs" ADD CONSTRAINT "application_graph_sync_jobs_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."application_stage_history" ADD CONSTRAINT "application_stage_history_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."applications" ADD CONSTRAINT "applications_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."automation_events" ADD CONSTRAINT "automation_events_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."automation_settings" ADD CONSTRAINT "automation_settings_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."candidate_outreach_schedules" ADD CONSTRAINT "candidate_outreach_schedules_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."candidate_resumes" ADD CONSTRAINT "candidate_resumes_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."client_feedback" ADD CONSTRAINT "client_feedback_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."client_shortlist_items" ADD CONSTRAINT "client_shortlist_items_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."client_shortlists" ADD CONSTRAINT "client_shortlists_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."clients" ADD CONSTRAINT "clients_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."co_recruiter_invitations" ADD CONSTRAINT "co_recruiter_invitations_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."consultants" ADD CONSTRAINT "consultants_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."contact_submissions" ADD CONSTRAINT "contact_submissions_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."domain_claim_requests" ADD CONSTRAINT "domain_claim_requests_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."email_audit_log" ADD CONSTRAINT "email_audit_log_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."email_templates" ADD CONSTRAINT "email_templates_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."form_fields" ADD CONSTRAINT "form_fields_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."form_invitations" ADD CONSTRAINT "form_invitations_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."form_response_answers" ADD CONSTRAINT "form_response_answers_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."form_responses" ADD CONSTRAINT "form_responses_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."forms" ADD CONSTRAINT "forms_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."hiring_manager_invitations" ADD CONSTRAINT "hiring_manager_invitations_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."job_analytics" ADD CONSTRAINT "job_analytics_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."job_audit_log" ADD CONSTRAINT "job_audit_log_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."job_recruiters" ADD CONSTRAINT "job_recruiters_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."job_sourced_candidates" ADD CONSTRAINT "job_sourced_candidates_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."job_sourcing_runs" ADD CONSTRAINT "job_sourcing_runs_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."jobs" ADD CONSTRAINT "jobs_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."mautic_contact_links" ADD CONSTRAINT "mautic_contact_links_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."organization_credit_balances" ADD CONSTRAINT "organization_credit_balances_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."organization_credit_transactions" ADD CONSTRAINT "organization_credit_transactions_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."organization_invites" ADD CONSTRAINT "organization_invites_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."organization_join_requests" ADD CONSTRAINT "organization_join_requests_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."organization_members" ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."organizations" ADD CONSTRAINT "organizations_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."outreach_delivery_correlations" ADD CONSTRAINT "outreach_delivery_correlations_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."outreach_hygiene_intents" ADD CONSTRAINT "outreach_hygiene_intents_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."outreach_org_suppressions" ADD CONSTRAINT "outreach_org_suppressions_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."recruiter_feedback_events" ADD CONSTRAINT "recruiter_feedback_events_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."resume_import_batches" ADD CONSTRAINT "resume_import_batches_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."resume_import_items" ADD CONSTRAINT "resume_import_items_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."saved_jobs" ADD CONSTRAINT "saved_jobs_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."scheduled_outreach_campaigns" ADD CONSTRAINT "scheduled_outreach_campaigns_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."session" ADD CONSTRAINT "session_pkey" PRIMARY KEY (sid);
ALTER TABLE ONLY "public"."sourced_candidate_outreach_campaigns" ADD CONSTRAINT "sourced_candidate_outreach_campaigns_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."sourced_candidate_outreach_log" ADD CONSTRAINT "sourced_candidate_outreach_log_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."subscription_alerts" ADD CONSTRAINT "subscription_alerts_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."subscription_audit_log" ADD CONSTRAINT "subscription_audit_log_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."subscription_plans" ADD CONSTRAINT "subscription_plans_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."talent_pool" ADD CONSTRAINT "talent_pool_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."user_ai_usage" ADD CONSTRAINT "user_ai_usage_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."user_profiles" ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."users_password_audit" ADD CONSTRAINT "users_password_audit_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."webhook_events" ADD CONSTRAINT "webhook_events_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."whatsapp_audit_log" ADD CONSTRAINT "whatsapp_audit_log_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."application_graph_sync_jobs" ADD CONSTRAINT "application_graph_sync_jobs_application_id_key" UNIQUE (application_id);
ALTER TABLE ONLY "public"."automation_settings" ADD CONSTRAINT "automation_settings_setting_key_key" UNIQUE (setting_key);
ALTER TABLE ONLY "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_cashfree_order_id_key" UNIQUE (cashfree_order_id);
ALTER TABLE ONLY "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_claim_token_key" UNIQUE (claim_token);
ALTER TABLE ONLY "public"."client_shortlists" ADD CONSTRAINT "client_shortlists_token_key" UNIQUE (token);
ALTER TABLE ONLY "public"."consultants" ADD CONSTRAINT "consultants_email_key" UNIQUE (email);
ALTER TABLE ONLY "public"."form_invitations" ADD CONSTRAINT "form_invitations_token_key" UNIQUE (token);
ALTER TABLE ONLY "public"."form_responses" ADD CONSTRAINT "form_responses_invitation_id_key" UNIQUE (invitation_id);
ALTER TABLE ONLY "public"."job_sourcing_runs" ADD CONSTRAINT "job_sourcing_runs_request_id_key" UNIQUE (request_id);
ALTER TABLE ONLY "public"."organization_credit_balances" ADD CONSTRAINT "organization_credit_balances_organization_id_key" UNIQUE (organization_id);
ALTER TABLE ONLY "public"."organization_invites" ADD CONSTRAINT "organization_invites_token_key" UNIQUE (token);
ALTER TABLE ONLY "public"."organizations" ADD CONSTRAINT "organizations_domain_key" UNIQUE (domain);
ALTER TABLE ONLY "public"."organizations" ADD CONSTRAINT "organizations_signal_tenant_id_key" UNIQUE (signal_tenant_id);
ALTER TABLE ONLY "public"."organizations" ADD CONSTRAINT "organizations_slug_key" UNIQUE (slug);
ALTER TABLE ONLY "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_cashfree_order_id_key" UNIQUE (cashfree_order_id);
ALTER TABLE ONLY "public"."recruiter_feedback_events" ADD CONSTRAINT "recruiter_feedback_events_event_id_key" UNIQUE (event_id);
ALTER TABLE ONLY "public"."scheduled_outreach_campaigns" ADD CONSTRAINT "uq_scheduled_job_round" UNIQUE (job_id, round);
ALTER TABLE ONLY "public"."sourced_candidate_outreach_campaigns" ADD CONSTRAINT "sourced_candidate_outreach_campaigns_campaign_id_key" UNIQUE (campaign_id);
ALTER TABLE ONLY "public"."subscription_plans" ADD CONSTRAINT "subscription_plans_name_key" UNIQUE (name);
ALTER TABLE ONLY "public"."users" ADD CONSTRAINT "users_username_unique" UNIQUE (username);
ALTER TABLE ONLY "public"."whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_meta_template_name_key" UNIQUE (meta_template_name);

-- Standalone unique indexes can be foreign-key targets, so they precede foreign keys.
CREATE UNIQUE INDEX ai_fit_jobs_bull_job_id_idx ON ai_fit_jobs USING btree (bull_job_id);
CREATE UNIQUE INDEX applications_job_lower_email_unique ON applications USING btree (job_id, lower(email));
CREATE UNIQUE INDEX candidate_outreach_schedules_candidate_idx ON candidate_outreach_schedules USING btree (sourced_candidate_id);
CREATE UNIQUE INDEX candidate_resumes_unique_default_per_user ON candidate_resumes USING btree (user_id) WHERE is_default = true;
CREATE UNIQUE INDEX checkout_intents_cashfree_order_idx ON checkout_intents USING btree (cashfree_order_id) WHERE cashfree_order_id IS NOT NULL;
CREATE UNIQUE INDEX checkout_intents_claim_token_idx ON checkout_intents USING btree (claim_token) WHERE claim_token IS NOT NULL;
CREATE UNIQUE INDEX co_recruiter_invite_token_idx ON co_recruiter_invitations USING btree (token);
CREATE UNIQUE INDEX form_invitations_active_unique ON form_invitations USING btree (application_id, form_id) WHERE status = ANY (ARRAY['pending'::text, 'sent'::text, 'viewed'::text]);
CREATE UNIQUE INDEX hm_invitations_token_idx ON hiring_manager_invitations USING btree (token);
CREATE UNIQUE INDEX job_recruiter_unique_idx ON job_recruiters USING btree (job_id, recruiter_id);
CREATE UNIQUE INDEX job_sourced_candidates_id_org_job_idx ON job_sourced_candidates USING btree (id, organization_id, job_id);
CREATE UNIQUE INDEX job_sourced_candidates_job_candidate_idx ON job_sourced_candidates USING btree (job_id, signal_candidate_id);
CREATE UNIQUE INDEX job_sourcing_runs_active_idx ON job_sourcing_runs USING btree (organization_id, external_job_id, context_hash) WHERE status <> ALL (ARRAY['completed'::text, 'failed'::text, 'expired'::text]);
CREATE UNIQUE INDEX job_sourcing_runs_request_id_idx ON job_sourcing_runs USING btree (request_id);
CREATE UNIQUE INDEX mautic_contact_links_email_idx ON mautic_contact_links USING btree (email);
CREATE UNIQUE INDEX mautic_contact_links_user_idx ON mautic_contact_links USING btree (user_id);
CREATE UNIQUE INDEX org_credit_balances_org_idx ON organization_credit_balances USING btree (organization_id);
CREATE UNIQUE INDEX org_invites_org_email_idx ON organization_invites USING btree (organization_id, email);
CREATE UNIQUE INDEX org_members_org_user_idx ON organization_members USING btree (organization_id, user_id);
CREATE UNIQUE INDEX outreach_delivery_correlations_delivery_idx ON outreach_delivery_correlations USING btree (provider, delivery_id);
CREATE UNIQUE INDEX outreach_delivery_correlations_message_idx ON outreach_delivery_correlations USING btree (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE UNIQUE INDEX outreach_hygiene_intents_provider_event_idx ON outreach_hygiene_intents USING btree (provider, provider_event_id);
CREATE UNIQUE INDEX outreach_org_suppressions_org_email_idx ON outreach_org_suppressions USING btree (organization_id, email_hash);
CREATE UNIQUE INDEX outreach_org_suppressions_provider_event_idx ON outreach_org_suppressions USING btree (provider_event_id);
CREATE UNIQUE INDEX resume_import_items_batch_content_hash_unique ON resume_import_items USING btree (batch_id, content_hash) WHERE content_hash IS NOT NULL;
CREATE UNIQUE INDEX rfb_event_id_idx ON recruiter_feedback_events USING btree (event_id);
CREATE UNIQUE INDEX saved_jobs_candidate_job_unique_idx ON saved_jobs USING btree (candidate_id, job_id);
CREATE UNIQUE INDEX scoc_campaign_id_idx ON sourced_candidate_outreach_campaigns USING btree (campaign_id);
CREATE UNIQUE INDEX scol_delivery_id_idx ON sourced_candidate_outreach_log USING btree (delivery_id);
CREATE UNIQUE INDEX scol_delivery_key_idx ON sourced_candidate_outreach_log USING btree (delivery_key);
CREATE UNIQUE INDEX scol_provider_message_idx ON sourced_candidate_outreach_log USING btree (provider_message_id);
CREATE UNIQUE INDEX talent_pool_recruiter_email_unique ON talent_pool USING btree (recruiter_id, lower(email));
CREATE UNIQUE INDEX user_profiles_public_id_idx ON user_profiles USING btree (public_id);
CREATE UNIQUE INDEX webhook_events_event_id_idx ON webhook_events USING btree (provider, event_id);

-- Foreign keys after every referenced table/key exists.
ALTER TABLE ONLY "public"."ai_fit_jobs" ADD CONSTRAINT "ai_fit_jobs_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id);
ALTER TABLE ONLY "public"."ai_fit_jobs" ADD CONSTRAINT "ai_fit_jobs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."application_feedback" ADD CONSTRAINT "application_feedback_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."application_feedback" ADD CONSTRAINT "application_feedback_author_id_fkey" FOREIGN KEY (author_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."application_graph_sync_jobs" ADD CONSTRAINT "application_graph_sync_jobs_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."application_graph_sync_jobs" ADD CONSTRAINT "application_graph_sync_jobs_effective_recruiter_id_fkey" FOREIGN KEY (effective_recruiter_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."application_graph_sync_jobs" ADD CONSTRAINT "application_graph_sync_jobs_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id);
ALTER TABLE ONLY "public"."application_graph_sync_jobs" ADD CONSTRAINT "application_graph_sync_jobs_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."application_stage_history" ADD CONSTRAINT "application_stage_history_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."applications" ADD CONSTRAINT "applications_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."applications" ADD CONSTRAINT "applications_hm_review_requested_by_fkey" FOREIGN KEY (hm_review_requested_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY (job_id) REFERENCES jobs(id);
ALTER TABLE ONLY "public"."applications" ADD CONSTRAINT "applications_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."applications" ADD CONSTRAINT "applications_resume_id_fkey" FOREIGN KEY (resume_id) REFERENCES candidate_resumes(id);
ALTER TABLE ONLY "public"."applications" ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."automation_events" ADD CONSTRAINT "automation_events_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."automation_events" ADD CONSTRAINT "automation_events_triggered_by_fkey" FOREIGN KEY (triggered_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."automation_settings" ADD CONSTRAINT "automation_settings_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."candidate_outreach_schedules" ADD CONSTRAINT "candidate_outreach_schedules_candidate_owner_fk" FOREIGN KEY (sourced_candidate_id, organization_id, job_id) REFERENCES job_sourced_candidates(id, organization_id, job_id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."candidate_outreach_schedules" ADD CONSTRAINT "candidate_outreach_schedules_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."candidate_outreach_schedules" ADD CONSTRAINT "candidate_outreach_schedules_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."candidate_outreach_schedules" ADD CONSTRAINT "candidate_outreach_schedules_sourced_candidate_id_fkey" FOREIGN KEY (sourced_candidate_id) REFERENCES job_sourced_candidates(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."candidate_outreach_schedules" ADD CONSTRAINT "candidate_outreach_schedules_triggered_by_fkey" FOREIGN KEY (triggered_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."candidate_resumes" ADD CONSTRAINT "candidate_resumes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_claimed_by_fkey" FOREIGN KEY (claimed_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES subscription_plans(id);
ALTER TABLE ONLY "public"."checkout_intents" ADD CONSTRAINT "checkout_intents_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."client_feedback" ADD CONSTRAINT "client_feedback_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."client_feedback" ADD CONSTRAINT "client_feedback_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."client_feedback" ADD CONSTRAINT "client_feedback_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."client_feedback" ADD CONSTRAINT "client_feedback_shortlist_id_fkey" FOREIGN KEY (shortlist_id) REFERENCES client_shortlists(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."client_shortlist_items" ADD CONSTRAINT "client_shortlist_items_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."client_shortlist_items" ADD CONSTRAINT "client_shortlist_items_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."client_shortlist_items" ADD CONSTRAINT "client_shortlist_items_shortlist_id_fkey" FOREIGN KEY (shortlist_id) REFERENCES client_shortlists(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."client_shortlists" ADD CONSTRAINT "client_shortlists_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."client_shortlists" ADD CONSTRAINT "client_shortlists_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."client_shortlists" ADD CONSTRAINT "client_shortlists_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."client_shortlists" ADD CONSTRAINT "client_shortlists_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."clients" ADD CONSTRAINT "clients_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."co_recruiter_invitations" ADD CONSTRAINT "co_recruiter_invitations_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."co_recruiter_invitations" ADD CONSTRAINT "co_recruiter_invitations_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."co_recruiter_invitations" ADD CONSTRAINT "co_recruiter_invitations_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."domain_claim_requests" ADD CONSTRAINT "domain_claim_requests_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."domain_claim_requests" ADD CONSTRAINT "domain_claim_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."domain_claim_requests" ADD CONSTRAINT "domain_claim_requests_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."email_audit_log" ADD CONSTRAINT "email_audit_log_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."email_templates" ADD CONSTRAINT "email_templates_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."form_fields" ADD CONSTRAINT "form_fields_form_id_fkey" FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."form_invitations" ADD CONSTRAINT "form_invitations_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."form_invitations" ADD CONSTRAINT "form_invitations_form_id_fkey" FOREIGN KEY (form_id) REFERENCES forms(id);
ALTER TABLE ONLY "public"."form_invitations" ADD CONSTRAINT "form_invitations_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id);
ALTER TABLE ONLY "public"."form_invitations" ADD CONSTRAINT "form_invitations_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."form_invitations" ADD CONSTRAINT "form_invitations_sent_by_fkey" FOREIGN KEY (sent_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."form_response_answers" ADD CONSTRAINT "form_response_answers_field_id_fkey" FOREIGN KEY (field_id) REFERENCES form_fields(id);
ALTER TABLE ONLY "public"."form_response_answers" ADD CONSTRAINT "form_response_answers_response_id_fkey" FOREIGN KEY (response_id) REFERENCES form_responses(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."form_responses" ADD CONSTRAINT "form_responses_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."form_responses" ADD CONSTRAINT "form_responses_invitation_id_fkey" FOREIGN KEY (invitation_id) REFERENCES form_invitations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."form_responses" ADD CONSTRAINT "form_responses_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."forms" ADD CONSTRAINT "forms_created_by_fkey" FOREIGN KEY (created_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."forms" ADD CONSTRAINT "forms_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."hiring_manager_invitations" ADD CONSTRAINT "hiring_manager_invitations_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."job_analytics" ADD CONSTRAINT "job_analytics_job_id_jobs_id_fk" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."job_analytics" ADD CONSTRAINT "job_analytics_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."job_audit_log" ADD CONSTRAINT "job_audit_log_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."job_audit_log" ADD CONSTRAINT "job_audit_log_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."job_audit_log" ADD CONSTRAINT "job_audit_log_performed_by_fkey" FOREIGN KEY (performed_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."job_recruiters" ADD CONSTRAINT "job_recruiters_added_by_fkey" FOREIGN KEY (added_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."job_recruiters" ADD CONSTRAINT "job_recruiters_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."job_recruiters" ADD CONSTRAINT "job_recruiters_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."job_recruiters" ADD CONSTRAINT "job_recruiters_recruiter_id_fkey" FOREIGN KEY (recruiter_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."job_sourced_candidates" ADD CONSTRAINT "job_sourced_candidates_converted_application_id_fkey" FOREIGN KEY (converted_application_id) REFERENCES applications(id);
ALTER TABLE ONLY "public"."job_sourced_candidates" ADD CONSTRAINT "job_sourced_candidates_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."job_sourced_candidates" ADD CONSTRAINT "job_sourced_candidates_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."job_sourced_candidates" ADD CONSTRAINT "job_sourced_candidates_request_id_fkey" FOREIGN KEY (request_id) REFERENCES job_sourcing_runs(request_id);
ALTER TABLE ONLY "public"."job_sourcing_runs" ADD CONSTRAINT "job_sourcing_runs_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."job_sourcing_runs" ADD CONSTRAINT "job_sourcing_runs_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."jobs" ADD CONSTRAINT "jobs_client_id_fkey" FOREIGN KEY (client_id) REFERENCES clients(id);
ALTER TABLE ONLY "public"."jobs" ADD CONSTRAINT "jobs_hiring_manager_id_fkey" FOREIGN KEY (hiring_manager_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."jobs" ADD CONSTRAINT "jobs_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."jobs" ADD CONSTRAINT "jobs_posted_by_users_id_fk" FOREIGN KEY (posted_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."jobs" ADD CONSTRAINT "jobs_reviewed_by_users_id_fk" FOREIGN KEY (reviewed_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."mautic_contact_links" ADD CONSTRAINT "mautic_contact_links_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."mautic_contact_links" ADD CONSTRAINT "mautic_contact_links_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organization_credit_balances" ADD CONSTRAINT "organization_credit_balances_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organization_credit_transactions" ADD CONSTRAINT "organization_credit_transactions_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organization_credit_transactions" ADD CONSTRAINT "organization_credit_transactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."organization_invites" ADD CONSTRAINT "organization_invites_accepted_by_fkey" FOREIGN KEY (accepted_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."organization_invites" ADD CONSTRAINT "organization_invites_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."organization_invites" ADD CONSTRAINT "organization_invites_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organization_join_requests" ADD CONSTRAINT "organization_join_requests_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organization_join_requests" ADD CONSTRAINT "organization_join_requests_responded_by_fkey" FOREIGN KEY (responded_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."organization_join_requests" ADD CONSTRAINT "organization_join_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organization_members" ADD CONSTRAINT "organization_members_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_admin_override_by_fkey" FOREIGN KEY (admin_override_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_bonus_credits_granted_by_fkey" FOREIGN KEY (bonus_credits_granted_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES subscription_plans(id);
ALTER TABLE ONLY "public"."organizations" ADD CONSTRAINT "organizations_domain_approved_by_fkey" FOREIGN KEY (domain_approved_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."outreach_org_suppressions" ADD CONSTRAINT "outreach_org_suppressions_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."outreach_org_suppressions" ADD CONSTRAINT "outreach_org_suppressions_source_outreach_log_id_fkey" FOREIGN KEY (source_outreach_log_id) REFERENCES sourced_candidate_outreach_log(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."payment_transactions" ADD CONSTRAINT "payment_transactions_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES organization_subscriptions(id);
ALTER TABLE ONLY "public"."pipeline_stages" ADD CONSTRAINT "pipeline_stages_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."recruiter_feedback_events" ADD CONSTRAINT "recruiter_feedback_events_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."recruiter_feedback_events" ADD CONSTRAINT "recruiter_feedback_events_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."recruiter_feedback_events" ADD CONSTRAINT "recruiter_feedback_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."resume_import_batches" ADD CONSTRAINT "resume_import_batches_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."resume_import_batches" ADD CONSTRAINT "resume_import_batches_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."resume_import_batches" ADD CONSTRAINT "resume_import_batches_uploaded_by_user_id_fkey" FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."resume_import_items" ADD CONSTRAINT "resume_import_items_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
ALTER TABLE ONLY "public"."resume_import_items" ADD CONSTRAINT "resume_import_items_batch_id_fkey" FOREIGN KEY (batch_id) REFERENCES resume_import_batches(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."resume_import_items" ADD CONSTRAINT "resume_import_items_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."resume_import_items" ADD CONSTRAINT "resume_import_items_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."resume_import_items" ADD CONSTRAINT "resume_import_items_uploaded_by_user_id_fkey" FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."saved_jobs" ADD CONSTRAINT "saved_jobs_candidate_id_fkey" FOREIGN KEY (candidate_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."saved_jobs" ADD CONSTRAINT "saved_jobs_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."scheduled_outreach_campaigns" ADD CONSTRAINT "scheduled_outreach_campaigns_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."scheduled_outreach_campaigns" ADD CONSTRAINT "scheduled_outreach_campaigns_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."scheduled_outreach_campaigns" ADD CONSTRAINT "scheduled_outreach_campaigns_triggered_by_fkey" FOREIGN KEY (triggered_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."sourced_candidate_outreach_campaigns" ADD CONSTRAINT "sourced_candidate_outreach_campaigns_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."sourced_candidate_outreach_campaigns" ADD CONSTRAINT "sourced_candidate_outreach_campaigns_launched_by_fkey" FOREIGN KEY (launched_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."sourced_candidate_outreach_campaigns" ADD CONSTRAINT "sourced_candidate_outreach_campaigns_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."sourced_candidate_outreach_log" ADD CONSTRAINT "sourced_candidate_outreach_log_job_id_fkey" FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."sourced_candidate_outreach_log" ADD CONSTRAINT "sourced_candidate_outreach_log_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."sourced_candidate_outreach_log" ADD CONSTRAINT "sourced_candidate_outreach_log_sent_by_fkey" FOREIGN KEY (sent_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."sourced_candidate_outreach_log" ADD CONSTRAINT "sourced_candidate_outreach_log_sourced_candidate_id_fkey" FOREIGN KEY (sourced_candidate_id) REFERENCES job_sourced_candidates(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."subscription_alerts" ADD CONSTRAINT "subscription_alerts_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES organization_subscriptions(id);
ALTER TABLE ONLY "public"."subscription_audit_log" ADD CONSTRAINT "subscription_audit_log_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."subscription_audit_log" ADD CONSTRAINT "subscription_audit_log_performed_by_fkey" FOREIGN KEY (performed_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."subscription_audit_log" ADD CONSTRAINT "subscription_audit_log_subscription_id_fkey" FOREIGN KEY (subscription_id) REFERENCES organization_subscriptions(id);
ALTER TABLE ONLY "public"."talent_pool" ADD CONSTRAINT "talent_pool_form_response_id_fkey" FOREIGN KEY (form_response_id) REFERENCES form_responses(id);
ALTER TABLE ONLY "public"."talent_pool" ADD CONSTRAINT "talent_pool_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."talent_pool" ADD CONSTRAINT "talent_pool_recruiter_id_fkey" FOREIGN KEY (recruiter_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_ai_usage" ADD CONSTRAINT "user_ai_usage_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id);
ALTER TABLE ONLY "public"."user_ai_usage" ADD CONSTRAINT "user_ai_usage_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE ONLY "public"."whatsapp_audit_log" ADD CONSTRAINT "whatsapp_audit_log_application_id_fkey" FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE;
ALTER TABLE ONLY "public"."whatsapp_audit_log" ADD CONSTRAINT "whatsapp_audit_log_sent_by_fkey" FOREIGN KEY (sent_by) REFERENCES users(id);
ALTER TABLE ONLY "public"."whatsapp_audit_log" ADD CONSTRAINT "whatsapp_audit_log_template_id_fkey" FOREIGN KEY (template_id) REFERENCES whatsapp_templates(id);

-- Remaining standalone indexes (123).
CREATE INDEX "IDX_session_expire" ON session USING btree (expire);
CREATE INDEX ai_fit_jobs_application_id_idx ON ai_fit_jobs USING btree (application_id);
CREATE INDEX ai_fit_jobs_created_at_idx ON ai_fit_jobs USING btree (created_at);
CREATE INDEX ai_fit_jobs_user_status_idx ON ai_fit_jobs USING btree (user_id, status);
CREATE INDEX app_graph_sync_org_idx ON application_graph_sync_jobs USING btree (organization_id);
CREATE INDEX app_graph_sync_recruiter_idx ON application_graph_sync_jobs USING btree (effective_recruiter_id);
CREATE INDEX app_graph_sync_status_next_attempt_idx ON application_graph_sync_jobs USING btree (status, next_attempt_at);
CREATE INDEX application_feedback_application_id_idx ON application_feedback USING btree (application_id);
CREATE INDEX application_feedback_author_id_idx ON application_feedback USING btree (author_id);
CREATE INDEX applications_hm_review_requested_at_idx ON applications USING btree (hm_review_requested_at);
CREATE INDEX applications_job_email_idx ON applications USING btree (job_id, lower(email));
CREATE INDEX applications_org_idx ON applications USING btree (organization_id);
CREATE INDEX applications_rejection_reason_idx ON applications USING btree (rejection_reason);
CREATE INDEX applications_status_idx ON applications USING btree (status);
CREATE INDEX applications_user_id_idx ON applications USING btree (user_id);
CREATE INDEX automation_events_key_idx ON automation_events USING btree (automation_key);
CREATE INDEX automation_events_outcome_idx ON automation_events USING btree (outcome);
CREATE INDEX automation_events_target_type_idx ON automation_events USING btree (target_type);
CREATE INDEX automation_events_triggered_at_idx ON automation_events USING btree (triggered_at);
CREATE INDEX candidate_outreach_schedules_due_idx ON candidate_outreach_schedules USING btree (status, due_at);
CREATE INDEX candidate_outreach_schedules_org_job_idx ON candidate_outreach_schedules USING btree (organization_id, job_id);
CREATE INDEX candidate_resumes_user_id_idx ON candidate_resumes USING btree (user_id);
CREATE INDEX checkout_intents_email_idx ON checkout_intents USING btree (email);
CREATE INDEX checkout_intents_expires_at_idx ON checkout_intents USING btree (expires_at);
CREATE INDEX checkout_intents_status_idx ON checkout_intents USING btree (status);
CREATE INDEX client_feedback_application_id_idx ON client_feedback USING btree (application_id);
CREATE INDEX client_feedback_client_id_idx ON client_feedback USING btree (client_id);
CREATE INDEX client_feedback_shortlist_id_idx ON client_feedback USING btree (shortlist_id);
CREATE INDEX client_shortlist_items_application_id_idx ON client_shortlist_items USING btree (application_id);
CREATE INDEX client_shortlist_items_shortlist_id_idx ON client_shortlist_items USING btree (shortlist_id);
CREATE INDEX client_shortlists_client_id_idx ON client_shortlists USING btree (client_id);
CREATE INDEX client_shortlists_job_id_idx ON client_shortlists USING btree (job_id);
CREATE INDEX client_shortlists_token_idx ON client_shortlists USING btree (token);
CREATE INDEX clients_created_by_idx ON clients USING btree (created_by);
CREATE INDEX clients_org_idx ON clients USING btree (organization_id);
CREATE INDEX co_recruiter_invite_job_email_idx ON co_recruiter_invitations USING btree (job_id, email);
CREATE INDEX co_recruiter_invite_status_idx ON co_recruiter_invitations USING btree (status);
CREATE INDEX form_fields_form_id_order_idx ON form_fields USING btree (form_id, "order");
CREATE INDEX form_invitations_app_status_idx ON form_invitations USING btree (application_id, status);
CREATE INDEX form_invitations_created_at_idx ON form_invitations USING btree (created_at);
CREATE INDEX form_invitations_email_idx ON form_invitations USING btree (email);
CREATE INDEX form_invitations_form_id_idx ON form_invitations USING btree (form_id);
CREATE INDEX form_invitations_job_id_idx ON form_invitations USING btree (job_id);
CREATE INDEX form_invitations_token_idx ON form_invitations USING btree (token);
CREATE INDEX form_response_answers_response_id_idx ON form_response_answers USING btree (response_id);
CREATE INDEX form_responses_application_id_idx ON form_responses USING btree (application_id);
CREATE INDEX forms_created_by_idx ON forms USING btree (created_by);
CREATE INDEX forms_is_published_idx ON forms USING btree (is_published);
CREATE INDEX hm_invitations_email_idx ON hiring_manager_invitations USING btree (email);
CREATE INDEX hm_invitations_invited_by_idx ON hiring_manager_invitations USING btree (invited_by);
CREATE INDEX hm_invitations_status_idx ON hiring_manager_invitations USING btree (status);
CREATE INDEX job_audit_log_action_idx ON job_audit_log USING btree (action);
CREATE INDEX job_audit_log_job_id_idx ON job_audit_log USING btree (job_id);
CREATE INDEX job_audit_log_timestamp_idx ON job_audit_log USING btree ("timestamp");
CREATE INDEX job_recruiters_job_idx ON job_recruiters USING btree (job_id);
CREATE INDEX job_recruiters_recruiter_idx ON job_recruiters USING btree (recruiter_id);
CREATE INDEX job_sourced_candidates_email_resolution_due_idx ON job_sourced_candidates USING btree (email_resolve_next_attempt_at, id) WHERE email_resolve_status = 'pending'::text;
CREATE INDEX job_sourced_candidates_fit_score_idx ON job_sourced_candidates USING btree (fit_score);
CREATE INDEX job_sourced_candidates_org_job_idx ON job_sourced_candidates USING btree (organization_id, job_id);
CREATE INDEX job_sourced_candidates_request_idx ON job_sourced_candidates USING btree (request_id);
CREATE INDEX job_sourced_candidates_source_type_idx ON job_sourced_candidates USING btree (source_type);
CREATE INDEX job_sourced_candidates_state_idx ON job_sourced_candidates USING btree (state);
CREATE INDEX job_sourcing_runs_expires_at_idx ON job_sourcing_runs USING btree (expires_at);
CREATE INDEX job_sourcing_runs_org_job_idx ON job_sourcing_runs USING btree (organization_id, job_id);
CREATE INDEX job_sourcing_runs_status_idx ON job_sourcing_runs USING btree (status);
CREATE INDEX jobs_client_id_idx ON jobs USING btree (client_id);
CREATE INDEX jobs_deactivated_at_idx ON jobs USING btree (deactivated_at);
CREATE INDEX jobs_hiring_manager_idx ON jobs USING btree (hiring_manager_id);
CREATE INDEX jobs_is_active_idx ON jobs USING btree (is_active);
CREATE INDEX jobs_org_idx ON jobs USING btree (organization_id);
CREATE INDEX jobs_posted_by_idx ON jobs USING btree (posted_by);
CREATE INDEX jobs_slug_idx ON jobs USING btree (slug);
CREATE INDEX jobs_status_idx ON jobs USING btree (status);
CREATE INDEX mautic_contact_links_contact_idx ON mautic_contact_links USING btree (mautic_contact_id);
CREATE INDEX mautic_contact_links_org_idx ON mautic_contact_links USING btree (organization_id);
CREATE INDEX org_credit_transactions_org_idx ON organization_credit_transactions USING btree (organization_id);
CREATE INDEX org_credit_transactions_type_idx ON organization_credit_transactions USING btree (type);
CREATE INDEX org_members_user_idx ON organization_members USING btree (user_id);
CREATE INDEX outreach_delivery_correlations_email_idx ON outreach_delivery_correlations USING btree (email_hash);
CREATE INDEX outreach_hygiene_intents_due_idx ON outreach_hygiene_intents USING btree (status, next_attempt_at);
CREATE INDEX outreach_hygiene_intents_email_idx ON outreach_hygiene_intents USING btree (email_hash);
CREATE INDEX outreach_hygiene_intents_pending_complaint_idx ON outreach_hygiene_intents USING btree (status) WHERE reason = 'complaint'::text AND status <> 'synced'::text;
CREATE INDEX outreach_org_suppressions_org_candidate_lookup_idx ON outreach_org_suppressions USING btree (organization_id, signal_candidate_id) WHERE signal_candidate_id IS NOT NULL;
CREATE INDEX resume_import_batches_org_job_idx ON resume_import_batches USING btree (organization_id, job_id);
CREATE INDEX resume_import_batches_status_idx ON resume_import_batches USING btree (status);
CREATE INDEX resume_import_batches_uploader_idx ON resume_import_batches USING btree (uploaded_by_user_id);
CREATE INDEX resume_import_items_application_idx ON resume_import_items USING btree (application_id);
CREATE INDEX resume_import_items_batch_idx ON resume_import_items USING btree (batch_id);
CREATE INDEX resume_import_items_batch_status_idx ON resume_import_items USING btree (batch_id, status);
CREATE INDEX resume_import_items_content_hash_idx ON resume_import_items USING btree (batch_id, content_hash);
CREATE INDEX resume_import_items_job_email_idx ON resume_import_items USING btree (job_id, parsed_email);
CREATE INDEX resume_import_items_status_attempt_idx ON resume_import_items USING btree (status, next_attempt_at);
CREATE INDEX rfb_action_idx ON recruiter_feedback_events USING btree (action);
CREATE INDEX rfb_candidate_idx ON recruiter_feedback_events USING btree (signal_candidate_id);
CREATE INDEX rfb_org_job_idx ON recruiter_feedback_events USING btree (organization_id, job_id);
CREATE INDEX rfb_unsynced_idx ON recruiter_feedback_events USING btree (synced_to_signal_at);
CREATE INDEX saved_jobs_candidate_created_at_idx ON saved_jobs USING btree (candidate_id, created_at DESC);
CREATE INDEX saved_jobs_job_id_idx ON saved_jobs USING btree (job_id);
CREATE INDEX scoc_job_idx ON sourced_candidate_outreach_campaigns USING btree (job_id);
CREATE INDEX scoc_job_round_idx ON sourced_candidate_outreach_campaigns USING btree (job_id, round);
CREATE INDEX scoc_launched_by_idx ON sourced_candidate_outreach_campaigns USING btree (launched_by);
CREATE INDEX scoc_org_idx ON sourced_candidate_outreach_campaigns USING btree (organization_id);
CREATE INDEX scol_campaign_idx ON sourced_candidate_outreach_log USING btree (campaign_id);
CREATE INDEX scol_candidate_idx ON sourced_candidate_outreach_log USING btree (sourced_candidate_id);
CREATE INDEX scol_job_idx ON sourced_candidate_outreach_log USING btree (job_id);
CREATE INDEX scol_org_idx ON sourced_candidate_outreach_log USING btree (organization_id);
CREATE INDEX soc_job_idx ON scheduled_outreach_campaigns USING btree (job_id);
CREATE INDEX soc_org_idx ON scheduled_outreach_campaigns USING btree (organization_id);
CREATE INDEX soc_status_scheduled_idx ON scheduled_outreach_campaigns USING btree (status, scheduled_at);
CREATE INDEX talent_pool_email_idx ON talent_pool USING btree (email);
CREATE INDEX talent_pool_recruiter_id_idx ON talent_pool USING btree (recruiter_id);
CREATE INDEX talent_pool_source_idx ON talent_pool USING btree (source);
CREATE INDEX user_ai_usage_computed_at_idx ON user_ai_usage USING btree (computed_at);
CREATE INDEX user_ai_usage_kind_idx ON user_ai_usage USING btree (kind);
CREATE INDEX user_ai_usage_user_id_idx ON user_ai_usage USING btree (user_id);
CREATE INDEX users_password_audit_changed_at_idx ON users_password_audit USING btree (changed_at DESC);
CREATE INDEX users_password_audit_user_id_idx ON users_password_audit USING btree (user_id);
CREATE INDEX whatsapp_audit_log_application_id_idx ON whatsapp_audit_log USING btree (application_id);
CREATE INDEX whatsapp_audit_log_message_id_idx ON whatsapp_audit_log USING btree (message_id);
CREATE INDEX whatsapp_audit_log_sent_at_idx ON whatsapp_audit_log USING btree (sent_at);
CREATE INDEX whatsapp_audit_log_status_idx ON whatsapp_audit_log USING btree (status);
CREATE INDEX whatsapp_templates_status_idx ON whatsapp_templates USING btree (status);
CREATE INDEX whatsapp_templates_type_idx ON whatsapp_templates USING btree (template_type);

-- Sequence ownership after tables/columns exist.
ALTER SEQUENCE "public"."ai_fit_jobs_id_seq" OWNED BY "public"."ai_fit_jobs"."id";
ALTER SEQUENCE "public"."application_feedback_id_seq" OWNED BY "public"."application_feedback"."id";
ALTER SEQUENCE "public"."application_graph_sync_jobs_id_seq" OWNED BY "public"."application_graph_sync_jobs"."id";
ALTER SEQUENCE "public"."application_stage_history_id_seq" OWNED BY "public"."application_stage_history"."id";
ALTER SEQUENCE "public"."applications_id_seq" OWNED BY "public"."applications"."id";
ALTER SEQUENCE "public"."automation_events_id_seq" OWNED BY "public"."automation_events"."id";
ALTER SEQUENCE "public"."automation_settings_id_seq" OWNED BY "public"."automation_settings"."id";
ALTER SEQUENCE "public"."candidate_outreach_schedules_id_seq" OWNED BY "public"."candidate_outreach_schedules"."id";
ALTER SEQUENCE "public"."candidate_resumes_id_seq" OWNED BY "public"."candidate_resumes"."id";
ALTER SEQUENCE "public"."checkout_intents_id_seq" OWNED BY "public"."checkout_intents"."id";
ALTER SEQUENCE "public"."client_feedback_id_seq" OWNED BY "public"."client_feedback"."id";
ALTER SEQUENCE "public"."client_shortlist_items_id_seq" OWNED BY "public"."client_shortlist_items"."id";
ALTER SEQUENCE "public"."client_shortlists_id_seq" OWNED BY "public"."client_shortlists"."id";
ALTER SEQUENCE "public"."clients_id_seq" OWNED BY "public"."clients"."id";
ALTER SEQUENCE "public"."co_recruiter_invitations_id_seq" OWNED BY "public"."co_recruiter_invitations"."id";
ALTER SEQUENCE "public"."consultants_id_seq" OWNED BY "public"."consultants"."id";
ALTER SEQUENCE "public"."contact_submissions_id_seq" OWNED BY "public"."contact_submissions"."id";
ALTER SEQUENCE "public"."domain_claim_requests_id_seq" OWNED BY "public"."domain_claim_requests"."id";
ALTER SEQUENCE "public"."email_audit_log_id_seq" OWNED BY "public"."email_audit_log"."id";
ALTER SEQUENCE "public"."email_templates_id_seq" OWNED BY "public"."email_templates"."id";
ALTER SEQUENCE "public"."form_fields_id_seq" OWNED BY "public"."form_fields"."id";
ALTER SEQUENCE "public"."form_invitations_id_seq" OWNED BY "public"."form_invitations"."id";
ALTER SEQUENCE "public"."form_response_answers_id_seq" OWNED BY "public"."form_response_answers"."id";
ALTER SEQUENCE "public"."form_responses_id_seq" OWNED BY "public"."form_responses"."id";
ALTER SEQUENCE "public"."forms_id_seq" OWNED BY "public"."forms"."id";
ALTER SEQUENCE "public"."hiring_manager_invitations_id_seq" OWNED BY "public"."hiring_manager_invitations"."id";
ALTER SEQUENCE "public"."job_analytics_id_seq" OWNED BY "public"."job_analytics"."id";
ALTER SEQUENCE "public"."job_audit_log_id_seq" OWNED BY "public"."job_audit_log"."id";
ALTER SEQUENCE "public"."job_recruiters_id_seq" OWNED BY "public"."job_recruiters"."id";
ALTER SEQUENCE "public"."job_sourced_candidates_id_seq" OWNED BY "public"."job_sourced_candidates"."id";
ALTER SEQUENCE "public"."job_sourcing_runs_id_seq" OWNED BY "public"."job_sourcing_runs"."id";
ALTER SEQUENCE "public"."jobs_id_seq" OWNED BY "public"."jobs"."id";
ALTER SEQUENCE "public"."mautic_contact_links_id_seq" OWNED BY "public"."mautic_contact_links"."id";
ALTER SEQUENCE "public"."organization_credit_balances_id_seq" OWNED BY "public"."organization_credit_balances"."id";
ALTER SEQUENCE "public"."organization_credit_transactions_id_seq" OWNED BY "public"."organization_credit_transactions"."id";
ALTER SEQUENCE "public"."organization_invites_id_seq" OWNED BY "public"."organization_invites"."id";
ALTER SEQUENCE "public"."organization_join_requests_id_seq" OWNED BY "public"."organization_join_requests"."id";
ALTER SEQUENCE "public"."organization_members_id_seq" OWNED BY "public"."organization_members"."id";
ALTER SEQUENCE "public"."organization_subscriptions_id_seq" OWNED BY "public"."organization_subscriptions"."id";
ALTER SEQUENCE "public"."organizations_id_seq" OWNED BY "public"."organizations"."id";
ALTER SEQUENCE "public"."outreach_delivery_correlations_id_seq" OWNED BY "public"."outreach_delivery_correlations"."id";
ALTER SEQUENCE "public"."outreach_hygiene_intents_id_seq" OWNED BY "public"."outreach_hygiene_intents"."id";
ALTER SEQUENCE "public"."outreach_org_suppressions_id_seq" OWNED BY "public"."outreach_org_suppressions"."id";
ALTER SEQUENCE "public"."payment_transactions_id_seq" OWNED BY "public"."payment_transactions"."id";
ALTER SEQUENCE "public"."pipeline_stages_id_seq" OWNED BY "public"."pipeline_stages"."id";
ALTER SEQUENCE "public"."recruiter_feedback_events_id_seq" OWNED BY "public"."recruiter_feedback_events"."id";
ALTER SEQUENCE "public"."resume_import_batches_id_seq" OWNED BY "public"."resume_import_batches"."id";
ALTER SEQUENCE "public"."resume_import_items_id_seq" OWNED BY "public"."resume_import_items"."id";
ALTER SEQUENCE "public"."saved_jobs_id_seq" OWNED BY "public"."saved_jobs"."id";
ALTER SEQUENCE "public"."scheduled_outreach_campaigns_id_seq" OWNED BY "public"."scheduled_outreach_campaigns"."id";
ALTER SEQUENCE "public"."sourced_candidate_outreach_campaigns_id_seq" OWNED BY "public"."sourced_candidate_outreach_campaigns"."id";
ALTER SEQUENCE "public"."sourced_candidate_outreach_log_id_seq" OWNED BY "public"."sourced_candidate_outreach_log"."id";
ALTER SEQUENCE "public"."subscription_alerts_id_seq" OWNED BY "public"."subscription_alerts"."id";
ALTER SEQUENCE "public"."subscription_audit_log_id_seq" OWNED BY "public"."subscription_audit_log"."id";
ALTER SEQUENCE "public"."subscription_plans_id_seq" OWNED BY "public"."subscription_plans"."id";
ALTER SEQUENCE "public"."talent_pool_id_seq" OWNED BY "public"."talent_pool"."id";
ALTER SEQUENCE "public"."user_ai_usage_id_seq" OWNED BY "public"."user_ai_usage"."id";
ALTER SEQUENCE "public"."user_profiles_id_seq" OWNED BY "public"."user_profiles"."id";
ALTER SEQUENCE "public"."users_id_seq" OWNED BY "public"."users"."id";
ALTER SEQUENCE "public"."users_password_audit_id_seq" OWNED BY "public"."users_password_audit"."id";
ALTER SEQUENCE "public"."webhook_events_id_seq" OWNED BY "public"."webhook_events"."id";
ALTER SEQUENCE "public"."whatsapp_audit_log_id_seq" OWNED BY "public"."whatsapp_audit_log"."id";
ALTER SEQUENCE "public"."whatsapp_templates_id_seq" OWNED BY "public"."whatsapp_templates"."id";

-- Authored routines and triggers; generated RI triggers come from foreign keys.
CREATE OR REPLACE FUNCTION public.check_resume_limit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
    BEGIN
      IF (SELECT COUNT(*) FROM candidate_resumes WHERE user_id = NEW.user_id) >= 3 THEN
        RAISE EXCEPTION 'Maximum 3 resumes allowed per user';
      END IF;
      RETURN NEW;
    END;
    $function$;

CREATE OR REPLACE FUNCTION public.fn_users_password_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.password IS DISTINCT FROM OLD.password THEN
    INSERT INTO users_password_audit (
      user_id, username, old_hash_prefix, new_hash_prefix,
      db_user, client_addr, client_port, application_name, pid
    ) VALUES (
      OLD.id,
      OLD.username,
      LEFT(OLD.password, 16),
      LEFT(NEW.password, 16),
      session_user,
      inet_client_addr(),
      inet_client_port(),
      current_setting('application_name', true),
      pg_backend_pid()
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER enforce_resume_limit BEFORE INSERT ON candidate_resumes FOR EACH ROW EXECUTE FUNCTION check_resume_limit();
CREATE TRIGGER trg_users_password_audit AFTER UPDATE OF password ON users FOR EACH ROW WHEN (old.password IS DISTINCT FROM new.password) EXECUTE FUNCTION fn_users_password_audit();
