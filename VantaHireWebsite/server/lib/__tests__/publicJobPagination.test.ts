import { describe, expect, it } from 'vitest';
import { InvalidPublicJobPagination, publicJobPagination } from '../publicJobPagination';

describe('public job pagination', () => {
  it('defaults and preserves ordinary pages', () => {
    expect(publicJobPagination(undefined, undefined, 'http')).toEqual({ page: 1, limit: 10, offset: 0 });
    expect(publicJobPagination('2', '25', 'http')).toEqual({ page: 2, limit: 25, offset: 25 });
  });
  it.each(['100', '101', '1000', String(Number.MAX_SAFE_INTEGER)])('caps valid limit %s', limit => {
    expect(publicJobPagination('2', limit, 'http')).toEqual({ page: 2, limit: 100, offset: 100 });
  });
  const invalid = [0, 1, '', '0', '-1', '1.5', '2abc', ' 2', '+2', '1e2', 'Infinity', '9007199254740992', ['2'], { x: '2' }, null];
  it.each(invalid.map((value, index) => ({ value, label: String(index) })))('refuses malformed HTTP input $label', ({ value }) => {
    expect(() => publicJobPagination(value, '10', 'http')).toThrow(InvalidPublicJobPagination);
    expect(() => publicJobPagination('1', value, 'http')).toThrow(InvalidPublicJobPagination);
  });
  it('enforces numeric storage bounds and safe offset arithmetic', () => {
    expect(publicJobPagination(2, 1000, 'storage')).toEqual({ page: 2, limit: 100, offset: 100 });
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => publicJobPagination(value, 10, 'storage')).toThrow(InvalidPublicJobPagination);
      expect(() => publicJobPagination(1, value, 'storage')).toThrow(InvalidPublicJobPagination);
    }
    expect(() => publicJobPagination(String(Number.MAX_SAFE_INTEGER), '100', 'http')).toThrow(InvalidPublicJobPagination);
  });
});
