-- Wave 5C forward-only migration. Historical migrations and rows remain unchanged.
-- Brief v2: immutable recruiter-approved title alternatives and experience range.
ALTER TABLE public.job_brief_versions
 DROP CONSTRAINT jb_versions_schema_ck, DROP CONSTRAINT jb_versions_compiler_ck, DROP CONSTRAINT jb_versions_taxonomy_ck,
 ADD CONSTRAINT jb_versions_schema_ck CHECK(schema_version IN (1,2)),
 ADD CONSTRAINT jb_versions_compiler_ck CHECK(compiler_version IN (1,2)),
 ADD CONSTRAINT jb_versions_taxonomy_ck CHECK(taxonomy_version IN (1,2)),
 ADD CONSTRAINT jb_versions_tuple_ck CHECK((
   (schema_version,compiler_version,taxonomy_version) IN ((1,1,1),(2,2,2))
   AND payload->'schemaVersion'=to_jsonb(schema_version)
   AND payload->'compilerVersion'=to_jsonb(compiler_version)
   AND payload->'taxonomyVersion'=to_jsonb(taxonomy_version)) IS TRUE);
ALTER TABLE public.job_brief_draft_requests DROP CONSTRAINT jb_drafts_prompt_ck,
 DROP CONSTRAINT jb_drafts_code_ck,
 ADD CONSTRAINT jb_drafts_prompt_ck CHECK(prompt_version IN (1,2)),
 ADD CONSTRAINT jb_drafts_code_ck CHECK(closed_code IN (
   'BRIEF_MODEL_FAILED','BRIEF_MODEL_TIMEOUT','BRIEF_MODEL_INVALID','BRIEF_MODEL_TRUNCATED',
   'BRIEF_MODEL_UNKNOWN','BRIEF_DRAFT_STALE','BRIEF_UPDATED_APPROVAL_REQUIRED'));

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
        OR payload->'schemaVersion' IS DISTINCT FROM '2'::jsonb OR payload->'compilerVersion' IS DISTINCT FROM '2'::jsonb
        OR payload->'taxonomyVersion' IS DISTINCT FROM '2'::jsonb
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
            CASE WHEN jsonb_typeof(c->'requirement'->'values')='array' THEN ARRAY(SELECT jsonb_array_elements_text(c->'requirement'->'values')) ELSE ARRAY[]::text[] END) AS x(raw)) t
          WHERE trait ~* '^\s*(age|male|female)\s*$'
            OR trait ~* '\m(?:overqualified|under\s*\d{2}|maximum\s+(?:age|experience)|age\s*(?:limit|range|under|below|between|above|over|[<>=]|\d+)|aged\s+\d+|young|youthful|gender|(?:male|female)\s+(?:only|candidates?|applicants?|workers?|engineers?|preferred|required)|(?:only|prefer|preferred|require|required)\s+(?:male|female)|ethnicity|race(?!\s+conditions?\y)|religion|caste|marital|(?:un)?married|pregnan\w*|disabil\w*|nationality|national\s+origin|native(?:[ -]|\s+(?:\w+\s+){0,2})speaker|mother\s+tongue|recent\s+grad\w*|graduation\s+year|career\s+gaps?|elite\s+(?:school|college)|college\s+name|do.not.poach)\M'
            OR (c->>'subject'<>'work_eligibility' AND trait ~* '\m(citizenship|citizens?)\M')) THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        IF c->'requirement'->>'kind' IS NULL OR c->'requirement'->>'kind' NOT IN ('text','minimum_years','experience_range','accepted_titles','boolean')
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(c->'requirement') k
            WHERE NOT k=ANY(CASE c->'requirement'->>'kind' WHEN 'minimum_years' THEN ARRAY['kind','minimum']
              WHEN 'experience_range' THEN ARRAY['kind','minimum','maximum'] WHEN 'accepted_titles' THEN ARRAY['kind','values'] ELSE ARRAY['kind','value'] END))
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
        VALUES(vid,p_org,p_job,vn,jd,sh,payload,material,2,2,2,p_actor);
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
  IF v.schema_version<>2 OR v.compiler_version<>2 OR v.taxonomy_version<>2 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_UPDATED_APPROVAL_REQUIRED';
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

