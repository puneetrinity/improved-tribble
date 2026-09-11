-- Wave 4C/A1: explicit candidate-owned source authority. No backfill or publication.
CREATE TABLE public.candidate_consent_subjects (
  subject_id uuid PRIMARY KEY,
  user_id integer NOT NULL UNIQUE CHECK (user_id > 0),
  version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
  desired_action text CHECK (desired_action IN ('grant','withdraw')),
  acknowledged_version bigint NOT NULL DEFAULT 0 CHECK (acknowledged_version >= 0),
  acknowledged_action text CHECK (acknowledged_action IN ('grant','withdraw')),
  current_source_id uuid,
  effective_source_id uuid,
  delivery_status text NOT NULL DEFAULT 'none'
    CHECK (delivery_status IN ('none','pending','delivered','failed','privacy_restricted','identity_review_required')),
  last_error_code text CHECK (last_error_code IN ('network','timeout','remote_retry','remote_denied','remote_conflict',
    'invalid_response','identity_mismatch','account_changed','source_missing','privacy_review','privacy_restricted',
    'internal_error','retry_exhausted','superseded','identity_review_required')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (acknowledged_version <= version),
  CHECK (((version=0 AND desired_action IS NULL AND current_source_id IS NULL)
    OR (version>0 AND desired_action='withdraw' AND current_source_id IS NULL)
    OR (version>0 AND desired_action='grant' AND current_source_id IS NOT NULL)) IS TRUE),
  CHECK (((acknowledged_version=0 AND acknowledged_action IS NULL AND effective_source_id IS NULL)
    OR (acknowledged_version>0 AND acknowledged_action='withdraw' AND effective_source_id IS NULL)
    OR (acknowledged_version>0 AND acknowledged_action='grant' AND effective_source_id IS NOT NULL)) IS TRUE)
);

CREATE TABLE public.candidate_consent_sources (
  source_id uuid PRIMARY KEY,
  subject_id uuid NOT NULL REFERENCES public.candidate_consent_subjects(subject_id) ON DELETE RESTRICT,
  source_version bigint NOT NULL CHECK (source_version BETWEEN 1 AND 9007199254740991),
  profile jsonb NOT NULL,
  profile_sha256 char(64) NOT NULL CHECK (profile_sha256 ~ '^[0-9a-f]{64}$'),
  resume jsonb,
  resume_sha256 char(64) CHECK (resume_sha256 ~ '^[0-9a-f]{64}$'),
  resume_version_id uuid REFERENCES public.application_resume_versions(resume_version_id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL,
  UNIQUE (subject_id,source_version),
  UNIQUE (subject_id,source_version,source_id),
  UNIQUE (subject_id,source_id),
  CONSTRAINT consent_source_profile_shape CHECK ((jsonb_typeof(profile)='object' AND octet_length(profile::text)<=32768
    AND profile ?& ARRAY['display_name','headline','location','skills','linkedin']
    AND profile - ARRAY['display_name','headline','location','skills','linkedin']='{}'::jsonb
    AND jsonb_typeof(profile->'display_name')='string' AND length(profile->>'display_name') BETWEEN 1 AND 200
    AND jsonb_typeof(profile->'headline')='string' AND length(profile->>'headline')<=300
    AND jsonb_typeof(profile->'location')='string' AND length(profile->>'location')<=200
    AND jsonb_typeof(profile->'skills')='array' AND jsonb_array_length(profile->'skills')<=100
    AND NOT jsonb_path_exists(profile, 'strict $.skills[*] ? (@.type() != "string" || !(@ like_regex "^.{1,100}$") || @ like_regex "^[[:space:]]|[[:space:]]$|[[:cntrl:]]")')
    AND profile->>'display_name'=btrim(profile->>'display_name') AND profile->>'display_name' !~ '[[:cntrl:]]'
    AND profile->>'headline'=btrim(profile->>'headline') AND profile->>'headline' !~ '[[:cntrl:]]'
    AND profile->>'location'=btrim(profile->>'location') AND profile->>'location' !~ '[[:cntrl:]]'
    AND (profile->'linkedin'='null'::jsonb OR
      (jsonb_typeof(profile->'linkedin')='string' AND length(profile->>'linkedin')<=2048
      AND profile->>'linkedin' ~ '^https://www[.]linkedin[.]com/in/[a-zA-Z0-9_%.-]+$'))) IS TRUE),
  CONSTRAINT consent_source_resume_shape CHECK (((resume IS NULL AND resume_sha256 IS NULL AND resume_version_id IS NULL)
    OR (resume IS NOT NULL AND resume_sha256 IS NOT NULL AND resume_version_id IS NOT NULL
      AND jsonb_typeof(resume)='object' AND octet_length(resume::text)<=2048
      AND resume->>'resume_version_id'=resume_version_id::text
      AND resume ?& ARRAY['reference_id','resume_version_id','organization_id','application_id','job_id',
        'content_sha256','byte_count','media_type','source_observed_at']
      AND resume - ARRAY['reference_id','resume_version_id','organization_id','application_id','job_id',
        'content_sha256','byte_count','media_type','source_observed_at']='{}'::jsonb
      AND jsonb_typeof(resume->'reference_id')='string'
      AND resume->>'reference_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND jsonb_typeof(resume->'resume_version_id')='string'
      AND resume->>'resume_version_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND CASE WHEN jsonb_typeof(resume->'organization_id')='number' THEN
        resume->>'organization_id' ~ '^[1-9][0-9]*$' AND (resume->>'organization_id')::numeric BETWEEN 1 AND 2147483647 ELSE false END
      AND CASE WHEN jsonb_typeof(resume->'application_id')='number' THEN
        resume->>'application_id' ~ '^[1-9][0-9]*$' AND (resume->>'application_id')::numeric BETWEEN 1 AND 2147483647 ELSE false END
      AND CASE WHEN jsonb_typeof(resume->'job_id')='number' THEN
        resume->>'job_id' ~ '^[1-9][0-9]*$' AND (resume->>'job_id')::numeric BETWEEN 1 AND 2147483647 ELSE false END
      AND CASE WHEN jsonb_typeof(resume->'byte_count')='number' THEN
        resume->>'byte_count' ~ '^[1-9][0-9]*$' AND (resume->>'byte_count')::numeric BETWEEN 1 AND 5242880 ELSE false END
      AND jsonb_typeof(resume->'content_sha256')='string'
      AND resume->>'content_sha256' ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof(resume->'media_type')='string'
      AND resume->>'media_type' IN ('application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      AND jsonb_typeof(resume->'source_observed_at')='string'
      AND resume->>'source_observed_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    )) IS TRUE)
);
ALTER TABLE public.candidate_consent_subjects
  ADD CONSTRAINT consent_current_source_fk FOREIGN KEY(subject_id,current_source_id)
    REFERENCES public.candidate_consent_sources(subject_id,source_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT consent_effective_source_fk FOREIGN KEY(subject_id,effective_source_id)
    REFERENCES public.candidate_consent_sources(subject_id,source_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.candidate_consent_events (
  event_id uuid PRIMARY KEY,
  subject_id uuid NOT NULL REFERENCES public.candidate_consent_subjects(subject_id) ON DELETE RESTRICT,
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  action text NOT NULL CHECK (action IN ('grant','withdraw')),
  source_id uuid,
  purpose text NOT NULL CHECK (purpose='platform_professional_matching'),
  schema_version integer NOT NULL CHECK (schema_version=1),
  purpose_version integer NOT NULL CHECK (purpose_version=1),
  copy_version integer NOT NULL CHECK (copy_version=1),
  copy_sha256 char(64) NOT NULL CHECK (copy_sha256 ~ '^[0-9a-f]{64}$'),
  user_id integer NOT NULL CHECK (user_id > 0),
  verified_email_sha256 char(64) CHECK (verified_email_sha256 ~ '^[0-9a-f]{64}$'),
  account_auth_version integer CHECK (account_auth_version > 0),
  request_id uuid NOT NULL,
  request_sha256 char(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  command_sha256 char(64) NOT NULL CHECK (command_sha256 ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL,
  UNIQUE (subject_id,version),
  UNIQUE (subject_id,request_id),
  UNIQUE (event_id,subject_id,version),
  FOREIGN KEY(subject_id,version,source_id)
    REFERENCES public.candidate_consent_sources(subject_id,source_version,source_id) ON DELETE RESTRICT,
  CHECK ((action='grant' AND source_id IS NOT NULL AND verified_email_sha256 IS NOT NULL AND account_auth_version IS NOT NULL)
    OR (action='withdraw' AND source_id IS NULL AND verified_email_sha256 IS NULL AND account_auth_version IS NULL))
);

CREATE TABLE public.candidate_consent_outbox (
  outbox_id uuid PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  subject_id uuid NOT NULL,
  version bigint NOT NULL,
  idempotency_key char(64) NOT NULL UNIQUE CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  command_sha256 char(64) NOT NULL CHECK (command_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','leased','retry_wait','acknowledged','terminal','privacy_restricted','superseded')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  generation integer NOT NULL DEFAULT 0 CHECK (generation >= attempts),
  lease_owner text CHECK (octet_length(lease_owner) BETWEEN 1 AND 128),
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  last_error_code text CHECK (last_error_code IN ('network','timeout','remote_retry','remote_denied','remote_conflict',
    'invalid_response','identity_mismatch','account_changed','source_missing','privacy_review','privacy_restricted',
    'internal_error','retry_exhausted','superseded','identity_review_required')),
  receipt jsonb CHECK (receipt IS NULL OR (jsonb_typeof(receipt)='object' AND octet_length(receipt::text)<=2048)),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY(event_id,subject_id,version)
    REFERENCES public.candidate_consent_events(event_id,subject_id,version) ON DELETE RESTRICT,
  CHECK ((state='leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state<>'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)),
  CHECK ((state='acknowledged' AND receipt IS NOT NULL AND acknowledged_at IS NOT NULL)
    OR (state<>'acknowledged' AND receipt IS NULL AND acknowledged_at IS NULL))
);
CREATE INDEX consent_outbox_ready_idx ON public.candidate_consent_outbox(state,next_attempt_at,created_at);
CREATE INDEX consent_outbox_subject_idx ON public.candidate_consent_outbox(subject_id,version);

CREATE FUNCTION public.flow_reject_candidate_consent_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE has_rows boolean;
BEGIN
  IF TG_OP='TRUNCATE' THEN
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I LIMIT 1)',TG_TABLE_SCHEMA,TG_TABLE_NAME) INTO has_rows;
    IF NOT has_rows THEN RETURN NULL; END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='candidate_consent_append_only';
END;
$$;
CREATE TRIGGER consent_sources_append_only BEFORE UPDATE OR DELETE ON public.candidate_consent_sources
  FOR EACH ROW EXECUTE FUNCTION public.flow_reject_candidate_consent_mutation();
CREATE TRIGGER consent_sources_truncate BEFORE TRUNCATE ON public.candidate_consent_sources
  FOR EACH STATEMENT EXECUTE FUNCTION public.flow_reject_candidate_consent_mutation();
CREATE TRIGGER consent_events_append_only BEFORE UPDATE OR DELETE ON public.candidate_consent_events
  FOR EACH ROW EXECUTE FUNCTION public.flow_reject_candidate_consent_mutation();
CREATE TRIGGER consent_events_truncate BEFORE TRUNCATE ON public.candidate_consent_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.flow_reject_candidate_consent_mutation();
CREATE FUNCTION public.flow_reject_candidate_consent_rebind()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='candidate_consent_binding_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER consent_subject_binding BEFORE UPDATE ON public.candidate_consent_subjects
  FOR EACH ROW EXECUTE FUNCTION public.flow_reject_candidate_consent_rebind();

-- A1: no raw outbox SELECT privilege, no claiming as a read probe, no email ownership inference.
CREATE FUNCTION public.flow_candidate_consent_resume_ready(p_user_id integer,p_resume_version_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.application_resume_versions v
    JOIN public.organization_candidate_references r ON
      (r.reference_id,r.organization_id,r.application_id,r.job_id)=
      (v.reference_id,v.organization_id,v.application_id,v.job_id)
    JOIN public.applications a ON (a.id,a.organization_id,a.job_id)=(v.application_id,v.organization_id,v.job_id)
    JOIN public.organization_candidate_memory_outbox o ON
      (o.resume_version_id,o.reference_id,o.organization_id,o.application_id,o.job_id)=
      (v.resume_version_id,v.reference_id,v.organization_id,v.application_id,v.job_id)
    WHERE v.resume_version_id=p_resume_version_id AND p_user_id>0 AND a.user_id=p_user_id
      AND r.origin_code='candidate_applied' AND o.state='acknowledged'
      AND o.acknowledged_at IS NOT NULL AND o.memory_candidate_id IS NOT NULL
  )
$$;

CREATE FUNCTION public.flow_claim_candidate_consent_outbox(
  p_worker text,p_limit integer,p_lease_ms integer,p_event_id uuid DEFAULT NULL
) RETURNS SETOF public.candidate_consent_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.candidate_consent_subjects; claimed public.candidate_consent_outbox;
BEGIN
  IF p_worker IS NULL OR octet_length(p_worker) NOT BETWEEN 1 AND 128
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10
    OR p_lease_ms IS NULL OR p_lease_ms NOT BETWEEN 1000 AND 300000 THEN
    RAISE EXCEPTION 'candidate_consent_claim_invalid';
  END IF;
  -- Every delivery mutation locks subject before outbox, matching capture/ack/fail.
  FOR s IN
    SELECT subject.* FROM public.candidate_consent_subjects subject
    WHERE EXISTS(SELECT 1 FROM public.candidate_consent_outbox o
      WHERE o.subject_id=subject.subject_id AND (p_event_id IS NULL OR o.event_id=p_event_id)
        AND o.state IN ('pending','retry_wait','leased') AND o.next_attempt_at<=clock_timestamp()
        AND (o.state<>'leased' OR o.lease_expires_at<=clock_timestamp())
        AND ((subject.desired_action='withdraw' AND o.version=subject.version) OR NOT EXISTS (
          SELECT 1 FROM public.candidate_consent_outbox earlier WHERE earlier.subject_id=o.subject_id
            AND earlier.version<o.version AND earlier.state IN ('pending','leased','retry_wait'))))
    ORDER BY subject.updated_at,subject.subject_id FOR UPDATE OF subject SKIP LOCKED LIMIT p_limit
  LOOP
    IF s.desired_action='withdraw' THEN
      UPDATE public.candidate_consent_outbox SET state='superseded',last_error_code='superseded',
        lease_owner=NULL,lease_expires_at=NULL,generation=generation+1,updated_at=clock_timestamp()
      WHERE subject_id=s.subject_id AND version<s.version AND state IN ('pending','leased','retry_wait');
    END IF;
    WITH exhausted AS (
      UPDATE public.candidate_consent_outbox SET state='terminal',last_error_code='retry_exhausted',
        lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
      WHERE subject_id=s.subject_id AND state='leased' AND lease_expires_at<=clock_timestamp() AND attempts>=8
      RETURNING version
    ) UPDATE public.candidate_consent_subjects SET delivery_status='failed',last_error_code='retry_exhausted',
        updated_at=clock_timestamp()
      WHERE subject_id=s.subject_id AND version IN (SELECT version FROM exhausted);
    WITH eligible AS (
      SELECT o.outbox_id FROM public.candidate_consent_outbox o
      WHERE o.subject_id=s.subject_id AND (p_event_id IS NULL OR o.event_id=p_event_id)
        AND o.state IN ('pending','retry_wait','leased') AND o.attempts<8 AND o.next_attempt_at<=clock_timestamp()
        AND (o.state<>'leased' OR o.lease_expires_at<=clock_timestamp())
        AND NOT EXISTS (SELECT 1 FROM public.candidate_consent_outbox earlier
          WHERE earlier.subject_id=o.subject_id AND earlier.version<o.version
            AND earlier.state IN ('pending','leased','retry_wait'))
      ORDER BY o.version FOR UPDATE OF o SKIP LOCKED LIMIT 1
    ) UPDATE public.candidate_consent_outbox o SET state='leased',attempts=o.attempts+1,generation=o.generation+1,
      lease_owner=p_worker,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_ms/1000.0),
      last_error_code=NULL,updated_at=clock_timestamp()
    FROM eligible e WHERE o.outbox_id=e.outbox_id RETURNING o.* INTO claimed;
    IF FOUND THEN RETURN NEXT claimed; END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.flow_ack_candidate_consent_outbox(p_outbox_id uuid,p_generation integer,p_receipt jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.candidate_consent_outbox; e public.candidate_consent_events;
BEGIN
  SELECT * INTO o FROM public.candidate_consent_outbox WHERE outbox_id=p_outbox_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.candidate_consent_subjects WHERE subject_id=o.subject_id FOR UPDATE;
  SELECT * INTO o FROM public.candidate_consent_outbox WHERE outbox_id=p_outbox_id FOR UPDATE;
  IF o.state IS DISTINCT FROM 'leased' OR o.generation IS DISTINCT FROM p_generation
    OR o.lease_expires_at IS NULL OR o.lease_expires_at<=clock_timestamp() THEN RETURN false; END IF;
  IF p_receipt IS NULL OR jsonb_typeof(p_receipt) IS DISTINCT FROM 'object'
    OR NOT (p_receipt ?& ARRAY['subject_id','event_id','version','idempotency_key',
      'command_digest','outcome','effective_action','effective_version'])
    OR p_receipt - ARRAY['subject_id','event_id','version','idempotency_key','command_digest','outcome',
      'effective_action','effective_version']<>'{}'::jsonb
    OR p_receipt->>'subject_id' IS DISTINCT FROM o.subject_id::text
    OR p_receipt->>'event_id' IS DISTINCT FROM o.event_id::text
    OR jsonb_typeof(p_receipt->'version') IS DISTINCT FROM 'number'
    OR p_receipt->>'version' IS DISTINCT FROM o.version::text
    OR p_receipt->>'idempotency_key' IS DISTINCT FROM o.idempotency_key::text
    OR p_receipt->>'command_digest' IS DISTINCT FROM o.command_sha256::text
    OR p_receipt->>'outcome' IS NULL
    OR p_receipt->>'outcome' NOT IN ('granted','withdrawn','replayed','superseded','identity_review_required')
    OR jsonb_typeof(p_receipt->'effective_version') IS DISTINCT FROM 'number'
    OR (p_receipt->>'effective_version') !~ '^(0|[1-9][0-9]{0,15})$'
    OR (p_receipt->>'effective_version')::numeric>9007199254740991
    OR p_receipt->'effective_action' NOT IN ('"grant"'::jsonb,'"withdraw"'::jsonb,'null'::jsonb) THEN
    RAISE EXCEPTION 'candidate_consent_receipt_invalid';
  END IF;
  SELECT * INTO STRICT e FROM public.candidate_consent_events WHERE event_id=o.event_id;
  IF p_receipt->>'outcome' IN ('granted','withdrawn','replayed') AND
    (p_receipt->>'effective_version' IS DISTINCT FROM o.version::text
      OR p_receipt->>'effective_action' IS DISTINCT FROM e.action
      OR (p_receipt->>'outcome'='granted' AND e.action<>'grant')
      OR (p_receipt->>'outcome'='withdrawn' AND e.action<>'withdraw')) THEN
    RAISE EXCEPTION 'candidate_consent_effective_receipt_invalid';
  END IF;
  UPDATE public.candidate_consent_outbox SET state='acknowledged',receipt=p_receipt,
    acknowledged_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE outbox_id=p_outbox_id;
  IF p_receipt->>'outcome' IN ('granted','withdrawn','replayed') THEN
    UPDATE public.candidate_consent_subjects SET acknowledged_version=o.version,acknowledged_action=e.action,
      effective_source_id=e.source_id,updated_at=clock_timestamp()
      WHERE subject_id=o.subject_id AND acknowledged_version<o.version;
  END IF;
  UPDATE public.candidate_consent_subjects SET
    delivery_status=CASE WHEN p_receipt->>'outcome'='identity_review_required' THEN 'identity_review_required'
      WHEN p_receipt->>'outcome'='superseded' THEN 'failed' ELSE 'delivered' END,
    last_error_code=CASE WHEN p_receipt->>'outcome' IN ('identity_review_required','superseded')
      THEN p_receipt->>'outcome' ELSE NULL END,updated_at=clock_timestamp()
    WHERE subject_id=o.subject_id AND version=o.version;
  RETURN true;
END;
$$;

CREATE FUNCTION public.flow_fail_candidate_consent_outbox(
  p_outbox_id uuid,p_generation integer,p_code text,p_retryable boolean,p_retry_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o public.candidate_consent_outbox; next_state text;
BEGIN
  IF p_code IS NULL OR p_code NOT IN ('network','timeout','remote_retry','remote_denied','remote_conflict',
    'invalid_response','identity_mismatch','account_changed','source_missing','privacy_review',
    'privacy_restricted','internal_error') OR p_retryable IS NULL OR p_retry_at IS NULL
    OR p_retry_at<clock_timestamp()-interval '5 seconds' OR p_retry_at>clock_timestamp()+interval '60 seconds' THEN
    RAISE EXCEPTION 'candidate_consent_failure_invalid';
  END IF;
  SELECT * INTO o FROM public.candidate_consent_outbox WHERE outbox_id=p_outbox_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.candidate_consent_subjects WHERE subject_id=o.subject_id FOR UPDATE;
  SELECT * INTO o FROM public.candidate_consent_outbox WHERE outbox_id=p_outbox_id FOR UPDATE;
  IF o.state IS DISTINCT FROM 'leased' OR o.generation IS DISTINCT FROM p_generation
    OR o.lease_expires_at IS NULL OR o.lease_expires_at<=clock_timestamp() THEN RETURN false; END IF;
  next_state := CASE WHEN p_code='privacy_restricted' THEN 'privacy_restricted'
    WHEN p_retryable AND o.attempts<8 THEN 'retry_wait' ELSE 'terminal' END;
  UPDATE public.candidate_consent_outbox SET state=next_state,last_error_code=p_code,
    lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=p_retry_at,updated_at=clock_timestamp()
    WHERE outbox_id=p_outbox_id;
  UPDATE public.candidate_consent_subjects SET
    delivery_status=CASE WHEN next_state='retry_wait' THEN 'pending'
      WHEN next_state='privacy_restricted' THEN 'privacy_restricted' ELSE 'failed' END,
    last_error_code=p_code,updated_at=clock_timestamp()
    WHERE subject_id=o.subject_id AND version=o.version;
  RETURN true;
END;
$$;

REVOKE ALL ON public.candidate_consent_subjects,public.candidate_consent_sources,
  public.candidate_consent_events,public.candidate_consent_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_consent_resume_ready(integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_claim_candidate_consent_outbox(text,integer,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_ack_candidate_consent_outbox(uuid,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_fail_candidate_consent_outbox(uuid,integer,text,boolean,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_reject_candidate_consent_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_reject_candidate_consent_rebind() FROM PUBLIC;
