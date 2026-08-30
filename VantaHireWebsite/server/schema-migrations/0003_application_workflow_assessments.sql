-- Wave 2G — truthful, organization-bound application workflow assessments.
-- Forward-only and additive: legacy anonymous notes/shared ratings are untouched.

SET LOCAL search_path = public, pg_catalog;

CREATE TABLE public.application_reviewer_notes (
  id serial PRIMARY KEY,
  application_id integer NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id integer NOT NULL REFERENCES public.users(id),
  note text NOT NULL,
  visibility text NOT NULL DEFAULT 'organization_private',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT application_reviewer_notes_note_length_check
    CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  CONSTRAINT application_reviewer_notes_visibility_check
    CHECK (visibility = 'organization_private')
);

CREATE INDEX application_reviewer_notes_application_time_idx
  ON public.application_reviewer_notes(application_id, created_at, id);
CREATE INDEX application_reviewer_notes_organization_idx
  ON public.application_reviewer_notes(organization_id);
CREATE INDEX application_reviewer_notes_author_idx
  ON public.application_reviewer_notes(author_id);

CREATE TABLE public.application_reviewer_ratings (
  application_id integer NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  organization_id integer NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reviewer_id integer NOT NULL REFERENCES public.users(id),
  rating integer NOT NULL,
  rubric_version text NOT NULL DEFAULT 'application-rating-v1',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, reviewer_id),
  CONSTRAINT application_reviewer_ratings_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT application_reviewer_ratings_rubric_version_check
    CHECK (rubric_version ~ '^[a-z0-9][a-z0-9-]{0,79}$')
);

CREATE INDEX application_reviewer_ratings_organization_idx
  ON public.application_reviewer_ratings(organization_id);
CREATE INDEX application_reviewer_ratings_reviewer_idx
  ON public.application_reviewer_ratings(reviewer_id);

ALTER TABLE public.application_feedback
  ADD COLUMN rubric_version text NOT NULL DEFAULT 'legacy-unversioned-v1',
  ADD CONSTRAINT application_feedback_rubric_version_check
    CHECK (rubric_version ~ '^[a-z0-9][a-z0-9-]{0,79}$');
