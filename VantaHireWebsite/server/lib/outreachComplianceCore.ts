import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_VERSION = 1;
const MIN_SECRET_LENGTH = 32;

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
    return claims as unknown as OutreachApplicationClaims;
  } catch {
    throw new Error('Invalid outreach application token');
  }
}
