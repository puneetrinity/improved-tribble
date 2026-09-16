import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { importSPKI, jwtVerify } from "jose";
import ts from "typescript";
import { clearKeyCache } from "../../lib/services/jwt-signer";
import { candidateIndexSearchFilters, candidateIndexSearchResponseSchema, searchCandidateIndex,
  verifyCandidateIndexHitTuples } from "../search";
import { registerCandidateSemanticRoutes } from "../../candidates.semantic.routes";

const mocks = vi.hoisted(() => ({ query: vi.fn(), organization: vi.fn(), applications: vi.fn(),
  jobs: vi.fn(), stages: vi.fn(), legacy: vi.fn() }));
vi.mock("../../db", () => ({ pool: { query: mocks.query }, db: {} }));
vi.mock("../../auth", () => ({ requireRole: (roles: string[]) => Object.assign(() => {}, { roles }),
  requireSeat: (options: unknown) => Object.assign(() => {}, { options }) }));
vi.mock("../../storage", () => ({ storage: { getApplicationsByIdsForOrg: mocks.applications,
  getJobsByIds: mocks.jobs, getPipelineStages: mocks.stages } }));
vi.mock("../../lib/organizationService", () => ({ getUserOrganization: mocks.organization }));
vi.mock("../../lib/activekgTenant", () => ({ getTenantStrategy: () => "shared", resolveActiveKGTenantId: (id: number) => `org_${id}` }));
vi.mock("../../lib/applicationGraphSyncProcessor", () => ({ MIN_RESUME_TEXT_LENGTH: 100 }));
vi.mock("../../lib/services/activekg-client", () => ({ search: mocks.legacy }));
vi.mock("../../candidate-privacy/decision", () => ({ privacyAllowedSql: () => "private_sql_fixture" }));

const reference = "11111111-1111-4111-8111-111111111111";
const resume = "22222222-2222-4222-8222-222222222222";
const generation = "33333333-3333-4333-8333-333333333333";
function hit(application = 101) {
  return { application_id: application, job_id: 11, reference_id: reference, resume_version_id: resume,
    generation_id: generation, generation: 1, source_observed_at: "2026-09-14T00:00:00+00:00",
    state: "ready" as const, cosine_score: 0.8, ranking_score: 0.02, matched_chunks: 1,
    highlights: ["Python distributed systems"] };
}
function answer() {
  return { results: [hit()], score_type: "rrf_fused", display_score_type: "cosine",
    reranker: "not_requested", saturated: false, processing: { counts: { ready: 1, updating: 0,
      refresh_failed: 0, pending: 2, needs_review: 0, failed: 0 }, bounded: false, limit: 1000 }, retrieval_limit: 100 };
}
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const input = () => ({ organizationId: 17, query: "Python engineer", useHybrid: true, useReranker: false });
let privateKey: string;
let publicKey: Awaited<ReturnType<typeof importSPKI>>;
beforeAll(async () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  privateKey = pair.privateKey;
  publicKey = await importSPKI(pair.publicKey, "RS256");
});
beforeEach(() => {
  vi.clearAllMocks();
  clearKeyCache();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ACTIVEKG_BASE_URL", "http://127.0.0.1:59001");
  vi.stubEnv("VANTAHIRE_JWT_PRIVATE_KEY", privateKey);
  vi.stubEnv("VANTAHIRE_JWT_ACTIVE_KID", "index-search-fixture");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); clearKeyCache(); });

const unsupported = ["application_id", "resume_id", "gcs_path", "resume_gcp_url", "resume_source",
  "effective_recruiter_id", "submitted_by_recruiter", "created_by_user_id", "provenance_type", "visibility",
  "consent_state", "consent_captured_at", "applicant_name", "applicant_email", "linkedin_url", "github_url",
  "medium_url", "other_links"];
