/** Whether a job can be searched, mirroring the governed quote refusal
 * (inactive, not approved, or past its expiry all refuse). The server's
 * refusal stays authoritative; this only lets the page explain it. */
export type SourcingJobState = 'open' | 'closed' | 'unapproved' | 'expired';

export function sourcingJobState(
  job: { isActive: boolean; status: string; expiresAt: Date | null },
  now: Date = new Date(),
): SourcingJobState {
  if (job.status !== 'approved') return 'unapproved';
  if (!job.isActive) return 'closed';
  if (job.expiresAt && job.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'open';
}
