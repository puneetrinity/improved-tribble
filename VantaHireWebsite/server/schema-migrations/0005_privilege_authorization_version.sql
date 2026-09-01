-- Wave 2L-A — current privilege grants and authorization-version revocation.
-- Forward-only: classify legacy organization provenance without inference.

SET LOCAL search_path = public, pg_catalog;

ALTER TABLE public.users
  ADD COLUMN auth_version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT users_auth_version_positive_check
    CHECK (auth_version > 0);

ALTER TABLE public.organizations
  ADD COLUMN authority_origin text NULL,
  ADD COLUMN self_created_by_user_id integer NULL
    REFERENCES public.users(id) ON DELETE RESTRICT;

UPDATE public.organizations
   SET authority_origin = 'legacy_unknown',
       self_created_by_user_id = NULL;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_authority_origin_shape_check
    CHECK (
      (authority_origin IS NULL AND self_created_by_user_id IS NULL)
      OR
      (authority_origin = 'legacy_unknown' AND self_created_by_user_id IS NULL)
      OR
      (authority_origin = 'self_service_recruiter' AND self_created_by_user_id IS NOT NULL)
    );

CREATE UNIQUE INDEX organizations_self_service_creator_idx
  ON public.organizations(self_created_by_user_id)
  WHERE authority_origin = 'self_service_recruiter';
