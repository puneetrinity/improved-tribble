import { describe, expect, it } from 'vitest';
import { jobMetaDescription, publicJobDescription, resolveJobDescription, serializeJobJsonLd } from '../../../shared/jobDescription';

const prose = 'Build reliable services. Work with our engineering team on useful software.';
describe('public job prose projection', () => {
  for (const [name, description] of Object.entries({
    object: '{"roleTitle":"Engineer","eliteSchools":["hidden"],"rejectTitleRegex":"secret"}',
    malformed: '{ "mustHaveGates":', array: '[{"skills":["Python"]}]',
    fenced: '```json\n{"roleTitle":"Engineer"}\n```',
    escaped: JSON.stringify('{"roleTitle":"Engineer"}'),
    backslashObject: String.raw`{\"roleTitle\":\"x\"}`,
    backslashArray: String.raw`[\"Python\",\"SQL\"]`,
    backslashWrappedObject: String.raw`<pre>{\"roleTitle\":\"x\"}</pre>`,
    html: '<pre>{&quot;roleTitle&quot;:&quot;Engineer&quot;}</pre>',
    empty: '',
    truncated: '{"roleTitle":',
    truncatedArray: '[ { "roleTitle":',
    truncatedStrings: '[ "Python",',
    numericArray: '[1,2,3]',
    emptyObject: '{}',
    emptyArray: '[]',
    encodedTruncated: '&#123;&quot;roleTitle&quot;:',
  })) {
    it(`${name}: uses original prose, never structured fallback`, () => {
      expect(publicJobDescription({ description, originalJD: prose })).toBe(prose);
      expect(resolveJobDescription({ description }).text).toBe('');
      expect(jobMetaDescription({ title: 'Engineer', location: 'Bengaluru', description })).toBe('Apply for Engineer at Bengaluru.');
    });
  }
  for (const text of ['[Remote] Build backend systems.', '{Company} is hiring.']) {
    it(`preserves bracketed prose: ${text}`, () => {
      expect(publicJobDescription({ description: text })).toBe(text);
      expect(publicJobDescription({ description: '{"roleTitle":', originalJD: text })).toBe(text);
      expect(publicJobDescription({ description: `<p>${text}</p>` })).toBe(text);
      expect(publicJobDescription({ description: JSON.stringify(text) })).toBe(text);
      expect(jobMetaDescription({ title: 'Engineer', description: text })).toContain(text);
    });
  }
  it('keeps ordinary skill words and plain-only edits', () => {
    expect(publicJobDescription({ description: 'Required skills include Python.' })).toBe('Required skills include Python.');
  });
  it('records ambiguous legacy provenance without guessing edit recency', () => {
    expect(resolveJobDescription({ originalJD: prose, description: 'Edited prose.' })).toEqual({ text: prose, resolution: 'ambiguous_legacy_original' });
  });
  it('handles absent/oversized content and repeated fallback projection', () => {
    expect(resolveJobDescription({ description: 'x'.repeat(200001) }).text).toBe('');
    expect(resolveJobDescription({ description: publicJobDescription({}) }).text).toBe('');
  });
  it('strips executable markup and retains plain text only', () => {
    expect(publicJobDescription({ description: '<script>alert(1)</script><style>secret</style><p>Build <b>software</b>.</p>' })).toBe('Build software.');
    expect(publicJobDescription({ description: '&lt;script&gt;secret&lt;/script&gt;Build software.' })).toBe('Build software.');
  });
  it('serializes closing-script input without executable delimiters', () => {
    const value = { description: '</script><script>alert(1)</script>&' };
    const json = serializeJobJsonLd(value);
    expect(json).not.toContain('<'); expect(json).not.toContain('&');
    expect(JSON.parse(json)).toEqual(value);
  });
  it('bounds unicode snippets without splitting surrogate pairs', () => {
    const text = jobMetaDescription({ title: 'Engineer', description: '😀'.repeat(300) });
    expect(Array.from(text)).toHaveLength(155);
    expect(text).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});
