import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @ts-expect-error Checked-in executable intentionally has no declaration file.
import { checkOrganizationCandidateIntake } from "../../../scripts/check-organization-candidate-intake.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const files = [
  "package-lock.json", "server/aiWorker.ts", "server/gcs-storage.ts",
  "server/lib/applicationGraphSyncProcessor.ts", "server/lib/services/jwt-signer.ts",
  "server/schema-migrations/0009_decision_projection_delivery_state.sql", "server/storage.ts",
  "server/schema-migrations/0010_organization_private_candidate_reference.sql",
  "server/organization-candidates/application-intake.ts",
  "server/organization-candidates/memory-client.ts",
  "server/organization-candidates/processor.ts", "server/applications.routes.ts",
];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "flow-4b-guard-"));
  for (const relative of files) {
    const destination = join(root, relative);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(appRoot, relative), destination);
  }
  return root;
}

function mutate(root: string, relative: string, before: string, after: string): void {
  const path = join(root, relative);
  const source = readFileSync(path, "utf8");
  expect(source).toContain(before);
  writeFileSync(path, source.replace(before, after));
}

describe("organization-candidate intake source guard", () => {
  it("accepts the checked-in boundary", () => {
    expect(checkOrganizationCandidateIntake()).toBe("organization-candidate-intake-guard: OK");
  });

  it.each([
    ["server/organization-candidates/application-intake.ts", "globalUse: false", "globalUse: true"],
    ["server/organization-candidates/memory-client.ts", 'redirect: "error"', 'redirect: "follow"'],
    ["server/schema-migrations/0010_organization_private_candidate_reference.sql",
      "FOR UPDATE OF candidate SKIP LOCKED", "FOR UPDATE OF candidate"],
    ["server/applications.routes.ts", "resumeBytes = await downloadFromGCS(resumeUrl)",
      "resumeBytes = Buffer.from(resumeUrl)"],
  ])("refuses mutation of %s", (relative, before, after) => {
    const root = fixture();
    try {
      mutate(root, relative, before, after);
      expect(() => checkOrganizationCandidateIntake(root)).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses broad trigger disabling", () => {
    const root = fixture();
    try {
      mutate(root, "server/schema-migrations/0010_organization_private_candidate_reference.sql",
        "-- Wave 4B:", "ALTER TABLE applications DISABLE TRIGGER USER;\n-- Wave 4B:");
      expect(() => checkOrganizationCandidateIntake(root)).toThrow(/broad trigger disable/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
