import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}));

vi.mock('../../db', () => ({
  pool: {
    connect: mocks.connect,
  },
}));

import { withOutreachDispatchFence } from '../outreachConcurrency';

describe('outreach dispatch fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue({
      query: mocks.query,
      release: mocks.release,
    });
    mocks.query.mockImplementation(async (statement: string) => ({
      rowCount: statement.includes('FROM jobs') ? 1 : null,
    }));
  });

  it('runs provider dispatch only after job, candidate, and email locks', async () => {
    const sequence: string[] = [];
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement === 'BEGIN') sequence.push('begin');
      if (statement.includes('FROM jobs')) sequence.push('job');
      if (statement.includes('$2::integer')) sequence.push('candidate');
      if (statement.includes('hashtext($2)')) sequence.push('email');
      if (statement === 'COMMIT') sequence.push('commit');
      return { rowCount: statement.includes('FROM jobs') ? 1 : null };
    });

    const result = await withOutreachDispatchFence(
      7,
      11,
      'hashed-email',
      async () => {
        sequence.push('dispatch');
        return 'sent';
      },
    );

    expect(result).toBe('sent');
    expect(sequence).toEqual([
      'begin',
      'job',
      'candidate',
      'email',
      'dispatch',
      'commit',
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rolls back without dispatch when the job disappeared', async () => {
    const dispatch = vi.fn();
    mocks.query.mockImplementation(async (statement: string) => ({
      rowCount: statement.includes('FROM jobs') ? 0 : null,
    }));

    await expect(withOutreachDispatchFence(
      7,
      11,
      'hashed-email',
      dispatch,
    )).rejects.toThrow('Outreach job no longer exists');

    expect(dispatch).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
