import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../../db', () => ({
  pool: {
    connect: mocks.connect,
    query: mocks.poolQuery,
  },
}));

import {
  hasBlockingOutreachHygieneIntent,
  withOutreachDispatchFence,
} from '../outreachConcurrency';

describe('outreach dispatch fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query.mockImplementation(async (statement: string) => ({
      rowCount: statement.includes('FROM jobs') ? 1 : null,
      rows: [],
    }));
    mocks.poolQuery.mockResolvedValue({ rows: [{ pending: false }] });
  });

  it('runs provider dispatch only after job, candidate, and email locks', async () => {
    const sequence: string[] = [];
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement === 'BEGIN') sequence.push('begin');
      if (statement.includes('FROM jobs')) sequence.push('job');
      if (statement.includes('$2::integer')) sequence.push('candidate');
      if (statement.includes('hashtext($2)')) sequence.push('email');
      if (statement.includes('FROM outreach_hygiene_intents')) sequence.push('hygiene');
      if (statement === 'COMMIT') sequence.push('commit');
      return {
        rowCount: statement.includes('FROM jobs') ? 1 : 0,
        rows: [],
      };
    });

    const result = await withOutreachDispatchFence(
      7,
      11,
      'hashed-email',
      'signal-candidate-1',
      async () => {
        sequence.push('dispatch');
        return 'sent';
      },
    );

    expect(result).toEqual({ status: 'ran', value: 'sent' });
    expect(sequence).toEqual([
      'begin',
      'job',
      'candidate',
      'email',
      'hygiene',
      'dispatch',
      'commit',
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rolls back without dispatch when the job disappeared', async () => {
    const dispatch = vi.fn();
    mocks.query.mockImplementation(async (statement: string) => ({
      rowCount: statement.includes('FROM jobs') ? 0 : null,
      rows: [],
    }));

    await expect(withOutreachDispatchFence(
      7,
      11,
      'hashed-email',
      'signal-candidate-1',
      dispatch,
    )).rejects.toThrow('Outreach job no longer exists');

    expect(dispatch).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('blocks SMTP when a committed hygiene intent is visible', async () => {
    const dispatch = vi.fn();
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM jobs')) return { rowCount: 1, rows: [{ id: 7 }] };
      if (statement.includes('FROM outreach_hygiene_intents')) {
        return { rowCount: 1, rows: [{ reason: 'complaint' }] };
      }
      return { rowCount: 0, rows: [] };
    });

    await expect(withOutreachDispatchFence(
      7,
      11,
      'hashed-email',
      'signal-candidate-1',
      dispatch,
    )).resolves.toEqual({ status: 'blocked', reason: 'hygiene_sync_pending' });

    expect(dispatch).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith('COMMIT');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('keeps an unsynced hard bounce retryable while SMTP stays blocked', async () => {
    const dispatch = vi.fn();
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes('FROM jobs')) return { rowCount: 1, rows: [{ id: 7 }] };
      if (statement.includes('FROM outreach_hygiene_intents')) {
        return {
          rowCount: 1,
          rows: [{ reason: 'hard_bounce', status: 'processing' }],
        };
      }
      return { rowCount: 0, rows: [] };
    });

    await expect(withOutreachDispatchFence(
      7,
      11,
      'hashed-email',
      'signal-candidate-1',
      dispatch,
    )).resolves.toEqual({
      status: 'blocked',
      reason: 'hygiene_sync_pending',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('scopes the scheduler pre-check to one person, never the whole platform', async () => {
    mocks.poolQuery.mockResolvedValueOnce({ rows: [{ pending: true }] });

    await expect(hasBlockingOutreachHygieneIntent('signal-candidate-1')).resolves.toBe(true);
    const [sqlText, params] = mocks.poolQuery.mock.calls[0];
    expect(sqlText).toContain("reason = 'complaint'");
    expect(sqlText).toContain("status <> 'synced'");
    // The person filter is what stops one stuck record halting every campaign.
    expect(sqlText).toContain('signal_candidate_id = $1::text');
    expect(params).toEqual(['signal-candidate-1']);
  });
});
