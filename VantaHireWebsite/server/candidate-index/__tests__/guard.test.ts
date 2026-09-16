import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error Source-owned ESM CLI has no generated declaration file.
import { AUTHORITIES, FROZEN, MIGRATION, PROCESSOR_REQUIRED, SQL_REQUIRED, CATCHUP_REQUIRED, checkCandidateIndex } from "../../../scripts/check-candidate-index.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
function mutated(path: string, change: (text: string) => string, repin = false) {
  const scratch = mkdtempSync(join(tmpdir(), "flow-index-guard-"));
  try {
    for (const path of new Set<string>([...Object.keys(FROZEN), ...AUTHORITIES])) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      cpSync(join(root, path), join(scratch, path));
    }
    const before = readFileSync(join(scratch, path), "utf8");
    const after = change(before); expect(after).not.toBe(before);
    writeFileSync(join(scratch, path), after);
    if (repin) {
      const target = join(scratch, "server/schema-migrations/checksums.lock");
      const lock = JSON.parse(readFileSync(target, "utf8"));
      lock.migrations["0012"] = createHash("sha256").update(after).digest("hex");
      writeFileSync(target, JSON.stringify(lock));
    }
    return checkCandidateIndex(scratch) as string[];
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
describe("candidate index schema authority", () => {
  it("accepts the exact authored boundary", () => expect(checkCandidateIndex(root)).toEqual([]));
  it.each(SQL_REQUIRED as string[])("refuses checksum-repinned removal of %s", token => {
    expect(mutated(MIGRATION, s => s.replaceAll(token, "REMOVED"), true).some(e => e.includes("index_sql_invariant"))).toBe(true);
  });
  it.each(PROCESSOR_REQUIRED as string[])("refuses processor fence removal: %s", token => {
    expect(mutated("server/candidate-index/processor.ts", s => s.replaceAll(token, "REMOVED")))
      .toContainEqual(expect.stringContaining("index_processor"));
  });
  it.each(CATCHUP_REQUIRED as string[])("refuses catchup fence removal: %s", token => {
    expect(mutated("server/candidate-index/catchup.ts", s => s.replaceAll(token, "REMOVED")))
      .toContainEqual(expect.stringContaining("index_catchup"));
  });
  it.each(["processor.ts", "search.ts"])("refuses an insert-only intake outbox read in %s", file => {
    expect(mutated(`server/candidate-index/${file}`, s => s + '\nconst forbiddenQuery = "SELECT 1 FROM organization_candidate_memory_outbox";\n'))
      .toContain("index_runtime_forbidden_outbox_read");
  });
  it.each([
    ["server/candidate-index/processor.ts", "SELECT pg_try_advisory_lock(hashtext('flow:candidate-index:legacy'),$1) AS acquired", "index_legacy_session_fence"],
    ["server/candidate-index/processor.ts", "client.release(lost)", "index_legacy_session_fence"],
    ["server/lib/applicationGraphSyncProcessor.ts", "return withLegacyCandidateIndexFence(application.organizationId, application.id, async (checkIndexOwnership) => {", "index_legacy_session_fence"],
    ["server/lib/applicationGraphSyncProcessor.ts", "if (error.code === 'busy') return;", "index_legacy_session_fence"],
    ["server/lib/applicationGraphSyncProcessor.ts", "await checkIndexOwnership();", "index_legacy_dispatch_fences"],
    ["server/candidate-index/processor.ts", 'candidateIndexMode(options.env ?? process.env) !== "private_primary"', "index_legacy_adoption"],
    ["server/candidate-index/processor.ts", "SELECT public.flow_candidate_index_managed_application($1,$2) AS managed", "index_legacy_adoption"],
    ["server/candidate-index/processor.ts", 'typeof result.rows[0]?.managed !== "boolean"', "index_legacy_adoption"],
    ["server/applications.routes.ts", "&& await shouldEnqueueLegacyApplication(application.organizationId, application.id)", "index_legacy_adoption"],
    ["server/schema-control/readiness.ts", "has_column_privilege", "index_readiness"],
    ["server/schema-control/readiness.ts", "candidateIndexPrivilegesReady(pg, who.rows[0]?.role, true)", "index_readiness"],
    ["server/schema-control/runtimeRole.ts", "for (const signature of CANDIDATE_INDEX_FUNCTIONS)", "index_role"],
    ["server/candidate-index/contracts.ts", "Number.isSafeInteger", "index_wire_contract"],
    ["server/candidate-index/contracts.ts", "CANDIDATE_INDEX_AI_FLAG_FORBIDDEN", "index_placement_config"],
    ["server/aiWorker.ts", "assertCandidateIndexWorkerConfig();", "index_worker_startup_order"],
    ["server/organization-candidates/application-intake.ts", "FROM resume_insert r CROSS JOIN outbox_insert", "index_atomic_capture"],
    ["server/candidate-index/memory-client.ts", "await input.beforeAttempt()", "index_transport"],
    ["server/candidate-index/memory-client.ts", "parsed.data.command_digest !== candidateIndexCommandDigest(command, tenant)", "index_transport"],
    ["server/candidate-index/memory-client.ts", "size > MAX_RESPONSE_BYTES", "index_transport"],
    ["server/index.ts", "const indexConfig = candidateIndexProcessorConfig();", "index_web_startup"],
    ["server/index.ts", "stopCandidateIndexProcessor = startCandidateIndexProcessor(indexConfig);", "index_web_startup"],
    ["package.json", "--format=cjs --outfile=dist/candidate-index-gcs.cjs", "index_storage_artifact"],
    ["server/candidate-index/search.ts", 'scopes: "organization-candidate-index:read"', "index_search_adapter"],
    ["server/candidate-index/search.ts", "size > MAX_SEARCH_RESPONSE_BYTES", "index_search_adapter"],
    ["server/candidate-index/search.ts", "row.reference_id === hit.reference_id", "index_search_adapter"],
    ["server/candidate-index/search.ts", "a.job_id=r.job_id", "index_search_adapter"],
    ["server/candidate-index/search.ts", '!["source", "org_id", "job_id"].includes(key)', "index_search_adapter"],
    ["server/candidates.semantic.routes.ts", "!isSuperAdminGlobalSearch && candidateIndexMode() !== null", "index_search_route"],
    ["server/candidates.semantic.routes.ts", "verifyCandidateIndexHitTuples(orgId!, indexResponse.results)", "index_search_route"],
    ["server/candidates.semantic.routes.ts", "getApplicationsByIdsForOrg(appIds, orgId!)", "index_search_route"],
    ["server/candidates.semantic.routes.ts", "indexReranker: indexResponse.reranker", "index_search_route"],
  ])("refuses authority drift in %s", (path, token, code) => {
    expect(mutated(path, s => s.replaceAll(token, "REMOVED")).some(e => e.includes(code))).toBe(true);
  });
  it("refuses PUBLIC execute even with a refreshed checksum", () => {
    expect(mutated(MIGRATION, s => s.replace("REVOKE ALL ON FUNCTION public.flow_claim_candidate_index_delivery(integer,integer) FROM PUBLIC;", ""), true)).toContainEqual(expect.stringContaining("index_public_execute"));
  });
  it("refuses an overlong catalog name", () => {
    expect(mutated(MIGRATION, s => s + `\nCREATE INDEX ${"x".repeat(64)} ON public.candidate_index_outbox(outbox_id);`, true)).toContain("index_identifier_length");
  });
  it("refuses a changed historical migration", () => {
    expect(mutated("server/schema-migrations/0011_candidate_consent.sql", s => s + "\n-- drift\n")).toContainEqual(expect.stringContaining("index_frozen"));
  });
});
