## GlitchTip Uptime Monitors

Use GlitchTip monitors against the existing health endpoints. This repo already exposes:

- `/healthz`
- `/readyz`
- `/api/health`

Recommended setup:

1. `VantaHire Web Health`
- URL: `https://<your-domain>/healthz`
- method: `GET`
- interval: `1 minute`
- timeout: `10 seconds`
- expected status: `200`

2. `VantaHire Readiness`
- URL: `https://<your-domain>/readyz`
- method: `GET`
- interval: `1 minute`
- timeout: `10 seconds`
- expected status: `200`

3. Optional `VantaHire API Health`
- URL: `https://<your-domain>/api/health`
- method: `GET`
- interval: `5 minutes`
- timeout: `10 seconds`
- expected status: `200`

Notes:

- `/healthz` is the liveness check.
- `/readyz` confirms the database is reachable.
- Keep alert routing separate from issue alerts so uptime failures stay obvious.
- Do not point monitors at authenticated/internal pages.
