-- Wave 2L-B — versioned invitation grants and durable hiring-manager provenance.
-- Forward-only and fail-closed: classify stored facts without membership or inviter inference.

SET LOCAL search_path = public, pg_catalog;

ALTER TABLE public.organization_invites
  ADD COLUMN state text,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN cancelled_at timestamp without time zone,
  ADD COLUMN cancelled_by integer
    REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN superseded_at timestamp without time zone;

UPDATE public.organization_invites
   SET token = encode(sha256(convert_to(token, 'UTF8')), 'hex'),
       state = CASE
         WHEN accepted_at IS NOT NULL AND accepted_by IS NOT NULL THEN 'accepted'
         ELSE 'legacy_revoked'
       END;

ALTER TABLE public.organization_invites
  ALTER COLUMN state SET NOT NULL,
  ADD CONSTRAINT organization_invites_state_check
    CHECK (state IN ('pending','accepted','cancelled','superseded','expired','legacy_revoked')),
  ADD CONSTRAINT organization_invites_version_positive_check
    CHECK (version >= 1),
  ADD CONSTRAINT organization_invites_state_shape_check
    CHECK (
      (state = 'pending'
        AND accepted_at IS NULL AND accepted_by IS NULL
        AND cancelled_at IS NULL AND cancelled_by IS NULL
        AND superseded_at IS NULL)
      OR (state = 'accepted'
        AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL
        AND cancelled_at IS NULL AND cancelled_by IS NULL
        AND superseded_at IS NULL)
      OR (state = 'cancelled'
        AND accepted_at IS NULL AND accepted_by IS NULL
        AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
        AND superseded_at IS NULL)
      OR (state = 'superseded'
        AND accepted_at IS NULL AND accepted_by IS NULL
        AND cancelled_at IS NULL AND cancelled_by IS NULL
        AND superseded_at IS NOT NULL)
      OR (state IN ('expired','legacy_revoked')
        AND NOT (accepted_at IS NOT NULL AND accepted_by IS NOT NULL)
        AND cancelled_at IS NULL AND cancelled_by IS NULL
        AND superseded_at IS NULL)
    );

DROP INDEX public.org_invites_org_email_idx;

CREATE UNIQUE INDEX org_invites_pending_email_idx
  ON public.organization_invites(organization_id, lower(email))
  WHERE state = 'pending';

CREATE INDEX org_invites_org_state_created_idx
  ON public.organization_invites(organization_id, state, created_at DESC, id DESC);

CREATE INDEX org_invites_token_state_idx
  ON public.organization_invites(token, state);

ALTER TABLE public.hiring_manager_invitations
  ADD COLUMN accepted_by_user_id integer
    REFERENCES public.users(id) ON DELETE RESTRICT,
  ADD COLUMN grant_version integer NOT NULL DEFAULT 1,
  ADD COLUMN revoked_at timestamp without time zone,
  ADD COLUMN revoked_by integer
    REFERENCES public.users(id) ON DELETE RESTRICT;

WITH unique_hiring_manager AS MATERIALIZED (
  SELECT lower(username) AS normalized_username,
         min(id)::integer AS user_id
    FROM public.users
   WHERE role = 'hiring_manager'
   GROUP BY lower(username)
  HAVING count(*) = 1
)
UPDATE public.hiring_manager_invitations AS invitation
   SET accepted_by_user_id = unique_hiring_manager.user_id
  FROM unique_hiring_manager
 WHERE invitation.status = 'accepted'
   AND invitation.authority_scope = 'organization'
   AND invitation.organization_id IS NOT NULL
   AND invitation.accepted_at IS NOT NULL
   AND invitation.revoked_at IS NULL
   AND lower(invitation.email) = unique_hiring_manager.normalized_username;

ALTER TABLE public.hiring_manager_invitations
  ADD CONSTRAINT hiring_manager_invitations_grant_version_positive_check
    CHECK (grant_version >= 1),
  ADD CONSTRAINT hiring_manager_invitations_revocation_shape_check
    CHECK (
      (revoked_at IS NULL AND revoked_by IS NULL)
      OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    ),
  ADD CONSTRAINT hiring_manager_invitations_accepted_user_shape_check
    CHECK (
      accepted_by_user_id IS NULL
      OR (
        status = 'accepted'
        AND authority_scope = 'organization'
        AND organization_id IS NOT NULL
        AND accepted_at IS NOT NULL
        AND revoked_at IS NULL
        AND revoked_by IS NULL
      )
    );

CREATE INDEX hm_invitations_eligibility_idx
  ON public.hiring_manager_invitations(
    authority_scope,
    organization_id,
    status,
    accepted_by_user_id,
    revoked_at
  );