CREATE OR REPLACE FUNCTION public.flow_job_brief_draft_claim(p_org integer,p_job integer,p_actor integer,p_request uuid,
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
    model_id,attempt_number,state,lease_token,lease_deadline,prompt_version)
    VALUES(p_request,p_org,p_job,p_actor,h,fingerprint,p_expected,p_model,attempt,'dispatched',gen_random_uuid(),clock_timestamp()+interval '60 seconds',2)
    RETURNING * INTO d;
  RETURN jsonb_build_object('requestId',d.request_id,'state',d.state,'lease',d.lease_token,'currentJD',j.current_jd,
    'sourceHash',j.current_jd_hash,'model',p_model,'title',j.title,'location',j.location);
END;
$$;
REVOKE ALL ON FUNCTION public.flow_job_brief_draft_claim(integer,integer,integer,uuid,bigint,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.flow_job_brief_draft_finish(p_request uuid,p_lease uuid,p_outcome jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE d public.job_brief_draft_requests%ROWTYPE; j public.jobs%ROWTYPE; snapshot jsonb;
 status text; closed text; proposal jsonb; permitted boolean; payload jsonb; c jsonb; jd text; sh text;
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
  ELSIF d.prompt_version<>2 THEN status:='stale'; closed:='BRIEF_UPDATED_APPROVAL_REQUIRED'; proposal:=NULL;
  ELSIF d.lease_deadline<=clock_timestamp() THEN status:='unknown'; closed:='BRIEF_MODEL_UNKNOWN'; proposal:=NULL;
  ELSIF status='succeeded' THEN
    IF jsonb_typeof(proposal) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_OUTCOME';
    END IF;
    IF d.prompt_version<>2 OR proposal->'schemaVersion' IS DISTINCT FROM to_jsonb(d.prompt_version) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_OUTCOME';
    END IF;
    payload:=proposal; jd:=j.current_jd; sh:=j.current_jd_hash;
      IF jsonb_typeof(payload) IS DISTINCT FROM 'object'
        OR payload->'schemaVersion' IS DISTINCT FROM '2'::jsonb OR payload->'compilerVersion' IS DISTINCT FROM '2'::jsonb
        OR payload->'taxonomyVersion' IS DISTINCT FROM '2'::jsonb
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
            CASE WHEN jsonb_typeof(c->'requirement'->'values')='array' THEN ARRAY(SELECT jsonb_array_elements_text(c->'requirement'->'values')) ELSE ARRAY[]::text[] END) AS x(raw)) t
          WHERE trait ~* '^\s*(age|male|female)\s*$'
            OR trait ~* '\m(?:overqualified|under\s*\d{2}|maximum\s+(?:age|experience)|age\s*(?:limit|range|under|below|between|above|over|[<>=]|\d+)|aged\s+\d+|young|youthful|gender|(?:male|female)\s+(?:only|candidates?|applicants?|workers?|engineers?|preferred|required)|(?:only|prefer|preferred|require|required)\s+(?:male|female)|ethnicity|race(?!\s+conditions?\y)|religion|caste|marital|(?:un)?married|pregnan\w*|disabil\w*|nationality|national\s+origin|native(?:[ -]|\s+(?:\w+\s+){0,2})speaker|mother\s+tongue|recent\s+grad\w*|graduation\s+year|career\s+gaps?|elite\s+(?:school|college)|college\s+name|do.not.poach)\M'
            OR (c->>'subject'<>'work_eligibility' AND trait ~* '\m(citizenship|citizens?)\M')) THEN
          RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='BRIEF_INVALID_PAYLOAD';
        END IF;
        IF c->'requirement'->>'kind' IS NULL OR c->'requirement'->>'kind' NOT IN ('text','minimum_years','experience_range','accepted_titles','boolean')
          OR EXISTS(SELECT 1 FROM jsonb_object_keys(c->'requirement') k
            WHERE NOT k=ANY(CASE c->'requirement'->>'kind' WHEN 'minimum_years' THEN ARRAY['kind','minimum']
              WHEN 'experience_range' THEN ARRAY['kind','minimum','maximum'] WHEN 'accepted_titles' THEN ARRAY['kind','values'] ELSE ARRAY['kind','value'] END))
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


