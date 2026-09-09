#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const frozenHashes = {
  "package-lock.json": "b985825f298cda976afa6f46792d4eab13ceaa19560efc48098168f187337539",
  "server/aiWorker.ts": "d735b459861d97c56386f825664039ecc8a77a3f02f5337a58779553c6a52738",
  "server/gcs-storage.ts": "5354cc3391894ae91fd2f6c5dca656a1aaf6a6eae175deee76782cf690360802",
  "server/lib/applicationGraphSyncProcessor.ts": "ad98b6499dfb667aaa1ed7bda021e54b178a59f521050c08c5930ed8e6c7d0e1",
  "server/lib/services/jwt-signer.ts": "0213eb5984388fba2c3e4bf8893ac94b7fbaecc1f669b12b50519ef0a24cd490",
  "server/schema-migrations/0009_decision_projection_delivery_state.sql": "ce5999cab8bf087b838bdc05e4eca81d6012a1f044e957ff4ab196c41919f348",
  "server/storage.ts": "8c7a06331d36249ca7e115c85a5193d2ad66949b5f0ad9eb51df1c95d3f06c31",
};

export class OrganizationCandidateGuardError extends Error {}

function read(root, relative) {
  try {
    return readFileSync(join(root, relative), "utf8");
  } catch (error) {
    throw new OrganizationCandidateGuardError(`required file missing: ${relative}`, { cause: error });
  }
}

function requireTokens(source, tokens, code) {
  if (tokens.some((token) => !source.includes(token))) {
    throw new OrganizationCandidateGuardError(code);
  }
}

export function checkOrganizationCandidateIntake(root = APP_ROOT) {
  for (const [relative, expected] of Object.entries(frozenHashes)) {
    const digest = createHash("sha256").update(readFileSync(join(root, relative))).digest("hex");
    if (digest !== expected) {
      throw new OrganizationCandidateGuardError(`frozen 4B authority drifted: ${relative}`);
    }
  }

  const migration = read(root, "server/schema-migrations/0010_organization_private_candidate_reference.sql");
  const intake = read(root, "server/organization-candidates/application-intake.ts");
  const client = read(root, "server/organization-candidates/memory-client.ts");
  const processor = read(root, "server/organization-candidates/processor.ts");
  const routeSource = read(root, "server/applications.routes.ts");
  const routeStart = routeSource.indexOf('app.post("/api/jobs/:id/apply"');
  const routeEnd = routeSource.indexOf("// Recruiter adds candidate on behalf", routeStart);
  if (routeStart < 0 || routeEnd < routeStart) {
    throw new OrganizationCandidateGuardError("public application route boundary drifted");
  }
  const publicRoute = routeSource.slice(routeStart, routeEnd);

  requireTokens(migration, [
    "CREATE TABLE public.organization_candidate_references",
    "CREATE TABLE public.application_resume_versions",
    "CREATE TABLE public.organization_candidate_memory_outbox",
    "flow_reject_organization_candidate_evidence_mutation",
    "SECURITY DEFINER",
    "FOR UPDATE OF candidate SKIP LOCKED",
    "generation=claimed.generation+1",
    "state='acknowledged'",
    "state=CASE",
    "REVOKE ALL ON FUNCTION public.claim_organization_candidate_memory_intents",
  ], "organization-candidate migration authority is incomplete");
  if ((migration.match(/BEFORE UPDATE OR DELETE/g) ?? []).length !== 2
      || (migration.match(/BEFORE TRUNCATE/g) ?? []).length !== 2) {
    throw new OrganizationCandidateGuardError("organization-candidate append-only trigger census drifted");
  }
  if (/DISABLE\s+TRIGGER\s+(?:USER|ALL)/i.test(migration)) {
    throw new OrganizationCandidateGuardError("broad trigger disable is forbidden");
  }

  requireTokens(intake, [
    "requireCandidatePrivacyAllowed(", "globalUse: false",
    "contentSha256", "extractedTextSha256", "WITH saved_resume_pin AS",
    "INSERT INTO organization_candidate_references",
    "INSERT INTO application_resume_versions",
    "INSERT INTO organization_candidate_memory_outbox",
  ], "organization-candidate application authority is incomplete");
  if ((intake.match(/globalUse: false/g) ?? []).length !== 2) {
    throw new OrganizationCandidateGuardError("organization-candidate private-use privacy gates drifted");
  }
  requireTokens(client, [
    'tenantId: `org_${claim.organizationId}`', 'scopes: "organization-candidate:write"',
    'redirect: "error"', "AbortSignal.timeout(timeoutMs)", "MAX_RESPONSE_BYTES",
    "organizationCandidateReceiptSchema.safeParse",
  ], "organization-candidate Memory client boundary is incomplete");
  requireTokens(processor, [
    "claim_organization_candidate_memory_intents", "ack_organization_candidate_memory_intent",
    "fail_organization_candidate_memory_intent", "requireOrganizationCandidateApplicationAllowed",
    "config.leaseMs <= config.timeoutMs + 2_000",
  ], "organization-candidate processor boundary is incomplete");
  requireTokens(publicRoute, [
    "resumeBytes = await downloadFromGCS(resumeUrl)", "pinPrivateResumeEvidence({",
    "application = await db.transaction", "appendOrganizationCandidateApplicationEvidence({",
    "await deleteFromGCS(resumeUrl)",
  ], "public application 4B adopter is incomplete");
  if (publicRoute.includes("enqueueApplicationGraphSyncJob")) {
    throw new OrganizationCandidateGuardError("public application retained duplicate graph enqueue");
  }
  if (!routeSource.slice(routeEnd).includes("enqueueApplicationGraphSyncJob")) {
    throw new OrganizationCandidateGuardError("non-adopted graph enqueue was removed");
  }
  for (const source of [intake, client, processor]) {
    if (/console\.(?:log|warn|error)\([^\n]*(?:email|phone|resumeUrl|gcsLocator|token)/i.test(source)) {
      throw new OrganizationCandidateGuardError("private organization-candidate value entered logs");
    }
  }
  return "organization-candidate-intake-guard: OK";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(checkOrganizationCandidateIntake());
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown guard failure";
    console.error(`organization-candidate-intake-guard: REFUSED (${message})`);
    process.exitCode = 1;
  }
}
