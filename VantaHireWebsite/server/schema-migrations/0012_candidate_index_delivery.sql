-- Wave 4D: source acceptance is not index publication. No backfill or live
-- processing is performed by this migration. The 4B source remains authoritative.
CREATE TABLE public.candidate_index_outbox (
    outbox_id uuid PRIMARY KEY,
    organization_id integer NOT NULL,
    application_id integer NOT NULL,
    job_id integer NOT NULL,
    reference_id uuid NOT NULL,
    resume_version_id uuid NOT NULL,
    source_version integer NOT NULL,
    content_sha256 char(64) NOT NULL,
    content_kind text NOT NULL,
    payload_sha256 char(64) NOT NULL,
    idempotency_key char(64) NOT NULL,
    captured_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT candidate_index_outbox_positive CHECK (
        organization_id > 0 AND application_id > 0 AND job_id > 0 AND source_version = 1
    ),
    CONSTRAINT candidate_index_outbox_digests CHECK (
        content_sha256 ~ '^[0-9a-f]{64}$' AND payload_sha256 ~ '^[0-9a-f]{64}$'
        AND idempotency_key ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT candidate_index_outbox_content_kind CHECK (
        content_kind IN ('pinned_text','original_bytes')
        AND (content_kind <> 'original_bytes' OR payload_sha256 = content_sha256)
    ),
    CONSTRAINT candidate_index_outbox_reference_fk
        FOREIGN KEY (reference_id,organization_id,application_id,job_id)
        REFERENCES public.organization_candidate_references
            (reference_id,organization_id,application_id,job_id) ON DELETE RESTRICT,
    CONSTRAINT candidate_index_outbox_resume_fk
        FOREIGN KEY (resume_version_id,reference_id,organization_id,application_id,job_id)
        REFERENCES public.application_resume_versions
            (resume_version_id,reference_id,organization_id,application_id,job_id) ON DELETE RESTRICT,
    CONSTRAINT candidate_index_outbox_resume_unique UNIQUE (reference_id,resume_version_id,source_version),
    CONSTRAINT candidate_index_outbox_key_unique UNIQUE (idempotency_key)
);
CREATE INDEX candidate_index_outbox_due_idx
    ON public.candidate_index_outbox (created_at,outbox_id);
CREATE INDEX candidate_index_outbox_application_idx
    ON public.candidate_index_outbox (organization_id,application_id);

CREATE TABLE public.candidate_index_delivery_state (
    outbox_id uuid PRIMARY KEY REFERENCES public.candidate_index_outbox(outbox_id) ON DELETE RESTRICT,
    state text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    generation bigint NOT NULL DEFAULT 0,
    lease_token uuid,
    lease_expires_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    accepted_source_id uuid,
    accepted_command_digest char(64),
    accepted_at timestamptz,
    error_code text,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT candidate_index_delivery_state_name CHECK (
        state IN ('leased','retry_wait','accepted','privacy_restricted','terminal')
    ),
    CONSTRAINT candidate_index_delivery_state_counters CHECK (
        attempts BETWEEN 0 AND 8 AND generation BETWEEN 0 AND 9007199254740991
        AND attempts <= generation
    ),
    CONSTRAINT candidate_index_delivery_state_lease CHECK (
        ((state='leased' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (state<>'leased' AND lease_token IS NULL AND lease_expires_at IS NULL)) IS TRUE
    ),
    CONSTRAINT candidate_index_delivery_state_acceptance CHECK (
        ((state='accepted' AND accepted_source_id IS NOT NULL AND accepted_at IS NOT NULL
            AND accepted_command_digest ~ '^[0-9a-f]{64}$' AND error_code IS NULL)
        OR (state<>'accepted' AND accepted_source_id IS NULL AND accepted_at IS NULL
            AND accepted_command_digest IS NULL)) IS TRUE
    ),
    CONSTRAINT candidate_index_delivery_state_error CHECK (
        error_code IS NULL OR error_code IN (
            'privacy_restricted','privacy_unavailable','source_missing','source_mismatch',
            'network','timeout','rate_limited','receiver_unavailable','receiver_rejected',
            'response_mismatch','attempts_exhausted'
        )
    ),
    CONSTRAINT candidate_index_delivery_state_terminal CHECK (
        (state NOT IN ('terminal','privacy_restricted') OR error_code IS NOT NULL)
        AND (state <> 'privacy_restricted' OR error_code='privacy_restricted')
    )
);
CREATE INDEX candidate_index_delivery_state_due_idx
    ON public.candidate_index_delivery_state (next_attempt_at,outbox_id)
    WHERE state IN ('leased','retry_wait');

CREATE FUNCTION public.flow_candidate_index_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
    v_source public.application_resume_versions%ROWTYPE;
    v_kind text;
    v_payload text;
    v_key text;
BEGIN
    IF TG_OP='TRUNCATE' THEN
        IF NOT EXISTS (SELECT 1 FROM public.candidate_index_outbox) THEN RETURN NULL; END IF;
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='candidate_index_evidence_append_only';
    ELSIF TG_OP<>'INSERT' THEN
        RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='candidate_index_evidence_append_only';
    END IF;
    SELECT * INTO v_source FROM public.application_resume_versions r
    WHERE r.resume_version_id=NEW.resume_version_id AND r.reference_id=NEW.reference_id
      AND r.organization_id=NEW.organization_id AND r.application_id=NEW.application_id
      AND r.job_id=NEW.job_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='23503',MESSAGE='candidate_index_source_missing';
    END IF;
    v_kind := CASE WHEN v_source.extracted_text_sha256 IS NULL THEN 'original_bytes' ELSE 'pinned_text' END;
    v_payload := coalesce(v_source.extracted_text_sha256,v_source.content_sha256);
    -- Every interpolated value has a typed/closed alphabet. Unlike json_build_array
    -- ::text, this exact JSON array has no spaces and matches JSON.stringify.
    v_key := encode(sha256(convert_to(format(
        '["candidate-index:v1","org_%s","%s","%s",%s,"%s","%s","%s"]',
        v_source.organization_id,v_source.reference_id,v_source.resume_version_id,
        v_source.version,v_source.content_sha256,v_kind,v_payload
    ),'UTF8')),'hex');
    IF (NEW.source_version=v_source.version AND NEW.content_sha256=v_source.content_sha256
        AND NEW.content_kind=v_kind AND NEW.payload_sha256=v_payload AND NEW.idempotency_key=v_key
        AND NEW.captured_at=v_source.captured_at) IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='candidate_index_source_mismatch';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER candidate_index_outbox_source_guard BEFORE INSERT ON public.candidate_index_outbox
    FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_index_evidence_guard();
CREATE TRIGGER candidate_index_outbox_no_mutation BEFORE UPDATE OR DELETE ON public.candidate_index_outbox
    FOR EACH ROW EXECUTE FUNCTION public.flow_candidate_index_evidence_guard();
CREATE TRIGGER candidate_index_outbox_no_truncate BEFORE TRUNCATE ON public.candidate_index_outbox
    FOR EACH STATEMENT EXECUTE FUNCTION public.flow_candidate_index_evidence_guard();

CREATE FUNCTION public.flow_claim_candidate_index_delivery(p_limit integer,p_lease_ms integer)
RETURNS TABLE (
    outbox_id uuid,organization_id integer,application_id integer,job_id integer,
    reference_id uuid,resume_version_id uuid,source_version integer,content_sha256 char(64),
    content_kind text,payload_sha256 char(64),idempotency_key char(64),
    attempt integer,generation bigint,lease_token uuid,lease_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='1500ms' SET statement_timeout='3s' AS $$
DECLARE v_row public.candidate_index_outbox%ROWTYPE; v_state public.candidate_index_delivery_state%ROWTYPE;
BEGIN
    IF (p_limit BETWEEN 1 AND 8 AND p_lease_ms BETWEEN 11000 AND 300000) IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate_index_claim_bounds';
    END IF;
    -- Lock the immutable intent, not just sparse state: two claimers must not both
    -- see absence and reserve the same first attempt. The real 4B ack is mandatory.
    FOR v_row IN
        SELECT o.* FROM public.candidate_index_outbox o
        JOIN public.organization_candidate_memory_outbox b
          ON b.reference_id=o.reference_id AND b.resume_version_id=o.resume_version_id
          AND b.organization_id=o.organization_id AND b.application_id=o.application_id
          AND b.job_id=o.job_id AND b.state='acknowledged' AND b.memory_candidate_id IS NOT NULL
        LEFT JOIN public.candidate_index_delivery_state s ON s.outbox_id=o.outbox_id
        WHERE s.outbox_id IS NULL OR (s.state='retry_wait' AND s.next_attempt_at<=clock_timestamp())
          OR (s.state='leased' AND s.lease_expires_at<=clock_timestamp())
        ORDER BY o.created_at,o.outbox_id LIMIT p_limit FOR UPDATE OF o SKIP LOCKED
    LOOP
        SELECT * INTO v_state FROM public.candidate_index_delivery_state s WHERE s.outbox_id=v_row.outbox_id;
        IF FOUND AND v_state.attempts>=8 THEN
            UPDATE public.candidate_index_delivery_state s SET state='terminal',lease_token=NULL,
                lease_expires_at=NULL,error_code='attempts_exhausted',updated_at=clock_timestamp()
            WHERE s.outbox_id=v_row.outbox_id;
            CONTINUE;
        END IF;
        -- A removed/rebound application is not a new acquisition opportunity.
        IF NOT EXISTS (
            SELECT 1 FROM public.applications a JOIN public.jobs j ON j.id=a.job_id
            WHERE a.id=v_row.application_id AND a.job_id=v_row.job_id
              AND a.organization_id=v_row.organization_id AND j.organization_id=v_row.organization_id
        ) THEN
            INSERT INTO public.candidate_index_delivery_state (outbox_id,state,error_code)
                VALUES (v_row.outbox_id,'terminal','source_missing')
            ON CONFLICT ON CONSTRAINT candidate_index_delivery_state_pkey DO UPDATE
                SET state='terminal',lease_token=NULL,lease_expires_at=NULL,error_code='source_missing',
                    updated_at=clock_timestamp();
            CONTINUE;
        END IF;
        INSERT INTO public.candidate_index_delivery_state
            (outbox_id,state,attempts,generation,lease_token,lease_expires_at)
            VALUES (v_row.outbox_id,'leased',1,1,gen_random_uuid(),
                clock_timestamp()+p_lease_ms*interval '1 millisecond')
        ON CONFLICT ON CONSTRAINT candidate_index_delivery_state_pkey DO UPDATE SET
            state='leased',attempts=public.candidate_index_delivery_state.attempts+1,
            generation=public.candidate_index_delivery_state.generation+1,
            lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+p_lease_ms*interval '1 millisecond',
            error_code=NULL,updated_at=clock_timestamp()
        RETURNING * INTO v_state;
        RETURN QUERY SELECT v_row.outbox_id,v_row.organization_id,v_row.application_id,v_row.job_id,
            v_row.reference_id,v_row.resume_version_id,v_row.source_version,v_row.content_sha256,
            v_row.content_kind,v_row.payload_sha256,v_row.idempotency_key,v_state.attempts,
            v_state.generation,v_state.lease_token,v_state.lease_expires_at;
    END LOOP;
END;
$$;

CREATE FUNCTION public.flow_ack_candidate_index_delivery(
    p_outbox_id uuid,p_lease_token uuid,p_generation bigint,p_key text,
    p_reference_id uuid,p_resume_version_id uuid,p_payload_sha256 text,
    p_source_id uuid,p_command_digest text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='1500ms' SET statement_timeout='3s' AS $$
DECLARE v_changed integer;
BEGIN
    IF (p_source_id IS NOT NULL AND p_command_digest ~ '^[0-9a-f]{64}$'
        AND p_key ~ '^[0-9a-f]{64}$' AND p_payload_sha256 ~ '^[0-9a-f]{64}$'
        AND p_generation BETWEEN 1 AND 9007199254740991 AND p_lease_token IS NOT NULL) IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate_index_ack_bounds';
    END IF;
    PERFORM 1 FROM public.candidate_index_outbox o WHERE o.outbox_id=p_outbox_id FOR UPDATE;
    UPDATE public.candidate_index_delivery_state s SET state='accepted',lease_token=NULL,
        lease_expires_at=NULL,accepted_source_id=p_source_id,accepted_command_digest=p_command_digest,
        accepted_at=clock_timestamp(),error_code=NULL,updated_at=clock_timestamp()
    FROM public.candidate_index_outbox o
    WHERE s.outbox_id=p_outbox_id AND o.outbox_id=s.outbox_id AND s.state='leased'
      AND s.generation=p_generation AND s.lease_token=p_lease_token AND s.lease_expires_at>clock_timestamp()
      AND o.idempotency_key=p_key AND o.reference_id=p_reference_id
      AND o.resume_version_id=p_resume_version_id AND o.payload_sha256=p_payload_sha256;
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    RETURN v_changed=1;
END;
$$;

CREATE FUNCTION public.flow_fail_candidate_index_delivery(
    p_outbox_id uuid,p_lease_token uuid,p_generation bigint,p_code text,p_retry_ms integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='1500ms' SET statement_timeout='3s' AS $$
DECLARE v_changed integer;
BEGIN
    IF (p_code IN ('privacy_restricted','privacy_unavailable','source_missing','source_mismatch',
        'network','timeout','rate_limited','receiver_unavailable','receiver_rejected','response_mismatch')
        AND p_retry_ms BETWEEN 0 AND 3600000 AND p_generation BETWEEN 1 AND 9007199254740991
        AND p_lease_token IS NOT NULL) IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate_index_fail_bounds';
    END IF;
    PERFORM 1 FROM public.candidate_index_outbox o WHERE o.outbox_id=p_outbox_id FOR UPDATE;
    UPDATE public.candidate_index_delivery_state s SET
        state=CASE WHEN p_code='privacy_restricted' THEN 'privacy_restricted'
            WHEN p_code IN ('source_missing','source_mismatch','receiver_rejected','response_mismatch')
                OR s.attempts>=8 THEN 'terminal' ELSE 'retry_wait' END,
        error_code=CASE WHEN s.attempts>=8 AND p_code IN
            ('privacy_unavailable','network','timeout','rate_limited','receiver_unavailable')
            THEN 'attempts_exhausted' ELSE p_code END,
        next_attempt_at=clock_timestamp()+p_retry_ms*interval '1 millisecond',
        lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE s.outbox_id=p_outbox_id AND s.state='leased' AND s.generation=p_generation
      AND s.lease_token=p_lease_token AND s.lease_expires_at>clock_timestamp();
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    RETURN v_changed=1;
END;
$$;

CREATE FUNCTION public.flow_candidate_index_managed_application(p_organization_id integer,p_application_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    SELECT coalesce(p_organization_id>0 AND p_application_id>0 AND EXISTS (
        SELECT 1 FROM public.candidate_index_outbox o
        WHERE o.organization_id=p_organization_id AND o.application_id=p_application_id
    ),false);
$$;

CREATE FUNCTION public.flow_capture_candidate_index_catchup(
    p_organization_id integer,p_reference_id uuid,p_resume_version_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
SET lock_timeout='1500ms' SET statement_timeout='3s' AS $$
DECLARE v_source public.application_resume_versions%ROWTYPE; v_id uuid; v_kind text; v_payload text; v_key text;
BEGIN
    IF (p_organization_id>0 AND p_reference_id IS NOT NULL AND p_resume_version_id IS NOT NULL) IS NOT TRUE THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate_index_catchup_bounds';
    END IF;
    SELECT r.* INTO v_source FROM public.application_resume_versions r
    JOIN public.organization_candidate_references ref ON ref.reference_id=r.reference_id
      AND ref.organization_id=r.organization_id AND ref.application_id=r.application_id AND ref.job_id=r.job_id
    JOIN public.applications a ON a.id=r.application_id AND a.organization_id=r.organization_id AND a.job_id=r.job_id
    JOIN public.jobs j ON j.id=a.job_id AND j.organization_id=r.organization_id
    WHERE r.organization_id=p_organization_id AND r.reference_id=p_reference_id
      AND r.resume_version_id=p_resume_version_id FOR KEY SHARE OF a,j;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate_index_catchup_source_refused';
    END IF;
    -- Same session key as the legacy worker; never adopt across an active write.
    IF NOT pg_try_advisory_xact_lock(hashtext('flow:candidate-index:legacy'),v_source.application_id) THEN
        RAISE EXCEPTION USING ERRCODE='55P03',MESSAGE='candidate_index_catchup_legacy_busy';
    END IF;
    -- Serialize against the frozen queue claim UPDATE. A retried or ambiguous
    -- attempt can have outlived its client, so elapsed lease time is not proof.
    PERFORM 1 FROM public.application_graph_sync_jobs g
      WHERE g.application_id=v_source.application_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.application_graph_sync_jobs g
      WHERE g.application_id=v_source.application_id AND (
        (g.attempts=0 AND g.status='pending')
        OR (g.attempts=1 AND g.status IN ('succeeded','privacy_restricted'))
      ) IS NOT TRUE) THEN
        RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='candidate_index_catchup_legacy_uncertain';
    END IF;
    v_kind := CASE WHEN v_source.extracted_text_sha256 IS NULL THEN 'original_bytes' ELSE 'pinned_text' END;
    v_payload := coalesce(v_source.extracted_text_sha256,v_source.content_sha256);
    v_key := encode(sha256(convert_to(format(
        '["candidate-index:v1","org_%s","%s","%s",%s,"%s","%s","%s"]',
        v_source.organization_id,v_source.reference_id,v_source.resume_version_id,
        v_source.version,v_source.content_sha256,v_kind,v_payload
    ),'UTF8')),'hex');
    INSERT INTO public.candidate_index_outbox (
        outbox_id,organization_id,application_id,job_id,reference_id,resume_version_id,
        source_version,content_sha256,content_kind,payload_sha256,idempotency_key,captured_at
    ) VALUES (gen_random_uuid(),v_source.organization_id,v_source.application_id,v_source.job_id,
        v_source.reference_id,v_source.resume_version_id,v_source.version,v_source.content_sha256,
        v_kind,v_payload,v_key,v_source.captured_at)
    ON CONFLICT ON CONSTRAINT candidate_index_outbox_resume_unique DO NOTHING RETURNING outbox_id INTO v_id;
    IF v_id IS NULL THEN
        SELECT outbox_id INTO v_id FROM public.candidate_index_outbox
        WHERE reference_id=p_reference_id AND resume_version_id=p_resume_version_id AND idempotency_key=v_key;
    END IF;
    RETURN v_id;
END;
$$;

REVOKE ALL ON public.candidate_index_outbox,public.candidate_index_delivery_state FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_index_evidence_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_claim_candidate_index_delivery(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_ack_candidate_index_delivery(uuid,uuid,bigint,text,uuid,uuid,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_fail_candidate_index_delivery(uuid,uuid,bigint,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_candidate_index_managed_application(integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_capture_candidate_index_catchup(integer,uuid,uuid) FROM PUBLIC;