-- The admission transaction compiles the ranking contract from immutable approved
-- bytes. It never accepts browser-provided ranking criteria.
ALTER TABLE public.sourcing_admissions ADD COLUMN ranking_contract jsonb,
 ADD CONSTRAINT src_adm_ranking_ck CHECK(ranking_contract IS NULL OR (
   jsonb_typeof(ranking_contract)='object' AND octet_length(ranking_contract::text)<=32768
   AND ranking_contract ?& ARRAY['schemaVersion','briefVersionId','materialHash','policyVersion','taxonomyVersion','adapterVersion','localMatchVersion','payload','projectionText','projectionHash','contractHash']
   AND ranking_contract-ARRAY['schemaVersion','briefVersionId','materialHash','policyVersion','taxonomyVersion','adapterVersion','localMatchVersion','payload','projectionText','projectionHash','contractHash']='{}'::jsonb
   AND ranking_contract->'schemaVersion'='1'::jsonb AND ranking_contract->>'policyVersion'='rubric-range-v1'
   AND ranking_contract->>'taxonomyVersion'='rubric-taxonomy-v3' AND ranking_contract->>'adapterVersion'='rubric-evidence-v1'
   AND ranking_contract->>'localMatchVersion'='rubric-local-match-v3'
   AND ranking_contract->>'contractHash'=encode(sha256(convert_to(public.flow_sourcing_canonical(ranking_contract-'contractHash'),'UTF8')),'hex')
 ) IS TRUE);
ALTER TABLE public.sourcing_deliveries ADD COLUMN ranking_revision uuid, ADD COLUMN ranking_sha256 text,
 ADD CONSTRAINT src_del_ranking_ck CHECK((ranking_revision IS NULL AND ranking_sha256 IS NULL) OR
   (ranking_revision IS NOT NULL AND ranking_sha256 IS NOT NULL AND ranking_sha256 ~ '^[a-f0-9]{64}$'));
ALTER TABLE public.sourcing_delivery_items ADD COLUMN assessment_sha256 text
 CHECK(assessment_sha256 IS NULL OR assessment_sha256 ~ '^[a-f0-9]{64}$');
CREATE FUNCTION public.flow_sourcing_ranking_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.ranking_contract IS DISTINCT FROM OLD.ranking_contract THEN RAISE EXCEPTION 'SOURCING_RANKING_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_ranking_immutable() FROM PUBLIC;
CREATE TRIGGER src_adm_ranking_immutable BEFORE UPDATE ON public.sourcing_admissions
 FOR EACH ROW EXECUTE FUNCTION public.flow_sourcing_ranking_immutable();

CREATE OR REPLACE FUNCTION public.flow_sourcing_quote(p_org integer,p_job integer,p_actor integer) RETURNS jsonb
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
  IF NOT EXISTS(SELECT 1 FROM public.job_brief_versions WHERE organization_id=p_org AND job_id=p_job
    AND version_id=b.approved_version_id AND schema_version=2 AND compiler_version=2 AND taxonomy_version=2)
  THEN RAISE EXCEPTION 'SOURCING_UPDATED_BRIEF_REQUIRED'; END IF;
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

