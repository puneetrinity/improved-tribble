# SpotAxis Integration

This project can source job listings and job details from a running SpotAxis instance, while keeping the rest of the VantaHire UI unchanged.

## Quick Start

1) Run SpotAxis locally and note its base URL (for example: `http://localhost:8000`).

2) Start VantaHireWebsite with environment variable:

```
SPOTAXIS_BASE_URL=http://localhost:8000 npm run dev
```

When this env var is set, the API endpoints `/api/jobs` and `/api/jobs/:id` proxy to SpotAxis:

- List jobs: proxies to `GET /api/vacancy/search/?page=<n>&page_size=<limit>&search=<query>`
- Job details: proxies to `GET /api/vacancy/<id>/`

Fields from SpotAxis are mapped to the UI’s expected shape (title, location, description, skills, createdAt, deadline). Rich HTML descriptions are stripped to plain text for display.

If the SpotAxis vacancy provides an `application_url`, the job details page shows an “Apply on SpotAxis” button linking to that URL instead of the local upload form.

Note: application submission is not proxied. In integration mode, users apply directly on SpotAxis. If you want full proxying of the multi‑step apply flow, we can extend the adapter to call `apply/public`, `apply/new`, and `apply/complete` endpoints.

## Optional Careers URL

To target a specific organization’s branded careers site or a multi‑tenant subdomain, set:

```
SPOTAXIS_CAREERS_URL=https://your-subdomain.spotaxis.example.com/jobs/
```

Then VantaHire links (e.g. “Careers / Job Board”) go to this URL.

## Quick Admin Links

VantaHire exposes helper redirects so you don’t need to hardcode SpotAxis URLs in the client:

- `/spotaxis/admin` → `${SPOTAXIS_BASE_URL}/admin/`
- `/spotaxis/recruiter` → `${SPOTAXIS_BASE_URL}/profile/employer/`
- `/spotaxis/job/new` → `${SPOTAXIS_BASE_URL}/job/edit/`
- `/spotaxis/jobs` → `${SPOTAXIS_CAREERS_URL}` or `${SPOTAXIS_BASE_URL}/jobs/`

The recruiter dashboard and job post page surface these links when integration is enabled.

## Disabling Integration

Unset the env var to use the built‑in storage and routes:

```
npm run dev
```

The server log prints a notice when SpotAxis integration is enabled.
