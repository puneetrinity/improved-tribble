-- The schema-control runner owns the transaction (including test rollbacks).
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

ALTER TABLE public.sourcing_admissions DROP CONSTRAINT src_adm_ranking_ck,
 ADD CONSTRAINT src_adm_ranking_ck CHECK(ranking_contract IS NULL OR (
   jsonb_typeof(ranking_contract)='object' AND octet_length(ranking_contract::text)<=32768
   AND ranking_contract ?& ARRAY['schemaVersion','briefVersionId','materialHash','policyVersion','taxonomyVersion','adapterVersion','localMatchVersion','payload','projectionText','projectionHash','contractHash']
   AND ranking_contract-ARRAY['schemaVersion','briefVersionId','materialHash','policyVersion','taxonomyVersion','adapterVersion','localMatchVersion','payload','projectionText','projectionHash','contractHash']='{}'::jsonb
   AND ranking_contract->'schemaVersion'='1'::jsonb AND ranking_contract->>'adapterVersion'=CASE WHEN ranking_contract->'payload'->'schemaVersion'='4'::jsonb THEN 'rubric-evidence-v2' ELSE 'rubric-evidence-v1' END
   AND (
     (ranking_contract->>'policyVersion'='rubric-range-v1'
       AND ranking_contract->>'taxonomyVersion'='rubric-taxonomy-v3'
       AND ranking_contract->>'localMatchVersion'='rubric-local-match-v3'
       AND ranking_contract->'payload'->'schemaVersion'='2'::jsonb
       AND ranking_contract->'payload'->'compilerVersion'='2'::jsonb
       AND ranking_contract->'payload'->'taxonomyVersion'='2'::jsonb)
     OR (ranking_contract->>'policyVersion'=CASE WHEN ranking_contract->'payload'->'schemaVersion'='4'::jsonb THEN 'rubric-resume-evidence-v1' ELSE 'rubric-approved-skills-v1' END
       AND ranking_contract->>'taxonomyVersion'='rubric-taxonomy-v4'
       AND ranking_contract->>'localMatchVersion'='rubric-local-match-v4'
       AND public.flow_job_brief_validate_v3(ranking_contract->'payload'))
   )
   AND ranking_contract->>'contractHash'=encode(sha256(convert_to(public.flow_sourcing_canonical(ranking_contract-'contractHash'),'UTF8')),'hex')
 ) IS TRUE);

-- New approvals may opt in; historical rows and their hashes are not rewritten.
ALTER TABLE public.job_brief_versions
 DROP CONSTRAINT jb_versions_schema_ck, DROP CONSTRAINT jb_versions_compiler_ck,
 DROP CONSTRAINT jb_versions_taxonomy_ck, DROP CONSTRAINT jb_versions_tuple_ck,
 ADD CONSTRAINT jb_versions_schema_ck CHECK(schema_version IN (1,2,3,4)),
 ADD CONSTRAINT jb_versions_compiler_ck CHECK(compiler_version IN (1,2,3,4)),
 ADD CONSTRAINT jb_versions_taxonomy_ck CHECK(taxonomy_version IN (1,2,3,4)),
 ADD CONSTRAINT jb_versions_tuple_ck CHECK(((schema_version,compiler_version,taxonomy_version)
 IN ((1,1,1),(2,2,2),(3,3,3),(4,4,4))
 AND payload->'schemaVersion'=to_jsonb(schema_version)
 AND payload->'compilerVersion'=to_jsonb(compiler_version)
 AND payload->'taxonomyVersion'=to_jsonb(taxonomy_version)) IS TRUE);
ALTER TABLE public.job_brief_draft_requests DROP CONSTRAINT jb_drafts_prompt_ck,
 ADD CONSTRAINT jb_drafts_prompt_ck CHECK(prompt_version IN (1,2,3,4));

