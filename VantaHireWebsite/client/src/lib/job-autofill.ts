/**
 * Autofill rule for the brief-mode posting wizard: a value found in the JD fills a field only when the
 * field is empty, or still holds exactly what an earlier autofill wrote (the recruiter has not touched it).
 * Recruiter-typed values are never replaced. The JD text itself is never part of this merge.
 */
export function mergeAutofill<T extends Record<string, string>>(current: T, found: Partial<Record<keyof T, string>>,
  previous: Partial<Record<keyof T, string>>, defaults: Partial<T> = {}): { values: T; written: Partial<Record<keyof T, string>> } {
  const values = { ...current };
  const written: Partial<Record<keyof T, string>> = {};
  for (const key of Object.keys(found) as Array<keyof T>) {
    const value = (found[key] ?? '').trim();
    if (!value) continue;
    const now = current[key] ?? '';
    const untouched = now === '' || (previous[key] !== undefined && now === previous[key])
      || (previous[key] === undefined && defaults[key] !== undefined && now === defaults[key]);
    if (untouched) { (values as Record<keyof T, string>)[key] = value; written[key] = value; }
  }
  return { values, written };
}

/** Same rule for a list (skills): replace only an empty list or one still equal to the earlier autofill. */
export function mergeAutofillList(current: string[], found: string[], previous: string[] | undefined): string[] {
  const same = previous !== undefined && current.length === previous.length && current.every((v, i) => v === previous[i]);
  return current.length === 0 || same ? found : current;
}
