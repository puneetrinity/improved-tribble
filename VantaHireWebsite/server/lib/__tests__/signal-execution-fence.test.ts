import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const dbMock = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock('../../db', () => ({ db: dbMock }));

import {
  buildSignalExecutionLockQuery,
  commitIfSignalExecutionCurrent,
} from '../services/signal-execution-fence';

describe('commitIfSignalExecutionCurrent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.transaction.mockImplementation(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          execute: vi.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
        }),
    );
  });

  it('runs the mutation while the matching execution row is locked', async () => {
    const mutation = vi.fn().mockResolvedValue('written');

    await expect(
      commitIfSignalExecutionCurrent(
        'request-1',
        { acquisitionGeneration: 2, executionAttemptId: 'attempt-2' },
        mutation,
      ),
    ).resolves.toEqual({ committed: true, value: 'written' });
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('does not run the mutation after the execution identity changes', async () => {
    dbMock.transaction.mockImplementationOnce(
      async (callback: (transaction: unknown) => Promise<unknown>) =>
        callback({
          execute: vi.fn().mockResolvedValue({ rows: [] }),
        }),
    );
    const mutation = vi.fn();

    await expect(
      commitIfSignalExecutionCurrent(
        'request-1',
        { acquisitionGeneration: 1, executionAttemptId: 'stale' },
        mutation,
      ),
    ).resolves.toEqual({ committed: false });
    expect(mutation).not.toHaveBeenCalled();
  });

  it('requires legacy null fields to remain null at commit time', () => {
    const query = new PgDialect().sqlToQuery(
      buildSignalExecutionLockQuery('request-1', {}),
    );

    expect(query.sql.match(/IS NULL/g)).toHaveLength(2);
  });
});