CREATE OR REPLACE FUNCTION public.flow_sourcing_admit(p_org integer,p_job integer,p_actor integer,p_request uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE q jsonb; a public.sourcing_admissions%ROWTYPE; request_hash text; run_id uuid:=gen_random_uuid();
  o public.sourcing_org_state%ROWTYPE; v public.job_brief_versions%ROWTYPE; ranking jsonb; projection text;
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
    RETURN jsonb_build_object('id',a.id,'state',a.state,'payerUserId',a.payer_user_id,'replayed',true,'rankingContract',a.ranking_contract);
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
  SELECT * INTO v FROM public.job_brief_versions WHERE organization_id=p_org AND job_id=p_job
    AND version_id=(q->>'briefVersionId')::uuid AND material_hash=q->>'materialHash' AND schema_version=2;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_UPDATED_BRIEF_REQUIRED'; END IF;
  SELECT public.flow_sourcing_canonical(jsonb_agg(projected ORDER BY public.flow_sourcing_canonical(projected) COLLATE "C"))
    INTO projection FROM (SELECT jsonb_build_object('subject',c->'subject','class',c->'class',
      'requirement',c->'requirement','evidenceKinds',c->'evidenceKinds') projected FROM jsonb_array_elements(v.payload->'criteria') c) items;
  ranking:=jsonb_build_object('schemaVersion',1,'briefVersionId',v.version_id,'materialHash',v.material_hash,
    'policyVersion','rubric-range-v1','taxonomyVersion','rubric-taxonomy-v3','adapterVersion','rubric-evidence-v1',
    'localMatchVersion','rubric-local-match-v3','payload',v.payload,'projectionText',projection,
    'projectionHash',encode(sha256(convert_to(to_jsonb(projection)::text,'UTF8')),'hex'));
  ranking:=ranking||jsonb_build_object('contractHash',encode(sha256(convert_to(public.flow_sourcing_canonical(ranking),'UTF8')),'hex'));
  IF octet_length(public.flow_sourcing_canonical(ranking))>32768 THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  INSERT INTO public.sourcing_allowance_windows(organization_id,slot_id,starts_at,ends_at,entitlement_id)
    VALUES(p_org,(q->>'payerSlotId')::uuid,(q->>'windowStart')::timestamptz,(q->>'windowEnd')::timestamptz,o.entitlement_id)
    ON CONFLICT(slot_id,starts_at) DO NOTHING;
  UPDATE public.sourcing_allowance_windows SET reserved=reserved+1,revision=revision+1
    WHERE organization_id=p_org AND slot_id=(q->>'payerSlotId')::uuid AND starts_at=(q->>'windowStart')::timestamptz AND reserved+captured<5;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_ALLOWANCE_EXHAUSTED'; END IF;
  INSERT INTO public.sourcing_admissions(id,organization_id,job_id,request_id,request_sha256,actor_user_id,payer_user_id,payer_slot_id,window_start,artifact_id,state,ranking_contract)
    VALUES(run_id,p_org,p_job,p_request,request_hash,p_actor,(q->>'payerUserId')::integer,(q->>'payerSlotId')::uuid,(q->>'windowStart')::timestamptz,(q->>'artifactId')::uuid,'reserved',ranking);
  INSERT INTO public.sourcing_account_events(id,organization_id,admission_id,kind,evidence_sha256) VALUES(gen_random_uuid(),p_org,run_id,'reserve',request_hash);
  INSERT INTO public.sourcing_dispatch_outbox(admission_id,organization_id,state) VALUES(run_id,p_org,'pending');
  INSERT INTO public.job_sourcing_runs(organization_id,job_id,request_id,external_job_id,status,context_hash,sourcing_admission_id)
    VALUES(p_org,p_job,'flow:'||run_id::text,'vanta:jobs:'||p_job::text,'pending',q->>'materialHash',run_id);
  RETURN jsonb_build_object('id',run_id,'state','reserved','payerUserId',(q->>'payerUserId')::integer,'replayed',false,'rankingContract',ranking);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_admit(integer,integer,integer,uuid,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.flow_sourcing_dispatch_claim(p_worker uuid) RETURNS jsonb
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
    'command',jsonb_build_object('protocolVersion',CASE WHEN adm.ranking_contract IS NULL THEN 1 ELSE 2 END,'flowRunId',adm.id,'organizationRef',org_id::text,'externalJobId','vanta:jobs:'||adm.job_id::text,
      'briefVersionId',artifact.brief_version_id,'materialHash',artifact.material_hash,'artifactHash',artifact.query_hash,'compilerVersion',artifact.compiler_version,'queryArtifact',artifact.input)||CASE WHEN adm.ranking_contract IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('rankingContract',adm.ranking_contract) END);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_dispatch_claim(uuid) FROM PUBLIC;


CREATE OR REPLACE FUNCTION public.flow_sourcing_enable(p_org integer,p_entitlement uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.sourcing_org_state%ROWTYPE; e public.sourcing_entitlements%ROWTYPE;
BEGIN
  PERFORM id FROM public.organizations WHERE id=p_org FOR NO KEY UPDATE;
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

CREATE OR REPLACE FUNCTION public.flow_sourcing_digest_claim(p_org integer,p_job integer,p_actor integer,p_request uuid,p_command jsonb) RETURNS jsonb
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
  IF v.schema_version<>2 OR v.compiler_version<>2 OR v.taxonomy_version<>2 THEN
    RAISE EXCEPTION 'SOURCING_UPDATED_BRIEF_REQUIRED';
  END IF;
  IF v.source_hash IS DISTINCT FROM j.current_jd_hash THEN RAISE EXCEPTION 'SOURCING_QUERY_STALE'; END IF;
  basis:=jsonb_build_object('briefVersionId',v.version_id,'materialHash',v.material_hash,'sourceHash',v.source_hash,
    'title',j.title,'location',j.location,'payload',v.payload);
  basis_hash:=encode(sha256(convert_to(public.flow_sourcing_canonical(basis),'UTF8')),'hex');
  SELECT * INTO d FROM public.sourcing_digest_requests WHERE organization_id=p_org AND job_id=p_job AND brief_version_id=v.version_id AND source_hash=basis_hash AND model=model_name FOR UPDATE;
  IF NOT FOUND THEN
    IF action NOT IN ('schedule','retry') THEN RAISE EXCEPTION 'SOURCING_DIGEST_RETRY_REFUSED'; END IF;
    INSERT INTO public.sourcing_digest_requests(id,organization_id,job_id,brief_version_id,actor_user_id,source_hash,request_sha256,model,state)
      VALUES(p_request,p_org,p_job,v.version_id,p_actor,basis_hash,basis_hash,model_name,'reserved') RETURNING * INTO d;
    -- A missing preparation is its initial attempt, not a consumed retry.
    action:='schedule';
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

CREATE OR REPLACE FUNCTION public.flow_sourcing_deliver(p_org integer,p_admission uuid,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE adm public.sourcing_admissions%ROWTYPE; delivery public.sourcing_deliveries%ROWTYPE;
  artifact public.sourcing_query_artifacts%ROWTYPE; proof jsonb; payload_hash text; next_revision integer; entry record;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object'
    OR p_command-ARRAY['requestId','executionAttemptId','artifactHash','revision','orderedSignalIds','rankingRevision','rankingHash','contractHash']<>'{}'::jsonb
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
  IF adm.ranking_contract IS NOT NULL THEN
    IF NOT p_command ?& ARRAY['rankingRevision','rankingHash','contractHash']
      OR p_command->>'contractHash' IS DISTINCT FROM adm.ranking_contract->>'contractHash'
      OR p_command->>'rankingRevision' IS NULL OR (p_command->>'rankingHash') !~ '^[a-f0-9]{64}$'
      OR p_command->>'rankingHash' IS NULL OR p_command->>'revision'<>'1' THEN RAISE EXCEPTION 'SOURCING_RANKING_CONFLICT'; END IF;
    PERFORM (p_command->>'rankingRevision')::uuid;
    IF EXISTS(SELECT 1 FROM public.job_sourced_candidates c
      JOIN jsonb_array_elements_text(p_command->'orderedSignalIds') ids(value) ON c.signal_candidate_id=ids.value
      WHERE c.organization_id=p_org AND c.job_id=adm.job_id AND c.request_id=adm.discover_request_id
        AND (c.candidate_summary->'ranking'->>'candidateId' IS DISTINCT FROM c.signal_candidate_id
          OR c.candidate_summary->'ranking'->>'revisionId' IS DISTINCT FROM p_command->>'rankingRevision'
          OR c.candidate_summary->'ranking'->>'contractHash' IS DISTINCT FROM p_command->>'contractHash'
          OR c.candidate_summary->'ranking'->>'outputHash' IS DISTINCT FROM p_command->>'rankingHash'
          OR coalesce(c.candidate_summary->'ranking'->>'ordinal','') !~ '^(100|[1-9][0-9]?)$'))
      THEN RAISE EXCEPTION 'SOURCING_RANKING_CONFLICT'; END IF;
  ELSIF p_command ?| ARRAY['rankingRevision','rankingHash','contractHash'] THEN RAISE EXCEPTION 'SOURCING_RANKING_CONFLICT';
  END IF;
  next_revision:=(p_command->>'revision')::integer;
  payload_hash:=encode(sha256(convert_to(public.flow_sourcing_canonical(CASE WHEN adm.ranking_contract IS NULL THEN p_command->'orderedSignalIds' ELSE p_command END),'UTF8')),'hex');
  -- An old, once-valid delivery is not a replay of the current projection.
  -- Refuse it before returning replay success so its caller rolls back upserts.
  IF EXISTS(SELECT 1 FROM public.sourcing_deliveries WHERE admission_id=adm.id AND revision>next_revision) THEN RAISE EXCEPTION 'SOURCING_REVISION_CONFLICT'; END IF;
  SELECT * INTO delivery FROM public.sourcing_deliveries WHERE admission_id=adm.id AND revision=next_revision;
  IF FOUND THEN
    IF delivery.execution_attempt_id<>p_command->>'executionAttemptId' THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
    IF adm.ranking_contract IS NULL THEN
      IF delivery.payload_sha256<>payload_hash THEN RAISE EXCEPTION 'SOURCING_REQUEST_CONFLICT'; END IF;
    ELSE
      -- Privacy may remove cards between reads. Accept only an unchanged
      -- subsequence of the original delivery; never insert a replacement.
      IF delivery.ranking_revision IS DISTINCT FROM (p_command->>'rankingRevision')::uuid
        OR delivery.ranking_sha256 IS DISTINCT FROM p_command->>'rankingHash'
        OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_command->'orderedSignalIds') ids(value)
          WHERE NOT EXISTS(SELECT 1 FROM public.sourcing_delivery_items i
            JOIN public.job_sourced_candidates c ON c.id=i.sourced_candidate_id AND c.organization_id=i.organization_id
            WHERE i.delivery_id=delivery.id AND i.organization_id=p_org AND i.signal_candidate_id=ids.value
              AND i.ordinal=(c.candidate_summary->'ranking'->>'ordinal')::integer
              AND i.assessment_sha256=encode(sha256(convert_to(public.flow_sourcing_canonical(c.candidate_summary->'ranking'),'UTF8')),'hex')))
        THEN RAISE EXCEPTION 'SOURCING_RANKING_CONFLICT'; END IF;
    END IF;
    RETURN jsonb_build_object('id',delivery.id,'revision',delivery.revision,'replayed',true);
  END IF;
  INSERT INTO public.sourcing_deliveries(id,organization_id,job_id,admission_id,revision,execution_attempt_id,payload_sha256,count,ranking_revision,ranking_sha256)
    VALUES(gen_random_uuid(),p_org,adm.job_id,adm.id,next_revision,p_command->>'executionAttemptId',payload_hash,jsonb_array_length(p_command->'orderedSignalIds'),(p_command->>'rankingRevision')::uuid,p_command->>'rankingHash') RETURNING * INTO delivery;
  -- The caller already applied the healthy privacy authority. Store references
  -- only to its existing scoped projection, never insert candidate data here.
  -- A denied/not-ingested candidate has no local item; retain original ordinals.
  FOR entry IN SELECT c.id,c.signal_candidate_id,
    CASE WHEN adm.ranking_contract IS NULL THEN ids.ordinality ELSE (c.candidate_summary->'ranking'->>'ordinal')::integer END ordinality,
    CASE WHEN adm.ranking_contract IS NULL THEN NULL ELSE encode(sha256(convert_to(public.flow_sourcing_canonical(c.candidate_summary->'ranking'),'UTF8')),'hex') END assessment_hash
    FROM jsonb_array_elements_text(p_command->'orderedSignalIds') WITH ORDINALITY ids(value,ordinality)
    JOIN public.job_sourced_candidates c ON c.signal_candidate_id=ids.value AND c.organization_id=p_org AND c.job_id=adm.job_id AND c.request_id=adm.discover_request_id
  LOOP
    INSERT INTO public.sourcing_delivery_items(organization_id,job_id,delivery_id,ordinal,sourced_candidate_id,signal_candidate_id,assessment_sha256)
      VALUES(p_org,adm.job_id,delivery.id,entry.ordinality,entry.id,entry.signal_candidate_id,entry.assessment_hash);
  END LOOP;
  UPDATE public.sourcing_admissions SET state='delivered',revision=revision+1,updated_at=clock_timestamp() WHERE id=adm.id;
  RETURN jsonb_build_object('id',delivery.id,'revision',delivery.revision,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_deliver(integer,uuid,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.flow_sourcing_run_binding(p_org integer,p_job integer,p_request text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT jsonb_build_object('flowRunId',adm.id,'artifactHash',artifact.query_hash,'executionAttemptId',box.receipt->>'executionAttemptId') || CASE WHEN adm.ranking_contract IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('protocolVersion',2,'contractHash',adm.ranking_contract->>'contractHash',
    'delivery',(SELECT jsonb_build_object('revisionId',d.ranking_revision,'outputHash',d.ranking_sha256,
      'items',coalesce((SELECT jsonb_agg(jsonb_build_object('candidateId',i.signal_candidate_id,'ordinal',i.ordinal,'assessmentHash',i.assessment_sha256) ORDER BY i.ordinal)
        FROM public.sourcing_delivery_items i WHERE i.delivery_id=d.id AND i.organization_id=p_org),'[]'::jsonb))
      FROM public.sourcing_deliveries d WHERE d.admission_id=adm.id AND d.organization_id=p_org ORDER BY d.revision DESC LIMIT 1)) END
  FROM public.sourcing_admissions adm JOIN public.sourcing_query_artifacts artifact ON artifact.id=adm.artifact_id AND artifact.organization_id=adm.organization_id
    JOIN public.sourcing_dispatch_outbox box ON box.admission_id=adm.id AND box.organization_id=adm.organization_id
  WHERE adm.organization_id=p_org AND adm.job_id=p_job AND adm.discover_request_id=p_request
$$;
REVOKE ALL ON FUNCTION public.flow_sourcing_run_binding(integer,integer,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.flow_sourcing_digest_finish(p_request uuid,p_lease uuid,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='2s' SET statement_timeout='5s' AS $$
DECLARE d public.sourcing_digest_requests%ROWTYPE; state_name text;
BEGIN
  IF p_lease IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>65536
    OR p_result-ARRAY['state','digest','inputTokens','outputTokens','code','criterionIds']<>'{}'::jsonb
    OR NOT p_result ? 'state' OR p_result->>'state' NOT IN ('succeeded','failed','unknown') THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
  IF p_result->>'state' IN ('failed','unknown') AND
    ((p_result->>'code' IN ('SOURCING_DIGEST_UNAUTHORIZED','SOURCING_DIGEST_RATE_LIMITED','SOURCING_DIGEST_UNKNOWN',
      'SOURCING_DIGEST_NO_DISPATCH','SOURCING_DIGEST_TRUNCATED','SOURCING_DIGEST_INVALID','QUERY_MAPPING_UNSUPPORTED','SOURCING_QUERY_STALE')) IS NOT TRUE)
    THEN RAISE EXCEPTION 'SOURCING_INVALID_COMMAND'; END IF;
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
