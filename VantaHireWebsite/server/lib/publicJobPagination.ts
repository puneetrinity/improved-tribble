export const PUBLIC_JOB_PAGE_LIMIT = 100;

export class InvalidPublicJobPagination extends Error {
  constructor() { super('Page and limit must be positive safe integers with a safe offset'); }
}

/** HTTP inputs are scalar decimal strings; storage callers may supply numbers. */
export function publicJobPagination(pageInput: unknown, limitInput: unknown, source: 'http' | 'storage') {
  const integer = (value: unknown, fallback: number): number => {
    if (value === undefined) return fallback;
    if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
    }
    if (source === 'storage' && typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
    throw new InvalidPublicJobPagination();
  };
  const page = integer(pageInput, 1);
  const limit = Math.min(integer(limitInput, 10), PUBLIC_JOB_PAGE_LIMIT);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new InvalidPublicJobPagination();
  return { page, limit, offset };
}
