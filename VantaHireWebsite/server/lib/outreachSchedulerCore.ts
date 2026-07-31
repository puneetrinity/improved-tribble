export const OUTREACH_DAYS_BETWEEN_ROUNDS = 3;
export const OUTREACH_MAX_ROUNDS = 3;

export function isJobOpenForOutreach(
  job: {
    isActive: boolean;
    status: string;
    deadline: string | Date | null;
    expiresAt: Date | null;
  },
  now = new Date(),
): boolean {
  if (!job.isActive || job.status !== 'approved') return false;
  if (job.deadline) {
    const deadlineDay = (
      typeof job.deadline === 'string'
        ? job.deadline
        : job.deadline.toISOString()
    ).slice(0, 10);
    if (deadlineDay < now.toISOString().slice(0, 10)) return false;
  }
  if (job.expiresAt && new Date(job.expiresAt) < now) return false;
  return true;
}

export function getNextCandidateOutreachSchedule(
  completedRound: number,
  completedAt = new Date(),
): { nextRound: number; dueAt: Date } | null {
  if (
    !Number.isInteger(completedRound)
    || completedRound < 1
    || completedRound >= OUTREACH_MAX_ROUNDS
  ) {
    return null;
  }
  return {
    nextRound: completedRound + 1,
    dueAt: new Date(
      completedAt.getTime()
      + OUTREACH_DAYS_BETWEEN_ROUNDS * 24 * 60 * 60 * 1000,
    ),
  };
}
