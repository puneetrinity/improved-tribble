-- Wave 5C: give back the search when a search delivers no candidates.
-- One append-only record per admission makes the refund once-only for both
-- reasons: system_failure (Part A) and zero_results (Part B). The routine
-- refunds only a captured search whose run is permanently finished and which
-- delivered zero candidates. A delivery after a refund is refused.
CREATE TABLE public.sourcing_refunds (
 admission_id uuid PRIMARY KEY,
 organization_id integer NOT NULL,
 reason text NOT NULL CHECK(reason IN ('system_failure','zero_results')),
 target text NOT NULL CHECK(target IN ('original_window','original_grant','replacement_grant','unusable')),
 replacement_grant_id uuid,
 refunded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((target='replacement_grant')=(replacement_grant_id IS NOT NULL)),
 FOREIGN KEY(organization_id,admission_id) REFERENCES public.sourcing_admissions(organization_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(organization_id,replacement_grant_id) REFERENCES public.sourcing_extra_grants(organization_id,id)
);
REVOKE ALL ON public.sourcing_refunds FROM PUBLIC;
ALTER TABLE public.sourcing_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_refunds FORCE ROW LEVEL SECURITY;
DO $acl$ BEGIN
 EXECUTE format('CREATE POLICY src_owner ON public.sourcing_refunds TO %I USING (true) WITH CHECK (true)',current_user);
END $acl$;
CREATE TRIGGER src_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.sourcing_refunds
 FOR EACH STATEMENT EXECUTE FUNCTION public.flow_sourcing_immutable();

-- Durable operator notifications. A refund that cannot be given back records
-- its notification in the same transaction, so a lost commit response or a
-- failed email never loses the alert. A drainer sends with bounded retries and
-- records acknowledgement; refund idempotency never depends on delivery.
CREATE TABLE public.sourcing_ops_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('refund_unusable')),
 subject_id uuid NOT NULL,
 reason text NOT NULL CHECK(reason IN ('system_failure','zero_results')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_token uuid,
 leased_until timestamptz,
 sent_at timestamptz,
 last_error text CHECK(last_error IS NULL OR last_error ~ '^[A-Za-z0-9_]{1,80}$'),
 UNIQUE(kind,subject_id),
 CHECK((lease_token IS NULL)=(leased_until IS NULL)),
 FOREIGN KEY(organization_id,subject_id) REFERENCES public.sourcing_admissions(organization_id,id) ON DELETE RESTRICT
);
REVOKE ALL ON public.sourcing_ops_notifications FROM PUBLIC;
ALTER TABLE public.sourcing_ops_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sourcing_ops_notifications FORCE ROW LEVEL SECURITY;
DO $acl$ BEGIN
 EXECUTE format('CREATE POLICY son_owner ON public.sourcing_ops_notifications TO %I USING (true) WITH CHECK (true)',current_user);
END $acl$;