describe("frozen semantic metadata filter census", () => {
  it("enumerates all 21 producer metadata keys, including 18 explicitly unmodelled keys", () => {
    const source = ts.createSourceFile("processor.ts", readFileSync("server/lib/applicationGraphSyncProcessor.ts", "utf8"),
      ts.ScriptTarget.Latest, true);
    const keys = new Set<string>();
    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === "metadata"
        && ts.isObjectLiteralExpression(node.initializer)) {
        for (const prop of node.initializer.properties) {
          expect(ts.isPropertyAssignment(prop)).toBe(true);
          keys.add(prop.name!.getText(source));
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect([...keys].sort()).toEqual(["source", "org_id", "job_id", ...unsupported].sort());
    expect(readFileSync("server/candidates.semantic.routes.ts", "utf8"))
      .toContain("metadata_filters: z.record(z.unknown()).optional()");
  });
  it.each([...unsupported, "not_a_known_key", "__proto__"])("refuses %s before signing, SQL or HTTP", async key => {
    const fetchImpl = vi.fn();
    await expect(searchCandidateIndex({ ...input(), metadataFilters: { [key]: "sentinel-never-sent" }, fetchImpl }))
      .rejects.toMatchObject({ code: "candidate_index_filter_unsupported" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each([11, "11"])("models job %s and overwrites caller source/org as the old route does", job => {
    expect(candidateIndexSearchFilters(17, { source: "foreign", org_id: 18, job_id: job }))
      .toEqual({ source: "vantahire", org_id: 17, job_id: 11 });
  });
  it.each([true, null, [], {}, "01", " 11", "11.0", 0, -1, 2_147_483_648])("refuses unmodelled job value %j", job => {
    expect(() => candidateIndexSearchFilters(17, { job_id: job })).toThrow("candidate_index_filter_conflict");
  });
});

describe("bounded private Memory reader", () => {
  it("uses the actual signer with exact read-only scope and private tenant; no locator or identity input", async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe("http://127.0.0.1:59001/organization-candidates/search");
      expect(options.redirect).toBe("error");
      const token = options.headers.authorization.slice(7);
      const { payload } = await jwtVerify(token, publicKey, { audience: "activekg", issuer: "vantahire" });
      expect(payload).toMatchObject({ sub: "vantahire-backend", actor_type: "service",
        tenant_id: "org_17", scopes: "organization-candidate-index:read" });
      expect(JSON.parse(options.body)).toEqual({ query: input().query, top_k: 100,
        use_hybrid: true, use_reranker: false, metadata_filters: { source: "vantahire", org_id: 17, job_id: 11 } });
      return response(answer());
    });
    expect(await searchCandidateIndex({ ...input(), metadataFilters: { job_id: "11" }, fetchImpl })).toEqual(answer());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["http://not-loopback.invalid", "https://user:pass@memory.invalid", "https://memory.invalid/prefix",
    "https://memory.invalid/?key=secret", "https://memory.invalid/#fragment"])("refuses unsafe base %s", async base => {
    vi.stubEnv("ACTIVEKG_BASE_URL", base);
    const fetchImpl = vi.fn();
    await expect(searchCandidateIndex({ ...input(), fetchImpl })).rejects.toThrow("candidate_index_search_unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses plaintext in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchImpl = vi.fn();
    await expect(searchCandidateIndex({ ...input(), fetchImpl })).rejects.toThrow("candidate_index_search_unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([401, 403, 409, 451, 429, 500])("closes status %s without reading raw error text", async status => {
    const fetchImpl = vi.fn(async () => new Response("PRIVATE_RAW_ERROR", { status }));
    await expect(searchCandidateIndex({ ...input(), fetchImpl })).rejects.toThrow("candidate_index_search_unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["candidate_index_filter_unsupported", "candidate_index_filter_conflict", "candidate_index_query_too_long"])
    ("maps only the closed 422 code %s", async code => {
      await expect(searchCandidateIndex({ ...input(), fetchImpl: vi.fn(async () => response({ detail: code }, 422)) }))
        .rejects.toThrow(code);
    });
  it.each([
    { detail: "PRIVATE_RAW_ERROR" }, { ...answer(), extra: "PRIVATE_IDENTITY" },
    { ...answer(), results: [{ ...hit(), email: "sentinel@example.invalid" }] },
    { ...answer(), results: [{ ...hit(), job_id: 12 }] },
    { ...answer(), results: [{ ...hit(), reference_id: null }] },
    { ...answer(), results: [hit(), hit()] },
    { ...answer(), score_type: "cross_encoder" },
  ])("refuses unbound response %# without returning its values", async body => {
    await expect(searchCandidateIndex({ ...input(), metadataFilters: { job_id: 11 },
      fetchImpl: vi.fn(async () => response(body)) })).rejects.toThrow("candidate_index_search_unavailable");
  });
  it("bounds even a chunked response with no declared length", async () => {
    await expect(searchCandidateIndex({ ...input(), fetchImpl: vi.fn(async () => response("x".repeat(524289))) }))
      .rejects.toThrow("candidate_index_search_unavailable");
  });
  it("kills a stalled response body at the ten-second deadline", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ cancel: cancelled }),
      { headers: { "content-type": "application/json" } }));
    const pending = searchCandidateIndex({ ...input(), fetchImpl });
    const refused = expect(pending).rejects.toThrow("candidate_index_search_unavailable");
    // Signing is real async crypto; flush it before advancing the request clock.
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(10000);
    await refused;
    expect(cancelled).toHaveBeenCalled();
  });
  it("rejects a pre-cancelled request before HTTP", async () => {
    const fetchImpl = vi.fn();
    await expect(searchCandidateIndex({ ...input(), signal: AbortSignal.abort(), fetchImpl }))
      .rejects.toThrow("candidate_index_search_unavailable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("keeps rerank ordering separate from cosine display and bounds processing counts", () => {
    expect(candidateIndexSearchResponseSchema.safeParse({ ...answer(), score_type: "cross_encoder",
      reranker: "applied", results: [{ ...hit(), ranking_score: -7 }] }).success).toBe(true);
    expect(candidateIndexSearchResponseSchema.safeParse({ ...answer(), results: [hit(102), hit(101)] }).success).toBe(false);
    expect(candidateIndexSearchResponseSchema.safeParse({ ...answer(), processing: { ...answer().processing,
      counts: { ...answer().processing.counts, pending: 1000 } } }).success).toBe(false);
  });
  it("accepts all 100 maximum-Unicode highlight rows within the receiver's code-point contract", async () => {
    const body = { ...answer(), results: Array.from({ length: 100 }, (_, i) => ({ ...hit(i + 1),
      highlights: ["𝕏".repeat(240), "𝕐".repeat(240), "𝕑".repeat(240)] })) };
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(256 * 1024);
    expect((await searchCandidateIndex({ ...input(), fetchImpl: vi.fn(async () => response(body)) })).results).toHaveLength(100);
    expect(candidateIndexSearchResponseSchema.safeParse({ ...answer(), results: [{ ...hit(),
      highlights: ["𝕏".repeat(241)] }] }).success).toBe(false);
  });
  it("binds the published immutable tuple and live ownership without SELECT on either outbox", async () => {
    mocks.query.mockResolvedValue({ rows: [{ application_id: 101, job_id: 11, reference_id: reference, resume_version_id: resume }] });
    expect(await verifyCandidateIndexHitTuples(17, [hit()])).toEqual(new Set([101]));
    const [sql, values] = mocks.query.mock.calls[0];
    expect(values).toEqual([17, [resume]]);
    for (const token of ["a.organization_id=r.organization_id", "a.job_id=r.job_id", "j.organization_id=r.organization_id",
      "r.organization_id=$1", "r.resume_version_id=ANY($2::uuid[])"]) {
      expect(sql).toContain(token);
    }
    expect(sql).not.toContain("candidate_index_outbox");
    expect(sql).not.toContain("organization_candidate_memory_outbox");
    mocks.query.mockResolvedValue({ rows: [{ application_id: 101, job_id: 12, reference_id: reference, resume_version_id: resume }] });
    expect(await verifyCandidateIndexHitTuples(17, [hit()])).toEqual(new Set());
  });
});

describe("actual semantic route adapter (stubbed auth/storage, real reader and signer)", () => {
  let routes: Map<string, any[]>;
  const csrf = () => {};
  beforeEach(() => {
    routes = new Map();
    registerCandidateSemanticRoutes({ get: (path: string, ...fns: any[]) => routes.set(path, fns),
      post: (path: string, ...fns: any[]) => routes.set(path, fns) } as any, csrf);
    vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", "dual");
    vi.stubEnv("ACTIVEKG_SEARCH_USE_RERANKER", "false");
    vi.stubEnv("ACTIVEKG_SEARCH_ALLOW_GLOBAL_SUPER_ADMIN", "true");
    mocks.organization.mockResolvedValue({ organization: { id: 17 } });
    mocks.applications.mockResolvedValue([{ id: 101, jobId: 11, organizationId: 17, currentStage: 1,
      name: "Synthetic Applicant", email: "synthetic@example.invalid", phone: "private-local-phone",
      resumeUrl: "gs://private-fixture/resume.pdf", resumeFilename: "resume.pdf" }]);
    mocks.jobs.mockResolvedValue([{ id: 11, title: "Engineer" }]);
    mocks.stages.mockResolvedValue([{ id: 1, name: "Applied" }]);
    mocks.query.mockResolvedValue({ rows: [{ application_id: 101, job_id: 11, reference_id: reference, resume_version_id: resume }] });
    mocks.legacy.mockResolvedValue({ results: [] });
    vi.stubGlobal("fetch", vi.fn(async () => response(answer())));
  });
  async function invoke(body: unknown = { query: "Python", top_k: 1 }, role = "recruiter") {
    let status = 200, json: any;
    const next = vi.fn();
    await routes.get("/api/candidates/semantic-search")!.at(-1)(
      { user: { id: 21, role }, body },
      { status: (value: number) => { status = value; return { json: (value: any) => { json = value; } }; },
        json: (value: any) => { json = value; } }, next);
    expect(next).not.toHaveBeenCalled();
    return { status, json };
  }
  it.each(["dual", "private_primary"])("preserves auth, hydration, aliases and actions in %s", async mode => {
    vi.stubEnv("FLOW_CANDIDATE_INDEX_MODE", mode);
    const chain = routes.get("/api/candidates/semantic-search")!;
    expect(chain[0].roles).toEqual(["recruiter", "super_admin"]);
    expect(chain[1].options).toEqual({ allowNoOrg: true });
    expect(chain[2]).toBe(csrf);
    const { status, json } = await invoke();
    expect(status).toBe(200);
    expect(mocks.applications).toHaveBeenCalledWith([101], 17);
    expect(json.candidates).toEqual(json.results);
    expect(json.results[0]).toMatchObject({ applicationId: 101, name: "Synthetic Applicant",
      email: "synthetic@example.invalid", currentJobTitle: "Engineer", currentStageName: "Applied",
      indexGeneration: 1, indexState: "ready", sourceObservedAt: hit().source_observed_at,
      canOpenResume: true, canMoveToJob: true, rankingScoreRaw: 0.02, matchScore: 80 });
    expect(json).toMatchObject({ count: 1, total: 1, scoreType: "rrf_fused", displayScoreType: "cosine",
      indexProcessing: answer().processing, indexReranker: "not_requested", indexSaturated: false });
    expect(JSON.stringify(json)).not.toContain("gs://");
    expect(JSON.stringify(json)).not.toContain(reference);
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(routes.has("/api/candidates/move-to-job")).toBe(true);
  });
  it("keeps private failure closed without a legacy fallback or raw error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Error("SECRET_DO_NOT_LOG"); }));
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await invoke()).toEqual({ status: 503, json: { code: "candidate_index_search_unavailable" } });
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalled();
    logger.mockRestore();
  });
  it("refuses an unsupported filter visibly with zero fetches", async () => {
    expect(await invoke({ query: "Python", metadata_filters: { resume_id: 1 } }))
      .toEqual({ status: 422, json: { code: "candidate_index_filter_unsupported" } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["privacy", "tuple", "job", "org"])("removes %s mismatches before top-k and marks saturation uncertain", async kind => {
    if (kind === "privacy") mocks.applications.mockResolvedValue([]);
    if (kind === "tuple") mocks.query.mockResolvedValue({ rows: [] });
    if (kind === "job") mocks.applications.mockResolvedValue([{ id: 101, jobId: 12, organizationId: 17 }]);
    if (kind === "org") mocks.applications.mockResolvedValue([{ id: 101, jobId: 11, organizationId: 18 }]);
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...answer(), saturated: true })));
    expect(await invoke()).toEqual({ status: 503, json: { code: "candidate_privacy_reconciliation_required" } });
  });
  it("reports pending counts even for an empty result set", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ ...answer(), results: [] })));
    const { json } = await invoke();
    expect(json.results).toEqual([]);
    expect(json.indexProcessing.counts.pending).toBe(2);
    expect(json.displayScoreType).toBe("cosine");
  });
  it("leaves mode-absent reads on the original lane", async () => {
    delete process.env.FLOW_CANDIDATE_INDEX_MODE;
    await invoke();
    expect(mocks.legacy).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never exposes the private lane to the no-org global super-admin branch", async () => {
    mocks.organization.mockResolvedValue(null);
    await invoke({ query: "Python" }, "super_admin");
    expect(mocks.legacy).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
