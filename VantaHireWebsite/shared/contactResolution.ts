export type CandidateEmailResolutionStatus =
  | 'pending'
  | 'resolved'
  | 'suppressed'
  | 'not_found'
  | 'failed'
  | null;

export function selectDisplayCandidateEmails(input: {
  candidateState: unknown;
  status: CandidateEmailResolutionStatus;
  foundEmails: unknown;
  foundEmail: unknown;
}): string[] {
  if (input.candidateState !== 'shortlisted' || input.status !== 'resolved') {
    return [];
  }

  const foundEmails = normalizeEmails(input.foundEmails);
  if (foundEmails.length > 0) {
    return foundEmails;
  }

  const foundEmail = normalizeEmails([input.foundEmail]);
  return foundEmail;
}

function normalizeEmails(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .filter((email): email is string => typeof email === 'string')
      .map((email) => email.trim())
      .filter(Boolean),
  )];
}