-- Claim the oldest due unsent notification under a short lease. Each claim
-- uses one attempt (backoff 1, 2, 4... minutes, capped at 6 hours); after ten
-- the row stays unsent and visible for review.
CREATE FUNCTION public.flow_sourcing_ops_notify_claim(p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE n public.sourcing_ops_notifications%ROWTYPE; now_at timestamptz:=clock_timestamp();
BEGIN
  IF p_lease IS NULL THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  SELECT * INTO n FROM public.sourcing_ops_notifications
    WHERE sent_at IS NULL AND attempts<10 AND next_attempt_at<=now_at AND (leased_until IS NULL OR leased_until<now_at)
    ORDER BY attempts, created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.sourcing_ops_notifications SET attempts=attempts+1,lease_token=p_lease,leased_until=now_at+interval '2 minutes',
    next_attempt_at=now_at+least(interval '6 hours',interval '1 minute'*power(2,attempts))
    WHERE id=n.id;
  RETURN jsonb_build_object('id',n.id,'kind',n.kind,'organizationId',n.organization_id,'subjectId',n.subject_id,
    'reason',n.reason,'attempt',n.attempts+1,'createdAt',n.created_at);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_ops_notify_claim(uuid) FROM PUBLIC;

-- Settle a claimed attempt. Only the current lease holder can settle it; a
-- send that may have happened is still marked sent (an alert is at-least-once).
CREATE FUNCTION public.flow_sourcing_ops_notify_finish(p_id uuid,p_lease uuid,p_sent boolean,p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
BEGIN
  IF p_id IS NULL OR p_lease IS NULL OR p_sent IS NULL OR (p_error IS NOT NULL AND p_error !~ '^[A-Za-z0-9_]{1,80}$')
  THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  UPDATE public.sourcing_ops_notifications SET
    sent_at=CASE WHEN p_sent THEN clock_timestamp() ELSE NULL END,
    last_error=CASE WHEN p_sent THEN NULL ELSE p_error END,
    lease_token=NULL,leased_until=NULL
    WHERE id=p_id AND lease_token=p_lease AND sent_at IS NULL;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_ops_notify_finish(uuid,uuid,boolean,text) FROM PUBLIC;

-- An extra-search refund is its own audited event, never a reused 'release'.
ALTER TABLE public.sourcing_extra_events DROP CONSTRAINT sourcing_extra_events_kind_check,
 ADD CONSTRAINT sourcing_extra_events_kind_check CHECK(kind IN ('issue','revoke','reserve','capture','release','refund'));

CREATE FUNCTION public.flow_sourcing_refund(p_org integer,p_admission uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE adm public.sourcing_admissions%ROWTYPE; prior public.sourcing_refunds%ROWTYPE;
  fund public.sourcing_admission_funding%ROWTYPE; st public.sourcing_org_state%ROWTYPE;
  run_status text; delivered integer; tgt text; gid uuid; period_end timestamptz; access_until timestamptz;
  now_at timestamptz:=clock_timestamp(); digest text; expected_status text;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('system_failure','zero_results') THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  -- Same lock order as receipt and deliver: organization, then admission.
  PERFORM organization_id FROM public.sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
  SELECT * INTO adm FROM public.sourcing_admissions WHERE organization_id=p_org AND id=p_admission FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO prior FROM public.sourcing_refunds WHERE admission_id=adm.id;
  IF FOUND THEN
    RETURN jsonb_build_object('refunded',prior.target<>'unusable','replayed',true,'reason',prior.reason,'target',prior.target);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sourcing_account_events WHERE admission_id=adm.id AND kind='capture') THEN
    RETURN jsonb_build_object('refunded',false,'code','SOURCING_REFUND_NOT_CAPTURED');
  END IF;
  SELECT r.status INTO run_status FROM public.job_sourcing_runs r
    WHERE r.organization_id=p_org AND r.sourcing_admission_id=adm.id FOR UPDATE;
  expected_status:=CASE p_reason WHEN 'system_failure' THEN 'failed' ELSE 'completed' END;
  IF run_status IS DISTINCT FROM expected_status THEN
    RETURN jsonb_build_object('refunded',false,'code','SOURCING_REFUND_NOT_TERMINAL');
  END IF;
  SELECT (SELECT count(*) FROM public.sourcing_delivery_items i JOIN public.sourcing_deliveries d ON d.id=i.delivery_id
           WHERE d.admission_id=adm.id AND d.organization_id=p_org)
       + (SELECT count(*) FROM public.job_sourced_candidates c
           WHERE c.organization_id=p_org AND c.job_id=adm.job_id AND c.request_id=adm.discover_request_id)
    INTO delivered;
  IF delivered>0 THEN RETURN jsonb_build_object('refunded',false,'code','SOURCING_REFUND_DELIVERED'); END IF;

  digest:=encode(sha256(convert_to(adm.id::text||':refund:'||p_reason,'UTF8')),'hex');
  SELECT * INTO fund FROM public.sourcing_admission_funding WHERE admission_id=adm.id;
  IF FOUND AND fund.source='extra' THEN
    UPDATE public.sourcing_extra_balances b SET captured=captured-1,revision=revision+1
      FROM public.sourcing_extra_grants g
      WHERE b.grant_id=fund.grant_id AND g.id=b.grant_id AND g.organization_id=p_org
        AND b.revoked_at IS NULL AND g.valid_until>now_at AND b.captured>0;
    IF FOUND THEN
      tgt:='original_grant';
      INSERT INTO public.sourcing_extra_events(id,organization_id,grant_id,admission_id,kind,command_sha256,database_user,reason)
        VALUES(gen_random_uuid(),p_org,fund.grant_id,adm.id,'refund',digest,session_user,p_reason);
    END IF;
  ELSE
    UPDATE public.sourcing_allowance_windows SET captured=captured-1,revision=revision+1
      WHERE organization_id=p_org AND slot_id=adm.payer_slot_id AND starts_at=adm.window_start
        AND ends_at>now_at AND captured>0;
    IF FOUND THEN tgt:='original_window'; END IF;
  END IF;

  IF tgt IS NULL THEN
    -- The original source has expired: one usable search until the end of the
    -- current billing period (never past the organization's access).
    SELECT * INTO st FROM public.sourcing_org_state WHERE organization_id=p_org;
    SELECT e.valid_until INTO access_until FROM public.sourcing_entitlements e
      WHERE e.id=st.entitlement_id AND e.organization_id=p_org AND e.valid_from<=now_at AND e.valid_until>now_at;
    IF st.enabled AND st.anchor IS NOT NULL AND access_until IS NOT NULL THEN
      SELECT w.ends_at INTO period_end FROM public.flow_sourcing_window(st.anchor,now_at) w;
      period_end:=least(period_end,access_until);
    END IF;
    IF period_end IS NOT NULL AND period_end>now_at THEN
      gid:=gen_random_uuid(); tgt:='replacement_grant';
      INSERT INTO public.sourcing_extra_grants(id,organization_id,recipient_user_id,quantity,valid_from,valid_until,reason,operator_label,database_user,command_sha256)
        VALUES(gid,p_org,adm.payer_user_id,1,now_at,period_end,'Search refunded: no candidates delivered ('||p_reason||')',
          'system:no-result-refund',session_user,digest);
      INSERT INTO public.sourcing_extra_balances(grant_id,quantity) VALUES(gid,1);
      INSERT INTO public.sourcing_extra_events(id,organization_id,grant_id,admission_id,kind,command_sha256,database_user,operator_label,reason)
        VALUES(gen_random_uuid(),p_org,gid,NULL,'issue',digest,session_user,'system:no-result-refund',p_reason);
    ELSE
      tgt:='unusable';
      INSERT INTO public.sourcing_ops_notifications(organization_id,kind,subject_id,reason)
        VALUES(p_org,'refund_unusable',adm.id,p_reason);
    END IF;
  END IF;
  INSERT INTO public.sourcing_refunds(admission_id,organization_id,reason,target,replacement_grant_id)
    VALUES(adm.id,p_org,p_reason,tgt,gid);
  RETURN jsonb_build_object('refunded',tgt<>'unusable','replayed',false,'reason',p_reason,'target',tgt);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_refund(integer,uuid,text) FROM PUBLIC;

-- Late results after a refund are refused, so a refunded search never also
-- delivers candidates. Exact fingerprint-checked replacement of the live body.
DO $patch$
DECLARE d text; old text; new text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.flow_sourcing_deliver(integer,uuid,jsonb)'::regprocedure)<>'ac85b75d2a1ad9a3d33b562c6a01516d'
  THEN RAISE EXCEPTION 'SOURCING_REFUND_PATCH_DRIFT'; END IF;
  d:=pg_get_functiondef('public.flow_sourcing_deliver(integer,uuid,jsonb)'::regprocedure);
  old:='    THEN RAISE EXCEPTION ''SOURCING_INVALID_RECEIPT''; END IF;
  IF adm.ranking_contract IS NOT NULL THEN';
  new:='    THEN RAISE EXCEPTION ''SOURCING_INVALID_RECEIPT''; END IF;
  IF EXISTS(SELECT 1 FROM public.sourcing_refunds WHERE admission_id=adm.id) THEN RAISE EXCEPTION ''SOURCING_REFUNDED''; END IF;
  IF adm.ranking_contract IS NOT NULL THEN';
  IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'SOURCING_REFUND_PATCH_DRIFT'; END IF;
  EXECUTE replace(d,old,new);
END $patch$;
