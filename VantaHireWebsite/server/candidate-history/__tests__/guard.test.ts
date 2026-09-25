import { describe, expect, it } from "vitest";
// The executable guard is an approved, shipped source authority.
// @ts-expect-error JavaScript guard intentionally has no declaration file.
import { readSources, validateSources } from "../../../scripts/check-candidate-history.mjs";

describe("history static authority", () => {
  it("accepts the authored tree", () => expect(() => validateSources(readSources())).not.toThrow());
  it.each([
    ["server/lib/applicationReadAuthorization.ts", "allowPlatformAdmin: false", "allowPlatformAdmin: true"],
    ["server/candidate-history/routes.ts", "attempt < 2", "attempt < 3"],
    ["server/candidate-history/memory-client.ts", "bytes > 65536", "bytes > 999999"],
    ["server/candidate-history/routes.ts", "const after = await readAuthorizedCandidateHistoryContext", "const after = await unguardedRead"],
  ])("refuses %s mutation of %s", (path, before, after) => {
    const files = readSources();
    expect(files[path]).toContain(before);
    files[path] = files[path].replace(before, after);
    expect(() => validateSources(files)).toThrow();
  });
});
