import { describe, expect, it } from 'vitest';
import {
  decideSignalCallbackExecution,
  decideSignalTerminalCommitFallback,
  getSignalCallbackAcknowledgement,
} from '../services/signal-callback-ack';

describe('getSignalCallbackAcknowledgement', () => {
  it('returns a retryable 503 when Flow could not process a complete callback', () => {
    expect(getSignalCallbackAcknowledgement('Results fetch failed: Signal API 502')).toEqual({
      status: 503,
      body: {
        success: false,
        retryable: true,
        error: 'Callback processing failed',
      },
    });
  });

  it('returns 200 when Flow has no local callback-processing error', () => {
    expect(getSignalCallbackAcknowledgement()).toEqual({
      status: 200,
      body: { success: true },
    });
  });

  it('rejects an older generation as stale without retrying it', () => {
    expect(
      decideSignalCallbackExecution(
        { acquisitionGeneration: 1, executionAttemptId: 'old' },
        { acquisitionGeneration: 2, executionAttemptId: 'new' },
      ),
    ).toEqual({
      action: 'stale',
      reason: 'Callback belongs to an older acquisition generation',
    });
  });

  it('retries a generation or attempt Flow has not recorded yet', () => {
    expect(
      decideSignalCallbackExecution(
        { acquisitionGeneration: 3, executionAttemptId: 'new' },
        { acquisitionGeneration: 2, executionAttemptId: 'old' },
      ).action,
    ).toBe('retry');
    expect(
      decideSignalCallbackExecution(
        { acquisitionGeneration: 2, executionAttemptId: 'other' },
        { acquisitionGeneration: 2, executionAttemptId: 'current' },
      ).action,
    ).toBe('retry');
  });

  it('accepts matching and legacy callbacks', () => {
    expect(
      decideSignalCallbackExecution(
        { acquisitionGeneration: 2, executionAttemptId: 'current' },
        { acquisitionGeneration: 2, executionAttemptId: 'current' },
      ),
    ).toEqual({ action: 'accept' });
    expect(decideSignalCallbackExecution({}, {})).toEqual({
      action: 'accept',
    });
  });

  it('never lets an unfenced callback replace a fenced execution', () => {
    expect(
      decideSignalCallbackExecution(
        {},
        { acquisitionGeneration: 2, executionAttemptId: 'current' },
      ),
    ).toMatchObject({ action: 'stale' });
    expect(
      decideSignalCallbackExecution(
        { acquisitionGeneration: 2, executionAttemptId: 'current' },
        {},
      ),
    ).toMatchObject({ action: 'retry' });
    expect(
      decideSignalCallbackExecution(
        { acquisitionGeneration: 2 },
        { acquisitionGeneration: 2, executionAttemptId: 'current' },
      ),
    ).toMatchObject({ action: 'stale' });
  });

  it('keeps a completed execution terminal when an overlapping delivery fails late', () => {
    expect(
      decideSignalTerminalCommitFallback(
        { acquisitionGeneration: 2, executionAttemptId: 'attempt-2' },
        { acquisitionGeneration: 2, executionAttemptId: 'attempt-2' },
        'completed',
      ),
    ).toMatchObject({ action: 'acknowledge_completed' });
    expect(
      decideSignalTerminalCommitFallback(
        { acquisitionGeneration: 2, executionAttemptId: 'attempt-2' },
        { acquisitionGeneration: 2, executionAttemptId: 'attempt-2' },
        'failed',
      ),
    ).toMatchObject({ action: 'retry' });
  });
});
