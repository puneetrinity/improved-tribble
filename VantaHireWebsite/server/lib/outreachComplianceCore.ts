import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_VERSION = 1;
const MIN_SECRET_LENGTH = 32;

/**
 * Attribution links go stale; opt-out links must not.
 *
 * The application token only credits an application to the campaign that caused
 * it, and an expired one fails soft: applications.routes.ts swallows the error
 * and falls back to matching on email, so the candidate still applies. Bounding
 * it limits how long a URL sitting in browser history, proxy logs or a Referer
 * header keeps carrying readable internal ids.
 *
 * There is deliberately no equivalent for the unsubscribe token. Someone who
 * finds a two-year-old email must still be able to stop the outreach; an expired
 * opt-out link is a compliance failure, not a security win. Its exposure is
 * addressed by replacing the payload with an opaque lookup id, never by expiry.
 */
const APPLICATION_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Tolerance for a token minted by a replica whose clock runs slightly ahead of
 * the verifier's. Beyond this the timestamp is not skew, it is wrong: an
 * issuedAt in the future would otherwise survive its whole max-age window PLUS
 * however far ahead the clock was, which quietly defeats the bound above.
 */
const APPLICATION_TOKEN_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface OutreachUnsubscribeClaims {
  v: typeof TOKEN_VERSION;
  organizationId: number;
  sourcedCandidateId: number;
  campaignId: string;
  campaignRound: number;
  emailHash: string;
  issuedAt: number;
}

export interface OutreachApplicationClaims {
  v: typeof TOKEN_VERSION;
  kind: 'outreach_application';
  organizationId: number;
  jobId: number;
  sourcedCandidateId: number;
  campaignId: string;
  campaignRound: number;
  issuedAt: number;
}

function getUnsubscribeSecret(): string {
  const secret = process.env.OUTREACH_UNSUBSCRIBE_SECRET?.trim() ?? '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `OUTREACH_UNSUBSCRIBE_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return secret;
}

export function normalizeOutreachEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashOutreachEmail(email: string): string {
  return createHash('sha256').update(normalizeOutreachEmail(email)).digest('hex');
}

function signEncodedClaims(encodedClaims: string): string {
  return createHmac('sha256', getUnsubscribeSecret())
    .update(encodedClaims)
    .digest('base64url');
}

export function createOutreachUnsubscribeToken(input: {
  organizationId: number;
  sourcedCandidateId: number;
  campaignId: string;
  campaignRound: number;
  email: string;
}): string {
  const encodedClaims = Buffer.from(JSON.stringify({
    v: TOKEN_VERSION,
    organizationId: input.organizationId,
    sourcedCandidateId: input.sourcedCandidateId,
    campaignId: input.campaignId,
    campaignRound: input.campaignRound,
    emailHash: hashOutreachEmail(input.email),
    issuedAt: Date.now(),
  } satisfies OutreachUnsubscribeClaims), 'utf8').toString('base64url');
  return `${encodedClaims}.${signEncodedClaims(encodedClaims)}`;
}

export function createOutreachApplicationToken(input: {
  organizationId: number;
  jobId: number;
  sourcedCandidateId: number;
  campaignId: string;
  campaignRound: number;
}): string {
  const encodedClaims = Buffer.from(JSON.stringify({
    v: TOKEN_VERSION,
    kind: 'outreach_application',
    organizationId: input.organizationId,
    jobId: input.jobId,
    sourcedCandidateId: input.sourcedCandidateId,
    campaignId: input.campaignId,
    campaignRound: input.campaignRound,
    issuedAt: Date.now(),
  } satisfies OutreachApplicationClaims), 'utf8').toString('base64url');
  return `${encodedClaims}.${signEncodedClaims(encodedClaims)}`;
}

function verifySignedClaims(token: string): Record<string, unknown> {
  const [encodedClaims, receivedSignature, ...extra] = token.split('.');
  if (!encodedClaims || !receivedSignature || extra.length > 0) {
    throw new Error('Invalid outreach token');
  }

  const expectedSignature = signEncodedClaims(encodedClaims);
  const expected = Buffer.from(expectedSignature, 'utf8');
  const received = Buffer.from(receivedSignature, 'utf8');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('Invalid outreach token');
  }

  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid outreach token');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid outreach token');
  }
  return value as Record<string, unknown>;
}

export function verifyOutreachUnsubscribeToken(token: string): OutreachUnsubscribeClaims {
  try {
    const claims = verifySignedClaims(token);
    if (
      claims.v !== TOKEN_VERSION ||
      !Number.isSafeInteger(claims.organizationId) ||
      Number(claims.organizationId) <= 0 ||
      !Number.isSafeInteger(claims.sourcedCandidateId) ||
      Number(claims.sourcedCandidateId) <= 0 ||
      typeof claims.campaignId !== 'string' ||
      claims.campaignId.length === 0 ||
      !Number.isInteger(claims.campaignRound) ||
      Number(claims.campaignRound) < 1 ||
      Number(claims.campaignRound) > 3 ||
      typeof claims.emailHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(claims.emailHash) ||
      !Number.isSafeInteger(claims.issuedAt) ||
      Number(claims.issuedAt) <= 0
    ) {
      throw new Error('Invalid unsubscribe token');
    }
    return claims as unknown as OutreachUnsubscribeClaims;
  } catch {
    throw new Error('Invalid unsubscribe token');
  }
}

export function verifyOutreachApplicationToken(token: string): OutreachApplicationClaims {
  try {
    const claims = verifySignedClaims(token);
    if (
      claims.v !== TOKEN_VERSION ||
      claims.kind !== 'outreach_application' ||
      !Number.isSafeInteger(claims.organizationId) ||
      Number(claims.organizationId) <= 0 ||
      !Number.isSafeInteger(claims.jobId) ||
      Number(claims.jobId) <= 0 ||
      !Number.isSafeInteger(claims.sourcedCandidateId) ||
      Number(claims.sourcedCandidateId) <= 0 ||
      typeof claims.campaignId !== 'string' ||
      claims.campaignId.length === 0 ||
      !Number.isInteger(claims.campaignRound) ||
      Number(claims.campaignRound) < 1 ||
      Number(claims.campaignRound) > 3 ||
      !Number.isSafeInteger(claims.issuedAt) ||
      Number(claims.issuedAt) <= 0
    ) {
      throw new Error('Invalid outreach application token');
    }
    const age = Date.now() - Number(claims.issuedAt);
    if (age < -APPLICATION_TOKEN_CLOCK_SKEW_MS || age > APPLICATION_TOKEN_MAX_AGE_MS) {
      throw new Error('Invalid outreach application token');
    }
    return claims as unknown as OutreachApplicationClaims;
  } catch {
    throw new Error('Invalid outreach application token');
  }
}
