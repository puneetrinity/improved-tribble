-- Environment-backed global policies, OCR monetary admission and durable warnings.
-- No provider prices, runtime enablement or notification recipient are seeded.
CREATE TABLE public.candidate_source_global_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), configured boolean NOT NULL DEFAULT false,
 ocr_day_micro bigint NOT NULL CHECK(ocr_day_micro>=0),ocr_month_micro bigint NOT NULL CHECK(ocr_month_micro>=ocr_day_micro),
 rc_day_credits bigint NOT NULL CHECK(rc_day_credits>=0),rc_month_credits bigint NOT NULL CHECK(rc_month_credits>=rc_day_credits)
);
INSERT INTO public.candidate_source_global_policy VALUES(true,false,2000000,20000000,150,3000);
CREATE TABLE public.candidate_source_global_audit (
 revision uuid PRIMARY KEY DEFAULT gen_random_uuid(), digest text NOT NULL,
 policy jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),operator_role name NOT NULL DEFAULT session_user
);
CREATE TABLE public.candidate_source_ocr_prices (
 version text PRIMARY KEY,micro_per_page bigint NOT NULL CHECK(micro_per_page>0),
 valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL CHECK(valid_until>valid_from),evidence text NOT NULL CHECK(length(evidence)>0)
);
CREATE TRIGGER immutable_price BEFORE UPDATE OR DELETE ON public.candidate_source_ocr_prices
 FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_ai_price_immutable();
CREATE TABLE public.candidate_source_ocr_spend (
 reservation_id uuid PRIMARY KEY,user_id integer,price_version text NOT NULL REFERENCES public.candidate_source_ocr_prices(version),
 pages bigint NOT NULL CHECK(pages>0),charged_micro numeric NOT NULL CHECK(charged_micro>=0),created_at timestamptz NOT NULL
);
CREATE INDEX candidate_source_ocr_spend_window ON public.candidate_source_ocr_spend(created_at,user_id);
CREATE TABLE public.candidate_source_budget_alerts (
 alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dedupe_key text UNIQUE NOT NULL,user_id integer,
 feature text NOT NULL,metric text NOT NULL,used numeric NOT NULL,cap numeric NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),delivered_at timestamptz,
 lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT '-infinity'
);
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['candidate_source_global_policy','candidate_source_global_audit','candidate_source_ocr_prices','candidate_source_ocr_spend','candidate_source_budget_alerts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_only ON public.%I TO %I USING(true) WITH CHECK(true)',t,current_user);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
 END LOOP;
END $$;

