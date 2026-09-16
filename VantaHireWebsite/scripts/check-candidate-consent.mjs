#!/usr/bin/env node
// Wave 4C authority tripwires. Behavioral and PostgreSQL proofs are separate requirements.
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FROZEN = {
  "package-lock.json": "b985825f298cda976afa6f46792d4eab13ceaa19560efc48098168f187337539",
  "server/schema-migrations/catalog.lock.json": "999636b7722cc305b10f71b9a096cc75701400ff49aea91435f839cadf13b90c",
  "server/applications.routes.ts": "fc0775fd0affef38c3ac487d10a631eb949d96c80d89c8c85938d6cbf671613b",
  "server/storage.ts": "3fb44fa5515fb8cc0b9ac0556e3f22c62aa1397868cb2353d2c465ad13e60d03",
  "server/ai.routes.ts": "f63c870b20405f82f161733aea7b82d43202baaf50b9e7e1487851cf2635e4c2",
  "server/profile.routes.ts": "e777114341fb77bdaac98cc3d661fc5920c4965999472790cd60eb4fd8422aa7",
  "server/auth.ts": "25113b8fa50d0845ccb205b4fa02bae7c424e7b13aed30149d87b7e06a54b468",
  "server/candidatePortal.routes.ts": "8b2a708e3910ef547dd7c4825b5e6132408776d21284123e7db2b501a24ba470",
  "server/candidate-privacy/routes.ts": "5c6e77157b839026051716984fffba990057a29cdf8b3b4dd1de98d1014c45d9",
  "server/candidate-privacy/decision.ts": "02bd1b412deb3f89f8cd4646dae19a2a0825486acf0c09c109c247da83c38f52",
  "server/candidate-privacy/repository.ts": "940e5617415a95b1fc1dbc823e48920bfa1031b26b641f29e2537c1786f1358b",
  "server/candidate-privacy/models.ts": "ee35d6ab27d574e2d15ab07d77eda107e5a024a8fa712b575e1602410ce8acee",
  "server/gcs-storage.ts": "5354cc3391894ae91fd2f6c5dca656a1aaf6a6eae175deee76782cf690360802",
  "server/aiWorker.ts": "33005db9323727ba10abf08944f8dc6651aeef48549eb9195c222e7c4eb6a94f",
  "server/lib/services/jwt-signer.ts": "0213eb5984388fba2c3e4bf8893ac94b7fbaecc1f669b12b50519ef0a24cd490",
  "server/lib/applicationGraphSyncProcessor.ts": "c014dab9d22d4d5686b9611b986a080c7e65b1f2bad664059d22cbcc195b2f56",
  "server/organization-candidates/application-intake.ts": "d04e2745b5bb1e5cf7eac59cd723e9c78af50d7f4f64859ecfb4fbf382c90d0f",
  "server/organization-candidates/contracts.ts": "e68a6226ac9225f4767ffa69d2431392f15b6d9aef8857202047eddbf81696c8",
  "server/organization-candidates/processor.ts": "379701feac382b3b42e37e16ff9144adc595244a272e378b519d860b5c11d914",
  "server/organization-candidates/memory-client.ts": "216691b47c39d3b8d54201cecf1b065f5bc55a95d5e5790bf41e8e177922e77b",
  "scripts/check-organization-candidate-intake.mjs": "8ed9345effb2149b29690326ede2908f480623017af8d3da00692bbd0ffe0814",
  "vitest.config.ts": "d510e98b459c4bd35d15942156647bd2657822bf3ee925d563559dac71c689ab",
  "test/setup.ts": "2d54664a38658618b340df1c19a7d1016fb09559f1b10302e47181b752a6ef0f",
  "server/schema-migrations/0000_baseline.sql": "3fd883d6fb45d0c52acc69bff16949185948bb51e5d732f57247f542814aa129",
  "server/schema-migrations/0001_candidate_privacy_flow.sql": "a050e6b3e72a61b1d73c9124ddcd10eb6309f804891412dec9e15288df8c77c8",
  "server/schema-migrations/0002_resume_access_attempts.sql": "a8a838cff654c8da79820d45aac8fbfc0fec8a8411553dde9f3a1f05ba6d713c",
  "server/schema-migrations/0003_application_workflow_assessments.sql": "d32de49a1449bb6bc5c6608cbd0055c04695544b693ef1620864c555e0b3ef9c",
  "server/schema-migrations/0004_reviewer_share_authority.sql": "c813900aa1c56c2ec5d181b47f27aed046ca6ffe3a5028dc6631a94aa9131804",
  "server/schema-migrations/0005_privilege_authorization_version.sql": "31110ede0fffacfe3e0dd5d82bd3ce7bdcbb29c80b73e282cc2b80ef721ad42e",
  "server/schema-migrations/0006_versioned_invitation_grants.sql": "52bce39fffa581c06b9d2c3b8c0142dbe24a737cc52be9b3c224d1f25a89d3ff",
  "server/schema-migrations/0007_decision_event_spine.sql": "dfe9a98c271d5db12940ba75211d1ea5f0d3d75e68f478d06f1285df48fcda6d",
  "server/schema-migrations/0008_decision_projection_outbox.sql": "a90a01d6d5158980f415321c00169a2ed9f45779ab2ff5ebbbcae9aff7417c4f",
  "server/schema-migrations/0009_decision_projection_delivery_state.sql": "ce5999cab8bf087b838bdc05e4eca81d6012a1f044e957ff4ab196c41919f348",
  "server/schema-migrations/0010_organization_private_candidate_reference.sql": "eaecd7bdc1637aaa314bc0c04c123b1fcfbeb8501d2cc83c8cb58b8a75a30495"
};
export const AUTHORITIES = [
  "server/candidate-consent/contracts.ts", "server/candidate-consent/repository.ts",
  "server/candidate-consent/routes.ts", "server/candidate-consent/processor.ts",
  "server/candidate-consent/memory-client.ts", "server/schema-migrations/0011_candidate_consent.sql",
  "server/schema-migrations/checksums.lock", "server/schema-control/runtimeRole.ts",
  "server/schema-control/readiness.ts", "server/routes.ts", "server/index.ts", "package.json",
];
export function checkCandidateConsent(root = ROOT) {
  const problems = [];
  const read = path => {
    if (!existsSync(join(root, path))) { problems.push("missing consent authority: " + path); return ""; }
    return readFileSync(join(root, path), "utf8");
  };
  const require = (text, tokens, code) => { for (const token of tokens) if (!text.includes(token)) problems.push(code + ": " + token); };
  const before = (text, first, second, code) => {
    if (text.indexOf(first) < 0 || text.indexOf(second) < 0 || text.indexOf(first) >= text.indexOf(second)) problems.push(code);
  };
  for (const [path, pin] of Object.entries(FROZEN)) {
    if (createHash("sha256").update(read(path)).digest("hex") !== pin) problems.push("frozen consent dependency drifted: " + path);
  }
  const sources = Object.fromEntries(AUTHORITIES.map(path => [path, read(path)]));
  const route = sources["server/candidate-consent/routes.ts"];
  const repo = sources["server/candidate-consent/repository.ts"];
  const processor = sources["server/candidate-consent/processor.ts"];
  const transport = sources["server/candidate-consent/memory-client.ts"];
  const contract = sources["server/candidate-consent/contracts.ts"];
  const migration = sources["server/schema-migrations/0011_candidate_consent.sql"];
  for (const [method,path] of [["get","/api/candidate/consent"], ["get","/api/candidate/consent/sources"],
    ["post","/api/candidate/consent/grant"], ["post","/api/candidate/consent/withdraw"]]) {
    require(route, ['app.'+method+'("'+path+'", requireVerifiedCandidate'], "consent route authority missing");
  }
  if ((route.match(/\bapp\.(get|post|put|patch|delete)\(/g) ?? []).length !== 4
    || (route.match(/csrfProtection, requireRecentConsentAuth/g) ?? []).length !== 2) problems.push("consent route/csrf census changed");
  require(route, ["recentConsentAuth(req.session.privacyReauthenticatedAt", "req.user!.id", "req.user!.authVersion",
    "candidate_consent_temporarily_unavailable", 'res.status(complete ? 200 : 202)', "withdrawal_pending",
    "status.effective?.version === status.version"], "consent response authority missing");
  before(route, "await captureConsent(", "await runConsentProcessorOnce(", "consent fast path moved before commit");
  require(repo, ["Number.isFinite(at)", "at <= now", "now - at <= 600_000", "privacyPasswordVersion(password)",
    "SELECT pg_advisory_xact_lock(41943,$1)", "FROM public.users WHERE id=$1 FOR UPDATE",
    "user.auth_version !== authority.authVersion", "a.user_id=$2", "r.origin_code='candidate_applied'",
    '"FOR UPDATE OF a"', "flow_candidate_consent_resume_ready($1,$2)", "ready.rows[0]?.ready !== true",
    "candidate_consent_source_pending", "previousVersion !== request.expected_version",
    "prior.request_sha256 !== browserDigest", "publication_active: false", "effective_source_id",
    'await db.query("BEGIN")', 'await db.query("COMMIT")', 'await db.query("ROLLBACK")', "db.release()",
  ], "consent capture invariant missing");
  const capture = repo.slice(repo.indexOf("export async function captureConsent"), repo.indexOf("export async function loadConsentCommand"));
  require(capture, ["globalUse: true, newGlobalOperation: true"], "consent global admission missing");
  before(capture, "await ownedResume(", "INSERT INTO public.candidate_consent_subjects", "consent source proof after write");
  before(capture, "await requireCandidatePrivacyAllowed(", "INSERT INTO public.candidate_consent_subjects", "consent privacy after write");
  require(processor, ["globalUse: true, newGlobalOperation: true", "account.auth_version !== loaded.authVersion",
    "account.email_verified !== true", 'account.role !== "candidate"', "ownedResume(", "loaded.emailDigest",
    "config.leaseMs <= config.timeoutMs", "VANTAHIRE_JWT_PRIVATE_KEY", "VANTAHIRE_JWT_ACTIVE_KID",
    "flow_claim_candidate_consent_outbox", "flow_ack_candidate_consent_outbox", "flow_fail_candidate_consent_outbox",
    "row.generation", "Promise.all", "let running = false", "running || stopped", "clearInterval(timer)",
  ], "consent delivery invariant missing");
  before(processor, "await requireCandidatePrivacyAllowed(", "await deliver(", "consent grant delivery unfenced");
  require(transport, ['signServiceJwt("activekg"', 'scopes: "candidate-consent:write"', 'actorType: "service"',
    'redirect: "error"', "AbortSignal.timeout(timeoutMs)", 'url.protocol !== "https:"', "size > 8192",
    "consentReceiptSchema.safeParse", "receipt.subject_id !== command.subject_id",
    "receipt.event_id !== command.event_id", "receipt.command_digest !== identity.commandDigest",
    "receipt.effective_version !== command.version", 'response.status === 451',
  ], "consent transport invariant missing");
  require(contract, ["platform_professional_matching", "CONSENT_COPY_SHA256", "CONSENT_SAVED_COPY", "32 * 1024",
    "candidate-consent:v1", "Number.MAX_SAFE_INTEGER", ".strict()", "resume_version_id", "requestDigest",
  ], "consent protocol invariant missing");
  for (const [path,text] of Object.entries(sources).filter(([path]) => path.startsWith("server/candidate-consent/"))) {
    if (/\b(?:platformDiscoveryConsent|consentCapturedAt|enqueueApplicationGraphSyncJob|downloadFromGCS|uploadToGCS|GROQ_API_KEY|CRUSTDATA_API_KEY)\b/.test(text)) {
      problems.push("consent gained legacy/indexing/provider authority: " + path);
    }
    if (/\bconsole\.(?:log|error|debug|info)\s*\(/.test(text)) problems.push("consent raw-output primitive: " + path);
  }
  require(migration, ["consent_current_source_fk", "consent_effective_source_fk",
    "flow_candidate_consent_resume_ready", "SECURITY DEFINER SET search_path=pg_catalog,public",
    "acknowledged_version<o.version", "o.generation IS DISTINCT FROM p_generation", "FOR UPDATE OF subject SKIP LOCKED",
    "p_receipt->>'command_digest' IS DISTINCT FROM o.command_sha256::text", "o.attempts<8",
    "ERRCODE='55000'", "subject.desired_action='withdraw'", "generation=generation+1",
    "ON DELETE RESTRICT", "octet_length(profile::text)<=32768", "p_receipt ?& ARRAY",
  ], "consent SQL invariant missing");
  if ((migration.match(/CREATE TABLE public\.candidate_consent_/g) ?? []).length !== 4
    || (migration.match(/SECURITY DEFINER/g) ?? []).length !== 4
    || (migration.match(/BEFORE UPDATE OR DELETE/g) ?? []).length !== 2
    || (migration.match(/BEFORE TRUNCATE/g) ?? []).length !== 2) problems.push("consent SQL authority census changed");
  if (/DISABLE\s+TRIGGER/i.test(migration) || /^\s*(?:INSERT|UPDATE|DELETE)\s+/mi.test(migration.slice(0, migration.indexOf("CREATE FUNCTION")))) problems.push("consent migration bypass/backfill");
  for (const table of ["candidate_consent_subjects", "candidate_consent_sources", "candidate_consent_events", "candidate_consent_outbox"]) {
    for (const file of ["server/schema-control/runtimeRole.ts", "server/schema-control/readiness.ts"]) require(sources[file], [table], "consent role/readiness table missing");
  }
  for (const name of ["flow_claim_candidate_consent_outbox", "flow_ack_candidate_consent_outbox",
    "flow_fail_candidate_consent_outbox", "flow_candidate_consent_resume_ready"]) {
    require(sources["server/schema-control/readiness.ts"], [name], "consent role/readiness routine missing");
  }
  require(sources["server/schema-control/runtimeRole.ts"], ["CANDIDATE_CONSENT_FUNCTIONS", "for (const signature of CANDIDATE_CONSENT_FUNCTIONS)"], "consent provisioner routine enumeration missing");
  require(migration, ["CONSTRAINT consent_source_profile_shape", "CONSTRAINT consent_source_resume_shape",
    "jsonb_typeof(resume->'organization_id')='number'", "IS TRUE)", "5242880", "2147483647"], "consent scalar constraint missing");
  const constraints = sources["server/schema-control/readiness.ts"].match(/\["candidate_consent_[a-z]+","[a-z_0-9]+","[cfpu]",(?:true|false),(?:true|false),"[a-f0-9]{32}"\]/g) ?? [];
  if (constraints.length !== 58 || new Set(constraints).size !== 58
      || constraints.some(value => Buffer.byteLength(JSON.parse(value)[1]) > 63)) problems.push("consent constraint census invalid");
  require(sources["server/schema-control/readiness.ts"], ["md5(pg_get_constraintdef(c.oid))=value->>5",
    "c.convalidated", "c.condeferrable=(value->>3)::boolean"], "consent constraint definition check missing");
  require(sources["server/routes.ts"], ["registerCandidateConsentRoutes(app, doubleCsrfProtection)"], "consent registration missing");
  require(sources["server/index.ts"], ["consentDeliveryConfig()", "startConsentProcessor("], "consent timer registration missing");
  require(sources["package.json"], ['"check:candidate-consent"', '"test:candidate-consent:pg"'], "consent package checks missing");
  return problems;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkCandidateConsent();
  if (problems.length) { console.error("candidate-consent-guard: REFUSED\n" + problems.join("\n")); process.exitCode = 1; }
  else console.log("candidate-consent-guard: OK");
}
