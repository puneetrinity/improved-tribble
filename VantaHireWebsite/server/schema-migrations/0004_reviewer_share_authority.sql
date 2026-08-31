-- Wave 2I — durable form, client-share and hiring-manager invitation authority.
-- Forward-only and conservative: legacy attribution uses stored row shape only.

SET LOCAL search_path = public, pg_catalog;

ALTER TABLE public.forms
  ADD COLUMN ownership_scope text DEFAULT 'legacy_private';

UPDATE public.forms
   SET ownership_scope = CASE
     WHEN organization_id IS NOT NULL THEN 'organization'
     ELSE 'legacy_private'
   END;

ALTER TABLE public.forms
  ALTER COLUMN ownership_scope SET NOT NULL,
  ADD CONSTRAINT forms_ownership_scope_check
    CHECK (ownership_scope IN ('organization', 'personal', 'legacy_private')),
  ADD CONSTRAINT forms_ownership_scope_shape_check
    CHECK (
      (ownership_scope = 'organization' AND organization_id IS NOT NULL)
      OR
      (ownership_scope IN ('personal', 'legacy_private') AND organization_id IS NULL)
    );

CREATE INDEX forms_authority_scope_idx
  ON public.forms(ownership_scope, organization_id, is_published, created_by);

ALTER TABLE public.client_shortlists
  ADD COLUMN share_resume boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN share_ai_summary boolean NOT NULL DEFAULT FALSE;

ALTER TABLE public.client_shortlist_items
  ADD COLUMN public_ref uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX client_shortlist_items_public_ref_idx
  ON public.client_shortlist_items(public_ref);

ALTER TABLE public.hiring_manager_invitations
  ADD COLUMN organization_id integer NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN authority_scope text DEFAULT 'legacy_private';

UPDATE public.hiring_manager_invitations
   SET authority_scope = 'legacy_private';

ALTER TABLE public.hiring_manager_invitations
  ALTER COLUMN authority_scope SET NOT NULL,
  ADD CONSTRAINT hiring_manager_invitations_authority_scope_check
    CHECK (authority_scope IN ('organization', 'platform', 'legacy_private')),
  ADD CONSTRAINT hiring_manager_invitations_authority_scope_shape_check
    CHECK (
      (authority_scope = 'organization' AND organization_id IS NOT NULL)
      OR
      (authority_scope IN ('platform', 'legacy_private') AND organization_id IS NULL)
    );

CREATE INDEX hm_invitations_authority_issuer_idx
  ON public.hiring_manager_invitations(
    authority_scope,
    organization_id,
    invited_by,
    status,
    created_at DESC,
    id DESC
  );

CREATE INDEX hm_invitations_authority_email_idx
  ON public.hiring_manager_invitations(
    authority_scope,
    organization_id,
    invited_by,
    status,
    lower(email)
  );
