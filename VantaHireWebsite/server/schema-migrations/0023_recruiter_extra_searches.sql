-- Extra searches never alter included allowance, seat capacity or entitlements.
DO $check$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='flow_sourcing_quote(integer,integer,integer)'::regprocedure)<>'1a93b7a794b511ab05ebd9a00034f58c'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='flow_sourcing_admit(integer,integer,integer,uuid,jsonb)'::regprocedure)<>'53165a4cc58151c33c58276730771747'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='flow_sourcing_receipt(integer,uuid,jsonb)'::regprocedure)<>'acb937bb745154c60678cee46a4e9344'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='flow_sourcing_cancel(integer,uuid,jsonb)'::regprocedure)<>'e30c6ae396fda8c32cca7fa1d8620aae'
 THEN RAISE EXCEPTION 'EXTRA_SEARCH_BASELINE_DRIFT'; END IF;
END $check$;

CREATE TABLE public.sourcing_extra_grants (
 id uuid PRIMARY KEY, organization_id integer NOT NULL REFERENCES public.organizations(id),
 recipient_user_id integer NOT NULL REFERENCES public.users(id), quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
 valid_from timestamptz NOT NULL CHECK(isfinite(valid_from)),
 valid_until timestamptz NOT NULL CHECK(isfinite(valid_until) AND valid_until>valid_from),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 operator_label text NOT NULL CHECK(length(btrim(operator_label)) BETWEEN 1 AND 160),
 database_user text NOT NULL, command_sha256 text NOT NULL CHECK(command_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(organization_id,id)
);
COMMENT ON COLUMN public.sourcing_extra_grants.operator_label IS 'Self-declared operator label; not authenticated human identity. database_user is the PostgreSQL session user.';
CREATE TABLE public.sourcing_extra_balances (
 grant_id uuid PRIMARY KEY REFERENCES public.sourcing_extra_grants(id),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
 reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0), captured integer NOT NULL DEFAULT 0 CHECK(captured>=0),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), revoked_at timestamptz,
 CHECK(reserved+captured<=quantity)
);
CREATE TABLE public.sourcing_extra_events (
 id uuid PRIMARY KEY, organization_id integer NOT NULL, grant_id uuid NOT NULL,
 admission_id uuid REFERENCES public.sourcing_admissions(id) DEFERRABLE INITIALLY DEFERRED,
 kind text NOT NULL CHECK(kind IN ('issue','revoke','reserve','capture','release')),
 command_sha256 text NOT NULL CHECK(command_sha256 ~ '^[a-f0-9]{64}$'),
 database_user text NOT NULL, operator_label text, reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,grant_id) REFERENCES public.sourcing_extra_grants(organization_id,id),
 UNIQUE(admission_id,kind), CHECK((kind IN ('issue','revoke'))=(admission_id IS NULL))
);
CREATE UNIQUE INDEX sourcing_extra_issue_once ON public.sourcing_extra_events(grant_id) WHERE kind='issue';
CREATE UNIQUE INDEX sourcing_extra_revoke_once ON public.sourcing_extra_events(grant_id) WHERE kind='revoke';
CREATE INDEX sourcing_extra_recipient ON public.sourcing_extra_grants(organization_id,recipient_user_id,valid_until,created_at,id);
CREATE TABLE public.sourcing_admission_funding (
 admission_id uuid PRIMARY KEY REFERENCES public.sourcing_admissions(id) DEFERRABLE INITIALLY DEFERRED,
 organization_id integer NOT NULL REFERENCES public.organizations(id), payer_user_id integer NOT NULL REFERENCES public.users(id),
 source text NOT NULL CHECK(source IN ('included','extra')), grant_id uuid,
 slot_id uuid NOT NULL REFERENCES public.sourcing_seat_slots(id), window_start timestamptz NOT NULL,
 CHECK((source='extra')=(grant_id IS NOT NULL)),
 FOREIGN KEY(organization_id,grant_id) REFERENCES public.sourcing_extra_grants(organization_id,id)
);
DO $acl$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['sourcing_extra_grants','sourcing_extra_balances','sourcing_extra_events','sourcing_admission_funding'] LOOP
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',n);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY src_owner ON public.%I TO %I USING (true) WITH CHECK (true)',n,current_user);
  IF n<>'sourcing_extra_balances' THEN
   EXECUTE format('CREATE TRIGGER src_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.flow_sourcing_immutable()',n);
  END IF;
 END LOOP;
