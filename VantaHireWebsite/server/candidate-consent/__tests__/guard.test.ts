import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Source-owned plain ESM CLI has no generated declaration file.
import { AUTHORITIES, FROZEN, checkCandidateConsent } from "../../../scripts/check-candidate-consent.mjs";

const root = join(dirname(new URL(import.meta.url).pathname), "../../..");
const mutations = [
  ["server/candidate-consent/routes.ts", "csrfProtection, requireRecentConsentAuth", "csrfProtection", "csrf census"],
  ["server/candidate-consent/routes.ts", "requireVerifiedCandidate", "requireAuth", "route authority"],
  ["server/candidate-consent/routes.ts", "res.status(complete ? 200 : 202)", "res.status(200)", "response authority"],
  ["server/candidate-consent/repository.ts", "globalUse: true, newGlobalOperation: true", "globalUse: false, newGlobalOperation: false", "global admission"],
  ["server/candidate-consent/repository.ts", "a.user_id=$2", "true", "capture invariant"],
  ["server/candidate-consent/repository.ts", "FOR UPDATE OF a", "", "capture invariant"],
  ["server/candidate-consent/repository.ts", "ready.rows[0]?.ready !== true", "false", "capture invariant"],
  ["server/candidate-consent/repository.ts", "now - at <= 600_000", "true", "capture invariant"],
  ["server/candidate-consent/processor.ts", "account.auth_version !== loaded.authVersion", "false", "delivery invariant"],
  ["server/candidate-consent/processor.ts", "config.leaseMs <= config.timeoutMs", "false", "delivery invariant"],
  ["server/candidate-consent/memory-client.ts", 'redirect: "error"', 'redirect: "follow"', "transport invariant"],
  ["server/candidate-consent/memory-client.ts", "receipt.event_id !== command.event_id", "false", "transport invariant"],
  ["server/candidate-consent/memory-client.ts", "size > 8192", "false", "transport invariant"],
  ["server/schema-migrations/0011_candidate_consent.sql", "o.generation IS DISTINCT FROM p_generation", "false", "SQL invariant"],
  ["server/schema-migrations/0011_candidate_consent.sql", "BEFORE UPDATE OR DELETE", "BEFORE DELETE", "SQL authority census"],
  ["server/schema-control/readiness.ts", "flow_candidate_consent_resume_ready", "flow_wrong_reader", "routine missing"],
  ["server/schema-control/readiness.ts", "md5(pg_get_constraintdef(c.oid))=value->>5", "true", "constraint definition check"],
  ["server/schema-migrations/0011_candidate_consent.sql", "jsonb_typeof(resume->'organization_id')='number'", "true", "scalar constraint"],
  ["server/schema-migrations/0011_candidate_consent.sql", "IS TRUE)", ")", "scalar constraint"],
  ["server/auth.ts", "export", "/* frozen probe */ export", "frozen consent dependency"],
] as const;

describe("consent authority guard", () => {
  it("accepts the authored backend boundary", () => expect(checkCandidateConsent(root)).toEqual([]));
  it.each(mutations)("refuses %s mutation of %s", (file, before, after, code) => {
    const scratch = mkdtempSync(join(tmpdir(), "flow-consent-guard-"));
    try {
      for (const path of new Set<string>([...Object.keys(FROZEN), ...AUTHORITIES])) {
        mkdirSync(dirname(join(scratch, path)), { recursive: true });
        cpSync(join(root, path), join(scratch, path));
      }
      const source = readFileSync(join(scratch, file), "utf8");
      expect(source).toContain(before);
      writeFileSync(join(scratch, file), source.replaceAll(before, after));
      expect(checkCandidateConsent(scratch).some((message: string) => message.includes(code))).toBe(true);
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  });
});
