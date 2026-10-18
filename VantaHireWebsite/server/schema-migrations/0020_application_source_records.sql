-- Owner-only record of where a public applicant came from: referring site host,
-- UTM tags and first-landing time. Minimal tracking data linked to an applicant.
-- The ordinary runtime role may INSERT only (provisioner + readiness enforce it);
-- no application path can read, change or delete rows. Owner queries are
-- read-only and scoped. Rows go with their application.
CREATE TABLE public.application_source_records (
  application_id integer PRIMARY KEY REFERENCES public.applications(id) ON DELETE CASCADE,
  record jsonb NOT NULL
    CONSTRAINT application_source_records_record_ck
    CHECK (jsonb_typeof(record) = 'object' AND octet_length(record::text) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE public.application_source_records FROM PUBLIC;