END $acl$;

CREATE FUNCTION public.flow_sourcing_extra_snapshot(p_org integer,p_user integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('organizationId',p_org,'recipientUserId',p_user,
 'state',(SELECT to_jsonb(o) FROM sourcing_org_state o WHERE organization_id=p_org),
 'entitlement',(SELECT to_jsonb(e) FROM sourcing_entitlements e JOIN sourcing_org_state o ON e.id=o.entitlement_id WHERE o.organization_id=p_org),
 'slots',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM sourcing_seat_slots s WHERE s.organization_id=p_org AND s.current_user_id=p_user),'[]'::jsonb),
 'eligible',EXISTS(SELECT 1 FROM organization_members m JOIN users u ON u.id=m.user_id
 JOIN sourcing_seat_slots s ON s.organization_id=m.organization_id AND s.current_user_id=m.user_id
 JOIN sourcing_org_state o ON o.organization_id=m.organization_id
 JOIN sourcing_entitlements e ON e.id=o.entitlement_id AND e.organization_id=o.organization_id
 JOIN organization_subscriptions sub ON sub.id=e.subscription_id AND sub.organization_id=e.organization_id
 WHERE m.organization_id=p_org AND m.user_id=p_user AND m.seat_assigned AND u.role='recruiter'
 AND s.active AND s.slot_number<=o.capacity AND o.enabled
 AND e.valid_from<=clock_timestamp() AND e.valid_until>clock_timestamp() AND e.anchor=o.anchor AND e.capacity=o.capacity
 AND sub.start_date AT TIME ZONE 'UTC'=e.anchor
 AND (e.origin='explicit_grant' OR (sub.status='active' AND sub.paid_seats>=e.capacity AND sub.current_period_end AT TIME ZONE 'UTC'>clock_timestamp()))),
 'grants',coalesce((SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object('balance',to_jsonb(b)) ORDER BY g.id)
 FROM sourcing_extra_grants g JOIN sourcing_extra_balances b ON b.grant_id=g.id
 WHERE g.organization_id=p_org AND g.recipient_user_id=p_user),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.flow_sourcing_extra_snapshot(integer,integer) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_extra_manage(p_org integer,p_user integer,p_command uuid,p_body jsonb,p_expected text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE snap jsonb; h text; ev sourcing_extra_events%ROWTYPE; gid uuid; term sourcing_extra_grants%ROWTYPE;
BEGIN
 IF session_user<>pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='sourcing_extra_grants'::regclass)) THEN RAISE EXCEPTION 'SOURCING_EXTRA_OWNER_REQUIRED'; END IF;
 IF p_command IS NULL OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>4096
 OR p_body-ARRAY['action','quantity','validFrom','validUntil','operatorLabel','reason','grantId']<>'{}'::jsonb
 OR p_body->>'action' NOT IN ('issue','revoke') OR p_body->>'action' IS NULL
 OR length(btrim(coalesce(p_body->>'operatorLabel',''))) NOT BETWEEN 1 AND 160
 OR length(btrim(coalesce(p_body->>'reason',''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
 h:=encode(sha256(convert_to(jsonb_build_array(p_org,p_user,p_body)::text,'UTF8')),'hex');
 PERFORM organization_id FROM sourcing_org_state WHERE organization_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_DISABLED'; END IF;
 SELECT * INTO ev FROM sourcing_extra_events WHERE id=p_command;
 IF FOUND THEN
  IF ev.command_sha256<>h OR ev.organization_id<>p_org THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
  RETURN jsonb_build_object('grantId',ev.grant_id,'replayed',true);
 END IF;
 snap:=flow_sourcing_extra_snapshot(p_org,p_user);
 IF p_expected IS DISTINCT FROM encode(sha256(convert_to(snap::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'SOURCING_REVISION_CONFLICT'; END IF;
 IF p_body->>'action'='issue' THEN
  IF snap->>'eligible' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'SOURCING_EXTRA_RECIPIENT_INELIGIBLE'; END IF;
  IF NOT p_body ?& ARRAY['quantity','validFrom','validUntil'] OR p_body ? 'grantId'
   OR jsonb_typeof(p_body->'quantity')<>'number' OR (p_body->>'quantity') !~ '^[1-9][0-9]{0,3}$'
   OR (p_body->>'quantity')::integer>1000
   OR (p_body->>'validUntil')::timestamptz<=clock_timestamp()
   OR (p_body->>'validUntil')::timestamptz<=(p_body->>'validFrom')::timestamptz THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  gid:=p_command;
  INSERT INTO sourcing_extra_grants VALUES(gid,p_org,p_user,(p_body->>'quantity')::integer,
   (p_body->>'validFrom')::timestamptz,(p_body->>'validUntil')::timestamptz,p_body->>'reason',p_body->>'operatorLabel',session_user,h,clock_timestamp());
  INSERT INTO sourcing_extra_balances(grant_id,quantity) VALUES(gid,(p_body->>'quantity')::integer);
 ELSE
  IF NOT p_body ? 'grantId' OR p_body ?| ARRAY['quantity','validFrom','validUntil'] THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  gid:=(p_body->>'grantId')::uuid;
  SELECT * INTO term FROM sourcing_extra_grants WHERE id=gid AND organization_id=p_org AND recipient_user_id=p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_NOT_FOUND'; END IF;
  UPDATE sourcing_extra_balances SET revoked_at=clock_timestamp(),revision=revision+1 WHERE grant_id=gid AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_REVISION_CONFLICT'; END IF;
 END IF;
 INSERT INTO sourcing_extra_events(id,organization_id,grant_id,kind,command_sha256,database_user,operator_label,reason)
 VALUES(p_command,p_org,gid,CASE WHEN p_body->>'action'='issue' THEN 'issue' ELSE 'revoke' END,h,session_user,p_body->>'operatorLabel',p_body->>'reason');
 RETURN jsonb_build_object('grantId',gid,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_extra_manage(integer,integer,uuid,jsonb,text) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_funding_quote(p_org integer,p_user integer,p_slot uuid,p_window timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inc integer:=5; rev bigint:=0; extra bigint; chosen record; funding jsonb;
BEGIN
 SELECT 5-reserved-captured,revision INTO inc,rev FROM sourcing_allowance_windows WHERE organization_id=p_org AND slot_id=p_slot AND starts_at=p_window;
 inc:=coalesce(inc,5);rev:=coalesce(rev,0);
 SELECT coalesce(sum(b.quantity-b.reserved-b.captured),0) INTO extra FROM sourcing_extra_grants g JOIN sourcing_extra_balances b ON b.grant_id=g.id
 WHERE g.organization_id=p_org AND g.recipient_user_id=p_user AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp() AND b.revoked_at IS NULL;
 IF inc>0 THEN funding:=jsonb_build_object('kind','included','slotId',p_slot,'windowStart',p_window,'revision',rev::text);
 ELSE
  SELECT g.id,g.valid_until,b.revision INTO chosen FROM sourcing_extra_grants g JOIN sourcing_extra_balances b ON b.grant_id=g.id
  WHERE g.organization_id=p_org AND g.recipient_user_id=p_user AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp()
   AND b.revoked_at IS NULL AND b.reserved+b.captured<b.quantity ORDER BY g.valid_until,g.created_at,g.id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  funding:=jsonb_build_object('kind','extra','grantId',chosen.id,'revision',chosen.revision::text,'expiresAt',chosen.valid_until);
 END IF;
 RETURN jsonb_build_object('quoteVersion',2,'funding',funding,'includedRemaining',inc,'extraRemaining',extra,'remaining',inc+extra);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_funding_quote(integer,integer,uuid,timestamptz) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_funding_reserve(p_org integer,p_admission uuid,q jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE gid uuid;
BEGIN
 IF q->'funding'->>'kind'='included' THEN
  UPDATE sourcing_allowance_windows SET reserved=reserved+1,revision=revision+1
  WHERE organization_id=p_org AND slot_id=(q->>'payerSlotId')::uuid AND starts_at=(q->>'windowStart')::timestamptz AND reserved+captured<5;
 ELSE
  gid:=(q->'funding'->>'grantId')::uuid;
  UPDATE sourcing_extra_balances b SET reserved=reserved+1,revision=revision+1 FROM sourcing_extra_grants g
  WHERE b.grant_id=gid AND g.id=gid AND g.organization_id=p_org AND g.recipient_user_id=(q->>'payerUserId')::integer
   AND b.revoked_at IS NULL AND g.valid_from<=clock_timestamp() AND g.valid_until>clock_timestamp()
   AND b.revision=(q->'funding'->>'revision')::bigint AND b.reserved+b.captured<b.quantity;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_ALLOWANCE_EXHAUSTED'; END IF;
 INSERT INTO sourcing_admission_funding VALUES(p_admission,p_org,(q->>'payerUserId')::integer,q->'funding'->>'kind',gid,(q->>'payerSlotId')::uuid,(q->>'windowStart')::timestamptz);
 IF gid IS NOT NULL THEN INSERT INTO sourcing_extra_events(id,organization_id,grant_id,admission_id,kind,command_sha256,database_user)
 VALUES(gen_random_uuid(),p_org,gid,p_admission,'reserve',encode(sha256(convert_to((q->'funding')::text,'UTF8')),'hex'),session_user); END IF;
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_funding_reserve(integer,uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_funding_finish(p_org integer,p_admission uuid,p_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE gid uuid; adm sourcing_admissions%ROWTYPE;
BEGIN
 IF p_kind NOT IN ('capture','release') OR p_kind IS NULL THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
 SELECT * INTO adm FROM sourcing_admissions WHERE organization_id=p_org AND id=p_admission;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
 SELECT grant_id INTO gid FROM sourcing_admission_funding WHERE admission_id=p_admission AND organization_id=p_org;
 IF gid IS NULL THEN
  UPDATE sourcing_allowance_windows SET reserved=reserved-1,captured=captured+CASE WHEN p_kind='capture' THEN 1 ELSE 0 END,revision=revision+1
  WHERE organization_id=p_org AND slot_id=adm.payer_slot_id AND starts_at=adm.window_start AND reserved>0;
 ELSE
  UPDATE sourcing_extra_balances SET reserved=reserved-1,captured=captured+CASE WHEN p_kind='capture' THEN 1 ELSE 0 END,revision=revision+1 WHERE grant_id=gid AND reserved>0;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_INVALID_RECEIPT'; END IF;
 IF gid IS NOT NULL THEN INSERT INTO sourcing_extra_events(id,organization_id,grant_id,admission_id,kind,command_sha256,database_user)
 VALUES(gen_random_uuid(),p_org,gid,p_admission,p_kind,encode(sha256(convert_to(p_admission::text||':'||p_kind,'UTF8')),'hex'),session_user); END IF;
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_funding_finish(integer,uuid,text) FROM PUBLIC;

-- Modify only reviewed exact fragments of the pinned final functions.
DO $patch$
DECLARE d text; old text; new text; sig text;
BEGIN
 sig:='flow_sourcing_quote(integer,integer,integer)';d:=pg_get_functiondef(sig::regprocedure);
 old:='win record; balance integer; payer integer; artifact uuid;';new:='win record; balance integer; payer integer; artifact uuid; budget jsonb;';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'EXTRA_SEARCH_PATCH_DRIFT'; END IF;d:=replace(d,old,new);
 old:='IF balance>0 THEN';new:='budget:=public.flow_sourcing_funding_quote(p_org,payer,slot.id,win.starts_at); IF budget IS NOT NULL THEN';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'EXTRA_SEARCH_PATCH_DRIFT'; END IF;d:=replace(d,old,new);
 old:='RETURN jsonb_build_object(''payerUserId'',payer,';new:='RETURN budget||jsonb_build_object(''payerUserId'',payer,';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'EXTRA_SEARCH_PATCH_DRIFT'; END IF;d:=replace(d,old,new);
 old:='''remaining'',balance';new:='''remaining'',budget->''remaining''';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'EXTRA_SEARCH_PATCH_DRIFT'; END IF;EXECUTE replace(d,old,new);

 sig:='flow_sourcing_admit(integer,integer,integer,uuid,jsonb)';d:=pg_get_functiondef(sig::regprocedure);
 -- Historical included-only SQL commands remain valid, but cannot select extras.
 old:='OR p_command-ARRAY[''expectedRevision'',''briefVersionId'',''materialHash'',''artifactId'',''expectedPayerSlotId'',''expectedWindowStart'',''quoteExpiresAt'']';
 new:='OR p_command-ARRAY[''expectedFunding'',''expectedRevision'',''briefVersionId'',''materialHash'',''artifactId'',''expectedPayerSlotId'',''expectedWindowStart'',''quoteExpiresAt'']';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'EXTRA_SEARCH_PATCH_DRIFT'; END IF;d:=replace(d,old,new);
 old:='IF (q->>''windowStart'')::timestamptz IS DISTINCT FROM (p_command->>''expectedWindowStart'')::timestamptz THEN RAISE EXCEPTION ''SOURCING_WINDOW_CHANGED''; END IF;';
 new:=old||'
  IF (p_command ? ''expectedFunding'' AND p_command->''expectedFunding'' IS DISTINCT FROM q->''funding'')
    OR (NOT p_command ? ''expectedFunding'' AND q->''funding''->>''kind''<>''included'') THEN RAISE EXCEPTION ''SOURCING_FUNDING_CHANGED''; END IF;';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'EXTRA_SEARCH_PATCH_DRIFT'; END IF;d:=replace(d,old,new);
 old:='UPDATE public.sourcing_allowance_windows SET reserved=reserved+1,revision=revision+1
    WHERE organization_id=p_org AND slot_id=(q->>''payerSlotId'')::uuid AND starts_at=(q->>''windowStart'')::timestamptz AND reserved+captured<5;
  IF NOT FOUND THEN RAISE EXCEPTION ''SOURCING_ALLOWANCE_EXHAUSTED''; END IF;';
 new:='PERFORM public.flow_sourcing_funding_reserve(p_org,run_id,q);';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'EXTRA_SEARCH_PATCH_DRIFT'; END IF;EXECUTE replace(d,old,new);

 sig:='flow_sourcing_receipt(integer,uuid,jsonb)';d:=pg_get_functiondef(sig::regprocedure);
 old:='UPDATE public.sourcing_allowance_windows SET reserved=reserved-1,captured=captured+1,revision=revision+1
      WHERE organization_id=p_org AND slot_id=adm.payer_slot_id AND starts_at=adm.window_start AND reserved>0;
    IF NOT FOUND THEN RAISE EXCEPTION ''SOURCING_INVALID_RECEIPT''; END IF;';
 new:='PERFORM public.flow_sourcing_funding_finish(p_org,p_admission,''capture'');';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'EXTRA_SEARCH_PATCH_DRIFT'; END IF;EXECUTE replace(d,old,new);
 sig:='flow_sourcing_cancel(integer,uuid,jsonb)';d:=pg_get_functiondef(sig::regprocedure);
 old:='UPDATE public.sourcing_allowance_windows SET reserved=reserved-1,revision=revision+1
    WHERE organization_id=p_org AND slot_id=adm.payer_slot_id AND starts_at=adm.window_start AND reserved>0;
  IF NOT FOUND THEN RAISE EXCEPTION ''SOURCING_INVALID_RECEIPT''; END IF;';
 new:='PERFORM public.flow_sourcing_funding_finish(p_org,p_admission,''release'');';
 IF (length(d)-length(replace(d,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'EXTRA_SEARCH_PATCH_DRIFT'; END IF;EXECUTE replace(d,old,new);
END $patch$;
