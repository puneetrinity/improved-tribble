-- Removing a library entry is not erasure of application copies or paid-read history.
-- Retain the source journal, detach its library FK, and fence any further source use.
ALTER TABLE public.candidate_source_objects ALTER COLUMN resume_id DROP NOT NULL;
ALTER TABLE public.candidate_source_objects DROP CONSTRAINT candidate_source_objects_resume_id_fkey;
ALTER TABLE public.candidate_source_objects ADD CONSTRAINT candidate_source_objects_resume_id_fkey
 FOREIGN KEY(resume_id) REFERENCES public.candidate_resumes(id) ON DELETE SET NULL;

CREATE FUNCTION public.flow_candidate_source_library_remove() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET lock_timeout='2s' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(41943,OLD.user_id);
 UPDATE public.candidate_source_objects SET restricted=true
 WHERE user_id=OLD.user_id AND resume_id=OLD.id;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_library_remove() FROM PUBLIC;
CREATE TRIGGER candidate_resume_source_detach BEFORE DELETE ON public.candidate_resumes
 FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_source_library_remove();

-- Only IDs and a coarse latest read result, never source content, handles or receipts.
CREATE FUNCTION public.flow_candidate_source_library_status(p_user bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
BEGIN
 IF p_user IS NULL OR p_user NOT BETWEEN 1 AND 2147483647 THEN
  RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user AND role='candidate' AND email_verified IS TRUE)
 THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002';END IF;
 IF EXISTS(SELECT 1 FROM public.candidate_source_erasures WHERE user_id=p_user)
 THEN RETURN '[]'::jsonb;END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('resumeId',r.id,'readFailed',
   coalesce(j.state='unavailable' AND j.reason IN ('unsupported','empty','too_large','provider_refused'),false)) ORDER BY r.id),'[]'::jsonb)
 FROM public.candidate_resumes r
 LEFT JOIN LATERAL (
  SELECT x.state,x.reason FROM public.candidate_source_objects s
  JOIN public.candidate_source_jobs x ON x.source_id=s.source_id AND x.user_id=s.user_id
  WHERE s.resume_id=r.id AND s.user_id=p_user AND NOT s.restricted
  ORDER BY x.created_at DESC,x.command_id DESC LIMIT 1
 ) j ON true WHERE r.user_id=p_user);
END $$;
REVOKE ALL ON FUNCTION public.flow_candidate_source_library_status(bigint) FROM PUBLIC;
