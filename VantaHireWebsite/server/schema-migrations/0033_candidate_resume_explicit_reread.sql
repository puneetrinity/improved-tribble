-- Explicit re-reading of a completed result, without another library upload.
-- GETs and ordinary enqueue requests retain their existing reuse behaviour.
-- Owner serialization, a request receipt per key, and a receipt per original
-- completed command ensure concurrent clicks create only one fresh reading.
-- This is a NEW paid interpretation, not a retry of an uncertain purchase.
-- The existing content-wide three-attempt cap and budget admission still apply.
ALTER TABLE public.candidate_source_jobs ADD COLUMN reread_versions jsonb;
DO $patch$
DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('public.flow_candidate_source_prepare(jsonb)'::regprocedure) INTO body;
 IF position('RETURN s.original_versions||jsonb_build_object' IN body)=0 THEN
  RAISE EXCEPTION 'resume_reread_prepare_anchor_drift';
 END IF;
 EXECUTE replace(body,'RETURN s.original_versions||jsonb_build_object',
  'RETURN coalesce(j.reread_versions,s.original_versions)||jsonb_build_object');
 SELECT pg_get_functiondef('public.flow_candidate_source_retry(bigint,jsonb)'::regprocedure) INTO body;
 IF position('previous_command_id,extraction_document,extraction_context_hash)' IN body)=0
  OR position('command,j.extraction_document,j.extraction_context_hash)' IN body)=0 THEN
  RAISE EXCEPTION 'resume_reread_retry_anchor_drift';
 END IF;
 EXECUTE replace(replace(body,'previous_command_id,extraction_document,extraction_context_hash)',
  'previous_command_id,extraction_document,extraction_context_hash,reread_versions)'),
  'command,j.extraction_document,j.extraction_context_hash)',
  'command,j.extraction_document,j.extraction_context_hash,j.reread_versions)');
END $patch$;
CREATE OR REPLACE FUNCTION public.flow_candidate_source_enqueue(p_user bigint,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE a public.candidate_product_accounts%ROWTYPE;s public.candidate_source_objects%ROWTYPE;j public.candidate_source_jobs%ROWTYPE;
 previous public.candidate_source_requests%ROWTYPE;k uuid;v jsonb;revision bigint;auth integer;
 reread uuid; fresh boolean:=false; cached jsonb; context_hash text; versions jsonb;
BEGIN
 a:=public.flow_candidate_source_owner(p_user);
 -- The repository supplies current Memory versions, never the browser. They
 -- are excluded from the idempotency body: a retry can observe a newer profile.
 versions:=p_request->'_rereadVersions';p_request:=p_request-'_rereadVersions';
 IF NOT coalesce(public.flow_candidate_source_shape(p_request-'rereadOfCommandId',ARRAY['schemaVersion','idempotencyKey','sourceId','sourceVersion']),false)
 OR p_request->'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 BEGIN
  k:=(p_request->>'idempotencyKey')::uuid;
  IF p_request ? 'rereadOfCommandId' THEN
   reread:=(p_request->>'rereadOfCommandId')::uuid;
   IF reread IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
  END IF;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END;
 IF k IS NULL THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT * INTO s FROM public.candidate_source_objects WHERE user_id=p_user AND source_id::text=p_request->>'sourceId';
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 PERFORM public.flow_candidate_source_resolve(p_user,jsonb_build_object('sourceId',s.source_id,'sourceVersion',p_request->'sourceVersion','contentHash',s.content_hash));
 SELECT * INTO previous FROM public.candidate_source_requests WHERE user_id=p_user AND request_key=k;
 IF FOUND THEN
  IF previous.request_body IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  RETURN previous.receipt;
 END IF;
 SELECT version INTO revision FROM public.candidate_consent_subjects WHERE subject_id=a.subject_id;
 IF NOT public.flow_candidate_profile_consent_ready(p_user::integer,a.subject_id,a.binding_id,revision)
 THEN RAISE EXCEPTION 'consent_changed' USING ERRCODE='42501';END IF;
 SELECT auth_version INTO auth FROM public.users WHERE id=p_user;
 IF reread IS NOT NULL THEN
  SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=reread AND source_id=s.source_id AND user_id=p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
  SELECT * INTO previous FROM public.candidate_source_requests WHERE user_id=p_user
   AND request_body->>'sourceId'=s.source_id::text AND request_body->>'rereadOfCommandId'=reread::text LIMIT 1;
  IF FOUND THEN
   v:=public.flow_candidate_source_status_value((previous.receipt->>'commandId')::uuid);
   INSERT INTO public.candidate_source_requests VALUES(p_user,k,p_request,v);RETURN v;
  END IF;
  IF j.state<>'review_ready' OR j.consent_revision<>revision
   OR EXISTS(SELECT 1 FROM public.candidate_source_paid_operations WHERE command_id=j.command_id AND state IN ('reserved','dispatched','held'))
   OR j.command_id IS DISTINCT FROM (SELECT command_id FROM public.candidate_source_jobs WHERE source_id=s.source_id ORDER BY created_at DESC,command_id DESC LIMIT 1)
  THEN RAISE EXCEPTION 'source_changed' USING ERRCODE='40001';END IF;
  fresh:=true;cached:=j.extraction_document;context_hash:=j.extraction_context_hash;
  IF context_hash IS DISTINCT FROM (SELECT encode(sha256(convert_to(username,'UTF8')),'hex') FROM public.users WHERE id=p_user) THEN
   cached:=NULL;context_hash:=NULL;
  END IF;
  IF NOT coalesce(public.flow_candidate_source_shape(versions,ARRAY['originalDraftVersion','originalProfileVersion','originalPreferenceVersion','originalPreferenceDraftRevision']),false)
   OR EXISTS(SELECT 1 FROM jsonb_each(versions) WHERE NOT coalesce(public.flow_candidate_source_uint(value),false))
  THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 END IF;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE source_id=s.source_id ORDER BY created_at DESC,command_id DESC LIMIT 1;
 IF fresh OR NOT FOUND OR (j.consent_revision<>revision AND j.state IN ('review_ready','unavailable','held')
   AND NOT EXISTS(SELECT 1 FROM public.candidate_source_paid_operations WHERE command_id=j.command_id AND state IN ('dispatched','held'))) THEN
  IF (SELECT count(*) FROM public.candidate_source_jobs j0 JOIN public.candidate_source_objects s0 USING(source_id)
   WHERE j0.user_id=p_user AND s0.content_hash=s.content_hash)>=3 THEN RAISE EXCEPTION 'source_attempt_limit' USING ERRCODE='40001';END IF;
  -- No retry ancestry: a settled semantic purchase must not be reused as the new
  -- interpretation. Cached extraction is still validated by extraction_cache;
  -- if it was redacted, the normal budgeted file reader runs instead.
  INSERT INTO public.candidate_source_jobs(user_id,source_id,subject_id,binding_id,consent_revision,admitted_auth_version,extraction_document,extraction_context_hash,reread_versions)
  VALUES(p_user,s.source_id,a.subject_id,a.binding_id,revision,auth,cached,context_hash,CASE WHEN fresh THEN versions ELSE NULL END) RETURNING * INTO j;
 END IF;
 v:=public.flow_candidate_source_status_value(j.command_id);
 INSERT INTO public.candidate_source_requests VALUES(p_user,k,p_request,v);RETURN v;
END $$;
