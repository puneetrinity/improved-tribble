-- Wave 3A — organization-scoped, append-only decision-event spine.
-- Additive only. Existing application/history rows are not backfilled.

SET LOCAL search_path = public, pg_catalog;

CREATE SEQUENCE public.decision_event_sequence
  AS bigint
  MINVALUE 1
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

CREATE TABLE public.decision_events (
  event_id uuid PRIMARY KEY,
  event_sequence bigint NOT NULL DEFAULT nextval('public.decision_event_sequence'),
  aggregate_sequence bigint NOT NULL,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  aggregate_type text NOT NULL,
  aggregate_id integer NOT NULL,
  job_id integer NOT NULL,
  actor_user_id integer NOT NULL,
  requesting_actor_user_id integer,
  action_code text NOT NULL,
  source_surface text NOT NULL,
  event_schema_version integer NOT NULL,
  taxonomy_version integer NOT NULL,
  rubric_id uuid,
  rubric_version integer,
  rubric_approval_mode text,
  jd_digest_version integer,
  rating_contract_version text,
  recommendation_action text,
  recommendation_model_version text,
  recommendation_input_version integer,
  reason_code text,
  idempotency_key text,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT decision_events_event_sequence_unique UNIQUE (event_sequence),
  CONSTRAINT decision_events_event_sequence_positive CHECK (event_sequence > 0),
  CONSTRAINT decision_events_aggregate_sequence_positive CHECK (aggregate_sequence > 0),
  CONSTRAINT decision_events_aggregate_identity_positive CHECK (aggregate_id > 0 AND job_id > 0),
  CONSTRAINT decision_events_actor_positive CHECK (actor_user_id > 0),
  CONSTRAINT decision_events_requesting_actor_positive CHECK (
    requesting_actor_user_id IS NULL OR requesting_actor_user_id > 0
  ),
  CONSTRAINT decision_events_aggregate_type_v1 CHECK (aggregate_type = 'application'),
  CONSTRAINT decision_events_action_v1 CHECK (action_code = 'application_stage_moved'),
  CONSTRAINT decision_events_source_v1 CHECK (source_surface = 'applications.stage_patch'),
  CONSTRAINT decision_events_schema_version_v1 CHECK (event_schema_version = 1),
  CONSTRAINT decision_events_taxonomy_version_v1 CHECK (taxonomy_version = 1),
  CONSTRAINT decision_events_rubric_shape CHECK (
    (rubric_id IS NULL AND rubric_version IS NULL AND rubric_approval_mode IS NULL)
    OR (
      rubric_id IS NOT NULL
      AND rubric_version > 0
      AND rubric_approval_mode ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
    )
  ),
  CONSTRAINT decision_events_jd_digest_version_positive CHECK (
    jd_digest_version IS NULL OR jd_digest_version > 0
  ),
  CONSTRAINT decision_events_rating_contract_version_bounded CHECK (
    rating_contract_version IS NULL
    OR (
      rating_contract_version = btrim(rating_contract_version)
      AND octet_length(rating_contract_version) BETWEEN 1 AND 80
      AND rating_contract_version ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
    )
  ),
  CONSTRAINT decision_events_recommendation_action_v1 CHECK (
    recommendation_action IS NULL OR recommendation_action IN ('advance', 'hold', 'reject')
  ),
  CONSTRAINT decision_events_recommendation_model_bounded CHECK (
    recommendation_model_version IS NULL
    OR (
      recommendation_model_version = btrim(recommendation_model_version)
      AND octet_length(recommendation_model_version) BETWEEN 1 AND 120
    )
  ),
  CONSTRAINT decision_events_recommendation_input_positive CHECK (
    recommendation_input_version IS NULL OR recommendation_input_version > 0
  ),
  CONSTRAINT decision_events_recommendation_shape CHECK (
    recommendation_action IS NOT NULL
    OR (recommendation_model_version IS NULL AND recommendation_input_version IS NULL)
  ),
  CONSTRAINT decision_events_reason_code_bounded CHECK (
    reason_code IS NULL OR reason_code ~ '^[a-z0-9][a-z0-9_]{0,79}$'
  ),
  CONSTRAINT decision_events_idempotency_key_bounded CHECK (
    idempotency_key IS NULL
    OR (
      idempotency_key = btrim(idempotency_key)
      AND octet_length(idempotency_key) BETWEEN 1 AND 200
    )
  ),
  CONSTRAINT decision_events_before_state_v1 CHECK (
    jsonb_typeof(before_state) = 'object'
    AND before_state ? 'stage_id'
    AND before_state = jsonb_build_object('stage_id', before_state->'stage_id')
    AND octet_length(before_state::text) <= 1024
    AND (
      before_state->'stage_id' = 'null'::jsonb
      OR (
        jsonb_typeof(before_state->'stage_id') = 'number'
        AND before_state->>'stage_id' ~ '^[1-9][0-9]*$'
        AND (before_state->>'stage_id')::numeric <= 2147483647
      )
    )
  ),
  CONSTRAINT decision_events_after_state_v1 CHECK (
    jsonb_typeof(after_state) = 'object'
    AND after_state ? 'stage_id'
    AND after_state = jsonb_build_object('stage_id', after_state->'stage_id')
    AND octet_length(after_state::text) <= 1024
    AND jsonb_typeof(after_state->'stage_id') = 'number'
    AND after_state->>'stage_id' ~ '^[1-9][0-9]*$'
    AND (after_state->>'stage_id')::numeric <= 2147483647
  ),
  CONSTRAINT decision_events_state_changed CHECK (
    before_state->'stage_id' IS DISTINCT FROM after_state->'stage_id'
  ),
  CONSTRAINT decision_events_aggregate_sequence_unique
    UNIQUE (organization_id, aggregate_type, aggregate_id, aggregate_sequence)
);

ALTER SEQUENCE public.decision_event_sequence
  OWNED BY public.decision_events.event_sequence;

CREATE INDEX decision_events_organization_sequence_idx
  ON public.decision_events(organization_id, event_sequence);
CREATE INDEX decision_events_aggregate_sequence_idx
  ON public.decision_events(organization_id, aggregate_type, aggregate_id, event_sequence);
CREATE INDEX decision_events_job_sequence_idx
  ON public.decision_events(organization_id, job_id, event_sequence);
CREATE INDEX decision_events_action_time_idx
  ON public.decision_events(organization_id, action_code, occurred_at, event_sequence);
CREATE UNIQUE INDEX decision_events_idempotency_key_unique
  ON public.decision_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE FUNCTION public.flow_reject_decision_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'DECISION_EVENT_APPEND_ONLY';
END;
$$;

CREATE TRIGGER decision_events_append_only
  BEFORE UPDATE OR DELETE ON public.decision_events
  FOR EACH ROW EXECUTE FUNCTION public.flow_reject_decision_event_mutation();

CREATE TRIGGER decision_events_truncate_append_only
  BEFORE TRUNCATE ON public.decision_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.flow_reject_decision_event_mutation();

COMMENT ON TABLE public.decision_events IS
  'Append-only organization-scoped material-decision authority; no candidate PII or inferred history.';
COMMENT ON COLUMN public.decision_events.rubric_id IS
  'Nullable Wave-5 rubric reference. A JD digest is never a rubric.';
COMMENT ON COLUMN public.decision_events.idempotency_key IS
  'Reserved for a future stable command retry key; Wave 3A leaves it NULL.';
