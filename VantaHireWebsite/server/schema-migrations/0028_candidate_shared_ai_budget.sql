-- One monetary/call allowance for resume semantic extraction and interactive AI.
-- No prices or live enablement are installed by this migration.
CREATE TABLE public.candidate_source_ai_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,
 candidate_day_micro bigint NOT NULL CHECK(candidate_day_micro>=0),
 candidate_month_micro bigint NOT NULL CHECK(candidate_month_micro>=0),
 global_day_micro bigint NOT NULL CHECK(global_day_micro>=0),
 global_month_micro bigint NOT NULL CHECK(global_month_micro>=0),
 candidate_day_calls bigint NOT NULL CHECK(candidate_day_calls>=0)
);
INSERT INTO public.candidate_source_ai_policy VALUES(true,false,250000,2000000,10000000,100000000,10);
CREATE TABLE public.candidate_source_ai_prices (
 version text PRIMARY KEY, model text NOT NULL,
 input_micro_per_million bigint NOT NULL CHECK(input_micro_per_million>0),
 output_micro_per_million bigint NOT NULL CHECK(output_micro_per_million>0),
 valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL CHECK(valid_until>valid_from),
 evidence text NOT NULL CHECK(length(evidence)>0)
);
CREATE TABLE public.candidate_source_ai_spend (
 reservation_id uuid PRIMARY KEY,
 user_id integer,
 feature text NOT NULL CHECK(feature IN ('help','resume')),
 model text NOT NULL, price_version text NOT NULL REFERENCES public.candidate_source_ai_prices(version),
 reserved_input bigint NOT NULL CHECK(reserved_input>0), reserved_output bigint NOT NULL CHECK(reserved_output>0),
 reserved_micro numeric NOT NULL CHECK(reserved_micro>=0), charged_micro numeric NOT NULL CHECK(charged_micro>=0),
 created_at timestamptz NOT NULL,
 settled boolean NOT NULL DEFAULT false,
 actual_input bigint, actual_output bigint
);
CREATE INDEX candidate_source_ai_spend_window ON public.candidate_source_ai_spend(created_at,user_id);
CREATE TABLE public.candidate_source_ai_policy_audit (
 evidence_id uuid PRIMARY KEY, previous_policy jsonb NOT NULL, next_policy jsonb NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(), operator_role name NOT NULL DEFAULT session_user
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['candidate_source_ai_policy','candidate_source_ai_prices','candidate_source_ai_spend','candidate_source_ai_policy_audit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY owner_only ON public.%I TO %I USING(true) WITH CHECK(true)',tab,current_user);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',tab);
 END LOOP;
END $$;

-- Owner-only, audited single configuration for BOTH features. Never resets spend.
CREATE FUNCTION public.flow_candidate_source_ai_configure(p_day bigint,p_month bigint,p_global_day bigint,p_global_month bigint,p_calls bigint,p_enabled boolean,p_evidence uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE before_value jsonb; after_value jsonb; prior public.candidate_source_ai_policy_audit%ROWTYPE;
BEGIN
 IF p_evidence IS NULL OR p_enabled IS NULL OR p_day IS NULL OR p_month IS NULL OR p_global_day IS NULL OR p_global_month IS NULL OR p_calls IS NULL
 OR least(p_day,p_month,p_global_day,p_global_month,p_calls)<0
 OR p_day>p_month OR p_global_day>p_global_month OR p_day>p_global_day OR p_month>p_global_month
 THEN RAISE EXCEPTION 'invalid_budget_policy' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(41944,5);
 after_value:=jsonb_build_object('singleton',true,'enabled',p_enabled,'candidate_day_micro',p_day,'candidate_month_micro',p_month,
  'global_day_micro',p_global_day,'global_month_micro',p_global_month,'candidate_day_calls',p_calls);
 SELECT * INTO prior FROM public.candidate_source_ai_policy_audit WHERE evidence_id=p_evidence;
 IF FOUND THEN
  IF prior.next_policy<>after_value THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
  RETURN;
 END IF;
 SELECT to_jsonb(p) INTO before_value FROM public.candidate_source_ai_policy p WHERE singleton FOR UPDATE;
 UPDATE public.candidate_source_ai_policy SET enabled=p_enabled,candidate_day_micro=p_day,candidate_month_micro=p_month,
  global_day_micro=p_global_day,global_month_micro=p_global_month,candidate_day_calls=p_calls WHERE singleton;
 INSERT INTO public.candidate_source_ai_policy_audit(evidence_id,previous_policy,next_policy) VALUES(p_evidence,before_value,after_value);
END $$;

-- Price versions are immutable; changing rates requires a new version. No retroactive repricing.
CREATE FUNCTION public.flow_candidate_source_ai_price_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 RAISE EXCEPTION 'immutable_price_version' USING ERRCODE='55000';
END $$;
CREATE TRIGGER immutable_price BEFORE UPDATE OR DELETE ON public.candidate_source_ai_prices
 FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_ai_price_immutable();

-- Called inside the existing dispatch transaction, BEFORE it authorizes a provider request.
-- Both features take the same global lock; costs and calls cannot race across features.
CREATE FUNCTION public.flow_candidate_source_ai_admit(p_id uuid,p_user integer,p_feature text,p_model text,p_input bigint,p_output bigint)
RETURNS boolean LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE policy public.candidate_source_ai_policy%ROWTYPE; price public.candidate_source_ai_prices%ROWTYPE;
 prior public.candidate_source_ai_spend%ROWTYPE; t timestamptz; day_start timestamptz; month_start timestamptz;
 amount numeric; gd numeric; gm numeric; cd numeric; cm numeric; calls bigint;
BEGIN
 IF p_id IS NULL OR p_user IS NULL OR p_feature IS NULL OR p_feature NOT IN ('help','resume') OR p_model IS NULL
 OR p_input IS NULL OR p_output IS NULL OR p_input<=0 OR p_output<=0 THEN
  RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(41944,5);
 SELECT * INTO prior FROM public.candidate_source_ai_spend WHERE reservation_id=p_id;
 IF FOUND THEN
  IF (prior.user_id,prior.feature,prior.model,prior.reserved_input,prior.reserved_output)
   IS DISTINCT FROM (p_user,p_feature,p_model,p_input,p_output) THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
  -- An existing dispatch is never permission for another provider call.
  RETURN false;
 END IF;
 SELECT * INTO policy FROM public.candidate_source_ai_policy WHERE singleton FOR SHARE;
 IF NOT FOUND OR NOT policy.enabled THEN RETURN false; END IF;
 IF public.flow_candidate_source_interpretation_blocked() THEN RETURN false; END IF;
 t:=public.flow_candidate_source_budget_now('semantic_model');
 day_start:=date_trunc('day',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 month_start:=date_trunc('month',t AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 IF (SELECT count(*) FROM public.candidate_source_ai_prices WHERE model=p_model AND valid_from<=t AND valid_until>t)<>1
 THEN RETURN false; END IF;
 SELECT * INTO price FROM public.candidate_source_ai_prices WHERE model=p_model AND valid_from<=t AND valid_until>t;
 amount:=ceil((p_input::numeric*price.input_micro_per_million+p_output::numeric*price.output_micro_per_million)/1000000);
 SELECT coalesce(sum(charged_micro) FILTER(WHERE created_at>=day_start),0),coalesce(sum(charged_micro),0),
 coalesce(sum(charged_micro) FILTER(WHERE user_id=p_user AND created_at>=day_start),0),
 coalesce(sum(charged_micro) FILTER(WHERE user_id=p_user),0),count(*) FILTER(WHERE user_id=p_user AND created_at>=day_start)
 INTO gd,gm,cd,cm,calls FROM public.candidate_source_ai_spend WHERE created_at>=month_start;
 IF gd+amount>policy.global_day_micro OR gm+amount>policy.global_month_micro
 OR cd+amount>policy.candidate_day_micro OR cm+amount>policy.candidate_month_micro
 OR calls+1>policy.candidate_day_calls THEN RETURN false; END IF;
 INSERT INTO public.candidate_source_ai_spend(reservation_id,user_id,feature,model,price_version,reserved_input,reserved_output,reserved_micro,charged_micro,created_at)
 VALUES(p_id,p_user,p_feature,p_model,price.version,p_input,p_output,amount,amount,t);
 RETURN true;
END $$;

-- Missing usage keeps the full reservation. Replays cannot subtract it twice.
CREATE FUNCTION public.flow_candidate_source_ai_settle(p_id uuid,p_input bigint,p_output bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE r public.candidate_source_ai_spend%ROWTYPE; price public.candidate_source_ai_prices%ROWTYPE; amount numeric;
BEGIN
 IF p_input IS NULL OR p_output IS NULL THEN RETURN; END IF;
 IF p_input<0 OR p_output<0 THEN RAISE EXCEPTION 'invalid_usage' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(41944,5);
 SELECT * INTO r FROM public.candidate_source_ai_spend WHERE reservation_id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'missing_ai_reservation' USING ERRCODE='55000'; END IF;
 SELECT * INTO price FROM public.candidate_source_ai_prices WHERE version=r.price_version;
 amount:=ceil((p_input::numeric*price.input_micro_per_million+p_output::numeric*price.output_micro_per_million)/1000000);
 IF r.settled THEN
  IF (r.actual_input,r.actual_output) IS DISTINCT FROM (p_input,p_output) THEN RAISE EXCEPTION 'usage_conflict' USING ERRCODE='23505'; END IF;
  RETURN;
 END IF;
 UPDATE public.candidate_source_ai_spend SET charged_micro=amount,settled=true,actual_input=p_input,actual_output=p_output WHERE reservation_id=p_id;
 -- An overrun must not permit further dispatch until an operator investigates.
 IF p_input>r.reserved_input OR p_output>r.reserved_output THEN
  UPDATE public.candidate_source_ai_policy SET enabled=false WHERE singleton;
 END IF;
END $$;

-- Preserve reviewed authority/idempotency routines. Guard every replacement against source drift.
DO $$ DECLARE source text; old text; replacement text; signature text; first_pos integer; last_pos integer; BEGIN
 -- Legacy incident review knows total tokens, not the input/output split. Retain
 -- a conservative monetary charge using the higher pinned rate; never refund.
 signature:='public.flow_candidate_source_interpretation_review(uuid,numeric,numeric,uuid)';
 SELECT pg_get_functiondef(signature::regprocedure) INTO source;
 old:=' UPDATE public.candidate_source_interpretations SET charged_tokens=p_reconciled WHERE reservation_id=p_id;';
 replacement:=E' PERFORM pg_advisory_xact_lock(41944,5);\n UPDATE public.candidate_source_ai_spend s SET charged_micro=greatest(s.charged_micro,ceil(p_reconciled*greatest(p.input_micro_per_million,p.output_micro_per_million)/1000000)) FROM public.candidate_source_ai_prices p WHERE s.reservation_id=p_id AND p.version=s.price_version;\n'||old;
 IF array_length(string_to_array(source,old),1)<>2 THEN RAISE EXCEPTION 'ai_review_anchor_drift'; END IF;
 EXECUTE replace(source,old,replacement);
 -- The monetary/call allowance replaces the two independent AI token-budget gates.
 -- OCR retains its separate page budget. A dispatch crossing UTC midnight is refused.
 signature:='public.flow_candidate_source_interpretation_reserve(integer,integer,bigint,uuid,text,text,text,bigint,bigint)';
 SELECT pg_get_functiondef(signature::regprocedure) INTO source;
 first_pos:=strpos(source,' IF (SELECT count(*) FROM public.candidate_source_interpretation_budgets');
 last_pos:=strpos(source,' INSERT INTO public.candidate_source_interpretations(');
 IF first_pos=0 OR last_pos<=first_pos THEN RAISE EXCEPTION 'ai_reserve_anchor_drift'; END IF;
 EXECUTE substr(source,1,first_pos-1)||substr(source,last_pos);

 signature:='public.flow_candidate_source_paid_reserve(jsonb)';
 SELECT pg_get_functiondef(signature::regprocedure) INTO source;
 first_pos:=strpos(source,' IF (SELECT count(*) FROM public.candidate_source_budget_windows');
 last_pos:=strpos(source,' INSERT INTO public.candidate_source_paid_operations(');
 IF first_pos=0 OR last_pos<=first_pos THEN RAISE EXCEPTION 'ai_resume_reserve_anchor_drift'; END IF;
 EXECUTE substr(source,1,first_pos-1)||E' IF kind_value=''ocr'' THEN\n'||substr(source,first_pos,last_pos-first_pos)||E' END IF;\n'||substr(source,last_pos);

 signature:='public.flow_candidate_source_interpretation_dispatch(uuid,text)';
 SELECT pg_get_functiondef(signature::regprocedure) INTO source;
 old:='OR (SELECT count(DISTINCT period) FROM public.candidate_source_interpretation_budgets'||E'\n'||' WHERE starts_at<=j.created_at AND ends_at>j.created_at AND ends_at>public.flow_candidate_source_budget_now(''semantic_model''))<>2';
 replacement:='OR (j.created_at AT TIME ZONE ''UTC'')::date<>(public.flow_candidate_source_budget_now(''semantic_model'') AT TIME ZONE ''UTC'')::date';
 IF array_length(string_to_array(source,old),1)<>2 THEN RAISE EXCEPTION 'ai_window_anchor_drift'; END IF;
 source:=replace(source,old,replacement);
 old:=' UPDATE public.candidate_source_interpretations SET state=''dispatched'' WHERE reservation_id=p_id;';
 replacement:=' IF NOT public.flow_candidate_source_ai_admit(j.reservation_id,j.user_id,''help'',j.model,j.input_tokens,j.output_tokens) THEN RETURN false; END IF;'||E'\n'||old;
 IF array_length(string_to_array(source,old),1)<>2 THEN RAISE EXCEPTION 'ai_dispatch_anchor_drift'; END IF;
 EXECUTE replace(source,old,replacement);

 signature:='public.flow_candidate_source_paid_dispatch(jsonb)';
 SELECT pg_get_functiondef(signature::regprocedure) INTO source;
 old:='IF (SELECT count(DISTINCT period) FROM public.candidate_source_budget_windows WHERE kind=op.kind'||E'\n'||' AND starts_at<=op.created_at AND ends_at>budget_now)<>2';
 replacement:='IF (op.kind=''ocr'' AND (SELECT count(DISTINCT period) FROM public.candidate_source_budget_windows WHERE kind=op.kind AND starts_at<=op.created_at AND ends_at>budget_now)<>2) OR (op.kind=''semantic_model'' AND (op.created_at AT TIME ZONE ''UTC'')::date<>(budget_now AT TIME ZONE ''UTC'')::date)';
 IF array_length(string_to_array(source,old),1)<>2 THEN RAISE EXCEPTION 'ai_resume_window_anchor_drift'; END IF;
 source:=replace(source,old,replacement);
 old:=' g:=jsonb_build_object(''reservationId'',op.reservation_id';
 replacement:=' IF op.kind=''semantic_model'' AND NOT public.flow_candidate_source_ai_admit(op.reservation_id,(claim->''actor''->>''userId'')::integer,''resume'',op.identity->''limit''->>''model'',(op.identity->''limit''->>''inputTokens'')::bigint,(op.identity->''limit''->>''maxOutputTokens'')::bigint) THEN RETURN jsonb_build_object(''state'',''refused'',''reason'',''budget_unavailable''); END IF;'||E'\n'||old;
 IF array_length(string_to_array(source,old),1)<>2 THEN RAISE EXCEPTION 'ai_resume_dispatch_anchor_drift'; END IF;
 EXECUTE replace(source,old,replacement);

 signature:='public.flow_candidate_source_interpretation_settle(uuid,text,jsonb,bigint,bigint)';
 SELECT pg_get_functiondef(signature::regprocedure) INTO source;
 old:=' IF p_input>j.input_tokens OR p_output>j.output_tokens THEN';
 replacement:=' PERFORM public.flow_candidate_source_ai_settle(p_id,p_input,p_output);'||E'\n'||old;
 IF array_length(string_to_array(source,old),1)<>2 THEN RAISE EXCEPTION 'ai_settle_anchor_drift'; END IF;
 EXECUTE replace(source,old,replacement);

 signature:='public.flow_candidate_source_paid_record(jsonb,boolean)';
 SELECT pg_get_functiondef(signature::regprocedure) INTO source;
 old:=' UPDATE public.candidate_source_paid_operations SET state=v->>''state''';
 replacement:=' IF op.kind=''semantic_model'' THEN PERFORM public.flow_candidate_source_ai_settle(op.reservation_id,(usage->>''inputTokens'')::bigint,(usage->>''outputTokens'')::bigint); END IF;'||E'\n'||old;
 IF array_length(string_to_array(source,old),1)<>2 THEN RAISE EXCEPTION 'ai_resume_settle_anchor_drift'; END IF;
 EXECUTE replace(source,old,replacement);

 signature:='public.flow_candidate_source_erasure_finish(uuid,uuid,uuid)';
 SELECT pg_get_functiondef(signature::regprocedure) INTO source;
 old:=' UPDATE public.candidate_source_erasures SET stage=''network_erased_files_pending''';
 replacement:=' PERFORM pg_advisory_xact_lock(41944,5);'||E'\n'||' UPDATE public.candidate_source_ai_spend SET user_id=NULL,reservation_id=gen_random_uuid() WHERE user_id=e.user_id;'||E'\n'||old;
 IF array_length(string_to_array(source,old),1)<>2 THEN RAISE EXCEPTION 'ai_erasure_anchor_drift'; END IF;
 EXECUTE replace(source,old,replacement);
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_ai_configure(bigint,bigint,bigint,bigint,bigint,boolean,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_source_ai_admit(uuid,integer,text,text,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_source_ai_settle(uuid,bigint,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_source_ai_price_immutable() FROM PUBLIC;
