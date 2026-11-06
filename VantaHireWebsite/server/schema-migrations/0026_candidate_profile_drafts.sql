-- Candidate S2 profile delivery, retention and versioned consent foundation.
-- Local implementation: activation requires reviewed routes, worker wiring and release gates.
-- Historical migrations remain immutable. New consent entrypoints remain owner-only.

-- P6 paid interpretation journal. No prompt or raw model transcript is stored.
-- Owner-only until the complete route/Memory acceptance integration is reviewed.
CREATE TABLE public.candidate_source_interpretations (
 reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id integer NOT NULL REFERENCES public.candidate_product_accounts(user_id),
 request_key uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
 authority_hash text NOT NULL CHECK(authority_hash~'^[a-f0-9]{64}$'),
 auth_version integer NOT NULL CHECK(auth_version>=0), consent_revision bigint NOT NULL CHECK(consent_revision>0),
 model text NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 input_tokens bigint NOT NULL CHECK(input_tokens BETWEEN 1 AND 9007199254740991),
 output_tokens bigint NOT NULL CHECK(output_tokens BETWEEN 1 AND 9007199254740991),
 charged_tokens numeric NOT NULL CHECK(charged_tokens>=0),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','dispatched','settled','held','released')),
 response jsonb, reason text CHECK(reason IN ('outcome_unknown','budget_breach','authority_changed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), settled_at timestamptz,
 UNIQUE(user_id,request_key),
 CHECK((state='settled')=(response IS NOT NULL)),
 CHECK(response IS NULL OR octet_length(response::text)<=131072)
);
-- An operator acknowledges one observed incident, never removes its charge or
-- reopens its purchase. A later increased charge is a new unresolved incident.
CREATE TABLE public.candidate_source_interpretation_reviews (
 reservation_id uuid NOT NULL REFERENCES public.candidate_source_interpretations(reservation_id),
 observed_charge numeric NOT NULL CHECK(observed_charge>=0),
 evidence_id uuid NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reviewed_by name NOT NULL DEFAULT session_user,
 PRIMARY KEY(reservation_id,observed_charge)
);
CREATE TABLE public.candidate_source_interpretation_budgets (
 period text NOT NULL CHECK(period IN ('day','month')),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 global_tokens bigint NOT NULL CHECK(global_tokens BETWEEN 0 AND 9007199254740991),
 candidate_tokens bigint NOT NULL CHECK(candidate_tokens BETWEEN 0 AND global_tokens),
 global_calls bigint NOT NULL CHECK(global_calls BETWEEN 0 AND 9007199254740991),
 candidate_calls bigint NOT NULL CHECK(candidate_calls BETWEEN 0 AND global_calls),
 PRIMARY KEY(period,starts_at)
);
DO $$ DECLARE tab text;BEGIN
 FOREACH tab IN ARRAY ARRAY['candidate_source_interpretations','candidate_source_interpretation_budgets','candidate_source_interpretation_reviews'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY owner_only ON public.%I TO %I USING(true) WITH CHECK(true)',tab,current_user);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',tab);
 END LOOP;
END $$;

CREATE FUNCTION public.flow_candidate_source_interpretation_blocked() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.candidate_source_interpretations j WHERE j.reason='budget_breach'
  AND NOT EXISTS(SELECT 1 FROM public.candidate_source_interpretation_reviews r
   WHERE r.reservation_id=j.reservation_id AND r.observed_charge=j.charged_tokens))
$$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_interpretation_blocked() FROM PUBLIC;

-- Owner-only SQL operation; never granted to the application or mounted as HTTP.
CREATE FUNCTION public.flow_candidate_source_interpretation_review(p_id uuid,p_charge numeric,p_reconciled numeric,p_evidence uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE uid integer;j public.candidate_source_interpretations%ROWTYPE;prior uuid;
BEGIN
 IF p_id IS NULL OR p_charge IS NULL OR p_charge<0 OR p_charge='NaN'::numeric OR p_evidence IS NULL
 OR p_reconciled IS NULL OR p_reconciled NOT BETWEEN p_charge AND 18014398509481982 OR trunc(p_reconciled)<>p_reconciled
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT user_id INTO uid FROM public.candidate_source_interpretations WHERE reservation_id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 SELECT * INTO j FROM public.candidate_source_interpretations WHERE reservation_id=p_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(41944,4);
 IF j.reason IS DISTINCT FROM 'budget_breach' OR j.state<>'held' OR j.charged_tokens NOT IN (p_charge,p_reconciled)
 THEN RAISE EXCEPTION 'incident_changed' USING ERRCODE='40001';END IF;
 SELECT evidence_id INTO prior FROM public.candidate_source_interpretation_reviews WHERE reservation_id=p_id AND observed_charge=p_reconciled;
 IF FOUND AND prior<>p_evidence THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
 IF NOT FOUND AND j.charged_tokens<>p_charge THEN RAISE EXCEPTION 'incident_changed' USING ERRCODE='40001';END IF;
 UPDATE public.candidate_source_interpretations SET charged_tokens=p_reconciled WHERE reservation_id=p_id;
 INSERT INTO public.candidate_source_interpretation_reviews(reservation_id,observed_charge,evidence_id)
 VALUES(p_id,p_reconciled,p_evidence) ON CONFLICT DO NOTHING;
 RETURN NOT public.flow_candidate_source_interpretation_blocked();
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_interpretation_review(uuid,numeric,numeric,uuid) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_source_interpretation_authorized(p_user integer,p_auth integer,p_consent bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;
BEGIN
 IF EXISTS(SELECT 1 FROM public.candidate_source_erasures WHERE user_id=p_user) THEN RETURN false;END IF;
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=p_user;
 IF NOT FOUND OR a.foundation_state<>'linked' THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND role='candidate' AND email_verified AND auth_version=p_auth)
 THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM public.candidate_privacy_subject_links l JOIN public.candidate_privacy_requests r USING(request_id)
 WHERE l.candidate_user_id=p_user AND r.state IN ('accepted_local','delivery_pending','memory_active','needs_review'))
 THEN RETURN false;END IF;
 RETURN public.flow_candidate_profile_consent_ready(p_user,a.subject_id,a.binding_id,p_consent);
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_interpretation_authorized(integer,integer,bigint) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_source_interpretation_reserve(p_user integer,p_auth integer,p_consent bigint,
 p_key uuid,p_hash text,p_authority text,p_model text,p_input bigint,p_output bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE j public.candidate_source_interpretations%ROWTYPE;w record;t timestamptz;total numeric;mine numeric;calls bigint;my_calls bigint;
BEGIN
 IF p_user IS NULL OR p_auth IS NULL OR p_consent IS NULL OR p_key IS NULL OR p_hash IS NULL OR p_authority IS NULL
 OR p_hash!~'^[a-f0-9]{64}$' OR p_authority!~'^[a-f0-9]{64}$' OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 200
 OR p_input IS NULL OR p_output IS NULL OR p_input NOT BETWEEN 1 AND 9007199254740991 OR p_output NOT BETWEEN 1 AND 9007199254740991
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user);
 IF NOT public.flow_candidate_source_interpretation_authorized(p_user,p_auth,p_consent)
 THEN RAISE EXCEPTION 'authority_changed' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM public.candidate_source_interpretations WHERE user_id=p_user AND request_key=p_key FOR UPDATE;
 IF FOUND THEN
  IF (j.request_hash,j.authority_hash,j.model,j.input_tokens,j.output_tokens) IS DISTINCT FROM (p_hash,p_authority,p_model,p_input,p_output)
  THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  IF j.state='settled' THEN RETURN jsonb_build_object('state','replay','response',j.response);END IF;
  IF j.state='reserved' THEN RETURN jsonb_build_object('state','reserved','reservationId',j.reservation_id);END IF;
  RETURN jsonb_build_object('state',CASE WHEN j.state='released' THEN 'unavailable' ELSE 'held' END);
 END IF;
 PERFORM pg_advisory_xact_lock(41944,4);
 IF public.flow_candidate_source_interpretation_blocked()
 THEN RETURN jsonb_build_object('state','unavailable');END IF;
 t:=public.flow_candidate_source_budget_now('semantic_model');
 IF (SELECT count(*) FROM public.candidate_source_interpretation_budgets WHERE starts_at<=t AND ends_at>t)<>2
 OR (SELECT count(DISTINCT period) FROM public.candidate_source_interpretation_budgets WHERE starts_at<=t AND ends_at>t)<>2
 THEN RETURN jsonb_build_object('state','unavailable');END IF;
 FOR w IN SELECT * FROM public.candidate_source_interpretation_budgets WHERE starts_at<=t AND ends_at>t ORDER BY period FOR UPDATE LOOP
  SELECT coalesce(sum(charged_tokens),0),coalesce(sum(charged_tokens) FILTER(WHERE user_id=p_user),0),count(*),count(*) FILTER(WHERE user_id=p_user)
  INTO total,mine,calls,my_calls FROM public.candidate_source_interpretations
  WHERE created_at>=w.starts_at AND created_at<w.ends_at AND state<>'released';
  IF total+p_input::numeric+p_output>w.global_tokens OR mine+p_input::numeric+p_output>w.candidate_tokens
  OR calls+1>w.global_calls OR my_calls+1>w.candidate_calls THEN RETURN jsonb_build_object('state','unavailable');END IF;
 END LOOP;
 INSERT INTO public.candidate_source_interpretations(user_id,request_key,request_hash,authority_hash,auth_version,consent_revision,model,input_tokens,output_tokens,charged_tokens,created_at)
 VALUES(p_user,p_key,p_hash,p_authority,p_auth,p_consent,p_model,p_input,p_output,p_input::numeric+p_output,t) RETURNING * INTO j;
 RETURN jsonb_build_object('state','reserved','reservationId',j.reservation_id);
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_interpretation_reserve(integer,integer,bigint,uuid,text,text,text,bigint,bigint) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_source_interpretation_dispatch(p_id uuid,p_authority text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE j public.candidate_source_interpretations%ROWTYPE;uid integer;
BEGIN
 SELECT user_id INTO uid FROM public.candidate_source_interpretations WHERE reservation_id=p_id;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 SELECT * INTO j FROM public.candidate_source_interpretations WHERE reservation_id=p_id FOR UPDATE;
 IF j.state<>'reserved' OR j.authority_hash IS DISTINCT FROM p_authority THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(41944,4);
 IF public.flow_candidate_source_interpretation_blocked() THEN RETURN false;END IF;
 IF NOT public.flow_candidate_source_interpretation_authorized(j.user_id,j.auth_version,j.consent_revision)
 OR (SELECT count(DISTINCT period) FROM public.candidate_source_interpretation_budgets
 WHERE starts_at<=j.created_at AND ends_at>j.created_at AND ends_at>public.flow_candidate_source_budget_now('semantic_model'))<>2 THEN
  UPDATE public.candidate_source_interpretations SET state='released',charged_tokens=0,reason='authority_changed' WHERE reservation_id=p_id;
  RETURN false;
 END IF;
 UPDATE public.candidate_source_interpretations SET state='dispatched' WHERE reservation_id=p_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_interpretation_dispatch(uuid,text) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_source_interpretation_hold(p_id uuid,p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE uid integer;
BEGIN
 IF p_reason IS NULL OR p_reason NOT IN ('outcome_unknown','budget_breach') THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT user_id INTO uid FROM public.candidate_source_interpretations WHERE reservation_id=p_id;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 PERFORM 1 FROM public.candidate_source_interpretations WHERE reservation_id=p_id FOR UPDATE;
 PERFORM pg_advisory_xact_lock(41944,4);
 -- Never downgrade a settled receipt after its reply was lost, or resurrect a released slot.
 UPDATE public.candidate_source_interpretations SET state='held',reason=CASE WHEN reason='budget_breach' THEN reason ELSE p_reason END WHERE reservation_id=p_id AND state IN ('dispatched','held');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_interpretation_hold(uuid,text) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_source_interpretation_settle(p_id uuid,p_authority text,p_response jsonb,p_input bigint,p_output bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE j public.candidate_source_interpretations%ROWTYPE;uid integer;
BEGIN
 IF p_input IS NULL OR p_output IS NULL OR p_input<0 OR p_output<0 OR p_response IS NULL
 OR jsonb_typeof(p_response)<>'object' OR octet_length(p_response::text)>131072
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT user_id INTO uid FROM public.candidate_source_interpretations WHERE reservation_id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 SELECT * INTO j FROM public.candidate_source_interpretations WHERE reservation_id=p_id FOR UPDATE;
 IF j.authority_hash IS DISTINCT FROM p_authority THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
 IF j.state='settled' THEN
  IF j.response IS DISTINCT FROM p_response THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN j.response;
 END IF;
 IF j.state<>'dispatched' THEN RAISE EXCEPTION 'outcome_unknown' USING ERRCODE='40001';END IF;
 IF p_input>j.input_tokens OR p_output>j.output_tokens THEN
  PERFORM pg_advisory_xact_lock(41944,4);
  UPDATE public.candidate_source_interpretations SET state='held',reason='budget_breach',charged_tokens=greatest(charged_tokens,p_input::numeric+p_output) WHERE reservation_id=p_id;
  RETURN NULL;
 END IF;
 IF NOT public.flow_candidate_source_interpretation_authorized(j.user_id,j.auth_version,j.consent_revision) THEN
  UPDATE public.candidate_source_interpretations SET state='held',reason='authority_changed' WHERE reservation_id=p_id;
  RETURN NULL;
 END IF;
 UPDATE public.candidate_source_interpretations SET state='settled',response=p_response,settled_at=clock_timestamp() WHERE reservation_id=p_id;
 RETURN p_response;
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_interpretation_settle(uuid,text,jsonb,bigint,bigint) FROM PUBLIC;

-- Reviewed section: flow-profile.sql
CREATE TABLE public.candidate_profile_commands (
 command_id uuid PRIMARY KEY, user_id integer NOT NULL,subject_id uuid NOT NULL,binding_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,action text NOT NULL,
 schema_version integer NOT NULL DEFAULT 2 CHECK(schema_version IN (2,3)),
 consent_revision bigint CHECK(consent_revision BETWEEN 1 AND 9007199254740991),
 CHECK((schema_version=2 AND action IN ('save_draft','save_preferences','confirm')) OR
  (schema_version=3 AND action IN ('save_preference_section','promote_preferences','accept_exclusions','remove_exclusion','confirm','accept_source','reject_source','accept_interpretation'))),
 CHECK((schema_version=3 AND action IN ('confirm','accept_source','accept_interpretation'))=(consent_revision IS NOT NULL)),
 body text NOT NULL CHECK(octet_length(body) BETWEEN 1 AND 393216),
 body_hash text NOT NULL CHECK(body_hash~'^[0-9a-f]{64}$'),admitted_auth_version integer NOT NULL CHECK(admitted_auth_version>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(subject_id,user_id,binding_id) REFERENCES public.candidate_product_accounts(subject_id,user_id,binding_id),
 UNIQUE(user_id,idempotency_key)
);
CREATE TABLE public.candidate_profile_outbox (
 command_id uuid PRIMARY KEY REFERENCES public.candidate_profile_commands(command_id),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','retry','leased','applied','rejected','held')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 12),
 lease_token uuid,lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation BETWEEN 0 AND 9007199254740991),lease_expires_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),safe_reason text,receipt jsonb,
 resolution_revision bigint NOT NULL DEFAULT 0 CHECK(resolution_revision BETWEEN 0 AND 9007199254740991),
 resolution_requests jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(resolution_requests)='object'),
 resolution_action text CHECK(resolution_action IN ('retry','discard')),
 manual_retry_used boolean NOT NULL DEFAULT false,
 recovery_attempts integer NOT NULL DEFAULT 0 CHECK(recovery_attempts BETWEEN 0 AND 12),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((lease_token IS NULL)=(lease_expires_at IS NULL)),
 CHECK(state<>'leased' OR lease_token IS NOT NULL),
 CHECK(lease_token IS NULL OR state='leased' OR (state='held' AND safe_reason IS NOT DISTINCT FROM 'expiry_reconciling'))
);
CREATE INDEX candidate_profile_due ON public.candidate_profile_outbox(next_attempt_at,command_id) WHERE state IN ('queued','retry');
CREATE INDEX candidate_profile_lease_expiry ON public.candidate_profile_outbox(lease_expires_at) WHERE state='leased';

CREATE FUNCTION public.flow_candidate_profile_owner_read(p_user integer,p_auth integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;pending jsonb;total integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND role='candidate' AND email_verified IS TRUE AND auth_version=p_auth)
 THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=p_user;
 IF NOT FOUND OR a.foundation_state<>'linked' THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 SELECT count(*) INTO total FROM public.candidate_profile_commands c JOIN public.candidate_profile_outbox o USING(command_id)
 WHERE c.user_id=p_user AND o.state IN ('queued','retry','leased','held');
 SELECT coalesce(jsonb_agg(v.item ORDER BY v.created_at DESC,v.command_id DESC),'[]') INTO pending FROM (
 SELECT c.created_at,c.command_id,jsonb_build_object('commandId',c.command_id,'action',c.action,
 'status',CASE WHEN o.state IN ('held','retry') THEN 'held' ELSE 'pending' END,'reason',o.safe_reason)
 || CASE WHEN c.schema_version=3 THEN '{"schemaVersion":3}'::jsonb ELSE '{}'::jsonb END item
 FROM public.candidate_profile_commands c JOIN public.candidate_profile_outbox o USING(command_id)
 WHERE c.user_id=p_user AND o.state IN ('queued','retry','leased','held') ORDER BY c.created_at DESC,c.command_id DESC LIMIT 5) v;
 RETURN jsonb_build_object('subjectId',a.subject_id,'bindingId',a.binding_id,'pendingCommands',pending,'hasMorePendingCommands',total>5);
END $$;

CREATE FUNCTION public.flow_candidate_profile_admit(p_user integer,p_auth integer,p_password text,p_recent timestamptz,p_key uuid,p_body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE u public.users%ROWTYPE;a public.candidate_product_accounts%ROWTYPE;c public.candidate_profile_commands%ROWTYPE;
 j jsonb;digest text;cid uuid;current_state text;protocol integer;payload jsonb;revision bigint;section text;
BEGIN
 IF p_user IS NULL OR p_key IS NULL OR p_body IS NULL OR octet_length(p_body) NOT BETWEEN 1 AND 393216
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user);
 IF EXISTS(SELECT 1 FROM public.candidate_source_erasures WHERE user_id=p_user)
 THEN RAISE EXCEPTION 'candidate_privacy_restricted' USING ERRCODE='42501';END IF;
 SELECT * INTO u FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS NOT TRUE OR u.auth_version IS DISTINCT FROM p_auth
 THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR a.foundation_state<>'linked' THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 j:=p_body::jsonb;
 IF jsonb_typeof(j) IS DISTINCT FROM 'object' OR NOT j ?& ARRAY['schemaVersion','idempotencyKey','expectedDraftVersion','expectedProfileVersion','expectedPreferenceVersion','action','payload']
 OR j->'schemaVersion' IS NULL OR j->'schemaVersion' NOT IN ('2'::jsonb,'3'::jsonb)
 OR j->>'idempotencyKey' IS DISTINCT FROM p_key::text OR jsonb_typeof(j->'payload') IS DISTINCT FROM 'object'
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 protocol:=(j->>'schemaVersion')::integer;payload:=j->'payload';
 IF protocol=2 THEN
  IF (SELECT count(*) FROM jsonb_object_keys(j))<>7 OR j->>'action' IS NULL OR j->>'action' NOT IN ('save_draft','save_preferences','confirm')
  THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 ELSE
  IF (SELECT count(*) FROM jsonb_object_keys(j))<>8 OR NOT j ? 'expectedPreferenceDraftRevision'
   OR public.flow_consent_v2_canonical(j) IS DISTINCT FROM p_body
   OR jsonb_typeof(j->'expectedPreferenceDraftRevision') IS DISTINCT FROM 'number'
   OR j->>'expectedPreferenceDraftRevision'!~'^(0|[1-9][0-9]{0,15})$'
   OR (j->>'expectedPreferenceDraftRevision')::numeric>9007199254740991
  THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  IF j->>'action' IS NULL OR j->>'action' NOT IN ('save_preference_section','promote_preferences','accept_exclusions','remove_exclusion','confirm','accept_source','reject_source','accept_interpretation')
  THEN RAISE EXCEPTION 'feature_unavailable' USING ERRCODE='0A000'; END IF;
  IF j->>'action'='save_preference_section' THEN
   section:=payload->>'section';
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>3 OR NOT payload ?& ARRAY['section','answered','value']
    OR section IS NULL OR section NOT IN ('roles','location','arrangement','relocation','employment_types','availability','compensation','authorisation','private_notes')
    OR jsonb_typeof(payload->'answered') IS DISTINCT FROM 'boolean' OR octet_length(public.flow_consent_v2_canonical(payload))>32768
    OR (payload->'answered'='false'::jsonb AND payload->'value' IS DISTINCT FROM 'null'::jsonb)
    OR (payload->'answered'='true'::jsonb AND jsonb_typeof(payload->'value') IS DISTINCT FROM
     CASE WHEN section IN ('employment_types','authorisation','private_notes') THEN 'array' ELSE 'object' END)
   THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  ELSIF j->>'action'='promote_preferences' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>1 OR jsonb_typeof(payload->'preferenceDraftHash') IS DISTINCT FROM 'string'
    OR payload->>'preferenceDraftHash'!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  ELSIF j->>'action' IN ('accept_exclusions','accept_interpretation') THEN
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>2 OR jsonb_typeof(payload->'proposalId') IS DISTINCT FROM 'string'
    OR payload->>'proposalId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(payload->'proposalHash') IS DISTINCT FROM 'string' OR payload->>'proposalHash'!~'^[0-9a-f]{64}$'
   THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
   IF j->>'action'='accept_interpretation' THEN
    SELECT acknowledged_version INTO revision FROM public.candidate_consent_subjects WHERE subject_id=a.subject_id;
   END IF;
  ELSIF j->>'action' IN ('accept_source','reject_source') THEN
   IF coalesce(payload->>'proposalId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR coalesce(payload->>'proposalHash','')!~'^[0-9a-f]{64}$' OR jsonb_typeof(payload->'sourceVersion') IS DISTINCT FROM 'number'
    OR payload->>'sourceVersion'!~'^(0|[1-9][0-9]{0,15})$' OR (payload->>'sourceVersion')::numeric>9007199254740991
   THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
   IF j->>'action'='reject_source' THEN
    IF (SELECT count(*) FROM jsonb_object_keys(payload))<>4 OR NOT payload ?& ARRAY['proposalId','proposalHash','sourceVersion','reason']
     OR coalesce(payload->>'reason','') NOT IN ('not_me','incorrect','not_needed') THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
   ELSE
    IF (SELECT count(*) FROM jsonb_object_keys(payload))<>6 OR NOT payload ?& ARRAY['proposalId','proposalHash','sourceVersion','selectedFactIds','replaceFactIds','corrections']
     OR jsonb_typeof(payload->'selectedFactIds') IS DISTINCT FROM 'array' OR jsonb_typeof(payload->'replaceFactIds') IS DISTINCT FROM 'array'
     OR jsonb_typeof(payload->'corrections') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
    IF jsonb_array_length(payload->'selectedFactIds') NOT BETWEEN 1 AND 400 OR jsonb_array_length(payload->'replaceFactIds')>400 OR jsonb_array_length(payload->'corrections')>400
     OR NOT (payload->'selectedFactIds') @> (payload->'replaceFactIds') THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements((payload->'selectedFactIds')||(payload->'replaceFactIds')) x
      WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'string' OR x.value#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(payload->'selectedFactIds'))
     OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(payload->'replaceFactIds'))
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'corrections') x WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'object')
    THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'corrections') x WHERE
      (SELECT count(*) FROM jsonb_object_keys(x.value))<>3 OR NOT x.value ?& ARRAY['factId','kind','value']
      OR jsonb_typeof(x.value->'factId') IS DISTINCT FROM 'string' OR NOT (payload->'selectedFactIds') ? (x.value->>'factId')
      OR coalesce(x.value->>'kind','') NOT IN ('displayName','headline','linkedinUrl','photo','currentLocation','skill','employment','education','project'))
     OR (SELECT count(*)<>count(DISTINCT value->>'factId') FROM jsonb_array_elements(payload->'corrections'))
    THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
    SELECT acknowledged_version INTO revision FROM public.candidate_consent_subjects WHERE subject_id=a.subject_id;
   END IF;
  ELSIF j->>'action'='remove_exclusion' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>1 OR jsonb_typeof(payload->'restrictionId') IS DISTINCT FROM 'string'
    OR payload->>'restrictionId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  ELSE
   IF (SELECT count(*) FROM jsonb_object_keys(payload))<>3 OR NOT payload ?& ARRAY['draftHash','preferenceDraftHash','consentRevision']
    OR jsonb_typeof(payload->'draftHash') IS DISTINCT FROM 'string' OR payload->>'draftHash'!~'^[0-9a-f]{64}$'
    OR jsonb_typeof(payload->'preferenceDraftHash') IS DISTINCT FROM 'string' OR payload->>'preferenceDraftHash'!~'^[0-9a-f]{64}$'
    OR jsonb_typeof(payload->'consentRevision') IS DISTINCT FROM 'number' OR payload->>'consentRevision'!~'^[1-9][0-9]{0,15}$'
    OR (payload->>'consentRevision')::numeric>9007199254740991
   THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
   revision:=(payload->>'consentRevision')::bigint;
  END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['expectedDraftVersion','expectedProfileVersion','expectedPreferenceVersion']) k
  WHERE jsonb_typeof(j->k) IS DISTINCT FROM 'number' OR (j->>k)!~'^(0|[1-9][0-9]{0,15})$' OR (j->>k)::numeric>9007199254740991)
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 IF j->>'action'='confirm' AND (p_recent IS NULL OR p_recent>clock_timestamp() OR p_recent<clock_timestamp()-interval '10 minutes'
  OR encode(sha256(convert_to(u.password,'UTF8')),'hex') IS DISTINCT FROM p_password)
 THEN RAISE EXCEPTION 'recent_auth_required' USING ERRCODE='42501'; END IF;
 digest:=encode(sha256(convert_to(p_body,'UTF8')),'hex');
 SELECT * INTO c FROM public.candidate_profile_commands WHERE user_id=p_user AND idempotency_key=p_key;
 IF FOUND THEN
  IF c.body_hash<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
  SELECT state INTO current_state FROM public.candidate_profile_outbox WHERE command_id=c.command_id;
  RETURN jsonb_build_object('schemaVersion',c.schema_version,'commandId',c.command_id,'status',CASE WHEN current_state IN ('queued','retry','leased') THEN 'pending' ELSE current_state END);
 END IF;
 IF protocol=3 AND j->>'action'='confirm' THEN
  IF NOT public.flow_candidate_profile_consent_ready(p_user,a.subject_id,a.binding_id,revision)
  THEN RAISE EXCEPTION 'consent_changed' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.candidate_profile_commands d JOIN public.candidate_profile_outbox o USING(command_id)
   WHERE d.subject_id=a.subject_id AND o.state IN ('queued','retry','leased','held'))
  THEN RAISE EXCEPTION 'pending_changes' USING ERRCODE='40001'; END IF;
 END IF;
 IF protocol=3 AND j->>'action' IN ('accept_source','accept_interpretation') AND NOT public.flow_candidate_profile_consent_ready(p_user,a.subject_id,a.binding_id,revision)
 THEN RAISE EXCEPTION 'consent_changed' USING ERRCODE='42501';END IF;
 cid:=gen_random_uuid();
 INSERT INTO public.candidate_profile_commands(command_id,user_id,subject_id,binding_id,idempotency_key,action,body,body_hash,admitted_auth_version,schema_version,consent_revision)
 VALUES(cid,p_user,a.subject_id,a.binding_id,p_key,j->>'action',p_body,digest,p_auth,protocol,revision);
 INSERT INTO public.candidate_profile_outbox(command_id) VALUES(cid);
 RETURN jsonb_build_object('schemaVersion',protocol,'commandId',cid,'status','pending');
