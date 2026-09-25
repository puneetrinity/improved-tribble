-- 4E: read-only, keyed capture coverage. No table, backfill or command writer.
CREATE INDEX flow_hist_app_seq_idx ON public.decision_projection_outbox
  (organization_id, subject_id, source_event_sequence);

CREATE FUNCTION public.flow_read_candidate_history_context(
  p_organization integer, p_application integer, p_job integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '3s'
SET lock_timeout = '500ms'
SET idle_in_transaction_session_timeout = '5s'
AS $$
DECLARE
  ref public.organization_candidate_references%ROWTYPE;
  intake public.organization_candidate_memory_outbox%ROWTYPE;
  latest public.decision_projection_outbox%ROWTYPE;
  captured bigint;
  capture_gap boolean;
  delivery text;
BEGIN
  IF p_organization IS NULL OR p_organization < 1 OR p_application IS NULL
     OR p_application < 1 OR p_job IS NULL OR p_job < 1 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='HISTORY_KEYS_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
    WHERE a.id=p_application AND a.organization_id=p_organization
      AND a.job_id=p_job AND j.organization_id=p_organization
  ) THEN RETURN NULL; END IF;
  SELECT * INTO ref FROM public.organization_candidate_references
    WHERE organization_id=p_organization AND application_id=p_application;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','outside_private_history_scope');
  END IF;
  IF ref.job_id <> p_job OR ref.origin_code <> 'candidate_applied'
     OR ref.schema_version <> 1 THEN
    RETURN jsonb_build_object('status','binding_conflict');
  END IF;
  SELECT * INTO intake FROM public.organization_candidate_memory_outbox
    WHERE reference_id=ref.reference_id AND organization_id=p_organization
      AND application_id=p_application AND job_id=p_job;
  IF NOT FOUND OR intake.state <> 'acknowledged' OR intake.memory_candidate_id IS NULL THEN
    RETURN jsonb_build_object('status','awaiting_binding');
  END IF;
  SELECT count(*) INTO captured FROM public.decision_projection_outbox
    WHERE organization_id=p_organization AND subject_type='application'
      AND subject_id=p_application AND job_id=p_job
      AND action_code='application_stage_moved' AND payload_schema_version=1
      AND source_system='flow' AND destination='memory.organization_decision_inbox.v1';
  SELECT * INTO latest FROM public.decision_projection_outbox
    WHERE organization_id=p_organization AND subject_type='application'
      AND subject_id=p_application AND job_id=p_job
      AND action_code='application_stage_moved' AND payload_schema_version=1
      AND source_system='flow' AND destination='memory.organization_decision_inbox.v1'
    ORDER BY source_event_sequence DESC LIMIT 1;
  SELECT EXISTS (
    SELECT 1 FROM public.decision_events e
    WHERE e.organization_id=p_organization AND e.aggregate_type='application'
      AND e.aggregate_id=p_application AND e.job_id=p_job
      AND e.action_code='application_stage_moved'
      AND NOT EXISTS (SELECT 1 FROM public.decision_projection_outbox o
        WHERE o.event_id=e.event_id AND o.organization_id=p_organization
          AND o.subject_id=p_application AND o.job_id=p_job
          AND o.source_event_sequence=e.event_sequence)
  ) INTO capture_gap;
  IF captured=0 THEN delivery := 'no_capture';
  ELSE
    SELECT CASE WHEN bool_and(coalesce(d.state='acknowledged',false))
      THEN 'acknowledged' ELSE 'awaiting_delivery' END INTO delivery
    FROM public.decision_projection_outbox o
    LEFT JOIN public.decision_projection_delivery_state d ON d.event_id=o.event_id
    WHERE o.organization_id=p_organization AND o.subject_type='application'
      AND o.subject_id=p_application AND o.job_id=p_job;
  END IF;
  RETURN jsonb_build_object(
    'status','bound', 'organization_id',p_organization,
    'application_id',p_application, 'job_id',p_job,
    'reference_id',ref.reference_id, 'candidate_id',intake.memory_candidate_id,
    'captured',jsonb_build_object('count',captured::text,
      'event_id',latest.event_id,'sequence',latest.source_event_sequence::text),
    'delivery_sequence',latest.delivery_sequence::text,
    'delivery_status',delivery, 'capture_gap',capture_gap
  );
END;
$$;
REVOKE ALL ON FUNCTION public.flow_read_candidate_history_context(integer,integer,integer)
  FROM PUBLIC;
