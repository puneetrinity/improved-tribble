#!/usr/bin/env node
// Wave 4D Flow index guard: H1 schema/role authority plus H2 source capture, transport, processor, legacy fence,
// adopted-only cutover, web-only timer, AI-worker refusal, private search adapter and catchup boundaries.
// The search/cutover and cross-system gates are enforced below (H2 complete); the label lists every section.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FROZEN = {
  "client/src/components/candidate/CandidateConsentPanel.tsx": "2f5f4541548f0fc02808f3d005c8a75f00c2d2fa9984f54c78ce661725d5afaa",
  "client/src/pages/candidate-dashboard.tsx": "c81367ee9c9ebc3d0d10cd171a72f146767bc499b9591d6e3dc5df30d6112409",
  "package-lock.json": "b985825f298cda976afa6f46792d4eab13ceaa19560efc48098168f187337539",
  "playwright.config.ts": "98cf29f15ddd205e42c713db919a54737bedcf2437b410c61f33df4f75d43e46",
  "server/ai.routes.ts": "f63c870b20405f82f161733aea7b82d43202baaf50b9e7e1487851cf2635e4c2",
  "server/auth.ts": "25113b8fa50d0845ccb205b4fa02bae7c424e7b13aed30149d87b7e06a54b468",
  "server/candidate-consent/contracts.ts": "07bf05a48f5c475f3b44d30d1092196b106a5423174e4794a816ff8e9edb756e",
  "server/candidate-consent/memory-client.ts": "af32e401541bf21a8fdf33e09cc78c095948efaa62f151bd641a194b6eed8371",
  "server/candidate-consent/processor.ts": "ac2e75c87ed96d448579190ab82772655497510d850a71969ae826d5def47593",
  "server/candidate-consent/repository.ts": "baf4d5c7a2cbcf164f364099ff95b3a28b94cd1fcfc26fc20a488dc8245081fd",
  "server/candidate-consent/routes.ts": "bc5f52d1710f7337eb27a74b729a2b4c07d946bc9c4fa23886152d2c525c5efa",
  "server/candidate-privacy/decision.ts": "02bd1b412deb3f89f8cd4646dae19a2a0825486acf0c09c109c247da83c38f52",
  "server/candidate-privacy/memory-client.ts": "0f393868e04898b4091a4057b7f5fd30d92d1458dd30e1844d5fc36e5217e9e5",
  "server/candidate-privacy/repository.ts": "940e5617415a95b1fc1dbc823e48920bfa1031b26b641f29e2537c1786f1358b",
  "server/candidate-privacy/routes.ts": "5c6e77157b839026051716984fffba990057a29cdf8b3b4dd1de98d1014c45d9",
  "server/candidatePortal.routes.ts": "8b2a708e3910ef547dd7c4825b5e6132408776d21284123e7db2b501a24ba470",
  "server/db.ts": "25705dad7df8159fc3cac431ab18d87c84686627fff591ac3fead30a67c74ba7",
  "server/gcs-storage.ts": "5354cc3391894ae91fd2f6c5dca656a1aaf6a6eae175deee76782cf690360802",
  "server/lib/resumeExtractor.ts": "217ed1dd5b7c23fa6945d5602c55286cc5655ff8ba481f3b5dbf106fea44c0f2",
  "server/lib/services/activekg-client.ts": "936ce79804d7380bf2f213354a6a5128ef24c96a58d321caa1dce54a73be140d",
  "server/lib/services/jwt-signer.ts": "0213eb5984388fba2c3e4bf8893ac94b7fbaecc1f669b12b50519ef0a24cd490",
  "server/organization-candidates/contracts.ts": "e68a6226ac9225f4767ffa69d2431392f15b6d9aef8857202047eddbf81696c8",
  "server/organization-candidates/memory-client.ts": "216691b47c39d3b8d54201cecf1b065f5bc55a95d5e5790bf41e8e177922e77b",
  "server/organization-candidates/processor.ts": "379701feac382b3b42e37e16ff9144adc595244a272e378b519d860b5c11d914",
  "server/profile.routes.ts": "e777114341fb77bdaac98cc3d661fc5920c4965999472790cd60eb4fd8422aa7",
  "server/schema-control/ledger.ts": "b6f66feaa701368336419b9496c10ebceef961dd81545e6db6b416cd06d01cb4",
  "server/schema-control/manifest.ts": "16e6b04b6a67467eb0319fe3c9a09fccbed9be55c65a0c866723467ea613bda2",
  "server/schema-control/runner.ts": "405ebae74933f0915317ff398edaaabe992e30518eb30a957af071d22271276b",
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
  "server/schema-migrations/0010_organization_private_candidate_reference.sql": "eaecd7bdc1637aaa314bc0c04c123b1fcfbeb8501d2cc83c8cb58b8a75a30495",
  "server/schema-migrations/0011_candidate_consent.sql": "0d544103c5cacc60861b3916b243d2ae8690b8a470ed7233222eff4c3c7f4b74",
  "server/schema-migrations/catalog.lock.json": "999636b7722cc305b10f71b9a096cc75701400ff49aea91435f839cadf13b90c",
  "server/storage.ts": "3fb44fa5515fb8cc0b9ac0556e3f22c62aa1397868cb2353d2c465ad13e60d03"
};
export const MIGRATION = "server/schema-migrations/0012_candidate_index_delivery.sql";
export const AUTHORITIES = [MIGRATION, "server/schema-migrations/checksums.lock",
  "server/candidate-index/contracts.ts", "server/schema-control/readiness.ts",
  "server/schema-control/runtimeRole.ts", "package.json", "server/aiWorker.ts",
  "server/candidate-index/memory-client.ts", "server/organization-candidates/application-intake.ts",
  "server/candidate-index/processor.ts", "server/index.ts", "server/candidate-index/search.ts",
  "server/candidates.semantic.routes.ts", "server/applications.routes.ts", "server/lib/applicationGraphSyncProcessor.ts",
  "server/candidate-index/catchup.ts"];
