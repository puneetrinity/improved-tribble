-- Wave 5B. No entitlement issuance, tenant activation or historical backfill.
-- This migration is authored alongside the authority routines and catalog proof.
CREATE TABLE public.sourcing_org_state (
  organization_id integer CONSTRAINT src_org_pk PRIMARY KEY CONSTRAINT src_org_fk REFERENCES public.organizations(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CONSTRAINT src_org_rev_ck CHECK (revision>=0),
  enabled boolean NOT NULL DEFAULT false,
  anchor timestamptz,
  capacity integer NOT NULL DEFAULT 0 CONSTRAINT src_org_cap_ck CHECK (capacity>=0),
  high_water integer NOT NULL DEFAULT 0 CONSTRAINT src_org_high_ck CHECK (high_water>=capacity),
  entitlement_id uuid
);
CREATE TABLE public.sourcing_entitlements (
  id uuid CONSTRAINT src_ent_pk PRIMARY KEY,
  organization_id integer NOT NULL CONSTRAINT src_ent_org_fk REFERENCES public.organizations(id) ON DELETE RESTRICT,
  subscription_id integer NOT NULL CONSTRAINT src_ent_sub_fk REFERENCES public.organization_subscriptions(id) ON DELETE RESTRICT,
  anchor timestamptz NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  capacity integer NOT NULL CONSTRAINT src_ent_cap_ck CHECK (capacity>0),
  origin text NOT NULL CONSTRAINT src_ent_origin_ck CHECK (origin IN ('verified_paid','explicit_grant')),
  evidence_sha256 text NOT NULL CONSTRAINT src_ent_hash_ck CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  supersedes_id uuid,
  CONSTRAINT src_ent_scope_uq UNIQUE (organization_id,id),
  CONSTRAINT src_ent_prev_fk FOREIGN KEY (organization_id,supersedes_id) REFERENCES public.sourcing_entitlements(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_ent_dates_ck CHECK (valid_until>valid_from AND anchor<=valid_from)
);
ALTER TABLE public.sourcing_org_state ADD CONSTRAINT src_org_ent_fk FOREIGN KEY (organization_id,entitlement_id)
  REFERENCES public.sourcing_entitlements(organization_id,id) ON DELETE RESTRICT;
CREATE TABLE public.sourcing_seat_slots (
  id uuid CONSTRAINT src_slot_pk PRIMARY KEY,
  organization_id integer NOT NULL CONSTRAINT src_slot_org_fk REFERENCES public.organizations(id) ON DELETE RESTRICT,
  slot_number integer NOT NULL CONSTRAINT src_slot_num_ck CHECK (slot_number>0),
  active boolean NOT NULL,
  current_user_id integer CONSTRAINT src_slot_user_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CONSTRAINT src_slot_rev_ck CHECK (revision>=0),
  CONSTRAINT src_slot_num_uq UNIQUE (organization_id,slot_number),
  CONSTRAINT src_slot_scope_uq UNIQUE (organization_id,id)
);
CREATE UNIQUE INDEX src_slot_user_uq ON public.sourcing_seat_slots(organization_id,current_user_id) WHERE current_user_id IS NOT NULL;
CREATE TABLE public.sourcing_seat_events (
  id uuid CONSTRAINT src_sevt_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  slot_id uuid NOT NULL,
  revision bigint NOT NULL CONSTRAINT src_sevt_rev_ck CHECK (revision>0),
  previous_user_id integer CONSTRAINT src_sevt_prev_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  next_user_id integer CONSTRAINT src_sevt_next_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  cause text NOT NULL CONSTRAINT src_sevt_cause_ck CHECK (cause IN ('initial','assign','unassign','remove','capacity')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT src_sevt_slot_fk FOREIGN KEY (organization_id,slot_id) REFERENCES public.sourcing_seat_slots(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_sevt_rev_uq UNIQUE (slot_id,revision)
);
CREATE TABLE public.sourcing_allowance_windows (
  organization_id integer NOT NULL,
  slot_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  entitlement_id uuid NOT NULL,
  limit_count integer NOT NULL DEFAULT 5 CONSTRAINT src_win_limit_ck CHECK (limit_count=5),
  reserved integer NOT NULL DEFAULT 0,
  captured integer NOT NULL DEFAULT 0,
  revision bigint NOT NULL DEFAULT 0 CONSTRAINT src_win_rev_ck CHECK (revision>=0),
  CONSTRAINT src_win_pk PRIMARY KEY (slot_id,starts_at),
  CONSTRAINT src_win_scope_uq UNIQUE (organization_id,slot_id,starts_at),
  CONSTRAINT src_win_slot_fk FOREIGN KEY (organization_id,slot_id) REFERENCES public.sourcing_seat_slots(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_win_ent_fk FOREIGN KEY (organization_id,entitlement_id) REFERENCES public.sourcing_entitlements(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_win_dates_ck CHECK (ends_at>starts_at),
  CONSTRAINT src_win_balance_ck CHECK (reserved>=0 AND captured>=0 AND reserved+captured<=limit_count)
);
CREATE TABLE public.sourcing_query_artifacts (
  id uuid CONSTRAINT src_art_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  brief_version_id uuid NOT NULL,
  material_hash text NOT NULL CONSTRAINT src_art_material_ck CHECK (material_hash ~ '^[a-f0-9]{64}$'),
  compiler_version text NOT NULL CONSTRAINT src_art_compiler_ck CHECK (compiler_version='1'),
  query_hash text NOT NULL CONSTRAINT src_art_query_ck CHECK (query_hash ~ '^[a-f0-9]{64}$'),
  input jsonb NOT NULL CONSTRAINT src_art_input_ck CHECK (jsonb_typeof(input)='object' AND octet_length(input::text)<=65536),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT src_art_brief_fk FOREIGN KEY (organization_id,job_id,brief_version_id) REFERENCES public.job_brief_versions(organization_id,job_id,version_id) ON DELETE RESTRICT,
  CONSTRAINT src_art_scope_uq UNIQUE (organization_id,job_id,id),
  CONSTRAINT src_art_query_uq UNIQUE (organization_id,job_id,brief_version_id,compiler_version,query_hash)
);
CREATE TABLE public.sourcing_digest_requests (
  id uuid CONSTRAINT src_digest_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  brief_version_id uuid NOT NULL,
  actor_user_id integer NOT NULL CONSTRAINT src_digest_actor_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  source_hash text NOT NULL CONSTRAINT src_digest_source_ck CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CONSTRAINT src_digest_hash_ck CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  model text NOT NULL CONSTRAINT src_digest_model_ck CHECK (length(model) BETWEEN 1 AND 160),
  state text NOT NULL CONSTRAINT src_digest_state_ck CHECK (state IN ('reserved','started','succeeded','failed','unknown')),
  result jsonb CONSTRAINT src_digest_result_ck CHECK (jsonb_typeof(result)='object' AND octet_length(result::text)<=65536),
  attempt_count integer NOT NULL DEFAULT 0 CONSTRAINT src_digest_attempt_ck CHECK (attempt_count BETWEEN 0 AND 2),
  manual_retry_request_id uuid,
  lease_id uuid,
  lease_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT src_digest_brief_fk FOREIGN KEY (organization_id,job_id,brief_version_id) REFERENCES public.job_brief_versions(organization_id,job_id,version_id) ON DELETE RESTRICT,
  CONSTRAINT src_digest_basis_uq UNIQUE (organization_id,job_id,brief_version_id,source_hash,model),
  CONSTRAINT src_digest_retry_uq UNIQUE (organization_id,manual_retry_request_id),
  CONSTRAINT src_digest_lease_ck CHECK ((lease_id IS NULL)=(lease_until IS NULL)),
  CONSTRAINT src_digest_retry_ck CHECK (attempt_count<2 OR manual_retry_request_id IS NOT NULL)
);
CREATE TABLE public.sourcing_admissions (
  id uuid CONSTRAINT src_adm_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  request_id uuid NOT NULL,
  request_sha256 text NOT NULL CONSTRAINT src_adm_hash_ck CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  actor_user_id integer NOT NULL CONSTRAINT src_adm_actor_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  payer_user_id integer NOT NULL CONSTRAINT src_adm_payer_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  payer_slot_id uuid NOT NULL,
  window_start timestamptz NOT NULL,
  artifact_id uuid NOT NULL,
  state text NOT NULL CONSTRAINT src_adm_state_ck CHECK (state IN ('reserved','bound','dispatched','delivered','needs_attention','cancelled_no_dispatch')),
  revision bigint NOT NULL DEFAULT 0 CONSTRAINT src_adm_rev_ck CHECK (revision>=0),
  discover_request_id text,
  cancellation jsonb CONSTRAINT src_adm_cancel_ck CHECK (jsonb_typeof(cancellation)='object' AND octet_length(cancellation::text)<=16384),
  generation integer NOT NULL DEFAULT 1 CONSTRAINT src_adm_gen_ck CHECK (generation=1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT src_adm_request_uq UNIQUE (organization_id,request_id),
  CONSTRAINT src_adm_scope_uq UNIQUE (organization_id,job_id,id),
  CONSTRAINT src_adm_org_id_uq UNIQUE (organization_id,id),
  CONSTRAINT src_adm_art_fk FOREIGN KEY (organization_id,job_id,artifact_id) REFERENCES public.sourcing_query_artifacts(organization_id,job_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_adm_win_fk FOREIGN KEY (organization_id,payer_slot_id,window_start) REFERENCES public.sourcing_allowance_windows(organization_id,slot_id,starts_at) ON DELETE RESTRICT
);
-- A proven, terminal no-dispatch cancellation retains its audit trail but
-- does not consume the job's one purchase. All ambiguous outcomes still block.
CREATE UNIQUE INDEX src_adm_job_uq ON public.sourcing_admissions(organization_id,job_id)
  WHERE state<>'cancelled_no_dispatch';
CREATE TABLE public.sourcing_account_events (
  id uuid CONSTRAINT src_acct_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  admission_id uuid NOT NULL,
  kind text NOT NULL CONSTRAINT src_acct_kind_ck CHECK (kind IN ('reserve','capture','release')),
  evidence_sha256 text NOT NULL CONSTRAINT src_acct_hash_ck CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT src_acct_adm_fk FOREIGN KEY (organization_id,admission_id) REFERENCES public.sourcing_admissions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_acct_kind_uq UNIQUE (admission_id,kind)
);
-- Capture and release can never both exist, even if a caller bypasses a routine.
CREATE UNIQUE INDEX src_acct_terminal_uq ON public.sourcing_account_events(admission_id) WHERE kind IN ('capture','release');
CREATE TABLE public.sourcing_dispatch_outbox (
  admission_id uuid CONSTRAINT src_out_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  state text NOT NULL CONSTRAINT src_out_state_ck CHECK (state IN ('pending','leased','bound','needs_attention','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CONSTRAINT src_out_attempt_ck CHECK (attempts BETWEEN 0 AND 8),
  lease_id uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  receipt jsonb CONSTRAINT src_out_receipt_ck CHECK (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=16384),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT src_out_adm_fk FOREIGN KEY (organization_id,admission_id) REFERENCES public.sourcing_admissions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_out_lease_ck CHECK ((lease_id IS NULL)=(lease_until IS NULL))
);
CREATE INDEX src_out_pending_idx ON public.sourcing_dispatch_outbox(state,next_attempt_at);
CREATE TABLE public.sourcing_execution_grants (
  id uuid CONSTRAINT src_grant_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  admission_id uuid NOT NULL,
  slot text NOT NULL CONSTRAINT src_grant_slot_ck CHECK (slot IN ('exact','spill')),
  request_sha256 text NOT NULL CONSTRAINT src_grant_req_ck CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  provider_input_sha256 text NOT NULL CONSTRAINT src_grant_input_ck CHECK (provider_input_sha256 ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL CONSTRAINT src_grant_state_ck CHECK (state IN ('issued','started','no_dispatch','uncertain')),
  receipt_sha256 text CONSTRAINT src_grant_receipt_ck CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  receipt jsonb CONSTRAINT src_grant_evidence_ck CHECK (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=16384),
  CONSTRAINT src_grant_slot_uq UNIQUE (admission_id,slot),
  CONSTRAINT src_grant_adm_fk FOREIGN KEY (organization_id,admission_id) REFERENCES public.sourcing_admissions(organization_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_grant_time_ck CHECK (expires_at>issued_at AND expires_at<=issued_at+interval '60 seconds')
);
CREATE TABLE public.sourcing_deliveries (
  id uuid CONSTRAINT src_del_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  admission_id uuid NOT NULL,
  revision integer NOT NULL CONSTRAINT src_del_rev_ck CHECK (revision>0),
  execution_attempt_id text NOT NULL,
  payload_sha256 text NOT NULL CONSTRAINT src_del_hash_ck CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  count integer NOT NULL CONSTRAINT src_del_count_ck CHECK (count BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT src_del_rev_uq UNIQUE (admission_id,revision),
  CONSTRAINT src_del_scope_uq UNIQUE (organization_id,job_id,id),
  CONSTRAINT src_del_adm_fk FOREIGN KEY (organization_id,job_id,admission_id) REFERENCES public.sourcing_admissions(organization_id,job_id,id) ON DELETE RESTRICT
);
-- C3: the baseline's non-partial job_sourced_candidates_id_org_job_idx is
-- already UNIQUE (id,organization_id,job_id). PostgreSQL uses it for these FKs.
CREATE TABLE public.sourcing_delivery_items (
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  delivery_id uuid NOT NULL,
  ordinal integer NOT NULL CONSTRAINT src_item_ord_ck CHECK (ordinal BETWEEN 1 AND 100),
  sourced_candidate_id integer NOT NULL,
  signal_candidate_id text NOT NULL,
  CONSTRAINT src_item_pk PRIMARY KEY (delivery_id,ordinal),
  CONSTRAINT src_item_candidate_uq UNIQUE (delivery_id,sourced_candidate_id),
  CONSTRAINT src_item_del_fk FOREIGN KEY (organization_id,job_id,delivery_id) REFERENCES public.sourcing_deliveries(organization_id,job_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_item_cand_fk FOREIGN KEY (sourced_candidate_id,organization_id,job_id) REFERENCES public.job_sourced_candidates(id,organization_id,job_id) ON DELETE RESTRICT
);
CREATE TABLE public.sourcing_decision_events (
  id uuid CONSTRAINT src_dec_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  sourced_candidate_id integer NOT NULL,
  request_id uuid NOT NULL,
  request_sha256 text NOT NULL CONSTRAINT src_dec_hash_ck CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  actor_user_id integer NOT NULL CONSTRAINT src_dec_actor_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  delivery_id uuid,
  brief_version_id uuid,
  revision bigint NOT NULL CONSTRAINT src_dec_rev_ck CHECK (revision>0),
  action text NOT NULL CONSTRAINT src_dec_action_ck CHECK (action IN ('shortlist','pass','clear')),
  previous_state text NOT NULL CONSTRAINT src_dec_prev_ck CHECK (previous_state IN ('new','shortlisted','passed','legacy_hidden')),
  next_state text NOT NULL CONSTRAINT src_dec_next_ck CHECK (next_state IN ('new','shortlisted','passed')),
  reason_code text CONSTRAINT src_dec_reason_ck CHECK (reason_code IN ('skills_gap','experience_requirement','role_seniority','domain','location_work_arrangement','compensation','availability','insufficient_information','other')),
  criterion_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT src_dec_request_uq UNIQUE (organization_id,request_id),
  CONSTRAINT src_dec_rev_uq UNIQUE (sourced_candidate_id,revision),
  CONSTRAINT src_dec_cand_fk FOREIGN KEY (sourced_candidate_id,organization_id,job_id) REFERENCES public.job_sourced_candidates(id,organization_id,job_id) ON DELETE RESTRICT,
  CONSTRAINT src_dec_del_fk FOREIGN KEY (organization_id,job_id,delivery_id) REFERENCES public.sourcing_deliveries(organization_id,job_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_dec_brief_fk FOREIGN KEY (organization_id,job_id,brief_version_id) REFERENCES public.job_brief_versions(organization_id,job_id,version_id) ON DELETE RESTRICT,
  CONSTRAINT src_dec_criterion_ck CHECK (criterion_id IS NULL OR (brief_version_id IS NOT NULL AND reason_code IS NOT NULL)),
  CONSTRAINT src_dec_clear_ck CHECK (action<>'clear' OR (reason_code IS NULL AND criterion_id IS NULL)),
  CONSTRAINT src_dec_projection_ck CHECK ((action='shortlist' AND next_state='shortlisted') OR (action='pass' AND next_state='passed') OR (action='clear' AND next_state='new'))
);
CREATE TABLE public.sourcing_count_previews (
  id uuid CONSTRAINT src_preview_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  artifact_id uuid NOT NULL,
  request_id uuid NOT NULL,
  state text NOT NULL CONSTRAINT src_preview_state_ck CHECK (state IN ('pending','leased','complete','unavailable','unknown')),
  query_hash text NOT NULL CONSTRAINT src_preview_hash_ck CHECK (query_hash ~ '^[a-f0-9]{64}$'),
  count bigint CONSTRAINT src_preview_count_ck CHECK (count>=0),
  count_relation text CONSTRAINT src_preview_relation_ck CHECK (count_relation IN ('eq','gte','approximate')),
  observed_at timestamptz,
  credits_used numeric CONSTRAINT src_preview_cost_ck CHECK (credits_used>=0),
  lease_id uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT src_preview_request_uq UNIQUE (organization_id,request_id),
  CONSTRAINT src_preview_art_fk FOREIGN KEY (organization_id,job_id,artifact_id) REFERENCES public.sourcing_query_artifacts(organization_id,job_id,id) ON DELETE RESTRICT,
  CONSTRAINT src_preview_lease_ck CHECK ((lease_id IS NULL)=(lease_until IS NULL)),
  CONSTRAINT src_preview_complete_ck CHECK (state<>'complete' OR (count IS NOT NULL AND count_relation IS NOT NULL AND observed_at IS NOT NULL AND credits_used IS NOT NULL))
);
CREATE UNIQUE INDEX src_preview_pending_uq ON public.sourcing_count_previews(artifact_id) WHERE state IN ('pending','leased');
CREATE INDEX src_preview_quota_idx ON public.sourcing_count_previews(organization_id,job_id,created_at);
ALTER TABLE public.job_sourcing_runs ADD COLUMN sourcing_admission_id uuid,
  ADD CONSTRAINT src_run_adm_fk FOREIGN KEY (organization_id,job_id,sourcing_admission_id) REFERENCES public.sourcing_admissions(organization_id,job_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX src_run_adm_uq ON public.job_sourcing_runs(sourcing_admission_id) WHERE sourcing_admission_id IS NOT NULL;
ALTER TABLE public.job_sourced_candidates ADD COLUMN decision_revision bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT src_candidate_rev_ck CHECK (decision_revision>=0);
ALTER TABLE public.jobs ADD COLUMN jd_digest_source_hash text,
  ADD CONSTRAINT src_job_digest_hash_ck CHECK (jd_digest_source_hash ~ '^[a-f0-9]{64}$');

CREATE FUNCTION public.flow_sourcing_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION 'SOURCING_IMMUTABLE' USING ERRCODE='55000'; END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_immutable() FROM PUBLIC;
DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'sourcing_entitlements','sourcing_seat_events','sourcing_query_artifacts',
    'sourcing_account_events','sourcing_deliveries','sourcing_delivery_items','sourcing_decision_events'
  ] LOOP
    EXECUTE format('CREATE TRIGGER src_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.flow_sourcing_immutable()',relation_name);
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY[
    'sourcing_org_state','sourcing_entitlements','sourcing_seat_slots','sourcing_seat_events',
    'sourcing_allowance_windows','sourcing_query_artifacts','sourcing_digest_requests','sourcing_admissions',
    'sourcing_account_events','sourcing_dispatch_outbox','sourcing_execution_grants','sourcing_deliveries',
    'sourcing_delivery_items','sourcing_decision_events','sourcing_count_previews'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',relation_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation_name);
    EXECUTE format('CREATE POLICY src_owner ON public.%I TO %I USING (true) WITH CHECK (true)',relation_name,current_user);
  END LOOP;
END $$;

-- All helpers are private. SECURITY DEFINER entrypoints acquire the coordination
CREATE FUNCTION public.flow_sourcing_org_state(p_org integer,p_lock boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE state public.sourcing_org_state%ROWTYPE;
BEGIN
  IF p_lock THEN
    SELECT * INTO state FROM public.sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
  ELSE
    SELECT * INTO state FROM public.sourcing_org_state WHERE organization_id=p_org;
  END IF;
  RETURN jsonb_build_object('latched',FOUND,'enabled',coalesce(state.enabled,false));
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_org_state(integer,boolean) FROM PUBLIC;

-- All helpers are private. SECURITY DEFINER entrypoints acquire the coordination
-- row before touching accounts. Existing membership writers already own a tuple
-- lock before row triggers run: NOWAIT on that trigger's coordination lock turns
-- an inversion into a bounded retry, not a deadlock or a partially changed seat.
CREATE FUNCTION public.flow_sourcing_reconcile(p_org integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.sourcing_org_state%ROWTYPE; e public.sourcing_entitlements%ROWTYPE;
  s public.sourcing_seat_slots%ROWTYPE; member_id integer; slot_id uuid; n integer;
BEGIN
  SELECT * INTO o FROM public.sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR NOT o.enabled THEN RETURN; END IF;
  SELECT * INTO e FROM public.sourcing_entitlements WHERE organization_id=p_org AND id=o.entitlement_id;
  IF NOT FOUND OR e.valid_from>clock_timestamp() OR e.valid_until<=clock_timestamp()
    OR e.anchor IS DISTINCT FROM o.anchor OR e.capacity<>o.capacity
    OR NOT EXISTS (SELECT 1 FROM public.organization_subscriptions sub
      WHERE sub.id=e.subscription_id AND sub.organization_id=p_org
      AND sub.start_date AT TIME ZONE 'UTC'=e.anchor
      AND (e.origin='explicit_grant' OR (sub.status='active' AND sub.paid_seats>=e.capacity AND sub.current_period_end AT TIME ZONE 'UTC'>clock_timestamp())))
  THEN RETURN; END IF;
  IF o.capacity>10000 THEN RAISE EXCEPTION 'SOURCING_ENTITLEMENT_REQUIRED'; END IF;
  FOR n IN 1..o.capacity LOOP
    INSERT INTO public.sourcing_seat_slots(id,organization_id,slot_number,active)
      VALUES(gen_random_uuid(),p_org,n,true) ON CONFLICT(organization_id,slot_number) DO NOTHING;
  END LOOP;
  FOR s IN SELECT * FROM public.sourcing_seat_slots WHERE organization_id=p_org ORDER BY slot_number FOR UPDATE LOOP
    IF s.active IS DISTINCT FROM (s.slot_number<=o.capacity)
      OR (s.current_user_id IS NOT NULL AND (s.slot_number>o.capacity OR NOT EXISTS (
        SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org AND m.user_id=s.current_user_id AND m.seat_assigned))) THEN
      UPDATE public.sourcing_seat_slots SET active=(slot_number<=o.capacity),current_user_id=NULL,revision=revision+1 WHERE id=s.id;
      INSERT INTO public.sourcing_seat_events(id,organization_id,slot_id,revision,previous_user_id,next_user_id,cause)
        VALUES(gen_random_uuid(),p_org,s.id,s.revision+1,s.current_user_id,NULL,
          CASE WHEN s.slot_number>o.capacity THEN 'capacity' ELSE 'unassign' END);
    END IF;
  END LOOP;
  FOR member_id IN SELECT m.user_id FROM public.organization_members m
    WHERE m.organization_id=p_org AND m.seat_assigned AND NOT EXISTS (
      SELECT 1 FROM public.sourcing_seat_slots ss WHERE ss.organization_id=p_org AND ss.current_user_id=m.user_id)
    ORDER BY m.joined_at,m.user_id LOOP
    SELECT ss.id INTO slot_id FROM public.sourcing_seat_slots ss
      WHERE ss.organization_id=p_org AND ss.active AND ss.current_user_id IS NULL
      ORDER BY EXISTS(SELECT 1 FROM public.sourcing_seat_events h WHERE h.organization_id=p_org AND h.slot_id=ss.id AND h.next_user_id=member_id) DESC,ss.slot_number LIMIT 1;
    EXIT WHEN slot_id IS NULL;
    UPDATE public.sourcing_seat_slots SET current_user_id=member_id,revision=revision+1 WHERE id=slot_id RETURNING * INTO s;
    INSERT INTO public.sourcing_seat_events(id,organization_id,slot_id,revision,previous_user_id,next_user_id,cause)
      VALUES(gen_random_uuid(),p_org,slot_id,s.revision,NULL,member_id,'assign');
  END LOOP;
  UPDATE public.sourcing_org_state SET high_water=greatest(high_water,capacity) WHERE organization_id=p_org;
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_reconcile(integer) FROM PUBLIC;

-- Operator-only activation/supersession. No runtime EXECUTE and no HTTP route.
-- The original billing anchor remains stable: capacity changes never mint a
-- second overlapping five-run window. A changed anchor needs a future design.
CREATE FUNCTION public.flow_sourcing_enable(p_org integer,p_entitlement uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.sourcing_org_state%ROWTYPE; e public.sourcing_entitlements%ROWTYPE;
BEGIN
  PERFORM id FROM public.organizations WHERE id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_NOT_FOUND'; END IF;
  SELECT * INTO o FROM public.sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
  SELECT * INTO e FROM public.sourcing_entitlements WHERE organization_id=p_org AND id=p_entitlement;
  IF NOT FOUND OR e.valid_from>clock_timestamp() OR e.valid_until<=clock_timestamp()
    OR e.capacity>10000 OR NOT EXISTS(SELECT 1 FROM public.organization_subscriptions sub
      WHERE sub.id=e.subscription_id AND sub.organization_id=p_org
      AND sub.start_date AT TIME ZONE 'UTC'=e.anchor
      AND (e.origin='explicit_grant' OR (sub.status='active' AND sub.paid_seats>=e.capacity
        AND sub.current_period_end AT TIME ZONE 'UTC'>clock_timestamp())))
    THEN RAISE EXCEPTION 'SOURCING_ENTITLEMENT_REQUIRED'; END IF;
  IF o.entitlement_id IS NOT NULL AND o.entitlement_id<>e.id THEN
    IF e.supersedes_id IS DISTINCT FROM o.entitlement_id OR e.anchor IS DISTINCT FROM o.anchor
      THEN RAISE EXCEPTION 'SOURCING_WINDOW_CHANGED'; END IF;
  ELSIF o.entitlement_id IS NULL AND e.supersedes_id IS NOT NULL THEN
    RAISE EXCEPTION 'SOURCING_ENTITLEMENT_REQUIRED';
  END IF;
  INSERT INTO public.sourcing_org_state(organization_id,enabled,anchor,capacity,high_water,entitlement_id)
    VALUES(p_org,true,e.anchor,e.capacity,e.capacity,e.id)
    ON CONFLICT(organization_id) DO UPDATE SET enabled=true,anchor=e.anchor,capacity=e.capacity,
      high_water=greatest(sourcing_org_state.high_water,e.capacity),entitlement_id=e.id,
      revision=sourcing_org_state.revision+1;
  PERFORM public.flow_sourcing_reconcile(p_org);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_enable(integer,uuid) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_seat_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE org_id integer; old_org integer; new_org integer;
BEGIN
  IF TG_OP<>'INSERT' THEN old_org:=OLD.organization_id; END IF;
  IF TG_OP<>'DELETE' THEN new_org:=NEW.organization_id; END IF;
  FOR org_id IN SELECT DISTINCT x FROM unnest(ARRAY[old_org,new_org]) x WHERE x IS NOT NULL ORDER BY x LOOP
    PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=org_id AND enabled FOR UPDATE NOWAIT;
    IF FOUND THEN
      UPDATE public.sourcing_org_state SET revision=revision+1 WHERE organization_id=org_id;
      PERFORM public.flow_sourcing_reconcile(org_id);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_seat_sync() FROM PUBLIC;
CREATE TRIGGER sourcing_members_changed AFTER INSERT OR DELETE OR UPDATE OF organization_id,user_id,seat_assigned
  ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.flow_sourcing_seat_sync();
CREATE TRIGGER sourcing_subscription_changed AFTER INSERT OR DELETE OR UPDATE OF organization_id,status,seats,paid_seats,start_date,current_period_start,current_period_end
  ON public.organization_subscriptions FOR EACH ROW EXECUTE FUNCTION public.flow_sourcing_seat_sync();

CREATE FUNCTION public.flow_sourcing_window(p_anchor timestamptz,p_now timestamptz) RETURNS TABLE(starts_at timestamptz,ends_at timestamptz)
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE a timestamp:=p_anchor AT TIME ZONE 'UTC'; n timestamp:=p_now AT TIME ZONE 'UTC';
  months integer; m timestamp; b timestamp; i integer; out_values timestamptz[];
BEGIN
  IF p_anchor IS NULL OR p_now IS NULL OR NOT isfinite(p_anchor) OR NOT isfinite(p_now) OR p_now<p_anchor THEN
    RAISE EXCEPTION 'SOURCING_INVALID_COMMAND';
  END IF;
  months:=(extract(year FROM n)::integer-extract(year FROM a)::integer)*12+extract(month FROM n)::integer-extract(month FROM a)::integer;
  m:=date_trunc('month',a)+make_interval(months=>months);
  b:=m+(least(extract(day FROM a)::integer,extract(day FROM (m+interval '1 month - 1 day'))::integer)-1)*interval '1 day'+(a-date_trunc('day',a));
  IF b>n THEN months:=months-1; END IF;
  FOR i IN 0..1 LOOP
    m:=date_trunc('month',a)+make_interval(months=>months+i);
    b:=m+(least(extract(day FROM a)::integer,extract(day FROM (m+interval '1 month - 1 day'))::integer)-1)*interval '1 day'+(a-date_trunc('day',a));
    out_values:=array_append(out_values,b AT TIME ZONE 'UTC');
  END LOOP;
  RETURN QUERY SELECT out_values[1],out_values[2];
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_window(timestamptz,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_quote(p_org integer,p_job integer,p_actor integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE o public.sourcing_org_state%ROWTYPE; e public.sourcing_entitlements%ROWTYPE;
  j public.jobs%ROWTYPE; b public.job_brief_state%ROWTYPE; slot public.sourcing_seat_slots%ROWTYPE;
  win record; balance integer; payer integer; artifact uuid;
BEGIN
  -- This is a read-only quote, not a seat reconciliation or reservation.
  SELECT * INTO j FROM public.jobs WHERE id=p_job AND organization_id=p_org;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND role='recruiter')
    OR NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org AND user_id=p_actor AND seat_assigned)
    OR (j.posted_by<>p_actor AND NOT EXISTS(SELECT 1 FROM public.job_recruiters WHERE organization_id=p_org AND job_id=p_job AND recruiter_id=p_actor))
  THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.sourcing_org_state WHERE organization_id=p_org;
  IF NOT FOUND OR NOT o.enabled THEN RAISE EXCEPTION 'SOURCING_DISABLED'; END IF;
  SELECT * INTO e FROM public.sourcing_entitlements WHERE organization_id=p_org AND id=o.entitlement_id;
  IF NOT FOUND OR clock_timestamp()<e.valid_from OR clock_timestamp()>=e.valid_until
    OR e.anchor IS DISTINCT FROM o.anchor OR e.capacity<>o.capacity
    OR NOT EXISTS(SELECT 1 FROM public.organization_subscriptions sub WHERE sub.id=e.subscription_id AND sub.organization_id=p_org
      AND sub.start_date AT TIME ZONE 'UTC'=e.anchor
      AND (e.origin='explicit_grant' OR (sub.status='active' AND sub.paid_seats>=e.capacity AND sub.current_period_end AT TIME ZONE 'UTC'>clock_timestamp())))
  THEN RAISE EXCEPTION 'SOURCING_ENTITLEMENT_REQUIRED'; END IF;
  IF NOT j.is_active OR j.status<>'approved' OR (j.expires_at IS NOT NULL AND j.expires_at AT TIME ZONE 'UTC'<=clock_timestamp()) THEN
    RAISE EXCEPTION 'SOURCING_QUERY_STALE';
  END IF;
  SELECT * INTO b FROM public.job_brief_state WHERE organization_id=p_org AND job_id=p_job;
  IF NOT FOUND OR b.approved_version_id IS NULL OR b.approved_version_id IS DISTINCT FROM b.latest_version_id
    OR b.source_hash IS DISTINCT FROM j.current_jd_hash THEN RAISE EXCEPTION 'SOURCING_QUERY_STALE'; END IF;
  SELECT a.id INTO artifact FROM public.sourcing_query_artifacts a WHERE a.organization_id=p_org AND a.job_id=p_job
    AND a.brief_version_id=b.approved_version_id AND a.material_hash=b.approved_material_hash ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
  IF artifact IS NULL THEN RAISE EXCEPTION 'SOURCING_PREPARING'; END IF;
  SELECT * INTO win FROM public.flow_sourcing_window(e.anchor,clock_timestamp());
  FOREACH payer IN ARRAY CASE WHEN j.posted_by=p_actor THEN ARRAY[p_actor] ELSE ARRAY[j.posted_by,p_actor] END LOOP
    IF NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org AND user_id=payer AND seat_assigned)
      OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=payer AND role='recruiter') THEN CONTINUE; END IF;
    SELECT * INTO slot FROM public.sourcing_seat_slots WHERE organization_id=p_org AND current_user_id=payer AND active AND slot_number<=o.capacity;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT 5-w.reserved-w.captured INTO balance FROM public.sourcing_allowance_windows w WHERE w.organization_id=p_org AND w.slot_id=slot.id AND w.starts_at=win.starts_at;
    balance:=coalesce(balance,5);
    IF balance>0 THEN
      RETURN jsonb_build_object('payerUserId',payer,
        'payerDisplayName',(SELECT left(coalesce(nullif(btrim(concat_ws(' ',first_name,last_name)),''),'Recruiter '||payer::text),160) FROM public.users WHERE id=payer),
        'payerSlotId',slot.id,'remaining',balance,'windowStart',win.starts_at,
        'windowEnd',win.ends_at,'revision',o.revision,'briefVersionId',b.approved_version_id,'materialHash',b.approved_material_hash,
        'artifactId',artifact,'quotedAt',clock_timestamp(),'expiresAt',clock_timestamp()+interval '60 seconds');
    END IF;
  END LOOP;
  RAISE EXCEPTION 'SOURCING_ALLOWANCE_EXHAUSTED';
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_quote(integer,integer,integer) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_admit(p_org integer,p_job integer,p_actor integer,p_request uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE q jsonb; a public.sourcing_admissions%ROWTYPE; request_hash text; run_id uuid:=gen_random_uuid();
  o public.sourcing_org_state%ROWTYPE;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>65536
    OR NOT p_command ?& ARRAY['expectedRevision','briefVersionId','materialHash','artifactId','expectedPayerSlotId','expectedWindowStart','quoteExpiresAt']
    OR p_command-ARRAY['expectedRevision','briefVersionId','materialHash','artifactId','expectedPayerSlotId','expectedWindowStart','quoteExpiresAt']<>'{}'::jsonb
  THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  SELECT * INTO o FROM public.sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
  IF NOT FOUND OR NOT o.enabled THEN RAISE EXCEPTION 'SOURCING_DISABLED'; END IF;
  -- Resolve current authorization even on replay; don't disclose old runs to
  -- a removed member. Quote below additionally checks publication and allowance.
  IF public.flow_job_brief_read(p_org,p_job,p_actor) IS NULL THEN RETURN NULL; END IF;
  request_hash:=encode(sha256(convert_to(jsonb_build_object('job',p_job,'actor',p_actor,'command',p_command)::text,'UTF8')),'hex');
  SELECT * INTO a FROM public.sourcing_admissions WHERE organization_id=p_org AND request_id=p_request;
  IF FOUND THEN
    IF a.request_sha256<>request_hash THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
    RETURN jsonb_build_object('id',a.id,'state',a.state,'payerUserId',a.payer_user_id,'replayed',true);
  END IF;
  IF EXISTS(SELECT 1 FROM public.sourcing_admissions WHERE organization_id=p_org AND job_id=p_job AND state<>'cancelled_no_dispatch')
    OR EXISTS(SELECT 1 FROM public.job_sourcing_runs WHERE organization_id=p_org AND job_id=p_job AND sourcing_admission_id IS NULL) THEN
    RAISE EXCEPTION 'SOURCING_ALREADY_ADMITTED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND nullif(btrim(signal_tenant_id),'') IS NOT NULL)
    THEN RAISE EXCEPTION 'SOURCING_TENANT_REQUIRED'; END IF;
  IF p_command->>'quoteExpiresAt' IS NULL OR (p_command->>'quoteExpiresAt')::timestamptz<=clock_timestamp()
    OR (p_command->>'quoteExpiresAt')::timestamptz>clock_timestamp()+interval '61 seconds' THEN RAISE EXCEPTION 'SOURCING_REVISION_CONFLICT'; END IF;
  PERFORM public.flow_sourcing_reconcile(p_org);
  q:=public.flow_sourcing_quote(p_org,p_job,p_actor);
  IF q IS NULL THEN RETURN NULL; END IF;
  IF (q->>'payerSlotId')::uuid IS DISTINCT FROM (p_command->>'expectedPayerSlotId')::uuid THEN RAISE EXCEPTION 'SOURCING_PAYER_CHANGED'; END IF;
  IF (q->>'windowStart')::timestamptz IS DISTINCT FROM (p_command->>'expectedWindowStart')::timestamptz THEN RAISE EXCEPTION 'SOURCING_WINDOW_CHANGED'; END IF;
  IF (q->>'revision')::bigint IS DISTINCT FROM (p_command->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'SOURCING_REVISION_CONFLICT'; END IF;
  IF (q->>'briefVersionId')::uuid IS DISTINCT FROM (p_command->>'briefVersionId')::uuid
    OR q->>'materialHash' IS DISTINCT FROM p_command->>'materialHash'
    OR (q->>'artifactId')::uuid IS DISTINCT FROM (p_command->>'artifactId')::uuid THEN RAISE EXCEPTION 'SOURCING_QUERY_STALE'; END IF;
  INSERT INTO public.sourcing_allowance_windows(organization_id,slot_id,starts_at,ends_at,entitlement_id)
    VALUES(p_org,(q->>'payerSlotId')::uuid,(q->>'windowStart')::timestamptz,(q->>'windowEnd')::timestamptz,o.entitlement_id)
    ON CONFLICT(slot_id,starts_at) DO NOTHING;
  UPDATE public.sourcing_allowance_windows SET reserved=reserved+1,revision=revision+1
    WHERE organization_id=p_org AND slot_id=(q->>'payerSlotId')::uuid AND starts_at=(q->>'windowStart')::timestamptz AND reserved+captured<5;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_ALLOWANCE_EXHAUSTED'; END IF;
  INSERT INTO public.sourcing_admissions(id,organization_id,job_id,request_id,request_sha256,actor_user_id,payer_user_id,payer_slot_id,window_start,artifact_id,state)
    VALUES(run_id,p_org,p_job,p_request,request_hash,p_actor,(q->>'payerUserId')::integer,(q->>'payerSlotId')::uuid,(q->>'windowStart')::timestamptz,(q->>'artifactId')::uuid,'reserved');
  INSERT INTO public.sourcing_account_events(id,organization_id,admission_id,kind,evidence_sha256) VALUES(gen_random_uuid(),p_org,run_id,'reserve',request_hash);
  INSERT INTO public.sourcing_dispatch_outbox(admission_id,organization_id,state) VALUES(run_id,p_org,'pending');
  INSERT INTO public.job_sourcing_runs(organization_id,job_id,request_id,external_job_id,status,context_hash,sourcing_admission_id)
    VALUES(p_org,p_job,'flow:'||run_id::text,'vanta:jobs:'||p_job::text,'pending',q->>'materialHash',run_id);
  RETURN jsonb_build_object('id',run_id,'state','reserved','payerUserId',(q->>'payerUserId')::integer,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_admit(integer,integer,integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_canonical(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public AS $$
DECLARE result text;
BEGIN
  IF jsonb_typeof(p_value)='object' THEN
    SELECT '{'||coalesce(string_agg(to_jsonb(k)::text||':'||public.flow_sourcing_canonical(v),',' ORDER BY k COLLATE "C"),'')||'}'
      INTO result FROM jsonb_each(p_value) AS entries(k,v);
  ELSIF jsonb_typeof(p_value)='array' THEN
    SELECT '['||coalesce(string_agg(public.flow_sourcing_canonical(v),',' ORDER BY ord),'')||']'
      INTO result FROM jsonb_array_elements(p_value) WITH ORDINALITY AS entries(v,ord);
  ELSE result:=p_value::text; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_canonical(jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_digest_claim(p_org integer,p_job integer,p_actor integer,p_request uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE b jsonb; j public.jobs%ROWTYPE; v public.job_brief_versions%ROWTYPE;
  d public.sourcing_digest_requests%ROWTYPE; basis jsonb; basis_hash text; action text; model_name text;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR p_request IS NULL OR NOT p_command ?& ARRAY['action','model']
    OR p_command-ARRAY['action','model','briefVersionId']<>'{}'::jsonb OR p_command->>'action' NOT IN ('schedule','start','retry')
    OR p_command->>'model' IS NULL OR length(p_command->>'model') NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  action:=p_command->>'action'; model_name:=p_command->>'model';
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=p_org AND enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_DISABLED'; END IF;
  b:=public.flow_job_brief_read(p_org,p_job,p_actor);
  IF b IS NULL THEN RETURN NULL; END IF;
  IF b->>'approvedVersionId' IS NULL OR b->>'approvedVersionId' IS DISTINCT FROM b->'latest'->>'version_id' THEN RAISE EXCEPTION 'SOURCING_QUERY_STALE'; END IF;
  IF p_command ? 'briefVersionId' AND p_command->>'briefVersionId' IS DISTINCT FROM b->>'approvedVersionId' THEN
    RAISE EXCEPTION 'SOURCING_QUERY_STALE';
  END IF;
  SELECT * INTO j FROM public.jobs WHERE id=p_job AND organization_id=p_org;
  SELECT * INTO v FROM public.job_brief_versions WHERE organization_id=p_org AND job_id=p_job AND version_id=(b->>'approvedVersionId')::uuid;
  IF v.source_hash IS DISTINCT FROM j.current_jd_hash THEN RAISE EXCEPTION 'SOURCING_QUERY_STALE'; END IF;
  basis:=jsonb_build_object('briefVersionId',v.version_id,'materialHash',v.material_hash,'sourceHash',v.source_hash,
    'title',j.title,'location',j.location,'payload',v.payload);
  basis_hash:=encode(sha256(convert_to(public.flow_sourcing_canonical(basis),'UTF8')),'hex');
  SELECT * INTO d FROM public.sourcing_digest_requests WHERE organization_id=p_org AND job_id=p_job AND brief_version_id=v.version_id AND source_hash=basis_hash AND model=model_name FOR UPDATE;
  IF NOT FOUND THEN
    IF action<>'schedule' THEN RAISE EXCEPTION 'SOURCING_DIGEST_RETRY_REFUSED'; END IF;
    INSERT INTO public.sourcing_digest_requests(id,organization_id,job_id,brief_version_id,actor_user_id,source_hash,request_sha256,model,state)
      VALUES(p_request,p_org,p_job,v.version_id,p_actor,basis_hash,basis_hash,model_name,'reserved') RETURNING * INTO d;
  END IF;
  IF d.state='started' AND d.lease_until<=clock_timestamp() THEN
    UPDATE public.sourcing_digest_requests SET state='unknown',completed_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=d.id RETURNING * INTO d;
  END IF;
  IF action='retry' THEN
    IF d.manual_retry_request_id=p_request THEN RETURN jsonb_build_object('id',d.id,'state',d.state,'replayed',true); END IF;
    IF d.state<>'failed' OR d.attempt_count<>1 OR d.manual_retry_request_id IS NOT NULL
      OR d.result->>'code'='QUERY_MAPPING_UNSUPPORTED' THEN RAISE EXCEPTION 'SOURCING_DIGEST_RETRY_REFUSED'; END IF;
    UPDATE public.sourcing_digest_requests SET state='reserved',manual_retry_request_id=p_request,completed_at=NULL,actor_user_id=p_actor WHERE id=d.id RETURNING * INTO d;
  END IF;
  IF action='start' AND d.state='reserved' THEN
    IF d.attempt_count>=2 THEN RAISE EXCEPTION 'SOURCING_DIGEST_RETRY_REFUSED'; END IF;
    UPDATE public.sourcing_digest_requests SET state='started',attempt_count=attempt_count+1,lease_id=gen_random_uuid(),
      lease_until=clock_timestamp()+interval '45 seconds',started_at=clock_timestamp() WHERE id=d.id RETURNING * INTO d;
    RETURN jsonb_build_object('id',d.id,'state',d.state,'lease',d.lease_id,'model',d.model,'basisHash',basis_hash,
      'basis',basis||jsonb_build_object('sourceJD',v.source_jd));
  END IF;
  IF action='start' AND d.state='succeeded' THEN
    RETURN jsonb_build_object('id',d.id,'state',d.state,'model',d.model,'basisHash',basis_hash,
      'basis',basis||jsonb_build_object('sourceJD',v.source_jd),'result',d.result);
  END IF;
  RETURN jsonb_build_object('id',d.id,'state',d.state,'attempts',d.attempt_count);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_digest_claim(integer,integer,integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_digest_next(p_worker uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE org_id integer; d public.sourcing_digest_requests%ROWTYPE; claim jsonb;
BEGIN
  IF p_worker IS NULL THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  SELECT o.organization_id INTO org_id FROM public.sourcing_org_state o WHERE o.enabled AND EXISTS(
    SELECT 1 FROM public.sourcing_digest_requests r WHERE r.organization_id=o.organization_id AND
      (r.state='reserved' OR (r.state='started' AND r.lease_until<=clock_timestamp()) OR
       (r.state='succeeded' AND NOT EXISTS(SELECT 1 FROM public.sourcing_query_artifacts a
         WHERE a.organization_id=r.organization_id AND a.job_id=r.job_id AND a.brief_version_id=r.brief_version_id AND a.input->>'digestBasisHash'=r.source_hash))))
    ORDER BY o.organization_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF org_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO d FROM public.sourcing_digest_requests r WHERE r.organization_id=org_id AND
    (r.state='reserved' OR (r.state='started' AND r.lease_until<=clock_timestamp()) OR
     (r.state='succeeded' AND NOT EXISTS(SELECT 1 FROM public.sourcing_query_artifacts a
       WHERE a.organization_id=r.organization_id AND a.job_id=r.job_id AND a.brief_version_id=r.brief_version_id AND a.input->>'digestBasisHash'=r.source_hash)))
    ORDER BY r.created_at,r.id LIMIT 1;
  IF d.state='started' THEN
    UPDATE public.sourcing_digest_requests SET state='unknown',completed_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=d.id;
    RETURN NULL;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.job_brief_state b JOIN public.jobs j ON j.id=b.job_id AND j.organization_id=b.organization_id
    JOIN public.job_brief_versions v ON v.version_id=b.approved_version_id AND v.organization_id=b.organization_id AND v.job_id=b.job_id
    WHERE b.organization_id=d.organization_id AND b.job_id=d.job_id AND b.approved_version_id=d.brief_version_id
      AND b.latest_version_id=d.brief_version_id AND j.current_jd_hash=v.source_hash
      AND d.source_hash=encode(sha256(convert_to(public.flow_sourcing_canonical(jsonb_build_object('briefVersionId',v.version_id,
        'materialHash',v.material_hash,'sourceHash',v.source_hash,'title',j.title,'location',j.location,'payload',v.payload)),'UTF8')),'hex')) THEN
    UPDATE public.sourcing_digest_requests SET state='failed',completed_at=clock_timestamp(),
      result=coalesce(result,'{}'::jsonb)||jsonb_build_object('state','failed','code','SOURCING_QUERY_STALE') WHERE id=d.id;
    RETURN NULL;
  END IF;
  BEGIN
    claim:=public.flow_sourcing_digest_claim(d.organization_id,d.job_id,d.actor_user_id,d.id,jsonb_build_object('action','start','model',d.model));
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'SOURCING_QUERY_STALE' THEN RAISE; END IF;
    claim:=NULL;
  END;
  IF claim IS NULL THEN
    UPDATE public.sourcing_digest_requests SET state='failed',completed_at=clock_timestamp(),
      result=coalesce(result,'{}'::jsonb)||jsonb_build_object('state','failed','code','SOURCING_QUERY_STALE') WHERE id=d.id;
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('input',jsonb_build_object('organizationId',d.organization_id,'jobId',d.job_id,'actorId',d.actor_user_id,'requestId',d.id,'model',d.model),'claim',claim);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_digest_next(uuid) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_digest_finish(p_request uuid,p_lease uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE d public.sourcing_digest_requests%ROWTYPE; state_name text;
BEGIN
  IF p_lease IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>65536
    OR p_result-ARRAY['state','digest','inputTokens','outputTokens','code','criterionIds']<>'{}'::jsonb
    OR NOT p_result ? 'state' OR p_result->>'state' NOT IN ('succeeded','failed','unknown') THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  SELECT * INTO d FROM public.sourcing_digest_requests WHERE id=p_request FOR UPDATE;
  IF NOT FOUND OR d.state<>'started' OR d.lease_id IS DISTINCT FROM p_lease OR d.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'SOURCING_LEASE_STALE'; END IF;
  state_name:=p_result->>'state';
  IF p_result ? 'criterionIds' AND (p_result->>'code' IS DISTINCT FROM 'QUERY_MAPPING_UNSUPPORTED'
    OR jsonb_typeof(p_result->'criterionIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_result->'criterionIds')>12)
    THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  IF state_name='succeeded' AND (jsonb_typeof(p_result->'digest') IS DISTINCT FROM 'object'
      OR (p_result->>'inputTokens')::integer<0 OR (p_result->>'outputTokens')::integer NOT BETWEEN 0 AND 4096
      OR NOT p_result ?& ARRAY['digest','inputTokens','outputTokens']) THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  -- A changed approval must not publish the older request's model result.
  IF NOT EXISTS(SELECT 1 FROM public.job_brief_state b JOIN public.jobs j ON j.id=b.job_id AND j.organization_id=b.organization_id
    JOIN public.job_brief_versions v ON v.version_id=b.approved_version_id AND v.organization_id=b.organization_id AND v.job_id=b.job_id
    WHERE b.organization_id=d.organization_id AND b.job_id=d.job_id AND b.approved_version_id=d.brief_version_id
      AND b.latest_version_id=d.brief_version_id AND j.current_jd_hash=v.source_hash
      AND d.source_hash=encode(sha256(convert_to(public.flow_sourcing_canonical(jsonb_build_object('briefVersionId',v.version_id,
        'materialHash',v.material_hash,'sourceHash',v.source_hash,'title',j.title,'location',j.location,'payload',v.payload)),'UTF8')),'hex'))
  THEN state_name:='failed'; p_result:=jsonb_build_object('state','failed','code','SOURCING_QUERY_STALE'); END IF;
  UPDATE public.sourcing_digest_requests SET state=state_name,result=p_result,completed_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=d.id;
  RETURN jsonb_build_object('id',d.id,'state',state_name);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_digest_finish(uuid,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_artifact_put(p_org integer,p_job integer,p_actor integer,p_brief uuid,p_artifact jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE b jsonb; a public.sourcing_query_artifacts%ROWTYPE; calculated text;
BEGIN
  IF jsonb_typeof(p_artifact) IS DISTINCT FROM 'object' OR octet_length(p_artifact::text)>65536
    OR NOT p_artifact ?& ARRAY['compilerVersion','digestVersion','jobContext','criterionMap','briefVersionId','materialHash','sourceHash','digestBasisHash','queryHash','previewQueryHash']
    OR p_artifact-ARRAY['compilerVersion','digestVersion','jobContext','criterionMap','briefVersionId','materialHash','sourceHash','digestBasisHash','queryHash','previewQueryHash']<>'{}'::jsonb
    OR p_artifact->>'compilerVersion'<>'1' OR p_artifact->>'digestVersion'<>'3' THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=p_org AND enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_DISABLED'; END IF;
  b:=public.flow_job_brief_read(p_org,p_job,p_actor);
  IF b IS NULL THEN RETURN NULL; END IF;
  IF (b->>'approvedVersionId')::uuid IS DISTINCT FROM p_brief OR b->>'approvedVersionId' IS DISTINCT FROM b->'latest'->>'version_id'
    OR (p_artifact->>'briefVersionId')::uuid IS DISTINCT FROM p_brief OR b->>'approvedMaterialHash' IS DISTINCT FROM p_artifact->>'materialHash'
    OR b->>'sourceHash' IS DISTINCT FROM p_artifact->>'sourceHash' THEN RAISE EXCEPTION 'SOURCING_QUERY_STALE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sourcing_digest_requests WHERE organization_id=p_org AND job_id=p_job AND brief_version_id=p_brief
    AND state='succeeded' AND source_hash=p_artifact->>'digestBasisHash') THEN RAISE EXCEPTION 'SOURCING_PREPARING'; END IF;
  calculated:=encode(sha256(convert_to(public.flow_sourcing_canonical(p_artifact-ARRAY['briefVersionId','materialHash','sourceHash','digestBasisHash','queryHash']),'UTF8')),'hex');
  IF calculated IS DISTINCT FROM p_artifact->>'queryHash' THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  SELECT * INTO a FROM public.sourcing_query_artifacts WHERE organization_id=p_org AND job_id=p_job AND brief_version_id=p_brief AND compiler_version='1' AND query_hash=calculated;
  IF FOUND THEN
    IF a.input<>p_artifact THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
  ELSE
    INSERT INTO public.sourcing_query_artifacts(id,organization_id,job_id,brief_version_id,material_hash,compiler_version,query_hash,input)
      VALUES(gen_random_uuid(),p_org,p_job,p_brief,p_artifact->>'materialHash','1',calculated,p_artifact) RETURNING * INTO a;
  END IF;
  -- Artifact and automatic preview intent commit together. A quota refusal is
  -- deliberately nonblocking: a ready query must not depend on a paid preview.
  BEGIN
    PERFORM public.flow_sourcing_preview_request(p_org,p_job,p_actor,a.id,jsonb_build_object('action','auto','artifactId',a.id));
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'SOURCING_PREVIEW_LIMIT' THEN RAISE; END IF;
  END;
  RETURN jsonb_build_object('id',a.id,'queryHash',a.query_hash);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_artifact_put(integer,integer,integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_decide(p_org integer,p_job integer,p_actor integer,p_candidate integer,p_request uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE c public.job_sourced_candidates%ROWTYPE; e public.sourcing_decision_events%ROWTYPE;
  b jsonb; request_hash text; target_state text; prior_state text; delivery uuid; brief uuid; tenant text;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR p_request IS NULL
    OR NOT p_command ?& ARRAY['action','expectedRevision']
    OR p_command-ARRAY['action','expectedRevision','reasonCode','criterionId']<>'{}'::jsonb
    OR p_command->>'action' IS NULL OR p_command->>'action' NOT IN ('shortlist','pass','clear')
    OR p_command->>'expectedRevision' IS NULL OR (p_command->>'expectedRevision')::bigint<0
    OR (p_command ? 'reasonCode' AND (p_command->>'reasonCode' IS NULL OR p_command->>'reasonCode' NOT IN ('skills_gap','experience_requirement','role_seniority','domain','location_work_arrangement','compensation','availability','insufficient_information','other')))
    OR (p_command->>'action'='clear' AND (p_command ? 'reasonCode' OR p_command ? 'criterionId'))
    OR (p_command ? 'criterionId' AND NOT p_command ? 'reasonCode') THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  -- Existing candidate decisions are not paid sourcing. Retain the org lock
  -- where present, without inventing/latching an entitlement for free orgs.
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
  b:=public.flow_job_brief_read(p_org,p_job,p_actor);
  IF b IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO c FROM public.job_sourced_candidates WHERE id=p_candidate AND organization_id=p_org AND job_id=p_job FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Mirrors the shipped global-use privacy predicate. The command adapter also
  -- requires the healthy privacy authority before entering this transaction.
  IF EXISTS(SELECT 1 FROM public.candidate_privacy_subject_links l
    JOIN public.candidate_privacy_requests r ON r.request_id=l.request_id
    LEFT JOIN public.candidate_privacy_remote_projection remote ON remote.request_id=r.request_id
    WHERE l.subject_type='job_sourced_candidate' AND l.job_sourced_candidate_id=p_candidate
      AND r.state IN ('accepted_local','delivery_pending','memory_active','needs_review')
      AND coalesce(remote.decision,CASE WHEN r.state='needs_review' THEN 'review' WHEN r.action='request_erasure' THEN 'block_all' ELSE 'block_global' END)
        IN ('block_global','block_all','review')) THEN RETURN NULL; END IF;
  request_hash:=encode(sha256(convert_to(jsonb_build_object('job',p_job,'candidate',p_candidate,'actor',p_actor,'command',p_command)::text,'UTF8')),'hex');
  SELECT * INTO e FROM public.sourcing_decision_events WHERE organization_id=p_org AND request_id=p_request;
  IF FOUND THEN
    IF e.request_sha256<>request_hash THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
    RETURN jsonb_build_object('id',c.id,'state',c.state,'revision',c.decision_revision,'eventId',e.id,'replayed',true);
  END IF;
  IF c.state='converted' OR c.converted_application_id IS NOT NULL THEN RAISE EXCEPTION 'SOURCING_CONVERTED'; END IF;
  IF c.decision_revision IS DISTINCT FROM (p_command->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'SOURCING_REVISION_CONFLICT'; END IF;
  IF EXISTS(SELECT 1 FROM public.job_sourcing_runs WHERE organization_id=p_org AND job_id=p_job AND request_id=c.request_id AND status NOT IN ('completed','failed','expired')) THEN
    RAISE EXCEPTION 'SOURCING_NEEDS_ATTENTION'; END IF;
  SELECT d.id,a.brief_version_id INTO delivery,brief FROM public.sourcing_delivery_items i
    JOIN public.sourcing_deliveries d ON d.id=i.delivery_id AND d.organization_id=i.organization_id AND d.job_id=i.job_id
    JOIN public.sourcing_admissions adm ON adm.id=d.admission_id AND adm.organization_id=d.organization_id AND adm.job_id=d.job_id
    JOIN public.sourcing_query_artifacts a ON a.id=adm.artifact_id AND a.organization_id=adm.organization_id AND a.job_id=adm.job_id
    WHERE i.organization_id=p_org AND i.job_id=p_job AND i.sourced_candidate_id=p_candidate ORDER BY d.revision DESC LIMIT 1;
  IF p_command ? 'criterionId' AND (brief IS NULL OR NOT EXISTS(SELECT 1 FROM public.job_brief_versions v,
    LATERAL jsonb_array_elements(v.payload->'criteria') item WHERE v.organization_id=p_org AND v.job_id=p_job AND v.version_id=brief AND item->>'id'=p_command->>'criterionId')) THEN
    RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  target_state:=CASE p_command->>'action' WHEN 'shortlist' THEN 'shortlisted' WHEN 'pass' THEN 'passed' ELSE 'new' END;
  prior_state:=CASE c.state WHEN 'hidden' THEN 'legacy_hidden' ELSE c.state END;
  INSERT INTO public.sourcing_decision_events(id,organization_id,job_id,sourced_candidate_id,request_id,request_sha256,actor_user_id,
    delivery_id,brief_version_id,revision,action,previous_state,next_state,reason_code,criterion_id)
    VALUES(gen_random_uuid(),p_org,p_job,p_candidate,p_request,request_hash,p_actor,delivery,brief,c.decision_revision+1,
      p_command->>'action',prior_state,target_state,p_command->>'reasonCode',(p_command->>'criterionId')::uuid) RETURNING * INTO e;
  UPDATE public.job_sourced_candidates SET state=target_state,decision_revision=e.revision,updated_at=clock_timestamp() WHERE id=c.id;
  IF target_state<>'shortlisted' AND c.email_resolve_status='pending' AND
      (c.email_resolve_lease_token IS NULL OR c.email_resolve_lease_expires_at<=clock_timestamp() AT TIME ZONE 'UTC') THEN
    UPDATE public.job_sourced_candidates SET found_email=NULL,found_emails='[]'::jsonb,email_resolve_status=NULL,email_resolve_attempts=0,
      email_resolve_next_attempt_at=NULL,email_resolve_lease_token=NULL,email_resolve_lease_expires_at=NULL,email_resolve_last_error_code=NULL,email_resolved_at=NULL WHERE id=c.id;
  ELSIF target_state='shortlisted' AND coalesce(c.email_resolve_status,'') NOT IN ('resolved','pending','suppressed','not_found','failed') THEN
    SELECT signal_tenant_id INTO tenant FROM public.organizations WHERE id=p_org;
    UPDATE public.job_sourced_candidates SET found_email=NULL,found_emails='[]'::jsonb,email_resolve_attempts=0,
      email_resolve_status=CASE WHEN nullif(btrim(tenant),'') IS NULL OR nullif(btrim(c.signal_candidate_id),'') IS NULL THEN 'failed' ELSE 'pending' END,
      email_resolve_next_attempt_at=CASE WHEN nullif(btrim(tenant),'') IS NOT NULL AND nullif(btrim(c.signal_candidate_id),'') IS NOT NULL THEN clock_timestamp() ELSE NULL END,
      email_resolve_lease_token=NULL,email_resolve_lease_expires_at=NULL,
      email_resolve_last_error_code=CASE WHEN nullif(btrim(tenant),'') IS NULL THEN 'missing_signal_tenant' WHEN nullif(btrim(c.signal_candidate_id),'') IS NULL THEN 'missing_signal_candidate_id' ELSE NULL END,
      email_resolved_at=NULL WHERE id=c.id;
  END IF;
  RETURN jsonb_build_object('id',c.id,'state',target_state,'revision',e.revision,'eventId',e.id,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_decide(integer,integer,integer,integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_dispatch_claim(p_worker uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE box public.sourcing_dispatch_outbox%ROWTYPE; adm public.sourcing_admissions%ROWTYPE;
  artifact public.sourcing_query_artifacts%ROWTYPE; org_id integer; tenant text;
BEGIN
  IF p_worker IS NULL THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  -- Lock a coordination row first, then the outbox. Claims never wait behind
  -- another worker's organization and never hold a network connection here.
  SELECT o.organization_id INTO org_id FROM public.sourcing_org_state o
    WHERE o.enabled AND EXISTS(SELECT 1 FROM public.sourcing_dispatch_outbox x WHERE x.organization_id=o.organization_id
      AND ((x.state='pending' AND x.next_attempt_at<=clock_timestamp()) OR (x.state='leased' AND x.lease_until<=clock_timestamp())))
    ORDER BY o.organization_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF org_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO box FROM public.sourcing_dispatch_outbox WHERE organization_id=org_id
    AND ((state='pending' AND next_attempt_at<=clock_timestamp()) OR (state='leased' AND lease_until<=clock_timestamp()))
    ORDER BY next_attempt_at,admission_id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO adm FROM public.sourcing_admissions WHERE id=box.admission_id AND organization_id=org_id FOR UPDATE;
  -- A crash on the final leased attempt must not leave an immortal lease.
  -- Delivery may have happened, so preserve the reservation and require review.
  IF box.attempts>=8 THEN
    UPDATE public.sourcing_dispatch_outbox SET state='needs_attention',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE admission_id=box.admission_id;
    UPDATE public.sourcing_admissions SET state='needs_attention',updated_at=clock_timestamp() WHERE id=box.admission_id;
    RETURN NULL;
  END IF;
  SELECT * INTO artifact FROM public.sourcing_query_artifacts WHERE id=adm.artifact_id AND organization_id=org_id AND job_id=adm.job_id;
  SELECT signal_tenant_id INTO tenant FROM public.organizations WHERE id=org_id;
  IF nullif(btrim(tenant),'') IS NULL THEN
    UPDATE public.sourcing_dispatch_outbox SET state='needs_attention',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE admission_id=box.admission_id;
    UPDATE public.sourcing_admissions SET state='needs_attention',updated_at=clock_timestamp() WHERE id=box.admission_id;
    RETURN NULL;
  END IF;
  UPDATE public.sourcing_dispatch_outbox SET state='leased',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
    WHERE admission_id=box.admission_id RETURNING * INTO box;
  RETURN jsonb_build_object('admissionId',adm.id,'organizationId',org_id,'tenantId',tenant,'lease',box.lease_id,'attempt',box.attempts,
    'command',jsonb_build_object('protocolVersion',1,'flowRunId',adm.id,'organizationRef',org_id::text,'externalJobId','vanta:jobs:'||adm.job_id::text,
      'briefVersionId',artifact.brief_version_id,'materialHash',artifact.material_hash,'artifactHash',artifact.query_hash,'compilerVersion',artifact.compiler_version,'queryArtifact',artifact.input));
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_dispatch_claim(uuid) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_dispatch_finish(p_admission uuid,p_lease uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE org_id integer; box public.sourcing_dispatch_outbox%ROWTYPE; adm public.sourcing_admissions%ROWTYPE; artifact public.sourcing_query_artifacts%ROWTYPE;
BEGIN
  IF p_lease IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>16384
    OR p_result->>'kind' IS NULL OR p_result->>'kind' NOT IN ('bound','retry','needs_attention') THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  SELECT organization_id INTO org_id FROM public.sourcing_admissions WHERE id=p_admission;
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=org_id FOR UPDATE;
  SELECT * INTO box FROM public.sourcing_dispatch_outbox WHERE admission_id=p_admission FOR UPDATE;
  IF FOUND AND box.state IN ('bound','cancelled') AND box.receipt=p_result THEN
    RETURN jsonb_build_object('id',p_admission,'state',box.state);
  END IF;
  IF NOT FOUND OR box.state<>'leased' OR box.lease_id IS DISTINCT FROM p_lease OR box.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'SOURCING_LEASE_STALE'; END IF;
  SELECT * INTO adm FROM public.sourcing_admissions WHERE id=p_admission FOR UPDATE;
  IF p_result->>'kind'='bound' THEN
    SELECT * INTO artifact FROM public.sourcing_query_artifacts WHERE id=adm.artifact_id AND organization_id=org_id AND job_id=adm.job_id;
    IF p_result-ARRAY['kind','requestId','flowRunId','artifactHash','acquisitionGeneration','executionAttemptId']<>'{}'::jsonb
      OR NOT p_result ?& ARRAY['requestId','flowRunId','artifactHash','acquisitionGeneration','executionAttemptId']
      OR p_result->>'flowRunId' IS DISTINCT FROM adm.id::text OR p_result->>'artifactHash' IS DISTINCT FROM artifact.query_hash
      OR p_result->>'acquisitionGeneration' IS DISTINCT FROM '1' OR nullif(p_result->>'requestId','') IS NULL
      OR nullif(p_result->>'executionAttemptId','') IS NULL
      OR (adm.discover_request_id IS NOT NULL AND adm.discover_request_id<>p_result->>'requestId') THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
    UPDATE public.sourcing_admissions SET discover_request_id=p_result->>'requestId',state=CASE WHEN state='reserved' THEN 'bound' ELSE state END,updated_at=clock_timestamp(),revision=revision+1 WHERE id=adm.id;
    UPDATE public.job_sourcing_runs SET request_id=p_result->>'requestId',status='submitted',submitted_at=clock_timestamp(),updated_at=clock_timestamp(),
      meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('signalExecution',jsonb_build_object('acquisitionGeneration',1,'executionAttemptId',p_result->>'executionAttemptId')) WHERE sourcing_admission_id=adm.id AND organization_id=org_id;
    UPDATE public.sourcing_dispatch_outbox SET state='bound',receipt=p_result,lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE admission_id=adm.id;
  ELSE
    IF p_result-ARRAY['kind','code']<>'{}'::jsonb OR length(coalesce(p_result->>'code',''))>100 THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
    UPDATE public.sourcing_dispatch_outbox SET state=CASE WHEN attempts>=8 OR p_result->>'kind'='needs_attention' THEN 'needs_attention' ELSE 'pending' END,
      next_attempt_at=clock_timestamp()+least(900,30*power(2,greatest(attempts-1,0))) * interval '1 second',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp(),receipt=p_result
      WHERE admission_id=adm.id RETURNING * INTO box;
    IF box.state='needs_attention' THEN UPDATE public.sourcing_admissions SET state='needs_attention',updated_at=clock_timestamp() WHERE id=adm.id; END IF;
  END IF;
  RETURN jsonb_build_object('id',adm.id,'state',(SELECT state FROM public.sourcing_dispatch_outbox WHERE admission_id=adm.id));
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_dispatch_finish(uuid,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_grant_context(p_tenant text,p_admission uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE adm public.sourcing_admissions%ROWTYPE; artifact public.sourcing_query_artifacts%ROWTYPE; exact jsonb;
BEGIN
  IF (SELECT count(*) FROM public.organizations WHERE signal_tenant_id=p_tenant)<>1 THEN RETURN NULL; END IF;
  SELECT a.* INTO adm FROM public.sourcing_admissions a JOIN public.organizations o ON o.id=a.organization_id
    WHERE a.id=p_admission AND o.signal_tenant_id=p_tenant;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO artifact FROM public.sourcing_query_artifacts WHERE organization_id=adm.organization_id AND id=adm.artifact_id;
  SELECT receipt INTO exact FROM public.sourcing_execution_grants WHERE organization_id=adm.organization_id AND admission_id=adm.id AND slot='exact' AND receipt->>'state'='complete';
  RETURN jsonb_build_object('organizationId',adm.organization_id,'artifact',artifact.input,'exact',
    CASE WHEN exact IS NULL THEN NULL ELSE jsonb_build_object('providerTotal',exact->'providerTotal','rawReturnedCount',exact->'rawReturnedCount') END);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_grant_context(text,uuid) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_run_binding(p_org integer,p_job integer,p_request text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('flowRunId',adm.id,'artifactHash',artifact.query_hash,'executionAttemptId',box.receipt->>'executionAttemptId')
  FROM public.sourcing_admissions adm JOIN public.sourcing_query_artifacts artifact ON artifact.id=adm.artifact_id AND artifact.organization_id=adm.organization_id
    JOIN public.sourcing_dispatch_outbox box ON box.admission_id=adm.id AND box.organization_id=adm.organization_id
  WHERE adm.organization_id=p_org AND adm.job_id=p_job AND adm.discover_request_id=p_request
$$;
REVOKE ALL ON FUNCTION public.flow_sourcing_run_binding(integer,integer,text) FROM PUBLIC;

-- Provider-query semantics are checked against the immutable artifact by the
-- private typed command. SQL independently binds the full actual input hash,
-- current authority, execution, raw capacity and one grant per slot.
CREATE FUNCTION public.flow_sourcing_grant(p_org integer,p_admission uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE adm public.sourcing_admissions%ROWTYPE; a public.sourcing_query_artifacts%ROWTYPE; g public.sourcing_execution_grants%ROWTYPE;
  b jsonb; evidence jsonb; input_hash text; command_hash text; expires timestamptz; slot_name text; end_time timestamptz; early_box public.sourcing_dispatch_outbox%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>131072
    OR p_command-ARRAY['action','protocolVersion','flowRunId','artifactHash','discoverRequestId','executionAttemptId','slot','rungId','providerInput','providerInputHash']<>'{}'::jsonb
    OR NOT p_command ?& ARRAY['action','protocolVersion','flowRunId','artifactHash','discoverRequestId','executionAttemptId','slot','rungId','providerInput','providerInputHash']
    OR p_command->>'action' IS DISTINCT FROM 'grant' OR p_command->>'protocolVersion' IS DISTINCT FROM '1'
    OR p_command->>'flowRunId' IS DISTINCT FROM p_admission::text OR p_command->>'slot' NOT IN ('exact','spill')
    OR jsonb_typeof(p_command->'providerInput') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=p_org AND enabled FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_DISABLED'; END IF;
  SELECT * INTO adm FROM public.sourcing_admissions WHERE organization_id=p_org AND id=p_admission FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.sourcing_query_artifacts WHERE organization_id=p_org AND id=adm.artifact_id;
  -- Discover may start its worker before the source POST response reaches the
  -- Flow outbox worker. The authenticated grant is also binding evidence, but
  -- only for the already-sealed admission and its currently leased dispatch.
  -- The later identical HTTP response becomes a read-only acknowledgement.
  IF adm.discover_request_id IS NULL AND a.query_hash=p_command->>'artifactHash' THEN
    SELECT * INTO early_box FROM public.sourcing_dispatch_outbox WHERE organization_id=p_org AND admission_id=adm.id FOR UPDATE;
    IF early_box.state='leased' AND early_box.lease_until>clock_timestamp() THEN
      PERFORM public.flow_sourcing_dispatch_finish(adm.id,early_box.lease_id,jsonb_build_object('kind','bound',
        'requestId',p_command->>'discoverRequestId','flowRunId',adm.id,'artifactHash',a.query_hash,'acquisitionGeneration',1,'executionAttemptId',p_command->>'executionAttemptId'));
      SELECT * INTO adm FROM public.sourcing_admissions WHERE id=p_admission;
    END IF;
  END IF;
  SELECT receipt INTO evidence FROM public.sourcing_dispatch_outbox WHERE organization_id=p_org AND admission_id=adm.id AND state='bound';
  IF adm.discover_request_id IS DISTINCT FROM p_command->>'discoverRequestId' OR evidence IS NULL
    OR evidence->>'executionAttemptId' IS DISTINCT FROM p_command->>'executionAttemptId'
    OR a.query_hash IS DISTINCT FROM p_command->>'artifactHash' THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  input_hash:=encode(sha256(convert_to(public.flow_sourcing_canonical(p_command->'providerInput'),'UTF8')),'hex');
  IF input_hash IS DISTINCT FROM p_command->>'providerInputHash' THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  command_hash:=encode(sha256(convert_to(public.flow_sourcing_canonical(p_command),'UTF8')),'hex');
  slot_name:=p_command->>'slot';
  SELECT * INTO g FROM public.sourcing_execution_grants WHERE admission_id=adm.id AND slot=slot_name;
  IF FOUND THEN
    IF g.request_sha256<>command_hash THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
    RETURN jsonb_build_object('grantId',g.id,'providerInputHash',g.provider_input_sha256,'expiresAt',g.expires_at,'state',g.state);
  END IF;
  IF adm.state NOT IN ('bound','dispatched') THEN RAISE EXCEPTION 'SOURCING_NEEDS_ATTENTION'; END IF;
  b:=public.flow_job_brief_read(p_org,adm.job_id,adm.actor_user_id);
  IF b IS NULL THEN RAISE EXCEPTION 'SOURCING_NOT_FOUND'; END IF;
  IF b->>'approvedVersionId' IS DISTINCT FROM a.brief_version_id::text OR b->>'approvedVersionId' IS DISTINCT FROM b->'latest'->>'version_id'
    OR b->>'approvedMaterialHash' IS DISTINCT FROM a.material_hash
    OR NOT EXISTS(SELECT 1 FROM public.jobs WHERE id=adm.job_id AND organization_id=p_org AND is_active AND status='approved'
      AND (expires_at IS NULL OR expires_at AT TIME ZONE 'UTC'>clock_timestamp()) AND current_jd_hash=a.input->>'sourceHash')
    THEN RAISE EXCEPTION 'SOURCING_QUERY_STALE'; END IF;
  PERFORM public.flow_sourcing_reconcile(p_org);
  IF NOT EXISTS(SELECT 1 FROM public.sourcing_seat_slots WHERE organization_id=p_org AND id=adm.payer_slot_id AND active AND current_user_id=adm.payer_user_id)
    OR NOT EXISTS(SELECT 1 FROM public.organization_members WHERE organization_id=p_org AND user_id=adm.payer_user_id AND seat_assigned)
    THEN RAISE EXCEPTION 'SOURCING_PAYER_CHANGED'; END IF;
  WITH RECURSIVE lineage AS (
    SELECT ent.* FROM public.sourcing_entitlements ent JOIN public.sourcing_org_state state
      ON state.organization_id=ent.organization_id AND state.entitlement_id=ent.id WHERE state.organization_id=p_org
    UNION
    SELECT prior.* FROM public.sourcing_entitlements prior JOIN lineage child
      ON prior.organization_id=child.organization_id AND prior.id=child.supersedes_id AND prior.anchor=child.anchor
  )
  SELECT w.ends_at INTO end_time FROM public.sourcing_allowance_windows w
    JOIN public.sourcing_org_state o ON o.organization_id=w.organization_id
    JOIN public.sourcing_entitlements e ON e.organization_id=o.organization_id AND e.id=o.entitlement_id AND o.anchor=e.anchor AND o.capacity=e.capacity
    WHERE w.organization_id=p_org AND w.slot_id=adm.payer_slot_id AND w.starts_at=adm.window_start AND e.valid_from<=clock_timestamp() AND e.valid_until>clock_timestamp()
      AND EXISTS(SELECT 1 FROM lineage WHERE id=w.entitlement_id)
      AND EXISTS(SELECT 1 FROM public.organization_subscriptions sub WHERE sub.id=e.subscription_id AND sub.organization_id=p_org
        AND sub.start_date AT TIME ZONE 'UTC'=e.anchor AND (e.origin='explicit_grant' OR (sub.status='active' AND sub.paid_seats>=e.capacity AND sub.current_period_end AT TIME ZONE 'UTC'>clock_timestamp())));
  IF end_time IS NULL OR end_time<=clock_timestamp() THEN RAISE EXCEPTION 'SOURCING_WINDOW_CHANGED'; END IF;
  IF slot_name='exact' THEN
    IF p_command->'providerInput'->>'limit' IS DISTINCT FROM '300' OR p_command->>'rungId'<>'exact' THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  ELSE
    SELECT receipt INTO evidence FROM public.sourcing_execution_grants WHERE admission_id=adm.id AND slot='exact' AND receipt->>'state'='complete';
    IF evidence IS NULL OR evidence->>'providerTotal' IS NULL OR (evidence->>'providerTotal')::bigint>=300
      OR (evidence->>'rawReturnedCount')::integer>=300 OR (p_command->'providerInput'->>'limit')::integer<>300-(evidence->>'rawReturnedCount')::integer
      THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  END IF;
  expires:=least(clock_timestamp()+interval '60 seconds',end_time);
  INSERT INTO public.sourcing_execution_grants(id,organization_id,admission_id,slot,request_sha256,provider_input_sha256,issued_at,expires_at,state)
    VALUES(gen_random_uuid(),p_org,adm.id,slot_name,command_hash,input_hash,clock_timestamp(),expires,'issued') RETURNING * INTO g;
  RETURN jsonb_build_object('grantId',g.id,'providerInputHash',g.provider_input_sha256,'expiresAt',g.expires_at,'state',g.state);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_grant(integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_receipt(p_org integer,p_admission uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE adm public.sourcing_admissions%ROWTYPE; g public.sourcing_execution_grants%ROWTYPE; box jsonb; target text; evidence_hash text; inserted_capture integer; exact_raw integer;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>16384
    OR p_command-ARRAY['action','protocolVersion','flowRunId','artifactHash','discoverRequestId','executionAttemptId','grantId','slot','providerInputHash','receiptId','state','rawReturnedCount','providerTotal']<>'{}'::jsonb
    OR NOT p_command ?& ARRAY['action','protocolVersion','flowRunId','artifactHash','discoverRequestId','executionAttemptId','grantId','slot','providerInputHash','receiptId','state']
    OR p_command->>'action' IS DISTINCT FROM 'receipt' OR p_command->>'protocolVersion' IS DISTINCT FROM '1'
    OR p_command->>'flowRunId' IS DISTINCT FROM p_admission::text OR p_command->>'state' NOT IN ('started','complete','uncertain')
    OR nullif(p_command->>'receiptId','') IS NULL OR length(p_command->>'receiptId')>200 THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  -- Receipt recovery remains possible after allow-new is disabled or the seat
  -- is removed. It records already-started work; it never authorizes more work.
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
  SELECT * INTO adm FROM public.sourcing_admissions WHERE organization_id=p_org AND id=p_admission FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT receipt INTO box FROM public.sourcing_dispatch_outbox WHERE organization_id=p_org AND admission_id=adm.id;
  SELECT * INTO g FROM public.sourcing_execution_grants WHERE organization_id=p_org AND admission_id=adm.id AND id=(p_command->>'grantId')::uuid AND slot=p_command->>'slot' FOR UPDATE;
  IF NOT FOUND OR g.provider_input_sha256 IS DISTINCT FROM p_command->>'providerInputHash'
    OR adm.discover_request_id IS DISTINCT FROM p_command->>'discoverRequestId'
    OR box->>'executionAttemptId' IS DISTINCT FROM p_command->>'executionAttemptId'
    OR NOT EXISTS(SELECT 1 FROM public.sourcing_query_artifacts WHERE organization_id=p_org AND id=adm.artifact_id AND query_hash=p_command->>'artifactHash')
    OR adm.state='cancelled_no_dispatch' OR g.state='no_dispatch' THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  target:=p_command->>'state';
  IF target='complete' THEN
    IF p_command->>'rawReturnedCount' IS NULL OR (p_command->>'rawReturnedCount') !~ '^(0|[1-9][0-9]*)$'
      OR (p_command->>'rawReturnedCount')::bigint>300 OR NOT p_command ? 'providerTotal'
      OR (p_command->>'providerTotal' IS NOT NULL AND (p_command->>'providerTotal') !~ '^(0|[1-9][0-9]*)$') THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
    IF g.slot='spill' THEN
      SELECT (receipt->>'rawReturnedCount')::integer INTO exact_raw FROM public.sourcing_execution_grants WHERE admission_id=adm.id AND slot='exact' AND receipt->>'state'='complete';
      IF exact_raw IS NULL OR exact_raw+(p_command->>'rawReturnedCount')::integer>300 THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
    END IF;
  ELSIF p_command ?| ARRAY['rawReturnedCount','providerTotal'] THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  evidence_hash:=encode(sha256(convert_to(public.flow_sourcing_canonical(p_command),'UTF8')),'hex');
  IF g.receipt IS NOT NULL THEN
    IF g.receipt->>'receiptId' IS DISTINCT FROM p_command->>'receiptId' THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
    IF g.receipt->>'state' IN ('complete','uncertain') OR g.receipt->>'state'=target THEN
      IF target<>'started' AND g.receipt_sha256<>evidence_hash THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
      RETURN jsonb_build_object('grantId',g.id,'state',g.receipt->>'state','captured',true,'replayed',true);
    END IF;
  END IF;
  INSERT INTO public.sourcing_account_events(id,organization_id,admission_id,kind,evidence_sha256)
    VALUES(gen_random_uuid(),p_org,adm.id,'capture',evidence_hash) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted_capture=ROW_COUNT;
  IF inserted_capture=1 THEN
    UPDATE public.sourcing_allowance_windows SET reserved=reserved-1,captured=captured+1,revision=revision+1
      WHERE organization_id=p_org AND slot_id=adm.payer_slot_id AND starts_at=adm.window_start AND reserved>0;
    IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.sourcing_account_events WHERE admission_id=adm.id AND kind='capture') THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  UPDATE public.sourcing_execution_grants SET state=CASE WHEN target='uncertain' THEN 'uncertain' ELSE 'started' END,receipt=p_command,receipt_sha256=evidence_hash WHERE id=g.id;
  UPDATE public.sourcing_admissions SET state=CASE WHEN target='uncertain' THEN 'needs_attention' WHEN state='delivered' THEN state ELSE 'dispatched' END,
    revision=revision+1,updated_at=clock_timestamp() WHERE id=adm.id;
  RETURN jsonb_build_object('grantId',g.id,'state',target,'captured',true,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_receipt(integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_deliver(p_org integer,p_admission uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE adm public.sourcing_admissions%ROWTYPE; delivery public.sourcing_deliveries%ROWTYPE;
  artifact public.sourcing_query_artifacts%ROWTYPE; proof jsonb; payload_hash text; next_revision integer; entry record;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR p_command-ARRAY['requestId','executionAttemptId','artifactHash','revision','orderedSignalIds']<>'{}'::jsonb
    OR NOT p_command ?& ARRAY['requestId','executionAttemptId','artifactHash','revision','orderedSignalIds']
    OR jsonb_typeof(p_command->'orderedSignalIds') IS DISTINCT FROM 'array'
    OR octet_length(p_command::text)>65536 THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  IF jsonb_array_length(p_command->'orderedSignalIds')>100
    OR (p_command->>'revision') !~ '^[1-9][0-9]*$'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_command->'orderedSignalIds') item
      WHERE jsonb_typeof(item)<>'string' OR length(item#>>'{}') NOT BETWEEN 1 AND 256)
    OR (SELECT count(*)<>count(DISTINCT item) FROM jsonb_array_elements(p_command->'orderedSignalIds') item)
    THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
  SELECT * INTO adm FROM public.sourcing_admissions WHERE organization_id=p_org AND id=p_admission FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO artifact FROM public.sourcing_query_artifacts WHERE organization_id=p_org AND id=adm.artifact_id;
  SELECT receipt INTO proof FROM public.sourcing_dispatch_outbox WHERE organization_id=p_org AND admission_id=adm.id;
  IF adm.discover_request_id IS DISTINCT FROM p_command->>'requestId'
    OR proof->>'executionAttemptId' IS DISTINCT FROM p_command->>'executionAttemptId'
    OR artifact.query_hash IS DISTINCT FROM p_command->>'artifactHash' OR adm.state='cancelled_no_dispatch'
    OR NOT EXISTS(SELECT 1 FROM public.sourcing_account_events WHERE organization_id=p_org AND admission_id=adm.id AND kind='capture')
    THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  next_revision:=(p_command->>'revision')::integer;
  payload_hash:=encode(sha256(convert_to(public.flow_sourcing_canonical(p_command->'orderedSignalIds'),'UTF8')),'hex');
  -- An old, once-valid delivery is not a replay of the current projection.
  -- Refuse it before returning replay success so its caller rolls back upserts.
  IF EXISTS(SELECT 1 FROM public.sourcing_deliveries WHERE admission_id=adm.id AND revision>next_revision) THEN RAISE EXCEPTION 'SOURCING_REVISION_CONFLICT'; END IF;
  SELECT * INTO delivery FROM public.sourcing_deliveries WHERE admission_id=adm.id AND revision=next_revision;
  IF FOUND THEN
    IF delivery.payload_sha256<>payload_hash OR delivery.execution_attempt_id<>p_command->>'executionAttemptId' THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
    RETURN jsonb_build_object('id',delivery.id,'revision',delivery.revision,'replayed',true);
  END IF;
  INSERT INTO public.sourcing_deliveries(id,organization_id,job_id,admission_id,revision,execution_attempt_id,payload_sha256,count)
    VALUES(gen_random_uuid(),p_org,adm.job_id,adm.id,next_revision,p_command->>'executionAttemptId',payload_hash,jsonb_array_length(p_command->'orderedSignalIds')) RETURNING * INTO delivery;
  -- The caller already applied the healthy privacy authority. Store references
  -- only to its existing scoped projection, never insert candidate data here.
  -- A denied/not-ingested candidate has no local item; retain original ordinals.
  FOR entry IN SELECT c.id,c.signal_candidate_id,ids.ordinality FROM jsonb_array_elements_text(p_command->'orderedSignalIds') WITH ORDINALITY ids(value,ordinality)
    JOIN public.job_sourced_candidates c ON c.signal_candidate_id=ids.value AND c.organization_id=p_org AND c.job_id=adm.job_id AND c.request_id=adm.discover_request_id
  LOOP
    INSERT INTO public.sourcing_delivery_items(organization_id,job_id,delivery_id,ordinal,sourced_candidate_id,signal_candidate_id)
      VALUES(p_org,adm.job_id,delivery.id,entry.ordinality,entry.id,entry.signal_candidate_id);
  END LOOP;
  UPDATE public.sourcing_admissions SET state='delivered',revision=revision+1,updated_at=clock_timestamp() WHERE id=adm.id;
  RETURN jsonb_build_object('id',delivery.id,'revision',delivery.revision,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_deliver(integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_cancel(p_org integer,p_admission uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE adm public.sourcing_admissions%ROWTYPE; box public.sourcing_dispatch_outbox%ROWTYPE; evidence_hash text;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>16384
    OR p_command-ARRAY['action','protocolVersion','flowRunId','artifactHash','discoverRequestId','executionAttemptId','cancellationId','cancelledAt']<>'{}'::jsonb
    OR NOT p_command ?& ARRAY['action','protocolVersion','flowRunId','artifactHash','discoverRequestId','executionAttemptId','cancellationId','cancelledAt']
    OR p_command->>'action' IS DISTINCT FROM 'no_dispatch' OR p_command->>'protocolVersion' IS DISTINCT FROM '1'
    OR p_command->>'flowRunId' IS DISTINCT FROM p_admission::text OR nullif(p_command->>'cancellationId','') IS NULL
    OR nullif(p_command->>'cancelledAt','') IS NULL THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
  SELECT * INTO adm FROM public.sourcing_admissions WHERE organization_id=p_org AND id=p_admission FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF adm.cancellation IS NOT NULL THEN
    IF adm.cancellation<>p_command THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
    RETURN jsonb_build_object('id',adm.id,'state','cancelled_no_dispatch','released',true,'replayed',true);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sourcing_query_artifacts WHERE organization_id=p_org AND id=adm.artifact_id AND query_hash=p_command->>'artifactHash')
    OR EXISTS(SELECT 1 FROM public.sourcing_execution_grants WHERE admission_id=adm.id AND (state IN ('started','uncertain') OR receipt IS NOT NULL))
    OR EXISTS(SELECT 1 FROM public.sourcing_account_events WHERE admission_id=adm.id AND kind IN ('capture','release'))
    OR adm.state IN ('delivered','cancelled_no_dispatch') THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  SELECT * INTO box FROM public.sourcing_dispatch_outbox WHERE organization_id=p_org AND admission_id=adm.id FOR UPDATE;
  IF adm.discover_request_id IS NULL AND box.state='leased' AND box.lease_until>clock_timestamp() THEN
    PERFORM public.flow_sourcing_dispatch_finish(adm.id,box.lease_id,jsonb_build_object('kind','bound','requestId',p_command->>'discoverRequestId',
      'flowRunId',adm.id,'artifactHash',p_command->>'artifactHash','acquisitionGeneration',1,'executionAttemptId',p_command->>'executionAttemptId'));
    SELECT * INTO adm FROM public.sourcing_admissions WHERE id=p_admission;
    SELECT * INTO box FROM public.sourcing_dispatch_outbox WHERE admission_id=adm.id;
  END IF;
  IF adm.discover_request_id IS DISTINCT FROM p_command->>'discoverRequestId' OR box.receipt->>'executionAttemptId' IS DISTINCT FROM p_command->>'executionAttemptId'
    THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  evidence_hash:=encode(sha256(convert_to(public.flow_sourcing_canonical(p_command),'UTF8')),'hex');
  INSERT INTO public.sourcing_account_events(id,organization_id,admission_id,kind,evidence_sha256) VALUES(gen_random_uuid(),p_org,adm.id,'release',evidence_hash);
  UPDATE public.sourcing_allowance_windows SET reserved=reserved-1,revision=revision+1
    WHERE organization_id=p_org AND slot_id=adm.payer_slot_id AND starts_at=adm.window_start AND reserved>0;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
  UPDATE public.sourcing_execution_grants SET state='no_dispatch' WHERE admission_id=adm.id AND state='issued';
  UPDATE public.sourcing_admissions SET state='cancelled_no_dispatch',cancellation=p_command,revision=revision+1,updated_at=clock_timestamp() WHERE id=adm.id;
  UPDATE public.sourcing_dispatch_outbox SET state='cancelled',lease_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE admission_id=adm.id;
  UPDATE public.job_sourcing_runs SET status='failed',updated_at=clock_timestamp() WHERE organization_id=p_org AND sourcing_admission_id=adm.id;
  RETURN jsonb_build_object('id',adm.id,'state','cancelled_no_dispatch','released',true,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_cancel(integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_preview_request(p_org integer,p_job integer,p_actor integer,p_request uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE b jsonb; a public.sourcing_query_artifacts%ROWTYPE; prev public.sourcing_count_previews%ROWTYPE; today timestamptz;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR p_command->>'action' IS NULL
    OR p_command->>'action' NOT IN ('read','auto','refresh') OR p_command-ARRAY['action','artifactId']<>'{}'::jsonb THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  b:=public.flow_job_brief_read(p_org,p_job,p_actor);
  IF b IS NULL THEN RETURN NULL; END IF;
  IF p_command->>'action'='read' THEN
    SELECT * INTO a FROM public.sourcing_query_artifacts WHERE organization_id=p_org AND job_id=p_job
      AND brief_version_id=(b->>'approvedVersionId')::uuid AND material_hash=b->>'approvedMaterialHash'
      AND b->>'approvedVersionId'=b->'latest'->>'version_id' ORDER BY created_at DESC,id DESC LIMIT 1;
    SELECT * INTO prev FROM public.sourcing_count_previews WHERE organization_id=p_org AND job_id=p_job
      AND query_hash=a.input->>'previewQueryHash' ORDER BY created_at DESC,id DESC LIMIT 1;
    RETURN jsonb_build_object('artifactId',a.id,'id',prev.id,'state',coalesce(prev.state,'unavailable'),'count',prev.count,'countRelation',prev.count_relation,
      'admissionState',(SELECT state FROM public.sourcing_admissions WHERE organization_id=p_org AND job_id=p_job ORDER BY created_at DESC,id DESC LIMIT 1),
      'canAdmit',NOT EXISTS(SELECT 1 FROM public.sourcing_admissions WHERE organization_id=p_org AND job_id=p_job AND state<>'cancelled_no_dispatch')
        AND NOT EXISTS(SELECT 1 FROM public.job_sourcing_runs WHERE organization_id=p_org AND job_id=p_job AND sourcing_admission_id IS NULL),
      'observedAt',prev.observed_at,'stale',coalesce(prev.observed_at<clock_timestamp()-interval '24 hours',false),
      'preparationCode',(SELECT result->>'code' FROM public.sourcing_digest_requests WHERE organization_id=p_org AND job_id=p_job
        AND brief_version_id=(b->>'approvedVersionId')::uuid ORDER BY created_at DESC,id DESC LIMIT 1),
      'criterionIds',(SELECT result->'criterionIds' FROM public.sourcing_digest_requests WHERE organization_id=p_org AND job_id=p_job
        AND brief_version_id=(b->>'approvedVersionId')::uuid ORDER BY created_at DESC,id DESC LIMIT 1),
      'allowanceResetAt',(SELECT w.ends_at FROM public.sourcing_org_state o
        CROSS JOIN LATERAL public.flow_sourcing_window(o.anchor,clock_timestamp()) w
        WHERE o.organization_id=p_org AND o.anchor<=clock_timestamp()),
      'preparation',(SELECT state FROM public.sourcing_digest_requests WHERE organization_id=p_org AND job_id=p_job
        AND brief_version_id=(b->>'approvedVersionId')::uuid ORDER BY created_at DESC,id DESC LIMIT 1));
  END IF;
  IF p_request IS NULL OR p_command->>'artifactId' IS NULL THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=p_org AND enabled FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_DISABLED'; END IF;
  SELECT * INTO a FROM public.sourcing_query_artifacts WHERE organization_id=p_org AND job_id=p_job AND id=(p_command->>'artifactId')::uuid;
  IF NOT FOUND OR a.brief_version_id IS DISTINCT FROM (b->>'approvedVersionId')::uuid OR a.material_hash IS DISTINCT FROM b->>'approvedMaterialHash'
    OR b->>'approvedVersionId' IS DISTINCT FROM b->'latest'->>'version_id' THEN RAISE EXCEPTION 'SOURCING_QUERY_STALE'; END IF;
  SELECT * INTO prev FROM public.sourcing_count_previews WHERE organization_id=p_org AND request_id=p_request;
  IF FOUND THEN
    IF prev.job_id<>p_job OR prev.artifact_id<>a.id THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
    RETURN jsonb_build_object('id',prev.id,'state',prev.state,'replayed',true);
  END IF;
  SELECT * INTO prev FROM public.sourcing_count_previews WHERE organization_id=p_org AND job_id=p_job AND query_hash=a.input->>'previewQueryHash' ORDER BY created_at DESC,id DESC LIMIT 1;
  IF FOUND AND (p_command->>'action'='auto' OR prev.state IN ('pending','leased')) THEN
    RETURN jsonb_build_object('id',prev.id,'state',prev.state,'replayed',true);
  END IF;
  today:=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF EXISTS(SELECT 1 FROM public.sourcing_count_previews WHERE organization_id=p_org AND job_id=p_job AND created_at>clock_timestamp()-interval '15 minutes')
    OR (SELECT count(*) FROM public.sourcing_count_previews WHERE organization_id=p_org AND job_id=p_job AND created_at>=today)>=4
    OR (SELECT count(*) FROM public.sourcing_count_previews WHERE organization_id=p_org AND created_at>=today)>=30
    OR EXISTS(SELECT 1 FROM public.sourcing_count_previews WHERE organization_id=p_org AND state='unknown' AND created_at>=today) THEN RAISE EXCEPTION 'SOURCING_PREVIEW_LIMIT'; END IF;
  INSERT INTO public.sourcing_count_previews(id,organization_id,job_id,artifact_id,request_id,state,query_hash)
    VALUES(gen_random_uuid(),p_org,p_job,a.id,p_request,'pending',a.input->>'previewQueryHash') RETURNING * INTO prev;
  RETURN jsonb_build_object('id',prev.id,'state',prev.state,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_preview_request(integer,integer,integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_preview_claim(p_worker uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE prev public.sourcing_count_previews%ROWTYPE; a public.sourcing_query_artifacts%ROWTYPE; tenant text;
BEGIN
  IF p_worker IS NULL THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  SELECT p.* INTO prev FROM public.sourcing_count_previews p JOIN public.sourcing_org_state o ON o.organization_id=p.organization_id AND o.enabled
    WHERE p.state='pending' OR (p.state='leased' AND p.lease_until<=clock_timestamp())
    ORDER BY p.created_at,p.id FOR UPDATE OF p SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Bound status polling as well as provider calls. A late or lost reply is
  -- unknown, never a fresh preview purchase or an invented zero result.
  IF prev.created_at<=clock_timestamp()-interval '15 minutes' THEN
    UPDATE public.sourcing_count_previews SET state=CASE WHEN prev.state='pending' THEN 'unavailable' ELSE 'unknown' END,
      lease_id=NULL,lease_until=NULL WHERE id=prev.id;
    RETURN NULL;
  END IF;
  SELECT * INTO a FROM public.sourcing_query_artifacts WHERE organization_id=prev.organization_id AND job_id=prev.job_id AND id=prev.artifact_id;
  SELECT signal_tenant_id INTO tenant FROM public.organizations WHERE id=prev.organization_id;
  IF nullif(btrim(tenant),'') IS NULL THEN
    UPDATE public.sourcing_count_previews SET state='unavailable',lease_id=NULL,lease_until=NULL WHERE id=prev.id; RETURN NULL;
  END IF;
  -- Reclaimed leases resend only the same preview ID to Discover. Discover's
  -- started receipt prevents a second provider call after an ambiguous timeout.
  UPDATE public.sourcing_count_previews SET state='leased',lease_id=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds' WHERE id=prev.id RETURNING * INTO prev;
  RETURN jsonb_build_object('id',prev.id,'lease',prev.lease_id,'tenantId',tenant,'externalJobId','vanta:jobs:'||prev.job_id::text,
    'command',jsonb_build_object('protocolVersion',1,'previewId',prev.id,'artifactHash',a.query_hash,'queryArtifact',a.input));
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_preview_claim(uuid) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_preview_finish(p_preview uuid,p_lease uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE prev public.sourcing_count_previews%ROWTYPE; next_state text;
BEGIN
  IF p_lease IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR p_result-ARRAY['state','count','countRelation','creditsUsed']<>'{}'::jsonb
    OR p_result->>'state' IS NULL OR p_result->>'state' NOT IN ('pending','complete','unavailable','unknown') THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  SELECT * INTO prev FROM public.sourcing_count_previews WHERE id=p_preview FOR UPDATE;
  IF NOT FOUND OR prev.state<>'leased' OR prev.lease_id IS DISTINCT FROM p_lease OR prev.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'SOURCING_LEASE_STALE'; END IF;
  next_state:=p_result->>'state';
  IF next_state='pending' THEN
    -- Keep the lease as a polling delay; the next claim resends the same ID.
    UPDATE public.sourcing_count_previews SET lease_until=clock_timestamp()+interval '15 seconds' WHERE id=prev.id;
  ELSE
    IF next_state='complete' AND (NOT p_result ?& ARRAY['count','countRelation','creditsUsed'] OR p_result->>'count' IS NULL OR p_result->>'countRelation' IS NULL OR p_result->>'creditsUsed' IS NULL
      OR (p_result->>'count')::bigint<0 OR (p_result->>'creditsUsed')::numeric NOT BETWEEN 0 AND 0.03) THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
    UPDATE public.sourcing_count_previews SET state=next_state,count=CASE WHEN next_state='complete' THEN (p_result->>'count')::bigint END,
      count_relation=CASE WHEN next_state='complete' THEN p_result->>'countRelation' END,credits_used=(p_result->>'creditsUsed')::numeric,
      observed_at=clock_timestamp(),lease_id=NULL,lease_until=NULL WHERE id=prev.id;
  END IF;
  RETURN jsonb_build_object('id',prev.id,'state',next_state);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_preview_finish(uuid,uuid,jsonb) FROM PUBLIC;
