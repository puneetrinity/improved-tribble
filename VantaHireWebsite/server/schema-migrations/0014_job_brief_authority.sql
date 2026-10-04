-- Wave 5A: staged job-brief authority. No source backfill and no activation.
ALTER TABLE public.jobs ADD COLUMN current_jd text, ADD COLUMN current_jd_hash text;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_current_jd_pair_ck CHECK (
  (current_jd IS NULL AND current_jd_hash IS NULL) OR
  (current_jd IS NOT NULL AND current_jd_hash IS NOT NULL
   AND octet_length(current_jd) BETWEEN 1 AND 20000
   AND current_jd_hash ~ '^[a-f0-9]{64}$'
   AND current_jd_hash = encode(sha256(convert_to(current_jd,'UTF8')),'hex')));
ALTER TABLE public.job_audit_log ADD COLUMN actor_kind text NOT NULL DEFAULT 'user';
ALTER TABLE public.job_audit_log ALTER COLUMN performed_by DROP NOT NULL;
ALTER TABLE public.job_audit_log ADD CONSTRAINT job_audit_actor_ck CHECK (
  (actor_kind='user' AND performed_by IS NOT NULL) OR
  (actor_kind='system' AND performed_by IS NULL));

CREATE TABLE public.job_brief_state (
  organization_id integer NOT NULL CONSTRAINT jb_state_org_fk REFERENCES public.organizations(id) ON DELETE RESTRICT,
  job_id integer NOT NULL CONSTRAINT jb_state_job_fk REFERENCES public.jobs(id) ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0 CONSTRAINT jb_state_revision_ck CHECK (revision >= 0),
  latest_version_id uuid,
  approved_version_id uuid,
  approved_material_hash text,
  source_hash text CONSTRAINT jb_state_source_ck CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT jb_state_pk PRIMARY KEY (organization_id,job_id),
  CONSTRAINT jb_state_approval_ck CHECK (
    (approved_version_id IS NULL AND approved_material_hash IS NULL) OR
    (approved_version_id IS NOT NULL AND approved_material_hash IS NOT NULL
      AND approved_material_hash ~ '^[a-f0-9]{64}$'))
);
CREATE TABLE public.job_brief_versions (
  version_id uuid CONSTRAINT jb_versions_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  version_number bigint NOT NULL CONSTRAINT jb_versions_number_ck CHECK (version_number > 0),
  source_jd text NOT NULL CONSTRAINT jb_versions_jd_ck CHECK (octet_length(source_jd) BETWEEN 1 AND 20000),
  source_hash text NOT NULL CONSTRAINT jb_versions_source_ck CHECK (
    source_hash ~ '^[a-f0-9]{64}$' AND source_hash=encode(sha256(convert_to(source_jd,'UTF8')),'hex')),
  payload jsonb NOT NULL CONSTRAINT jb_versions_payload_ck CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=65536),
  material_hash text NOT NULL CONSTRAINT jb_versions_material_ck CHECK (material_hash ~ '^[a-f0-9]{64}$'),
  schema_version integer NOT NULL CONSTRAINT jb_versions_schema_ck CHECK (schema_version=1),
  compiler_version integer NOT NULL CONSTRAINT jb_versions_compiler_ck CHECK (compiler_version=1),
  taxonomy_version integer NOT NULL CONSTRAINT jb_versions_taxonomy_ck CHECK (taxonomy_version=1),
  created_by integer NOT NULL CONSTRAINT jb_versions_actor_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT jb_versions_scope_fk FOREIGN KEY (organization_id,job_id) REFERENCES public.job_brief_state ON DELETE RESTRICT,
  CONSTRAINT jb_versions_number_uq UNIQUE (organization_id,job_id,version_number),
  CONSTRAINT jb_versions_scope_id_uq UNIQUE (organization_id,job_id,version_id)
);
ALTER TABLE public.job_brief_state ADD CONSTRAINT jb_state_latest_fk
 FOREIGN KEY (organization_id,job_id,latest_version_id) REFERENCES public.job_brief_versions(organization_id,job_id,version_id) ON DELETE RESTRICT;
ALTER TABLE public.job_brief_state ADD CONSTRAINT jb_state_approved_fk
 FOREIGN KEY (organization_id,job_id,approved_version_id) REFERENCES public.job_brief_versions(organization_id,job_id,version_id) ON DELETE RESTRICT;
