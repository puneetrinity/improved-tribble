-- Candidate Privacy Phase 1AF — reversible Flow request/projection control plane.
--
-- This migration is intentionally additive. It does not modify a pre-existing
-- candidate row, delete a file, or represent hard-purge eligibility. Runtime
-- enforcement and the separately gated intake switch live in application code.

SET LOCAL search_path = public, pg_catalog;

CREATE TABLE public.candidate_privacy_requests (
  request_id uuid PRIMARY KEY,
  directive_id uuid UNIQUE,
  action text NOT NULL,
  authority_type text NOT NULL,
  actor_user_id integer NOT NULL REFERENCES public.users(id),
  reason_code text NOT NULL,
  state text NOT NULL DEFAULT 'accepted_local',
  version integer NOT NULL DEFAULT 1,
  effective_at timestamp with time zone NOT NULL DEFAULT now(),
  last_delivery_status text NOT NULL DEFAULT 'pending',
  last_error_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT candidate_privacy_requests_action_check
    CHECK (action IN ('withdraw_global_matching', 'request_erasure')),
  CONSTRAINT candidate_privacy_requests_authority_check
    CHECK (authority_type IN ('verified_candidate', 'privacy_operator')),
  CONSTRAINT candidate_privacy_requests_reason_check
    CHECK (reason_code IN (
      'candidate_global_opt_out',
      'candidate_erasure_request',
      'verified_support_request'
    )),
  CONSTRAINT candidate_privacy_requests_state_check
    CHECK (state IN (
      'accepted_local',
      'delivery_pending',
      'memory_active',
      'needs_review',
      'released',
      'superseded'
    )),
  CONSTRAINT candidate_privacy_requests_delivery_check
    CHECK (last_delivery_status IN ('pending', 'leased', 'retry', 'delivered', 'terminal')),
  CONSTRAINT candidate_privacy_requests_version_check CHECK (version >= 1),
  CONSTRAINT candidate_privacy_requests_error_code_check
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,80}$')
);

CREATE INDEX candidate_privacy_requests_actor_idx
  ON public.candidate_privacy_requests(actor_user_id, created_at DESC);
CREATE INDEX candidate_privacy_requests_directive_version_idx
  ON public.candidate_privacy_requests(directive_id, version)
  WHERE directive_id IS NOT NULL;
CREATE INDEX candidate_privacy_requests_active_idx
  ON public.candidate_privacy_requests(state, effective_at)
  WHERE state IN ('accepted_local', 'delivery_pending', 'memory_active', 'needs_review');

CREATE TABLE public.candidate_privacy_request_events (
  event_id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.candidate_privacy_requests(request_id),
  event_type text NOT NULL,
  action text NOT NULL,
  authority_type text NOT NULL,
  actor_user_id integer NOT NULL REFERENCES public.users(id),
  evidence_ref uuid NOT NULL,
  reason_code text NOT NULL,
  prior_state text,
  resulting_state text NOT NULL,
  expected_version integer,
  resulting_version integer NOT NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT candidate_privacy_request_events_type_check
    CHECK (event_type IN ('accepted', 'delivery_succeeded', 'delivery_retry', 'remote_projection')),
  CONSTRAINT candidate_privacy_request_events_action_check
    CHECK (action IN ('withdraw_global_matching', 'request_erasure')),
  CONSTRAINT candidate_privacy_request_events_authority_check
    CHECK (authority_type IN ('verified_candidate', 'privacy_operator')),
  CONSTRAINT candidate_privacy_request_events_reason_check
    CHECK (reason_code IN (
      'candidate_global_opt_out',
      'candidate_erasure_request',
      'verified_support_request'
    )),
  CONSTRAINT candidate_privacy_request_events_state_check
    CHECK (
      (prior_state IS NULL OR prior_state IN (
        'accepted_local', 'delivery_pending', 'memory_active', 'needs_review', 'released', 'superseded'
      ))
      AND resulting_state IN (
        'accepted_local', 'delivery_pending', 'memory_active', 'needs_review', 'released', 'superseded'
      )
    ),
  CONSTRAINT candidate_privacy_request_events_version_check
    CHECK (resulting_version >= 1 AND (expected_version IS NULL OR expected_version >= 1))
);

CREATE INDEX candidate_privacy_request_events_request_idx
  ON public.candidate_privacy_request_events(request_id, resulting_version, occurred_at);

