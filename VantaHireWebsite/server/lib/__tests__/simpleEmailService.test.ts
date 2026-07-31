import { describe, expect, it } from 'vitest';

import { isDefinitiveEmailSendFailure } from '../../simpleEmailService';

describe('SMTP delivery outcome classification', () => {
  it('allows retry for provider-confirmed and pre-dispatch failures', () => {
    expect(isDefinitiveEmailSendFailure({ code: 'EAUTH', command: 'AUTH' }))
      .toBe(true);
    expect(isDefinitiveEmailSendFailure({ responseCode: 550, command: 'RCPT TO' }))
      .toBe(true);
    expect(isDefinitiveEmailSendFailure({ code: 'EDNS', command: 'CONN' }))
      .toBe(true);
  });

  it('fails closed for timeouts and unknown post-dispatch outcomes', () => {
    expect(isDefinitiveEmailSendFailure({ code: 'ETIMEDOUT', command: 'DATA' }))
      .toBe(false);
    expect(isDefinitiveEmailSendFailure({ code: 'ECONNECTION', command: 'CONN' }))
      .toBe(false);
    expect(isDefinitiveEmailSendFailure(new Error('socket closed')))
      .toBe(false);
  });
});
