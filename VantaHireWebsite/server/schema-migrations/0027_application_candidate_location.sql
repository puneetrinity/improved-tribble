-- Candidate-confirmed application facts. No backfill or résumé inference.
ALTER TABLE public.applications
  ADD COLUMN candidate_location jsonb,
  ADD COLUMN willing_to_relocate boolean;

CREATE FUNCTION public.application_candidate_location_valid(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE stamp timestamptz;
BEGIN
  IF value IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(value) <> 'object' OR octet_length(value::text) > 1024 THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(value)) <> 5
    OR NOT value ?& ARRAY['version','provenance','city','countryCode','confirmedAt']
    OR value->'version' IS DISTINCT FROM '2'::jsonb
    OR value->>'provenance' IS DISTINCT FROM 'candidate_confirmed'
    OR jsonb_typeof(value->'city') <> 'string'
    OR length(value->>'city') NOT BETWEEN 1 AND 200
    OR btrim(value->>'city') = ''
    OR jsonb_typeof(value->'countryCode') <> 'string'
    OR (value->>'countryCode') !~ '^[A-Z]{2}$'
    OR jsonb_typeof(value->'confirmedAt') <> 'string'
    OR (value->>'confirmedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    THEN RETURN false; END IF;
  stamp := (value->>'confirmedAt')::timestamptz;
  RETURN to_char(stamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') = value->>'confirmedAt';
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;

ALTER TABLE public.applications ADD CONSTRAINT application_candidate_location_valid
  CHECK (public.application_candidate_location_valid(candidate_location) IS TRUE);

-- Invoker identity is essential: runtime cannot impersonate an erasure operator.
-- The table owner may ONLY clear facts, not rewrite them. P8 must supply its own
-- authorization and audit before using that owner-only erasure operation.
CREATE FUNCTION public.application_candidate_location_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE erasing boolean;
BEGIN
  SELECT current_user = pg_get_userbyid(relowner) INTO erasing
    FROM pg_class WHERE oid = TG_RELID;
  IF OLD.candidate_location IS NOT NULL AND NEW.candidate_location IS DISTINCT FROM OLD.candidate_location
    AND NOT (erasing AND NEW.candidate_location IS NULL) THEN
    RAISE EXCEPTION 'application_location_immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.willing_to_relocate IS NOT NULL AND NEW.willing_to_relocate IS DISTINCT FROM OLD.willing_to_relocate
    AND NOT (erasing AND NEW.willing_to_relocate IS NULL) THEN
    RAISE EXCEPTION 'application_relocation_immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.application_candidate_location_immutable() FROM PUBLIC;
CREATE TRIGGER application_candidate_location_immutable BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.application_candidate_location_immutable();
