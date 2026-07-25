export type ContactResolutionTerminalStatus = 'resolved' | 'suppressed' | 'not_found';

export interface ContactResolutionJob {
  id: number;
  organizationId: number;
  signalCandidateId: string;
  externalJobId: string;
  attempts: number;
  leaseToken: string;
}

export interface ContactResolutionResponse {
  success: boolean;
  state: 'found' | 'suppressed' | 'not_found' | 'pending';
  emails: string[];
}

export interface ContactResolutionStore {
  claimDue(params: {
    limit: number;
    now: Date;
    leaseToken: string;
    leaseExpiresAt: Date;
  }): Promise<ContactResolutionJob[]>;
  getSignalTenantId(organizationId: number): Promise<string | null>;
  markResolved(params: {
    candidateId: number;
    leaseToken: string;
    status: ContactResolutionTerminalStatus;
    emails: string[];
    resolvedAt: Date;
  }): Promise<void>;
  markRetry(params: {
    candidateId: number;
    leaseToken: string;
    nextAttemptAt: Date;
    errorCode: string;
  }): Promise<void>;
  markFailed(params: {
    candidateId: number;
    leaseToken: string;
    failedAt: Date;
    errorCode: string;
  }): Promise<void>;
}

export interface ContactResolutionCycleDependencies {
  store: ContactResolutionStore;
  resolveContact: (
    signalTenantId: string,
    signalCandidateId: string,
    externalJobId: string,
  ) => Promise<ContactResolutionResponse>;
  createLeaseToken: () => string;
  now: () => Date;
}

export interface ContactResolutionCycleOptions {
  batchSize: number;
  concurrency: number;
  leaseMs: number;
  retryDelayMs: (attempt: number) => number;
}

export interface ContactResolutionCycleResult {
  claimed: number;
  resolved: number;
  retried: number;
  failed: number;
}

export type ShortlistContactTransition =
  | { action: 'preserve' }
  | { action: 'cancel_pending' }
  | { action: 'enqueue' }
  | { action: 'fail'; errorCode: 'missing_signal_tenant' | 'missing_signal_candidate_id' };

export type ManualContactResolutionPlan =
  | { action: 'reject_not_shortlisted' }
  | { action: 'enqueue' }
  | { action: 'revalidate' }
  | { action: 'return'; status: 202; state: 'pending'; emails: [] }
  | { action: 'return'; status: 200; state: 'suppressed' | 'not_found'; emails: [] }
  | { action: 'return'; status: 409; state: 'failed'; emails: []; code: string };

export type ContactRevalidationState =
  | 'found'
  | 'suppressed'
  | 'not_found'
  | 'pending'
  | 'failed';

export interface ContactRevalidationInput {
  candidateId: number;
  organizationId: number;
  jobId: number;
  signalTenantId: string;
  signalCandidateId: string;
  externalJobId: string;
  attempts: number;
}

export interface ContactRevalidationResult {
  persisted: boolean;
  state: ContactRevalidationState;
  emails: string[];
  errorCode: string | null;
}

export interface ContactRevalidationStore {
  persist(params: {
    candidateId: number;
    organizationId: number;
    jobId: number;
    signalCandidateId: string;
    status: 'resolved' | 'suppressed' | 'not_found' | 'pending' | 'failed';
    emails: string[];
    resolvedAt: Date | null;
    nextAttemptAt: Date | null;
    errorCode: string | null;
  }): Promise<boolean>;
}

export interface ContactRevalidationDependencies {
  store: ContactRevalidationStore;
  resolveContact: (
    signalTenantId: string,
    signalCandidateId: string,
    externalJobId: string,
  ) => Promise<ContactResolutionResponse>;
  now: () => Date;
  retryDelayMs: (attempt: number) => number;
}

export function planManualContactResolution(input: {
  candidateState: unknown;
  emailResolveStatus: unknown;
  foundEmail: unknown;
  foundEmails: unknown;
  lastErrorCode: unknown;
}): ManualContactResolutionPlan {
  if (input.candidateState !== 'shortlisted') {
    return { action: 'reject_not_shortlisted' };
  }
  if (input.emailResolveStatus === 'pending') {
    return { action: 'return', status: 202, state: 'pending', emails: [] };
  }
  if (input.emailResolveStatus === 'suppressed' || input.emailResolveStatus === 'not_found') {
    return {
      action: 'return',
      status: 200,
      state: input.emailResolveStatus,
      emails: [],
    };
  }
  if (input.emailResolveStatus === 'failed') {
    return {
      action: 'return',
      status: 409,
      state: 'failed',
      emails: [],
      code: typeof input.lastErrorCode === 'string' && input.lastErrorCode.trim()
        ? input.lastErrorCode
        : 'contact_resolution_failed',
    };
  }
  if (input.emailResolveStatus === 'resolved') {
    return { action: 'revalidate' };
  }
  return { action: 'enqueue' };
}

