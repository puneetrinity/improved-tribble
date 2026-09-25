import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const paths = [
  "server/lib/applicationReadAuthorization.ts", "server/candidate-history/routes.ts",
  "server/candidate-history/memory-client.ts", "server/schema-migrations/0013_organization_candidate_history_reader.sql",
];
export const readSources = () => Object.fromEntries([...paths, "../.github/workflows/ci.yml"].map(path => [path, readFileSync(resolve(root, path), "utf8")]));
export function validateSources(files) {
  if (!/^    timeout-minutes: 60$/m.test(files["../.github/workflows/ci.yml"])) throw Error("history_ci_job_timeout");
  const kernel = files[paths[0]];
  const start = kernel.indexOf("export async function readAuthorizedCandidateHistoryContext(");
  const end = kernel.indexOf("export interface ApplicationStageHistoryProjection");
  if (start < 0 || end <= start) throw Error("history_reader_boundary");
  const legacy = (kernel.slice(0, start) + kernel.slice(end)).replace(
    'import { historyContext, type HistoryContext } from "../candidate-history/contracts";\n', "");
  if (createHash("sha256").update(legacy).digest("hex") !== "474ea56028bde0005c404ec9b3c16a2373681e7564ec4f941454719475ea0544") {
    throw Error("history_legacy_authorization_changed");
  }
  const requireTokens = (source, tokens, code) => {
    if (tokens.some(token => !source.includes(token))) throw Error(code);
  };
  requireTokens(kernel.slice(start, end), [
    "allowPlatformAdmin: false", "authorizedApplicationCte(actorId, applicationId, false,",
    "WITH authorized_application AS MATERIALIZED", "public.flow_read_candidate_history_context(",
    "historyContext.parse",
  ], "history_local_authority");
  const route = files[paths[1]];
  requireTokens(route, [
    'app.get("/api/applications/:id/decision-history", requireAuth,',
    "attempt < 2", "const before = await readAuthorizedCandidateHistoryContext",
    "const after = await readAuthorizedCandidateHistoryContext",
    "sameHistoryContext(context, after.context)", "context.capture_gap",
    'res.setHeader("Cache-Control", "private, no-store")',
  ], "history_route_authority");
  if (!(route.indexOf("const before =") < route.indexOf("await readMemoryHistory(")
    && route.indexOf("await readMemoryHistory(") < route.indexOf("const after =")
    && route.indexOf("const after =") < route.indexOf("if (failure) throw failure"))) throw Error("history_read_order");
  requireTokens(files[paths[2]], [
    'scopes: "decision-history:read"', "}, 3000)", 'redirect: "error"',
    "bytes > 65536", "validateHistoryResponse", "Promise.race([attempt(), deadline])",
  ], "history_transport_bounds");
  requireTokens(files[paths[3]], [
    "SECURITY DEFINER", "SET search_path = pg_catalog, public", "FROM PUBLIC",
    "flow_read_candidate_history_context", "capture_gap",
  ], "history_reader_sql");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--test") || process.argv.includes("--pg")) {
    const { startVitest } = await import("vitest/node");
    const pg = process.argv.includes("--pg");
    const v = await startVitest("test", [], {
      root, config: false, environment: "node", watch: false,
      include: [pg ? "server/candidate-history/__tests__/*.pg.test.ts" : "server/candidate-history/__tests__/*.test.ts"],
      exclude: pg ? [] : ["**/*.pg.test.ts"], fileParallelism: false,
      testTimeout: 30000, hookTimeout: 30000,
      alias: { "@shared": resolve(root, "shared"), "@": resolve(root, "client/src") },
    });
    if (!v) process.exitCode = 1;
    else await v.close();
  } else {
    validateSources(readSources());
    console.log("candidate-history-guard: OK");
  }
}
