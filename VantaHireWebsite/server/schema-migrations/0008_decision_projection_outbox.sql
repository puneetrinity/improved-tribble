-- Wave 3B — immutable, organization-scoped decision-projection intents.
-- Additive only. Pre-0008 decision events are deliberately not backfilled.

SET LOCAL search_path = public, pg_catalog;

CREATE SEQUENCE public.decision_projection_outbox_sequence
  AS bigint
  MINVALUE 1
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

CREATE TABLE public.decision_projection_outbox (
  event_id uuid PRIMARY KEY REFERENCES public.decision_events(event_id) ON DELETE RESTRICT,
  delivery_sequence bigint NOT NULL DEFAULT nextval('public.decision_projection_outbox_sequence'),
  source_event_sequence bigint NOT NULL,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  destination text NOT NULL,
  payload_schema_version integer NOT NULL,
  source_system text NOT NULL,
  subject_type text NOT NULL,
  subject_id integer NOT NULL,
  job_id integer NOT NULL,
  action_code text NOT NULL,
  taxonomy_version integer NOT NULL,
  rubric_id uuid,
  rubric_version integer,
  rubric_approval_mode text,
  jd_digest_version integer,
  recommendation_action text,
  reason_code text,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT decision_projection_outbox_delivery_sequence_unique UNIQUE (delivery_sequence),
  CONSTRAINT decision_projection_outbox_source_event_sequence_unique UNIQUE (source_event_sequence),
  CONSTRAINT decision_projection_outbox_delivery_sequence_positive CHECK (delivery_sequence > 0),
  CONSTRAINT decision_projection_outbox_source_event_sequence_positive CHECK (source_event_sequence > 0),
  CONSTRAINT decision_projection_outbox_identity_positive CHECK (subject_id > 0 AND job_id > 0),
  CONSTRAINT decision_projection_outbox_destination_v1 CHECK (
    destination = 'memory.organization_decision_inbox.v1'
  ),
  CONSTRAINT decision_projection_outbox_schema_version_v1 CHECK (payload_schema_version = 1),
  CONSTRAINT decision_projection_outbox_source_system_v1 CHECK (source_system = 'flow'),
  CONSTRAINT decision_projection_outbox_subject_type_v1 CHECK (subject_type = 'application'),
  CONSTRAINT decision_projection_outbox_action_v1 CHECK (action_code = 'application_stage_moved'),
  CONSTRAINT decision_projection_outbox_taxonomy_positive CHECK (taxonomy_version > 0),
  CONSTRAINT decision_projection_outbox_rubric_shape CHECK (
    (rubric_id IS NULL AND rubric_version IS NULL AND rubric_approval_mode IS NULL)
    OR (
      rubric_id IS NOT NULL
      AND rubric_version > 0
      AND rubric_approval_mode ~ '^[a-z0-9][a-z0-9_-]{0,79}$'
    )
  ),
  CONSTRAINT decision_projection_outbox_jd_digest_version_positive CHECK (
    jd_digest_version IS NULL OR jd_digest_version > 0
  ),
  CONSTRAINT decision_projection_outbox_recommendation_action_v1 CHECK (
    recommendation_action IS NULL OR recommendation_action IN ('advance', 'hold', 'reject')
  ),
  CONSTRAINT decision_projection_outbox_reason_code_bounded CHECK (
    reason_code IS NULL OR reason_code ~ '^[a-z0-9][a-z0-9_]{0,79}$'
  ),
  CONSTRAINT decision_projection_outbox_before_state_v1 CHECK (
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
  CONSTRAINT decision_projection_outbox_after_state_v1 CHECK (
    jsonb_typeof(after_state) = 'object'
    AND after_state ? 'stage_id'
    AND after_state = jsonb_build_object('stage_id', after_state->'stage_id')
    AND octet_length(after_state::text) <= 1024
    AND jsonb_typeof(after_state->'stage_id') = 'number'
    AND after_state->>'stage_id' ~ '^[1-9][0-9]*$'
    AND (after_state->>'stage_id')::numeric <= 2147483647
  ),
  CONSTRAINT decision_projection_outbox_state_changed CHECK (
    before_state->'stage_id' IS DISTINCT FROM after_state->'stage_id'
  )
);

ALTER SEQUENCE public.decision_projection_outbox_sequence
  OWNED BY public.decision_projection_outbox.delivery_sequence;

CREATE INDEX decision_projection_outbox_organization_sequence_idx
  ON public.decision_projection_outbox(organization_id, delivery_sequence);
CREATE INDEX decision_projection_outbox_destination_sequence_idx
  ON public.decision_projection_outbox(destination, delivery_sequence);

CREATE FUNCTION public.flow_reject_decision_projection_outbox_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    PERFORM 1 FROM public.decision_projection_outbox LIMIT 1;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  RAISE EXCEPTION USING
    ERRCODE = '55000',
    MESSAGE = 'DECISION_OUTBOX_APPEND_ONLY';
END;
$$;

CREATE TRIGGER decision_projection_outbox_append_only
  BEFORE UPDATE OR DELETE ON public.decision_projection_outbox
  FOR EACH ROW EXECUTE FUNCTION public.flow_reject_decision_projection_outbox_mutation();

CREATE TRIGGER decision_projection_outbox_truncate_append_only
  BEFORE TRUNCATE ON public.decision_projection_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION public.flow_reject_decision_projection_outbox_mutation();

COMMENT ON TABLE public.decision_projection_outbox IS
  'Append-only Flow intent for a later tenant-private Memory decision projection; no candidate PII or delivery state.';