CREATE FUNCTION public.flow_sourcing_contact_allowed(p_org integer,p_job integer,p_candidate integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
SET statement_timeout='3s' SET lock_timeout='1s' AS $$
 SELECT EXISTS(SELECT 1 FROM public.job_sourced_candidates c
  WHERE c.id=p_candidate AND c.organization_id=p_org AND c.job_id=p_job
   AND c.converted_application_id IS NULL AND c.applied_at IS NULL
   AND jsonb_typeof(c.candidate_summary)='object'
   AND (NOT c.candidate_summary ? 'candidateOrigin'
     OR c.candidate_summary->'candidateOrigin'='{"version":1,"kind":"public_profile"}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.flow_sourcing_contact_allowed(integer,integer,integer) FROM PUBLIC;

CREATE FUNCTION public.flow_sourcing_candidate_eligibility(p_tenant text,p_admission uuid,
  p_execution uuid,p_body jsonb,p_body_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
SET statement_timeout='3s' SET lock_timeout='1s' AS $$
DECLARE adm public.sourcing_admissions%ROWTYPE; item jsonb; ident jsonb; bound record;
  decision text; results jsonb:='[]'::jsonb; fresh boolean;
BEGIN
 IF p_tenant IS NULL OR p_admission IS NULL OR p_execution IS NULL
  OR p_body_hash IS NULL OR p_body_hash !~ '^[0-9a-f]{64}$'
  OR jsonb_typeof(p_body) IS DISTINCT FROM 'object' OR octet_length(p_body::text)>65536
  OR NOT p_body ?& ARRAY['version','flowRunId','revisionId','requestId','externalJobId','items']
  OR p_body-ARRAY['version','flowRunId','revisionId','requestId','externalJobId','items']<>'{}'::jsonb
  OR p_body->'version' IS DISTINCT FROM '1'::jsonb
  OR p_body->>'flowRunId' IS DISTINCT FROM p_admission::text
  OR jsonb_typeof(p_body->'items') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_body->'items') NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'SOURCING_CANDIDATE_INVALID'; END IF;
 IF (SELECT count(*) FROM public.organizations WHERE signal_tenant_id=p_tenant)<>1 THEN
  RAISE EXCEPTION 'SOURCING_CANDIDATE_BINDING'; END IF;
 SELECT a.* INTO adm FROM public.sourcing_admissions a
  JOIN public.organizations o ON o.id=a.organization_id
  JOIN public.sourcing_dispatch_outbox b ON b.organization_id=a.organization_id AND b.admission_id=a.id
  WHERE a.id=p_admission AND o.signal_tenant_id=p_tenant
   AND a.state IN ('bound','dispatched','delivered')
   AND a.discover_request_id=p_body->>'requestId'
   AND a.job_id::text=p_body->>'externalJobId'
   AND b.receipt->>'executionAttemptId'=p_execution::text;
 IF NOT FOUND THEN RAISE EXCEPTION 'SOURCING_CANDIDATE_BINDING'; END IF;
 SELECT status='healthy' AND last_success_at>clock_timestamp()-interval '120 seconds' INTO fresh
  FROM public.candidate_privacy_sync_state WHERE consumer_name='flow';
 FOR item IN SELECT value FROM jsonb_array_elements(p_body->'items') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR item-ARRAY['key','identity']<>'{}'::jsonb
   OR NOT item ?& ARRAY['key','identity'] OR jsonb_typeof(item->'key') IS DISTINCT FROM 'string'
   OR length(item->>'key') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'SOURCING_CANDIDATE_INVALID'; END IF;
  ident:=item->'identity';
  IF jsonb_typeof(ident) IS DISTINCT FROM 'object'
   OR NOT ident ?& ARRAY['candidateId','referenceId','applicationId','applicationJobId','resumeVersionId','sourceId','generationId','sourceHash']
   OR ident-ARRAY['candidateId','referenceId','applicationId','applicationJobId','resumeVersionId','sourceId','generationId','sourceHash']<>'{}'::jsonb THEN
   RAISE EXCEPTION 'SOURCING_CANDIDATE_INVALID'; END IF;
  SELECT r.application_id,r.job_id,a.user_id INTO bound
   FROM public.organization_candidate_references r
   JOIN public.applications a ON a.id=r.application_id AND a.organization_id=r.organization_id AND a.job_id=r.job_id
   JOIN public.application_resume_versions v ON v.reference_id=r.reference_id AND v.organization_id=r.organization_id
   JOIN public.organization_candidate_memory_outbox m ON m.reference_id=r.reference_id AND m.organization_id=r.organization_id
   JOIN public.candidate_index_outbox io ON io.reference_id=r.reference_id AND io.organization_id=r.organization_id AND io.resume_version_id=v.resume_version_id
   JOIN public.candidate_index_delivery_state d ON d.outbox_id=io.outbox_id
   WHERE r.organization_id=adm.organization_id AND r.reference_id=(ident->>'referenceId')::uuid
    AND r.application_id=(ident->>'applicationId')::integer AND r.job_id=(ident->>'applicationJobId')::integer
    AND v.resume_version_id=(ident->>'resumeVersionId')::uuid
    AND m.state='acknowledged' AND m.memory_candidate_id=(ident->>'candidateId')::uuid
    AND d.state='accepted' AND d.accepted_source_id=(ident->>'sourceId')::uuid;
  decision:='not_found';
  IF FOUND THEN
   IF fresh IS DISTINCT FROM true THEN decision:='unavailable';
   ELSIF EXISTS(SELECT 1 FROM public.candidate_privacy_subject_links l
    JOIN public.candidate_privacy_requests r ON r.request_id=l.request_id
    LEFT JOIN public.candidate_privacy_remote_projection p ON p.request_id=r.request_id
    WHERE ((l.subject_type='application' AND l.application_id=bound.application_id)
      OR (bound.user_id IS NOT NULL AND l.subject_type='candidate_user' AND l.candidate_user_id=bound.user_id))
     AND r.state IN ('accepted_local','delivery_pending','memory_active','needs_review')
     AND (r.state='needs_review' OR coalesce(p.decision,
       CASE WHEN r.action='request_erasure' THEN 'block_all' ELSE 'block_global' END) IN ('block_all','review')))
     THEN decision:='privacy_restricted';
   ELSIF bound.job_id=adm.job_id OR EXISTS(SELECT 1 FROM public.applications a
     WHERE a.organization_id=adm.organization_id AND a.job_id=adm.job_id
      AND bound.user_id IS NOT NULL AND a.user_id=bound.user_id)
     OR EXISTS(SELECT 1 FROM public.organization_candidate_memory_outbox m
       WHERE m.organization_id=adm.organization_id AND m.job_id=adm.job_id AND m.state='acknowledged'
        AND m.memory_candidate_id=(ident->>'candidateId')::uuid) THEN decision:='same_job';
   ELSE decision:='allow'; END IF;
  END IF;
  results:=results||jsonb_build_array(jsonb_build_object('key',item->>'key','decision',decision));
 END LOOP;
 RETURN jsonb_build_object('version',1,'bodyHash',p_body_hash,'checkedAt',clock_timestamp(),'results',results);
END $$;
REVOKE ALL ON FUNCTION public.flow_sourcing_candidate_eligibility(text,uuid,uuid,jsonb,text) FROM PUBLIC;

DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.flow_job_brief_validate_v3(jsonb)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'e09a774c420365f50cfd79328dfcf8764a01a143612b3b0b71ff43892784d09f' THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 IF (length(definition)-length(replace(definition,'p_payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb','')))/length('p_payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'p_payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb','(p_payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb AND p_payload->''schemaVersion'' IS DISTINCT FROM ''4''::jsonb)');
 IF (length(definition)-length(replace(definition,'p_payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb','')))/length('p_payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'p_payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb','(p_payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb AND p_payload->''compilerVersion'' IS DISTINCT FROM ''4''::jsonb)');
 IF (length(definition)-length(replace(definition,'p_payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb','')))/length('p_payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'p_payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb','(p_payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb AND p_payload->''taxonomyVersion'' IS DISTINCT FROM ''4''::jsonb)');
 IF (length(definition)-length(replace(definition,'OR jsonb_typeof(p_payload->''criteria'') IS DISTINCT FROM ''array''','')))/length('OR jsonb_typeof(p_payload->''criteria'') IS DISTINCT FROM ''array''')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'OR jsonb_typeof(p_payload->''criteria'') IS DISTINCT FROM ''array''','OR p_payload->''schemaVersion'' IS DISTINCT FROM p_payload->''compilerVersion'' OR p_payload->''schemaVersion'' IS DISTINCT FROM p_payload->''taxonomyVersion'' OR jsonb_typeof(p_payload->''criteria'') IS DISTINCT FROM ''array''');
 EXECUTE definition;
END $forward$;

DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.flow_job_brief_save(integer,integer,integer,uuid,bigint,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'fbba503e1c8ea561d24cd1223431ed5db8612affb10e16cdf765383fa9712439' THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 IF (length(definition)-length(replace(definition,'payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb','')))/length('payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb','(payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb AND payload->''schemaVersion'' IS DISTINCT FROM ''4''::jsonb)');
 IF (length(definition)-length(replace(definition,'payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb','')))/length('payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb','(payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb AND payload->''compilerVersion'' IS DISTINCT FROM ''4''::jsonb)');
 IF (length(definition)-length(replace(definition,'payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb','')))/length('payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb','(payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb AND payload->''taxonomyVersion'' IS DISTINCT FROM ''4''::jsonb)');
 IF (length(definition)-length(replace(definition,'(c->>''subject''=''experience_years'' AND NOT c->''evidenceKinds'' @> ''["profile_evidence"]''::jsonb)','')))/length('(c->>''subject''=''experience_years'' AND NOT c->''evidenceKinds'' @> ''["profile_evidence"]''::jsonb)')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'(c->>''subject''=''experience_years'' AND NOT c->''evidenceKinds'' @> ''["profile_evidence"]''::jsonb)','(c->>''subject''=''experience_years'' AND NOT c->''evidenceKinds'' @> ''["profile_evidence"]''::jsonb AND NOT (payload->''schemaVersion''=''4''::jsonb AND c->''evidenceKinds'' @> ''["candidate_provided"]''::jsonb))');
 IF (length(definition)-length(replace(definition,'payload,material,3,3,3,p_actor,workspace','')))/length('payload,material,3,3,3,p_actor,workspace')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'payload,material,3,3,3,p_actor,workspace','payload,material,(payload->>''schemaVersion'')::integer,(payload->>''compilerVersion'')::integer,(payload->>''taxonomyVersion'')::integer,p_actor,workspace');
 EXECUTE definition;
END $forward$;

DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.flow_job_brief_approve(integer,integer,integer,uuid,bigint,uuid,text)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'b903fa32c317bdf1c34c71174a92c3e9e52b5c939c409ca104617b6f73f4a662' THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 IF (length(definition)-length(replace(definition,'v.schema_version<>3 OR v.compiler_version<>3 OR v.taxonomy_version<>3','')))/length('v.schema_version<>3 OR v.compiler_version<>3 OR v.taxonomy_version<>3')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'v.schema_version<>3 OR v.compiler_version<>3 OR v.taxonomy_version<>3','v.schema_version NOT IN (3,4) OR v.compiler_version<>v.schema_version OR v.taxonomy_version<>v.schema_version');
 EXECUTE definition;
END $forward$;

DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.flow_sourcing_digest_claim(integer,integer,integer,uuid,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'7cc38e19fabf35d3b38edf395e2b8213c3eae8e278551ae91c033c5938a2a11f' THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 IF (length(definition)-length(replace(definition,'v.schema_version<>3 OR v.compiler_version<>3 OR v.taxonomy_version<>3','')))/length('v.schema_version<>3 OR v.compiler_version<>3 OR v.taxonomy_version<>3')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'v.schema_version<>3 OR v.compiler_version<>3 OR v.taxonomy_version<>3','v.schema_version NOT IN (3,4) OR v.compiler_version<>v.schema_version OR v.taxonomy_version<>v.schema_version');
 EXECUTE definition;
END $forward$;

DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.flow_job_brief_draft_claim(integer,integer,integer,uuid,bigint,text,text,text)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'041402e16c674680195cf5f3820c102b722b50e5236e040e2a6f3303c59996e7' THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 IF (length(definition)-length(replace(definition,'clock_timestamp()+interval ''60 seconds'',3)','')))/length('clock_timestamp()+interval ''60 seconds'',3)')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'clock_timestamp()+interval ''60 seconds'',3)','clock_timestamp()+interval ''60 seconds'',4)');
 EXECUTE definition;
END $forward$;

DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.flow_job_brief_draft_finish(uuid,uuid,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'a4019fbf28ca2731383a59954bd976fdb6987a2f1a6f23b652616aa34f3ad102' THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 IF (length(definition)-length(replace(definition,'d.prompt_version<>3','')))/length('d.prompt_version<>3')<>2 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'d.prompt_version<>3','d.prompt_version NOT IN (3,4)');
 IF (length(definition)-length(replace(definition,'payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb','')))/length('payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb','(payload->''schemaVersion'' IS DISTINCT FROM ''3''::jsonb AND payload->''schemaVersion'' IS DISTINCT FROM ''4''::jsonb)');
 IF (length(definition)-length(replace(definition,'payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb','')))/length('payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb','(payload->''compilerVersion'' IS DISTINCT FROM ''3''::jsonb AND payload->''compilerVersion'' IS DISTINCT FROM ''4''::jsonb)');
 IF (length(definition)-length(replace(definition,'payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb','')))/length('payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb','(payload->''taxonomyVersion'' IS DISTINCT FROM ''3''::jsonb AND payload->''taxonomyVersion'' IS DISTINCT FROM ''4''::jsonb)');
 IF (length(definition)-length(replace(definition,'(c->>''subject''=''experience_years'' AND NOT c->''evidenceKinds'' @> ''["profile_evidence"]''::jsonb)','')))/length('(c->>''subject''=''experience_years'' AND NOT c->''evidenceKinds'' @> ''["profile_evidence"]''::jsonb)')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'(c->>''subject''=''experience_years'' AND NOT c->''evidenceKinds'' @> ''["profile_evidence"]''::jsonb)','(c->>''subject''=''experience_years'' AND NOT c->''evidenceKinds'' @> ''["profile_evidence"]''::jsonb AND NOT (payload->''schemaVersion''=''4''::jsonb AND c->''evidenceKinds'' @> ''["candidate_provided"]''::jsonb))');
 EXECUTE definition;
END $forward$;

DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.flow_sourcing_quote(integer,integer,integer)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'d1fb4e9b6d2c4db6efe8f4695cbb5b3fd39e9b57ef8521d2caafec26c00445b0' THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 IF (length(definition)-length(replace(definition,'schema_version=3 AND compiler_version=3 AND taxonomy_version=3','')))/length('schema_version=3 AND compiler_version=3 AND taxonomy_version=3')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'schema_version=3 AND compiler_version=3 AND taxonomy_version=3','schema_version IN (3,4) AND compiler_version=schema_version AND taxonomy_version=schema_version');
 EXECUTE definition;
