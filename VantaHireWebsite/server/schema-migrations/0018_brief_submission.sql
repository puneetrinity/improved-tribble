-- Forward-only: required foundations and one automatic draft per job.
-- Submission state will be added within this unshipped migration before sealing.
CREATE OR REPLACE FUNCTION public.flow_job_brief_approve(p_org integer,p_job integer,p_actor integer,p_request uuid,
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
  IF v.schema_version<>3 OR v.compiler_version<>3 OR v.taxonomy_version<>3 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_UPDATED_APPROVAL_REQUIRED';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(v.payload->'criteria') c WHERE c->>'subject'='experience_years')<>1
    OR (SELECT count(*) FROM jsonb_array_elements(v.payload->'criteria') c WHERE c->>'subject'='location')<>1
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.payload->'criteria') c
      WHERE c->>'subject'='location' AND c->'requirement'->>'kind'='text'
      AND length(btrim(c->'requirement'->>'value'))>0) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_FOUNDATIONS_REQUIRED';
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


-- Both entrypoints keep the existing scope and quota authority. The job lock
-- serializes the first automatic dispatch across actors, tabs and request IDs.
CREATE FUNCTION public.flow_job_brief_draft_claim(p_org integer,p_job integer,p_actor integer,p_request uuid,
 p_expected bigint,p_source_hash text,p_model text,p_request_hash text,p_mode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE snapshot jsonb;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('manual','automatic') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_COMMAND';
  END IF;
  IF p_mode='automatic' THEN
    PERFORM id FROM public.jobs WHERE id=p_job AND organization_id=p_org FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    snapshot:=public.flow_job_brief_read(p_org,p_job,p_actor);
    IF snapshot IS NULL THEN RETURN NULL; END IF;
    IF snapshot->'latest' IS NOT NULL AND snapshot->'latest'<>'null'::jsonb
      OR EXISTS(SELECT 1 FROM public.job_brief_draft_requests WHERE organization_id=p_org AND job_id=p_job) THEN
      RETURN jsonb_build_object('state','skipped');
    END IF;
  END IF;
  RETURN public.flow_job_brief_draft_claim(p_org,p_job,p_actor,p_request,p_expected,p_source_hash,p_model,p_request_hash);
END;
$$;
REVOKE ALL ON FUNCTION public.flow_job_brief_draft_claim(integer,integer,integer,uuid,bigint,text,text,text,text) FROM PUBLIC;
-- Keep event history immutable while allowing the explicit final submission.
ALTER TABLE public.job_brief_events DROP CONSTRAINT jb_events_action_ck;
ALTER TABLE public.job_brief_events ADD CONSTRAINT jb_events_action_ck
  CHECK (action IN ('save_brief','edit_governed_job','moderate','publish','deactivate','approve','submit'));

CREATE OR REPLACE FUNCTION public.flow_job_brief_save(p_org integer,p_job integer,p_actor integer,p_request uuid,
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
  IF action IS NULL OR action NOT IN ('save_brief','edit_governed_job','moderate','publish','deactivate','submit') THEN
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
      IF NOT public.flow_job_brief_validate_v3(payload) OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
        OR payload->'schemaVersion' IS DISTINCT FROM '3'::jsonb OR payload->'compilerVersion' IS DISTINCT FROM '3'::jsonb
        OR payload->'taxonomyVersion' IS DISTINCT FROM '3'::jsonb
        OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE NOT k=ANY(ARRAY['schemaVersion','compilerVersion','taxonomyVersion','criteria']))
        OR jsonb_typeof(payload->'criteria') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
      END IF;
      IF jsonb_array_length(payload->'criteria') NOT BETWEEN 1 AND 12
        OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(payload->'criteria'))<>jsonb_array_length(payload->'criteria') THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
      END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'criteria') value WHERE value->>'subject' IN ('title','experience_years') GROUP BY value->>'subject' HAVING count(*)>1) THEN
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
          OR (c->>'subject'='experience_years') IS DISTINCT FROM (c->'requirement'->>'kind' IN ('minimum_years','experience_range'))
          OR (c->>'subject'='title') IS DISTINCT FROM (c->'requirement'->>'kind'='accepted_titles')
          OR (c->>'subject' IN ('experience_years','title') AND c->>'use'<>'assessment')
          OR (c->>'subject'='experience_years' AND NOT c->'evidenceKinds' @> '["profile_evidence"]'::jsonb)
          OR (c->>'subject'='experience_years' AND c->>'class'='disqualifier') THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        PERFORM (c->>'id')::uuid;
        IF EXISTS (SELECT 1 FROM (SELECT CASE WHEN c->>'subject'='experience_years' THEN regexp_replace(raw,'\mmaximum\s+experience\M','experience','gi') ELSE raw END trait
          FROM unnest(ARRAY[c->>'label',c->'requirement'->>'value',c->>'note'] ||
            CASE WHEN jsonb_typeof(c->'requirement'->'values')='array' THEN ARRAY(SELECT jsonb_array_elements_text(c->'requirement'->'values')) ELSE ARRAY[]::text[] END || CASE WHEN c->'requirement'->>'kind'='accepted_skills' THEN ARRAY[c->'requirement'->>'primary'] || ARRAY(SELECT jsonb_array_elements_text(c->'requirement'->'alternatives')) ELSE ARRAY[]::text[] END) AS x(raw)) t
          WHERE trait ~* '^\s*(age|male|female)\s*$'
            OR trait ~* '\m(?:overqualified|under\s*\d{2}|maximum\s+(?:age|experience)|age\s*(?:limit|range|under|below|between|above|over|[<>=]|\d+)|aged\s+\d+|young|youthful|gender|(?:male|female)\s+(?:only|candidates?|applicants?|workers?|engineers?|preferred|required)|(?:only|prefer|preferred|require|required)\s+(?:male|female)|ethnicity|race(?!\s+conditions?\y)|religion|caste|marital|(?:un)?married|pregnan\w*|disabil\w*|nationality|national\s+origin|native(?:[ -]|\s+(?:\w+\s+){0,2})speaker|mother\s+tongue|recent\s+grad\w*|graduation\s+year|career\s+gaps?|elite\s+(?:school|college)|college\s+name|do.not.poach)\M'
            OR (c->>'subject'<>'work_eligibility' AND trait ~* '\m(citizenship|citizens?)\M')) THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        IF c->'requirement'->>'kind' IS NULL OR c->'requirement'->>'kind' NOT IN ('text','minimum_years','experience_range','accepted_titles','accepted_skills','boolean')
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(c->'requirement') k
            WHERE NOT k=ANY(CASE c->'requirement'->>'kind' WHEN 'minimum_years' THEN ARRAY['kind','minimum']
              WHEN 'experience_range' THEN ARRAY['kind','minimum','maximum'] WHEN 'accepted_titles' THEN ARRAY['kind','values'] WHEN 'accepted_skills' THEN ARRAY['kind','primary','alternatives'] ELSE ARRAY['kind','value'] END))
          OR (c->'requirement'->>'kind'='text' AND (jsonb_typeof(c->'requirement'->'value') IS DISTINCT FROM 'string'
            OR length(btrim(c->'requirement'->>'value')) NOT BETWEEN 1 AND 500))
          OR (c->'requirement'->>'kind' IN ('minimum_years','experience_range') AND (jsonb_typeof(c->'requirement'->'minimum') IS DISTINCT FROM 'number'))
          OR (c->'requirement'->>'kind'='boolean' AND (c->'requirement'->>'value' IS NULL OR c->'requirement'->>'value' NOT IN ('yes','no','unknown')))
          OR jsonb_array_length(c->'evidenceKinds') NOT BETWEEN 1 AND 4
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(c->'evidenceKinds') k WHERE k IS NULL OR k NOT IN ('candidate_provided','verified_document','profile_evidence','recruiter_judgement'))
          OR (c->>'subject' IN ('responsibility','leadership','availability') AND (c->>'use'<>'assessment' OR c->'evidenceKinds'<>'["recruiter_judgement"]'::jsonb))
          OR (c->>'subject'='work_eligibility' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(c->'evidenceKinds') k WHERE k NOT IN ('candidate_provided','verified_document')))
          OR coalesce(length(c->>'note'),0)>300 THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        IF c->'requirement'->>'kind' IN ('minimum_years','experience_range') AND (c->'requirement'->>'minimum')::numeric NOT BETWEEN 0 AND 80 THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        IF c->'requirement'->>'kind'='experience_range' THEN
          IF jsonb_typeof(c->'requirement'->'maximum') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
          END IF;
          IF (c->'requirement'->>'maximum')::numeric NOT BETWEEN (c->'requirement'->>'minimum')::numeric AND 80 THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
          END IF;
        END IF;
        IF c->'requirement'->>'kind'='accepted_titles' THEN
          IF jsonb_typeof(c->'requirement'->'values') IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
          END IF;
          IF jsonb_array_length(c->'requirement'->'values') NOT BETWEEN 1 AND 20
            OR EXISTS(SELECT 1 FROM jsonb_array_elements(c->'requirement'->'values') t WHERE jsonb_typeof(t)<>'string' OR length(btrim(t#>>'{}')) NOT BETWEEN 1 AND 120)
            OR (SELECT count(DISTINCT lower(regexp_replace(btrim(normalize(t,NFKC)),'\s+',' ','g')) COLLATE "C") FROM jsonb_array_elements_text(c->'requirement'->'values') t) <> jsonb_array_length(c->'requirement'->'values') THEN
            RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
          END IF;
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
        VALUES(vid,p_org,p_job,vn,jd,sh,payload,material,3,3,3,p_actor);
      s.latest_version_id:=vid;
      IF material_changed THEN s.approved_version_id:=NULL; s.approved_material_hash:=NULL; END IF;
      UPDATE public.jobs SET current_jd=jd,current_jd_hash=sh,
        jd_digest=CASE WHEN current_jd_hash IS DISTINCT FROM sh THEN NULL ELSE jd_digest END,
        jd_digest_version=CASE WHEN current_jd_hash IS DISTINCT FROM sh THEN NULL ELSE jd_digest_version END,
        updated_at=clock_timestamp() WHERE id=p_job AND organization_id=p_org;
    END IF;
    s.source_hash:=sh;
    -- A submitted new-workflow job with changed criteria returns to draft;
    -- admin must never review an incomplete replacement. Legacy pending jobs
    -- without a submission event retain their historical lifecycle.
    IF j.status='pending' AND s.approved_version_id IS NULL
      AND EXISTS(SELECT 1 FROM public.job_brief_events submitted WHERE submitted.organization_id=p_org AND submitted.job_id=p_job AND submitted.action='submit') THEN
      UPDATE public.jobs SET status='draft',is_active=false,updated_at=clock_timestamp() WHERE id=p_job;
    END IF;
  ELSIF action='submit' THEN
    IF j.status<>'draft' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_SUBMISSION_REQUIRED';
    END IF;
    IF s.approved_version_id IS NULL OR j.current_jd_hash IS DISTINCT FROM s.source_hash
       OR NOT EXISTS(SELECT 1 FROM public.job_brief_versions WHERE organization_id=p_org AND job_id=p_job
         AND version_id=s.latest_version_id AND material_hash=s.approved_material_hash AND source_hash=j.current_jd_hash) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_APPROVAL_REQUIRED';
    END IF;
    UPDATE public.jobs SET status='pending',is_active=false,updated_at=clock_timestamp() WHERE id=p_job;
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
    IF j.status='draft' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_SUBMISSION_REQUIRED';
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



