-- Wave 3C — mutable, generation-fenced delivery state for immutable 3B intents.
-- Absence is the canonical never-claimed pending state; no intent is backfilled.

SET LOCAL search_path = public, pg_catalog;

CREATE TABLE public.decision_projection_delivery_state (
  event_id uuid PRIMARY KEY
    REFERENCES public.decision_projection_outbox(event_id) ON DELETE RESTRICT,
  state text NOT NULL,
  attempt_count integer NOT NULL,
  lease_generation bigint NOT NULL,
  lease_token uuid,
  lease_expires_at timestamp with time zone,
  available_at timestamp with time zone NOT NULL,
  acknowledged_at timestamp with time zone,
  terminal_at timestamp with time zone,
  last_error_code text,
  receiver_status text,
  updated_at timestamp with time zone NOT NULL,

  CONSTRAINT decision_projection_delivery_state_state_check
    CHECK (state IN ('leased','retry','acknowledged','terminal')),
  CONSTRAINT decision_projection_delivery_state_attempt_count_check
    CHECK (attempt_count BETWEEN 1 AND 20),
  CONSTRAINT decision_projection_delivery_state_generation_check
    CHECK (lease_generation > 0),
  CONSTRAINT decision_projection_delivery_state_error_code_check
    CHECK (
      last_error_code IS NULL OR last_error_code IN (
        'timeout','network','remote_408','remote_425','remote_429','remote_5xx',
        'remote_400','remote_401','remote_403','payload_conflict','remote_422',
        'invalid_response','internal_error'
      )
    ),
  CONSTRAINT decision_projection_delivery_state_receiver_status_check
    CHECK (receiver_status IS NULL OR receiver_status IN ('inserted','replayed')),
  CONSTRAINT decision_projection_delivery_state_shape_check CHECK (
    (
      state = 'leased'
      AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND acknowledged_at IS NULL AND terminal_at IS NULL
      AND last_error_code IS NULL AND receiver_status IS NULL
    ) OR (
      state = 'retry'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND acknowledged_at IS NULL AND terminal_at IS NULL
      AND last_error_code IS NOT NULL AND receiver_status IS NULL
    ) OR (
      state = 'acknowledged'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND acknowledged_at IS NOT NULL AND terminal_at IS NULL
      AND last_error_code IS NULL AND receiver_status IS NOT NULL
    ) OR (
      state = 'terminal'
      AND lease_token IS NULL AND lease_expires_at IS NULL
      AND acknowledged_at IS NULL AND terminal_at IS NOT NULL
      AND last_error_code IS NOT NULL AND receiver_status IS NULL
    )
  )
);

CREATE INDEX decision_projection_delivery_state_eligibility_idx
  ON public.decision_projection_delivery_state(state, available_at);