export function planShortlistContactTransition(input: {
  targetState: string;
  emailResolveStatus: unknown;
  signalTenantId: string | null;
  signalCandidateId: string;
}): ShortlistContactTransition {
  if (input.targetState !== 'shortlisted') {
    return input.emailResolveStatus === 'pending'
      ? { action: 'cancel_pending' }
      : { action: 'preserve' };
  }

  if (
    input.emailResolveStatus === 'resolved'
    || input.emailResolveStatus === 'pending'
    || input.emailResolveStatus === 'suppressed'
    || input.emailResolveStatus === 'not_found'
    || input.emailResolveStatus === 'failed'
  ) {
    return { action: 'preserve' };
  }

  if (!input.signalTenantId) {
    return { action: 'fail', errorCode: 'missing_signal_tenant' };
  }
  if (!input.signalCandidateId.trim()) {
    return { action: 'fail', errorCode: 'missing_signal_candidate_id' };
  }
  return { action: 'enqueue' };
}

function normalizeEmails(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((email): email is string => typeof email === 'string')
    .map((email) => email.trim())
    .filter(Boolean);

  return [...new Set(normalized)];
}

function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

function getTerminalSignalState(error: unknown): 'ambiguous' | 'failed' | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object') {
    return null;
  }

  const state = (body as { state?: unknown }).state;
  return state === 'ambiguous' || state === 'failed' ? state : null;
}

function getTerminalSignalCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== 'object') {
    return null;
  }
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' && /^[a-z0-9_]{1,80}$/.test(code)
    ? code
    : null;
}

function classifyError(error: unknown): { retryable: boolean; code: string } {
  const status = getHttpStatus(error);
  if (status != null) {
    if (status === 409) {
      const terminalState = getTerminalSignalState(error);
      return {
        retryable: false,
        code:
          getTerminalSignalCode(error)
          ?? (terminalState ? `signal_terminal_${terminalState}` : 'signal_http_409'),
      };
    }

    const retryable = status < 400
      || status === 401
      || status === 403
      || status === 408
      || status === 425
      || status === 429
      || status >= 500;
    return { retryable, code: `signal_http_${status}` };
  }

  // The Signal operation is idempotent. Retrying an unknown transport/runtime
  // failure is safer than abandoning a shortlist after a deploy or disconnect.
  return { retryable: true, code: 'signal_transport_error' };
}

export async function revalidateContactResolution(
  input: ContactRevalidationInput,
  dependencies: ContactRevalidationDependencies,
): Promise<ContactRevalidationResult> {
  const persist = async (params: {
    state: ContactRevalidationState;
    status: 'resolved' | 'suppressed' | 'not_found' | 'pending' | 'failed';
    emails?: string[];
    resolvedAt?: Date | null;
    nextAttemptAt?: Date | null;
    errorCode?: string | null;
  }): Promise<ContactRevalidationResult> => {
    const emails = params.emails ?? [];
    const errorCode = params.errorCode ?? null;
    const persisted = await dependencies.store.persist({
      candidateId: input.candidateId,
      organizationId: input.organizationId,
      jobId: input.jobId,
      signalCandidateId: input.signalCandidateId,
      status: params.status,
      emails,
      resolvedAt: params.resolvedAt ?? null,
      nextAttemptAt: params.nextAttemptAt ?? null,
      errorCode,
    });
    return {
      persisted,
      state: params.state,
      emails,
      errorCode,
    };
  };

  const retry = (errorCode: string): Promise<ContactRevalidationResult> => {
    const now = dependencies.now();
    return persist({
      state: 'pending',
      status: 'pending',
      nextAttemptAt: new Date(
        now.getTime() + dependencies.retryDelayMs(Math.max(input.attempts, 1)),
      ),
      errorCode,
    });
  };

  if (!input.signalCandidateId.trim()) {
    return persist({
      state: 'failed',
      status: 'failed',
      resolvedAt: dependencies.now(),
      errorCode: 'missing_signal_candidate_id',
    });
  }

  try {
    const response = await dependencies.resolveContact(
      input.signalTenantId,
      input.signalCandidateId,
      input.externalJobId,
    );
    const emails = normalizeEmails(response.emails);

    if (response.state === 'pending') {
      return retry('signal_pending');
    }
    if (response.state === 'found' && emails.length === 0) {
      return retry('signal_invalid_found_response');
    }
    if (response.state === 'found') {
      return persist({
        state: 'found',
        status: 'resolved',
        emails,
        resolvedAt: dependencies.now(),
      });
    }

    return persist({
      state: response.state,
      status: response.state,
      resolvedAt: dependencies.now(),
    });
  } catch (error) {
    const failure = classifyError(error);
    if (failure.retryable) {
      return retry(failure.code);
    }
    return persist({
      state: 'failed',
      status: 'failed',
      resolvedAt: dependencies.now(),
      errorCode: failure.code,
    });
  }
}