-- Owner-only. Changing limits does not enable AI or clear an incident stop.
CREATE FUNCTION public.flow_candidate_source_global_configure(p jsonb,p_digest text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE k text;old_policy jsonb;
BEGIN
 IF NOT coalesce(public.flow_candidate_source_shape(p,ARRAY['aiDayMicro','aiMonthMicro','ocrDayMicro','ocrMonthMicro','rcDayCredits','rcMonthCredits']),false)
 OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_budget_policy' USING ERRCODE='22023';END IF;
 FOR k IN SELECT jsonb_object_keys(p) LOOP
  IF jsonb_typeof(p->k)<>'string' OR p->>k!~'^(0|[1-9][0-9]{0,15})$' OR (p->>k)::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_budget_policy' USING ERRCODE='22023';END IF;
 END LOOP;
 IF (p->>'aiDayMicro')::bigint>(p->>'aiMonthMicro')::bigint OR (p->>'ocrDayMicro')::bigint>(p->>'ocrMonthMicro')::bigint
 OR (p->>'rcDayCredits')::bigint>(p->>'rcMonthCredits')::bigint THEN RAISE EXCEPTION 'invalid_budget_policy' USING ERRCODE='22023';END IF;
 -- Same order as lookup -> shared AI -> OCR. No spend row is rewritten.
 PERFORM pg_advisory_xact_lock(41944,3);PERFORM pg_advisory_xact_lock(41944,5);PERFORM pg_advisory_xact_lock(41944,6);
 SELECT policy INTO old_policy FROM public.candidate_source_global_audit ORDER BY changed_at DESC,revision DESC LIMIT 1;
 IF old_policy=p AND EXISTS(SELECT 1 FROM public.candidate_source_ai_policy WHERE global_day_micro=(p->>'aiDayMicro')::bigint AND global_month_micro=(p->>'aiMonthMicro')::bigint)
 AND EXISTS(SELECT 1 FROM public.candidate_source_global_policy WHERE configured AND ocr_day_micro=(p->>'ocrDayMicro')::bigint AND ocr_month_micro=(p->>'ocrMonthMicro')::bigint AND rc_day_credits=(p->>'rcDayCredits')::bigint AND rc_month_credits=(p->>'rcMonthCredits')::bigint) THEN RETURN;END IF;
 UPDATE public.candidate_source_ai_policy SET global_day_micro=(p->>'aiDayMicro')::bigint,global_month_micro=(p->>'aiMonthMicro')::bigint WHERE singleton;
 UPDATE public.candidate_source_global_policy SET configured=true,ocr_day_micro=(p->>'ocrDayMicro')::bigint,ocr_month_micro=(p->>'ocrMonthMicro')::bigint,
 rc_day_credits=(p->>'rcDayCredits')::bigint,rc_month_credits=(p->>'rcMonthCredits')::bigint WHERE singleton;
 UPDATE public.candidate_source_lookup_budgets SET credit_limit=CASE WHEN period='day' THEN (p->>'rcDayCredits')::bigint ELSE (p->>'rcMonthCredits')::bigint END
 WHERE ends_at>public.flow_candidate_source_budget_now('lookup');
 INSERT INTO public.candidate_source_global_audit(digest,policy) VALUES(p_digest,p);
END $$;

-- UTC rollover uses the configured ceilings, never a new allowance within the
-- same window. Existing window identities and stopped flags remain unchanged.
CREATE FUNCTION public.flow_candidate_source_budget_windows_sync(p_kind text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE p public.candidate_source_global_policy%ROWTYPE;t timestamptz;w record;rate bigint;cap bigint;BEGIN
 SELECT * INTO p FROM public.candidate_source_global_policy WHERE singleton;
 IF NOT p.configured THEN RETURN;END IF;
 IF p_kind NOT IN ('lookup','ocr') THEN RAISE EXCEPTION 'invalid_budget_kind' USING ERRCODE='22023';END IF;
 t:=public.flow_candidate_source_budget_now(p_kind);
 IF p_kind='ocr' THEN
  IF (SELECT count(*) FROM public.candidate_source_ocr_prices WHERE valid_from<=t AND valid_until>t)<>1 THEN RETURN;END IF;
  SELECT micro_per_page INTO rate FROM public.candidate_source_ocr_prices WHERE valid_from<=t AND valid_until>t;
 END IF;
 FOR w IN SELECT 'day' period,date_trunc('day',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' starts,(date_trunc('day',t AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC' ends
 UNION ALL SELECT 'month',date_trunc('month',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',(date_trunc('month',t AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC'
 LOOP
  IF p_kind='lookup' THEN
   IF NOT EXISTS(SELECT 1 FROM public.candidate_source_lookup_budgets WHERE period=w.period AND starts_at=w.starts AND ends_at=w.ends) THEN
    INSERT INTO public.candidate_source_lookup_budgets(period,starts_at,ends_at,credit_limit) VALUES(w.period,w.starts,w.ends,CASE WHEN w.period='day' THEN p.rc_day_credits ELSE p.rc_month_credits END);
   END IF;
  ELSE
   cap:=CASE WHEN w.period='day' THEN p.ocr_day_micro ELSE p.ocr_month_micro END/rate;
   INSERT INTO public.candidate_source_budget_windows(kind,period,starts_at,ends_at,global_units,per_candidate_units)
   VALUES('ocr',w.period,w.starts,w.ends,cap,CASE WHEN w.period='day' THEN least(cap,30) ELSE cap END)
   ON CONFLICT(kind,period,starts_at) DO UPDATE SET global_units=excluded.global_units,per_candidate_units=excluded.per_candidate_units;
  END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.flow_candidate_source_budget_emit(p_key text,p_user integer,p_feature text,p_metric text,p_used numeric,p_cap numeric) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF p_cap>0 AND p_used*5>=p_cap*4 THEN
  INSERT INTO public.candidate_source_budget_alerts(dedupe_key,user_id,feature,metric,used,cap)
  VALUES(p_key||':'||p_cap,p_user,p_feature,p_metric,p_used,p_cap) ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
END $$;

CREATE FUNCTION public.flow_candidate_source_ocr_admit(p_id uuid,p_user integer,p_pages bigint) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE t timestamptz;d timestamptz;m timestamptz;price public.candidate_source_ocr_prices%ROWTYPE;
 policy public.candidate_source_global_policy%ROWTYPE;gd numeric;gm numeric;cp numeric;amount numeric;
BEGIN
 IF p_id IS NULL OR p_user IS NULL OR p_pages NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'invalid_ocr_budget_request' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(41944,6);
 IF EXISTS(SELECT 1 FROM public.candidate_source_ocr_spend WHERE reservation_id=p_id) THEN RETURN false;END IF;
 SELECT * INTO policy FROM public.candidate_source_global_policy WHERE singleton;
 t:=public.flow_candidate_source_budget_now('ocr');d:=date_trunc('day',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';m:=date_trunc('month',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 IF (SELECT count(*) FROM public.candidate_source_ocr_prices WHERE valid_from<=t AND valid_until>t)<>1 THEN RETURN false;END IF;
 SELECT * INTO price FROM public.candidate_source_ocr_prices WHERE valid_from<=t AND valid_until>t;
 SELECT coalesce(sum(charged_micro) FILTER(WHERE created_at>=d),0),coalesce(sum(charged_micro),0),coalesce(sum(pages) FILTER(WHERE user_id=p_user AND created_at>=d),0)
 INTO gd,gm,cp FROM public.candidate_source_ocr_spend WHERE created_at>=m;
 amount:=p_pages::numeric*price.micro_per_page;
 IF gd+amount>policy.ocr_day_micro OR gm+amount>policy.ocr_month_micro OR cp+p_pages>30 THEN RETURN false;END IF;
 -- Reserve every submitted page, including uncertain/failed attempts. Successful
 -- cached reuse never calls admission; explicit new attempts do. No refunds.
 INSERT INTO public.candidate_source_ocr_spend VALUES(p_id,p_user,price.version,p_pages,amount,t);
 PERFORM public.flow_candidate_source_budget_emit('ocr:day:'||d,NULL,'ocr','global_daily_usd',gd+amount,policy.ocr_day_micro);
 PERFORM public.flow_candidate_source_budget_emit('ocr:month:'||m,NULL,'ocr','global_monthly_usd',gm+amount,policy.ocr_month_micro);
 PERFORM public.flow_candidate_source_budget_emit('ocr:pages:'||p_user||':'||d,p_user,'ocr','candidate_daily_pages',cp+p_pages,30);
 RETURN true;
END $$;

-- Capture warnings transactionally, not by a poll that could miss a reservation
-- refunded below 80%. Scope identifiers never leave the database in notifications.
CREATE FUNCTION public.flow_candidate_source_budget_observe() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE d timestamptz;m timestamptz;p public.candidate_source_ai_policy%ROWTYPE;r record;u integer;t timestamptz;
BEGIN
 IF TG_TABLE_NAME='candidate_source_ai_spend' THEN
  IF NEW.settled AND (NEW.actual_input>NEW.reserved_input OR NEW.actual_output>NEW.reserved_output) THEN
   PERFORM public.flow_candidate_source_budget_emit('ai:overrun:'||NEW.reservation_id,NEW.user_id,'ai','shutdown_overrun',1,1);
  END IF;
  u:=NEW.user_id;t:=NEW.created_at;d:=date_trunc('day',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';m:=date_trunc('month',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  SELECT * INTO p FROM public.candidate_source_ai_policy WHERE singleton;
  FOR r IN SELECT 'global_daily_usd' metric,coalesce(sum(charged_micro) FILTER(WHERE created_at>=d),0) used,p.global_day_micro cap,d win,NULL::integer uid FROM public.candidate_source_ai_spend WHERE created_at>=m
   UNION ALL SELECT 'global_monthly_usd',coalesce(sum(charged_micro),0),p.global_month_micro,m,NULL::integer FROM public.candidate_source_ai_spend WHERE created_at>=m
   UNION ALL SELECT 'candidate_daily_usd',coalesce(sum(charged_micro) FILTER(WHERE created_at>=d),0),p.candidate_day_micro,d,u FROM public.candidate_source_ai_spend WHERE user_id=u AND created_at>=m
   UNION ALL SELECT 'candidate_monthly_usd',coalesce(sum(charged_micro),0),p.candidate_month_micro,m,u FROM public.candidate_source_ai_spend WHERE user_id=u AND created_at>=m
   UNION ALL SELECT 'candidate_daily_calls',count(*),p.candidate_day_calls,d,u FROM public.candidate_source_ai_spend WHERE user_id=u AND created_at>=d
  LOOP
   PERFORM public.flow_candidate_source_budget_emit('ai:'||r.metric||':'||coalesce(r.uid::text,'global')||':'||r.win,r.uid,'ai',r.metric,r.used,r.cap);
  END LOOP;
 ELSIF TG_TABLE_NAME='candidate_source_lookups' THEN
  FOR r IN SELECT w.window_id,w.period,w.credit_limit,coalesce(sum(coalesce(l.charged_credits,l.reserved_credits)),0) used
   FROM public.candidate_source_lookup_budgets w LEFT JOIN public.candidate_source_lookups l ON (w.window_id=l.day_window OR w.window_id=l.month_window)
   WHERE w.window_id IN(NEW.day_window,NEW.month_window) GROUP BY w.window_id
  LOOP PERFORM public.flow_candidate_source_budget_emit('rc:'||r.window_id,NULL,'rc','global_'||r.period||'_credits',r.used,r.credit_limit);END LOOP;
  SELECT coalesce(sum(coalesce(charged_credits,reserved_credits)),0) used INTO r FROM public.candidate_source_lookups WHERE user_id=NEW.user_id;
  PERFORM public.flow_candidate_source_budget_emit('rc:lifetime:'||NEW.user_id,NEW.user_id,'rc','candidate_lifetime_credits',r.used,3);
 ELSIF TG_TABLE_NAME='candidate_source_interpretations' THEN
  IF NEW.reason='budget_breach' AND NEW.state='held' THEN
   PERFORM public.flow_candidate_source_budget_emit('ai:incident:'||NEW.reservation_id,NEW.user_id,'ai','shutdown_overrun',1,1);
  END IF;
 ELSIF TG_TABLE_NAME='candidate_source_ai_policy' THEN
  IF OLD.enabled AND NOT NEW.enabled THEN
   PERFORM public.flow_candidate_source_budget_emit('ai:shutdown:'||gen_random_uuid(),NULL,'ai','shutdown_review_required',1,1);
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER shared_budget_warning AFTER INSERT OR UPDATE OF charged_micro ON public.candidate_source_ai_spend FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_budget_observe();
CREATE TRIGGER rc_budget_warning AFTER INSERT OR UPDATE OF charged_credits ON public.candidate_source_lookups FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_budget_observe();
CREATE TRIGGER ai_incident_warning AFTER INSERT OR UPDATE OF state,reason ON public.candidate_source_interpretations FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_budget_observe();
CREATE TRIGGER ai_shutdown_warning AFTER UPDATE OF enabled ON public.candidate_source_ai_policy FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_budget_observe();

CREATE FUNCTION public.flow_candidate_source_budget_alert_claim() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a public.candidate_source_budget_alerts%ROWTYPE;token uuid:=gen_random_uuid();BEGIN
 SELECT * INTO a FROM public.candidate_source_budget_alerts WHERE delivered_at IS NULL AND next_attempt_at<=clock_timestamp()
 AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY created_at,alert_id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 UPDATE public.candidate_source_budget_alerts SET lease_token=token,lease_until=clock_timestamp()+interval '2 minutes' WHERE alert_id=a.alert_id;
 RETURN jsonb_build_object('id',a.alert_id,'token',token,'feature',a.feature,'metric',a.metric,'used',a.used::text,'cap',a.cap::text);
END $$;
CREATE FUNCTION public.flow_candidate_source_budget_alert_finish(p_id uuid,p_token uuid,p_sent boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 UPDATE public.candidate_source_budget_alerts SET delivered_at=CASE WHEN p_sent THEN clock_timestamp() ELSE NULL END,
 lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+interval '5 minutes'
 WHERE alert_id=p_id AND lease_token=p_token AND lease_until>clock_timestamp() AND delivered_at IS NULL;
 RETURN FOUND;
END $$;

DO $$ DECLARE s text;o text;n text;BEGIN
 SELECT pg_get_functiondef('public.flow_candidate_source_lookup_admit(bigint,integer,jsonb)'::regprocedure) INTO s;
 o:=' IF (SELECT count(*) FROM public.candidate_source_lookup_budgets WHERE starts_at<=budget_now';
 n:=' PERFORM public.flow_candidate_source_budget_windows_sync(''lookup'');'||E'\n'||o;
 IF array_length(string_to_array(s,o),1)<>2 THEN RAISE EXCEPTION 'rc_windows_anchor_drift';END IF;EXECUTE replace(s,o,n);
 SELECT pg_get_functiondef('public.flow_candidate_source_paid_reserve(jsonb)'::regprocedure) INTO s;
 o:=' IF kind_value=''ocr'' THEN'||E'\n'||' IF (SELECT count(*) FROM public.candidate_source_budget_windows';
 n:=' IF kind_value=''ocr'' THEN'||E'\n'||' PERFORM public.flow_candidate_source_budget_windows_sync(''ocr'');'||E'\n'||' IF (SELECT count(*) FROM public.candidate_source_budget_windows';
 IF array_length(string_to_array(s,o),1)<>2 THEN RAISE EXCEPTION 'ocr_windows_anchor_drift';END IF;EXECUTE replace(s,o,n);
 SELECT pg_get_functiondef('public.flow_candidate_source_lookup_dispatch(bigint,integer,uuid)'::regprocedure) INTO s;
 o:=' UPDATE public.candidate_source_lookups SET state=''running'',dispatch_id=gen_random_uuid()';
 n:=' IF EXISTS(SELECT 1 FROM public.candidate_source_lookup_budgets w WHERE w.window_id IN(j.day_window,j.month_window) AND (SELECT coalesce(sum(coalesce(l.charged_credits,l.reserved_credits)),0) FROM public.candidate_source_lookups l WHERE l.day_window=w.window_id OR l.month_window=w.window_id)>w.credit_limit) THEN RETURN NULL;END IF;'||E'\n'||o;
 IF array_length(string_to_array(s,o),1)<>2 THEN RAISE EXCEPTION 'rc_lowering_anchor_drift';END IF;EXECUTE replace(s,o,n);
 SELECT pg_get_functiondef('public.flow_candidate_source_paid_dispatch(jsonb)'::regprocedure) INTO s;
 o:=' g:=jsonb_build_object(''reservationId'',op.reservation_id';
 n:=' IF op.kind=''ocr'' AND NOT public.flow_candidate_source_ocr_admit(op.reservation_id,(claim->''actor''->>''userId'')::integer,(op.identity->''limit''->>''pageCount'')::bigint) THEN RETURN jsonb_build_object(''state'',''refused'',''reason'',''budget_unavailable''); END IF;'||E'\n'||o;
 IF array_length(string_to_array(s,o),1)<>2 THEN RAISE EXCEPTION 'ocr_dispatch_anchor_drift';END IF;EXECUTE replace(s,o,n);
 SELECT pg_get_functiondef('public.flow_candidate_source_erasure_finish(uuid,uuid,uuid)'::regprocedure) INTO s;
 o:=' UPDATE public.candidate_source_erasures SET stage=''network_erased_files_pending''';
 n:=E' PERFORM pg_advisory_xact_lock(41944,6);\n UPDATE public.candidate_source_ocr_spend SET user_id=NULL,reservation_id=gen_random_uuid() WHERE user_id=e.user_id;\n UPDATE public.candidate_source_budget_alerts SET user_id=NULL,dedupe_key=gen_random_uuid()::text WHERE user_id=e.user_id;\n'||o;
 IF array_length(string_to_array(s,o),1)<>2 THEN RAISE EXCEPTION 'ops_erasure_anchor_drift';END IF;EXECUTE replace(s,o,n);
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_global_configure(jsonb,text),public.flow_candidate_source_budget_emit(text,integer,text,text,numeric,numeric),
 public.flow_candidate_source_budget_windows_sync(text),
 public.flow_candidate_source_ocr_admit(uuid,integer,bigint),public.flow_candidate_source_budget_observe(),
 public.flow_candidate_source_budget_alert_claim(),public.flow_candidate_source_budget_alert_finish(uuid,uuid,boolean) FROM PUBLIC;