END $forward$;

DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.flow_sourcing_admit(integer,integer,integer,uuid,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'4286a12c6007f0d82b0311d8fac35c0bdaf39e826fdcc77bfc37122a6a082b64' THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 IF (length(definition)-length(replace(definition,'AND schema_version=3;','')))/length('AND schema_version=3;')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'AND schema_version=3;','AND schema_version IN (3,4);');
 IF (length(definition)-length(replace(definition,'''policyVersion'',''rubric-approved-skills-v1''','')))/length('''policyVersion'',''rubric-approved-skills-v1''')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'''policyVersion'',''rubric-approved-skills-v1''','''policyVersion'',CASE WHEN v.schema_version=4 THEN ''rubric-resume-evidence-v1'' ELSE ''rubric-approved-skills-v1'' END');
 IF (length(definition)-length(replace(definition,'''adapterVersion'',''rubric-evidence-v1''','')))/length('''adapterVersion'',''rubric-evidence-v1''')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'''adapterVersion'',''rubric-evidence-v1''','''adapterVersion'',CASE WHEN v.schema_version=4 THEN ''rubric-evidence-v2'' ELSE ''rubric-evidence-v1'' END');
 EXECUTE definition;
END $forward$;

DO $forward$ DECLARE definition text; source text; BEGIN
 SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source FROM pg_proc p WHERE p.oid='public.flow_sourcing_decide(integer,integer,integer,integer,uuid,jsonb)'::regprocedure;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'02a83f5fd4666eb8be61947df3fe5f80611fc5171c522a845768954f1556e3e9' THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 IF (length(definition)-length(replace(definition,'IN (''block_global'',''block_all'',''review'')) THEN RETURN NULL; END IF;','')))/length('IN (''block_global'',''block_all'',''review'')) THEN RETURN NULL; END IF;')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'IN (''block_global'',''block_all'',''review'')) THEN RETURN NULL; END IF;','IN (''block_global'',''block_all'',''review'') AND (coalesce(remote.decision,CASE WHEN r.state=''needs_review'' THEN ''review'' WHEN r.action=''request_erasure'' THEN ''block_all'' ELSE ''block_global'' END)<>''block_global'' OR c.candidate_summary->''candidateOrigin''->>''kind'' IS DISTINCT FROM ''organization_candidate'' OR c.candidate_summary->''candidateOrigin''->''version'' IS DISTINCT FROM ''1''::jsonb)) THEN RETURN NULL; END IF;');
 IF (length(definition)-length(replace(definition,'ELSIF target_state=''shortlisted'' AND coalesce(c.email_resolve_status,'''')','')))/length('ELSIF target_state=''shortlisted'' AND coalesce(c.email_resolve_status,'''')')<>1 THEN RAISE EXCEPTION 'PRIVATE_RESUME_ROUTINE_DRIFT'; END IF;
 definition:=replace(definition,'ELSIF target_state=''shortlisted'' AND coalesce(c.email_resolve_status,'''')','ELSIF target_state=''shortlisted'' AND public.flow_sourcing_contact_allowed(p_org,p_job,p_candidate) AND coalesce(c.email_resolve_status,'''')');
 EXECUTE definition;
END $forward$;
