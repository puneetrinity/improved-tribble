import { describe, expect, it } from 'vitest';
import { accountVerificationEmail, sparkVerificationEmail, verificationEmailForAccount } from './verification-email';

const URL_ = 'https://ealana.com/verify-email/abc123';
const base = { verifyUrl: URL_, baseUrl: 'https://ealana.com/' };

describe('verification emails (approved copy, 3 Nov 2026)', () => {
  it('registration and resend use persisted spark origin, never role alone', async () => {
    const read = async (id: number) => id === 1;
    for (const attempt of ['registration', 'resend']) {
      expect((await verificationEmailForAccount({...base,userId:1,role:'candidate'},read)).subject,attempt).toBe('Confirm your email for spark');
      expect((await verificationEmailForAccount({...base,userId:2,role:'candidate'},read)).subject,attempt).toBe('Confirm your email for ealana');
      expect((await verificationEmailForAccount({...base,userId:1,role:'recruiter'},async()=>{throw Error('must not query');})).subject,attempt).toBe('Confirm your email for ealana');
    }
  });
  it('does not disguise an origin lookup failure as a successful delivery', async () => {
    await expect(verificationEmailForAccount({...base,userId:1,role:'candidate'},async()=>{throw Error('unavailable');})).rejects.toThrow('unavailable');
  });
  it('spark: approved subject and lines, spark header and coral button, link twice', () => {
    const e = sparkVerificationEmail({ ...base, firstName: 'Asha' });
    expect(e.subject).toBe('Confirm your email for spark');
    expect(e.html).toContain('Hi Asha,');
    expect(e.html).toContain('Confirm your email to get started with your spark profile.');
    expect(e.html).toContain('Confirm my email');
    expect(e.html).toContain("The link expires after 24 hours. Didn't sign up for ealana? Just ignore this email.");
    expect(e.html).toContain('src="https://ealana.com/brand/spark-email-header.png" width="146" height="28" alt="ealana spark"');
    expect(e.html).toContain('background:#F25C2E');
    expect(e.html.split(`href="${URL_}"`).length - 1).toBe(2);
    expect(e.text).toContain(URL_);
  });

  it('everyone else: refreshed copy, no spark header or colours', () => {
    const e = accountVerificationEmail({ ...base, firstName: 'Ravi' });
    expect(e.subject).toBe('Confirm your email for ealana');
    expect(e.html).toContain('Thanks for signing up. Tap the button to confirm your email and get started.');
    expect(e.html).not.toContain('spark-email-header');
    expect(e.html).not.toMatch(/#F25C2E|spark profile/);
  });

  it('never inserts the name or link raw', () => {
    const e = sparkVerificationEmail({ firstName: '<img src=x onerror=alert(1)>', verifyUrl: 'https://x.test/v/a"onmouseover="b', baseUrl: 'https://x.test' });
    expect(e.html).not.toContain('<img src=x');
    expect(e.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(e.html).not.toContain('"onmouseover="');
  });

  it('a missing name says "there"; no tracking images or remote scripts', () => {
    const e = sparkVerificationEmail({ ...base, firstName: '  ' });
    expect(e.html).toContain('Hi there,');
    expect((e.html.match(/<img /g) ?? []).length).toBe(1);
    expect(e.html).not.toMatch(/<script|<link /i);
  });
});