CREATE TABLE public.job_brief_events (
  event_id uuid CONSTRAINT jb_events_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CONSTRAINT jb_events_hash_ck CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  action text NOT NULL CONSTRAINT jb_events_action_ck CHECK (action IN ('save_brief','edit_governed_job','moderate','publish','deactivate','approve')),
  actor_id integer NOT NULL CONSTRAINT jb_events_actor_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  previous_version_id uuid,
  new_version_id uuid,
  coordination_revision bigint NOT NULL CONSTRAINT jb_events_revision_ck CHECK (coordination_revision > 0),
  requester_kind text NOT NULL CONSTRAINT jb_events_requester_ck CHECK (requester_kind IN ('recruiter','hiring_manager','admin')),
  reason_code text CONSTRAINT jb_events_reason_ck CHECK (reason_code IN ('clarification_typo','hm_client_feedback','role_scope_changed','seniority_changed','skills_changed','location_changed','compensation_changed','sourcing_quality_volume','market_availability','application_interview_evidence','policy_compliance','other')),
  note text CONSTRAINT jb_events_note_ck CHECK (length(note)<=300),
  timing text NOT NULL CONSTRAINT jb_events_timing_ck CHECK (timing IN ('before_sourcing','after_results','after_review','after_interview','after_close_reopen','unknown')),
  timing_basis text NOT NULL CONSTRAINT jb_events_basis_ck CHECK (timing_basis IN ('unknown','durable_evidence','user_stated')),
  diff jsonb NOT NULL CONSTRAINT jb_events_diff_ck CHECK (jsonb_typeof(diff)='object' AND octet_length(diff::text)<=65536),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT jb_events_scope_fk FOREIGN KEY (organization_id,job_id) REFERENCES public.job_brief_state ON DELETE RESTRICT,
  CONSTRAINT jb_events_prev_fk FOREIGN KEY (organization_id,job_id,previous_version_id) REFERENCES public.job_brief_versions(organization_id,job_id,version_id) ON DELETE RESTRICT,
  CONSTRAINT jb_events_next_fk FOREIGN KEY (organization_id,job_id,new_version_id) REFERENCES public.job_brief_versions(organization_id,job_id,version_id) ON DELETE RESTRICT,
  CONSTRAINT jb_events_request_uq UNIQUE (organization_id,job_id,request_id)
);
CREATE INDEX jb_events_history_idx ON public.job_brief_events(organization_id,job_id,recorded_at,event_id);
CREATE TABLE public.job_brief_draft_requests (
  request_id uuid CONSTRAINT jb_drafts_pk PRIMARY KEY,
  organization_id integer NOT NULL,
  job_id integer NOT NULL,
  actor_id integer NOT NULL CONSTRAINT jb_drafts_actor_fk REFERENCES public.users(id) ON DELETE RESTRICT,
  request_hash text NOT NULL CONSTRAINT jb_drafts_hash_ck CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  source_hash text NOT NULL CONSTRAINT jb_drafts_source_ck CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  expected_revision bigint NOT NULL CONSTRAINT jb_drafts_revision_ck CHECK (expected_revision>=0),
  model_id text NOT NULL CONSTRAINT jb_drafts_model_ck CHECK (length(model_id) BETWEEN 1 AND 160),
  prompt_version integer NOT NULL DEFAULT 1 CONSTRAINT jb_drafts_prompt_ck CHECK (prompt_version=1),
  attempt_number integer NOT NULL CONSTRAINT jb_drafts_attempt_ck CHECK (attempt_number IN (1,2)),
  state text NOT NULL CONSTRAINT jb_drafts_state_ck CHECK (state IN ('reserved','dispatched','succeeded','failed','unknown','stale')),
  lease_token uuid,
  lease_deadline timestamptz,
  result jsonb CONSTRAINT jb_drafts_result_ck CHECK (octet_length(result::text)<=65536),
  closed_code text CONSTRAINT jb_drafts_code_ck CHECK (closed_code IN ('BRIEF_MODEL_FAILED','BRIEF_MODEL_TIMEOUT','BRIEF_MODEL_INVALID','BRIEF_MODEL_TRUNCATED','BRIEF_MODEL_UNKNOWN','BRIEF_DRAFT_STALE')),
  input_tokens integer CONSTRAINT jb_drafts_input_ck CHECK (input_tokens>=0),
  output_tokens integer CONSTRAINT jb_drafts_output_ck CHECK (output_tokens BETWEEN 0 AND 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  CONSTRAINT jb_drafts_scope_fk FOREIGN KEY (organization_id,job_id) REFERENCES public.job_brief_state ON DELETE RESTRICT,
  CONSTRAINT jb_drafts_attempt_uq UNIQUE (organization_id,job_id,source_hash,attempt_number),
  CONSTRAINT jb_drafts_lease_ck CHECK (
    (state IN ('reserved','dispatched') AND lease_token IS NOT NULL AND lease_deadline IS NOT NULL AND finished_at IS NULL) OR
    (state NOT IN ('reserved','dispatched') AND lease_token IS NULL AND lease_deadline IS NULL AND finished_at IS NOT NULL))
);
CREATE INDEX jb_drafts_lease_idx ON public.job_brief_draft_requests(state,lease_deadline);
CREATE UNIQUE INDEX jb_drafts_inflight_idx ON public.job_brief_draft_requests(organization_id,job_id) WHERE state IN ('reserved','dispatched');

CREATE FUNCTION public.flow_job_brief_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='BRIEF_EVIDENCE_IMMUTABLE'; END;
$$;
CREATE TRIGGER jb_versions_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.job_brief_versions
 FOR EACH STATEMENT EXECUTE FUNCTION public.flow_job_brief_immutable();
CREATE TRIGGER jb_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON public.job_brief_events
 FOR EACH STATEMENT EXECUTE FUNCTION public.flow_job_brief_immutable();
REVOKE ALL ON FUNCTION public.flow_job_brief_immutable() FROM PUBLIC;
REVOKE ALL ON public.job_brief_state,public.job_brief_versions,public.job_brief_events,public.job_brief_draft_requests FROM PUBLIC;

-- Share locks allow concurrent intake. Expiry takes UPDATE then re-observes
-- application/interview predicates. Both sides use increasing job-id order.
CREATE FUNCTION public.flow_lock_job_application_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    PERFORM id FROM public.jobs WHERE id=NEW.job_id FOR SHARE;
  ELSE
    PERFORM id FROM public.jobs WHERE id IN (OLD.job_id,NEW.job_id) ORDER BY id FOR SHARE;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.flow_lock_job_application_activity() FROM PUBLIC;
CREATE TRIGGER job_activity_before_insert BEFORE INSERT ON public.applications
 FOR EACH ROW EXECUTE FUNCTION public.flow_lock_job_application_activity();
CREATE TRIGGER job_activity_before_update BEFORE UPDATE OF job_id,interview_date ON public.applications
 FOR EACH ROW EXECUTE FUNCTION public.flow_lock_job_application_activity();
CREATE FUNCTION public.flow_job_brief_read(p_org integer,p_job integer,p_actor integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE j public.jobs%ROWTYPE; s public.job_brief_state%ROWTYPE; v jsonb; d jsonb;
BEGIN

  SELECT * INTO j FROM public.jobs WHERE id=p_job AND organization_id=p_org FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.users WHERE id=p_actor AND role='recruiter' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.organization_members WHERE organization_id=p_org AND user_id=p_actor AND seat_assigned FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF j.posted_by<>p_actor THEN
    PERFORM id FROM public.job_recruiters WHERE job_id=p_job AND recruiter_id=p_actor AND organization_id=p_org FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  SELECT * INTO s FROM public.job_brief_state WHERE organization_id=p_org AND job_id=p_job;
  SELECT to_jsonb(b) INTO v FROM public.job_brief_versions b
    WHERE organization_id=p_org AND job_id=p_job AND version_id=s.latest_version_id;
  SELECT jsonb_build_object('requestId',request_id,'state',
      CASE WHEN state IN ('reserved','dispatched') AND lease_deadline<=clock_timestamp() THEN 'unknown' ELSE state END,
      'result',CASE WHEN state='succeeded' THEN result ELSE NULL END,
      'code',closed_code,'createdAt',created_at)
    INTO d FROM public.job_brief_draft_requests
    WHERE organization_id=p_org AND job_id=p_job ORDER BY created_at DESC,request_id DESC LIMIT 1;
  RETURN jsonb_build_object('revision',coalesce(s.revision,0)::text,
    'currentJD',j.current_jd,'sourceHash',j.current_jd_hash,
    'originalJD',j.original_jd,'legacyDescription',j.description,
    'latest',v,'approvedVersionId',s.approved_version_id,
    'approvedMaterialHash',s.approved_material_hash,'draft',d);
END;
$$;
REVOKE ALL ON FUNCTION public.flow_job_brief_read(integer,integer,integer) FROM PUBLIC;

CREATE FUNCTION public.flow_job_brief_history(p_org integer,p_job integer,p_actor integer,
 p_before_time timestamptz,p_before_id uuid,p_size integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE j public.jobs%ROWTYPE; result jsonb;
BEGIN

  SELECT * INTO j FROM public.jobs WHERE id=p_job AND organization_id=p_org FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.users WHERE id=p_actor AND role='recruiter' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.organization_members WHERE organization_id=p_org AND user_id=p_actor AND seat_assigned FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF j.posted_by<>p_actor THEN
    PERFORM id FROM public.job_recruiters WHERE job_id=p_job AND recruiter_id=p_actor AND organization_id=p_org FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  IF p_size IS NULL OR p_size<1 OR p_size>50 OR (p_before_time IS NULL)<>(p_before_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAGE';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.recorded_at DESC,e.event_id DESC),'[]'::jsonb)
    INTO result FROM (
      SELECT * FROM public.job_brief_events
      WHERE organization_id=p_org AND job_id=p_job
        AND (p_before_time IS NULL OR (recorded_at,event_id)<(p_before_time,p_before_id))
      ORDER BY recorded_at DESC,event_id DESC LIMIT p_size
    ) e;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.flow_job_brief_history(integer,integer,integer,timestamptz,uuid,integer) FROM PUBLIC;

CREATE FUNCTION public.flow_job_brief_save(p_org integer,p_job integer,p_actor integer,p_request uuid,
 p_expected bigint,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE j public.jobs%ROWTYPE; s public.job_brief_state%ROWTYPE; e public.job_brief_events%ROWTYPE;
  actor_role text; action text; h text; jd text; sh text; payload jsonb; c jsonb;
  semantic jsonb; material text; vid uuid; vn bigint; material_changed boolean;
  result jsonb; patch jsonb; allowed text[]; previous uuid;
BEGIN
  IF p_request IS NULL OR p_expected<0 OR jsonb_typeof(p_command) IS DISTINCT FROM 'object'
     OR octet_length(p_command::text)>65536 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_COMMAND';
  END IF;
  action:=p_command->>'action';
  IF action IS NULL OR action NOT IN ('save_brief','edit_governed_job','moderate','publish','deactivate') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_COMMAND';
  END IF;
  SELECT * INTO j FROM public.jobs WHERE id=p_job AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT role INTO actor_role FROM public.users WHERE id=p_actor FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- A1: only existing super-admin transitions may use the locked revision.
  -- Recruiter writes must always supply the revision they observed.
  IF p_expected IS NULL AND NOT (actor_role='super_admin' AND action IN ('moderate','publish','deactivate')) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_REVISION_REQUIRED';
  END IF;
  IF action='moderate' THEN
    IF actor_role<>'super_admin' THEN RETURN NULL; END IF;
  ELSIF actor_role='super_admin' AND action IN ('publish','deactivate') THEN
    NULL;
  ELSE
    IF actor_role<>'recruiter' THEN RETURN NULL; END IF;
    PERFORM id FROM public.organization_members WHERE organization_id=p_org AND user_id=p_actor AND seat_assigned FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF j.posted_by<>p_actor THEN
      PERFORM id FROM public.job_recruiters WHERE job_id=p_job AND recruiter_id=p_actor AND organization_id=p_org FOR SHARE;
      IF NOT FOUND THEN RETURN NULL; END IF;
    END IF;
  END IF;
  allowed:=CASE action
    WHEN 'save_brief' THEN ARRAY['action','currentJD','payload','sourceChoice','requesterKind','reasonCode','note']
    WHEN 'edit_governed_job' THEN ARRAY['action','currentJD','sourceChoice','patch','requesterKind','reasonCode','note']
    WHEN 'moderate' THEN ARRAY['action','status','reviewComments']
    WHEN 'deactivate' THEN ARRAY['action','reason']
    ELSE ARRAY['action'] END;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_command) k WHERE NOT k=ANY(allowed)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_COMMAND';
  END IF;
  h:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'revision',p_expected,'command',p_command)::text,'UTF8')),'hex');
  SELECT * INTO e FROM public.job_brief_events WHERE organization_id=p_org AND job_id=p_job AND request_id=p_request;
  IF FOUND THEN
    IF e.request_hash<>h THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_REQUEST_CONFLICT'; END IF;
    RETURN e.diff->'result';
  END IF;
  INSERT INTO public.job_brief_state(organization_id,job_id,source_hash) VALUES(p_org,p_job,j.current_jd_hash) ON CONFLICT DO NOTHING;
  SELECT * INTO s FROM public.job_brief_state WHERE organization_id=p_org AND job_id=p_job FOR UPDATE;
  IF p_expected IS NOT NULL AND s.revision<>p_expected THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_REVISION_CONFLICT'; END IF;
  previous:=s.latest_version_id;
  IF action IN ('save_brief','edit_governed_job') THEN
    IF p_command->>'requesterKind' IS NULL OR p_command->>'requesterKind' NOT IN ('recruiter','hiring_manager')
      OR p_command->>'reasonCode' IS NULL OR p_command->>'reasonCode' NOT IN ('clarification_typo','hm_client_feedback','role_scope_changed','seniority_changed','skills_changed','location_changed','compensation_changed','sourcing_quality_volume','market_availability','application_interview_evidence','policy_compliance','other')
      OR coalesce(length(p_command->>'note'),0)>300
      OR p_command->>'sourceChoice' IS NULL OR p_command->>'sourceChoice' NOT IN ('original_prose','description_prose','recruiter_edit','current_jd') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_COMMAND';
    END IF;
    jd:=p_command->>'currentJD';
    IF jd IS NULL OR octet_length(jd) NOT BETWEEN 1 AND 20000 OR btrim(jd)='' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_JD';
    END IF;
    IF (p_command->>'sourceChoice'='current_jd' AND jd IS DISTINCT FROM j.current_jd)
      OR (p_command->>'sourceChoice'='original_prose' AND jd IS DISTINCT FROM j.original_jd)
      OR (p_command->>'sourceChoice'='description_prose' AND jd IS DISTINCT FROM j.description) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_SOURCE_CONFLICT';
    END IF;
    sh:=encode(sha256(convert_to(jd,'UTF8')),'hex');
    IF action='edit_governed_job' THEN
      patch:=coalesce(p_command->'patch','{}'::jsonb);
      IF jsonb_typeof(patch)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE NOT k=ANY(
        ARRAY['title','location','type','skills','goodToHaveSkills','salaryMin','salaryMax','salaryPeriod','educationRequirement','experienceYears','hiringManagerId','clientId'])) THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PATCH';
      END IF;
      -- Related assignments are scoped and locked inside this definer transaction.
      IF patch->>'hiringManagerId' IS NOT NULL THEN
        PERFORM id FROM public.organization_members
          WHERE organization_id=p_org AND user_id=(patch->>'hiringManagerId')::integer FOR SHARE;
        IF NOT FOUND THEN
          -- Seat-free hiring managers use the current organization-scoped invitation grant.
          PERFORM i.id FROM public.hiring_manager_invitations i JOIN public.users u ON u.id=i.accepted_by_user_id
            WHERE i.organization_id=p_org AND i.authority_scope='organization' AND i.status='accepted'
              AND i.accepted_at IS NOT NULL AND i.revoked_at IS NULL AND i.grant_version>=1
              AND i.accepted_by_user_id=(patch->>'hiringManagerId')::integer AND u.role='hiring_manager'
            FOR SHARE OF i,u;
          IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_ASSIGNMENT'; END IF;
        END IF;
      END IF;
      IF patch->>'clientId' IS NOT NULL THEN
        PERFORM id FROM public.clients WHERE organization_id=p_org AND id=(patch->>'clientId')::integer FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_ASSIGNMENT'; END IF;
      END IF;
      -- Explicit assignments only; no client mass-assignment into the job row.
      UPDATE public.jobs SET
        current_jd=jd,current_jd_hash=sh,jd_digest=NULL,jd_digest_version=NULL,
        title=CASE WHEN patch?'title' THEN patch->>'title' ELSE title END,
        location=CASE WHEN patch?'location' THEN patch->>'location' ELSE location END,
        type=CASE WHEN patch?'type' THEN patch->>'type' ELSE type END,
        skills=CASE WHEN patch?'skills' THEN ARRAY(SELECT jsonb_array_elements_text(patch->'skills')) ELSE skills END,
        good_to_have_skills=CASE WHEN patch->'goodToHaveSkills'='null'::jsonb THEN NULL WHEN patch?'goodToHaveSkills' THEN ARRAY(SELECT jsonb_array_elements_text(patch->'goodToHaveSkills')) ELSE good_to_have_skills END,
        salary_min=CASE WHEN patch?'salaryMin' THEN (patch->>'salaryMin')::integer ELSE salary_min END,
        salary_max=CASE WHEN patch?'salaryMax' THEN (patch->>'salaryMax')::integer ELSE salary_max END,
        salary_period=CASE WHEN patch?'salaryPeriod' THEN patch->>'salaryPeriod' ELSE salary_period END,
        education_requirement=CASE WHEN patch?'educationRequirement' THEN patch->>'educationRequirement' ELSE education_requirement END,
        experience_years=CASE WHEN patch?'experienceYears' THEN (patch->>'experienceYears')::integer ELSE experience_years END,
        hiring_manager_id=CASE WHEN patch?'hiringManagerId' THEN (patch->>'hiringManagerId')::integer ELSE hiring_manager_id END,
        client_id=CASE WHEN patch?'clientId' THEN (patch->>'clientId')::integer ELSE client_id END,
        updated_at=clock_timestamp() WHERE id=p_job AND organization_id=p_org;
      -- Conservative invalidation of governed job edits, including source initialization.
      s.approved_version_id:=NULL; s.approved_material_hash:=NULL; s.latest_version_id:=NULL;
    ELSE
      payload:=p_command->'payload';
      IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
        OR payload->>'schemaVersion' IS DISTINCT FROM '1' OR payload->>'compilerVersion' IS DISTINCT FROM '1'
        OR payload->>'taxonomyVersion' IS DISTINCT FROM '1'
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE NOT k=ANY(ARRAY['schemaVersion','compilerVersion','taxonomyVersion','criteria']))
        OR jsonb_typeof(payload->'criteria') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
      END IF;
      IF jsonb_array_length(payload->'criteria') NOT BETWEEN 1 AND 12
        OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(payload->'criteria'))<>jsonb_array_length(payload->'criteria') THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
      END IF;
      FOR c IN SELECT value FROM jsonb_array_elements(payload->'criteria') LOOP
        IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR c->>'id' IS NULL
          OR c->>'label' IS NULL OR length(btrim(c->>'label')) NOT BETWEEN 1 AND 120
          OR c->>'class' IS NULL OR c->>'class' NOT IN ('must_have','preferred','disqualifier','evidence_required')
          OR c->>'subject' IS NULL OR c->>'subject' NOT IN ('title','seniority','experience_years','skill','domain','function','location','certification','language','education_requirement','relevant_work','responsibility','leadership','availability','work_eligibility')
          OR c->>'use' IS NULL OR c->>'use' NOT IN ('assessment','retrieval','both')
          OR jsonb_typeof(c->'requirement') IS DISTINCT FROM 'object'
          OR jsonb_typeof(c->'provenance') IS DISTINCT FROM 'object'
          OR jsonb_typeof(c->'evidenceKinds') IS DISTINCT FROM 'array'
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(c) k WHERE NOT k=ANY(ARRAY['id','label','class','subject','requirement','evidenceKinds','use','provenance','note']))
          OR (c->>'subject'='experience_years') IS DISTINCT FROM (c->'requirement'->>'kind'='minimum_years')
          OR (c->>'subject'='experience_years' AND c->>'class'='disqualifier')
          OR c->'requirement'?'maximum' THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        PERFORM (c->>'id')::uuid;
        IF EXISTS (SELECT 1 FROM unnest(ARRAY[c->>'label',c->'requirement'->>'value',c->>'note']) AS t(trait)
          WHERE trait ~* '^\s*(age|male|female)\s*$'
            OR trait ~* '\m(?:overqualified|under\s*\d{2}|maximum\s+(?:age|experience)|age\s*(?:limit|range|under|below|between|above|over|[<>=]|\d+)|aged\s+\d+|young|youthful|gender|(?:male|female)\s+(?:only|candidates?|applicants?|workers?|engineers?|preferred|required)|(?:only|prefer|preferred|require|required)\s+(?:male|female)|ethnicity|race(?!\s+conditions?\y)|religion|caste|marital|(?:un)?married|pregnan\w*|disabil\w*|nationality|national\s+origin|native(?:[ -]|\s+(?:\w+\s+){0,2})speaker|mother\s+tongue|recent\s+grad\w*|graduation\s+year|career\s+gaps?|elite\s+(?:school|college)|college\s+name|do.not.poach)\M'
            OR (c->>'subject'<>'work_eligibility' AND trait ~* '\m(citizenship|citizens?)\M')) THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        IF c->'requirement'->>'kind' IS NULL OR c->'requirement'->>'kind' NOT IN ('text','minimum_years','boolean')
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(c->'requirement') k
            WHERE NOT k=ANY(CASE WHEN c->'requirement'->>'kind'='minimum_years' THEN ARRAY['kind','minimum'] ELSE ARRAY['kind','value'] END))
          OR (c->'requirement'->>'kind'='text' AND (jsonb_typeof(c->'requirement'->'value') IS DISTINCT FROM 'string'
            OR length(btrim(c->'requirement'->>'value')) NOT BETWEEN 1 AND 500))
          OR (c->'requirement'->>'kind'='minimum_years' AND (jsonb_typeof(c->'requirement'->'minimum') IS DISTINCT FROM 'number'))
          OR (c->'requirement'->>'kind'='boolean' AND (c->'requirement'->>'value' IS NULL OR c->'requirement'->>'value' NOT IN ('yes','no','unknown')))
          OR jsonb_array_length(c->'evidenceKinds') NOT BETWEEN 1 AND 4
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(c->'evidenceKinds') k WHERE k IS NULL OR k NOT IN ('candidate_provided','verified_document','profile_evidence','recruiter_judgement'))
          OR (c->>'subject' IN ('responsibility','leadership','availability') AND (c->>'use'<>'assessment' OR c->'evidenceKinds'<>'["recruiter_judgement"]'::jsonb))
          OR (c->>'subject'='work_eligibility' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(c->'evidenceKinds') k WHERE k NOT IN ('candidate_provided','verified_document')))
          OR coalesce(length(c->>'note'),0)>300 THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        IF c->'requirement'->>'kind'='minimum_years' AND (c->'requirement'->>'minimum')::numeric NOT BETWEEN 0 AND 80 THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        IF c->'provenance'->>'kind'='jd' THEN
          IF c->'provenance'->>'sourceHash' IS DISTINCT FROM sh
            OR jsonb_typeof(c->'provenance'->'start') IS DISTINCT FROM 'number'
            OR jsonb_typeof(c->'provenance'->'end') IS DISTINCT FROM 'number'
            OR (c->'provenance'->>'start')::numeric<0
            OR (c->'provenance'->>'end')::numeric<=(c->'provenance'->>'start')::numeric
            OR (c->'provenance'->>'end')::numeric>octet_length(jd)
            OR EXISTS(SELECT 1 FROM jsonb_object_keys(c->'provenance') k WHERE NOT k=ANY(ARRAY['kind','sourceHash','start','end'])) THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
          END IF;
        ELSIF c->'provenance' IS DISTINCT FROM '{"kind":"recruiter_edit"}'::jsonb THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
      END LOOP;
      SELECT jsonb_agg(
        (value-'note'-'provenance') ||
        jsonb_build_object('label',regexp_replace(btrim(value->>'label'),'\s+',' ','g'),
          'requirement',CASE WHEN value->'requirement'->>'kind'='text'
            THEN jsonb_build_object('kind','text','value',regexp_replace(btrim(value->'requirement'->>'value'),'\s+',' ','g'))
            ELSE value->'requirement' END)
        ORDER BY ord) INTO semantic FROM jsonb_array_elements(payload->'criteria') WITH ORDINALITY a(value,ord);
      material:=encode(sha256(convert_to(jsonb_build_object('jd',regexp_replace(btrim(jd),'\s+',' ','g'),
        'criteria',semantic,'title',j.title,'location',j.location,'type',j.type,'skills',j.skills,
        'preferred',j.good_to_have_skills,'salaryMin',j.salary_min,'salaryMax',j.salary_max,'salaryPeriod',j.salary_period,
        'education',j.education_requirement,'experience',j.experience_years)::text,'UTF8')),'hex');
      material_changed:=s.approved_material_hash IS DISTINCT FROM material;
      vid:=gen_random_uuid();
      SELECT coalesce(max(version_number),0)+1 INTO vn FROM public.job_brief_versions WHERE organization_id=p_org AND job_id=p_job;
      INSERT INTO public.job_brief_versions(version_id,organization_id,job_id,version_number,source_jd,source_hash,payload,material_hash,schema_version,compiler_version,taxonomy_version,created_by)
        VALUES(vid,p_org,p_job,vn,jd,sh,payload,material,1,1,1,p_actor);
      s.latest_version_id:=vid;
      IF material_changed THEN s.approved_version_id:=NULL; s.approved_material_hash:=NULL; END IF;
      UPDATE public.jobs SET current_jd=jd,current_jd_hash=sh,
        jd_digest=CASE WHEN current_jd_hash IS DISTINCT FROM sh THEN NULL ELSE jd_digest END,
        jd_digest_version=CASE WHEN current_jd_hash IS DISTINCT FROM sh THEN NULL ELSE jd_digest_version END,
        updated_at=clock_timestamp() WHERE id=p_job AND organization_id=p_org;
    END IF;
    s.source_hash:=sh;
  ELSIF action='publish' THEN
    IF j.status<>'approved' OR s.approved_version_id IS NULL OR j.current_jd_hash IS DISTINCT FROM s.source_hash
       OR NOT EXISTS(SELECT 1 FROM public.job_brief_versions WHERE organization_id=p_org AND job_id=p_job
         AND version_id=s.latest_version_id AND material_hash=s.approved_material_hash AND source_hash=j.current_jd_hash) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_APPROVAL_REQUIRED';
    END IF;
    IF NOT j.is_active THEN
      UPDATE public.jobs SET is_active=true,reactivated_at=clock_timestamp(),
        reactivation_count=reactivation_count+1,warning_email_sent=false,
        deactivated_at=NULL,deactivation_reason=NULL,updated_at=clock_timestamp() WHERE id=p_job;
      INSERT INTO public.job_audit_log(organization_id,job_id,action,performed_by,actor_kind)
        VALUES(p_org,p_job,'reactivated',p_actor,'user');
    END IF;
  ELSIF action='deactivate' THEN
    IF coalesce(p_command->>'reason','manual') NOT IN ('manual','filled','cancelled') THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_COMMAND';
    END IF;
    IF j.is_active THEN
      UPDATE public.jobs SET is_active=false,deactivated_at=clock_timestamp(),deactivation_reason=coalesce(p_command->>'reason','manual'),updated_at=clock_timestamp() WHERE id=p_job;
      INSERT INTO public.job_audit_log(organization_id,job_id,action,performed_by,actor_kind,reason)
        VALUES(p_org,p_job,'deactivated',p_actor,'user',coalesce(p_command->>'reason','manual'));
    END IF;
  ELSE
    IF p_command->>'status' IS NULL OR p_command->>'status' NOT IN ('approved','declined')
      OR coalesce(length(p_command->>'reviewComments'),0)>2000 THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_COMMAND';
    END IF;
    UPDATE public.jobs SET status=p_command->>'status',review_comments=p_command->>'reviewComments',
      reviewed_by=p_actor,reviewed_at=clock_timestamp(),
      is_active=CASE WHEN p_command->>'status'='declined' THEN false ELSE is_active END,
      updated_at=clock_timestamp() WHERE id=p_job;
    INSERT INTO public.job_audit_log(organization_id,job_id,action,performed_by,actor_kind)
      VALUES(p_org,p_job,p_command->>'status',p_actor,'user');
  END IF;
  s.revision:=s.revision+1;
  UPDATE public.job_brief_state SET revision=s.revision,latest_version_id=s.latest_version_id,
    approved_version_id=s.approved_version_id,approved_material_hash=s.approved_material_hash,
    source_hash=s.source_hash,updated_at=clock_timestamp() WHERE organization_id=p_org AND job_id=p_job;
  result:=jsonb_build_object('revision',s.revision::text,'versionId',s.latest_version_id,
    'approvedVersionId',s.approved_version_id,'action',action);
  INSERT INTO public.job_brief_events(event_id,organization_id,job_id,request_id,request_hash,action,actor_id,previous_version_id,new_version_id,
    coordination_revision,requester_kind,reason_code,note,timing,timing_basis,diff)
    VALUES(gen_random_uuid(),p_org,p_job,p_request,h,action,p_actor,previous,s.latest_version_id,s.revision,
      CASE WHEN actor_role='super_admin' THEN 'admin' ELSE coalesce(p_command->>'requesterKind','recruiter') END,p_command->>'reasonCode',p_command->>'note','unknown','unknown',
      jsonb_build_object('previousSourceHash',j.current_jd_hash,'sourceHash',s.source_hash,'materialChanged',coalesce(material_changed,true),
        'sourceChoice',p_command->>'sourceChoice','changedFields',coalesce(to_jsonb(ARRAY(SELECT jsonb_object_keys(patch))),'[]'::jsonb),'result',result));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.flow_job_brief_save(integer,integer,integer,uuid,bigint,jsonb) FROM PUBLIC;
