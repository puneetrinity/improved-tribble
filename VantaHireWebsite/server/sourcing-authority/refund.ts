import { randomUUID } from 'node:crypto';
import { SourcingRepository } from './repository';
import { sourcingRefundPolicy } from './contracts';
import { getEmailService } from '../simpleEmailService';

export type RefundReason = 'system_failure' | 'zero_results';
type RefundCall = (organizationId: number, admissionId: string, reason: RefundReason) => Promise<unknown>;
export type UnresolvedRefundAlert = { organizationId: number; admissionId: string; reason: RefundReason };

/** Which refund (if any) a terminal callback can trigger.
 * - Part A: Discover reported `failed`. Flow's own results-fetch failure arrives as
 *   `complete` and becomes `failed` locally; it never refunds, because results can
 *   still arrive.
 * - Part B: Discover reported `complete` (not `partial`) and Flow delivered nothing.
 * The database routine re-checks that nothing was delivered and is once-only. */
export function noResultRefundReason(
  callbackStatus: 'complete' | 'partial' | 'failed',
  finalStatus: 'completed' | 'failed',
  deliveredCount: number,
): RefundReason | null {
  if (callbackStatus === 'failed' && finalStatus === 'failed') return 'system_failure';
  if (callbackStatus === 'complete' && finalStatus === 'completed' && deliveredCount === 0) return 'zero_results';
  return null;
}

const EMAIL = /^[^\s@<>"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

/** Operator alert for a refund recorded as `unusable` (the organisation had no
 * active sourcing access, so no search could be given back). Identifiers only;
 * no candidate, job or account data. Sent by the notification drainer below. */
export async function sendUnresolvedRefundAlert(
  alert: UnresolvedRefundAlert,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const to = env.FLOW_OPS_ALERT_EMAIL;
  if (!to || !EMAIL.test(to)) return false;
  try {
    const email = await getEmailService();
    if (!email) return false;
    return await email.sendEmail({
      to,
      subject: 'ealana: search refund needs review',
      text: [
        'A search delivered no candidates but could not be given back automatically,',
        'because the organisation had no active sourcing access.',
        '',
        `Organisation: ${alert.organizationId}`,
        `Admission: ${alert.admissionId}`,
        `Reason: ${alert.reason}`,
        '',
        'Resolve by issuing one search through the audited extra-search operator tool',
        'once access is active. The refund record prevents any automatic second credit.',
      ].join('\n'),
    });
  } catch {
    return false;
  }
}

/** Give back the search for a permanently finished governed run that delivered
 * no candidates. The database routine decides eligibility and is once-only, so a
 * repeated or concurrent callback is safe.
 *
 * `retry` is true only when the refund outcome is unknown (the call failed, for
 * example on a lock or connection timeout). The webhook then answers with a
 * retryable error so Discover redelivers the callback and the refund is tried
 * again; a definitive outcome (refunded, replayed or ineligible) is never retried. */
export async function refundNoResultSearch(
  input: { organizationId: number; admissionId: string | null | undefined; reason: RefundReason },
  deps: { call?: RefundCall; env?: NodeJS.ProcessEnv } = {},
): Promise<{ attempted: boolean; retry: boolean; result?: unknown; errorCode?: string }> {
  if (!input.admissionId) return { attempted: false, retry: false };
  let policy: ReturnType<typeof sourcingRefundPolicy>;
  try { policy = sourcingRefundPolicy(deps.env); } catch {
    return { attempted: false, retry: false, errorCode: 'SOURCING_INVALID_CONFIGURATION' };
  }
  if (input.reason === 'system_failure' ? !policy.systemFailure : !policy.zeroResults) return { attempted: false, retry: false };
  const call: RefundCall = deps.call ?? ((org, admission, reason) =>
    new SourcingRepository().call('refund', [org, admission, reason]));
  let result: unknown;
  try {
    result = await call(input.organizationId, input.admissionId, input.reason);
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    const errorCode = typeof code === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(code) ? code : 'SOURCING_REFUND_FAILED';
    console.warn('[sourcing-refund] not applied; callback will be retried', JSON.stringify({ admissionId: input.admissionId, reason: input.reason, errorCode }));
    return { attempted: true, retry: true, errorCode };
  }
  const outcome = result as { target?: unknown; replayed?: unknown } | null;
  if (outcome?.target === 'unusable') {
    // The routine committed a durable operator notification with the refund
    // record; the drainer delivers it. Nothing here depends on email.
    console.error('[sourcing-refund-unresolved]', JSON.stringify({ organizationId: input.organizationId, admissionId: input.admissionId, reason: input.reason }));
  } else {
    console.info('[sourcing-refund]', JSON.stringify({ admissionId: input.admissionId, reason: input.reason, result }));
  }
  return { attempted: true, retry: false, result };
}

type NotificationClaim = { id: string; kind: 'refund_unusable'; organizationId: number; subjectId: string; reason: RefundReason; attempt: number };
type DrainDeps = {
  claim?: (lease: string) => Promise<NotificationClaim | null>;
  finish?: (id: string, lease: string, sent: boolean, error: string | null) => Promise<unknown>;
  send?: (alert: UnresolvedRefundAlert) => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
  limit?: number;
};

/** Deliver due operator notifications with bounded, durable retries. Each claim
 * uses one attempt under a short lease; a send failure stays queued with backoff,
 * and after ten attempts the row stays unsent and visible for review. Without a
 * configured recipient nothing is claimed, so no attempt is spent. */
export async function drainOpsNotifications(deps: DrainDeps = {}): Promise<{ sent: number; failed: number }> {
  const env = deps.env ?? process.env;
  if (!env.FLOW_OPS_ALERT_EMAIL || !EMAIL.test(env.FLOW_OPS_ALERT_EMAIL)) return { sent: 0, failed: 0 };
  const repo = deps.claim && deps.finish ? null : new SourcingRepository();
  const claim = deps.claim ?? ((lease: string) => repo!.call<NotificationClaim | null>('opsNotifyClaim', [lease]));
  const finish = deps.finish ?? ((id: string, lease: string, sent: boolean, error: string | null) => repo!.call('opsNotifyFinish', [id, lease, sent, error]));
  const send = deps.send ?? ((alert: UnresolvedRefundAlert) => sendUnresolvedRefundAlert(alert, env));
  let sent = 0, failed = 0;
  for (let n = 0; n < (deps.limit ?? 10); n++) {
    const lease = randomUUID();
    const item = await claim(lease);
    if (!item) break;
    let ok = false;
    try { ok = await send({ organizationId: item.organizationId, admissionId: item.subjectId, reason: item.reason }); } catch { ok = false; }
    await finish(item.id, lease, ok, ok ? null : 'SEND_FAILED');
    if (ok) sent++; else { failed++; console.error('[sourcing-ops-notify] send failed; will retry', JSON.stringify({ id: item.id, attempt: item.attempt })); }
  }
  return { sent, failed };
}

let drainTimer: NodeJS.Timeout | null = null;
/** Start the periodic drainer in one long-running process. */
export function startOpsNotificationDrainer(intervalMs = 60_000): void {
  if (drainTimer) return;
  let running = false;
  drainTimer = setInterval(() => {
    if (running) return;
    running = true;
    drainOpsNotifications().catch(() => console.error('[sourcing-ops-notify] drain cycle failed'))
      .finally(() => { running = false; });
  }, intervalMs);
  drainTimer.unref?.();
}