async function processContactResolutionJob(
  job: ContactResolutionJob,
  dependencies: ContactResolutionCycleDependencies,
  options: ContactResolutionCycleOptions,
): Promise<'resolved' | 'retried' | 'failed'> {
  if (!job.signalCandidateId.trim()) {
    await dependencies.store.markFailed({
      candidateId: job.id,
      leaseToken: job.leaseToken,
      failedAt: dependencies.now(),
      errorCode: 'missing_signal_candidate_id',
    });
    return 'failed';
  }

  try {
    const tenantId = await dependencies.store.getSignalTenantId(job.organizationId);
    if (!tenantId) {
      throw new Error('Signal tenant is not configured');
    }

    const response = await dependencies.resolveContact(
      tenantId,
      job.signalCandidateId,
      job.externalJobId,
    );
    const emails = normalizeEmails(response.emails);

    if (response.state === 'pending') {
      const retryAt = dependencies.now();
      await dependencies.store.markRetry({
        candidateId: job.id,
        leaseToken: job.leaseToken,
        nextAttemptAt: new Date(retryAt.getTime() + options.retryDelayMs(job.attempts)),
        errorCode: 'signal_pending',
      });
      return 'retried';
    }

    if (response.state === 'found' && emails.length === 0) {
      throw new Error('Signal returned found without an email');
    }

    await dependencies.store.markResolved({
      candidateId: job.id,
      leaseToken: job.leaseToken,
      status: response.state === 'found'
        ? 'resolved'
        : response.state === 'suppressed'
          ? 'suppressed'
          : 'not_found',
      emails: response.state === 'found' ? emails : [],
      resolvedAt: dependencies.now(),
    });
    return 'resolved';
  } catch (error) {
    const failedAt = dependencies.now();
    const failure = classifyError(error);
    if (!failure.retryable) {
      await dependencies.store.markFailed({
        candidateId: job.id,
        leaseToken: job.leaseToken,
        failedAt,
        errorCode: failure.code,
      });
      return 'failed';
    }

    await dependencies.store.markRetry({
      candidateId: job.id,
      leaseToken: job.leaseToken,
      nextAttemptAt: new Date(failedAt.getTime() + options.retryDelayMs(job.attempts)),
      errorCode: failure.code,
    });
    return 'retried';
  }
}

export async function runContactResolutionCycle(
  dependencies: ContactResolutionCycleDependencies,
  options: ContactResolutionCycleOptions,
): Promise<ContactResolutionCycleResult> {
  const now = dependencies.now();
  const leaseToken = dependencies.createLeaseToken();
  const jobs = await dependencies.store.claimDue({
    // Every claimed row shares one lease deadline. Claim only work that can
    // start immediately; otherwise rows waiting behind the local queue can
    // expire and be reclaimed by another replica before their first request.
    limit: Math.min(options.batchSize, Math.max(options.concurrency, 1)),
    now,
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + options.leaseMs),
  });

  const result: ContactResolutionCycleResult = {
    claimed: jobs.length,
    resolved: 0,
    retried: 0,
    failed: 0,
  };

  const queue = [...jobs];
  const workers = Array.from(
    { length: Math.min(Math.max(options.concurrency, 1), queue.length) },
    async () => {
      while (queue.length > 0) {
        const job = queue.shift();
        if (!job) {
          return;
        }

        const outcome = await processContactResolutionJob(job, dependencies, options);
        result[outcome] += 1;
      }
    },
  );

  await Promise.all(workers);
  return result;
}
