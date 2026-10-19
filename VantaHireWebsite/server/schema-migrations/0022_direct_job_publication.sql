-- Direct publication of an explicitly approved brief. No existing job is changed.
-- Preserve the complete authority/revision/idempotency checks and function ACL.
DO $forward$
DECLARE definition text; source text; old_branch text; new_branch text;
BEGIN
  SELECT pg_get_functiondef(p.oid),p.prosrc INTO STRICT definition,source
    FROM pg_proc p WHERE p.oid='public.flow_job_brief_save(integer,integer,integer,uuid,bigint,jsonb)'::regprocedure;
  IF encode(sha256(convert_to(source,'UTF8')),'hex')<>'a21368660cb59a0fba4a5a294a48f8220d14797be026e3cb22f99ac57cee2543' THEN
    RAISE EXCEPTION 'DIRECT_PUBLICATION_ROUTINE_DRIFT';
  END IF;
  old_branch:=$old$  ELSIF action='submit' THEN
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
$old$;
  new_branch:=$new$  ELSIF action IN ('submit','publish') THEN
    -- 'submit' is retained for older clients, but now publishes in this transaction.
    -- A recruiter cannot override an administrator's decline.
    IF j.status NOT IN ('draft','pending','approved') OR s.approved_version_id IS NULL
       OR j.current_jd_hash IS DISTINCT FROM s.source_hash
       OR NOT EXISTS(SELECT 1 FROM public.job_brief_versions WHERE organization_id=p_org AND job_id=p_job
         AND version_id=s.latest_version_id AND material_hash=s.approved_material_hash AND source_hash=j.current_jd_hash) THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BRIEF_APPROVAL_REQUIRED';
    END IF;
    IF NOT j.is_active OR j.status<>'approved' THEN
      UPDATE public.jobs SET status='approved',is_active=true,
        reactivated_at=CASE WHEN j.status='approved' THEN clock_timestamp() ELSE reactivated_at END,
        reactivation_count=reactivation_count+CASE WHEN j.status='approved' THEN 1 ELSE 0 END,
        warning_email_sent=false,deactivated_at=NULL,deactivation_reason=NULL,updated_at=clock_timestamp() WHERE id=p_job;
      INSERT INTO public.job_audit_log(organization_id,job_id,action,performed_by,actor_kind)
        VALUES(p_org,p_job,CASE WHEN j.status='approved' THEN 'reactivated' ELSE 'approved' END,p_actor,'user');
    END IF;
$new$;
  IF (length(definition)-length(replace(definition,old_branch,'')))/length(old_branch)<>1 THEN
    RAISE EXCEPTION 'DIRECT_PUBLICATION_ROUTINE_DRIFT';
  END IF;
  EXECUTE replace(definition,old_branch,new_branch);
END $forward$;
