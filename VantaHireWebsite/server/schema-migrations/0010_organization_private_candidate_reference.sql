-- Wave 4B: one immutable Flow-private application/resume reference plus a
-- payload-free, generation-fenced Memory delivery intent. No backfill.

CREATE TABLE public.organization_candidate_references (
  reference_id uuid PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  application_id integer NOT NULL,
  job_id integer NOT NULL,
  origin_code text NOT NULL,
  schema_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT organization_candidate_references_identity_positive
    CHECK (organization_id > 0 AND application_id > 0 AND job_id > 0),
  CONSTRAINT organization_candidate_references_origin_v1
    CHECK (origin_code = 'candidate_applied' AND schema_version = 1),
  CONSTRAINT organization_candidate_references_application_unique
    UNIQUE (organization_id, application_id),
  CONSTRAINT organization_candidate_references_reference_identity_unique
    UNIQUE (reference_id, organization_id, application_id, job_id)
);

CREATE INDEX organization_candidate_references_job_idx
  ON public.organization_candidate_references(organization_id, job_id, created_at DESC);

CREATE TABLE public.application_resume_versions (
  resume_version_id uuid PRIMARY KEY,
  reference_id uuid NOT NULL REFERENCES public.organization_candidate_references(reference_id)
    ON DELETE RESTRICT,
  organization_id integer NOT NULL,
  application_id integer NOT NULL,
  job_id integer NOT NULL,
  version integer NOT NULL,
  source_kind text NOT NULL,
  source_resume_id integer,
  source_observed_at timestamptz NOT NULL,
  gcs_locator text NOT NULL,
  content_sha256 char(64) NOT NULL,
  byte_count integer NOT NULL,
  media_type text NOT NULL,
  extracted_text text,
  extracted_text_sha256 char(64),
  captured_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT application_resume_versions_identity_positive
    CHECK (organization_id > 0 AND application_id > 0 AND job_id > 0),
  CONSTRAINT application_resume_versions_version_v1 CHECK (version = 1),
  CONSTRAINT application_resume_versions_source_shape CHECK (
    (source_kind = 'direct_upload' AND source_resume_id IS NULL)
    OR (source_kind = 'saved_resume' AND source_resume_id > 0)
  ),
  CONSTRAINT application_resume_versions_locator_bounded
    CHECK (octet_length(gcs_locator) BETWEEN 1 AND 2048),
  CONSTRAINT application_resume_versions_content_digest
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT application_resume_versions_byte_count
    CHECK (byte_count BETWEEN 1 AND 5242880),
  CONSTRAINT application_resume_versions_media_type CHECK (media_type IN (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  CONSTRAINT application_resume_versions_extracted_shape CHECK (
    (extracted_text IS NULL AND extracted_text_sha256 IS NULL)
    OR (
      extracted_text IS NOT NULL
      AND octet_length(extracted_text) BETWEEN 1 AND 2097152
      AND extracted_text_sha256 ~ '^[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT application_resume_versions_reference_identity_fkey
    FOREIGN KEY (reference_id, organization_id, application_id, job_id)
    REFERENCES public.organization_candidate_references(
      reference_id, organization_id, application_id, job_id
    ) ON DELETE RESTRICT,
  CONSTRAINT application_resume_versions_application_version_unique
    UNIQUE (organization_id, application_id, version),
  CONSTRAINT application_resume_versions_reference_unique UNIQUE (reference_id),
  CONSTRAINT application_resume_versions_resume_identity_unique
    UNIQUE (resume_version_id, reference_id, organization_id, application_id, job_id)
);

CREATE INDEX application_resume_versions_job_idx
  ON public.application_resume_versions(organization_id, job_id, created_at DESC);

CREATE FUNCTION public.flow_reject_organization_candidate_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE has_evidence boolean;
BEGIN
  IF TG_OP <> 'TRUNCATE' THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE=TG_TABLE_NAME || ' is append-only (attempted ' || TG_OP || ')';
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I LIMIT 1)', TG_TABLE_NAME)
    INTO has_evidence;
  IF has_evidence THEN
    RAISE EXCEPTION USING ERRCODE='55000',
      MESSAGE=TG_TABLE_NAME || ' contains committed evidence and cannot be truncated';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER organization_candidate_references_append_only
  BEFORE UPDATE OR DELETE ON public.organization_candidate_references
  FOR EACH ROW EXECUTE FUNCTION public.flow_reject_organization_candidate_evidence_mutation();
CREATE TRIGGER organization_candidate_references_truncate_append_only
  BEFORE TRUNCATE ON public.organization_candidate_references
  FOR EACH STATEMENT EXECUTE FUNCTION public.flow_reject_organization_candidate_evidence_mutation();
CREATE TRIGGER application_resume_versions_append_only
  BEFORE UPDATE OR DELETE ON public.application_resume_versions
  FOR EACH ROW EXECUTE FUNCTION public.flow_reject_organization_candidate_evidence_mutation();
CREATE TRIGGER application_resume_versions_truncate_append_only
  BEFORE TRUNCATE ON public.application_resume_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.flow_reject_organization_candidate_evidence_mutation();

CREATE TABLE public.organization_candidate_memory_outbox (
  outbox_id uuid PRIMARY KEY,
  reference_id uuid NOT NULL,
  resume_version_id uuid NOT NULL,
  organization_id integer NOT NULL,
  application_id integer NOT NULL,
  job_id integer NOT NULL,
  idempotency_key char(64) NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  generation integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL,
  last_error_code text,
  terminal_code text,
  memory_candidate_id uuid,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT organization_candidate_memory_outbox_reference_fkey
    FOREIGN KEY (reference_id, organization_id, application_id, job_id)
    REFERENCES public.organization_candidate_references(
      reference_id, organization_id, application_id, job_id
    ) ON DELETE RESTRICT,
  CONSTRAINT organization_candidate_memory_outbox_resume_fkey
    FOREIGN KEY (resume_version_id, reference_id, organization_id, application_id, job_id)
    REFERENCES public.application_resume_versions(
      resume_version_id, reference_id, organization_id, application_id, job_id
    ) ON DELETE RESTRICT,
  CONSTRAINT organization_candidate_memory_outbox_reference_unique UNIQUE (reference_id),
  CONSTRAINT organization_candidate_memory_outbox_resume_unique UNIQUE (resume_version_id),
  CONSTRAINT organization_candidate_memory_outbox_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT organization_candidate_memory_outbox_identity_positive
    CHECK (organization_id > 0 AND application_id > 0 AND job_id > 0),
  CONSTRAINT organization_candidate_memory_outbox_idempotency_digest
    CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT organization_candidate_memory_outbox_state CHECK (
    state IN ('pending','leased','retry_wait','acknowledged','privacy_restricted','terminal')
  ),
  CONSTRAINT organization_candidate_memory_outbox_counters
    CHECK (attempts >= 0 AND generation >= 0 AND generation >= attempts),
  CONSTRAINT organization_candidate_memory_outbox_lease_owner_bounded
    CHECK (lease_owner IS NULL OR octet_length(lease_owner) BETWEEN 1 AND 128),
  CONSTRAINT organization_candidate_memory_outbox_error_bounded CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'network','timeout','remote_408','remote_425','remote_429','remote_5xx',
      'remote_400','remote_401','remote_403','remote_409','remote_422',
      'invalid_response','identity_mismatch','source_missing','privacy_restricted','internal_error'
    )
  ),
  CONSTRAINT organization_candidate_memory_outbox_terminal_bounded CHECK (
    terminal_code IS NULL OR terminal_code IN (
      'retry_exhausted','remote_400','remote_401','remote_403','remote_409','remote_422',
      'invalid_response','identity_mismatch','source_missing','privacy_restricted'
    )
  ),
  CONSTRAINT organization_candidate_memory_outbox_state_shape CHECK (
    (state = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL
      AND memory_candidate_id IS NULL AND acknowledged_at IS NULL AND terminal_code IS NULL)
    OR (state IN ('pending','retry_wait') AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND memory_candidate_id IS NULL AND acknowledged_at IS NULL AND terminal_code IS NULL)
    OR (state = 'acknowledged' AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND memory_candidate_id IS NOT NULL AND acknowledged_at IS NOT NULL
      AND terminal_code IS NULL)
    OR (state IN ('privacy_restricted','terminal') AND lease_owner IS NULL
      AND lease_expires_at IS NULL AND memory_candidate_id IS NULL
      AND acknowledged_at IS NULL AND terminal_code IS NOT NULL)
  )
);

CREATE INDEX organization_candidate_memory_outbox_ready_idx
  ON public.organization_candidate_memory_outbox(state, next_attempt_at, created_at);
CREATE INDEX organization_candidate_memory_outbox_org_order_idx
  ON public.organization_candidate_memory_outbox(organization_id, created_at, outbox_id);

CREATE FUNCTION public.claim_organization_candidate_memory_intents(
  p_worker text, p_limit integer, p_lease_ms integer
) RETURNS SETOF public.organization_candidate_memory_outbox
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_worker IS NULL OR octet_length(p_worker) NOT BETWEEN 1 AND 128
     OR p_limit NOT BETWEEN 1 AND 10 OR p_lease_ms NOT BETWEEN 7001 AND 30000 THEN
    RAISE EXCEPTION 'invalid organization candidate claim arguments';
  END IF;

  UPDATE public.organization_candidate_memory_outbox
  SET state='terminal', terminal_code='retry_exhausted', last_error_code='internal_error',
      lease_owner=NULL, lease_expires_at=NULL, updated_at=clock_timestamp()
  WHERE state='leased' AND lease_expires_at <= clock_timestamp() AND attempts >= 5;

  RETURN QUERY
  WITH eligible AS (
    SELECT candidate.outbox_id
    FROM public.organization_candidate_memory_outbox candidate
    WHERE candidate.state IN ('pending','retry_wait','leased')
      AND candidate.attempts < 5
      AND candidate.next_attempt_at <= clock_timestamp()
      AND (candidate.state <> 'leased' OR candidate.lease_expires_at <= clock_timestamp())
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_candidate_memory_outbox earlier
        WHERE earlier.organization_id=candidate.organization_id
          AND earlier.state IN ('pending','retry_wait','leased')
          AND (earlier.created_at,earlier.outbox_id) < (candidate.created_at,candidate.outbox_id)
      )
    ORDER BY candidate.created_at,candidate.outbox_id
    FOR UPDATE OF candidate SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.organization_candidate_memory_outbox claimed
  SET state='leased', attempts=claimed.attempts+1, generation=claimed.generation+1,
      lease_owner=p_worker,
      lease_expires_at=clock_timestamp()+make_interval(secs => p_lease_ms / 1000.0),
      last_error_code=NULL, updated_at=clock_timestamp()
  FROM eligible WHERE claimed.outbox_id=eligible.outbox_id
  RETURNING claimed.*;
END;
$$;

CREATE FUNCTION public.ack_organization_candidate_memory_intent(
  p_outbox_id uuid, p_generation integer, p_memory_candidate_id uuid
) RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
  WITH acknowledged AS (
    UPDATE public.organization_candidate_memory_outbox
    SET state='acknowledged', lease_owner=NULL, lease_expires_at=NULL,
        memory_candidate_id=p_memory_candidate_id, acknowledged_at=clock_timestamp(),
        last_error_code=NULL, updated_at=clock_timestamp()
    WHERE outbox_id=p_outbox_id AND state='leased' AND generation=p_generation
      AND lease_expires_at > clock_timestamp() AND p_memory_candidate_id IS NOT NULL
    RETURNING 1
  ) SELECT EXISTS(SELECT 1 FROM acknowledged)
$$;

CREATE FUNCTION public.fail_organization_candidate_memory_intent(
  p_outbox_id uuid, p_generation integer, p_error_code text, p_retry_at timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $$
DECLARE result text;
BEGIN
  IF p_error_code NOT IN (
    'network','timeout','remote_408','remote_425','remote_429','remote_5xx',
    'remote_400','remote_401','remote_403','remote_409','remote_422',
    'invalid_response','identity_mismatch','source_missing','privacy_restricted','internal_error'
  ) THEN RAISE EXCEPTION 'invalid organization candidate failure code'; END IF;
  IF p_retry_at < clock_timestamp() OR p_retry_at > clock_timestamp()+interval '1 hour' THEN
    RAISE EXCEPTION 'invalid organization candidate retry time';
  END IF;
  UPDATE public.organization_candidate_memory_outbox
  SET state=CASE
        WHEN p_error_code='privacy_restricted' THEN 'privacy_restricted'
        WHEN p_error_code IN ('remote_400','remote_401','remote_403','remote_409','remote_422',
          'invalid_response','identity_mismatch','source_missing') OR attempts >= 5 THEN 'terminal'
        ELSE 'retry_wait' END,
      terminal_code=CASE
        WHEN p_error_code='privacy_restricted' THEN 'privacy_restricted'
        WHEN p_error_code IN ('remote_400','remote_401','remote_403','remote_409','remote_422',
          'invalid_response','identity_mismatch','source_missing') THEN p_error_code
        WHEN attempts >= 5 THEN 'retry_exhausted' ELSE NULL END,
      last_error_code=p_error_code, lease_owner=NULL, lease_expires_at=NULL,
      next_attempt_at=p_retry_at, updated_at=clock_timestamp()
  WHERE outbox_id=p_outbox_id AND state='leased' AND generation=p_generation
    AND lease_expires_at > clock_timestamp()
  RETURNING state INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON public.organization_candidate_references FROM PUBLIC;
REVOKE ALL ON public.application_resume_versions FROM PUBLIC;
REVOKE ALL ON public.organization_candidate_memory_outbox FROM PUBLIC;
REVOKE ALL ON FUNCTION public.flow_reject_organization_candidate_evidence_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_organization_candidate_memory_intents(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ack_organization_candidate_memory_intent(uuid,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_organization_candidate_memory_intent(uuid,integer,text,timestamptz) FROM PUBLIC;

COMMENT ON TABLE public.organization_candidate_references IS
  'PII-free immutable Flow reference for a public application candidate.';
COMMENT ON TABLE public.application_resume_versions IS
  'Flow-private immutable exact resume bytes/text provenance for one public application.';
COMMENT ON TABLE public.organization_candidate_memory_outbox IS
  'Payload-free leased delivery state for organization-private Memory intake.';
