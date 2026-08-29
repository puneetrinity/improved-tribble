-- Wave 2E — truthful attributable resume delivery attempts.
-- Forward-only and additive: historical applications/downloaded_at values are untouched.

SET LOCAL search_path = public, pg_catalog;

CREATE TABLE public.resume_access_attempts (
  id bigserial PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE,
  application_id integer REFERENCES public.applications(id) ON DELETE SET NULL,
  organization_id integer REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_user_id integer REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  delivery_mode text NOT NULL,
  status text NOT NULL DEFAULT 'attempted',
  failure_code text,
  response_status integer,
  attempted_at timestamp with time zone NOT NULL DEFAULT now(),
  terminal_at timestamp with time zone,
  CONSTRAINT resume_access_attempts_actor_role_check
    CHECK (actor_role IN ('recruiter', 'hiring_manager', 'candidate', 'super_admin')),
  CONSTRAINT resume_access_attempts_delivery_mode_check
    CHECK (delivery_mode IN ('gcs_stream', 'http_redirect', 'stored_text', 'missing', 'unsupported')),
  CONSTRAINT resume_access_attempts_status_check
    CHECK (status IN ('attempted', 'completed', 'failed', 'redirected')),
  CONSTRAINT resume_access_attempts_failure_code_check
    CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,80}$'),
  CONSTRAINT resume_access_attempts_response_status_check
    CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  CONSTRAINT resume_access_attempts_terminal_check CHECK (
    (status = 'attempted' AND terminal_at IS NULL AND failure_code IS NULL)
    OR (status IN ('completed', 'redirected') AND terminal_at IS NOT NULL AND failure_code IS NULL)
    OR (status = 'failed' AND terminal_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);

CREATE INDEX resume_access_attempts_application_idx
  ON public.resume_access_attempts(application_id, attempted_at DESC);
CREATE INDEX resume_access_attempts_actor_idx
  ON public.resume_access_attempts(actor_user_id, attempted_at DESC);
