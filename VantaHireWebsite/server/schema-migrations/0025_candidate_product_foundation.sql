-- Candidate S1 foundation. Dark identity setup only; never an effective consent grant.
-- Empty-profile foundation; capture and delivery remain separately feature-gated.
CREATE UNIQUE INDEX candidate_consent_subject_user_identity ON public.candidate_consent_subjects(subject_id,user_id);
CREATE TABLE public.candidate_product_accounts (
 user_id integer PRIMARY KEY REFERENCES public.users(id),
 subject_id uuid NOT NULL UNIQUE,
 binding_id uuid NOT NULL UNIQUE,
 command_sequence bigint NOT NULL DEFAULT 0,
 acknowledged_sequence bigint NOT NULL DEFAULT 0,
 foundation_state text NOT NULL DEFAULT 'pending' CHECK(foundation_state IN ('pending','linked','held')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(0<=acknowledged_sequence AND acknowledged_sequence<=command_sequence AND command_sequence<=9007199254740991),
 FOREIGN KEY(subject_id,user_id) REFERENCES public.candidate_consent_subjects(subject_id,user_id),
 UNIQUE(subject_id,user_id,binding_id)
);
CREATE TABLE public.candidate_product_commands (
 command_id uuid PRIMARY KEY, subject_id uuid NOT NULL,user_id integer NOT NULL,binding_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991),idempotency_key uuid NOT NULL,
 action text NOT NULL CHECK(action='ensure_subject'),request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
 wire_sha256 text NOT NULL CHECK(wire_sha256 ~ '^[0-9a-f]{64}$'),wire_body bytea NOT NULL CHECK(octet_length(wire_body) BETWEEN 1 AND 4096),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','acknowledged','held')),
 safe_reason text CHECK(safe_reason IN ('identity_changed','remote_conflict','remote_denied','retry_exhausted','invalid_response')),
 admitted_auth_version integer NOT NULL CHECK(admitted_auth_version>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),acknowledged_at timestamptz,
 CHECK((state='acknowledged')=(acknowledged_at IS NOT NULL)),
 FOREIGN KEY(subject_id,user_id,binding_id) REFERENCES public.candidate_product_accounts(subject_id,user_id,binding_id),
 UNIQUE(subject_id,idempotency_key),UNIQUE(subject_id,sequence),UNIQUE(command_id,subject_id,sequence,wire_sha256)
);
CREATE TABLE public.candidate_product_outbox (
 command_id uuid PRIMARY KEY REFERENCES public.candidate_product_commands(command_id),destination text NOT NULL DEFAULT 'memory' CHECK(destination='memory'),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','leased','retry','acknowledged','held')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 12),
 lease_token uuid,lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation BETWEEN 0 AND 9007199254740991),lease_expires_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_reason text CHECK(last_reason IN ('timeout','network','remote_retry','remote_conflict','remote_denied','invalid_response','identity_changed','retry_exhausted')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(((state='leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
 OR (state<>'leased' AND lease_token IS NULL AND lease_expires_at IS NULL)) IS TRUE)
);
CREATE INDEX candidate_product_delivery_due ON public.candidate_product_outbox(next_attempt_at,command_id) WHERE state IN ('queued','retry');
CREATE INDEX candidate_product_delivery_expiry ON public.candidate_product_outbox(lease_expires_at) WHERE state='leased';

CREATE FUNCTION public.flow_candidate_foundation_command_immutable() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['state','safe_reason','acknowledged_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','safe_reason','acknowledged_at'])
 OR (OLD.state IN ('acknowledged','held') AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'candidate_command_immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
 
CREATE TRIGGER candidate_product_command_immutable BEFORE UPDATE ON public.candidate_product_commands
FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_foundation_command_immutable();

CREATE FUNCTION public.flow_candidate_foundation_ensure(p_user integer,p_auth integer,p_password text,p_recent timestamptz,p_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' SET statement_timeout='10s' AS $$
DECLARE u public.users%ROWTYPE; a public.candidate_product_accounts%ROWTYPE;
 c public.candidate_product_commands%ROWTYPE; sid uuid; cid uuid; seq bigint; body bytea; digest text;
BEGIN
 IF p_user IS NULL OR p_key IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(41943,p_user);
 SELECT * INTO u FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR u.role<>'candidate' OR u.email_verified IS NOT TRUE OR u.auth_version IS DISTINCT FROM p_auth
 OR encode(sha256(convert_to(u.password,'UTF8')),'hex') IS DISTINCT FROM p_password
 OR p_recent IS NULL OR p_recent>clock_timestamp() OR p_recent<clock_timestamp()-interval '10 minutes'
 THEN RAISE EXCEPTION 'identity_changed' USING ERRCODE='42501'; END IF;
 SELECT subject_id INTO sid FROM public.candidate_consent_subjects WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN
   sid:=gen_random_uuid();
   INSERT INTO public.candidate_consent_subjects(subject_id,user_id,created_at,updated_at) VALUES(sid,p_user,clock_timestamp(),clock_timestamp());
 END IF;
 INSERT INTO public.candidate_product_accounts(user_id,subject_id,binding_id) VALUES(p_user,sid,gen_random_uuid()) ON CONFLICT(user_id) DO NOTHING;
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=p_user FOR UPDATE;
 IF a.subject_id<>sid THEN RAISE EXCEPTION 'identity_changed' USING ERRCODE='42501'; END IF;
 digest:=encode(sha256(convert_to('{"schemaVersion":1,"idempotencyKey":"'||p_key::text||'"}','UTF8')),'hex');
 SELECT * INTO c FROM public.candidate_product_commands WHERE subject_id=sid AND idempotency_key=p_key;
 IF FOUND THEN
   IF c.request_sha256<>digest THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
   RETURN jsonb_build_object('schemaVersion',1,'commandId',c.command_id,'status',c.state,'publicationActive',false);
 END IF;
 IF a.command_sequence>=9007199254740991 THEN RAISE EXCEPTION 'sequence_exhausted' USING ERRCODE='22023'; END IF;
 seq:=a.command_sequence+1;cid:=gen_random_uuid();
 body:=convert_to('{"schemaVersion":1,"commandId":"'||cid::text||'","subjectId":"'||sid::text||'","bindingId":"'||a.binding_id::text||'","sequence":'||seq::text||',"action":"ensure_subject"}','UTF8');
 INSERT INTO public.candidate_product_commands(command_id,subject_id,user_id,binding_id,sequence,idempotency_key,action,request_sha256,wire_sha256,wire_body,admitted_auth_version)
 VALUES(cid,sid,p_user,a.binding_id,seq,p_key,'ensure_subject',digest,encode(sha256(body),'hex'),body,p_auth);
 INSERT INTO public.candidate_product_outbox(command_id) VALUES(cid);
 UPDATE public.candidate_product_accounts SET command_sequence=seq,
 foundation_state=CASE WHEN acknowledged_sequence>0 THEN 'linked' ELSE 'pending' END,updated_at=clock_timestamp() WHERE user_id=p_user;
 RETURN jsonb_build_object('schemaVersion',1,'commandId',cid,'status','pending','publicationActive',false);
END $$;

CREATE FUNCTION public.flow_candidate_foundation_read(p_user integer,p_auth integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' SET statement_timeout='10s' AS $$
DECLARE state text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND role='candidate' AND email_verified=true AND auth_version=p_auth)
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 SELECT foundation_state INTO state FROM public.candidate_product_accounts WHERE user_id=p_user;
 RETURN jsonb_build_object('schemaVersion',1,'state',coalesce(state,'not_started'),'profileVersion',0,'preferenceVersion',0,'publicationActive',false);
END $$;
CREATE FUNCTION public.flow_candidate_foundation_command_read(p_user integer,p_auth integer,p_command uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' SET statement_timeout='10s' AS $$
DECLARE c public.candidate_product_commands%ROWTYPE;
BEGIN
 PERFORM public.flow_candidate_foundation_read(p_user,p_auth);
 SELECT * INTO c FROM public.candidate_product_commands WHERE command_id=p_command AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'commandId',c.command_id,'status',c.state,'reason',c.safe_reason,'publicationActive',false);
END $$;

CREATE FUNCTION public.flow_candidate_foundation_claim_delivery(p_worker uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' SET statement_timeout='10s' AS $$
DECLARE hint record; u public.users%ROWTYPE;a public.candidate_product_accounts%ROWTYPE;
 o public.candidate_product_outbox%ROWTYPE;c public.candidate_product_commands%ROWTYPE; why text;
BEGIN
 IF p_worker IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 FOR hint IN SELECT d.command_id,d.user_id FROM public.candidate_product_commands d
 JOIN public.candidate_product_outbox b USING(command_id)
 WHERE (b.state IN ('queued','retry') AND b.next_attempt_at<=clock_timestamp()) OR (b.state='leased' AND b.lease_expires_at<=clock_timestamp())
 ORDER BY b.next_attempt_at,d.command_id LIMIT 100 LOOP
  IF NOT pg_try_advisory_xact_lock(41943,hint.user_id) THEN CONTINUE; END IF;
  SELECT * INTO u FROM public.users WHERE id=hint.user_id FOR UPDATE;
  SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=hint.user_id FOR UPDATE;
  SELECT * INTO o FROM public.candidate_product_outbox WHERE command_id=hint.command_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND OR NOT ((o.state IN ('queued','retry') AND o.next_attempt_at<=clock_timestamp()) OR (o.state='leased' AND o.lease_expires_at<=clock_timestamp())) THEN CONTINUE; END IF;
  SELECT * INTO c FROM public.candidate_product_commands WHERE command_id=hint.command_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.candidate_product_commands d JOIN public.candidate_product_outbox b USING(command_id)
    WHERE d.subject_id=c.subject_id AND d.sequence<c.sequence AND b.state NOT IN ('held','acknowledged')) THEN CONTINUE; END IF;
  why:=NULL;
  IF u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS NOT TRUE OR u.auth_version IS DISTINCT FROM c.admitted_auth_version THEN why:='identity_changed';
  ELSIF o.attempts>=12 OR o.lease_generation>=9007199254740991 THEN why:='retry_exhausted'; END IF;
  IF why IS NOT NULL THEN
    UPDATE public.candidate_product_outbox SET state='held',last_reason=why,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE command_id=c.command_id;
    UPDATE public.candidate_product_commands SET state='held',safe_reason=why WHERE command_id=c.command_id;
    UPDATE public.candidate_product_accounts SET foundation_state=CASE WHEN acknowledged_sequence>0 THEN 'linked'
      WHEN EXISTS(SELECT 1 FROM public.candidate_product_commands WHERE subject_id=a.subject_id AND state='pending') THEN 'pending' ELSE 'held' END,
      updated_at=clock_timestamp() WHERE user_id=a.user_id;
    CONTINUE;
  END IF;
  UPDATE public.candidate_product_outbox SET state='leased',attempts=attempts+1,lease_generation=lease_generation+1,
    lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '60 seconds',updated_at=clock_timestamp()
    WHERE command_id=c.command_id RETURNING * INTO o;
  RETURN jsonb_build_object('commandId',c.command_id,'subjectId',c.subject_id,'bindingId',c.binding_id,'userId',c.user_id,
    'sequence',c.sequence,'wireBody',convert_from(c.wire_body,'UTF8'),'wireSha256',c.wire_sha256,
    'leaseToken',o.lease_token,'leaseGeneration',o.lease_generation);
 END LOOP;
 RETURN NULL;
END $$;

CREATE FUNCTION public.flow_candidate_foundation_finish_delivery(p_command uuid,p_token uuid,p_generation bigint,p_outcome text,p_ack jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' SET statement_timeout='10s' AS $$
DECLARE uid integer;u public.users%ROWTYPE;a public.candidate_product_accounts%ROWTYPE;
 c public.candidate_product_commands%ROWTYPE;o public.candidate_product_outbox%ROWTYPE;
 expected jsonb;why text;delay_seconds integer; retry_after integer;
BEGIN
 SELECT user_id INTO uid FROM public.candidate_product_commands WHERE command_id=p_command;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false); END IF;
 PERFORM pg_advisory_xact_lock(41943,uid);
 SELECT * INTO u FROM public.users WHERE id=uid FOR UPDATE;
 SELECT * INTO a FROM public.candidate_product_accounts WHERE user_id=uid FOR UPDATE;
 SELECT * INTO o FROM public.candidate_product_outbox WHERE command_id=p_command FOR UPDATE;
 IF o.state<>'leased' OR o.lease_token IS DISTINCT FROM p_token OR o.lease_generation IS DISTINCT FROM p_generation OR o.lease_expires_at<=clock_timestamp()
 THEN RETURN jsonb_build_object('applied',false); END IF;
 SELECT * INTO c FROM public.candidate_product_commands WHERE command_id=p_command FOR UPDATE;
 expected:=jsonb_build_object('schemaVersion',1,'commandId',c.command_id,'subjectId',c.subject_id,'bindingId',c.binding_id,
 'sequence',c.sequence,'wireSha256',c.wire_sha256,'outcome','subject_ready','profileVersion',0,'preferenceVersion',0,'publicationActive',false);
 IF u.role IS DISTINCT FROM 'candidate' OR u.email_verified IS NOT TRUE OR u.auth_version IS DISTINCT FROM c.admitted_auth_version THEN why:='identity_changed';
 ELSIF p_outcome='acknowledged' THEN
   IF p_ack IS DISTINCT FROM expected THEN why:='invalid_response'; END IF;
 ELSIF p_outcome IN ('remote_denied','remote_conflict','invalid_response','identity_changed') THEN why:=p_outcome;
 ELSIF p_outcome IN ('timeout','network','remote_retry') THEN
   IF p_ack IS NULL OR jsonb_typeof(p_ack)<>'object' OR p_ack-ARRAY['retryAfterSeconds']<>'{}'::jsonb
     OR (p_ack ? 'retryAfterSeconds' AND (jsonb_typeof(p_ack->'retryAfterSeconds') IS DISTINCT FROM 'number'
       OR (p_ack->>'retryAfterSeconds') !~ '^[0-9]{1,9}$'))
   THEN why:='invalid_response';
   ELSE retry_after:=coalesce((p_ack->>'retryAfterSeconds')::integer,0);
    IF o.attempts>=12 OR retry_after>86400 THEN why:='retry_exhausted'; END IF;
   END IF;
 ELSE why:='invalid_response'; END IF;
 IF why IS NOT NULL THEN
   UPDATE public.candidate_product_commands SET state='held',safe_reason=why WHERE command_id=p_command;
   UPDATE public.candidate_product_outbox SET state='held',last_reason=why,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE command_id=p_command;
 ELSIF p_outcome='acknowledged' THEN
   UPDATE public.candidate_product_commands SET state='acknowledged',acknowledged_at=clock_timestamp() WHERE command_id=p_command;
   UPDATE public.candidate_product_outbox SET state='acknowledged',last_reason=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE command_id=p_command;
   UPDATE public.candidate_product_accounts SET acknowledged_sequence=greatest(acknowledged_sequence,c.sequence) WHERE user_id=uid;
 ELSE
   delay_seconds:=greatest((ARRAY[5,30,120,600,1800,3600,3600,3600,3600,3600,3600,3600])[o.attempts],retry_after);
   UPDATE public.candidate_product_outbox SET state='retry',last_reason=p_outcome,lease_token=NULL,lease_expires_at=NULL,
    next_attempt_at=clock_timestamp()+make_interval(secs=>delay_seconds),updated_at=clock_timestamp() WHERE command_id=p_command;
 END IF;
 UPDATE public.candidate_product_accounts SET foundation_state=CASE WHEN acknowledged_sequence>0 THEN 'linked'
 WHEN EXISTS(SELECT 1 FROM public.candidate_product_commands WHERE subject_id=a.subject_id AND state='pending') THEN 'pending' ELSE 'held' END,
 updated_at=clock_timestamp() WHERE user_id=uid;
 RETURN jsonb_build_object('applied',true);
END $$;

-- New authority is owner-only until the separately reviewed runtime provisioner grants EXECUTE.
DO $$ DECLARE tab text;fn record;BEGIN
 FOREACH tab IN ARRAY ARRAY['candidate_product_accounts','candidate_product_commands','candidate_product_outbox'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY foundation_owner ON public.%I TO %I USING(true) WITH CHECK(true)',tab,current_user);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',tab);
 END LOOP;
 FOR fn IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'flow_candidate_foundation_%' LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',fn.sig);
 END LOOP;
END $$;

CREATE TABLE public.candidate_network_intents (
 intent_id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('guest','signup')),
 application_id integer REFERENCES public.applications(id) ON DELETE SET NULL,
 signup_user_id integer REFERENCES public.users(id),
 copy_version integer NOT NULL CHECK(copy_version>0),
 copy_sha256 text NOT NULL CHECK(copy_sha256 ~ '^[0-9a-f]{64}$'),
 purposes jsonb NOT NULL CHECK(purposes='["matching","enrichment","recruiter_visibility","recruiter_job_email"]'::jsonb),
 identity_email_sha256 text CHECK(identity_email_sha256 ~ '^[0-9a-f]{64}$'),
 captured_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','expired','cancelled')),
 claimed_subject_id uuid REFERENCES public.candidate_product_accounts(subject_id), claimed_at timestamptz,
 request_id uuid, request_sha256 text CHECK(request_sha256 ~ '^[0-9a-f]{64}$'),
 cancelled_at timestamptz, cancellation_reason text CHECK(cancellation_reason='application_deleted'),
 CHECK(expires_at=captured_at+interval '7 days'),
 CHECK(((state='claimed' AND claimed_subject_id IS NOT NULL AND claimed_at IS NOT NULL)
 OR (state<>'claimed' AND claimed_subject_id IS NULL AND claimed_at IS NULL)) IS TRUE),
 CHECK((
  (kind='guest' AND state='cancelled' AND application_id IS NULL AND signup_user_id IS NULL
   AND identity_email_sha256 IS NULL AND request_id IS NULL AND request_sha256 IS NULL
   AND cancelled_at IS NOT NULL AND cancellation_reason='application_deleted')
  OR (state<>'cancelled' AND cancelled_at IS NULL AND cancellation_reason IS NULL
   AND identity_email_sha256 IS NOT NULL AND request_id IS NOT NULL AND request_sha256 IS NOT NULL
   AND ((kind='guest' AND application_id IS NOT NULL AND signup_user_id IS NULL)
     OR (kind='signup' AND signup_user_id IS NOT NULL AND application_id IS NULL)))
 ) IS TRUE),
 UNIQUE(kind,request_id)
);
CREATE UNIQUE INDEX intent_guest_unique ON public.candidate_network_intents(application_id) WHERE kind='guest';
CREATE UNIQUE INDEX intent_signup_unique ON public.candidate_network_intents(signup_user_id) WHERE kind='signup';
CREATE INDEX intent_expiry ON public.candidate_network_intents(expires_at,intent_id) WHERE state='pending';
ALTER TABLE public.candidate_network_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_network_intents FORCE ROW LEVEL SECURITY;
DO $$ BEGIN EXECUTE format('CREATE POLICY foundation_owner ON public.candidate_network_intents TO %I USING(true) WITH CHECK(true)',current_user); END $$;

CREATE FUNCTION public.flow_candidate_foundation_application_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 UPDATE public.candidate_network_intents SET application_id=NULL,identity_email_sha256=NULL,
 request_id=NULL,request_sha256=NULL,claimed_subject_id=NULL,claimed_at=NULL,state='cancelled',
 cancelled_at=clock_timestamp(),cancellation_reason='application_deleted'
 WHERE application_id=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER candidate_foundation_application_delete BEFORE DELETE ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_foundation_application_delete();

CREATE FUNCTION public.flow_candidate_foundation_claim_intent(p_user integer,p_auth integer,p_password text,p_recent timestamptz,p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' SET statement_timeout='10s' AS $$
DECLARE u public.users%ROWTYPE; i public.candidate_network_intents%ROWTYPE;
 app public.applications%ROWTYPE; subject uuid; hint integer;
BEGIN
 PERFORM pg_advisory_xact_lock(41943,p_user);
 SELECT * INTO u FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR u.role<>'candidate' OR u.email_verified IS NOT TRUE OR u.auth_version IS DISTINCT FROM p_auth
 OR encode(sha256(convert_to(u.password,'UTF8')),'hex') IS DISTINCT FROM p_password
 OR p_recent IS NULL OR p_recent>clock_timestamp() OR p_recent<clock_timestamp()-interval '10 minutes'
 THEN RAISE EXCEPTION 'identity_changed' USING ERRCODE='42501'; END IF;
 SELECT subject_id INTO subject FROM public.candidate_product_accounts WHERE user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 SELECT application_id INTO hint FROM public.candidate_network_intents WHERE intent_id=p_intent;
 IF hint IS NOT NULL THEN
  SELECT * INTO app FROM public.applications WHERE id=hint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 END IF;
 SELECT * INTO i FROM public.candidate_network_intents WHERE intent_id=p_intent FOR UPDATE;
 IF NOT FOUND OR i.state IN ('cancelled','expired') THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 IF (i.kind='guest' AND (hint IS NULL OR i.application_id IS DISTINCT FROM hint OR app.user_id IS DISTINCT FROM p_user))
 OR (i.kind='signup' AND i.signup_user_id IS DISTINCT FROM p_user)
 OR i.identity_email_sha256 IS DISTINCT FROM encode(sha256(convert_to(lower(btrim(u.username)),'UTF8')),'hex')
 OR (i.state='claimed' AND i.claimed_subject_id IS DISTINCT FROM subject)
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 -- Lifecycle details belong only to the verified owner, never an ID probe.
 IF i.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'intent_expired' USING ERRCODE='22023'; END IF;
 IF i.state='pending' THEN UPDATE public.candidate_network_intents SET state='claimed',claimed_subject_id=subject,claimed_at=clock_timestamp() WHERE intent_id=p_intent; END IF;
 RETURN jsonb_build_object('schemaVersion',1,'status','claimed','requiresConfirmation',true,'publicationActive',false);
END $$;
REVOKE ALL ON public.candidate_network_intents FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_foundation_application_delete(),public.flow_candidate_foundation_claim_intent(integer,integer,text,timestamptz,uuid) FROM PUBLIC;

CREATE FUNCTION public.flow_candidate_foundation_intent(p_kind text,p_id integer,p_request uuid,p_version integer,p_hash text,p_purposes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' SET statement_timeout='10s' AS $$
DECLARE email text;prior public.candidate_network_intents%ROWTYPE; payload_hash text; at_time timestamptz:=clock_timestamp();
BEGIN
 -- Only synthetic copy exists in S1; the application gate prohibits public capture.
 IF p_kind IS NULL OR p_kind NOT IN ('guest','signup') OR p_id IS NULL OR p_id<=0 OR p_request IS NULL
 OR p_version IS DISTINCT FROM 1 OR p_hash IS DISTINCT FROM encode(sha256(convert_to('S1 synthetic intent fixture; not approved public consent copy.','UTF8')),'hex')
 OR p_purposes IS DISTINCT FROM '["matching","enrichment","recruiter_visibility","recruiter_job_email"]'::jsonb
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023'; END IF;
 IF p_kind='guest' THEN SELECT a.email INTO email FROM public.applications a WHERE id=p_id FOR UPDATE;
 ELSE SELECT username INTO email FROM public.users WHERE id=p_id AND role='candidate' FOR UPDATE; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 email:=lower(btrim(email));
 payload_hash:=encode(sha256(convert_to(jsonb_build_array(p_kind,p_id,p_version,p_hash,p_purposes)::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.candidate_network_intents WHERE kind=p_kind AND request_id=p_request;
 IF FOUND THEN
   IF prior.request_sha256<>payload_hash THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505'; END IF;
   RETURN jsonb_build_object('recorded',true);
 END IF;
 INSERT INTO public.candidate_network_intents(intent_id,kind,application_id,signup_user_id,copy_version,copy_sha256,purposes,identity_email_sha256,
 captured_at,expires_at,request_id,request_sha256)
 VALUES(gen_random_uuid(),p_kind,CASE WHEN p_kind='guest' THEN p_id END,CASE WHEN p_kind='signup' THEN p_id END,p_version,p_hash,p_purposes,
 encode(sha256(convert_to(email,'UTF8')),'hex'),at_time,at_time+interval '7 days',p_request,payload_hash);
 RETURN jsonb_build_object('recorded',true);
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_foundation_intent(text,integer,uuid,integer,text,jsonb) FROM PUBLIC;

-- Default privileges may already grant the runtime access to newly created objects.
-- Remove those inherited grants inside this migration, before the provisioner runs.
DO $deny$ DECLARE item record; BEGIN
 FOR item IN SELECT DISTINCT c.oid::regclass AS object_name,r.rolname FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 JOIN pg_roles r ON r.oid=a.grantee
 WHERE n.nspname='public' AND c.relname IN ('candidate_product_accounts','candidate_product_commands','candidate_product_outbox','candidate_network_intents')
 AND a.grantee<>c.relowner LOOP
  EXECUTE format('REVOKE ALL ON TABLE %s FROM %I',item.object_name,item.rolname);
 END LOOP;
 FOR item IN SELECT DISTINCT p.oid::regprocedure AS object_name,r.rolname FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 JOIN pg_roles r ON r.oid=a.grantee
 WHERE n.nspname='public' AND starts_with(p.proname,'flow_candidate_foundation_') AND a.grantee<>p.proowner LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',item.object_name,item.rolname);
 END LOOP;
END $deny$;
