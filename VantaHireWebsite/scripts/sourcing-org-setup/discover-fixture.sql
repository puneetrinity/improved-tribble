-- Reviewed Discover migration excerpts, byte-preserving statements.
-- Owner ACL setup below is the equivalent subset of the migrations' table loops.
-- No runtime role receives access.

CREATE TABLE public.governed_sourcing_tenants (
  tenant_id text CONSTRAINT gov_tenant_pk PRIMARY KEY,
  enabled_at timestamptz NOT NULL,
  policy_hash text NOT NULL CONSTRAINT gov_tenant_hash_ck CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  organization_ref text NOT NULL CONSTRAINT gov_tenant_org_ck CHECK (organization_ref ~ '^[1-9][0-9]*$'),
  callback_url text NOT NULL CONSTRAINT gov_tenant_callback_ck CHECK (length(callback_url) BETWEEN 1 AND 2048),
  allow_new boolean NOT NULL DEFAULT false
);


CREATE TABLE public.rc_rate_policies (
 id uuid PRIMARY KEY, policy_hash text NOT NULL UNIQUE CHECK(policy_hash ~ '^[0-9a-f]{64}$'),
 rc_account_hash text CHECK(rc_account_hash ~ '^[0-9a-f]{64}$'),
 rc_fetch_credits_max integer CHECK(rc_fetch_credits_max BETWEEN 1 AND 1000000),
 rpm integer CHECK(rpm BETWEEN 1 AND 500),
 enabled boolean NOT NULL DEFAULT false,
 CONSTRAINT rc_account_config_ck CHECK(
  (rc_account_hash IS NULL AND rc_fetch_credits_max IS NULL AND rpm IS NULL)
   OR (rc_account_hash IS NOT NULL AND rc_fetch_credits_max IS NOT NULL AND rpm IS NOT NULL))
);


CREATE TABLE public.rc_org_policies (
 tenant_id text PRIMARY KEY REFERENCES public.governed_sourcing_tenants(tenant_id) ON DELETE RESTRICT,
 policy_id uuid NOT NULL REFERENCES public.rc_rate_policies(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);


CREATE FUNCTION public.signal_rc_set_policy(p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET timezone='UTC'
SET lock_timeout='2s' SET statement_timeout='5s' AS $rc_policy$
DECLARE p jsonb; fingerprint text; prior public.rc_rate_policies%ROWTYPE; policy_id uuid;
BEGIN
 IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR p_command->'version' IS DISTINCT FROM '1'::jsonb
  OR octet_length(p_command::text)>8192 OR coalesce(p_command->>'action','') NOT IN ('rates','organization') THEN RAISE EXCEPTION 'RC_INVALID_COMMAND'; END IF;
 IF p_command->>'action'='organization' THEN
  IF p_command-ARRAY['version','action','tenantId','policyId','enabled']<>'{}'::jsonb
   OR NOT p_command ?& ARRAY['version','action','tenantId','policyId','enabled']
   OR coalesce(p_command->>'tenantId','') !~ '^org_[1-9][0-9]*$'
   OR jsonb_typeof(p_command->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'RC_INVALID_COMMAND'; END IF;
  policy_id:=(p_command->>'policyId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.governed_sourcing_tenants WHERE tenant_id=p_command->>'tenantId')
   OR NOT EXISTS(SELECT 1 FROM public.rc_rate_policies WHERE id=policy_id) THEN RAISE EXCEPTION 'RC_POLICY_REFUSED'; END IF;
  INSERT INTO public.rc_org_policies(tenant_id,policy_id,enabled) VALUES(p_command->>'tenantId',policy_id,(p_command->>'enabled')::boolean)
   ON CONFLICT(tenant_id) DO UPDATE SET policy_id=excluded.policy_id,enabled=excluded.enabled,updated_at=clock_timestamp();
  RETURN jsonb_build_object('version',1,'state','configured','policyId',policy_id);
 END IF;
 IF p_command-ARRAY['version','action','policy']<>'{}'::jsonb OR NOT p_command ?& ARRAY['version','action','policy'] THEN RAISE EXCEPTION 'RC_INVALID_COMMAND'; END IF;
 p:=p_command->'policy';
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p-ARRAY['id','rcAccountHash','rcFetchCreditsMax','rpm','enabled']<>'{}'::jsonb
  OR NOT p ?& ARRAY['id','rcAccountHash','rcFetchCreditsMax','rpm','enabled']
  OR jsonb_typeof(p->'enabled') IS DISTINCT FROM 'boolean'
  OR EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE e.key IN ('rcFetchCreditsMax','rpm') AND e.value<>'null'::jsonb
   AND (jsonb_typeof(e.value)<>'number' OR e.value::text !~ '^[0-9]+$')) THEN RAISE EXCEPTION 'RC_INVALID_COMMAND'; END IF;
 policy_id:=(p->>'id')::uuid;
 fingerprint:=encode(sha256(convert_to((p-'id')::text,'UTF8')),'hex');
 SELECT * INTO prior FROM public.rc_rate_policies WHERE id=policy_id FOR UPDATE;
 IF FOUND THEN
  IF prior.policy_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'RC_POLICY_IMMUTABLE'; END IF;
  RETURN jsonb_build_object('version',1,'state','configured','policyId',policy_id,'policyHash',fingerprint,'replayed',true);
 END IF;
 INSERT INTO public.rc_rate_policies(id,policy_hash,rc_account_hash,rc_fetch_credits_max,rpm,enabled)
  VALUES(policy_id,fingerprint,p->>'rcAccountHash',(p->>'rcFetchCreditsMax')::integer,(p->>'rpm')::integer,(p->>'enabled')::boolean);
 RETURN jsonb_build_object('version',1,'state','configured','policyId',policy_id,'policyHash',fingerprint,'replayed',false);
END $rc_policy$;
REVOKE ALL ON FUNCTION public.signal_rc_set_policy(jsonb) FROM PUBLIC;

DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['governed_sourcing_tenants','rc_rate_policies','rc_org_policies'] LOOP
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',relation);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation);
  EXECUTE format('CREATE POLICY %I ON public.%I TO %I USING (true) WITH CHECK (true)',
    CASE WHEN relation='governed_sourcing_tenants' THEN 'gov_owner' ELSE 'rc_owner' END,relation,current_user);
 END LOOP;
END $$;