export const CATCHUP_REQUIRED = [
  'kind: z.literal("flow_application_catchup")', "CATCHUP_ATTEMPTS_PER_SOURCE = 5",
  "body.entries.length * CATCHUP_ATTEMPTS_PER_SOURCE > body.maxProviderAttempts",
  "body.expiresAt - body.issuedAt > 7_200_000", "sameMac(seal, mac(key, body))",
  "p.flowTree === p.legacyWorkerTree", 'mode: z.literal("private_primary")',
  'await client.query("BEGIN READ ONLY")', "WHERE r.resume_version_id>$1::uuid ORDER BY r.resume_version_id LIMIT $2",
  'row.origin_code !== "candidate_applied"', 'row.intake_state !== "acknowledged"',
  'if (row.bindings !== 1)', 'if (row.managed === true)', 'new Skip("source_orphaned")',
  'new Skip("legacy_uncertain")', "requireOrganizationCandidateApplicationAllowed", "downloadCandidateIndexOriginal",
  "bytes.length !== row.byte_count || hash(bytes) !== row.content_sha256",
  'input.operatorApproved !== true || candidateIndexMode() !== "private_primary"',
  "await deps.readRunningPosture()", "JSON.stringify(identity(current[0])) !== JSON.stringify(entry)",
  "SELECT public.flow_capture_candidate_index_catchup($1,$2,$3) AS id", "alive();",
  "constants.O_NOFOLLOW", "constants.O_EXCL", "info.nlink !== 1", "await parent.sync()", "await journal.sync()",
  "row.previous !== chain", "sameMac(seal, mac(input.key, body))", "client.release(uncertain || broken)",
];
export const PROCESSOR_REQUIRED = [
  'export const INDEX_FETCH_LIMITS = \'ulimit -t 20 && ulimit -c 0 && exec "$@"\'',
  'export const INDEX_VALIDATE_CHILD', 'require(\'node:net\').Socket.prototype.connect = refuse',
  'strict ? INDEX_DOWNLOAD_LIMITS : INDEX_FETCH_LIMITS',
  'strict ? INDEX_VALIDATE_CHILD : INDEX_DOWNLOAD_CHILD',
  'strict ? { LANG: "C.UTF-8", NODE_ENV: "production" } : childEnv',
  'const remaining = deadline - Date.now()',
  'env.NODE_ENV !== "test"', 'endpoint.hostname !== "127.0.0.1"',
  'ulimit -v 262144 && ulimit -t 20 && ulimit -c 0 && exec "$@"',
  "268435456", "fs.readFileSync('/proc/self/limits'", "bytes.length > 5242880",
  'timeoutMs > 20_000', '"--jitless", "--max-old-space-size=48", "--v8-pool-size=1"',
  '"GCS_PROJECT_ID", "GCS_BUCKET_NAME", "GCS_SERVICE_ACCOUNT_KEY"',
  "childEnv[name] = env[name]", 'stdio: ["pipe", "pipe", "ignore"]',
  "gcs.downloadBoundApplicationResumeFromGCS(request.locator)", "detected?.mime !== request.mediaType",
  'child.kill("SIGKILL")', 'child.once("close", code =>',
  'options.signal.addEventListener("abort", abort, { once: true })',
  "size > CANDIDATE_INDEX_LIMITS.originalBytes", "sha(bytes) !== input.contentSha256",
  "SELECT * FROM public.flow_claim_candidate_index_delivery($1,$2)",
  "AND a.organization_id=r.organization_id AND a.job_id=r.job_id",
  "r.resume_version_id=$1 AND r.reference_id=$2 AND r.organization_id=$3",
  "AND r.application_id=$4 AND r.job_id=$5 AND r.version=$6",
  "row.content_sha256 !== claim.content_sha256", "!== claim.payload_sha256",
  "await admit({ applicationId: claim.application_id, email: evidence.email, phone: evidence.phone })",
  "await admit({ applicationId: claim.application_id, email: current.email, phone: current.phone })",
  "current.email !== evidence.email || current.phone !== evidence.phone",
  "[1, config.leaseMs]", "claim.lease_token, claim.generation, receipt.idempotency_key",
  "claim.payload_sha256, receipt.source_id, receipt.command_digest",
  "if (signal.aborted) break", "if (current || controller.signal.aborted) return",
  "controller.abort()", "await current;",
];
export const SQL_REQUIRED = [
  "source_version = 1", "content_kind IN ('pinned_text','original_bytes')",
  "content_kind <> 'original_bytes' OR payload_sha256 = content_sha256",
  "FOREIGN KEY (reference_id,organization_id,application_id,job_id)",
  "FOREIGN KEY (resume_version_id,reference_id,organization_id,application_id,job_id)",
  "candidate_index_outbox_resume_unique UNIQUE (reference_id,resume_version_id,source_version)",
  "NEW.captured_at=v_source.captured_at", "NEW.idempotency_key=v_key",
  "NEW.payload_sha256=v_payload", "NEW.content_sha256=v_source.content_sha256",
  "BEFORE UPDATE OR DELETE", "BEFORE TRUNCATE",
  "IF NOT EXISTS (SELECT 1 FROM public.candidate_index_outbox) THEN RETURN NULL",
  "p_limit BETWEEN 1 AND 8", "p_lease_ms BETWEEN 11000 AND 300000",
  "b.job_id=o.job_id AND b.state='acknowledged' AND b.memory_candidate_id IS NOT NULL",
  "b.reference_id=o.reference_id AND b.resume_version_id=o.resume_version_id",
  "FOR UPDATE OF o SKIP LOCKED", "v_state.attempts>=8",
  "a.organization_id=v_row.organization_id AND j.organization_id=v_row.organization_id",
  "attempts=public.candidate_index_delivery_state.attempts+1",
  "generation=public.candidate_index_delivery_state.generation+1",
  "s.generation=p_generation", "s.lease_token=p_lease_token",
  "s.lease_expires_at>clock_timestamp()", "o.idempotency_key=p_key",
  "o.resume_version_id=p_resume_version_id AND o.payload_sha256=p_payload_sha256",
  "WHEN p_code='privacy_restricted' THEN 'privacy_restricted'",
  "'response_mismatch')", "p_retry_ms BETWEEN 0 AND 3600000",
  "FOR KEY SHARE OF a,j", "r.organization_id=p_organization_id AND r.reference_id=p_reference_id",
  "ON CONFLICT ON CONSTRAINT candidate_index_outbox_resume_unique DO NOTHING",
  "pg_try_advisory_xact_lock(hashtext('flow:candidate-index:legacy'),v_source.application_id)",
  "candidate_index_catchup_legacy_busy", "candidate_index_catchup_legacy_uncertain",
  "WHERE g.application_id=v_source.application_id FOR UPDATE;",
  "(g.attempts=0 AND g.status='pending')",
  "OR (g.attempts=1 AND g.status IN ('succeeded','privacy_restricted'))",
  ") IS NOT TRUE) THEN",
  "SECURITY DEFINER SET search_path=pg_catalog,public",
  "SET lock_timeout='1500ms' SET statement_timeout='3s'",
];
const ROUTINES = [
  "public.flow_claim_candidate_index_delivery(integer,integer)",
  "public.flow_ack_candidate_index_delivery(uuid,uuid,bigint,text,uuid,uuid,text,uuid,text)",
  "public.flow_fail_candidate_index_delivery(uuid,uuid,bigint,text,integer)",
  "public.flow_candidate_index_managed_application(integer,integer)",
  "public.flow_capture_candidate_index_catchup(integer,uuid,uuid)",
];
const digest = value => createHash("sha256").update(value).digest("hex");
export function checkCandidateIndex(root = ROOT) {
  const errors = [];
  const read = path => {
    if (!existsSync(join(root, path))) { errors.push("index_missing: " + path); return ""; }
    return readFileSync(join(root, path), "utf8");
  };
  const require = (source, tokens, code) => {
    for (const token of tokens) if (!source.includes(token)) errors.push(code + ": " + token);
  };
  for (const [path, hash] of Object.entries(FROZEN)) {
    if (digest(read(path)) !== hash) errors.push("index_frozen: " + path);
  }
  const sql = read(MIGRATION), contract = read("server/candidate-index/contracts.ts");
  try {
    if (JSON.parse(read("server/schema-migrations/checksums.lock")).migrations["0012"] !== digest(sql)) {
      errors.push("index_checksum");
    }
  } catch { errors.push("index_manifest_invalid"); }
  require(sql, SQL_REQUIRED, "index_sql_invariant");
  require(sql, ROUTINES.map(sig => `REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC;`), "index_public_execute");
  require(sql, ["REVOKE ALL ON FUNCTION public.flow_candidate_index_evidence_guard() FROM PUBLIC;",
    "REVOKE ALL ON public.candidate_index_outbox,public.candidate_index_delivery_state FROM PUBLIC;"], "index_public_acl");
  if ((sql.match(/CREATE TABLE public\./g) ?? []).length !== 2
      || (sql.match(/CREATE FUNCTION public\./g) ?? []).length !== 6
      || (sql.match(/SECURITY DEFINER/g) ?? []).length !== 5
      || (sql.match(/CREATE TRIGGER /g) ?? []).length !== 3) errors.push("index_object_census");
  for (const match of sql.matchAll(/(?:CREATE (?:UNIQUE )?(?:TABLE|INDEX|FUNCTION|TRIGGER)|CONSTRAINT)\s+(?:public\.)?(\w+)/g)) {
    if (Buffer.byteLength(match[1]) > 63) errors.push("index_identifier_length");
  }
  if (/\b(?:CASCADE|DISABLE\s+TRIGGER|BYPASSRLS)\b/i.test(sql)
      || /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+public\.(?!candidate_index_)\w+/i.test(sql)) errors.push("index_legacy_write_or_bypass");
  const tablePrefix = sql.slice(0, sql.indexOf("CREATE FUNCTION"));
  if (/^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im.test(tablePrefix)) errors.push("index_backfill");
  require(contract, ROUTINES, "index_contract_routines");
  require(contract, ['"candidate-index:v1", input.tenant, input.referenceId, input.resumeVersionId,',
    "input.sourceVersion, input.contentSha256, input.contentKind, input.payloadSha256",
    "JSON.stringify([", "Number.isSafeInteger", "input.contentSha256 !== input.payloadSha256",
    "originalBytes: 5 * 1024 * 1024", "textBytes: 2 * 1024 * 1024", "maxAttempts: 8"], "index_wire_contract");
  if (/\b(?:fetch|setInterval|setTimeout)\s*\(|\bconsole\.|from ["'](?:https?|net|tls|pg)["']/.test(contract)) errors.push("index_contract_side_effect");
  require(contract, ["CANDIDATE_INDEX_AI_FLAG_FORBIDDEN", "Object.prototype.hasOwnProperty.call(env, \"FLOW_CANDIDATE_INDEX_MODE\")",
    "leaseMs <= timeoutMs + 20_000 + 2_000"], "index_placement_config");
  const workerMain = read("server/aiWorker.ts").split("async function main()")[1] ?? "";
  if (!/^\s*:\s*Promise<void>\s*\{\s*assertCandidateIndexWorkerConfig\(\);/.test(workerMain)) errors.push("index_worker_startup_order");
  require(read("server/organization-candidates/application-intake.ts"), [
    "index_insert AS (", "INSERT INTO candidate_index_outbox", "FROM resume_insert r CROSS JOIN outbox_insert",
    "Number(row.index_intents) !== 1", "candidateIndexCommandKey({"], "index_atomic_capture");
  const client = read("server/candidate-index/memory-client.ts");
  require(client, ["await input.beforeAttempt()", "signal.throwIfAborted()", 'redirect: "error"',
    'scopes: "organization-candidate-source:write"', "size > MAX_RESPONSE_BYTES", "void reader.cancel()",
    "controller.abort()", "parsed.data.command_digest !== candidateIndexCommandDigest(command, tenant)",
    "parsed.data.reference_id !== command.reference_id", "parsed.data.resume_version_id !== command.resume_version_id"], "index_transport");
  const attempt = client.slice(client.indexOf("const attempt = async () =>"));
  if (attempt.indexOf("await input.beforeAttempt()") > attempt.indexOf("input.fetchImpl ?? fetch")) errors.push("index_privacy_dispatch_order");
  if (/\bconsole\.|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED/.test(client)) errors.push("index_transport_bypass_or_log");
  const search = read("server/candidate-index/search.ts");
  require(search, ['scopes: "organization-candidate-index:read"', 'redirect: "error"',
    "size > MAX_SEARCH_RESPONSE_BYTES", "controller.abort()", "Promise.race([attempt(), deadline])",
    'source: "vantahire", org_id: organizationId', '!["source", "org_id", "job_id"].includes(key)',
    '"candidate_index_filter_unsupported"', "candidateIndexSearchResponseSchema.safeParse(body)",
    "result.data.results.some(hit => hit.job_id !== metadata.job_id)",
    "r.organization_id=$1", "r.resume_version_id=ANY($2::uuid[])", "a.organization_id=r.organization_id", "a.job_id=r.job_id",
    "j.organization_id=r.organization_id", "row.reference_id === hit.reference_id",
    "row.resume_version_id === hit.resume_version_id"], "index_search_adapter");
  if (/\bconsole\.|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|\b(?:INSERT INTO|UPDATE public|DELETE FROM)\b/.test(search)) {
    errors.push("index_search_bypass_or_write");
  }
  if (/organization_candidate_memory_outbox/.test(search)
    || /organization_candidate_memory_outbox/.test(read("server/candidate-index/processor.ts"))) {
    errors.push("index_runtime_forbidden_outbox_read");
  }
  const semantic = read("server/candidates.semantic.routes.ts");
  require(semantic, ["!isSuperAdminGlobalSearch && candidateIndexMode() !== null",
    "else if (privateIndexRead)", "verifyCandidateIndexHitTuples(orgId!, indexResponse.results)",
    "application.organizationId === orgId && hit?.job_id === application.jobId",
    "hit.state === 'legacy' || bound.has(application.id)",
    "indexGeneration: indexed.generation", "sourceObservedAt: indexed.source_observed_at",
    "indexState: indexed.state", "indexProcessing: indexResponse.processing",
    "displayScoreType: indexResponse ? 'cosine' : scoreType", "indexReranker: indexResponse.reranker",
    "getApplicationsByIdsForOrg(appIds, orgId!)", "privacyFilteredResults.slice(0, requestedTopK)",
    "candidate_privacy_reconciliation_required", "if (privateIndexRead) {"], "index_search_route");
  const processor = read("server/candidate-index/processor.ts");
  require(processor, PROCESSOR_REQUIRED, "index_processor");
  require(processor, ["SELECT pg_try_advisory_lock(hashtext('flow:candidate-index:legacy'),$1) AS acquired",
    "SELECT pg_advisory_unlock(hashtext('flow:candidate-index:legacy'),$1) AS released",
    'if (row?.acquired === false) throw new CandidateIndexLegacyFenceError("busy");',
    'if (managed) throw new CandidateIndexLegacyFenceError("managed");',
    'if (lost) throw new CandidateIndexLegacyFenceError("unavailable");',
    'client.on("error", lostConnection)', 'client.removeListener("error", lostConnection)',
    "await check();", "return await work(check);", "client.release(lost)"], "index_legacy_session_fence");
  const legacyWorker = read("server/lib/applicationGraphSyncProcessor.ts");
  require(legacyWorker, ["return withLegacyCandidateIndexFence(application.organizationId, application.id, async (checkIndexOwnership) => {",
    "if (error.code === 'busy') return;", "'candidate_index_managed'",
    "if (error instanceof CandidateIndexLegacyFenceError) return error.code === 'unavailable';"], "index_legacy_session_fence");
  if ((legacyWorker.match(/await checkIndexOwnership\(\);/g) ?? []).length !== 7) errors.push("index_legacy_dispatch_fences");
  require(processor, ['candidateIndexMode(options.env ?? process.env) !== "private_primary"',
    "id.parse(organizationId); id.parse(applicationId);",
    "SELECT public.flow_candidate_index_managed_application($1,$2) AS managed",
    "[organizationId, applicationId]", 'typeof result.rows[0]?.managed !== "boolean"',
    "CANDIDATE_INDEX_LEGACY_GATE_UNAVAILABLE",
    "return !await applicationUsesPrivateIndex(organizationId, applicationId, options);"], "index_legacy_adoption");
  const applications = read("server/applications.routes.ts");
  const publicApply = applications.slice(applications.indexOf('app.post("/api/jobs/:id/apply"'),
    applications.indexOf("// Recruiter adds candidate on behalf"));
  require(publicApply, ["&& await shouldEnqueueLegacyApplication(application.organizationId, application.id)"],
    "index_legacy_adoption");
  if ((applications.match(/await shouldEnqueueLegacyApplication/g) ?? []).length !== 1
    || publicApply.indexOf("await shouldEnqueueLegacyApplication") < publicApply.indexOf("return created;")) {
    errors.push("index_legacy_adoption_scope");
  }
  if (/childEnv[^\n]*(?:\.\.\.|Object\.assign)|stdio\s*:[^\n]*inherit|\bSELECT\b[^\n]*candidate_index_(?:outbox|delivery_state)/i.test(processor)) {
    errors.push("index_processor_authority_bypass");
  }
  const dispatch = processor.slice(processor.indexOf("export async function runCandidateIndexProcessorOnce"));
  if (dispatch.indexOf("await admit(") > dispatch.indexOf("await download(")
    || dispatch.indexOf("signal.throwIfAborted();", dispatch.indexOf("const receipt = await deliver"))
      > dispatch.indexOf("flow_ack_candidate_index_delivery")) errors.push("index_processor_privacy_order");
  require(read("server/index.ts"), ["const indexConfig = candidateIndexProcessorConfig();",
    "stopCandidateIndexProcessor = startCandidateIndexProcessor(indexConfig);",
    "const indexStopped = stopCandidateIndexProcessor?.();", "Promise.resolve(indexStopped)"], "index_web_startup");
  const packageFile = read("package.json");
  require(read("server/candidate-index/catchup.ts"), CATCHUP_REQUIRED, "index_catchup");
  if (/from\s+["'][^"']*catchup["']/.test(read("server/index.ts"))
    || /from\s+["'][^"']*catchup["']/.test(read("server/aiWorker.ts"))) errors.push("index_catchup_startup_forbidden");
  require(packageFile, ['"build:server": "npm run build:candidate-index-storage &&',
    '"build:candidate-index-storage": "esbuild server/gcs-storage.ts',
    "--format=cjs --outfile=dist/candidate-index-gcs.cjs"], "index_storage_artifact");
  const ready = read("server/schema-control/readiness.ts");
  require(ready, ["count?.tables !== 2 || count?.functions !== 6", "catalog.rows[0]?.digest !== CANDIDATE_INDEX_CATALOG_SHA256",
    "has_column_privilege", "acl.is_grantable", "acl.grantee=0", "p.proconfig IS DISTINCT FROM",
    "candidateIndexPrivilegesReady(pg, who.rows[0]?.role, true)",
    "c.relname='candidate_index_outbox' AND v.privilege='INSERT'"], "index_readiness");
  const role = read("server/schema-control/runtimeRole.ts");
  require(role, ["index.tables === 2 && index.functions === 6", "CANDIDATE_INDEX_TRIGGER_FUNCTION",
    "for (const table of CANDIDATE_INDEX_TABLES)", "REVOKE SELECT(${columnList}),INSERT(${columnList}),UPDATE(${columnList})",
    "GRANT INSERT ON TABLE public.candidate_index_outbox TO ${ident}",
    "for (const signature of CANDIDATE_INDEX_FUNCTIONS)", "candidateIndexPrivilegesReady(pg, role, false)"], "index_role");
  require(read("package.json"), ['"check:candidate-index"', '"test:candidate-index:pg"'], "index_ci_wiring");
  return errors;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkCandidateIndex();
  if (errors.length) { console.error("candidate-index-guard: REFUSED\n" + errors.join("\n")); process.exitCode = 1; }
  else console.log("candidate-index-guard: OK (schema/roles/source-capture/transport/processor/cutover/search/catchup)");
}
