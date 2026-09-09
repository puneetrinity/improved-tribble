import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../applications.routes.ts", import.meta.url), "utf8");
const routeStart = source.indexOf('app.post("/api/jobs/:id/apply"');
const routeEnd = source.indexOf("// Recruiter adds candidate on behalf", routeStart);
const route = source.slice(routeStart, routeEnd);

describe("public application organization-private evidence adopter", () => {
  it("keeps one resume source and fails before application persistence when exact bytes are unavailable", () => {
    expect(route).toContain("if (hasUploadedResume === hasStoredResume)");
    expect(route).toContain("resumeBytes = await downloadFromGCS(resumeUrl)");
    expect(route).toContain("code: 'SAVED_RESUME_UNAVAILABLE'");
    expect(route).toContain("code: 'RESUME_UPLOAD_UNAVAILABLE'");
    expect(route.indexOf("pinPrivateResumeEvidence({"))
      .toBeLessThan(route.indexOf("storage.createApplication({"));
  });

  it("adds application, attribution, immutable evidence and outbox in one existing transaction", () => {
    const transaction = route.slice(
      route.indexOf("application = await db.transaction"),
      route.indexOf("return created;", route.indexOf("application = await db.transaction")),
    );
    expect(transaction).toContain("storage.createApplication({");
    expect(transaction).toContain("matchApplicationToSourcedCandidate({");
    expect(transaction).toContain("appendOrganizationCandidateApplicationEvidence({");
    expect(transaction.match(/executor: tx/g)).toHaveLength(2);
  });

  it("preserves the 201 contract and removes only this route's legacy graph enqueue", () => {
    expect(route).toContain("res.status(201).json({");
    expect(route).toContain("applicationId: application.id");
    expect(route).not.toContain("enqueueApplicationGraphSyncJob");
    expect(source.slice(routeEnd)).toContain("enqueueApplicationGraphSyncJob");
  });

  it("attempts bounded object cleanup only for a new direct upload after DB failure", () => {
    expect(route).toContain("if (requestedResumeId === null && resumeUrl)");
    expect(route).toContain("await deleteFromGCS(resumeUrl)");
    expect(route).toContain("Uploaded resume cleanup failed");
  });
});
