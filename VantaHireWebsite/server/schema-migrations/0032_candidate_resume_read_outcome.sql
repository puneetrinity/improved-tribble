-- ONB-2: remember, per résumé read, that it produced nothing usable, after the proposal is cleaned up.
-- One coarse value per read job: 'unreadable' (the model's output could not be read) or 'unmatched'
-- (details came back but none could be matched to the résumé text). NULL means a normal read, a genuine
-- "nothing to add", or an older read whose outcome was never recorded (left unknown, not guessed).
-- No model output or résumé content is stored. Payload redaction does not clear it. The library shows
-- each résumé's latest read, so a later successful read clears the label.
ALTER TABLE public.candidate_source_jobs ADD COLUMN read_outcome text
 CHECK (read_outcome IS NULL OR read_outcome IN ('unreadable','unmatched'));

-- The two hashes are SHA-256 (UTF-8) of the server-added notes in shared/resume-review-notes.ts
-- (RESUME_UNREADABLE_NOTE, RESUME_UNMATCHED_NOTE), checked only as the first review note when no facts
-- were kept. Hashes keep the routine ASCII-only, so its catalogue digest does not depend on database
-- encoding. The library-status database test builds the notes from that file.
CREATE OR REPLACE FUNCTION public.flow_candidate_source_transfer_finish(p_lease jsonb,p_document jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' SET lock_timeout='2s' AS $$
DECLARE j public.candidate_source_jobs%ROWTYPE;v jsonb;t jsonb;k text;
BEGIN
 IF NOT coalesce(public.flow_candidate_source_shape(p_lease,ARRAY['commandId','claimToken','generation']),false) THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id::text=p_lease->>'commandId';
 IF NOT FOUND THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
 PERFORM pg_advisory_xact_lock(41943,j.user_id);PERFORM 1 FROM public.users WHERE id=j.user_id FOR UPDATE;
 SELECT * INTO j FROM public.candidate_source_jobs WHERE command_id=j.command_id FOR UPDATE;
 v:=public.flow_candidate_source_document(p_document);
 IF j.receipt_document IS NOT NULL THEN
  IF j.receipt_document IS DISTINCT FROM p_document THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='23505';END IF;
  IF j.lease_token::text IS DISTINCT FROM p_lease->>'claimToken' OR j.generation::text IS DISTINCT FROM p_lease->>'generation' THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
  RETURN public.flow_candidate_source_status_value(j.command_id);
 END IF;
 IF j.lease_token::text IS DISTINCT FROM p_lease->>'claimToken' OR j.generation::text IS DISTINCT FROM p_lease->>'generation'
 OR j.lease_until IS NULL OR j.lease_until<=clock_timestamp() OR j.transfer_document IS NULL THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001';END IF;
 t:=(j.transfer_document->>'canonical')::jsonb;
 IF NOT coalesce(public.flow_candidate_source_shape(v,ARRAY['schemaVersion','commandId','subjectId','bindingId','commandHash','sourceId','sourceVersion','proposalId','proposalHash','outcome','reason','canonicalProfileChanged','publicationActive']),false)
 OR v->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR v->'canonicalProfileChanged' IS DISTINCT FROM 'false'::jsonb OR v->'publicationActive' IS DISTINCT FROM 'false'::jsonb
 OR v->'commandHash' IS DISTINCT FROM j.transfer_document->'sha256'
 OR v->'proposalId' IS DISTINCT FROM t->'proposal'->'proposalId' OR v->'proposalHash' IS DISTINCT FROM t->'proposal'->'proposalHash'
 OR ((v->>'outcome'='stored' AND v->'reason'='null'::jsonb) OR (v->>'outcome'='rejected' AND v->>'reason' IN ('consent_changed','source_conflict','stale_edit','proposal_expired'))) IS NOT TRUE
 THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY ARRAY['commandId','subjectId','bindingId','sourceId','sourceVersion'] LOOP
  IF v->k IS DISTINCT FROM t->k THEN RAISE EXCEPTION 'invalid_request' USING ERRCODE='22023';END IF;
 END LOOP;
 UPDATE public.candidate_source_jobs SET receipt_document=p_document,acknowledged_at=clock_timestamp(),
 state=CASE WHEN v->>'outcome'='stored' THEN 'review_ready' ELSE 'unavailable' END,
 proposal_id=CASE WHEN v->>'outcome'='stored' THEN (v->>'proposalId')::uuid ELSE NULL END,
 reason=CASE WHEN v->>'outcome'='stored' THEN NULL WHEN v->>'reason'='consent_changed' THEN 'consent_changed' ELSE 'source_changed' END,
 read_outcome=CASE WHEN v->>'outcome'='stored' AND jsonb_typeof(t->'proposal'->'facts')='array' AND jsonb_array_length(t->'proposal'->'facts')=0
  THEN CASE encode(sha256(convert_to(t->'proposal'->'reviewNotes'->>0,'UTF8')),'hex')
   WHEN '73d7fedfffefde7b0f497474c2372f1c1e3bf004b1d7ef5f2faecf49e970740d' THEN 'unreadable' WHEN '6fed697a736f24cd30f74d6559b2edd89f463396b4ec1f78ac930156af0e5759' THEN 'unmatched' END END
 WHERE command_id=j.command_id;
 RETURN public.flow_candidate_source_status_value(j.command_id);
END $$;

CREATE OR REPLACE FUNCTION public.flow_candidate_source_library_status(p_user bigint) RETURNS jsonb
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
   coalesce((j.state='unavailable' AND j.reason IN ('unsupported','empty','too_large','provider_refused'))
    OR (j.state='review_ready' AND j.read_outcome IS NOT NULL),false)) ORDER BY r.id),'[]'::jsonb)
 FROM public.candidate_resumes r
 LEFT JOIN LATERAL (
  SELECT x.state,x.reason,x.read_outcome FROM public.candidate_source_objects s
  JOIN public.candidate_source_jobs x ON x.source_id=s.source_id AND x.user_id=s.user_id
  WHERE s.resume_id=r.id AND s.user_id=p_user AND NOT s.restricted
  ORDER BY x.created_at DESC,x.command_id DESC LIMIT 1
 ) j ON true WHERE r.user_id=p_user);
END $$;