CREATE TABLE public.candidate_privacy_subject_links (
  link_id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.candidate_privacy_requests(request_id),
  subject_type text NOT NULL,
  candidate_user_id integer REFERENCES public.users(id),
  application_id integer REFERENCES public.applications(id),
  candidate_resume_id integer REFERENCES public.candidate_resumes(id),
  talent_pool_id integer REFERENCES public.talent_pool(id),
  job_sourced_candidate_id integer REFERENCES public.job_sourced_candidates(id),
  organization_id integer REFERENCES public.organizations(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT candidate_privacy_subject_links_type_check
    CHECK (subject_type IN (
      'candidate_user', 'application', 'candidate_resume', 'talent_pool', 'job_sourced_candidate'
    )),
  CONSTRAINT candidate_privacy_subject_links_anchor_check
    CHECK (
      num_nonnulls(
        candidate_user_id,
        application_id,
        candidate_resume_id,
        talent_pool_id,
        job_sourced_candidate_id
      ) = 1
      AND (subject_type = 'candidate_user') = (candidate_user_id IS NOT NULL)
      AND (subject_type = 'application') = (application_id IS NOT NULL)
      AND (subject_type = 'candidate_resume') = (candidate_resume_id IS NOT NULL)
      AND (subject_type = 'talent_pool') = (talent_pool_id IS NOT NULL)
      AND (subject_type = 'job_sourced_candidate') = (job_sourced_candidate_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX candidate_privacy_subject_links_user_idx
  ON public.candidate_privacy_subject_links(request_id, candidate_user_id)
  WHERE candidate_user_id IS NOT NULL;
CREATE UNIQUE INDEX candidate_privacy_subject_links_application_idx
  ON public.candidate_privacy_subject_links(request_id, application_id)
  WHERE application_id IS NOT NULL;
CREATE UNIQUE INDEX candidate_privacy_subject_links_resume_idx
  ON public.candidate_privacy_subject_links(request_id, candidate_resume_id)
  WHERE candidate_resume_id IS NOT NULL;
CREATE UNIQUE INDEX candidate_privacy_subject_links_talent_pool_idx
  ON public.candidate_privacy_subject_links(request_id, talent_pool_id)
  WHERE talent_pool_id IS NOT NULL;
CREATE UNIQUE INDEX candidate_privacy_subject_links_sourced_idx
  ON public.candidate_privacy_subject_links(request_id, job_sourced_candidate_id)
  WHERE job_sourced_candidate_id IS NOT NULL;
CREATE INDEX candidate_privacy_subject_links_org_idx
  ON public.candidate_privacy_subject_links(organization_id, subject_type);

CREATE TABLE public.candidate_privacy_outbox (
  outbox_id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES public.candidate_privacy_requests(request_id),
  operation text NOT NULL DEFAULT 'create_directive',
  state text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamp with time zone NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  last_error_code text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT candidate_privacy_outbox_operation_check CHECK (operation = 'create_directive'),
  CONSTRAINT candidate_privacy_outbox_state_check
    CHECK (state IN ('pending', 'leased', 'retry', 'succeeded', 'terminal')),
  CONSTRAINT candidate_privacy_outbox_attempt_check CHECK (attempt_count >= 0),
  CONSTRAINT candidate_privacy_outbox_lease_check CHECK (
    (state = 'leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'leased' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT candidate_privacy_outbox_error_code_check
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,80}$')
);

CREATE INDEX candidate_privacy_outbox_due_idx
  ON public.candidate_privacy_outbox(available_at, created_at)
  WHERE state IN ('pending', 'retry');
CREATE INDEX candidate_privacy_outbox_lease_idx
  ON public.candidate_privacy_outbox(lease_expires_at)
  WHERE state = 'leased';

CREATE TABLE public.candidate_privacy_remote_projection (
  directive_id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE REFERENCES public.candidate_privacy_requests(request_id),
  action text NOT NULL,
  scope text NOT NULL,
  state text NOT NULL,
  decision text NOT NULL,
  version integer NOT NULL,
  effective_at timestamp with time zone NOT NULL,
  generation bigint NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT candidate_privacy_remote_action_check
    CHECK (action IN ('withdraw_global_matching', 'request_erasure')),
  CONSTRAINT candidate_privacy_remote_scope_check
    CHECK (scope IN ('global_matching', 'active_profile')),
  CONSTRAINT candidate_privacy_remote_state_check
    CHECK (state IN ('requested', 'verified', 'active_quarantine', 'needs_review', 'released', 'superseded')),
  CONSTRAINT candidate_privacy_remote_decision_check
    CHECK (decision IN ('allow', 'block_global', 'block_all', 'review')),
  CONSTRAINT candidate_privacy_remote_version_check CHECK (version >= 1),
  CONSTRAINT candidate_privacy_remote_generation_check CHECK (generation >= 0)
);

CREATE INDEX candidate_privacy_remote_active_idx
  ON public.candidate_privacy_remote_projection(decision, effective_at)
  WHERE decision <> 'allow';
CREATE INDEX candidate_privacy_remote_generation_idx
  ON public.candidate_privacy_remote_projection(generation, directive_id);

CREATE TABLE public.candidate_privacy_sync_state (
  consumer_name text PRIMARY KEY,
  cursor bigint NOT NULL DEFAULT 0,
  active_generation bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'uninitialized',
  last_success_at timestamp with time zone,
  last_snapshot_at timestamp with time zone,
  last_error_code text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT candidate_privacy_sync_state_name_check CHECK (consumer_name = 'flow'),
  CONSTRAINT candidate_privacy_sync_state_cursor_check CHECK (cursor >= 0),
  CONSTRAINT candidate_privacy_sync_state_generation_check CHECK (active_generation >= 0),
  CONSTRAINT candidate_privacy_sync_state_status_check
    CHECK (status IN ('uninitialized', 'healthy', 'stale', 'rebuilding', 'needs_reconciliation')),
  CONSTRAINT candidate_privacy_sync_state_error_code_check
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,80}$')
);

ALTER TABLE public.talent_pool
  ADD COLUMN removed_at timestamp with time zone,
  ADD COLUMN removed_by_user_id integer REFERENCES public.users(id),
  ADD COLUMN removal_reason text,
  ADD CONSTRAINT talent_pool_removal_shape_check CHECK (
    (removed_at IS NULL AND removed_by_user_id IS NULL AND removal_reason IS NULL)
    OR (
      removed_at IS NOT NULL
      AND removed_by_user_id IS NOT NULL
      AND removal_reason IN ('organization_pool_removal', 'converted_to_application')
    )
  );

-- The old uniqueness included removed memberships, which would make the
-- reversible row an accidental permanent block on later organization-local
-- re-addition. Preserve uniqueness only among active memberships.
DROP INDEX public.talent_pool_recruiter_email_unique;
CREATE UNIQUE INDEX talent_pool_recruiter_email_unique
  ON public.talent_pool(recruiter_id, lower(email))
  WHERE removed_at IS NULL;

CREATE INDEX talent_pool_active_recruiter_idx
  ON public.talent_pool(recruiter_id, created_at DESC)
  WHERE removed_at IS NULL;
CREATE INDEX talent_pool_active_organization_idx
  ON public.talent_pool(organization_id, created_at DESC)
  WHERE removed_at IS NULL;

CREATE TABLE public.talent_pool_membership_events (
  event_id uuid PRIMARY KEY,
  talent_pool_id integer NOT NULL REFERENCES public.talent_pool(id),
  organization_id integer REFERENCES public.organizations(id),
  actor_user_id integer NOT NULL REFERENCES public.users(id),
  event_type text NOT NULL,
  reason_code text NOT NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT talent_pool_membership_events_type_check CHECK (event_type IN ('removed', 'restored')),
  CONSTRAINT talent_pool_membership_events_reason_check
    CHECK (reason_code IN ('organization_pool_removal', 'converted_to_application', 'operator_restore'))
);

CREATE INDEX talent_pool_membership_events_candidate_idx
  ON public.talent_pool_membership_events(talent_pool_id, occurred_at);
CREATE INDEX talent_pool_membership_events_org_idx
  ON public.talent_pool_membership_events(organization_id, occurred_at);

CREATE FUNCTION public.flow_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only candidate privacy record';
END;
$$;

CREATE TRIGGER candidate_privacy_request_events_append_only
  BEFORE UPDATE OR DELETE ON public.candidate_privacy_request_events
  FOR EACH ROW EXECUTE FUNCTION public.flow_reject_append_only_mutation();

CREATE TRIGGER talent_pool_membership_events_append_only
  BEFORE UPDATE OR DELETE ON public.talent_pool_membership_events
  FOR EACH ROW EXECUTE FUNCTION public.flow_reject_append_only_mutation();

COMMENT ON TABLE public.candidate_privacy_requests IS
  'Reversible Flow-local privacy request projection. No hard-purge state.';
COMMENT ON TABLE public.candidate_privacy_outbox IS
  'Payload-free durable Memory delivery intent; identifiers are re-read transiently from Flow source rows.';
COMMENT ON TABLE public.candidate_privacy_remote_projection IS
  'Minimal Memory directive projection; no raw identifiers or HMAC tokens.';
COMMENT ON TABLE public.talent_pool_membership_events IS
  'Append-only organization-scoped pool removal/restore audit; never global privacy authority.';
