import { loadCandidatePrivacyConfig } from "./config";
import {
  CandidatePrivacyConflict,
  applyMemoryChanges,
  claimPrivacyOutbox,
  markOutboxDelivered,
  markOutboxRetry,
  replaceProjectionFromSnapshot,
  syncCursor,
  transientIdentifiersForRequest,
} from "./repository";
import {
  CandidatePrivacyMemoryError,
  createMemoryDirective,
  readMemoryChanges,
  readMemorySnapshot,
} from "./memory-client";

let timer: NodeJS.Timeout | null = null;
let running = false;

function safeErrorCode(error: unknown): string {
  if (error instanceof CandidatePrivacyMemoryError) return `memory_${error.code}`;
  if (error instanceof CandidatePrivacyConflict) return "projection_conflict";
  return "internal_error";
}

async function deliverOne(): Promise<boolean> {
  const config = loadCandidatePrivacyConfig();
  const claim = await claimPrivacyOutbox(config.leaseMs);
  if (!claim) return false;
  try {
    const identifiers = await transientIdentifiersForRequest(claim.requestId);
    const remote = await createMemoryDirective({
      requestId: claim.requestId,
      action: claim.action,
      authorityType: claim.authorityType,
      evidenceRef: claim.evidenceRef,
      reasonCode: claim.reasonCode,
      identifiers,
      timeoutMs: config.memoryTimeoutMs,
    });
    await markOutboxDelivered(claim, remote);
  } catch (error) {
    const retryable = error instanceof CandidatePrivacyMemoryError ? error.retryable : true;
    await markOutboxRetry(claim, safeErrorCode(error), retryable);
  }
  return true;
}

async function rebuildFromSnapshot(): Promise<void> {
  const config = loadCandidatePrivacyConfig();
  let highWaterCursor: number | undefined;
  let afterDirectiveId: string | undefined;
  const directives: Awaited<ReturnType<typeof readMemorySnapshot>>["directives"] = [];
  for (;;) {
    const page = await readMemorySnapshot({
      ...(afterDirectiveId ? { afterDirectiveId } : {}),
      ...(highWaterCursor !== undefined ? { highWaterCursor } : {}),
      limit: config.pageSize,
      timeoutMs: config.memoryTimeoutMs,
    });
    if (highWaterCursor === undefined) highWaterCursor = page.high_water_cursor;
    if (page.high_water_cursor !== highWaterCursor) {
      throw new CandidatePrivacyConflict("candidate_privacy_snapshot_cursor_changed");
    }
    directives.push(...page.directives);
    if (page.directives.length < config.pageSize) break;
    afterDirectiveId = page.directives[page.directives.length - 1]?.directive_id;
    if (!afterDirectiveId) break;
  }
  await replaceProjectionFromSnapshot({ highWaterCursor: highWaterCursor ?? 0, directives });
}

async function pollChanges(): Promise<void> {
  const config = loadCandidatePrivacyConfig();
  const cursor = await syncCursor();
  const page = await readMemoryChanges({
    afterCursor: cursor,
    limit: config.pageSize,
    timeoutMs: config.memoryTimeoutMs,
  });
  try {
    await applyMemoryChanges(page.events);
  } catch (error) {
    if (!(error instanceof CandidatePrivacyConflict)) throw error;
    await rebuildFromSnapshot();
  }
}

export async function runCandidatePrivacyProcessorOnce(): Promise<void> {
  // Bound delivery work per tick so feed progress cannot starve.
  for (let i = 0; i < 10 && await deliverOne(); i += 1) {
    // no-op
  }
  await pollChanges();
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runCandidatePrivacyProcessorOnce();
  } catch (error) {
    // Error class only; never serialize request bodies, identifiers, JWTs or
    // provider response bodies into retained logs.
    console.error("[CandidatePrivacy] processor tick failed", {
      errorType: error instanceof Error ? error.constructor.name : "UnknownError",
    });
  } finally {
    running = false;
  }
}

export function startCandidatePrivacyProcessor(): void {
  if (timer) return;
  const config = loadCandidatePrivacyConfig();
  void tick();
  timer = setInterval(() => void tick(), config.pollMs);
  timer.unref?.();
}

export function stopCandidatePrivacyProcessor(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
