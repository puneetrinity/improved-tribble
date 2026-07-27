export type SignalCallbackAcknowledgement =
  | {
    status: 200;
    body: { success: true };
  }
  | {
    status: 503;
    body: {
      success: false;
      retryable: true;
      error: 'Callback processing failed';
    };
  };

export interface SignalExecutionIdentity {
  acquisitionGeneration?: number | null;
  executionAttemptId?: string | null;
}

export type SignalCallbackExecutionDecision =
  | { action: 'accept' }
  | { action: 'stale'; reason: string }
  | { action: 'retry'; reason: string };

export type SignalTerminalCommitFallback =
  | Exclude<SignalCallbackExecutionDecision, { action: 'accept' }>
  | { action: 'acknowledge_completed'; reason: string };

export function decideSignalCallbackExecution(
  incoming: SignalExecutionIdentity,
  current: SignalExecutionIdentity,
): SignalCallbackExecutionDecision {
  if (
    incoming.acquisitionGeneration == null &&
    current.acquisitionGeneration == null
  ) {
    return { action: 'accept' };
  }
  if (incoming.acquisitionGeneration == null) {
    return {
      action: 'stale',
      reason: 'Legacy callback cannot replace a fenced sourcing execution',
    };
  }
  if (current.acquisitionGeneration == null) {
    return {
      action: 'retry',
      reason: 'Flow has not recorded this acquisition generation yet',
    };
  }

  if (incoming.acquisitionGeneration < current.acquisitionGeneration) {
    return {
      action: 'stale',
      reason: 'Callback belongs to an older acquisition generation',
    };
  }
  if (incoming.acquisitionGeneration > current.acquisitionGeneration) {
    return {
      action: 'retry',
      reason: 'Flow has not recorded this acquisition generation yet',
    };
  }

  if (
    incoming.executionAttemptId == null &&
    current.executionAttemptId != null
  ) {
    return {
      action: 'stale',
      reason: 'Legacy callback cannot replace a fenced sourcing attempt',
    };
  }
  if (
    incoming.executionAttemptId != null &&
    current.executionAttemptId == null
  ) {
    return {
      action: 'retry',
      reason: 'Flow has not recorded this sourcing attempt yet',
    };
  }
  if (incoming.executionAttemptId !== current.executionAttemptId) {
    return {
      action: 'retry',
      reason: 'Callback execution attempt is not the current Flow attempt',
    };
  }
  return { action: 'accept' };
}

export function decideSignalTerminalCommitFallback(
  incoming: SignalExecutionIdentity,
  current: SignalExecutionIdentity,
  currentStatus: string | null | undefined,
): SignalTerminalCommitFallback {
  const executionDecision = decideSignalCallbackExecution(incoming, current);
  if (executionDecision.action !== 'accept') return executionDecision;
  if (currentStatus === 'completed') {
    return {
      action: 'acknowledge_completed',
      reason: 'This sourcing execution already completed durably',
    };
  }
  return {
    action: 'retry',
    reason: 'Flow sourcing execution changed before callback commit',
  };
}

/**
 * Signal may release its paid-result receipt after a successful acknowledgement.
 * Local processing failures must remain retryable until Flow has durably synced them.
 */
export function getSignalCallbackAcknowledgement(
  processError?: string,
): SignalCallbackAcknowledgement {
  if (processError) {
    return {
      status: 503,
      body: {
        success: false,
        retryable: true,
        error: 'Callback processing failed',
      },
    };
  }

  return {
    status: 200,
    body: { success: true },
  };
}