CREATE FUNCTION public.flow_job_brief_approve(p_org integer,p_job integer,p_actor integer,p_request uuid,
 p_expected bigint,p_version uuid,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE j public.jobs%ROWTYPE; s public.job_brief_state%ROWTYPE; v public.job_brief_versions%ROWTYPE;
 e public.job_brief_events%ROWTYPE; h text; result jsonb;
BEGIN

  SELECT * INTO j FROM public.jobs WHERE id=p_job AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.users WHERE id=p_actor AND role='recruiter' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.organization_members WHERE organization_id=p_org AND user_id=p_actor AND seat_assigned FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF j.posted_by<>p_actor THEN
    PERFORM id FROM public.job_recruiters WHERE job_id=p_job AND recruiter_id=p_actor AND organization_id=p_org FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  IF p_request IS NULL OR p_version IS NULL OR p_expected IS NULL OR p_expected<0
    OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_COMMAND';
  END IF;
  h:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'revision',p_expected,'version',p_version,'action','approve','requestHash',p_request_hash)::text,'UTF8')),'hex');
  SELECT * INTO e FROM public.job_brief_events WHERE organization_id=p_org AND job_id=p_job AND request_id=p_request;
  IF FOUND THEN
    IF e.request_hash<>h THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_REQUEST_CONFLICT'; END IF;
    RETURN e.diff->'result';
  END IF;
  SELECT * INTO s FROM public.job_brief_state WHERE organization_id=p_org AND job_id=p_job FOR UPDATE;
  IF NOT FOUND OR s.revision<>p_expected OR s.latest_version_id IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_REVISION_CONFLICT';
  END IF;
  SELECT * INTO v FROM public.job_brief_versions WHERE organization_id=p_org AND job_id=p_job AND version_id=p_version;
  IF NOT FOUND OR j.current_jd_hash IS DISTINCT FROM v.source_hash OR s.source_hash IS DISTINCT FROM v.source_hash THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_SOURCE_CONFLICT';
  END IF;
  UPDATE public.job_brief_state SET revision=revision+1,approved_version_id=p_version,approved_material_hash=v.material_hash,
    updated_at=clock_timestamp() WHERE organization_id=p_org AND job_id=p_job RETURNING * INTO s;
  result:=jsonb_build_object('revision',s.revision::text,'versionId',p_version,'approvedVersionId',p_version,'action','approve');
  INSERT INTO public.job_brief_events(event_id,organization_id,job_id,request_id,request_hash,action,actor_id,previous_version_id,new_version_id,
    coordination_revision,requester_kind,timing,timing_basis,diff)
    VALUES(gen_random_uuid(),p_org,p_job,p_request,h,'approve',p_actor,p_version,p_version,s.revision,'recruiter','unknown','unknown',
      jsonb_build_object('result',result));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.flow_job_brief_approve(integer,integer,integer,uuid,bigint,uuid,text) FROM PUBLIC;

