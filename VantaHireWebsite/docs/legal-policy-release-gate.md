# Legal policy release gate

Status: **READY — 1AE-P5 CLOSED; INDEPENDENT VERIFICATION REQUIRED BEFORE PUBLICATION**  
Re-authored against current Flow `c269c86f4eb38b725e66c0385f2154a48985870d` on 2026-08-26.

This companion change corrects stale provider, security, cookie, deletion, and retention wording in Flow's public
Privacy Policy, Terms of Service, and Cookie Policy. It must not be merged merely because the pages build.

The Privacy Policy and Terms start from the exact legal wording shipped with 1AF. This companion preserves those
load-bearing statements and layers only the evidence-backed provider, security, action-separation, recruiter-duty,
and cookie corrections below. It must never be replayed from the historical pre-1AF `8ef31ca…` draft.

## Candidate-privacy gate

The public candidate-privacy wording describes the approved Phase 1A behavior. Publish it only after all of the
following are independently verified in production:

1. **1AM — Memory authority:** the reversible directive ledger, projection, identity-token suppression, and Memory
   read/write/worker fences are deployed.
2. **1AF — Flow intake and enforcement:** verified candidate/support intake, the durable outbox and local projection,
   and every declared Flow reader/ingest fence are deployed.
3. **1AD — Discover enforcement:** the local projection and every declared provider, sourcing, materialization,
   enrichment, and outbox fence are deployed.
4. **1AR — reconciliation:** replay, cursor-gap, rebuild, stale-job, and outage proofs pass without raw identifiers in
   logs or contracts.
5. **1AE — enablement:** verified candidate and support intake is explicitly enabled only after the preceding gates.
6. A production proof confirms the four actions remain distinct: application withdrawal; organization/job/pool
   removal; future global-matching withdrawal; and verified erasure quarantine/review.

Phase 1A is reversible. These pages intentionally do **not** promise that a request immediately destroys every row,
file, backup, event, or derived artifact. They also do not promise fixed two-year or job-plus-one-year deletion
deadlines. Hard deletion, final per-data-class retention periods, legal holds, and ambiguous multi-basis adjudication
remain Phase 1B and require a separate destructive-data lock.

Production status at this review: 1AM, 1AF, 1AD, 1AR and 1AE are shipped and proved. 1AE-P3+P4 made intake live
and proved one `withdraw_global_matching` lifecycle end-to-end as `block_global`, without hard deletion or
external provider work. 1AE-P5 re-proved the live intake and safety posture, kept the single synthetic directive
active as the append-only proof, restored auto-deploy on all seven runtimes, and confirmed that no deployment was
queued. The known Memory embedding-worker split pin remains unchanged under its approved rider. The production
prerequisite for this companion is closed; independent verification of these exact companion bytes is the final
gate before publication.

## Current Indian data-protection posture

This policy describes product behavior and uses conditional language for legal requests; it does not claim that
every provision of the Digital Personal Data Protection Act, 2023 is already in force. The Government of India's
13 November 2025 commencement notification brings the Act's substantive processing obligations and data-principal
rights in sections 3–17 into force eighteen months after that notification. The final Digital Personal Data
Protection Rules, 2025 use the same phased approach for the corresponding operational rules. Publication review
must re-check the applicable commencement state whenever this wording changes.

Authoritative references:

- https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf
- https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf
- https://www.indiacode.nic.in/indiacode/handle/123456789/22037?view_type=browse

## Evidence for the cookie and security corrections

The shipped Cookie Policy contradicted the current implementation in concrete, testable ways:

- it named nonexistent `session_id`, `csrf_token`, `cookie_consent`, and `user_preferences` cookies, while
  `server/auth.ts` uses the Express default `connect.sid`, `server/csrf.ts` uses
  `__Host-psifi.x-csrf-token`, `client/src/components/ui/sidebar.tsx` uses `sidebar_state`, and
  `client/src/components/CookieConsent.tsx` stores `consent.analytics` in local storage;
- it listed `_gid` and `_gat`, fixed generic retention periods, Google Cloud cookies, OpenAI cookies, performance
  cookies, and A/B testing without a corresponding application-side contract;
- the live consent component loads Google Analytics and Apollo only from the accepted-consent branch and reloads
  them only when the persisted value is `accepted`; the declined branch loads neither provider; and
- the implemented lifetimes are 24 hours for the authentication cookie and seven days for `sidebar_state`, while
  the analytics identifiers remain provider-managed rather than application-promised fixed periods.

The shipped Privacy Policy also claimed CSRF protection on **all** state changes. The code instead attaches the
double-submit middleware to declared covered session routes and intentionally exempts token-authenticated public
form endpoints. The companion narrows the claim to the implemented route-scoped control and does not claim a
universal guarantee.

## Cookie and provider gate

Before publication, verification must also confirm:

- the production session cookie is still the Express default `connect.sid` with a 24-hour maximum age;
- the production CSRF cookie is still `__Host-psifi.x-csrf-token`;
- the sidebar preference cookie is still `sidebar_state` with a seven-day maximum age;
- the analytics choice is still stored as `consent.analytics` in local storage;
- Google Analytics and the Apollo website tracker are injected only after an accepted analytics choice; and
- the public provider categories still match the services actually enabled in production.

The three pages are prepared with `Last Updated: August 26, 2026`. If publication occurs on another date, update
all three values and re-run the contract test before release.

The automated source contract checks these repository facts, but production configuration and observed behavior must
still be verified before deployment.

`client/public/security.txt` was reviewed on the shipped source and remains current: contact, policy, language,
hiring, and expiry fields need no change. It is intentionally absent from this companion diff.

## Review ownership

Ealana does not currently have a separate legal team. Engineering owns claims-code parity and the product owner
owns the user-facing meaning and publication decision. This review deliberately avoids inventing legal bases,
fixed retention periods, universal security guarantees, or remedies the product does not implement. The Terms
also preserve rights, remedies, and forums that cannot lawfully be waived. If the applicable law or product
behavior changes, the pages must be reviewed and corrected again before publication.
