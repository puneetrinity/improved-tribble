/** Public description projection only. Never changes the stored JD or sourcing input. */
export const JOB_DESCRIPTION_UNAVAILABLE = 'Job description unavailable.';
const MAX_INPUT = 200_000;
const MAX_TEXT = 50_000;

function decodeEntities(value: string): string {
  return value.replace(/&(?:#(x[0-9a-f]+|\d+)|quot|apos|lt|gt|amp|nbsp);/gi, (entity, number: string | undefined) => {
    if (number) {
      const point = number.toLowerCase().startsWith('x') ? parseInt(number.slice(1), 16) : Number(number);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : '';
    }
    return ({ '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&', '&nbsp;': ' ' } as Record<string, string>)[entity.toLowerCase()] ?? entity;
  });
}

function isStructured(value: string): boolean {
  // Also refuse incomplete object/array-of-object/string payloads, but not
  // ordinary prose labels such as [Remote] or {Company}.
  if (/^(?:\{\s*\\?"|\[\s*\\?[{"])/.test(value)) return true;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object';
  } catch { return false; }
}

function prose(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > MAX_INPUT) return null;
  let value = input.trim();
  // Decode encoded JSON before classifying, including quoted/escaped JSON strings.
  for (let i = 0; i < 3; i++) {
    value = decodeEntities(value).trim();
    if (/^```\s*(?:json)?\s*[\[{]/i.test(value)) return null;
    if (isStructured(value)) return null;
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === 'string') { value = parsed.trim(); continue; }
      return null;
    } catch { /* Ordinary prose is not JSON. */ }
    break;
  }
  value = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();
  if (isStructured(value) || /^```/.test(value) || /^(?:\\["{[])/.test(value)) return null;
  // This is plain text, not HTML suitable for dangerouslySetInnerHTML.
  value = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!value || value === JOB_DESCRIPTION_UNAVAILABLE) return null;
  return Array.from(value).slice(0, MAX_TEXT).join('');
}

export function resolveJobDescription(job: { description?: unknown; originalJD?: unknown }) {
  const original = prose(job.originalJD);
  const description = prose(job.description);
  if (original) return {
    text: original,
    resolution: description && original !== description ? 'ambiguous_legacy_original' as const : 'original_prose' as const,
  };
  if (description) return { text: description, resolution: 'description_prose' as const };
  return { text: '', resolution: 'unavailable' as const };
}

export function publicJobDescription(job: { description?: unknown; originalJD?: unknown }): string {
  return resolveJobDescription(job).text || JOB_DESCRIPTION_UNAVAILABLE;
}

export function jobMetaDescription(job: { title: string; location?: string | null; description?: unknown; originalJD?: unknown }): string {
  const text = `Apply for ${job.title} at ${job.location || 'the advertised location'}. ${resolveJobDescription(job).text}`
    .replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  return chars.length > 155 ? chars.slice(0, 152).join('') + '...' : text;
}

export function serializeJobJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}