CREATE FUNCTION public.flow_job_brief_draft_claim(p_org integer,p_job integer,p_actor integer,p_request uuid,
 p_expected bigint,p_source_hash text,p_model text,p_request_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE j public.jobs%ROWTYPE; s public.job_brief_state%ROWTYPE; d public.job_brief_draft_requests%ROWTYPE;
 h text; fingerprint text; attempt integer;
BEGIN

  SELECT * INTO j FROM public.jobs WHERE id=p_job AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.users WHERE id=p_actor AND role='recruiter' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM id FROM public.organization_members WHERE organization_id=p_org AND user_id=p_actor AND seat_assigned FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF j.posted_by<>p_actor THEN
    PERFORM id FROM public.job_recruiters WHERE job_id=p_job AND recruiter_id=p_actor AND organization_id=p_org FOR SHARE;
    IF NOT FOUND THEN RETURN NULL; END IF;
  END IF;

  IF p_request IS NULL OR p_expected IS NULL OR p_expected<0 OR p_source_hash IS NULL
    OR p_source_hash!~'^[a-f0-9]{64}$' OR p_model IS NULL OR length(p_model) NOT BETWEEN 1 AND 160
    OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_COMMAND';
  END IF;
  IF j.current_jd IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_SOURCE_REQUIRED'; END IF;
  SELECT * INTO s FROM public.job_brief_state WHERE organization_id=p_org AND job_id=p_job FOR UPDATE;
  h:=encode(sha256(convert_to(jsonb_build_object('actor',p_actor,'revision',p_expected,'source',p_source_hash,'action','draft')::text,'UTF8')),'hex');
  UPDATE public.job_brief_draft_requests SET state='unknown',closed_code='BRIEF_MODEL_UNKNOWN',
    lease_token=NULL,lease_deadline=NULL,finished_at=clock_timestamp()
    WHERE organization_id=p_org AND job_id=p_job AND state IN ('reserved','dispatched') AND lease_deadline<=clock_timestamp();
  SELECT * INTO d FROM public.job_brief_draft_requests WHERE request_id=p_request;
  IF FOUND THEN
    IF d.organization_id<>p_org OR d.job_id<>p_job OR d.actor_id<>p_actor OR d.request_hash<>h THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_REQUEST_CONFLICT';
    END IF;
    -- Replays cannot recover the private capability or send a second request.
    RETURN jsonb_build_object('requestId',d.request_id,'state',d.state,'result',d.result,'code',d.closed_code);
  END IF;
  IF coalesce(s.revision,0)<>p_expected OR j.current_jd_hash<>p_source_hash THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_REVISION_CONFLICT';
  END IF;
  IF EXISTS(SELECT 1 FROM public.job_brief_draft_requests WHERE organization_id=p_org AND job_id=p_job AND state IN ('reserved','dispatched')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_DRAFT_INFLIGHT';
  END IF;
  -- Whitespace-only JD edits do not mint a fresh paid attempt budget.
  fingerprint:=encode(sha256(convert_to(regexp_replace(btrim(j.current_jd),'\s+',' ','g'),'UTF8')),'hex');
  SELECT coalesce(max(attempt_number),0)+1 INTO attempt FROM public.job_brief_draft_requests
    WHERE organization_id=p_org AND job_id=p_job AND source_hash=fingerprint;
  IF attempt>2 OR (SELECT count(*) FROM public.job_brief_draft_requests WHERE organization_id=p_org AND job_id=p_job
     AND created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')>=6 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_DRAFT_LIMIT';
  END IF;
  INSERT INTO public.job_brief_state(organization_id,job_id,source_hash) VALUES(p_org,p_job,j.current_jd_hash) ON CONFLICT DO NOTHING;
  INSERT INTO public.job_brief_draft_requests(request_id,organization_id,job_id,actor_id,request_hash,source_hash,expected_revision,
    model_id,attempt_number,state,lease_token,lease_deadline)
    VALUES(p_request,p_org,p_job,p_actor,h,fingerprint,p_expected,p_model,attempt,'dispatched',gen_random_uuid(),clock_timestamp()+interval '60 seconds')
    RETURNING * INTO d;
  RETURN jsonb_build_object('requestId',d.request_id,'state',d.state,'lease',d.lease_token,'currentJD',j.current_jd,
    'sourceHash',j.current_jd_hash,'model',p_model,'title',j.title,'location',j.location);
END;
$$;
REVOKE ALL ON FUNCTION public.flow_job_brief_draft_claim(integer,integer,integer,uuid,bigint,text,text,text) FROM PUBLIC;

CREATE FUNCTION public.flow_job_brief_draft_finish(p_request uuid,p_lease uuid,p_outcome jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE d public.job_brief_draft_requests%ROWTYPE; j public.jobs%ROWTYPE; snapshot jsonb;
 status text; closed text; proposal jsonb; permitted boolean;
BEGIN
  IF p_request IS NULL OR p_lease IS NULL OR jsonb_typeof(p_outcome) IS DISTINCT FROM 'object'
    OR octet_length(p_outcome::text)>65536
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_outcome) k WHERE NOT k=ANY(ARRAY['state','result','code','inputTokens','outputTokens'])) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_OUTCOME';
  END IF;
  SELECT * INTO d FROM public.job_brief_draft_requests WHERE request_id=p_request;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO j FROM public.jobs WHERE id=d.job_id AND organization_id=d.organization_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  snapshot:=public.flow_job_brief_read(d.organization_id,d.job_id,d.actor_id);
  SELECT * INTO d FROM public.job_brief_draft_requests WHERE request_id=p_request FOR UPDATE;
  IF d.state NOT IN ('reserved','dispatched') OR d.lease_token IS DISTINCT FROM p_lease THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_DRAFT_SETTLED';
  END IF;
  permitted:=snapshot IS NOT NULL AND (snapshot->>'revision')::bigint=d.expected_revision;
  status:=p_outcome->>'state'; closed:=p_outcome->>'code'; proposal:=p_outcome->'result';
  IF status IS NULL OR status NOT IN ('succeeded','failed','unknown') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_OUTCOME';
  END IF;
  IF NOT permitted THEN status:='stale'; closed:='BRIEF_DRAFT_STALE'; proposal:=NULL;
  ELSIF d.lease_deadline<=clock_timestamp() THEN status:='unknown'; closed:='BRIEF_MODEL_UNKNOWN'; proposal:=NULL;
  ELSIF status='succeeded' THEN
    IF jsonb_typeof(proposal) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_OUTCOME';
    END IF;
    closed:=NULL;
  ELSE proposal:=NULL;
  END IF;
  UPDATE public.job_brief_draft_requests SET state=status,result=proposal,closed_code=closed,
    lease_token=NULL,lease_deadline=NULL,finished_at=clock_timestamp(),
    input_tokens=(p_outcome->>'inputTokens')::integer,output_tokens=(p_outcome->>'outputTokens')::integer
    WHERE request_id=p_request RETURNING * INTO d;
  RETURN jsonb_build_object('requestId',d.request_id,'state',d.state,'result',d.result,'code',d.closed_code);
END;
$$;
REVOKE ALL ON FUNCTION public.flow_job_brief_draft_finish(uuid,uuid,jsonb) FROM PUBLIC;
