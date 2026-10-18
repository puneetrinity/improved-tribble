import { describe, expect, it } from 'vitest';
import {
  applicationSourceSchema,
  captureApplicationSource,
  readApplicationSource,
} from '@shared/application-source';

const now = new Date('2026-10-16T10:00:00.000Z');
const page = 'https://ealana.com/jobs/188';

describe('captureApplicationSource', () => {
  it('records UTM tags and the referring site host only', () => {
    const r = captureApplicationSource({
      pageUrl: `${page}?utm_source=linkedin&utm_medium=social&utm_campaign=oct-backend`,
      referrer: 'https://www.linkedin.com/feed/update/urn:li:activity:123?trk=person@example.com',
      now,
    });
    expect(r).toEqual({
      version: 1,
      landedAt: '2026-10-16T10:00:00.000Z',
      utmSource: 'linkedin',
      utmMedium: 'social',
      utmCampaign: 'oct-backend',
      referrerHost: 'www.linkedin.com',
    });
    expect(JSON.stringify(r)).not.toContain('person@example.com');
    expect(JSON.stringify(r)).not.toContain('activity');
  });

  it('ignores same-site navigation and non-web referrers', () => {
    expect(captureApplicationSource({ pageUrl: page, referrer: 'https://ealana.com/jobs', now }).referrerHost).toBeUndefined();
    expect(captureApplicationSource({ pageUrl: page, referrer: 'android-app://com.linkedin.android/', now }).referrerHost).toBeUndefined();
    expect(captureApplicationSource({ pageUrl: page, referrer: 'not a url', now }).referrerHost).toBeUndefined();
  });

  it('never records an IP address as the referring site', () => {
    for (const referrer of ['http://203.0.113.42/', 'https://10.0.0.1:8443/x', 'http://[2001:db8::1]/', 'http://3232235777/']) {
      expect(captureApplicationSource({ pageUrl: page, referrer, now }).referrerHost).toBeUndefined();
    }
  });

  it('drops UTM values that are too long or contain unexpected characters', () => {
    const r = captureApplicationSource({
      pageUrl: `${page}?utm_source=${'x'.repeat(300)}&utm_medium=<script>&utm_campaign=a%40b.com`,
      referrer: '',
      now,
    });
    expect(r.utmSource).toBe('x'.repeat(100));
    expect(r.utmMedium).toBeUndefined();
    expect(r.utmCampaign).toBeUndefined();
  });

  it('records a direct visit with only the landing time', () => {
    expect(captureApplicationSource({ pageUrl: page, referrer: '', now })).toEqual({
      version: 1,
      landedAt: '2026-10-16T10:00:00.000Z',
    });
  });

  it('always produces a value the server accepts', () => {
    const r = captureApplicationSource({ pageUrl: `${page}?utm_source=whatsapp`, referrer: 'https://l.facebook.com/', now });
    expect(applicationSourceSchema.safeParse(r).success).toBe(true);
  });
});

describe('readApplicationSource (server, never throws)', () => {
  const fresh = new Date().toISOString();
  const valid = { version: 1, utmSource: 'linkedin', referrerHost: 'www.linkedin.com', landedAt: fresh };

  it('accepts a valid record', () => {
    expect(readApplicationSource(JSON.stringify(valid))).toEqual(valid);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a string', { ...valid }],
    ['bad JSON', '{'],
    ['extra field', JSON.stringify({ ...valid, ip: '1.2.3.4' })],
    ['IPv4 as host', JSON.stringify({ ...valid, referrerHost: '203.0.113.42' })],
    ['IPv6 as host', JSON.stringify({ ...valid, referrerHost: '2001:db8::1' })],
    ['full URL as host', JSON.stringify({ ...valid, referrerHost: 'https://linkedin.com/in/someone' })],
    ['wrong version', JSON.stringify({ ...valid, version: 2 })],
    ['future time', JSON.stringify({ ...valid, landedAt: new Date(Date.now() + 86_400_000).toISOString() })],
    ['very old time', JSON.stringify({ ...valid, landedAt: '2020-01-01T00:00:00.000Z' })],
    ['oversized', JSON.stringify({ ...valid, utmCampaign: 'a'.repeat(5000) })],
  ])('returns null for %s', (_label, raw) => {
    expect(readApplicationSource(raw)).toBeNull();
  });
});