CREATE FUNCTION public.claim_decision_projection_delivery(
  p_lease_ms integer,
  p_max_attempts integer
)
RETURNS TABLE (
  event_id uuid,
  delivery_sequence bigint,
  source_event_sequence bigint,
  organization_id integer,
  destination text,
  payload_schema_version integer,
  source_system text,
  subject_type text,
  subject_id integer,
  job_id integer,
  action_code text,
  taxonomy_version integer,
  rubric_id uuid,
  rubric_version integer,
  rubric_approval_mode text,
  jd_digest_version integer,
  recommendation_action text,
  reason_code text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamp with time zone,
  lease_token uuid,
  lease_generation bigint,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_event_id uuid;
  v_now timestamp with time zone := clock_timestamp();
  v_token uuid := gen_random_uuid();
BEGIN
  IF p_lease_ms < 1000 OR p_lease_ms > 30000
     OR p_max_attempts < 1 OR p_max_attempts > 20 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='DECISION_DELIVERY_INPUT_REFUSED';
  END IF;

  -- A worker that dies on its final permitted attempt cannot call fail().
  -- Close that expired generation here before considering new work so it is
  -- durable terminal truth and continues to block only its own organization.
  UPDATE public.decision_projection_delivery_state AS expired
     SET state='terminal',lease_token=NULL,lease_expires_at=NULL,available_at=v_now,
         acknowledged_at=NULL,terminal_at=v_now,last_error_code='internal_error',
         receiver_status=NULL,updated_at=v_now
   WHERE expired.state='leased' AND expired.lease_expires_at <= v_now
     AND expired.attempt_count >= p_max_attempts;

  SELECT candidate.event_id
    INTO v_event_id
    FROM public.decision_projection_outbox AS candidate
    LEFT JOIN public.decision_projection_delivery_state AS candidate_state
      ON candidate_state.event_id = candidate.event_id
   WHERE candidate.destination = 'memory.organization_decision_inbox.v1'
     AND COALESCE(candidate_state.attempt_count, 0) < p_max_attempts
     AND (
       candidate_state.event_id IS NULL
       OR (candidate_state.state = 'retry' AND candidate_state.available_at <= v_now)
       OR (candidate_state.state = 'leased' AND candidate_state.lease_expires_at <= v_now)
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.decision_projection_outbox AS earlier
         LEFT JOIN public.decision_projection_delivery_state AS earlier_state
           ON earlier_state.event_id = earlier.event_id
        WHERE earlier.organization_id = candidate.organization_id
          AND earlier.delivery_sequence < candidate.delivery_sequence
          AND COALESCE(earlier_state.state, 'pending') <> 'acknowledged'
     )
   ORDER BY candidate.delivery_sequence
   FOR UPDATE OF candidate SKIP LOCKED
   LIMIT 1;

  IF v_event_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.decision_projection_delivery_state AS delivery (
    event_id,state,attempt_count,lease_generation,lease_token,lease_expires_at,
    available_at,acknowledged_at,terminal_at,last_error_code,receiver_status,updated_at
  ) VALUES (
    v_event_id,'leased',1,1,v_token,v_now + make_interval(secs => p_lease_ms / 1000.0),
    v_now,NULL,NULL,NULL,NULL,v_now
  )
  ON CONFLICT ON CONSTRAINT decision_projection_delivery_state_pkey DO UPDATE SET
    state='leased',
    attempt_count=delivery.attempt_count + 1,
    lease_generation=delivery.lease_generation + 1,
    lease_token=v_token,
    lease_expires_at=v_now + make_interval(secs => p_lease_ms / 1000.0),
    available_at=v_now,
    acknowledged_at=NULL,
    terminal_at=NULL,
    last_error_code=NULL,
    receiver_status=NULL,
    updated_at=v_now
  WHERE (
      (delivery.state='retry' AND delivery.available_at <= v_now)
      OR (delivery.state='leased' AND delivery.lease_expires_at <= v_now)
    )
    AND delivery.attempt_count < p_max_attempts;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT intent.event_id,intent.delivery_sequence,intent.source_event_sequence,
         intent.organization_id,intent.destination,intent.payload_schema_version,
         intent.source_system,intent.subject_type,intent.subject_id,intent.job_id,
         intent.action_code,intent.taxonomy_version,intent.rubric_id,intent.rubric_version,
         intent.rubric_approval_mode,intent.jd_digest_version,intent.recommendation_action,
         intent.reason_code,intent.before_state,intent.after_state,intent.occurred_at,
         delivery.lease_token,delivery.lease_generation,delivery.attempt_count
    FROM public.decision_projection_outbox AS intent
    JOIN public.decision_projection_delivery_state AS delivery USING (event_id)
   WHERE intent.event_id = v_event_id;
END;
$$;

CREATE FUNCTION public.ack_decision_projection_delivery(
  p_event_id uuid,
  p_lease_token uuid,
  p_generation bigint,
  p_delivery_sequence bigint,
  p_receiver_status text
)
RETURNS TABLE (outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_generation < 1 OR p_delivery_sequence < 1
     OR p_receiver_status NOT IN ('inserted','replayed') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='DECISION_DELIVERY_INPUT_REFUSED';
  END IF;

  UPDATE public.decision_projection_delivery_state AS delivery
     SET state='acknowledged',lease_token=NULL,lease_expires_at=NULL,available_at=v_now,
         acknowledged_at=v_now,terminal_at=NULL,last_error_code=NULL,
         receiver_status=p_receiver_status,updated_at=v_now
    FROM public.decision_projection_outbox AS intent
   WHERE delivery.event_id=p_event_id
     AND intent.event_id=delivery.event_id
     AND intent.delivery_sequence=p_delivery_sequence
     AND delivery.state='leased'
     AND delivery.lease_token=p_lease_token
     AND delivery.lease_generation=p_generation
     AND delivery.lease_expires_at > v_now;
  IF FOUND THEN
    RETURN QUERY SELECT 'acknowledged'::text;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.decision_projection_delivery_state AS delivery
      JOIN public.decision_projection_outbox AS intent USING (event_id)
     WHERE delivery.event_id=p_event_id
       AND intent.delivery_sequence=p_delivery_sequence
       AND delivery.state='acknowledged'
       AND delivery.lease_generation=p_generation
       AND delivery.receiver_status=p_receiver_status
  ) THEN
    RETURN QUERY SELECT 'acknowledged'::text;
  END IF;
END;
$$;

CREATE FUNCTION public.fail_decision_projection_delivery(
  p_event_id uuid,
  p_lease_token uuid,
  p_generation bigint,
  p_error_code text,
  p_retryable boolean,
  p_max_attempts integer
)
RETURNS TABLE (outcome text, resulting_state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now timestamp with time zone := clock_timestamp();
BEGIN
  IF p_generation < 1 OR p_max_attempts < 1 OR p_max_attempts > 20
     OR p_error_code NOT IN (
       'timeout','network','remote_408','remote_425','remote_429','remote_5xx',
       'remote_400','remote_401','remote_403','payload_conflict','remote_422',
       'invalid_response','internal_error'
     ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='DECISION_DELIVERY_INPUT_REFUSED';
  END IF;

  UPDATE public.decision_projection_delivery_state
     SET state=CASE WHEN p_retryable AND attempt_count < p_max_attempts THEN 'retry' ELSE 'terminal' END,
         lease_token=NULL,lease_expires_at=NULL,
         available_at=CASE
           WHEN p_retryable AND attempt_count < p_max_attempts
             THEN v_now + make_interval(secs => LEAST(300, power(2, LEAST(attempt_count - 1, 8)))::double precision)
           ELSE v_now
         END,
         acknowledged_at=NULL,
         terminal_at=CASE WHEN p_retryable AND attempt_count < p_max_attempts THEN NULL ELSE v_now END,
         last_error_code=p_error_code,receiver_status=NULL,updated_at=v_now
   WHERE event_id=p_event_id AND state='leased' AND lease_token=p_lease_token
     AND lease_generation=p_generation AND lease_expires_at > v_now
  RETURNING 'recorded'::text, state INTO outcome, resulting_state;
  IF FOUND THEN
    RETURN NEXT;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_decision_projection_delivery(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ack_decision_projection_delivery(uuid,uuid,bigint,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_decision_projection_delivery(uuid,uuid,bigint,text,boolean,integer) FROM PUBLIC;

COMMENT ON TABLE public.decision_projection_delivery_state IS
  'Mutable, generation-fenced delivery state for immutable decision projection intents; no payload or identity copy.';