END $$;

CREATE FUNCTION public.flow_candidate_profile_command_read(p_user integer,p_auth integer,p_command uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE c public.candidate_profile_commands%ROWTYPE;o public.candidate_profile_outbox%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND role='candidate' AND email_verified IS TRUE AND auth_version=p_auth)
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO c FROM public.candidate_profile_commands WHERE command_id=p_command AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=c.command_id;
 RETURN jsonb_build_object('schemaVersion',c.schema_version,'commandId',c.command_id,'action',c.action,
 'status',CASE WHEN o.state='retry' THEN 'held' WHEN o.state IN ('queued','leased') THEN 'pending' ELSE o.state END,'reason',o.safe_reason)
 || CASE WHEN o.receipt IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('draftVersion',o.receipt->'draftVersion','profileVersion',o.receipt->'profileVersion','preferenceVersion',o.receipt->'preferenceVersion') END
 || CASE WHEN o.receipt IS NOT NULL AND c.schema_version=3 THEN jsonb_build_object('preferenceDraftRevision',o.receipt->'preferenceDraftRevision','preferenceDraftHash',o.receipt->'preferenceDraftHash') ELSE '{}'::jsonb END;
END $$;

CREATE FUNCTION public.flow_candidate_profile_claim(p_worker uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE hint record;u public.users%ROWTYPE;c public.candidate_profile_commands%ROWTYPE;o public.candidate_profile_outbox%ROWTYPE;
 claimed jsonb:='[]';seen uuid[]:='{}';why text;
BEGIN
 IF p_worker IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 FOR hint IN SELECT d.command_id,d.user_id,d.subject_id FROM public.candidate_profile_commands d JOIN public.candidate_profile_outbox b USING(command_id)
 WHERE (b.state IN ('queued','retry') AND b.next_attempt_at<=clock_timestamp()) OR (b.state='leased' AND b.lease_expires_at<=clock_timestamp())
 ORDER BY b.next_attempt_at,d.created_at,d.command_id LIMIT 200 LOOP
  IF hint.subject_id=ANY(seen) OR NOT pg_try_advisory_xact_lock(41943,hint.user_id) THEN CONTINUE; END IF;
  SELECT * INTO u FROM public.users WHERE id=hint.user_id FOR UPDATE;
  SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=hint.command_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR NOT ((o.state IN ('queued','retry') AND o.next_attempt_at<=clock_timestamp()) OR (o.state='leased' AND o.lease_expires_at<=clock_timestamp())) THEN CONTINUE; END IF;
  SELECT * INTO c FROM public.candidate_profile_commands WHERE command_id=hint.command_id;
  IF EXISTS(SELECT 1 FROM public.candidate_profile_commands d JOIN public.candidate_profile_outbox b USING(command_id)
   WHERE d.subject_id=c.subject_id AND b.state='leased' AND b.lease_expires_at>clock_timestamp()) THEN CONTINUE; END IF;
  why:=NULL;
  IF u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS NOT TRUE OR u.auth_version IS DISTINCT FROM c.admitted_auth_version THEN why:='authentication_changed';
  ELSIF o.attempts>=12 OR o.lease_generation>=9007199254740991 THEN why:='retry_exhausted';
  ELSIF c.created_at<clock_timestamp()-interval '30 days' THEN why:='command_expired'; END IF;
  IF why IS NULL AND c.schema_version=3 AND c.action IN ('confirm','accept_source','accept_interpretation') AND NOT public.flow_candidate_profile_consent_ready(c.user_id,c.subject_id,c.binding_id,c.consent_revision)
  THEN why:='consent_changed'; END IF;
  IF why IS NOT NULL THEN
   IF why='command_expired' THEN
    UPDATE public.candidate_profile_commands SET body=NULL,redacted_at=clock_timestamp() WHERE command_id=c.command_id;
   END IF;
   UPDATE public.candidate_profile_outbox SET state=CASE WHEN why='consent_changed' THEN 'rejected' ELSE 'held' END,
    safe_reason=CASE WHEN why='command_expired' THEN 'expiry_reconciling' ELSE why END,
    lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE command_id=c.command_id;
   CONTINUE;
  END IF;
  UPDATE public.candidate_profile_outbox SET state='leased',attempts=attempts+1,lease_generation=lease_generation+1,
   -- Twenty subjects run in five waves of four. Each wave has a 15-second
   -- dispatch deadline and a bounded 5-second finish: allow the whole batch,
   -- not just the first wave. Expired leases still require generation fencing.
   lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
   WHERE command_id=c.command_id RETURNING * INTO o;
  seen:=array_append(seen,c.subject_id);
  claimed:=claimed||jsonb_build_array(jsonb_build_object('commandId',c.command_id,'subjectId',c.subject_id,'bindingId',c.binding_id,
   'userId',c.user_id,'authVersion',c.admitted_auth_version,'idempotencyKey',c.idempotency_key,'leaseToken',o.lease_token,
   'leaseGeneration',o.lease_generation,'attemptCount',o.attempts,'body',c.body,'hash',c.body_hash));
  IF jsonb_array_length(claimed)>=20 THEN EXIT; END IF;
 END LOOP;
 RETURN claimed;
END $$;

CREATE FUNCTION public.flow_candidate_profile_finish(p_command uuid,p_token uuid,p_generation bigint,p_outcome text,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE uid integer;c public.candidate_profile_commands%ROWTYPE;o public.candidate_profile_outbox%ROWTYPE;u public.users%ROWTYPE;
 target text;reason text;ack jsonb;delay_ms integer;
BEGIN
 SELECT user_id INTO uid FROM public.candidate_profile_commands WHERE command_id=p_command;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false); END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 SELECT * INTO u FROM public.users WHERE id=uid FOR UPDATE;
 SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=p_command FOR UPDATE;
 IF o.state<>'leased' OR o.lease_token IS DISTINCT FROM p_token OR o.lease_generation IS DISTINCT FROM p_generation OR o.lease_expires_at<=clock_timestamp()
 THEN RETURN jsonb_build_object('applied',false); END IF;
 SELECT * INTO c FROM public.candidate_profile_commands WHERE command_id=p_command;
 IF u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS NOT TRUE OR u.auth_version IS DISTINCT FROM c.admitted_auth_version
 THEN target:='held';reason:='authentication_changed';
 -- A dispatched command's valid Memory receipt is authoritative. Withdrawal
 -- travels independently; never rewrite an already committed Memory result.
 ELSIF p_outcome IN ('applied','rejected') AND p_result ? 'receipt' THEN
  ack:=p_result->'receipt';
  IF jsonb_typeof(ack) IS DISTINCT FROM 'object' OR ack->'schemaVersion' IS DISTINCT FROM to_jsonb(c.schema_version)
   OR ack->>'commandId' IS DISTINCT FROM c.command_id::text OR ack->>'subjectId' IS DISTINCT FROM c.subject_id::text
   OR ack->>'bindingId' IS DISTINCT FROM c.binding_id::text OR ack->>'commandHash' IS DISTINCT FROM c.body_hash
   OR ack->>'status' IS DISTINCT FROM p_outcome OR ack->'publicationActive' IS DISTINCT FROM 'false'::jsonb
   OR NOT ack ?& ARRAY['schemaVersion','commandId','subjectId','bindingId','commandHash','status','draftVersion','profileVersion','preferenceVersion','reason','publicationActive']
   OR (SELECT count(*) FROM jsonb_object_keys(ack))<>(CASE WHEN c.schema_version=3 THEN 14 ELSE 11 END)
   OR (c.schema_version=3 AND (NOT ack ?& ARRAY['changed','preferenceDraftRevision','preferenceDraftHash']
    OR jsonb_typeof(ack->'changed') IS DISTINCT FROM 'boolean' OR (p_outcome='rejected' AND ack->'changed' IS DISTINCT FROM 'false'::jsonb)
    OR jsonb_typeof(ack->'preferenceDraftRevision') IS DISTINCT FROM 'number'
    OR ack->>'preferenceDraftRevision'!~'^(0|[1-9][0-9]{0,15})$' OR (ack->>'preferenceDraftRevision')::numeric>9007199254740991
    OR (ack->'preferenceDraftHash' IS DISTINCT FROM 'null'::jsonb AND (jsonb_typeof(ack->'preferenceDraftHash') IS DISTINCT FROM 'string' OR ack->>'preferenceDraftHash'!~'^[0-9a-f]{64}$'))))
   OR EXISTS(SELECT 1 FROM unnest(ARRAY['draftVersion','profileVersion','preferenceVersion']) k
    WHERE jsonb_typeof(ack->k) IS DISTINCT FROM 'number' OR (ack->>k)!~'^(0|[1-9][0-9]{0,15})$' OR (ack->>k)::numeric>9007199254740991)
   OR (p_outcome='applied' AND ack->'reason' IS DISTINCT FROM 'null'::jsonb)
   OR (p_outcome='rejected' AND (ack->>'reason' IS NULL OR NOT (ack->>'reason'=ANY(CASE WHEN c.schema_version=3
    THEN ARRAY['stale_edit','confirmation_conflict','incomplete_preferences','incomplete_profile','legacy_preferences_review_required','candidate_privacy_restricted','command_expired','consent_required','consent_changed','source_conflict','proposal_expired','exclusion_limit']
    ELSE ARRAY['stale_edit','confirmation_conflict','incomplete_profile','candidate_privacy_restricted','invalid_request'] END))))
  THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
  target:=p_outcome;reason:=ack->>'reason';
 ELSIF p_outcome='rejected' AND p_result->>'reason' IN ('candidate_privacy_restricted','consent_changed') THEN target:='rejected';reason:=p_result->>'reason';
 ELSIF p_outcome='held' AND p_result->>'reason' IN ('identity_conflict','authentication_changed','retry_exhausted','invalid_request')
 THEN target:='held';reason:=p_result->>'reason';
 ELSIF p_outcome='retry' AND p_result->>'reason' IN ('authority_unavailable','memory_unavailable','delivery_outcome_unknown') THEN
  IF o.attempts>=12 THEN target:='held';reason:='retry_exhausted';
  ELSE target:='retry';reason:=p_result->>'reason';delay_ms:=least(60000,250*power(2,o.attempts-1)::integer); END IF;
 ELSE RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 UPDATE public.candidate_profile_outbox SET state=target,safe_reason=reason,receipt=ack,lease_token=NULL,lease_expires_at=NULL,
  next_attempt_at=clock_timestamp()+coalesce(delay_ms,0)*interval '1 millisecond',updated_at=clock_timestamp() WHERE command_id=p_command;
 RETURN jsonb_build_object('applied',true);
END $$;

DO $$ DECLARE tab text;sig text;role_name text;BEGIN
 FOREACH tab IN ARRAY ARRAY['candidate_profile_commands','candidate_profile_outbox'] LOOP
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',tab);
  FOR role_name IN SELECT DISTINCT r.rolname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   CROSS JOIN LATERAL aclexplode(c.relacl) a JOIN pg_roles r ON r.oid=a.grantee
   WHERE n.nspname='public' AND c.relname=tab AND a.grantee<>c.relowner LOOP
   EXECUTE format('REVOKE ALL ON public.%I FROM %I',tab,role_name);
  END LOOP;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY owner_only ON public.%I TO %I USING(true) WITH CHECK(true)',tab,current_user);
 END LOOP;
 FOREACH sig IN ARRAY ARRAY['flow_candidate_profile_owner_read(integer,integer)','flow_candidate_profile_admit(integer,integer,text,timestamp with time zone,uuid,text)',
  'flow_candidate_profile_command_read(integer,integer,uuid)','flow_candidate_profile_claim(uuid)',
  'flow_candidate_profile_finish(uuid,uuid,bigint,text,jsonb)'] LOOP EXECUTE 'REVOKE ALL ON FUNCTION public.'||sig||' FROM PUBLIC';END LOOP;
END $$;

-- Reviewed section: flow-retention.sql
ALTER TABLE public.candidate_profile_commands ALTER COLUMN body DROP NOT NULL;
ALTER TABLE public.candidate_profile_commands ADD COLUMN redacted_at timestamptz;
ALTER TABLE public.candidate_profile_commands ADD CONSTRAINT candidate_profile_redaction_pair CHECK((body IS NULL)=(redacted_at IS NOT NULL));
ALTER TABLE public.candidate_profile_outbox ADD COLUMN acknowledged_at timestamptz;
UPDATE public.candidate_profile_outbox SET acknowledged_at=updated_at WHERE receipt IS NOT NULL;

CREATE FUNCTION public.flow_candidate_profile_record_ack() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.receipt IS NOT NULL AND OLD.receipt IS NULL THEN NEW.acknowledged_at:=clock_timestamp();
 ELSE NEW.acknowledged_at:=OLD.acknowledged_at; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER candidate_profile_ack_clock BEFORE UPDATE ON public.candidate_profile_outbox
FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_profile_record_ack();

CREATE FUNCTION public.flow_candidate_profile_redact_due() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE hint record;c public.candidate_profile_commands%ROWTYPE;o public.candidate_profile_outbox%ROWTYPE;
 redacted integer:=0;expiry integer:=0;
BEGIN
 FOR hint IN SELECT d.command_id,d.user_id FROM public.candidate_profile_commands d
 JOIN public.candidate_profile_outbox b USING(command_id)
 WHERE d.body IS NOT NULL AND ((b.acknowledged_at IS NOT NULL AND b.acknowledged_at<=clock_timestamp()-interval '7 days')
 OR (b.acknowledged_at IS NULL AND d.created_at<=clock_timestamp()-interval '30 days'))
 ORDER BY d.created_at,d.command_id LIMIT 100 LOOP
  IF NOT pg_try_advisory_xact_lock(41943,hint.user_id) THEN CONTINUE; END IF;
  PERFORM 1 FROM public.users WHERE id=hint.user_id FOR UPDATE;
  SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=hint.command_id FOR UPDATE;
  SELECT * INTO c FROM public.candidate_profile_commands WHERE command_id=hint.command_id FOR UPDATE;
  IF c.body IS NULL THEN CONTINUE; END IF;
  IF o.acknowledged_at IS NOT NULL AND o.acknowledged_at<=clock_timestamp()-interval '7 days' THEN
   UPDATE public.candidate_profile_commands SET body=NULL,redacted_at=clock_timestamp() WHERE command_id=c.command_id;
   redacted:=redacted+1;
  ELSIF o.acknowledged_at IS NULL AND c.created_at<=clock_timestamp()-interval '30 days' THEN
   UPDATE public.candidate_profile_commands SET body=NULL,redacted_at=clock_timestamp() WHERE command_id=c.command_id;
   -- Fences old leases immediately. Do not report 'not saved' until Memory
   -- atomically returns an existing receipt or rejects any future delivery.
   UPDATE public.candidate_profile_outbox SET state='held',safe_reason='expiry_reconciling',
    lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE command_id=c.command_id;
   redacted:=redacted+1;expiry:=expiry+1;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('redacted',redacted,'awaitingExpiry',expiry);
END $$;

CREATE FUNCTION public.flow_candidate_profile_expiry_pending() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
 SELECT coalesce(jsonb_agg(v.item),'[]'::jsonb) FROM (
 SELECT jsonb_build_object('commandId',c.command_id,'subjectId',c.subject_id,'bindingId',c.binding_id,
  'idempotencyKey',c.idempotency_key,'commandHash',c.body_hash)
  || CASE WHEN c.schema_version=3 THEN '{"schemaVersion":3}'::jsonb ELSE '{}'::jsonb END item
 FROM public.candidate_profile_commands c JOIN public.candidate_profile_outbox o USING(command_id)
 WHERE c.body IS NULL AND o.state='held' AND o.safe_reason='expiry_reconciling'
 ORDER BY o.updated_at,c.command_id LIMIT 20) v;
$$;

CREATE FUNCTION public.flow_candidate_profile_expiry_finish(p_command uuid,p_receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE uid integer;c public.candidate_profile_commands%ROWTYPE;o public.candidate_profile_outbox%ROWTYPE;
BEGIN
 SELECT user_id INTO uid FROM public.candidate_profile_commands WHERE command_id=p_command;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false); END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 PERFORM 1 FROM public.users WHERE id=uid FOR UPDATE;
 SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=p_command FOR UPDATE;
 SELECT * INTO c FROM public.candidate_profile_commands WHERE command_id=p_command;
 IF c.body IS NOT NULL OR o.state<>'held' OR o.safe_reason IS DISTINCT FROM 'expiry_reconciling'
 THEN RETURN jsonb_build_object('applied',false); END IF;
 -- Never reinterpret a v3 expiry receipt as v2, or overwrite Memory's outcome.
 IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object'
 OR NOT p_receipt ?& ARRAY['schemaVersion','commandId','subjectId','bindingId','commandHash','status','draftVersion','profileVersion','preferenceVersion','reason','publicationActive']
 OR (SELECT count(*) FROM jsonb_object_keys(p_receipt))<>(CASE WHEN c.schema_version=3 THEN 14 ELSE 11 END)
 OR p_receipt->'schemaVersion' IS DISTINCT FROM to_jsonb(c.schema_version)
 OR (c.schema_version=3 AND (NOT p_receipt ?& ARRAY['changed','preferenceDraftRevision','preferenceDraftHash']
  OR jsonb_typeof(p_receipt->'changed') IS DISTINCT FROM 'boolean'
  OR (p_receipt->>'status'='rejected' AND p_receipt->'changed' IS DISTINCT FROM 'false'::jsonb)
  OR jsonb_typeof(p_receipt->'preferenceDraftRevision') IS DISTINCT FROM 'number'
  OR p_receipt->>'preferenceDraftRevision'!~'^(0|[1-9][0-9]{0,15})$'
  OR (p_receipt->>'preferenceDraftRevision')::numeric>9007199254740991
  OR (p_receipt->'preferenceDraftHash' IS DISTINCT FROM 'null'::jsonb AND
   (jsonb_typeof(p_receipt->'preferenceDraftHash') IS DISTINCT FROM 'string' OR p_receipt->>'preferenceDraftHash'!~'^[0-9a-f]{64}$'))))
 OR p_receipt->>'commandId' IS DISTINCT FROM c.command_id::text
 OR p_receipt->>'subjectId' IS DISTINCT FROM c.subject_id::text
 OR p_receipt->>'bindingId' IS DISTINCT FROM c.binding_id::text
 OR p_receipt->>'commandHash' IS DISTINCT FROM c.body_hash
 OR p_receipt->'publicationActive' IS DISTINCT FROM 'false'::jsonb
 OR p_receipt->>'status' IS NULL OR p_receipt->>'status' NOT IN ('applied','rejected')
 OR (p_receipt->>'status'='applied' AND p_receipt->'reason' IS DISTINCT FROM 'null'::jsonb)
 OR (p_receipt->>'status'='rejected' AND (p_receipt->>'reason' IS NULL OR NOT (p_receipt->>'reason'=ANY(CASE WHEN c.schema_version=3
  THEN ARRAY['command_expired','stale_edit','confirmation_conflict','incomplete_preferences','incomplete_profile','legacy_preferences_review_required','candidate_privacy_restricted','consent_required','consent_changed','source_conflict','proposal_expired','exclusion_limit']
  ELSE ARRAY['command_expired','stale_edit','confirmation_conflict','incomplete_profile','candidate_privacy_restricted','invalid_request'] END))))
 OR EXISTS(SELECT 1 FROM unnest(ARRAY['draftVersion','profileVersion','preferenceVersion']) k
  WHERE jsonb_typeof(p_receipt->k) IS DISTINCT FROM 'number' OR (p_receipt->>k)!~'^(0|[1-9][0-9]{0,15})$' OR (p_receipt->>k)::numeric>9007199254740991)
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 UPDATE public.candidate_profile_outbox SET state=p_receipt->>'status',safe_reason=p_receipt->>'reason',
  receipt=p_receipt,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE command_id=p_command;
 RETURN jsonb_build_object('applied',true);
END $$;

REVOKE ALL ON FUNCTION public.flow_candidate_profile_record_ack() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_redact_due() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_expiry_pending() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_expiry_finish(uuid,jsonb) FROM PUBLIC;
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT p.oid::regprocedure::text sig,roles.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(p.proacl) a JOIN pg_roles roles ON roles.oid=a.grantee
 WHERE n.nspname='public' AND p.proname IN ('flow_candidate_profile_record_ack','flow_candidate_profile_redact_due',
 'flow_candidate_profile_expiry_pending','flow_candidate_profile_expiry_finish') AND a.grantee<>p.proowner LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',r.sig,r.rolname);
 END LOOP;
END $$;

-- Reviewed section: flow-consent-v2.sql
ALTER TABLE public.candidate_consent_sources ADD COLUMN source_schema_version integer NOT NULL DEFAULT 1 CHECK(source_schema_version IN (1,2));
ALTER TABLE public.candidate_consent_sources ADD COLUMN owned_binding_id uuid;
ALTER TABLE public.candidate_consent_sources ALTER COLUMN profile DROP NOT NULL;
ALTER TABLE public.candidate_consent_sources ALTER COLUMN profile_sha256 DROP NOT NULL;
DO $$ DECLARE old_expression text; BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT old_expression FROM pg_constraint
 WHERE conrelid='public.candidate_consent_sources'::regclass AND conname='consent_source_profile_shape';
 ALTER TABLE public.candidate_consent_sources DROP CONSTRAINT consent_source_profile_shape;
 EXECUTE 'ALTER TABLE public.candidate_consent_sources ADD CONSTRAINT consent_source_profile_shape CHECK ((source_schema_version=1 AND profile IS NOT NULL AND profile_sha256 IS NOT NULL AND owned_binding_id IS NULL AND ('||old_expression||')) OR (source_schema_version=2 AND profile IS NULL AND profile_sha256 IS NULL AND owned_binding_id IS NOT NULL AND resume IS NULL AND resume_sha256 IS NULL AND resume_version_id IS NULL))';
END $$;
ALTER TABLE public.candidate_consent_events DROP CONSTRAINT candidate_consent_events_schema_version_check;
ALTER TABLE public.candidate_consent_events DROP CONSTRAINT candidate_consent_events_purpose_version_check;
ALTER TABLE public.candidate_consent_events DROP CONSTRAINT candidate_consent_events_copy_version_check;
ALTER TABLE public.candidate_consent_events ADD COLUMN disclosed_purposes jsonb;
ALTER TABLE public.candidate_consent_events ADD COLUMN owned_binding_id uuid;
ALTER TABLE public.candidate_consent_events ADD CONSTRAINT consent_event_versioned_disclosure CHECK(
 (schema_version=1 AND purpose_version=1 AND copy_version=1 AND disclosed_purposes IS NULL AND owned_binding_id IS NULL)
 OR (schema_version=2 AND purpose_version=2 AND copy_version>0 AND owned_binding_id IS NOT NULL AND disclosed_purposes IS NOT NULL AND
 ((action='grant' AND disclosed_purposes='["job_matching","profile_enrichment","ai_processing","talent_network_discovery","recruiter_contact"]'::jsonb)
 OR (action='withdraw' AND disclosed_purposes='[]'::jsonb))));

CREATE TABLE public.candidate_consent_v2_copies (
 copy_version integer PRIMARY KEY CHECK(copy_version>0),copy_hash text NOT NULL CHECK(copy_hash~'^[0-9a-f]{64}$'),
 approved boolean NOT NULL DEFAULT false
);
REVOKE ALL ON public.candidate_consent_v2_copies FROM PUBLIC;
ALTER TABLE public.candidate_consent_v2_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_consent_v2_copies FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON public.candidate_consent_v2_copies TO CURRENT_USER USING(true) WITH CHECK(true);
CREATE FUNCTION public.flow_consent_v2_canonical(j jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public AS $$
DECLARE result text;BEGIN
 CASE jsonb_typeof(j)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.flow_consent_v2_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(j);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(public.flow_consent_v2_canonical(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(j) WITH ORDINALITY x(value,ord);
 ELSE result:=j::text; END CASE;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_canonical(jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_consent_v2_capture(p_user integer,p_auth integer,p_subject uuid,p_binding uuid,p_key uuid,
 p_expected bigint,p_action text,p_copy integer,p_copy_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE u public.users%ROWTYPE;s public.candidate_consent_subjects%ROWTYPE;e public.candidate_consent_events%ROWTYPE;
 sid uuid;eid uuid:=gen_random_uuid();oid uuid:=gen_random_uuid();v bigint;request_hash text;command_hash text;
 purposes jsonb;command jsonb;stamp timestamptz:=clock_timestamp();
BEGIN
 IF p_user IS NULL OR p_auth IS NULL OR p_subject IS NULL OR p_binding IS NULL OR p_key IS NULL OR p_expected IS NULL
 OR p_expected NOT BETWEEN 0 AND 9007199254740990 OR p_action IS NULL OR p_action NOT IN ('grant','withdraw')
 OR p_copy IS NULL OR p_copy<1 OR p_copy_hash IS NULL OR p_copy_hash!~'^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user);
 SELECT * INTO u FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR u.role IS DISTINCT FROM 'candidate' OR u.auth_version IS DISTINCT FROM p_auth
 OR (p_action='grant' AND u.email_verified IS NOT TRUE) THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.candidate_consent_subjects WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR s.subject_id<>p_subject OR NOT EXISTS(SELECT 1 FROM public.candidate_product_accounts
 WHERE user_id=p_user AND subject_id=p_subject AND binding_id=p_binding AND foundation_state='linked')
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 request_hash:=encode(sha256(convert_to(public.flow_consent_v2_canonical(jsonb_build_object('action',p_action,'expectedVersion',p_expected,
 'copyVersion',p_copy,'copyHash',p_copy_hash,'bindingId',p_binding)),'UTF8')),'hex');
 SELECT * INTO e FROM public.candidate_consent_events WHERE subject_id=p_subject AND request_id=p_key;
 IF FOUND THEN
  IF e.request_sha256 IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('eventId',e.event_id,'version',e.version,'replayed',true);
 END IF;
 IF s.version<>p_expected THEN RAISE EXCEPTION 'consent_version_conflict' USING ERRCODE='40001'; END IF;
 -- Withdrawal must not depend on a copy remaining approved.
 IF p_action='grant' AND NOT EXISTS(SELECT 1 FROM public.candidate_consent_v2_copies WHERE copy_version=p_copy AND copy_hash=p_copy_hash AND approved)
 THEN RAISE EXCEPTION 'consent_copy_unapproved' USING ERRCODE='42501'; END IF;
 v:=s.version+1;
 purposes:=CASE WHEN p_action='grant' THEN '["job_matching","profile_enrichment","ai_processing","talent_network_discovery","recruiter_contact"]'::jsonb ELSE '[]'::jsonb END;
 IF p_action='grant' THEN
  sid:=gen_random_uuid();
  INSERT INTO public.candidate_consent_sources(source_id,subject_id,source_version,profile,profile_sha256,approved_at,source_schema_version,owned_binding_id)
  VALUES(sid,p_subject,v,NULL,NULL,stamp,2,p_binding);
 END IF;
 command:=jsonb_build_object('schemaVersion',2,'subjectId',p_subject,'bindingId',p_binding,'eventId',eid,'version',v,'action',p_action,
 'copyVersion',CASE WHEN p_action='grant' THEN p_copy ELSE NULL END,'copyHash',CASE WHEN p_action='grant' THEN p_copy_hash ELSE NULL END,'purposes',purposes);
 command_hash:=encode(sha256(convert_to(public.flow_consent_v2_canonical(command),'UTF8')),'hex');
 INSERT INTO public.candidate_consent_events(event_id,subject_id,version,action,source_id,purpose,schema_version,purpose_version,copy_version,copy_sha256,
 user_id,verified_email_sha256,account_auth_version,request_id,request_sha256,command_sha256,captured_at,disclosed_purposes,owned_binding_id)
 VALUES(eid,p_subject,v,p_action,sid,'platform_professional_matching',2,2,p_copy,p_copy_hash,p_user,
 CASE WHEN p_action='grant' THEN encode(sha256(convert_to(lower(btrim(u.username)),'UTF8')),'hex') ELSE NULL END,
 CASE WHEN p_action='grant' THEN p_auth ELSE NULL END,p_key,request_hash,command_hash,stamp,purposes,p_binding);
 INSERT INTO public.candidate_consent_outbox(outbox_id,event_id,subject_id,version,idempotency_key,command_sha256,next_attempt_at,created_at,updated_at)
 VALUES(oid,eid,p_subject,v,encode(sha256(convert_to(eid::text,'UTF8')),'hex'),command_hash,stamp,stamp,stamp);
 UPDATE public.candidate_consent_subjects SET version=v,desired_action=p_action,current_source_id=sid,delivery_status='pending',last_error_code=NULL,updated_at=stamp WHERE subject_id=p_subject;
 RETURN jsonb_build_object('eventId',eid,'version',v,'replayed',false,'command',command);
END $$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_capture(integer,integer,uuid,uuid,uuid,bigint,text,integer,text) FROM PUBLIC;

CREATE FUNCTION public.flow_consent_v2_wire(p_event uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e public.candidate_consent_events%ROWTYPE;j jsonb;BEGIN
 SELECT * INTO e FROM public.candidate_consent_events WHERE event_id=p_event AND schema_version=2;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 j:=jsonb_build_object('schemaVersion',2,'subjectId',e.subject_id,'bindingId',e.owned_binding_id,'eventId',e.event_id,'version',e.version,'action',e.action,
 'copyVersion',CASE WHEN e.action='grant' THEN e.copy_version ELSE NULL END,'copyHash',CASE WHEN e.action='grant' THEN e.copy_sha256::text ELSE NULL END,'purposes',e.disclosed_purposes);
 IF encode(sha256(convert_to(public.flow_consent_v2_canonical(j),'UTF8')),'hex')<>e.command_sha256 THEN RAISE EXCEPTION 'consent_command_corrupt'; END IF;
 RETURN j;
END $$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_wire(uuid) FROM PUBLIC;

CREATE FUNCTION public.flow_consent_v2_ack(p_outbox uuid,p_generation integer,p_command_hash text,p_receipt jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE o public.candidate_consent_outbox%ROWTYPE;e public.candidate_consent_events%ROWTYPE;uid integer;
BEGIN
 SELECT ev.user_id INTO uid FROM public.candidate_consent_outbox b JOIN public.candidate_consent_events ev USING(event_id) WHERE b.outbox_id=p_outbox AND ev.schema_version=2;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 PERFORM 1 FROM public.users WHERE id=uid FOR UPDATE;
 SELECT * INTO o FROM public.candidate_consent_outbox WHERE outbox_id=p_outbox;
 PERFORM 1 FROM public.candidate_consent_subjects WHERE subject_id=o.subject_id FOR UPDATE;
 SELECT * INTO o FROM public.candidate_consent_outbox WHERE outbox_id=p_outbox FOR UPDATE;
 IF o.state IS DISTINCT FROM 'leased' OR o.generation IS DISTINCT FROM p_generation OR o.lease_expires_at IS NULL OR o.lease_expires_at<=clock_timestamp() THEN RETURN false; END IF;
 SELECT * INTO STRICT e FROM public.candidate_consent_events WHERE event_id=o.event_id;
 IF p_command_hash IS DISTINCT FROM o.command_sha256 OR p_receipt IS NULL OR jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_receipt))<>4 OR NOT p_receipt ?& ARRAY['eventId','version','outcome','effectiveVersion']
 OR p_receipt->>'eventId' IS DISTINCT FROM e.event_id::text OR p_receipt->'version' IS DISTINCT FROM to_jsonb(e.version)
 OR jsonb_typeof(p_receipt->'effectiveVersion') IS DISTINCT FROM 'number' OR (p_receipt->>'effectiveVersion')!~'^[1-9][0-9]{0,15}$'
 OR (p_receipt->>'effectiveVersion')::numeric>9007199254740991 OR coalesce(p_receipt->>'outcome','') NOT IN ('onboarding_granted','withdrawn','superseded')
 THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
 IF p_receipt->>'outcome'='superseded' THEN
  IF (p_receipt->>'effectiveVersion')::bigint<e.version THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
 ELSE
  IF p_receipt->'effectiveVersion' IS DISTINCT FROM to_jsonb(e.version) OR p_receipt->>'outcome' IS DISTINCT FROM
   (CASE WHEN e.action='grant' THEN 'onboarding_granted' ELSE 'withdrawn' END) THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
 END IF;
 UPDATE public.candidate_consent_outbox SET state='acknowledged',receipt=p_receipt,acknowledged_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE outbox_id=p_outbox;
 IF p_receipt->>'outcome'<>'superseded' THEN
  UPDATE public.candidate_consent_subjects SET acknowledged_version=e.version,acknowledged_action=e.action,effective_source_id=e.source_id,updated_at=clock_timestamp()
  WHERE subject_id=e.subject_id AND acknowledged_version<e.version;
 END IF;
 UPDATE public.candidate_consent_subjects SET delivery_status=CASE WHEN p_receipt->>'outcome'='superseded' THEN 'failed' ELSE 'delivered' END,
 last_error_code=CASE WHEN p_receipt->>'outcome'='superseded' THEN 'superseded' ELSE NULL END,updated_at=clock_timestamp()
 WHERE subject_id=e.subject_id AND version=e.version;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_ack(uuid,integer,text,jsonb) FROM PUBLIC;

DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT c.oid::regclass target,r.rolname FROM pg_class c
 CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee
 WHERE c.oid='public.candidate_consent_v2_copies'::regclass AND a.grantee<>c.relowner LOOP
  EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',item.target,item.rolname);
 END LOOP;
 FOR item IN SELECT p.oid::regprocedure target,r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee
 WHERE n.nspname='public' AND p.proname IN ('flow_consent_v2_canonical','flow_consent_v2_capture','flow_consent_v2_wire','flow_consent_v2_ack') AND a.grantee<>p.proowner LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',item.target,item.rolname);
 END LOOP;
END $$;

-- Reviewed section: flow-consent-versioned-claim.sql
DO $$ DECLARE body text; BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='public.flow_claim_candidate_consent_outbox(text,integer,integer,uuid)'::regprocedure;
 IF encode(sha256(convert_to(body,'UTF8')),'hex')<>'ee478a7145a5331b2e250987cb832b694b36be2f4f6d22092cdbb0a350dd4b06'
 THEN RAISE EXCEPTION 'consent_claim_baseline_mismatch'; END IF;
END $$;
CREATE FUNCTION public.flow_claim_consent_version(p_schema integer,p_worker text,p_limit integer,p_lease_ms integer,p_event_id uuid DEFAULT NULL)
RETURNS SETOF public.candidate_consent_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE s public.candidate_consent_subjects%ROWTYPE;claimed public.candidate_consent_outbox%ROWTYPE;
BEGIN
 IF p_schema IS NULL OR p_schema NOT IN (1,2) OR p_worker IS NULL OR octet_length(p_worker) NOT BETWEEN 1 AND 128
 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 300000
 THEN RAISE EXCEPTION 'candidate_consent_claim_invalid'; END IF;
 FOR s IN SELECT subject.* FROM public.candidate_consent_subjects subject
 WHERE EXISTS(SELECT 1 FROM public.candidate_consent_outbox o JOIN public.candidate_consent_events ev USING(event_id)
 WHERE o.subject_id=subject.subject_id AND ev.schema_version=p_schema AND (p_event_id IS NULL OR o.event_id=p_event_id)
 AND o.state IN ('pending','retry_wait','leased') AND o.next_attempt_at<=clock_timestamp()
 AND (o.state<>'leased' OR o.lease_expires_at<=clock_timestamp())
 AND ((subject.desired_action='withdraw' AND o.version=subject.version) OR NOT EXISTS(
 SELECT 1 FROM public.candidate_consent_outbox earlier WHERE earlier.subject_id=o.subject_id AND earlier.version<o.version AND earlier.state IN ('pending','leased','retry_wait'))))
 ORDER BY subject.updated_at,subject.subject_id FOR UPDATE OF subject SKIP LOCKED LIMIT p_limit LOOP
  -- A newest withdrawal supersedes both versions. Schema partition must never
  -- turn into independent ordering or skip an older grant for a newer grant.
  IF s.desired_action='withdraw' THEN
   UPDATE public.candidate_consent_outbox SET state='superseded',last_error_code='superseded',lease_owner=NULL,lease_expires_at=NULL,generation=generation+1,updated_at=clock_timestamp()
   WHERE subject_id=s.subject_id AND version<s.version AND state IN ('pending','leased','retry_wait');
  END IF;
  WITH exhausted AS (
   UPDATE public.candidate_consent_outbox SET state='terminal',last_error_code='retry_exhausted',lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
   WHERE subject_id=s.subject_id AND state='leased' AND lease_expires_at<=clock_timestamp() AND attempts>=8 RETURNING version
  ) UPDATE public.candidate_consent_subjects SET delivery_status='failed',last_error_code='retry_exhausted',updated_at=clock_timestamp()
   WHERE subject_id=s.subject_id AND version IN(SELECT version FROM exhausted);
  WITH eligible AS (
   SELECT o.outbox_id FROM public.candidate_consent_outbox o JOIN public.candidate_consent_events ev USING(event_id)
   WHERE o.subject_id=s.subject_id AND ev.schema_version=p_schema AND (p_event_id IS NULL OR o.event_id=p_event_id)
   AND o.state IN ('pending','retry_wait','leased') AND o.attempts<8 AND o.next_attempt_at<=clock_timestamp()
   AND (o.state<>'leased' OR o.lease_expires_at<=clock_timestamp())
   AND NOT EXISTS(SELECT 1 FROM public.candidate_consent_outbox earlier WHERE earlier.subject_id=o.subject_id AND earlier.version<o.version AND earlier.state IN ('pending','leased','retry_wait'))
   ORDER BY o.version FOR UPDATE OF o SKIP LOCKED LIMIT 1
  ) UPDATE public.candidate_consent_outbox o SET state='leased',attempts=o.attempts+1,generation=o.generation+1,
   lease_owner=p_worker,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_ms/1000.0),last_error_code=NULL,updated_at=clock_timestamp()
  FROM eligible e WHERE o.outbox_id=e.outbox_id RETURNING o.* INTO claimed;
  IF FOUND THEN RETURN NEXT claimed; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.flow_claim_consent_version(integer,text,integer,integer,uuid) FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.flow_claim_candidate_consent_outbox(p_worker text,p_limit integer,p_lease_ms integer,p_event_id uuid DEFAULT NULL)
RETURNS SETOF public.candidate_consent_outbox
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT * FROM public.flow_claim_consent_version(1,p_worker,p_limit,p_lease_ms,p_event_id);
$$;
CREATE FUNCTION public.flow_claim_candidate_consent_v2_outbox(p_worker text,p_limit integer,p_lease_ms integer,p_event_id uuid DEFAULT NULL)
RETURNS SETOF public.candidate_consent_outbox
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT * FROM public.flow_claim_consent_version(2,p_worker,p_limit,p_lease_ms,p_event_id);
$$;
REVOKE ALL ON FUNCTION public.flow_claim_candidate_consent_outbox(text,integer,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_claim_candidate_consent_v2_outbox(text,integer,integer,uuid) FROM PUBLIC;
-- Preserve reviewed legacy EXECUTE grants on its existing wrapper, but never
-- inherit default grants onto the new helper or v2 wrapper.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT p.oid::regprocedure target,r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee
 WHERE n.nspname='public' AND p.proname IN ('flow_claim_consent_version','flow_claim_candidate_consent_v2_outbox') AND a.grantee<>p.proowner LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',item.target,item.rolname);
 END LOOP;
END $$;

-- Reviewed section: flow-consent-versioned-settlement.sql
DO $$ DECLARE spec record; body text; definition text; marker text:='IF NOT FOUND THEN RETURN false; END IF;'; BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('public.flow_ack_candidate_consent_outbox(uuid,integer,jsonb)','e58b0136156e7c19d3fbf19fa43dd33de0cf8e4a111ca268179ccd502dc69714'),
  ('public.flow_fail_candidate_consent_outbox(uuid,integer,text,boolean,timestamp with time zone)','1c8aa740b13609078c9a42a0d2024360dc3c239c0b39ccdf2c45e89091af965c')
 ) v(signature,expected) LOOP
  SELECT prosrc,pg_get_functiondef(oid) INTO STRICT body,definition FROM pg_proc WHERE oid=spec.signature::regprocedure;
  IF encode(sha256(convert_to(body,'UTF8')),'hex')<>spec.expected THEN RAISE EXCEPTION 'consent_settlement_baseline_mismatch: %',spec.signature; END IF;
  IF (length(body)-length(replace(body,marker,'')))/length(marker)<>1 THEN RAISE EXCEPTION 'consent_settlement_marker_mismatch'; END IF;
  EXECUTE replace(definition,marker,marker||E'\n  IF NOT EXISTS(SELECT 1 FROM public.candidate_consent_events ev WHERE ev.event_id=o.event_id AND ev.schema_version=1) THEN RETURN false; END IF;');
  IF spec.signature LIKE '%flow_fail_%' THEN
   -- Same bounded retry behavior, but a distinct entrypoint cannot settle v1.
   definition:=replace(definition,'FUNCTION public.flow_fail_candidate_consent_outbox(','FUNCTION public.flow_fail_candidate_consent_v2_outbox(');
   EXECUTE replace(definition,marker,marker||E'\n  IF NOT EXISTS(SELECT 1 FROM public.candidate_consent_events ev WHERE ev.event_id=o.event_id AND ev.schema_version=2) THEN RETURN false; END IF;');
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.flow_fail_candidate_consent_v2_outbox(uuid,integer,text,boolean,timestamptz) FROM PUBLIC;
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT r.rolname FROM pg_proc p
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee
 WHERE p.oid='public.flow_fail_candidate_consent_v2_outbox(uuid,integer,text,boolean,timestamptz)'::regprocedure AND a.grantee<>p.proowner LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION public.flow_fail_candidate_consent_v2_outbox(uuid,integer,text,boolean,timestamptz) FROM %I',item.rolname);
 END LOOP;
END $$;

-- Reviewed section: flow-consent-v2-prepare.sql
CREATE FUNCTION public.flow_consent_v2_prepare(p_outbox uuid,p_generation integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE uid integer;u public.users%ROWTYPE;o public.candidate_consent_outbox%ROWTYPE;
 e public.candidate_consent_events%ROWTYPE;s public.candidate_consent_subjects%ROWTYPE;
BEGIN
 SELECT ev.user_id INTO uid FROM public.candidate_consent_outbox b JOIN public.candidate_consent_events ev USING(event_id)
 WHERE b.outbox_id=p_outbox AND ev.schema_version=2;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 SELECT * INTO u FROM public.users WHERE id=uid FOR UPDATE;
 SELECT * INTO o FROM public.candidate_consent_outbox WHERE outbox_id=p_outbox;
 SELECT * INTO s FROM public.candidate_consent_subjects WHERE subject_id=o.subject_id FOR UPDATE;
 SELECT * INTO o FROM public.candidate_consent_outbox WHERE outbox_id=p_outbox FOR UPDATE;
 IF o.state IS DISTINCT FROM 'leased' OR o.generation IS DISTINCT FROM p_generation
 OR o.lease_expires_at IS NULL OR o.lease_expires_at<=clock_timestamp()+interval '15 seconds' THEN RETURN NULL; END IF;
 SELECT * INTO STRICT e FROM public.candidate_consent_events WHERE event_id=o.event_id;
 IF e.action='grant' THEN
  IF u.id IS NULL OR u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS DISTINCT FROM true
   OR u.auth_version IS DISTINCT FROM e.account_auth_version
   OR encode(sha256(convert_to(lower(btrim(u.username)),'UTF8')),'hex') IS DISTINCT FROM e.verified_email_sha256
  THEN RAISE EXCEPTION 'account_changed' USING ERRCODE='42501'; END IF;
  -- Older grants must drain in order before a newer grant. Only withdrawal
  -- supersedes the queue; requiring exact current version would starve it.
  IF s.desired_action IS DISTINCT FROM 'grant' THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.candidate_product_accounts a WHERE a.user_id=uid AND a.subject_id=e.subject_id
   AND a.binding_id=e.owned_binding_id AND a.foundation_state='linked')
  THEN RAISE EXCEPTION 'account_changed' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.candidate_consent_v2_copies c WHERE c.copy_version=e.copy_version
   AND c.copy_hash=e.copy_sha256 AND c.approved)
  THEN RAISE EXCEPTION 'account_changed' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN jsonb_build_object('command',public.flow_consent_v2_wire(e.event_id),'userId',uid,'commandHash',o.command_sha256);
END $$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_prepare(uuid,integer) FROM PUBLIC;
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT r.rolname FROM pg_proc p
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee
 WHERE p.oid='public.flow_consent_v2_prepare(uuid,integer)'::regprocedure AND a.grantee<>p.proowner LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION public.flow_consent_v2_prepare(uuid,integer) FROM %I',item.rolname);
 END LOOP;
END $$;

-- Browser admission resolves identity and withdrawal disclosure from Flow's
-- authority. The browser never chooses a subject/binding or accepts a new copy
-- to withdraw. This wrapper does not grant access to the internal capture helper.
CREATE FUNCTION public.flow_consent_v2_capture_owned(p_user integer,p_auth integer,p_key uuid,
 p_expected bigint,p_action text,p_copy integer,p_copy_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE u public.users%ROWTYPE;a public.candidate_product_accounts%ROWTYPE;
 e public.candidate_consent_events%ROWTYPE; result jsonb;copy_number integer;copy_digest text;
BEGIN
 IF p_user IS NULL OR p_user<1 OR p_auth IS NULL OR p_auth<0 OR p_key IS NULL
 OR p_expected IS NULL OR p_expected NOT BETWEEN 0 AND 9007199254740990
 OR p_action IS NULL OR p_action NOT IN ('grant','withdraw')
 OR (p_action='withdraw' AND (p_copy IS NOT NULL OR p_copy_hash IS NOT NULL))
 OR (p_action='grant' AND (p_copy IS NULL OR p_copy<1 OR p_copy_hash IS NULL OR p_copy_hash!~'^[0-9a-f]{64}$'))
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user);
 SELECT * INTO u FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR u.role IS DISTINCT FROM 'candidate' OR u.auth_version IS DISTINCT FROM p_auth
 OR (p_action='grant' AND u.email_verified IS NOT TRUE)
 THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=p_user;
 IF NOT FOUND OR a.foundation_state IS DISTINCT FROM 'linked'
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM public.candidate_consent_subjects WHERE user_id=p_user AND subject_id=a.subject_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 copy_number:=p_copy;copy_digest:=p_copy_hash;
 IF p_action='withdraw' THEN
  -- Preserve the first request's metadata on replay even if a newer grant has
  -- a different copy. This cannot turn a withdrawal into a grant.
  SELECT * INTO e FROM public.candidate_consent_events WHERE subject_id=a.subject_id AND request_id=p_key;
  IF NOT FOUND THEN
   SELECT * INTO e FROM public.candidate_consent_events WHERE subject_id=a.subject_id ORDER BY version DESC LIMIT 1;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  copy_number:=e.copy_version;copy_digest:=e.copy_sha256;
 END IF;
 result:=public.flow_consent_v2_capture(p_user,p_auth,a.subject_id,a.binding_id,p_key,p_expected,p_action,copy_number,copy_digest);
 RETURN jsonb_build_object('schemaVersion',2,'eventId',result->'eventId','consentRevision',result->'version',
  'status','recorded','replayed',result->'replayed');
END $$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_capture_owned(integer,integer,uuid,bigint,text,integer,text) FROM PUBLIC;

CREATE FUNCTION public.flow_consent_v2_owner_read(p_user integer,p_auth integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE u public.users%ROWTYPE;s public.candidate_consent_subjects%ROWTYPE;
BEGIN
 IF p_user IS NULL OR p_user<1 OR p_auth IS NULL OR p_auth<0 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user);
 SELECT * INTO u FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR u.role IS DISTINCT FROM 'candidate' OR u.auth_version IS DISTINCT FROM p_auth
 THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501'; END IF;
 SELECT s0.* INTO s FROM public.candidate_consent_subjects s0
 JOIN public.candidate_product_accounts a ON a.user_id=s0.user_id AND a.subject_id=s0.subject_id AND a.foundation_state='linked'
 WHERE s0.user_id=p_user FOR UPDATE OF s0;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('schemaVersion',2,'consentRevision',s.version,'desiredAction',s.desired_action,
  'acknowledgedRevision',s.acknowledged_version,'acknowledgedAction',s.acknowledged_action,
  'desiredSchemaVersion',(SELECT schema_version FROM public.candidate_consent_events WHERE subject_id=s.subject_id AND version=s.version),
  'acknowledgedSchemaVersion',(SELECT schema_version FROM public.candidate_consent_events WHERE subject_id=s.subject_id AND version=s.acknowledged_version),
  'deliveryStatus',s.delivery_status);
END $$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_owner_read(integer,integer) FROM PUBLIC;

-- A signup checkbox is not yet a grant: the verified linked owner must activate
-- this exact, approved copy. No browser identity or purpose list is accepted.
CREATE TABLE public.candidate_consent_signup_intents (
 user_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL UNIQUE, copy_version integer NOT NULL CHECK(copy_version>0),
 copy_hash text NOT NULL CHECK(copy_hash~'^[0-9a-f]{64}$'),
 email_hash text NOT NULL CHECK(email_hash~'^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '7 days',
 activation_receipt jsonb
);
REVOKE ALL ON public.candidate_consent_signup_intents FROM PUBLIC;
ALTER TABLE public.candidate_consent_signup_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_consent_signup_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON public.candidate_consent_signup_intents TO CURRENT_USER USING(true) WITH CHECK(true);
-- Payload-free lookup for verification-email branding. No table access grant.
CREATE FUNCTION public.flow_consent_v2_signup_origin(p_user integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
SET statement_timeout='2s' AS $$
 SELECT EXISTS(SELECT 1 FROM public.candidate_consent_signup_intents i
 JOIN public.users u ON u.id=i.user_id
 WHERE i.user_id=p_user AND u.role='candidate'
 AND i.email_hash=encode(sha256(convert_to(u.username,'UTF8')),'hex'));
$$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_signup_origin(integer) FROM PUBLIC;
CREATE FUNCTION public.flow_consent_v2_signup_intent(p_user integer,p_key uuid,p_copy integer,p_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE u public.users%ROWTYPE;i public.candidate_consent_signup_intents%ROWTYPE;email_digest text;
BEGIN
 IF p_user IS NULL OR p_user<1 OR p_key IS NULL OR p_copy IS NULL OR p_copy<1 OR p_hash IS NULL OR p_hash!~'^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user);
 SELECT * INTO u FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS TRUE
 THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.candidate_consent_v2_copies WHERE copy_version=p_copy AND copy_hash=p_hash AND approved)
 THEN RAISE EXCEPTION 'consent_copy_unapproved' USING ERRCODE='42501';END IF;
 email_digest:=encode(sha256(convert_to(u.username,'UTF8')),'hex');
 SELECT * INTO i FROM public.candidate_consent_signup_intents WHERE user_id=p_user FOR UPDATE;
 IF FOUND THEN
  IF i.request_id IS DISTINCT FROM p_key OR i.copy_version IS DISTINCT FROM p_copy OR i.copy_hash IS DISTINCT FROM p_hash OR i.email_hash IS DISTINCT FROM email_digest
  THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN true;
 END IF;
 INSERT INTO public.candidate_consent_signup_intents(user_id,request_id,copy_version,copy_hash,email_hash)
 VALUES(p_user,p_key,p_copy,p_hash,email_digest);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_signup_intent(integer,uuid,integer,text) FROM PUBLIC;
CREATE FUNCTION public.flow_consent_v2_signup_activate(p_user integer,p_auth integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE u public.users%ROWTYPE;i public.candidate_consent_signup_intents%ROWTYPE;
 a public.candidate_product_accounts%ROWTYPE;s public.candidate_consent_subjects%ROWTYPE;r jsonb;
BEGIN
 IF p_user IS NULL OR p_user<1 OR p_auth IS NULL OR p_auth<0 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user);
 SELECT * INTO u FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR u.role IS DISTINCT FROM 'candidate' OR u.auth_version IS DISTINCT FROM p_auth OR u.email_verified IS NOT TRUE
 THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501';END IF;
 SELECT * INTO i FROM public.candidate_consent_signup_intents WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('schemaVersion',2,'status','none','receipt',NULL);END IF;
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=p_user;
 IF NOT FOUND OR a.foundation_state IS DISTINCT FROM 'linked' THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 SELECT * INTO s FROM public.candidate_consent_subjects WHERE user_id=p_user AND subject_id=a.subject_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 -- Current consent wins, including a withdrawal racing a lost activation reply.
 IF i.activation_receipt IS NOT NULL AND s.version=(i.activation_receipt->>'consentRevision')::bigint AND s.desired_action='grant' THEN
  RETURN jsonb_build_object('schemaVersion',2,'status','activated','receipt',i.activation_receipt||'{"replayed":true}'::jsonb);
 END IF;
 IF s.version<>0 OR i.activation_receipt IS NOT NULL OR i.email_hash IS DISTINCT FROM encode(sha256(convert_to(u.username,'UTF8')),'hex') THEN
  RETURN jsonb_build_object('schemaVersion',2,'status','superseded','receipt',NULL);
 END IF;
 IF i.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('schemaVersion',2,'status','expired','receipt',NULL);END IF;
 -- Re-check approval now; registration approval does not bypass revocation.
 r:=public.flow_consent_v2_capture_owned(p_user,p_auth,i.request_id,0,'grant',i.copy_version,i.copy_hash);
 UPDATE public.candidate_consent_signup_intents SET activation_receipt=r WHERE user_id=p_user;
 RETURN jsonb_build_object('schemaVersion',2,'status','activated','receipt',r);
END $$;
REVOKE ALL ON FUNCTION public.flow_consent_v2_signup_activate(integer,integer) FROM PUBLIC;
DO $$ DECLARE item record;BEGIN
 FOR item IN SELECT r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
 JOIN pg_roles r ON r.oid=x.grantee WHERE c.oid='public.candidate_consent_signup_intents'::regclass AND x.grantee<>c.relowner LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.candidate_consent_signup_intents FROM %I',item.rolname);
 END LOOP;
 FOR item IN SELECT p.oid::regprocedure target,r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x JOIN pg_roles r ON r.oid=x.grantee
 WHERE n.nspname='public' AND p.proname IN ('flow_consent_v2_signup_intent','flow_consent_v2_signup_activate','flow_consent_v2_signup_origin') AND x.grantee<>p.proowner LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',item.target,item.rolname);
 END LOOP;
END $$;

-- Caller holds the per-user consent/account lock. Only an acknowledged current
-- v2 grant with the exact reviewed purposes/copy/binding authorizes confirmation.
CREATE FUNCTION public.flow_candidate_profile_consent_ready(p_user integer,p_subject uuid,p_binding uuid,p_revision bigint)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.candidate_consent_subjects s
 JOIN public.candidate_consent_events e ON e.subject_id=s.subject_id AND e.version=s.version
 JOIN public.candidate_consent_v2_copies c ON c.copy_version=e.copy_version AND c.copy_hash=e.copy_sha256 AND c.approved
 WHERE s.user_id=p_user AND s.subject_id=p_subject AND s.version=p_revision AND s.acknowledged_version=p_revision
 AND s.desired_action='grant' AND s.acknowledged_action='grant' AND s.delivery_status='delivered'
 AND e.schema_version=2 AND e.action='grant' AND e.owned_binding_id=p_binding
 AND e.disclosed_purposes='["job_matching","profile_enrichment","ai_processing","talent_network_discovery","recruiter_contact"]'::jsonb);
$$;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_consent_ready(integer,uuid,uuid,bigint) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_profile_prepare(p_command uuid,p_token uuid,p_generation bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE c public.candidate_profile_commands%ROWTYPE;u public.users%ROWTYPE;o public.candidate_profile_outbox%ROWTYPE;uid integer;
BEGIN
 SELECT user_id INTO uid FROM public.candidate_profile_commands WHERE command_id=p_command;
 IF NOT FOUND THEN RETURN NULL; END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 SELECT * INTO u FROM public.users WHERE id=uid FOR UPDATE;
 SELECT * INTO c FROM public.candidate_profile_commands WHERE command_id=p_command;
 SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=p_command FOR UPDATE;
 IF o.state<>'leased' OR o.lease_token IS DISTINCT FROM p_token OR o.lease_generation IS DISTINCT FROM p_generation
 OR o.lease_expires_at<=clock_timestamp()+interval '15 seconds' OR c.body IS NULL THEN RETURN NULL; END IF;
 IF u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS NOT TRUE OR u.auth_version IS DISTINCT FROM c.admitted_auth_version
 THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.candidate_product_accounts WHERE user_id=c.user_id AND subject_id=c.subject_id AND binding_id=c.binding_id AND foundation_state='linked')
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 IF c.schema_version=3 AND c.action IN ('confirm','accept_source','accept_interpretation') AND NOT public.flow_candidate_profile_consent_ready(c.user_id,c.subject_id,c.binding_id,c.consent_revision)
 THEN RAISE EXCEPTION 'consent_changed' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('subjectId',c.subject_id,'bindingId',c.binding_id,'userId',c.user_id,
  'authVersion',c.admitted_auth_version,'commandHash',c.body_hash);
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_prepare(uuid,uuid,bigint) FROM PUBLIC;

-- Recovery leases are separate from paid acquisition. No provider can be called
-- here: the only payload is the identity of an already redacted v3 command.
CREATE FUNCTION public.flow_candidate_profile_expiry_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE hint record;c public.candidate_profile_commands%ROWTYPE;o public.candidate_profile_outbox%ROWTYPE;answer jsonb:='[]';
BEGIN
 FOR hint IN SELECT d.command_id,d.user_id FROM public.candidate_profile_commands d
 JOIN public.candidate_profile_outbox b USING(command_id)
 WHERE d.schema_version IN (2,3) AND d.body IS NULL AND d.body_hash IS NOT NULL
 AND b.state='held' AND b.safe_reason='expiry_reconciling' AND b.next_attempt_at<=clock_timestamp()
 AND (b.lease_expires_at IS NULL OR b.lease_expires_at<=clock_timestamp())
 ORDER BY b.next_attempt_at,d.command_id LIMIT 50 LOOP
  IF NOT pg_try_advisory_xact_lock(41943,hint.user_id) THEN CONTINUE; END IF;
  PERFORM 1 FROM public.users WHERE id=hint.user_id FOR UPDATE;
  SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=hint.command_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN CONTINUE; END IF;
  SELECT * INTO c FROM public.candidate_profile_commands WHERE command_id=hint.command_id;
  IF c.body IS NOT NULL OR c.body_hash IS NULL OR o.state<>'held' OR o.safe_reason IS DISTINCT FROM 'expiry_reconciling'
  OR o.next_attempt_at>clock_timestamp() OR o.lease_expires_at>clock_timestamp() THEN CONTINUE; END IF;
  IF o.recovery_attempts>=12 OR o.lease_generation>=9007199254740991 THEN
   UPDATE public.candidate_profile_outbox SET safe_reason='recovery_review_required',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
   WHERE command_id=c.command_id; CONTINUE;
  END IF;
  UPDATE public.candidate_profile_outbox SET lease_token=gen_random_uuid(),lease_generation=lease_generation+1,
   recovery_attempts=recovery_attempts+1,
   lease_expires_at=clock_timestamp()+interval '60 seconds',next_attempt_at=clock_timestamp()+interval '1 minute'
   WHERE command_id=c.command_id RETURNING * INTO o;
  answer:=answer||jsonb_build_array(jsonb_build_object('schemaVersion',c.schema_version,'commandId',c.command_id,'subjectId',c.subject_id,
   'bindingId',c.binding_id,'idempotencyKey',c.idempotency_key,'commandHash',c.body_hash,'userId',c.user_id,
   'leaseToken',o.lease_token,'leaseGeneration',o.lease_generation));
  IF jsonb_array_length(answer)>=5 THEN EXIT; END IF;
 END LOOP;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_expiry_claim() FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_profile_expiry_prepare(p_command uuid,p_token uuid,p_generation bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE uid integer;
BEGIN
 SELECT user_id INTO uid FROM public.candidate_profile_commands WHERE command_id=p_command;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 PERFORM 1 FROM public.users WHERE id=uid FOR UPDATE;
 PERFORM 1 FROM public.candidate_profile_outbox WHERE command_id=p_command FOR UPDATE;
 RETURN EXISTS(SELECT 1 FROM public.candidate_profile_commands c JOIN public.candidate_profile_outbox o USING(command_id)
 JOIN public.candidate_product_accounts a ON a.user_id=c.user_id AND a.subject_id=c.subject_id AND a.binding_id=c.binding_id
 WHERE c.command_id=p_command AND c.schema_version IN (2,3) AND c.body IS NULL AND c.body_hash IS NOT NULL AND a.foundation_state='linked'
 AND o.state='held' AND o.safe_reason='expiry_reconciling' AND o.lease_token=p_token AND o.lease_generation=p_generation
 AND o.lease_expires_at>clock_timestamp()+interval '15 seconds');
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_expiry_prepare(uuid,uuid,bigint) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_profile_expiry_settle(p_command uuid,p_token uuid,p_generation bigint,p_receipt jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE uid integer;o public.candidate_profile_outbox%ROWTYPE;answer jsonb;
BEGIN
 SELECT user_id INTO uid FROM public.candidate_profile_commands WHERE command_id=p_command;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false); END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 PERFORM 1 FROM public.users WHERE id=uid FOR UPDATE;
 SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=p_command FOR UPDATE;
 IF o.state<>'held' OR o.safe_reason IS DISTINCT FROM 'expiry_reconciling' OR o.lease_token IS DISTINCT FROM p_token
 OR o.lease_generation IS DISTINCT FROM p_generation OR o.lease_expires_at<=clock_timestamp()
 THEN RETURN jsonb_build_object('applied',false); END IF;
 IF p_receipt IS NULL THEN
  UPDATE public.candidate_profile_outbox SET lease_token=NULL,lease_expires_at=NULL,
   safe_reason=CASE WHEN recovery_attempts>=12 THEN 'recovery_review_required' ELSE 'expiry_reconciling' END,
   next_attempt_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() WHERE command_id=p_command;
  RETURN jsonb_build_object('applied',false);
 END IF;
 answer:=public.flow_candidate_profile_expiry_finish(p_command,p_receipt);
 UPDATE public.candidate_profile_outbox SET lease_token=NULL,lease_expires_at=NULL WHERE command_id=p_command;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_expiry_settle(uuid,uuid,bigint,jsonb) FROM PUBLIC;

-- Owner UI projection, not an alternate receipt. An unknown result always
-- blocks confirmation until Memory returns the original receipt or tombstone.
CREATE FUNCTION public.flow_candidate_profile_resolution_view(p_command uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.candidate_profile_commands%ROWTYPE;o public.candidate_profile_outbox%ROWTYPE;s text;r text;retry boolean:=false;discard boolean:=false;
BEGIN
 SELECT * INTO c FROM public.candidate_profile_commands WHERE command_id=p_command;
 SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=p_command;
 IF c.command_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 IF o.state='applied' THEN s:='applied';r:='already_applied';
 ELSIF o.state='rejected' THEN
  IF o.resolution_action='discard' AND o.receipt->>'reason'='command_expired' THEN s:='discarded';r:='discard_acknowledged';
  ELSE s:='rejected';r:='remote_rejected';END IF;
 ELSIF o.safe_reason='recovery_review_required' THEN s:='operator_review';r:='recovery_exhausted';
 ELSIF o.safe_reason='expiry_reconciling' THEN s:='resolving';r:='outcome_unknown';
 ELSIF o.resolution_action='retry' AND o.state IN ('queued','retry','leased') THEN s:='retry_queued';r:='outcome_unknown';
 ELSE
  s:='none';r:=CASE o.safe_reason WHEN 'identity_conflict' THEN 'identity_conflict'
   WHEN 'authentication_changed' THEN 'authentication_required' WHEN 'invalid_request' THEN 'invalid_command' ELSE 'retry_available' END;
  retry:=c.body IS NOT NULL AND NOT o.manual_retry_used AND o.state IN ('held','retry')
   AND o.safe_reason IN ('authority_unavailable','memory_unavailable','delivery_outcome_unknown','retry_exhausted');
  discard:=c.body_hash IS NOT NULL;
 END IF;
 RETURN jsonb_build_object('schemaVersion',1,'commandId',c.command_id,'commandSchemaVersion',c.schema_version,
 'resolutionRevision',o.resolution_revision,'state',s,'reason',r,'canRetry',retry,'canDiscard',discard,
 'blocksConfirmation',o.state NOT IN ('applied','rejected'));
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_resolution_view(uuid) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_profile_resolve(p_user integer,p_auth integer,p_command uuid,p_key uuid,p_revision bigint,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE c public.candidate_profile_commands%ROWTYPE;o public.candidate_profile_outbox%ROWTYPE;prior jsonb;v jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('read','retry','discard') OR p_user IS NULL OR p_user<1 OR p_command IS NULL
 OR (p_action='read' AND (p_key IS NOT NULL OR p_revision IS NOT NULL))
 OR (p_action<>'read' AND (p_key IS NULL OR p_revision IS NULL OR p_revision<0 OR p_revision>=9007199254740991))
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user);
 PERFORM 1 FROM public.users WHERE id=p_user AND auth_version=p_auth AND role='candidate' AND email_verified IS TRUE FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 SELECT c0.* INTO c FROM public.candidate_profile_commands c0 JOIN public.candidate_product_accounts a
 ON a.user_id=c0.user_id AND a.subject_id=c0.subject_id AND a.binding_id=c0.binding_id AND a.foundation_state='linked'
 WHERE c0.command_id=p_command AND c0.user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 SELECT * INTO o FROM public.candidate_profile_outbox WHERE command_id=p_command FOR UPDATE;
 IF p_action='read' THEN RETURN public.flow_candidate_profile_resolution_view(p_command);END IF;
 prior:=o.resolution_requests->p_key::text;
 IF prior IS NOT NULL THEN
  IF prior->>'action' IS DISTINCT FROM p_action OR (prior->>'expectedRevision')::bigint IS DISTINCT FROM p_revision
  THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN prior->'receipt';
 END IF;
 IF o.resolution_revision<>p_revision THEN RAISE EXCEPTION 'resolution_conflict' USING ERRCODE='40001';END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(o.resolution_requests))>=16
 THEN RAISE EXCEPTION 'resolution_limit' USING ERRCODE='42501';END IF;
 v:=public.flow_candidate_profile_resolution_view(p_command);
 IF o.state NOT IN ('applied','rejected') THEN
  IF p_action='retry' THEN
   IF v->'canRetry'<>'true'::jsonb OR c.admitted_auth_version<>p_auth
    OR c.created_at<=clock_timestamp()-interval '30 days'
    OR (c.schema_version=3 AND c.action IN ('confirm','accept_source','accept_interpretation') AND NOT public.flow_candidate_profile_consent_ready(p_user,c.subject_id,c.binding_id,c.consent_revision))
   THEN RAISE EXCEPTION 'resolution_unavailable' USING ERRCODE='42501';END IF;
   -- One explicit extra delivery cycle, never a new command or provider call.
   UPDATE public.candidate_profile_outbox SET state='queued',safe_reason=NULL,attempts=0,manual_retry_used=true,
    resolution_action='retry',lease_token=NULL,lease_expires_at=NULL,next_attempt_at=clock_timestamp() WHERE command_id=p_command;
  ELSE
   IF v->'canDiscard'<>'true'::jsonb THEN RAISE EXCEPTION 'resolution_unavailable' USING ERRCODE='42501';END IF;
   UPDATE public.candidate_profile_commands SET body=NULL,redacted_at=clock_timestamp() WHERE command_id=p_command;
   UPDATE public.candidate_profile_outbox SET state='held',safe_reason='expiry_reconciling',resolution_action='discard',
    lease_token=NULL,lease_expires_at=NULL,next_attempt_at=clock_timestamp() WHERE command_id=p_command;
  END IF;
 END IF;
 UPDATE public.candidate_profile_outbox SET resolution_revision=resolution_revision+1,updated_at=clock_timestamp() WHERE command_id=p_command;
 v:=public.flow_candidate_profile_resolution_view(p_command);
 UPDATE public.candidate_profile_outbox SET resolution_requests=resolution_requests||jsonb_build_object(p_key::text,
  jsonb_build_object('action',p_action,'expectedRevision',p_revision,'receipt',v)) WHERE command_id=p_command;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_resolve(integer,integer,uuid,uuid,bigint,text) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_profile_recovery_refuse(p_command uuid,p_token uuid,p_generation bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE uid integer;
BEGIN
 SELECT user_id INTO uid FROM public.candidate_profile_commands WHERE command_id=p_command;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false);END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);PERFORM 1 FROM public.users WHERE id=uid FOR UPDATE;
 UPDATE public.candidate_profile_outbox SET safe_reason='recovery_review_required',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
 WHERE command_id=p_command AND state='held' AND safe_reason='expiry_reconciling' AND lease_token=p_token
 AND lease_generation=p_generation AND lease_expires_at>clock_timestamp();
 RETURN jsonb_build_object('applied',FOUND);
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_recovery_refuse(uuid,uuid,bigint) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_profile_recovery_review_count() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='3s' AS $$
 SELECT count(*) FROM public.candidate_profile_outbox WHERE state='held' AND safe_reason='recovery_review_required';
$$;
REVOKE ALL ON FUNCTION public.flow_candidate_profile_recovery_review_count() FROM PUBLIC;

-- P0 source authority. These tables and entrypoints remain OWNER ONLY until the
-- bounded object reader, route/worker integration and permission review land.
-- Object metadata must come from a verified immutable GCS generation and a
-- signed Memory read, never the browser or a mutable resume path alone.
CREATE TABLE public.candidate_source_objects (
 source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_version bigint NOT NULL CHECK(source_version BETWEEN 1 AND 9007199254740991),
 user_id integer NOT NULL REFERENCES public.users(id), resume_id integer NOT NULL REFERENCES public.candidate_resumes(id),
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'), byte_length integer NOT NULL CHECK(byte_length BETWEEN 1 AND 5242880),
 media_type text NOT NULL CHECK(media_type IN ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
 policy_version text NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 80), object_handle uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 gcs_path text NOT NULL, gcs_generation text NOT NULL CHECK(gcs_generation~'^[0-9]+$'),
 original_versions jsonb NOT NULL, restricted boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(source_id,user_id), UNIQUE(user_id,resume_id,source_version)
);
CREATE TABLE public.candidate_source_requests (
 user_id integer NOT NULL REFERENCES public.users(id), request_key uuid NOT NULL, request_body jsonb NOT NULL,
 receipt jsonb NOT NULL, PRIMARY KEY(user_id,request_key)
);
CREATE TABLE public.candidate_source_jobs (
 command_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id integer NOT NULL, source_id uuid NOT NULL,
 subject_id uuid NOT NULL, binding_id uuid NOT NULL, consent_revision bigint NOT NULL,
 admitted_auth_version integer NOT NULL, state text NOT NULL DEFAULT 'queued'
 CHECK(state IN ('queued','extracting','building','transferring','review_ready','unavailable','held')),
 reason text, proposal_id uuid, lease_token uuid, generation bigint NOT NULL DEFAULT 0 CHECK(generation BETWEEN 0 AND 9007199254740991),
 lease_until timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 12),
 transfer_document jsonb, receipt_document jsonb, previous_command_id uuid UNIQUE REFERENCES public.candidate_source_jobs(command_id),
 extraction_document jsonb, extraction_context_hash text CHECK(extraction_context_hash IS NULL OR extraction_context_hash~'^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), acknowledged_at timestamptz,
 FOREIGN KEY(source_id,user_id) REFERENCES public.candidate_source_objects(source_id,user_id),
 FOREIGN KEY(subject_id,user_id,binding_id) REFERENCES public.candidate_product_accounts(subject_id,user_id,binding_id),
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
-- Owner-only monotonic budget time. Never extend an expired allowance because
-- the host wall clock moved backwards. This is not a lease/consent clock.
CREATE TABLE public.candidate_source_budget_clocks (
 kind text PRIMARY KEY CHECK(kind IN ('ocr','semantic_model','lookup')),
 observed_at timestamptz NOT NULL
);
CREATE FUNCTION public.flow_candidate_source_budget_now(p_kind text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t timestamptz;
BEGIN
 IF p_kind NOT IN ('ocr','semantic_model','lookup') OR p_kind IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 INSERT INTO public.candidate_source_budget_clocks(kind,observed_at) VALUES(p_kind,clock_timestamp())
 ON CONFLICT(kind) DO UPDATE SET observed_at=greatest(candidate_source_budget_clocks.observed_at,excluded.observed_at)
 RETURNING observed_at INTO t;
 RETURN t;
END $$;
CREATE TABLE public.candidate_source_budget_windows (
 kind text NOT NULL CHECK(kind IN ('ocr','semantic_model')), period text NOT NULL CHECK(period IN ('day','month')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 global_units bigint NOT NULL CHECK(global_units BETWEEN 0 AND 9007199254740991),
 per_candidate_units bigint NOT NULL CHECK(per_candidate_units BETWEEN 0 AND global_units),
 PRIMARY KEY(kind,period,starts_at)
);
CREATE TABLE public.candidate_source_paid_operations (
 reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), command_id uuid NOT NULL REFERENCES public.candidate_source_jobs(command_id),
 operation_key uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('ocr','semantic_model')),
 identity jsonb NOT NULL, units bigint NOT NULL CHECK(units BETWEEN 1 AND 9007199254740991),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','dispatched','settled','held','released')),
 dispatch_id uuid, grant_body jsonb, receipt jsonb, result_document jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(command_id,operation_key), UNIQUE(command_id,kind),
 CHECK((state IN ('dispatched','settled','held'))=(dispatch_id IS NOT NULL))
);
CREATE INDEX candidate_source_jobs_pending ON public.candidate_source_jobs(created_at) WHERE state IN ('queued','extracting','building','transferring');

CREATE FUNCTION public.flow_candidate_source_shape(j jsonb,keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(j)='object' THEN j ?& keys AND (SELECT count(*) FROM jsonb_object_keys(j))=cardinality(keys) ELSE false END;
$$;
CREATE FUNCTION public.flow_candidate_source_uint(j jsonb,positive boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(j)='number' AND j::text~'^(0|[1-9][0-9]{0,15})$'
 THEN j::text::numeric BETWEEN CASE WHEN positive THEN 1 ELSE 0 END AND 9007199254740991 ELSE false END;
$$;
CREATE FUNCTION public.flow_candidate_source_status_value(p_command uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('commandId',j.command_id,'sourceId',s.source_id,'sourceVersion',s.source_version,
 'state',j.state,'reason',j.reason,'proposalId',j.proposal_id)
 FROM public.candidate_source_jobs j JOIN public.candidate_source_objects s USING(source_id) WHERE j.command_id=p_command;
$$;
CREATE FUNCTION public.flow_candidate_source_owned_value(p_source uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('source',jsonb_build_object('sourceId',source_id,'sourceVersion',source_version,'contentHash',content_hash),
 'byteLength',byte_length,'mediaType',media_type,'policyVersion',policy_version,'objectHandle',object_handle)
 FROM public.candidate_source_objects WHERE source_id=p_source;
$$;
CREATE FUNCTION public.flow_candidate_source_owner(p_user bigint) RETURNS public.candidate_product_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;
BEGIN
 IF p_user IS NULL OR p_user NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user::integer);
 IF EXISTS(SELECT 1 FROM public.candidate_source_erasures WHERE user_id=p_user)
 THEN RAISE EXCEPTION 'candidate_privacy_restricted' USING ERRCODE='42501';END IF;
 PERFORM 1 FROM public.users WHERE id=p_user AND role='candidate' AND email_verified IS TRUE FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=p_user AND foundation_state='linked';
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 RETURN a;
END $$;
CREATE FUNCTION public.flow_candidate_source_snapshot(p_user bigint,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE s public.candidate_source_objects%ROWTYPE;previous public.candidate_source_requests%ROWTYPE;k uuid;v jsonb;
BEGIN
 PERFORM public.flow_candidate_source_owner(p_user);
 IF NOT coalesce(public.flow_candidate_source_shape(p_request,ARRAY['schemaVersion','idempotencyKey','resumeId']),false)
 OR p_request->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR NOT coalesce(public.flow_candidate_source_uint(p_request->'resumeId',true),false)
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 BEGIN k:=(p_request->>'idempotencyKey')::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END;
 IF k IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT s0.* INTO s FROM public.candidate_source_objects s0 JOIN public.candidate_resumes r ON r.id=s0.resume_id AND r.user_id=s0.user_id AND r.gcs_path=s0.gcs_path
 WHERE s0.user_id=p_user AND s0.resume_id=(p_request->>'resumeId')::bigint AND NOT s0.restricted ORDER BY s0.source_version DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 SELECT * INTO previous FROM public.candidate_source_requests WHERE user_id=p_user AND request_key=k;
 IF FOUND THEN
  IF previous.request_body IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  IF previous.receipt->>'sourceId' IS DISTINCT FROM s.source_id::text THEN RAISE EXCEPTION 'source_changed' USING ERRCODE='40001';END IF;
  RETURN previous.receipt;
 END IF;
 v:=jsonb_build_object('schemaVersion',1,'sourceId',s.source_id,'sourceVersion',s.source_version,'contentHash',s.content_hash);
 INSERT INTO public.candidate_source_requests VALUES(p_user,k,p_request,v);RETURN v;
END $$;
CREATE FUNCTION public.flow_candidate_source_resolve(p_user bigint,p_source jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE s public.candidate_source_objects%ROWTYPE;
BEGIN
 PERFORM public.flow_candidate_source_owner(p_user);
 IF NOT coalesce(public.flow_candidate_source_shape(p_source,ARRAY['sourceId','sourceVersion','contentHash']),false)
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT s0.* INTO s FROM public.candidate_source_objects s0 JOIN public.candidate_resumes r ON r.id=s0.resume_id AND r.user_id=s0.user_id AND r.gcs_path=s0.gcs_path
 WHERE s0.user_id=p_user AND s0.source_id::text=p_source->>'sourceId' AND NOT s0.restricted;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 IF p_source IS DISTINCT FROM jsonb_build_object('sourceId',s.source_id,'sourceVersion',s.source_version,'contentHash',s.content_hash)
 THEN RAISE EXCEPTION 'source_changed' USING ERRCODE='40001';END IF;
 RETURN public.flow_candidate_source_owned_value(s.source_id);
END $$;
CREATE FUNCTION public.flow_candidate_source_enqueue(p_user bigint,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;s public.candidate_source_objects%ROWTYPE;j public.candidate_source_jobs%ROWTYPE;
 previous public.candidate_source_requests%ROWTYPE;k uuid;v jsonb;revision bigint;auth integer;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 IF NOT coalesce(public.flow_candidate_source_shape(p_request,ARRAY['schemaVersion','idempotencyKey','sourceId','sourceVersion']),false)
 OR p_request->'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 BEGIN k:=(p_request->>'idempotencyKey')::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END;
 IF k IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT * INTO s FROM public.candidate_source_objects WHERE user_id=p_user AND source_id::text=p_request->>'sourceId';
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 PERFORM public.flow_candidate_source_resolve(p_user,jsonb_build_object('sourceId',s.source_id,'sourceVersion',p_request->'sourceVersion','contentHash',s.content_hash));
 SELECT * INTO previous FROM public.candidate_source_requests WHERE user_id=p_user AND request_key=k;
 IF FOUND THEN
  IF previous.request_body IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN previous.receipt;
 END IF;
 SELECT version INTO revision FROM public.candidate_consent_subjects WHERE subject_id=a.subject_id;
 IF NOT public.flow_candidate_profile_consent_ready(p_user::integer,a.subject_id,a.binding_id,revision)
 THEN RAISE EXCEPTION 'consent_changed' USING ERRCODE='42501';END IF;
 SELECT auth_version INTO auth FROM public.users WHERE id=p_user;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE source_id=s.source_id ORDER BY created_at DESC,command_id DESC LIMIT 1;
 IF NOT FOUND OR (j.consent_revision<>revision AND j.state IN ('review_ready','unavailable','held')
   AND NOT EXISTS(SELECT 1 FROM public.candidate_source_paid_operations WHERE command_id=j.command_id AND state IN ('dispatched','held'))) THEN
  IF (SELECT count(*) FROM public.candidate_source_jobs j0 JOIN public.candidate_source_objects s0 USING(source_id)
   WHERE j0.user_id=p_user AND s0.content_hash=s.content_hash)>=3 THEN RAISE EXCEPTION 'source_changed' USING ERRCODE='40001';END IF;
  INSERT INTO public.candidate_source_jobs(user_id,source_id,subject_id,binding_id,consent_revision,admitted_auth_version)
  VALUES(p_user,s.source_id,a.subject_id,a.binding_id,revision,auth) RETURNING * INTO j;
 END IF;
 v:=public.flow_candidate_source_status_value(j.command_id);
 INSERT INTO public.candidate_source_requests VALUES(p_user,k,p_request,v);RETURN v;
END $$;
CREATE FUNCTION public.flow_candidate_source_status(p_user bigint,p_command uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.flow_candidate_source_owner(p_user);
 IF NOT EXISTS(SELECT 1 FROM public.candidate_source_jobs WHERE command_id=p_command AND user_id=p_user)
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 RETURN public.flow_candidate_source_status_value(p_command);
END $$;
CREATE FUNCTION public.flow_candidate_source_retry_status(p_user bigint,p_command uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.candidate_source_jobs%ROWTYPE;s public.candidate_source_objects%ROWTYPE;n integer;allowed boolean;why text;
BEGIN
 PERFORM public.flow_candidate_source_owner(p_user);
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=p_command AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 SELECT * INTO s FROM public.candidate_source_objects WHERE source_id=j.source_id;
 SELECT count(*) INTO n FROM public.candidate_source_jobs j0 JOIN public.candidate_source_objects s0 USING(source_id) WHERE j0.user_id=p_user AND s0.content_hash=s.content_hash;
 allowed:=n<3 AND j.state IN ('held','unavailable') AND j.reason IN ('empty','provider_refused','outcome_unknown')
  AND j.transfer_document IS NULL AND NOT s.restricted
  AND NOT EXISTS(SELECT 1 FROM public.candidate_source_jobs WHERE previous_command_id=p_command)
  AND NOT EXISTS(SELECT 1 FROM public.candidate_source_paid_operations WHERE command_id=p_command AND kind='semantic_model' AND state='settled')
  AND public.flow_candidate_profile_consent_ready(j.user_id,j.subject_id,j.binding_id,j.consent_revision);
 why:=CASE WHEN n>=3 THEN 'attempt_limit' WHEN allowed THEN NULL ELSE 'not_retryable' END;
 RETURN jsonb_build_object('schemaVersion',1,'commandId',p_command,'attemptsUsed',n,'maxAttempts',3,'canRetry',coalesce(allowed,false),
 'canContinueWithoutResume',true,'reason',why,
 'message',CASE WHEN n>=3 AND j.state IN ('held','unavailable') AND j.reason IN ('empty','provider_refused','outcome_unknown') THEN 'We still couldn''t process your résumé. Please upload a different file or fill in your profile yourself.'
 WHEN j.state IN ('held','unavailable') AND j.reason IN ('empty','provider_refused','outcome_unknown') THEN 'Something went wrong processing your résumé.' ELSE NULL END);
END $$;
CREATE FUNCTION public.flow_candidate_source_retry(p_user bigint,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;j public.candidate_source_jobs%ROWTYPE;next_job public.candidate_source_jobs%ROWTYPE;
 previous public.candidate_source_requests%ROWTYPE;k uuid;command uuid;v jsonb;status jsonb;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 IF NOT coalesce(public.flow_candidate_source_shape(p_request,ARRAY['schemaVersion','idempotencyKey','retryOfCommandId']),false)
 OR p_request->'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 BEGIN k:=(p_request->>'idempotencyKey')::uuid;command:=(p_request->>'retryOfCommandId')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END;
 IF k IS NULL OR command IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=command AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 SELECT * INTO previous FROM public.candidate_source_requests WHERE user_id=p_user AND request_key=k;
 IF FOUND THEN
  IF previous.request_body IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN previous.receipt;
 END IF;
 -- Two button clicks with different request keys still target the same failed
 -- command. They receive one successor, not two new paid attempts.
 SELECT * INTO next_job FROM public.candidate_source_jobs WHERE previous_command_id=command;
 IF FOUND THEN v:=public.flow_candidate_source_status_value(next_job.command_id);
 ELSE
  status:=public.flow_candidate_source_retry_status(p_user,command);
  IF status->'canRetry' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'source_changed' USING ERRCODE='40001';END IF;
  PERFORM public.flow_candidate_source_resolve(p_user,(public.flow_candidate_source_owned_value(j.source_id))->'source');
  INSERT INTO public.candidate_source_jobs(user_id,source_id,subject_id,binding_id,consent_revision,admitted_auth_version,previous_command_id,extraction_document,extraction_context_hash)
  VALUES(j.user_id,j.source_id,j.subject_id,j.binding_id,j.consent_revision,(SELECT auth_version FROM public.users WHERE id=p_user),command,j.extraction_document,j.extraction_context_hash) RETURNING * INTO next_job;
  v:=public.flow_candidate_source_status_value(next_job.command_id);
 END IF;
 INSERT INTO public.candidate_source_requests VALUES(p_user,k,p_request,v);RETURN v;
END $$;
CREATE FUNCTION public.flow_candidate_source_prepare(p_lease jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE j public.candidate_source_jobs%ROWTYPE;s public.candidate_source_objects%ROWTYPE;u public.users%ROWTYPE;a public.candidate_product_accounts%ROWTYPE;
BEGIN
 IF NOT coalesce(public.flow_candidate_source_shape(p_lease,ARRAY['commandId','claimToken','generation']),false)
 OR NOT coalesce(public.flow_candidate_source_uint(p_lease->'generation',true),false) THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id::text=p_lease->>'commandId';
 IF NOT FOUND THEN RETURN NULL;END IF;
 a:=public.flow_candidate_source_owner(j.user_id);
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=j.command_id FOR UPDATE;
 IF j.lease_token::text IS DISTINCT FROM p_lease->>'claimToken' OR j.generation::text IS DISTINCT FROM p_lease->>'generation'
 OR j.lease_until<=clock_timestamp() OR j.lease_until IS NULL OR j.state NOT IN ('extracting','building','transferring') THEN RETURN NULL;END IF;
 SELECT * INTO s FROM public.candidate_source_objects WHERE source_id=j.source_id;
 SELECT * INTO u FROM public.users WHERE id=j.user_id;
 IF s.restricted OR j.created_at<=clock_timestamp()-interval '30 days' OR u.auth_version<>j.admitted_auth_version
 OR a.subject_id<>j.subject_id OR a.binding_id<>j.binding_id THEN RETURN NULL;END IF;
 IF NOT public.flow_candidate_profile_consent_ready(j.user_id,j.subject_id,j.binding_id,j.consent_revision) THEN RETURN NULL;END IF;
 IF length(u.username)>320 OR u.username !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RETURN NULL;END IF;
 PERFORM public.flow_candidate_source_resolve(j.user_id,jsonb_build_object('sourceId',s.source_id,'sourceVersion',s.source_version,'contentHash',s.content_hash));
 IF NOT coalesce(public.flow_candidate_source_shape(s.original_versions,ARRAY['originalDraftVersion','originalProfileVersion','originalPreferenceVersion','originalPreferenceDraftRevision']),false)
 OR EXISTS(SELECT 1 FROM jsonb_each(s.original_versions) WHERE NOT public.flow_candidate_source_uint(value)) THEN RETURN NULL;END IF;
 RETURN s.original_versions||jsonb_build_object('lease',p_lease,'actor',jsonb_build_object('userId',j.user_id,'subjectId',j.subject_id,'bindingId',j.binding_id),
 'source',public.flow_candidate_source_owned_value(s.source_id),'consentRevision',j.consent_revision,'scrubContext',jsonb_build_object('verifiedAccountEmail',u.username));
END $$;
CREATE FUNCTION public.flow_candidate_source_claim(p_worker uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE hint record;j public.candidate_source_jobs%ROWTYPE;l jsonb;v jsonb;
BEGIN
 IF p_worker IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 FOR hint IN SELECT command_id,user_id FROM public.candidate_source_jobs WHERE state IN ('queued','extracting','building','transferring')
 AND (lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at LIMIT 50 LOOP
  IF NOT pg_try_advisory_xact_lock(41943,hint.user_id) THEN CONTINUE;END IF;
  PERFORM 1 FROM public.users WHERE id=hint.user_id FOR UPDATE;
  SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=hint.command_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR j.state NOT IN ('queued','extracting','building','transferring') OR j.lease_until>clock_timestamp() THEN CONTINUE;END IF;
  -- Terminal jobs retain receipt-replay evidence, but do not own processing
  -- capacity. Only a currently active lease serialises this owner's workers.
  IF EXISTS(SELECT 1 FROM public.candidate_source_jobs WHERE user_id=j.user_id
   AND state IN ('extracting','building','transferring') AND lease_until>clock_timestamp()) THEN CONTINUE;END IF;
  IF j.attempts>=12 OR j.generation>=9007199254740991 THEN
   UPDATE public.candidate_source_jobs SET state='held',reason='outcome_unknown',lease_token=NULL,lease_until=NULL WHERE command_id=j.command_id;CONTINUE;
  END IF;
  UPDATE public.candidate_source_jobs SET state=CASE WHEN transfer_document IS NULL THEN 'extracting' ELSE 'transferring' END,
   attempts=attempts+1,generation=generation+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds'
   WHERE command_id=j.command_id RETURNING * INTO j;
  l:=jsonb_build_object('commandId',j.command_id,'claimToken',j.lease_token,'generation',j.generation);
  v:=public.flow_candidate_source_prepare(l);
  IF v IS NOT NULL THEN RETURN v;END IF;
  -- Preparation also checks identity, privacy, auth and age. Do not claim that
  -- every refusal means the candidate changed consent.
  UPDATE public.candidate_source_jobs SET state='held',reason='privacy_changed',lease_token=NULL,lease_until=NULL WHERE command_id=j.command_id;
 END LOOP;
 RETURN NULL;
END $$;

CREATE FUNCTION public.flow_candidate_source_paid_identity(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE l jsonb;s jsonb;k text;v jsonb;previous_page integer:=0;
BEGIN
 IF NOT coalesce(public.flow_candidate_source_shape(p,ARRAY['schemaVersion','lease','source','consentRevision','operationKey','limit']),false)
 OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR octet_length(p::text)>8192
 OR NOT coalesce(public.flow_candidate_source_shape(p->'lease',ARRAY['commandId','claimToken','generation']),false)
 OR NOT coalesce(public.flow_candidate_source_uint(p->'lease'->'generation',true),false)
 OR NOT coalesce(public.flow_candidate_source_uint(p->'consentRevision',true),false)
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['commandId','claimToken'] LOOP
  IF coalesce(p->'lease'->>k,'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 END LOOP;
 s:=p->'source';l:=p->'limit';
 IF coalesce(p->>'operationKey','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR NOT coalesce(public.flow_candidate_source_shape(s,ARRAY['sourceId','sourceVersion','contentHash']),false)
 OR coalesce(s->>'sourceId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR coalesce(s->>'contentHash','')!~'^[a-f0-9]{64}$' OR NOT coalesce(public.flow_candidate_source_uint(s->'sourceVersion',true),false)
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 IF l->>'kind'='ocr' THEN
  IF NOT coalesce(public.flow_candidate_source_shape(l,ARRAY['kind','pageCount','totalPageCount','pageNumbers','contentHash']),false)
  OR NOT coalesce(public.flow_candidate_source_uint(l->'pageCount',true),false) OR (l->>'pageCount')::numeric>10
  OR NOT coalesce(public.flow_candidate_source_uint(l->'totalPageCount',true),false) OR (l->>'totalPageCount')::numeric>10
  OR jsonb_typeof(l->'pageNumbers') IS DISTINCT FROM 'array'
  OR coalesce(l->>'contentHash','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
  IF jsonb_array_length(l->'pageNumbers')<>(l->>'pageCount')::integer THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(l->'pageNumbers') LOOP
   IF NOT coalesce(public.flow_candidate_source_uint(v,true),false) OR v::text::numeric>(l->>'totalPageCount')::integer OR v::text::numeric<=previous_page THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
   previous_page:=v::text::integer;
  END LOOP;
  IF l->'contentHash' IS DISTINCT FROM s->'contentHash' THEN RAISE EXCEPTION 'source_changed' USING ERRCODE='40001';END IF;
 ELSIF l->>'kind'='semantic_model' THEN
  IF NOT coalesce(public.flow_candidate_source_shape(l,ARRAY['kind','model','inputTokens','maxOutputTokens','textHash']),false)
  OR jsonb_typeof(l->'model') IS DISTINCT FROM 'string' OR length(l->>'model') NOT BETWEEN 1 AND 200
  OR NOT coalesce(public.flow_candidate_source_uint(l->'inputTokens',true),false)
  OR NOT coalesce(public.flow_candidate_source_uint(l->'maxOutputTokens',true),false)
  OR coalesce(l->>'textHash','')!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 ELSE RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 RETURN jsonb_build_object('schemaVersion',1,'commandId',p->'lease'->'commandId','source',s,'consentRevision',p->'consentRevision','operationKey',p->'operationKey','limit',l);
END $$;
CREATE FUNCTION public.flow_candidate_source_paid_reserve(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE identity_value jsonb;claim jsonb;op public.candidate_source_paid_operations%ROWTYPE;w record;units bigint;uid integer;kind_value text;
 total numeric;candidate_total numeric;reuse_wire text;budget_now timestamptz;
BEGIN
 identity_value:=public.flow_candidate_source_paid_identity(p);
 claim:=public.flow_candidate_source_prepare(p->'lease');
 IF claim IS NULL THEN RETURN jsonb_build_object('state','refused','reason','lease_lost');END IF;
 IF claim->'source'->'source' IS DISTINCT FROM p->'source' THEN RETURN jsonb_build_object('state','refused','reason','source_changed');END IF;
 IF claim->'consentRevision' IS DISTINCT FROM p->'consentRevision' THEN RETURN jsonb_build_object('state','refused','reason','consent_changed');END IF;
 uid:=(claim->'actor'->>'userId')::integer;kind_value:=p->'limit'->>'kind';
 -- Per-user authority lock precedes this global budget lock everywhere.
 PERFORM pg_advisory_xact_lock(41944,CASE WHEN kind_value='ocr' THEN 1 ELSE 2 END);
 SELECT * INTO op FROM public.candidate_source_paid_operations WHERE command_id=(p->'lease'->>'commandId')::uuid AND (operation_key=(p->>'operationKey')::uuid OR kind=kind_value) FOR UPDATE;
 IF FOUND THEN
  -- Identity comparison MUST precede every cached result and state branch.
  IF op.identity IS DISTINCT FROM identity_value THEN RETURN jsonb_build_object('state','refused','reason','idempotency_conflict');END IF;
  IF op.state='settled' THEN RETURN jsonb_build_object('state','settled','receipt',op.receipt,'result',op.result_document);END IF;
  IF op.state='reserved' THEN RETURN jsonb_build_object('state','reserved','reservation',jsonb_build_object('reservationId',op.reservation_id,'operationKey',op.operation_key,'limit',op.identity->'limit'));END IF;
  RETURN jsonb_build_object('state','refused','reason',CASE WHEN op.state='released' THEN 'budget_unavailable' ELSE 'outcome_unknown' END);
 END IF;
 -- An explicit successor may reuse successful OCR, but never a held purchase.
 -- Walk only this command's bounded retry ancestry, not another source/account.
 WITH RECURSIVE ancestry AS (
  SELECT previous_command_id id,1 depth FROM public.candidate_source_jobs WHERE command_id=(p->'lease'->>'commandId')::uuid
  UNION ALL SELECT j.previous_command_id,a.depth+1 FROM ancestry a JOIN public.candidate_source_jobs j ON j.command_id=a.id WHERE a.depth<3
 ) SELECT o.* INTO op FROM ancestry a JOIN public.candidate_source_paid_operations o ON o.command_id=a.id
 WHERE o.kind=kind_value AND (kind_value='semantic_model' OR o.state='settled') ORDER BY a.depth LIMIT 1;
 IF FOUND THEN
  IF op.identity->'source' IS DISTINCT FROM p->'source' OR op.identity->'consentRevision' IS DISTINCT FROM p->'consentRevision'
   OR op.identity->'limit' IS DISTINCT FROM p->'limit'
  THEN RETURN jsonb_build_object('state','refused','reason','idempotency_conflict');END IF;
  IF kind_value='ocr' AND (op.result_document->>'canonical')::jsonb->>'status'='extracted'
  THEN
   -- Preserve the paid attempt's receipt. Bind reuse separately to this exact
   -- successor request; the consumer must check this before accepting old OCR.
   reuse_wire:=public.flow_consent_v2_canonical(identity_value);
   RETURN jsonb_build_object('state','settled','receipt',op.receipt,'result',op.result_document,
    'reuseFor',jsonb_build_object('canonical',reuse_wire,'sha256',encode(sha256(convert_to(reuse_wire,'UTF8')),'hex')));
  END IF;
  IF kind_value='semantic_model' AND op.state='settled' THEN RETURN jsonb_build_object('state','refused','reason','idempotency_conflict');END IF;
 END IF;
 IF kind_value='ocr' THEN units:=(p->'limit'->>'pageCount')::bigint;
 ELSE
  IF (p->'limit'->>'inputTokens')::numeric+(p->'limit'->>'maxOutputTokens')::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
  units:=(p->'limit'->>'inputTokens')::bigint+(p->'limit'->>'maxOutputTokens')::bigint;
 END IF;
 budget_now:=public.flow_candidate_source_budget_now(kind_value);
 IF (SELECT count(*) FROM public.candidate_source_budget_windows WHERE kind=kind_value AND starts_at<=budget_now AND ends_at>budget_now)<>2
 OR (SELECT count(DISTINCT period) FROM public.candidate_source_budget_windows WHERE kind=kind_value AND starts_at<=budget_now AND ends_at>budget_now)<>2
 THEN RETURN jsonb_build_object('state','refused','reason','budget_unavailable');END IF;
 FOR w IN SELECT * FROM public.candidate_source_budget_windows WHERE kind=kind_value AND starts_at<=budget_now AND ends_at>budget_now ORDER BY period FOR UPDATE LOOP
  SELECT coalesce(sum(o.units),0),coalesce(sum(o.units) FILTER(WHERE j.user_id=uid),0) INTO total,candidate_total
  FROM public.candidate_source_paid_operations o JOIN public.candidate_source_jobs j USING(command_id)
  WHERE o.kind=kind_value AND o.state<>'released' AND o.created_at>=w.starts_at AND o.created_at<w.ends_at;
  IF total+units>w.global_units OR candidate_total+units>w.per_candidate_units THEN RETURN jsonb_build_object('state','refused','reason','budget_unavailable');END IF;
 END LOOP;
 INSERT INTO public.candidate_source_paid_operations(command_id,operation_key,kind,identity,units,created_at)
 VALUES((p->'lease'->>'commandId')::uuid,(p->>'operationKey')::uuid,kind_value,identity_value,units,budget_now) RETURNING * INTO op;
 RETURN jsonb_build_object('state','reserved','reservation',jsonb_build_object('reservationId',op.reservation_id,'operationKey',op.operation_key,'limit',op.identity->'limit'));
END $$;
CREATE FUNCTION public.flow_candidate_source_paid_dispatch(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE claim jsonb;op public.candidate_source_paid_operations%ROWTYPE;g jsonb;budget_now timestamptz;
BEGIN
 IF NOT coalesce(public.flow_candidate_source_shape(p,ARRAY['lease','reservationId']),false) THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 claim:=public.flow_candidate_source_prepare(p->'lease');
 IF claim IS NULL THEN RETURN jsonb_build_object('state','refused','reason','lease_lost');END IF;
 SELECT * INTO op FROM public.candidate_source_paid_operations WHERE reservation_id::text=p->>'reservationId' AND command_id::text=p->'lease'->>'commandId' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','refused','reason','idempotency_conflict');END IF;
 IF op.state='settled' THEN RETURN jsonb_build_object('state','settled','receipt',op.receipt,'result',op.result_document);END IF;
 IF op.state<>'reserved' THEN RETURN jsonb_build_object('state','refused','reason','outcome_unknown');END IF;
 IF op.identity->'source' IS DISTINCT FROM claim->'source'->'source' THEN RETURN jsonb_build_object('state','refused','reason','source_changed');END IF;
 -- A reservation from an expired budget window cannot dispatch in a new window.
 budget_now:=public.flow_candidate_source_budget_now(op.kind);
 IF (SELECT count(DISTINCT period) FROM public.candidate_source_budget_windows WHERE kind=op.kind
 AND starts_at<=op.created_at AND ends_at>budget_now)<>2 THEN RETURN jsonb_build_object('state','refused','reason','budget_unavailable');END IF;
 g:=jsonb_build_object('reservationId',op.reservation_id,'dispatchId',gen_random_uuid(),'operationKey',op.operation_key,
 'source',op.identity->'source','consentRevision',op.identity->'consentRevision','limit',op.identity->'limit');
 UPDATE public.candidate_source_paid_operations SET state='dispatched',dispatch_id=(g->>'dispatchId')::uuid,grant_body=g WHERE reservation_id=op.reservation_id;
 RETURN jsonb_build_object('state','dispatch','grant',g);
END $$;
CREATE FUNCTION public.flow_candidate_source_paid_record(p jsonb,p_hold boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE op public.candidate_source_paid_operations%ROWTYPE;j public.candidate_source_jobs%ROWTYPE;usage jsonb;why text;v jsonb;r jsonb;key text;
BEGIN
 IF NOT coalesce(public.flow_candidate_source_shape(p,CASE WHEN p_hold THEN ARRAY['lease','grant','observedUsage','reason'] ELSE ARRAY['lease','grant','observedUsage','result'] END),false)
 OR octet_length(p::text)>3145728 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 -- Record cost under a current lease even if consent changed mid-call. Never
 -- release an uncertain dispatched purchase or rewrite its immutable identity.
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id::text=p->'lease'->>'commandId';
 IF NOT FOUND THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(41943,j.user_id);PERFORM 1 FROM public.users WHERE id=j.user_id FOR UPDATE;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=j.command_id FOR UPDATE;
 IF NOT coalesce(public.flow_candidate_source_shape(p->'lease',ARRAY['commandId','claimToken','generation']),false)
 OR j.lease_token::text IS DISTINCT FROM p->'lease'->>'claimToken' OR j.generation::text IS DISTINCT FROM p->'lease'->>'generation'
 OR j.lease_until IS NULL OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
 SELECT * INTO op FROM public.candidate_source_paid_operations WHERE command_id=j.command_id AND reservation_id::text=p->'grant'->>'reservationId' FOR UPDATE;
 IF NOT FOUND OR op.grant_body IS NULL OR op.grant_body IS DISTINCT FROM p->'grant' THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
 usage:=p->'observedUsage';
 IF NOT coalesce(public.flow_candidate_source_shape(usage,CASE WHEN op.kind='ocr' THEN ARRAY['kind','pagesSubmitted','transportAttempts'] ELSE ARRAY['kind','inputTokens','outputTokens'] END),false)
 OR usage->>'kind' IS DISTINCT FROM op.kind THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 FOR key IN SELECT jsonb_object_keys(usage) LOOP
  IF key<>'kind' AND usage->key<>'null'::jsonb AND NOT coalesce(public.flow_candidate_source_uint(usage->key),false) THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 END LOOP;
 why:=CASE WHEN p_hold THEN p->>'reason' ELSE 'completed' END;
 IF why IS NULL OR why NOT IN ('completed','provider_uncertain','usage_unknown','budget_breach','privacy_changed') OR (p_hold AND why='completed') THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 IF NOT p_hold THEN
  r:=p->'result';
  IF NOT coalesce(public.flow_candidate_source_shape(r,ARRAY['canonical','sha256']),false)
   OR jsonb_typeof(r->'canonical') IS DISTINCT FROM 'string' OR octet_length(r->>'canonical') NOT BETWEEN 1 AND 2097152
   OR encode(sha256(convert_to(r->>'canonical','UTF8')),'hex') IS DISTINCT FROM r->>'sha256'
   THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
  BEGIN
   IF public.flow_consent_v2_canonical((r->>'canonical')::jsonb) IS DISTINCT FROM r->>'canonical' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END;
  -- Receipt replay describes the original settlement, not today's consent.
  -- It remains lease/grant fenced and never authorises result reuse or delivery.
  IF op.state='settled' THEN
   IF op.result_document IS DISTINCT FROM r OR op.receipt->'observedUsage' IS DISTINCT FROM usage
   THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
   RETURN op.receipt;
  END IF;
  IF op.kind='ocr' THEN
   IF usage->'pagesSubmitted'='null'::jsonb THEN why:='usage_unknown';
   ELSIF (usage->>'pagesSubmitted')::bigint>(op.identity->'limit'->>'pageCount')::bigint THEN why:='budget_breach';END IF;
  ELSE
   IF usage->'inputTokens'='null'::jsonb OR usage->'outputTokens'='null'::jsonb THEN why:='usage_unknown';
   ELSIF (usage->>'inputTokens')::bigint>(op.identity->'limit'->>'inputTokens')::bigint OR (usage->>'outputTokens')::bigint>(op.identity->'limit'->>'maxOutputTokens')::bigint THEN why:='budget_breach';END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.candidate_source_objects WHERE source_id=j.source_id AND restricted)
   OR NOT public.flow_candidate_profile_consent_ready(j.user_id,j.subject_id,j.binding_id,j.consent_revision) THEN why:='privacy_changed';END IF;
 END IF;
 v:=jsonb_build_object('reservationId',op.reservation_id,'dispatchId',op.dispatch_id,'operationKey',op.operation_key,
 'state',CASE WHEN why='completed' THEN 'settled' ELSE 'held' END,'observedUsage',usage,'reason',why);
 IF op.state IN ('settled','held') THEN
  IF op.receipt IS DISTINCT FROM v OR (op.state='settled' AND op.result_document IS DISTINCT FROM r) THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN op.receipt;
 END IF;
 IF op.state<>'dispatched' THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
 UPDATE public.candidate_source_paid_operations SET state=v->>'state',receipt=v,result_document=CASE WHEN why='completed' THEN r ELSE NULL END WHERE reservation_id=op.reservation_id;
 RETURN v;
END $$;
CREATE FUNCTION public.flow_candidate_source_paid_settle(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.flow_candidate_source_paid_record(p,false); $$;
CREATE FUNCTION public.flow_candidate_source_paid_hold(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.flow_candidate_source_paid_record(p,true); $$;
CREATE FUNCTION public.flow_candidate_source_paid_release_unsent(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.candidate_source_paid_operations%ROWTYPE;
BEGIN
 IF NOT coalesce(public.flow_candidate_source_shape(p,ARRAY['lease','reservationId']),false) THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 IF public.flow_candidate_source_prepare(p->'lease') IS NULL THEN RETURN jsonb_build_object('state','lease_lost');END IF;
 SELECT * INTO op FROM public.candidate_source_paid_operations WHERE reservation_id::text=p->>'reservationId' AND command_id::text=p->'lease'->>'commandId' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','lease_lost');END IF;
 IF op.state IN ('reserved','released') THEN
  UPDATE public.candidate_source_paid_operations SET state='released' WHERE reservation_id=op.reservation_id;RETURN jsonb_build_object('state','released');
 END IF;
 RETURN jsonb_build_object('state','held');
END $$;
CREATE FUNCTION public.flow_candidate_source_fail(p_lease jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE claim jsonb;
BEGIN
 IF p_reason IS NULL OR p_reason NOT IN ('budget_unavailable','privacy_changed','source_changed','consent_changed','lease_lost','outcome_unknown','idempotency_conflict','unsupported','empty','too_large','provider_refused') THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 claim:=public.flow_candidate_source_prepare(p_lease);
 IF claim IS NULL THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
 UPDATE public.candidate_source_jobs SET state=CASE WHEN p_reason IN ('outcome_unknown','idempotency_conflict') THEN 'held' ELSE 'unavailable' END,
 reason=p_reason,lease_token=NULL,lease_until=NULL WHERE command_id=(p_lease->>'commandId')::uuid;
 RETURN public.flow_candidate_source_status_value((p_lease->>'commandId')::uuid);
END $$;
CREATE FUNCTION public.flow_candidate_source_document(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE v jsonb;
BEGIN
 IF NOT coalesce(public.flow_candidate_source_shape(p,ARRAY['canonical','sha256']),false)
 OR jsonb_typeof(p->'canonical') IS DISTINCT FROM 'string' OR octet_length(p->>'canonical') NOT BETWEEN 1 AND 2097152
 OR encode(sha256(convert_to(p->>'canonical','UTF8')),'hex') IS DISTINCT FROM p->>'sha256' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 BEGIN v:=(p->>'canonical')::jsonb;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END;
 IF public.flow_consent_v2_canonical(v) IS DISTINCT FROM p->>'canonical' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 RETURN v;
END $$;
-- Native extraction has no paid receipt. Keep its scrubbed output with the job
-- so an explicit AI retry does not reread/reinterpret a successful extraction.
CREATE FUNCTION public.flow_candidate_source_extraction_cache(p_lease jsonb,p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE claim jsonb;j public.candidate_source_jobs%ROWTYPE;v jsonb;context_hash text;
BEGIN
 claim:=public.flow_candidate_source_prepare(p_lease);
 IF claim IS NULL THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
 context_hash:=encode(sha256(convert_to(claim->'scrubContext'->>'verifiedAccountEmail','UTF8')),'hex');
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=(p_lease->>'commandId')::uuid FOR UPDATE;
 IF j.extraction_document IS NOT NULL THEN
  IF j.extraction_context_hash IS DISTINCT FROM context_hash THEN RAISE EXCEPTION 'source_changed' USING ERRCODE='40001';END IF;
  IF p_document IS NOT NULL AND p_document IS DISTINCT FROM j.extraction_document THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN j.extraction_document;
 END IF;
 IF p_document IS NULL THEN RETURN NULL;END IF;
 v:=public.flow_candidate_source_document(p_document);
 IF NOT coalesce(public.flow_candidate_source_shape(v,ARRAY['schemaVersion','sourceId','sourceVersion','contentHash','policyVersion','status','text','textHash','method','providerCalls']),false)
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR v->>'status' IS DISTINCT FROM 'extracted'
 OR v->>'method' IS DISTINCT FROM 'native_text' OR v->'providerCalls' IS DISTINCT FROM '0'::jsonb
 OR v->'sourceId' IS DISTINCT FROM claim->'source'->'source'->'sourceId'
 OR v->'sourceVersion' IS DISTINCT FROM claim->'source'->'source'->'sourceVersion'
 OR v->'contentHash' IS DISTINCT FROM claim->'source'->'source'->'contentHash'
 OR v->'policyVersion' IS DISTINCT FROM claim->'source'->'policyVersion'
 OR jsonb_typeof(v->'text') IS DISTINCT FROM 'string' OR octet_length(v->>'text') NOT BETWEEN 1 AND 524288
 OR encode(sha256(convert_to(v->>'text','UTF8')),'hex') IS DISTINCT FROM v->>'textHash'
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 UPDATE public.candidate_source_jobs SET extraction_document=p_document,extraction_context_hash=context_hash WHERE command_id=j.command_id;
 RETURN p_document;
END $$;
CREATE FUNCTION public.flow_candidate_source_transfer_store(p_lease jsonb,p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE claim jsonb;v jsonb;j public.candidate_source_jobs%ROWTYPE;proposal jsonb;
BEGIN
 claim:=public.flow_candidate_source_prepare(p_lease);IF claim IS NULL THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
 v:=public.flow_candidate_source_document(p_document);proposal:=v->'proposal';
 IF NOT coalesce(public.flow_candidate_source_shape(v,ARRAY['schemaVersion','commandId','subjectId','bindingId','sourceId','sourceVersion','contentHash','textHash','policyVersion','consentRevision','text','proposal']),false)
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR v->'commandId' IS DISTINCT FROM p_lease->'commandId'
 OR v->'subjectId' IS DISTINCT FROM claim->'actor'->'subjectId' OR v->'bindingId' IS DISTINCT FROM claim->'actor'->'bindingId'
 OR v->'sourceId' IS DISTINCT FROM claim->'source'->'source'->'sourceId' OR v->'sourceVersion' IS DISTINCT FROM claim->'source'->'source'->'sourceVersion'
 OR v->'contentHash' IS DISTINCT FROM claim->'source'->'source'->'contentHash' OR v->'consentRevision' IS DISTINCT FROM claim->'consentRevision'
 OR v->'policyVersion' IS DISTINCT FROM claim->'source'->'policyVersion'
 OR jsonb_typeof(v->'text') IS DISTINCT FROM 'string' OR octet_length(v->>'text')>524288
 OR encode(sha256(convert_to(v->>'text','UTF8')),'hex') IS DISTINCT FROM v->>'textHash'
 OR encode(sha256(convert_to(public.flow_consent_v2_canonical(proposal-'proposalHash'),'UTF8')),'hex') IS DISTINCT FROM proposal->>'proposalHash'
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 -- Transfer must carry the exact already-settled semantic proposal, not a new
 -- model call or a newly generated expiry/ID on delivery retry.
 IF NOT EXISTS(SELECT 1 FROM public.candidate_source_paid_operations WHERE command_id=(p_lease->>'commandId')::uuid
 AND kind='semantic_model' AND state='settled' AND (result_document->>'canonical')::jsonb=proposal AND identity->'limit'->'textHash'=v->'textHash')
 THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=(p_lease->>'commandId')::uuid;
 IF j.transfer_document IS NOT NULL AND j.transfer_document IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
 UPDATE public.candidate_source_jobs SET transfer_document=p_document,state='transferring' WHERE command_id=j.command_id;
 RETURN public.flow_candidate_source_status_value(j.command_id);
END $$;
CREATE FUNCTION public.flow_candidate_source_transfer_finish(p_lease jsonb,p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE j public.candidate_source_jobs%ROWTYPE;v jsonb;t jsonb;k text;
BEGIN
 IF NOT coalesce(public.flow_candidate_source_shape(p_lease,ARRAY['commandId','claimToken','generation']),false) THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id::text=p_lease->>'commandId';
 IF NOT FOUND THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(41943,j.user_id);PERFORM 1 FROM public.users WHERE id=j.user_id FOR UPDATE;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=j.command_id FOR UPDATE;
 v:=public.flow_candidate_source_document(p_document);
 IF j.receipt_document IS NOT NULL THEN
  IF j.receipt_document IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  IF j.lease_token::text IS DISTINCT FROM p_lease->>'claimToken' OR j.generation::text IS DISTINCT FROM p_lease->>'generation' THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
  RETURN public.flow_candidate_source_status_value(j.command_id);
 END IF;
 IF j.lease_token::text IS DISTINCT FROM p_lease->>'claimToken' OR j.generation::text IS DISTINCT FROM p_lease->>'generation'
 OR j.lease_until IS NULL OR j.lease_until<=clock_timestamp() OR j.transfer_document IS NULL THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
 t:=(j.transfer_document->>'canonical')::jsonb;
 IF NOT coalesce(public.flow_candidate_source_shape(v,ARRAY['schemaVersion','commandId','subjectId','bindingId','commandHash','sourceId','sourceVersion','proposalId','proposalHash','outcome','reason','canonicalProfileChanged','publicationActive']),false)
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR v->'canonicalProfileChanged' IS DISTINCT FROM 'false'::jsonb OR v->'publicationActive' IS DISTINCT FROM 'false'::jsonb
 OR v->'commandHash' IS DISTINCT FROM j.transfer_document->'sha256'
 OR v->'proposalId' IS DISTINCT FROM t->'proposal'->'proposalId' OR v->'proposalHash' IS DISTINCT FROM t->'proposal'->'proposalHash'
 OR ((v->>'outcome'='stored' AND v->'reason'='null'::jsonb) OR (v->>'outcome'='rejected' AND v->>'reason' IN ('consent_changed','source_conflict','stale_edit','proposal_expired'))) IS NOT TRUE
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['commandId','subjectId','bindingId','sourceId','sourceVersion'] LOOP
  IF v->k IS DISTINCT FROM t->k THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 END LOOP;
 UPDATE public.candidate_source_jobs SET receipt_document=p_document,acknowledged_at=clock_timestamp(),
 state=CASE WHEN v->>'outcome'='stored' THEN 'review_ready' ELSE 'unavailable' END,
 proposal_id=CASE WHEN v->>'outcome'='stored' THEN (v->>'proposalId')::uuid ELSE NULL END,
 reason=CASE WHEN v->>'outcome'='stored' THEN NULL WHEN v->>'reason'='consent_changed' THEN 'consent_changed' ELSE 'source_changed' END
 WHERE command_id=j.command_id;
 RETURN public.flow_candidate_source_status_value(j.command_id);
END $$;

-- Internal object binding, not browser routes. Only the P0 integrator supplies
-- verified generation/hash/size and versions from an authenticated Memory read.
CREATE FUNCTION public.flow_candidate_source_locator(p_user bigint,p_resume integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;path text;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 SELECT gcs_path INTO path FROM public.candidate_resumes WHERE id=p_resume AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 RETURN jsonb_build_object('resumeId',p_resume,'gcsPath',path,'subjectId',a.subject_id,'bindingId',a.binding_id);
END $$;
CREATE FUNCTION public.flow_candidate_source_register_object(p_user bigint,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;s public.candidate_source_objects%ROWTYPE;path text;next_version bigint;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 IF NOT coalesce(public.flow_candidate_source_shape(p,ARRAY['resumeId','gcsPath','generation','contentHash','byteLength','mediaType','policyVersion','originalVersions','subjectId','bindingId']),false)
 OR NOT coalesce(public.flow_candidate_source_uint(p->'resumeId',true),false)
 OR NOT coalesce(public.flow_candidate_source_uint(p->'byteLength',true),false) OR (p->>'byteLength')::numeric>5242880
 OR coalesce(p->>'generation','')!~'^[0-9]+$' OR coalesce(p->>'contentHash','')!~'^[a-f0-9]{64}$'
 OR jsonb_typeof(p->'policyVersion') IS DISTINCT FROM 'string' OR length(p->>'policyVersion') NOT BETWEEN 1 AND 80
 OR coalesce(p->>'mediaType','') NOT IN ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
 OR NOT coalesce(public.flow_candidate_source_shape(p->'originalVersions',ARRAY['originalDraftVersion','originalProfileVersion','originalPreferenceVersion','originalPreferenceDraftRevision']),false)
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p->'originalVersions') WHERE NOT coalesce(public.flow_candidate_source_uint(value),false)) THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 IF p->>'subjectId' IS DISTINCT FROM a.subject_id::text OR p->>'bindingId' IS DISTINCT FROM a.binding_id::text THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 SELECT gcs_path INTO path FROM public.candidate_resumes WHERE id=(p->>'resumeId')::bigint AND user_id=p_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 IF path IS DISTINCT FROM p->>'gcsPath' THEN RAISE EXCEPTION 'source_changed' USING ERRCODE='40001';END IF;
 SELECT * INTO s FROM public.candidate_source_objects WHERE user_id=p_user AND resume_id=(p->>'resumeId')::bigint ORDER BY source_version DESC LIMIT 1;
 IF FOUND AND s.gcs_path=path AND s.gcs_generation=p->>'generation' THEN
  IF s.restricted OR s.content_hash IS DISTINCT FROM p->>'contentHash' OR s.byte_length::text IS DISTINCT FROM p->>'byteLength'
   OR s.media_type IS DISTINCT FROM p->>'mediaType' OR s.policy_version IS DISTINCT FROM p->>'policyVersion'
  THEN RAISE EXCEPTION 'source_changed' USING ERRCODE='40001';END IF;
  RETURN jsonb_build_object('schemaVersion',1,'sourceId',s.source_id,'sourceVersion',s.source_version,'contentHash',s.content_hash);
 END IF;
 next_version:=coalesce(s.source_version,0)+1;
 INSERT INTO public.candidate_source_objects(user_id,resume_id,source_version,content_hash,byte_length,media_type,policy_version,gcs_path,gcs_generation,original_versions)
 VALUES(p_user,(p->>'resumeId')::integer,next_version,p->>'contentHash',(p->>'byteLength')::integer,p->>'mediaType',p->>'policyVersion',path,p->>'generation',p->'originalVersions') RETURNING * INTO s;
 RETURN jsonb_build_object('schemaVersion',1,'sourceId',s.source_id,'sourceVersion',s.source_version,'contentHash',s.content_hash);
END $$;
CREATE FUNCTION public.flow_candidate_source_object_read(p_user bigint,p_handle uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;s public.candidate_source_objects%ROWTYPE;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 SELECT * INTO s FROM public.candidate_source_objects WHERE object_handle=p_handle AND user_id=p_user AND NOT restricted;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 PERFORM public.flow_candidate_source_resolve(p_user,jsonb_build_object('sourceId',s.source_id,'sourceVersion',s.source_version,'contentHash',s.content_hash));
 RETURN jsonb_build_object('subjectId',a.subject_id,'bindingId',a.binding_id,'gcsPath',s.gcs_path,'generation',s.gcs_generation,
 'contentHash',s.content_hash,'byteLength',s.byte_length,'source',public.flow_candidate_source_owned_value(s.source_id));
END $$;

-- Spark self-lookup journal. No runtime grants, provider scheduler or public
-- activation is implied. Email is resolved from the verified account at dispatch.
CREATE TABLE public.candidate_source_lookup_budgets (
 window_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),period text NOT NULL CHECK(period IN ('day','month')),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 credit_limit bigint NOT NULL CHECK(credit_limit BETWEEN 0 AND 9007199254740991),stopped boolean NOT NULL DEFAULT false
);
CREATE TABLE public.candidate_source_lookups (
 attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id integer NOT NULL REFERENCES public.users(id),
 subject_id uuid NOT NULL,binding_id uuid NOT NULL,consent_revision bigint NOT NULL,auth_version integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('email','linkedin')),slot integer NOT NULL CHECK(slot IN (1,2)),
 linkedin_url text,email_hash text NOT NULL CHECK(email_hash~'^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','transferring','review_ready','not_found','held','rejected')),
 reason text,dispatch_id uuid UNIQUE,result_document jsonb,proposal_id uuid,
 transfer_document jsonb,receipt_document jsonb,
 work_token uuid,work_generation bigint NOT NULL DEFAULT 0,work_until timestamptz,
 work_attempts integer NOT NULL DEFAULT 0 CHECK(work_attempts BETWEEN 0 AND 12),
 next_work_at timestamptz NOT NULL DEFAULT '-infinity',
 slot_released boolean NOT NULL DEFAULT false CHECK(NOT slot_released OR (state='rejected' AND charged_credits=0 AND result_document IS NULL)),
 reserved_credits integer NOT NULL CHECK(reserved_credits IN (1,2)),charged_credits bigint CHECK(charged_credits BETWEEN 0 AND 9007199254740991),
 day_window uuid NOT NULL REFERENCES public.candidate_source_lookup_budgets(window_id),
 month_window uuid NOT NULL REFERENCES public.candidate_source_lookup_budgets(window_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),dispatched_at timestamptz,
 CHECK((slot=1 AND kind='email' AND linkedin_url IS NULL AND reserved_credits=2)
 OR (slot=2 AND kind='linkedin' AND linkedin_url~'^https://linkedin[.]com/in/[a-z0-9][a-z0-9._-]{0,199}$' AND reserved_credits=1)),
 FOREIGN KEY(subject_id,user_id,binding_id) REFERENCES public.candidate_product_accounts(subject_id,user_id,binding_id)
);
CREATE UNIQUE INDEX candidate_source_lookup_live_slot ON public.candidate_source_lookups(user_id,slot) WHERE NOT slot_released;
CREATE TABLE public.candidate_source_lookup_requests (
 user_id integer NOT NULL REFERENCES public.users(id),request_key uuid NOT NULL,body jsonb NOT NULL,
 attempt_id uuid NOT NULL REFERENCES public.candidate_source_lookups(attempt_id),PRIMARY KEY(user_id,request_key)
);
DO $$ DECLARE r text;BEGIN
 FOREACH r IN ARRAY ARRAY['candidate_source_lookup_budgets','candidate_source_lookups','candidate_source_lookup_requests'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',r);
  EXECUTE format('CREATE POLICY owner_only ON public.%I TO CURRENT_USER USING(true) WITH CHECK(true)',r);
 END LOOP;
END $$;
CREATE FUNCTION public.flow_candidate_source_lookup_status(p_user bigint,p_auth integer,p_attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;j public.candidate_source_lookups%ROWTYPE;allowed boolean;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 IF p_auth IS NULL OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND auth_version=p_auth)
 THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM public.candidate_source_lookups WHERE attempt_id=p_attempt AND user_id=p_user AND subject_id=a.subject_id AND binding_id=a.binding_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 -- A durable, applied Memory not-me receipt or a free miss opens fallback.
 allowed:=j.slot=1 AND ((j.state='not_found' AND j.charged_credits=0) OR (j.state='rejected' AND j.reason='not_me'))
  AND NOT EXISTS(SELECT 1 FROM public.candidate_source_lookups WHERE user_id=p_user AND slot=2 AND NOT slot_released)
  AND EXISTS(SELECT 1 FROM public.candidate_consent_events e WHERE e.user_id=p_user
   AND public.flow_candidate_profile_consent_ready(j.user_id,j.subject_id,j.binding_id,e.version));
 RETURN jsonb_build_object('schemaVersion',1,'attemptId',j.attempt_id,'state',j.state,'reason',j.reason,
  'proposalId',CASE WHEN j.state='review_ready' THEN j.proposal_id ELSE NULL END,'canRequestLinkedin',coalesce(allowed,false),'waitLimitMs',20000);
END $$;
CREATE FUNCTION public.flow_candidate_source_lookup_admit(p_user bigint,p_auth integer,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;j public.candidate_source_lookups%ROWTYPE;
 old public.candidate_source_lookup_requests%ROWTYPE;u public.users%ROWTYPE;k uuid;slot_value integer;units integer;
 day_id uuid;month_id uuid;w record;used numeric;prior public.candidate_source_lookups%ROWTYPE;budget_now timestamptz;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 SELECT * INTO u FROM public.users WHERE id=p_user;
 IF p_auth IS NULL OR u.auth_version IS DISTINCT FROM p_auth THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501';END IF;
 IF octet_length(p::text)>4096 OR p->'schemaVersion' IS DISTINCT FROM '1'::jsonb
 OR NOT coalesce(public.flow_candidate_source_uint(p->'expectedConsentRevision',true),false)
 OR coalesce(p->>'kind','') NOT IN ('email','linkedin')
 OR NOT coalesce(public.flow_candidate_source_shape(p,CASE WHEN p->>'kind'='email' THEN
 ARRAY['schemaVersion','idempotencyKey','expectedConsentRevision','kind'] ELSE ARRAY['schemaVersion','idempotencyKey','expectedConsentRevision','kind','url'] END),false)
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 BEGIN k:=(p->>'idempotencyKey')::uuid;EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END;
 IF k IS NULL OR (p->>'kind'='linkedin' AND (jsonb_typeof(p->'url') IS DISTINCT FROM 'string' OR p->>'url'!~'^https://linkedin[.]com/in/[a-z0-9][a-z0-9._-]{0,199}$'))
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT * INTO old FROM public.candidate_source_lookup_requests WHERE user_id=p_user AND request_key=k;
 IF FOUND THEN
  IF old.body IS DISTINCT FROM p THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN public.flow_candidate_source_lookup_status(p_user,p_auth,old.attempt_id);
 END IF;
 IF NOT public.flow_candidate_profile_consent_ready(p_user::integer,a.subject_id,a.binding_id,(p->>'expectedConsentRevision')::bigint)
 THEN RAISE EXCEPTION 'consent_changed' USING ERRCODE='42501';END IF;
 slot_value:=CASE WHEN p->>'kind'='email' THEN 1 ELSE 2 END;units:=CASE WHEN slot_value=1 THEN 2 ELSE 1 END;
 SELECT * INTO j FROM public.candidate_source_lookups WHERE user_id=p_user AND slot=slot_value AND NOT slot_released;
 IF FOUND THEN
  IF j.consent_revision<>(p->>'expectedConsentRevision')::bigint OR j.linkedin_url IS DISTINCT FROM p->>'url'
  THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  INSERT INTO public.candidate_source_lookup_requests VALUES(p_user,k,p,j.attempt_id);
  RETURN public.flow_candidate_source_lookup_status(p_user,p_auth,j.attempt_id);
 END IF;
 IF slot_value=2 THEN
  SELECT * INTO prior FROM public.candidate_source_lookups WHERE user_id=p_user AND slot=1 AND NOT slot_released;
  IF NOT FOUND
   OR (public.flow_candidate_source_lookup_status(p_user,p_auth,prior.attempt_id))->'canRequestLinkedin' IS DISTINCT FROM 'true'::jsonb
  THEN RAISE EXCEPTION 'fallback_unavailable' USING ERRCODE='42501';END IF;
 END IF;
 -- Serialised account-wide Spark budget; no invented production allowance.
 PERFORM pg_advisory_xact_lock(41944,3);
 budget_now:=public.flow_candidate_source_budget_now('lookup');
 IF (SELECT count(*) FROM public.candidate_source_lookup_budgets WHERE starts_at<=budget_now AND ends_at>budget_now)<>2
 OR (SELECT count(DISTINCT period) FROM public.candidate_source_lookup_budgets WHERE starts_at<=budget_now AND ends_at>budget_now)<>2
 THEN RAISE EXCEPTION 'budget_unavailable' USING ERRCODE='42501';END IF;
 FOR w IN SELECT * FROM public.candidate_source_lookup_budgets WHERE starts_at<=budget_now AND ends_at>budget_now ORDER BY period FOR UPDATE LOOP
  SELECT coalesce(sum(coalesce(charged_credits,reserved_credits)),0) INTO used FROM public.candidate_source_lookups
   WHERE day_window=w.window_id OR month_window=w.window_id;
  IF w.stopped OR used+units>w.credit_limit THEN RAISE EXCEPTION 'budget_unavailable' USING ERRCODE='42501';END IF;
  IF w.period='day' THEN day_id:=w.window_id;ELSE month_id:=w.window_id;END IF;
 END LOOP;
 INSERT INTO public.candidate_source_lookups(user_id,subject_id,binding_id,consent_revision,auth_version,kind,slot,linkedin_url,email_hash,reserved_credits,day_window,month_window)
 VALUES(p_user,a.subject_id,a.binding_id,(p->>'expectedConsentRevision')::bigint,p_auth,p->>'kind',slot_value,p->>'url',
  encode(sha256(convert_to(lower(btrim(u.username)),'UTF8')),'hex'),units,day_id,month_id) RETURNING * INTO j;
 INSERT INTO public.candidate_source_lookup_requests VALUES(p_user,k,p,j.attempt_id);
 RETURN public.flow_candidate_source_lookup_status(p_user,p_auth,j.attempt_id);
END $$;
CREATE FUNCTION public.flow_candidate_source_lookup_dispatch(p_user bigint,p_auth integer,p_attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;j public.candidate_source_lookups%ROWTYPE;u public.users%ROWTYPE;budget_now timestamptz;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 SELECT * INTO u FROM public.users WHERE id=p_user;
 IF p_auth IS NULL OR u.auth_version IS DISTINCT FROM p_auth THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM public.candidate_source_lookups WHERE attempt_id=p_attempt AND user_id=p_user AND subject_id=a.subject_id AND binding_id=a.binding_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 IF j.state<>'queued' OR j.dispatch_id IS NOT NULL THEN RETURN NULL;END IF;
 PERFORM pg_advisory_xact_lock(41944,3);
 IF j.auth_version<>p_auth OR j.email_hash IS DISTINCT FROM encode(sha256(convert_to(lower(btrim(u.username)),'UTF8')),'hex')
 OR NOT public.flow_candidate_profile_consent_ready(j.user_id,j.subject_id,j.binding_id,j.consent_revision) THEN
  UPDATE public.candidate_source_lookups SET state='rejected',reason=CASE WHEN j.auth_version<>p_auth
   OR j.email_hash IS DISTINCT FROM encode(sha256(convert_to(lower(btrim(u.username)),'UTF8')),'hex') THEN 'authentication_changed' ELSE 'consent_changed' END,
   charged_credits=0,slot_released=true WHERE attempt_id=p_attempt;RETURN NULL;
 END IF;
 budget_now:=public.flow_candidate_source_budget_now('lookup');
 IF EXISTS(SELECT 1 FROM public.candidate_source_lookup_budgets WHERE window_id IN(j.day_window,j.month_window) AND (stopped OR ends_at<=budget_now)) THEN
  UPDATE public.candidate_source_lookups SET state='rejected',reason='budget_window_closed',charged_credits=0,slot_released=true WHERE attempt_id=p_attempt;RETURN NULL;
 END IF;
 UPDATE public.candidate_source_lookups SET state='running',dispatch_id=gen_random_uuid(),dispatched_at=clock_timestamp() WHERE attempt_id=p_attempt RETURNING * INTO j;
 RETURN jsonb_build_object('attemptId',j.attempt_id,'dispatchId',j.dispatch_id,'subjectId',j.subject_id,'bindingId',j.binding_id,'consentRevision',j.consent_revision,
 'operation',CASE WHEN j.kind='email' THEN jsonb_build_object('kind','email','email',u.username) ELSE jsonb_build_object('kind','linkedin','url',j.linkedin_url) END);
END $$;

CREATE FUNCTION public.flow_candidate_source_lookup_person_valid(p jsonb,k text DEFAULT 'person') RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE names text[];v record;e jsonb;bound integer;child text;
BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
 names:=CASE k WHEN 'person' THEN ARRAY['linkedinUrl','photoUrl','firstName','lastName','headline','summary','location','currentPositionTitle','currentCompanyName','experience','education','skills']
 WHEN 'location' THEN ARRAY['city','country','countryCode','rawLocation']
 WHEN 'experience' THEN ARRAY['title','companyName','description','startEndDate']
 WHEN 'education' THEN ARRAY['schoolName','degreeName','fieldOfStudy','description','startEndDate']
 WHEN 'dates' THEN ARRAY['start','end'] ELSE NULL END;
 IF names IS NULL THEN RETURN false;END IF;
 IF k='person' AND (jsonb_typeof(p->'linkedinUrl') IS DISTINCT FROM 'string' OR p->>'linkedinUrl'!~'^https://linkedin[.]com/in/[a-z0-9][a-z0-9._-]{0,199}$') THEN RETURN false;END IF;
 FOR v IN SELECT * FROM jsonb_each(p) LOOP
  IF NOT v.key=ANY(names) THEN RETURN false;END IF;
  IF v.key IN ('experience','education','skills') THEN
   IF jsonb_typeof(v.value) IS DISTINCT FROM 'array' THEN RETURN false;END IF;
   IF jsonb_array_length(v.value)>(CASE v.key WHEN 'experience' THEN 200 WHEN 'education' THEN 50 ELSE 300 END) THEN RETURN false;END IF;
   FOR e IN SELECT value FROM jsonb_array_elements(v.value) LOOP
    IF v.key='skills' THEN
     IF jsonb_typeof(e) IS DISTINCT FROM 'string' OR length(btrim(e#>>'{}')) NOT BETWEEN 1 AND 200 THEN RETURN false;END IF;
    ELSIF NOT public.flow_candidate_source_lookup_person_valid(e,v.key) THEN RETURN false;END IF;
   END LOOP;
  ELSIF v.key='photoUrl' THEN
   IF jsonb_typeof(v.value) IS DISTINCT FROM 'string' OR length(v.value#>>'{}')>2048
    OR (v.value#>>'{}')!~'^https://media[.]licdn[.]com/[A-Za-z0-9_~.%/?=&+,:;@!$()*-]+$' THEN RETURN false;END IF;
  ELSIF v.key IN ('location','startEndDate') THEN
   child:=CASE WHEN v.key='location' THEN 'location' ELSE 'dates' END;
   IF v.value<>'null'::jsonb AND NOT public.flow_candidate_source_lookup_person_valid(v.value,child) THEN RETURN false;END IF;
  ELSE
   bound:=CASE WHEN k='dates' THEN 40 WHEN v.key='countryCode' THEN 2 WHEN v.key='rawLocation' THEN 500
    WHEN v.key='headline' THEN 1000 WHEN v.key='summary' THEN 20000
    WHEN v.key='description' THEN CASE WHEN k='education' THEN 10000 ELSE 20000 END
    WHEN v.key IN ('title','companyName','schoolName','degreeName','fieldOfStudy','currentPositionTitle','currentCompanyName') THEN 300
    WHEN v.key='linkedinUrl' THEN 240 ELSE 200 END;
   IF v.value<>'null'::jsonb AND (jsonb_typeof(v.value) IS DISTINCT FROM 'string' OR length(v.value#>>'{}')>bound) THEN RETURN false;END IF;
  END IF;
 END LOOP;
 RETURN true;
END $$;
-- Settlement is worker-only: spend survives loss of account eligibility.
-- This projection never grants owner access or opens a fallback.
CREATE FUNCTION public.flow_candidate_source_lookup_settlement_value(p_attempt uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('schemaVersion',1,'attemptId',attempt_id,'state',state,'reason',reason,
 'proposalId',CASE WHEN state='review_ready' THEN proposal_id ELSE NULL END,'canRequestLinkedin',false,'waitLimitMs',20000)
 FROM public.candidate_source_lookups WHERE attempt_id=p_attempt;
$$;
CREATE FUNCTION public.flow_candidate_source_lookup_finish(p_user bigint,p_attempt uuid,p_dispatch uuid,p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;j public.candidate_source_lookups%ROWTYPE;v jsonb;u public.users%ROWTYPE;credits bigint;
BEGIN
 IF p_user IS NULL OR p_user NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user::integer);
 SELECT * INTO u FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=p_user;
 SELECT * INTO j FROM public.candidate_source_lookups WHERE user_id=p_user AND attempt_id=p_attempt FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 IF p_dispatch IS NULL OR j.dispatch_id IS DISTINCT FROM p_dispatch THEN RAISE EXCEPTION 'invalid_dispatch' USING ERRCODE='42501';END IF;
 v:=public.flow_candidate_source_document(p_document);
 IF NOT coalesce(public.flow_candidate_source_shape(v,ARRAY['outcome','creditsConsumed','person','alternativeCount','partial']),false)
 OR coalesce(v->>'outcome','') NOT IN ('matched','partial','ambiguous','not_found')
 OR NOT coalesce(public.flow_candidate_source_uint(v->'creditsConsumed'),false)
 OR NOT coalesce(public.flow_candidate_source_uint(v->'alternativeCount'),false) OR (v->>'alternativeCount')::numeric>9
 OR jsonb_typeof(v->'partial') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 credits:=(v->>'creditsConsumed')::bigint;
 IF v->>'outcome'='not_found' THEN
  IF v->'person'<>'null'::jsonb OR credits<>0 OR v->'alternativeCount'<>'0'::jsonb OR v->'partial'<>'false'::jsonb THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 ELSE
  IF NOT public.flow_candidate_source_lookup_person_valid(v->'person')
   OR (v->>'outcome'='ambiguous') IS DISTINCT FROM ((v->>'alternativeCount')::integer>0)
   OR (v->>'outcome'='matched' AND v->'partial'<>'false'::jsonb)
   OR (v->>'outcome'='partial' AND v->'partial'<>'true'::jsonb)
   OR (j.kind='linkedin' AND v->'person'->>'linkedinUrl' IS DISTINCT FROM j.linkedin_url)
  THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 END IF;
 IF j.result_document IS NOT NULL THEN
  IF j.result_document IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  SELECT * INTO u FROM public.users WHERE id=p_user;
  RETURN public.flow_candidate_source_lookup_settlement_value(p_attempt);
 END IF;
 IF j.state<>'running' THEN RAISE EXCEPTION 'invalid_dispatch' USING ERRCODE='42501';END IF;
 SELECT * INTO u FROM public.users WHERE id=p_user;
 IF credits>j.reserved_credits THEN
  PERFORM pg_advisory_xact_lock(41944,3);
  UPDATE public.candidate_source_lookup_budgets SET stopped=true WHERE window_id IN(j.day_window,j.month_window);
  UPDATE public.candidate_source_lookups SET state='held',reason='outcome_unknown',charged_credits=greatest(charged_credits,credits) WHERE attempt_id=p_attempt;
 ELSIF u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS NOT TRUE OR a.foundation_state IS DISTINCT FROM 'linked'
 OR a.subject_id IS DISTINCT FROM j.subject_id OR a.binding_id IS DISTINCT FROM j.binding_id
 OR u.auth_version<>j.auth_version OR j.email_hash IS DISTINCT FROM encode(sha256(convert_to(lower(btrim(u.username)),'UTF8')),'hex')
 OR NOT public.flow_candidate_profile_consent_ready(j.user_id,j.subject_id,j.binding_id,j.consent_revision) THEN
  -- Cost is retained, but a late private profile is discarded after withdrawal.
  UPDATE public.candidate_source_lookups SET state='rejected',reason=CASE
   WHEN u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS NOT TRUE OR a.foundation_state IS DISTINCT FROM 'linked'
    OR a.subject_id IS DISTINCT FROM j.subject_id OR a.binding_id IS DISTINCT FROM j.binding_id THEN 'account_changed'
   WHEN u.auth_version IS DISTINCT FROM j.auth_version OR j.email_hash IS DISTINCT FROM encode(sha256(convert_to(lower(btrim(u.username)),'UTF8')),'hex') THEN 'authentication_changed'
   ELSE 'consent_changed' END,charged_credits=greatest(charged_credits,credits) WHERE attempt_id=p_attempt;
 ELSE
  UPDATE public.candidate_source_lookups SET state=CASE WHEN v->>'outcome'='not_found' THEN 'not_found' ELSE 'transferring' END,
   reason=NULL,charged_credits=greatest(charged_credits,credits),result_document=p_document WHERE attempt_id=p_attempt;
 END IF;
 RETURN public.flow_candidate_source_lookup_settlement_value(p_attempt);
END $$;
CREATE FUNCTION public.flow_candidate_source_lookup_hold(p_user bigint,p_attempt uuid,p_dispatch uuid,p_observed bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE j public.candidate_source_lookups%ROWTYPE;
BEGIN
 IF p_user IS NULL OR p_user NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user::integer);
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF p_observed IS NOT NULL AND p_observed NOT BETWEEN 0 AND 9007199254740991 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT * INTO j FROM public.candidate_source_lookups WHERE user_id=p_user AND attempt_id=p_attempt FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 IF p_dispatch IS NULL THEN
  -- Only a truly undispatched slot can release. A malformed returned grant must
  -- never reset a durable dispatch, even when the adapter did not make a call.
  IF j.dispatch_id IS NULL AND j.state='queued' THEN
   UPDATE public.candidate_source_lookups SET state='rejected',reason='invalid_dispatch_grant',charged_credits=0,slot_released=true WHERE attempt_id=p_attempt;RETURN true;
  END IF;
 ELSE
  IF j.dispatch_id IS DISTINCT FROM p_dispatch THEN RAISE EXCEPTION 'invalid_dispatch' USING ERRCODE='42501';END IF;
 END IF;
 -- A cancelled dispatch is not a successful settlement. In particular, never
 -- acknowledge an observed charge on a released slot without recording it.
 IF j.slot_released THEN RAISE EXCEPTION 'invalid_dispatch' USING ERRCODE='42501';END IF;
 IF j.state IN ('running','held') THEN
  PERFORM pg_advisory_xact_lock(41944,3);
  UPDATE public.candidate_source_lookups SET state='held',reason='outcome_unknown',
   charged_credits=greatest(charged_credits,reserved_credits,p_observed) WHERE attempt_id=p_attempt;
  IF p_observed>j.reserved_credits THEN UPDATE public.candidate_source_lookup_budgets SET stopped=true WHERE window_id IN(j.day_window,j.month_window);END IF;
 END IF;
 RETURN true;
END $$;

-- Trusted worker proof of no HTTP invocation, never a browser/recovery action.
CREATE FUNCTION public.flow_candidate_source_lookup_cancel_unsent(p_user bigint,p_attempt uuid,p_dispatch uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE j public.candidate_source_lookups%ROWTYPE;
BEGIN
 IF p_user IS NULL OR p_user NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user::integer);
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO j FROM public.candidate_source_lookups WHERE user_id=p_user AND attempt_id=p_attempt FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 IF p_dispatch IS NULL OR j.dispatch_id IS DISTINCT FROM p_dispatch THEN RAISE EXCEPTION 'invalid_dispatch' USING ERRCODE='42501';END IF;
 IF j.slot_released AND j.reason='disabled_before_call' THEN RETURN true;END IF;
 IF j.state<>'running' OR j.charged_credits IS NOT NULL OR j.result_document IS NOT NULL THEN RAISE EXCEPTION 'invalid_dispatch' USING ERRCODE='42501';END IF;
 UPDATE public.candidate_source_lookups SET state='rejected',reason='disabled_before_call',charged_credits=0,slot_released=true WHERE attempt_id=p_attempt;
 RETURN true;
END $$;

-- Lookup delivery has no purchase authority. Exact stored bytes are replayed;
-- Memory decides consent/version acceptance and its receipt is retained as-is.
CREATE FUNCTION public.flow_candidate_source_lookup_delivery_read(p_user bigint,p_auth integer,p_attempt uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;j public.candidate_source_lookups%ROWTYPE;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 -- Service-only delivery uses the stored binding, not the old login session.
 -- A password change is not withdrawal. owner() still fences account/binding,
 -- and Memory checks consent before any new write. Browser status remains auth-bound.
 SELECT * INTO j FROM public.candidate_source_lookups WHERE user_id=p_user AND attempt_id=p_attempt AND subject_id=a.subject_id AND binding_id=a.binding_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 IF j.state<>'transferring' OR j.result_document IS NULL THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('attemptId',j.attempt_id,'subjectId',j.subject_id,'bindingId',j.binding_id,'consentRevision',j.consent_revision,
  'expiresAt',to_char((j.dispatched_at AT TIME ZONE 'UTC')+interval '7 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'result',j.result_document,'transfer',j.transfer_document);
END $$;
CREATE FUNCTION public.flow_candidate_source_lookup_delivery_store(p_user bigint,p_auth integer,p_attempt uuid,p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE prepared jsonb;j public.candidate_source_lookups%ROWTYPE;v jsonb;
BEGIN
 prepared:=public.flow_candidate_source_lookup_delivery_read(p_user,p_auth,p_attempt);
 IF prepared IS NULL THEN RAISE EXCEPTION 'invalid_dispatch' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM public.candidate_source_lookups WHERE attempt_id=p_attempt;
 v:=public.flow_candidate_source_document(p_document);
 IF NOT coalesce(public.flow_candidate_source_shape(v,ARRAY['schemaVersion','commandId','subjectId','bindingId','sourceId','sourceVersion','contentHash','textHash','policyVersion','consentRevision','text','proposal']),false)
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR v->>'commandId' IS DISTINCT FROM p_attempt::text
 OR v->>'sourceId' IS DISTINCT FROM p_attempt::text OR v->'sourceVersion' IS DISTINCT FROM '1'::jsonb
 OR v->>'subjectId' IS DISTINCT FROM j.subject_id::text OR v->>'bindingId' IS DISTINCT FROM j.binding_id::text
 OR v->'consentRevision' IS DISTINCT FROM to_jsonb(j.consent_revision) OR v->>'policyVersion' IS DISTINCT FROM 'rc-profile-v1'
 OR v->'proposal'->>'sourceKind' IS DISTINCT FROM 'professional_lookup' OR v->'proposal'->>'expiresAt' IS DISTINCT FROM prepared->>'expiresAt'
 OR v->'proposal'->>'sourceId' IS DISTINCT FROM p_attempt::text OR v->'proposal'->'sourceVersion' IS DISTINCT FROM '1'::jsonb
 OR v->>'contentHash' IS DISTINCT FROM v->>'textHash' OR v->>'textHash' IS DISTINCT FROM encode(sha256(convert_to(v->>'text','UTF8')),'hex')
 OR v->'proposal'->>'proposalHash' IS DISTINCT FROM encode(sha256(convert_to(public.flow_consent_v2_canonical((v->'proposal')-'proposalHash'),'UTF8')),'hex')
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 IF j.transfer_document IS NOT NULL THEN
  IF j.transfer_document IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN j.transfer_document;
 END IF;
 IF NOT public.flow_candidate_profile_consent_ready(j.user_id,j.subject_id,j.binding_id,j.consent_revision) THEN RAISE EXCEPTION 'consent_changed' USING ERRCODE='42501';END IF;
 UPDATE public.candidate_source_lookups SET transfer_document=p_document WHERE attempt_id=p_attempt;
 RETURN p_document;
END $$;
CREATE FUNCTION public.flow_candidate_source_lookup_delivery_finish(p_user bigint,p_attempt uuid,p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE j public.candidate_source_lookups%ROWTYPE;v jsonb;t jsonb;k text;rejected_not_me boolean;
BEGIN
 IF p_user IS NULL OR p_user NOT BETWEEN 1 AND 2147483647 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user::integer);
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO j FROM public.candidate_source_lookups WHERE user_id=p_user AND attempt_id=p_attempt FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 IF j.transfer_document IS NULL THEN RAISE EXCEPTION 'invalid_dispatch' USING ERRCODE='42501';END IF;
 v:=public.flow_candidate_source_document(p_document);t:=public.flow_candidate_source_document(j.transfer_document);
 IF NOT coalesce(public.flow_candidate_source_shape(v,ARRAY['schemaVersion','commandId','subjectId','bindingId','commandHash','sourceId','sourceVersion','proposalId','proposalHash','outcome','reason','canonicalProfileChanged','publicationActive']),false)
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR v->'canonicalProfileChanged' IS DISTINCT FROM 'false'::jsonb OR v->'publicationActive' IS DISTINCT FROM 'false'::jsonb
 OR v->>'commandHash' IS DISTINCT FROM j.transfer_document->>'sha256'
 OR v->'proposalId' IS DISTINCT FROM t->'proposal'->'proposalId' OR v->'proposalHash' IS DISTINCT FROM t->'proposal'->'proposalHash'
 OR NOT coalesce(((v->>'outcome'='stored' AND v->'reason'='null'::jsonb) OR (v->>'outcome'='rejected' AND v->>'reason' IN ('consent_changed','source_conflict','stale_edit','proposal_expired'))),false)
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['commandId','subjectId','bindingId','sourceId','sourceVersion'] LOOP
  IF v->k IS DISTINCT FROM t->k THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 END LOOP;
 IF j.receipt_document IS NOT NULL THEN
  IF j.receipt_document IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN public.flow_candidate_source_lookup_settlement_value(p_attempt);
 END IF;
 IF j.state<>'transferring' THEN RAISE EXCEPTION 'invalid_dispatch' USING ERRCODE='42501';END IF;
 -- A valid reject receipt may arrive while this delivery's reply is lost.
 -- Both settlement paths serialize on the same per-user authority lock.
 SELECT EXISTS(SELECT 1 FROM public.candidate_profile_commands c
  JOIN public.candidate_profile_outbox o USING(command_id)
  WHERE c.user_id=j.user_id AND c.subject_id=j.subject_id AND c.binding_id=j.binding_id
   AND c.schema_version=3 AND c.action='reject_source' AND o.receipt->>'status'='applied'
   AND c.body::jsonb->'payload'->>'reason'='not_me'
   AND c.body::jsonb->'payload'->>'proposalId'=v->>'proposalId'
   AND c.body::jsonb->'payload'->'sourceVersion'='1'::jsonb
   AND c.body::jsonb->'payload'->>'proposalHash'=v->>'proposalHash') AND j.slot=1 INTO rejected_not_me;
 UPDATE public.candidate_source_lookups SET receipt_document=p_document,
  state=CASE WHEN v->>'outcome'='stored' AND NOT rejected_not_me THEN 'review_ready' ELSE 'rejected' END,
  proposal_id=CASE WHEN v->>'outcome'='stored' THEN (v->>'proposalId')::uuid ELSE NULL END,
  reason=CASE WHEN v->>'outcome'='stored' THEN CASE WHEN rejected_not_me THEN 'not_me' ELSE NULL END ELSE v->>'reason' END WHERE attempt_id=p_attempt;
 RETURN public.flow_candidate_source_lookup_settlement_value(p_attempt);
END $$;

-- Rejection is learned only from the already-validated durable Memory receipt.
-- This trigger also covers expiry reconciliation, not just ordinary settlement.
CREATE FUNCTION public.flow_candidate_source_lookup_rejection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE c public.candidate_profile_commands%ROWTYPE;p jsonb;
BEGIN
 IF NEW.receipt IS NULL OR NEW.receipt IS NOT DISTINCT FROM OLD.receipt OR NEW.receipt->>'status'<>'applied' THEN RETURN NEW;END IF;
 SELECT * INTO c FROM public.candidate_profile_commands WHERE command_id=NEW.command_id AND schema_version=3 AND action='reject_source';
 IF NOT FOUND OR c.body IS NULL THEN RETURN NEW;END IF;
 p:=c.body::jsonb->'payload';
 IF p->>'reason'<>'not_me' THEN RETURN NEW;END IF;
 UPDATE public.candidate_source_lookups j SET state='rejected',reason='not_me'
 WHERE j.user_id=c.user_id AND j.subject_id=c.subject_id AND j.binding_id=c.binding_id AND j.slot=1 AND j.state='review_ready'
 AND j.proposal_id::text=p->>'proposalId' AND p->'sourceVersion'='1'::jsonb
 AND (j.transfer_document->>'canonical')::jsonb->'proposal'->>'proposalHash'=p->>'proposalHash';
 RETURN NEW;
END $$;
CREATE TRIGGER candidate_lookup_not_me AFTER UPDATE OF receipt ON public.candidate_profile_outbox
 FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_lookup_rejection();

-- Bounded local queue. Claims contain identifiers only, never account email.
-- The paid dispatch routine still owns the only permission to call RC once.
CREATE FUNCTION public.flow_candidate_source_lookup_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE r record;j public.candidate_source_lookups%ROWTYPE;u public.users%ROWTYPE;
BEGIN
 FOR r IN SELECT attempt_id,user_id FROM public.candidate_source_lookups
  WHERE state IN ('queued','running','transferring') AND next_work_at<=clock_timestamp()
   AND (work_until IS NULL OR work_until<=clock_timestamp())
  ORDER BY next_work_at,created_at,attempt_id LIMIT 50 LOOP
  IF NOT pg_try_advisory_xact_lock(41943,r.user_id) THEN CONTINUE;END IF;
  SELECT * INTO u FROM public.users WHERE id=r.user_id FOR UPDATE;
  SELECT * INTO j FROM public.candidate_source_lookups WHERE attempt_id=r.attempt_id FOR UPDATE;
  IF j.state NOT IN ('queued','running','transferring') OR j.next_work_at>clock_timestamp()
   OR j.work_until>clock_timestamp() THEN CONTINUE;END IF;
  IF j.state='running' THEN
   IF j.dispatched_at>clock_timestamp()-interval '60 seconds' THEN CONTINUE;END IF;
   UPDATE public.candidate_source_lookups SET state='held',reason='outcome_unknown',work_token=NULL,work_until=NULL,
    charged_credits=greatest(coalesce(charged_credits,0),reserved_credits)
    WHERE attempt_id=j.attempt_id;CONTINUE;
  END IF;
  IF j.work_attempts>=12 THEN
   UPDATE public.candidate_source_lookups SET state='held',reason='retry_exhausted',work_token=NULL,work_until=NULL
    WHERE attempt_id=j.attempt_id;CONTINUE;
  END IF;
  IF u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS NOT TRUE OR NOT EXISTS(
   SELECT 1 FROM public.candidate_product_accounts WHERE user_id=j.user_id AND subject_id=j.subject_id AND binding_id=j.binding_id AND foundation_state='linked') THEN
   UPDATE public.candidate_source_lookups SET state='rejected',reason='account_changed',
    charged_credits=CASE WHEN j.state='queued' THEN 0 ELSE charged_credits END,slot_released=(j.state='queued'),
    work_token=NULL,work_until=NULL WHERE attempt_id=j.attempt_id;CONTINUE;
  END IF;
  UPDATE public.candidate_source_lookups SET work_token=gen_random_uuid(),work_generation=work_generation+1,
   work_until=clock_timestamp()+interval '60 seconds',work_attempts=work_attempts+1
   WHERE attempt_id=j.attempt_id RETURNING * INTO j;
  RETURN jsonb_build_object('attemptId',j.attempt_id,'userId',j.user_id,'authVersion',u.auth_version,
   'token',j.work_token,'generation',j.work_generation,'attempts',j.work_attempts,'stage',j.state);
 END LOOP;
 RETURN NULL;
END $$;
CREATE FUNCTION public.flow_candidate_source_lookup_work_prepare(p_attempt uuid,p_token uuid,p_generation bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE uid integer;
BEGIN
 SELECT user_id INTO uid FROM public.candidate_source_lookups WHERE attempt_id=p_attempt;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 RETURN EXISTS(SELECT 1 FROM public.candidate_source_lookups WHERE attempt_id=p_attempt AND work_token=p_token
  AND work_generation=p_generation AND work_until>clock_timestamp() AND state IN ('queued','transferring'));
END $$;
CREATE FUNCTION public.flow_candidate_source_lookup_work_finish(p_attempt uuid,p_token uuid,p_generation bigint,p_failure text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE uid integer;j public.candidate_source_lookups%ROWTYPE;
BEGIN
 IF p_failure IS NOT NULL AND p_failure NOT IN ('temporary','delivery_refused','privacy_restricted','consent_changed') THEN
  RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT user_id INTO uid FROM public.candidate_source_lookups WHERE attempt_id=p_attempt;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 SELECT * INTO j FROM public.candidate_source_lookups WHERE attempt_id=p_attempt FOR UPDATE;
 IF j.work_token IS DISTINCT FROM p_token OR j.work_generation IS DISTINCT FROM p_generation OR j.work_until<=clock_timestamp() THEN RETURN false;END IF;
 -- Never turn a dispatched/unknown request back into queued work.
 IF j.state='running' THEN
  UPDATE public.candidate_source_lookups SET state='held',reason='outcome_unknown',
   charged_credits=greatest(coalesce(charged_credits,0),reserved_credits) WHERE attempt_id=p_attempt;
 ELSIF j.state IN ('queued','transferring') AND (p_failure IN ('delivery_refused','privacy_restricted','consent_changed') OR j.work_attempts>=12) THEN
  UPDATE public.candidate_source_lookups SET state='held',reason=CASE WHEN j.work_attempts>=12 THEN 'retry_exhausted' ELSE p_failure END
   WHERE attempt_id=p_attempt;
 END IF;
 UPDATE public.candidate_source_lookups SET work_token=NULL,work_until=NULL,
  next_work_at=CASE WHEN p_failure IS NULL THEN '-infinity'::timestamptz
   ELSE clock_timestamp()+least(300,5*power(2,least(j.work_attempts-1,6))) * interval '1 second' END WHERE attempt_id=p_attempt;
 RETURN true;
END $$;

-- Every function/table above is initially owner-only, including default ACLs.
CREATE TABLE public.candidate_source_erasures (
 request_id uuid PRIMARY KEY REFERENCES public.candidate_privacy_requests(request_id),
 user_id integer NOT NULL REFERENCES public.users(id),subject_id uuid NOT NULL,binding_id uuid NOT NULL,
 stage text NOT NULL DEFAULT 'pending' CHECK(stage IN ('pending','network_erased_files_pending','complete')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),network_erased_at timestamptz,
 FOREIGN KEY(subject_id,user_id,binding_id) REFERENCES public.candidate_product_accounts(subject_id,user_id,binding_id)
);
ALTER TABLE public.candidate_source_erasures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_source_erasures FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON public.candidate_source_erasures TO CURRENT_USER USING(true) WITH CHECK(true);

CREATE FUNCTION public.flow_candidate_source_erasure_prepare(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE r public.candidate_privacy_requests%ROWTYPE;a public.candidate_product_accounts%ROWTYPE;e public.candidate_source_erasures%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.candidate_privacy_requests WHERE request_id=p_request;
 IF NOT FOUND OR r.action<>'request_erasure' OR r.authority_type<>'verified_candidate'
 OR NOT EXISTS(SELECT 1 FROM public.candidate_privacy_subject_links WHERE request_id=p_request AND subject_type='candidate_user' AND candidate_user_id=r.actor_user_id)
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 -- Actor-to-owner equality is mandatory. Email-matched application links are
 -- never authority to erase a different account's network profile.
 PERFORM pg_advisory_xact_lock(41943,r.actor_user_id);
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=r.actor_user_id;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO e FROM public.candidate_source_erasures WHERE request_id=p_request;
 IF NOT FOUND THEN
  IF r.state NOT IN ('accepted_local','delivery_pending','memory_active')
  THEN RAISE EXCEPTION 'erasure_not_authorized' USING ERRCODE='42501';END IF;
  INSERT INTO public.candidate_source_erasures(request_id,user_id,subject_id,binding_id)
  VALUES(p_request,a.user_id,a.subject_id,a.binding_id) RETURNING * INTO e;
 END IF;
 UPDATE public.candidate_source_objects SET restricted=true WHERE user_id=e.user_id;
 RETURN jsonb_build_object('schemaVersion',1,'requestId',e.request_id,'subjectId',e.subject_id,'bindingId',e.binding_id);
END $$;

CREATE FUNCTION public.flow_candidate_source_erasure_finish(p_request uuid,p_subject uuid,p_binding uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE e public.candidate_source_erasures%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public.candidate_source_erasures WHERE request_id=p_request;
 IF NOT FOUND OR e.subject_id IS DISTINCT FROM p_subject OR e.binding_id IS DISTINCT FROM p_binding
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 PERFORM pg_advisory_xact_lock(41943,e.user_id);
 SELECT * INTO e FROM public.candidate_source_erasures WHERE request_id=p_request FOR UPDATE;
 -- Reapply the scrub even for a completed audit, e.g. after restoring older
 -- payload tables. The permanent fence and original audit time stay intact.
 UPDATE public.candidate_profile_outbox o SET state='rejected',safe_reason='candidate_privacy_restricted',
  lease_token=NULL,lease_expires_at=NULL,receipt=NULL,resolution_requests='{}',updated_at=clock_timestamp()
  FROM public.candidate_profile_commands c WHERE c.command_id=o.command_id AND c.user_id=e.user_id;
 UPDATE public.candidate_profile_commands SET body=NULL,redacted_at=coalesce(redacted_at,clock_timestamp()),body_hash=repeat('0',64) WHERE user_id=e.user_id;
 UPDATE public.candidate_source_paid_operations p SET result_document=NULL,grant_body=NULL,receipt=NULL,identity='{}',
  state=CASE WHEN p.state='reserved' THEN 'released' WHEN p.state='dispatched' THEN 'held' ELSE p.state END
  FROM public.candidate_source_jobs j WHERE j.command_id=p.command_id AND j.user_id=e.user_id;
 UPDATE public.candidate_source_jobs SET state='held',reason='candidate_privacy_restricted',lease_token=NULL,lease_until=NULL,
  transfer_document=NULL,receipt_document=NULL,extraction_document=NULL,extraction_context_hash=NULL WHERE user_id=e.user_id;
 UPDATE public.candidate_source_requests SET request_body='{}',receipt='{}' WHERE user_id=e.user_id;
 UPDATE public.candidate_source_lookups SET state=CASE WHEN slot_released THEN 'rejected' ELSE 'held' END,
  reason='candidate_privacy_restricted',result_document=NULL,transfer_document=NULL,receipt_document=NULL,
  email_hash=repeat('0',64),linkedin_url=CASE WHEN slot=2 THEN 'https://linkedin.com/in/erased' ELSE NULL END,
  charged_credits=CASE WHEN dispatch_id IS NOT NULL THEN greatest(coalesce(charged_credits,0),reserved_credits) ELSE coalesce(charged_credits,0) END,
  work_token=NULL,work_until=NULL WHERE user_id=e.user_id;
 UPDATE public.candidate_source_lookup_requests SET body='{}' WHERE user_id=e.user_id;
 UPDATE public.candidate_source_interpretations SET state='held',response=NULL,reason=CASE WHEN reason='budget_breach' THEN reason ELSE 'authority_changed' END,request_hash=repeat('0',64),authority_hash=repeat('0',64) WHERE user_id=e.user_id;
 -- Retain source object locators solely for the reference-aware file deletion
 -- phase. Do not claim complete or remove an employer's application snapshot.
 UPDATE public.candidate_source_erasures SET stage='network_erased_files_pending',network_erased_at=coalesce(network_erased_at,clock_timestamp()) WHERE request_id=p_request;
 RETURN true;
END $$;

CREATE FUNCTION public.flow_candidate_source_proposal_context(p_user integer,p_auth integer,p_proposal uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='3s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;result jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(41943,p_user);
 a:=public.flow_candidate_source_owner(p_user);
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND auth_version=p_auth)
 THEN RAISE EXCEPTION 'authentication_changed' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('sourceId',j.source_id,'sourceVersion',o.source_version) INTO result
 FROM public.candidate_source_jobs j JOIN public.candidate_source_objects o USING(source_id,user_id)
 WHERE j.user_id=p_user AND j.subject_id=a.subject_id AND j.binding_id=a.binding_id
 AND j.proposal_id=p_proposal AND j.state='review_ready' AND NOT o.restricted;
 IF result IS NULL THEN
  SELECT jsonb_build_object('sourceId',attempt_id,'sourceVersion',1) INTO result FROM public.candidate_source_lookups
  WHERE user_id=p_user AND subject_id=a.subject_id AND binding_id=a.binding_id AND proposal_id=p_proposal AND state='review_ready';
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_proposal_context(integer,integer,uuid) FROM PUBLIC;

-- P8 temporary payload retention. Keep immutable purchase identities and spend;
-- deletion of an expired copy must never grant another provider purchase.
ALTER TABLE public.candidate_source_jobs ADD COLUMN payload_redacted_at timestamptz;
ALTER TABLE public.candidate_source_lookups ADD COLUMN payload_redacted_at timestamptz;
ALTER TABLE public.candidate_source_lookups ADD COLUMN acknowledged_at timestamptz;
ALTER TABLE public.candidate_source_interpretations ADD COLUMN payload_redacted_at timestamptz;
ALTER TABLE public.candidate_source_interpretations ADD COLUMN acknowledged_at timestamptz;

CREATE FUNCTION public.flow_candidate_source_payload_fence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE payload jsonb;
BEGIN
 IF OLD.payload_redacted_at IS NOT NULL THEN
  IF NEW.payload_redacted_at IS DISTINCT FROM OLD.payload_redacted_at THEN
   RAISE EXCEPTION 'payload_expired' USING ERRCODE='40001';END IF;
  payload:=to_jsonb(NEW);
  IF EXISTS(SELECT 1 FROM jsonb_each(payload) e WHERE e.key IN
   ('transfer_document','receipt_document','extraction_document','extraction_context_hash','result_document','response') AND e.value<>'null'::jsonb)
  THEN RAISE EXCEPTION 'payload_expired' USING ERRCODE='40001';END IF;
 END IF;
 IF TG_TABLE_NAME='candidate_source_lookups' THEN
  IF NEW.receipt_document IS NOT NULL AND OLD.receipt_document IS NULL
  THEN NEW.acknowledged_at:=clock_timestamp();END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_payload_fence BEFORE UPDATE ON public.candidate_source_jobs
 FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_payload_fence();
CREATE TRIGGER lookup_payload_fence BEFORE UPDATE ON public.candidate_source_lookups
 FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_payload_fence();
CREATE TRIGGER interpretation_payload_fence BEFORE UPDATE ON public.candidate_source_interpretations
 FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_payload_fence();

CREATE FUNCTION public.flow_candidate_source_interpretation_ack(p_user integer,p_proposal uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='3s' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(41943,p_user);
 UPDATE public.candidate_source_interpretations SET acknowledged_at=coalesce(acknowledged_at,clock_timestamp())
 WHERE user_id=p_user AND state='settled' AND response->>'proposalId'=p_proposal::text AND payload_redacted_at IS NULL;
 RETURN FOUND;
END $$;

CREATE FUNCTION public.flow_candidate_source_redact_due() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE item record;t timestamptz:=clock_timestamp();n integer:=0;
BEGIN
 FOR item IN SELECT * FROM (
  SELECT 'resume' kind,command_id id,user_id,created_at FROM public.candidate_source_jobs
   WHERE payload_redacted_at IS NULL AND (acknowledged_at<=t-interval '7 days' OR (acknowledged_at IS NULL AND created_at<=t-interval '30 days'))
  UNION ALL SELECT 'lookup',attempt_id,user_id,created_at FROM public.candidate_source_lookups
   WHERE payload_redacted_at IS NULL AND (acknowledged_at<=t-interval '7 days' OR (acknowledged_at IS NULL AND created_at<=t-interval '30 days'))
  UNION ALL SELECT 'interpretation',reservation_id,user_id,created_at FROM public.candidate_source_interpretations
   WHERE payload_redacted_at IS NULL AND (acknowledged_at<=t-interval '7 days' OR (acknowledged_at IS NULL AND created_at<=t-interval '30 days'))
 ) due ORDER BY user_id,created_at,id LIMIT 100 LOOP
  PERFORM pg_advisory_xact_lock(41943,item.user_id);
  IF item.kind='resume' THEN
   UPDATE public.candidate_source_jobs SET payload_redacted_at=t,transfer_document=NULL,receipt_document=NULL,
    extraction_document=NULL,extraction_context_hash=NULL,lease_token=NULL,lease_until=NULL,
    state=CASE WHEN acknowledged_at IS NOT NULL THEN state ELSE 'unavailable' END,
    reason=CASE WHEN acknowledged_at IS NOT NULL THEN reason ELSE 'source_changed' END
   WHERE command_id=item.id AND payload_redacted_at IS NULL
    AND (acknowledged_at<=t-interval '7 days' OR (acknowledged_at IS NULL AND created_at<=t-interval '30 days'));
   IF NOT FOUND THEN CONTINUE;END IF;
   UPDATE public.candidate_source_paid_operations SET result_document=NULL,grant_body=NULL,receipt=NULL,
    state=CASE WHEN state='reserved' THEN 'released' WHEN state='dispatched' THEN 'held' ELSE state END WHERE command_id=item.id;
  ELSIF item.kind='lookup' THEN
   UPDATE public.candidate_source_lookups SET payload_redacted_at=t,result_document=NULL,transfer_document=NULL,receipt_document=NULL,
    work_token=NULL,work_until=NULL,state=CASE WHEN state IN ('queued','running','transferring') THEN 'held' ELSE state END,
    reason=CASE WHEN acknowledged_at IS NULL THEN 'proposal_expired' ELSE reason END,
    charged_credits=CASE WHEN dispatch_id IS NOT NULL THEN greatest(coalesce(charged_credits,0),reserved_credits) ELSE charged_credits END
   WHERE attempt_id=item.id AND payload_redacted_at IS NULL
    AND (acknowledged_at<=t-interval '7 days' OR (acknowledged_at IS NULL AND created_at<=t-interval '30 days'));
   IF NOT FOUND THEN CONTINUE;END IF;
  ELSE
   UPDATE public.candidate_source_interpretations SET payload_redacted_at=t,response=NULL,state='held',reason=coalesce(reason,'outcome_unknown')
   WHERE reservation_id=item.id AND payload_redacted_at IS NULL
    AND (acknowledged_at<=t-interval '7 days' OR (acknowledged_at IS NULL AND created_at<=t-interval '30 days'));
   IF NOT FOUND THEN CONTINUE;END IF;
  END IF;
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('redacted',n);
END $$;

DO $$ DECLARE r record;g record;BEGIN
 FOR r IN SELECT c.oid,c.oid::regclass AS name,c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'candidate_source_%' LOOP
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC',r.name);
  FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce((SELECT relacl FROM pg_class WHERE oid=r.oid),acldefault('r',r.relowner))) WHERE grantee<>0 AND grantee<>r.relowner LOOP
   EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',r.name,pg_get_userbyid(g.grantee));END LOOP;
 END LOOP;
 FOR r IN SELECT p.oid,p.oid::regprocedure AS name,p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE 'flow_candidate_source_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.name);
  FOR g IN SELECT DISTINCT grantee FROM aclexplode(coalesce((SELECT proacl FROM pg_proc WHERE oid=r.oid),acldefault('f',r.proowner))) WHERE grantee<>0 AND grantee<>r.proowner LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',r.name,pg_get_userbyid(g.grantee));END LOOP;
 END LOOP;
END $$;
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT p.oid::regprocedure AS sig,a.grantee FROM pg_proc p
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid IN ('public.flow_candidate_profile_resolution_view(uuid)'::regprocedure,
 'public.flow_candidate_profile_resolve(integer,integer,uuid,uuid,bigint,text)'::regprocedure,
 'public.flow_candidate_profile_recovery_refuse(uuid,uuid,bigint)'::regprocedure,
 'public.flow_candidate_profile_recovery_review_count()'::regprocedure) AND a.grantee<>p.proowner AND a.grantee<>0 LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',r.sig,pg_get_userbyid(r.grantee));END LOOP;
END $$;
