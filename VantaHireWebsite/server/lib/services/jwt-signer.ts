/**
 * RS256 JWT signer/verifier for service-to-service auth.
 *
 * Used for:
 * - Signing outbound requests to Signal (audience: 'signal')
 * - Signing outbound requests to Active Graph KG (audience: 'activekg')
 * - Verifying inbound Signal callbacks (issuer: 'signal', audience: 'vantahire')
 *
 * Key configuration:
 * - VANTAHIRE_JWT_PRIVATE_KEY: PEM-encoded RS256 private key (for signing outbound)
 * - VANTAHIRE_JWT_ACTIVE_KID: Key ID for JWT header (defaults to 'v1')
 * - SIGNAL_JWT_PUBLIC_KEY: PEM-encoded RS256 public key (for verifying Signal callbacks)
 *
 * Claim conventions (Signal v3):
 * - Outbound: { tenant_id, scopes (space-delimited), actor_type, request_id? }
 * - Inbound callback: { tenant_id, request_id, scopes: 'callbacks:write', sub: 'sourcing' }
 * - All custom claims use snake_case on the wire.
 */

import { SignJWT, jwtVerify, importPKCS8, importSPKI, type JWTPayload } from 'jose';
import { randomUUID, webcrypto } from 'node:crypto';

// jose uses Web Crypto; ensure it exists on Node runtimes where globalThis.crypto is absent.
// On Node 20+ this is a no-op (globalThis.crypto already exists).
if (!(globalThis as unknown as { crypto?: unknown }).crypto) {
  (globalThis as unknown as { crypto?: unknown }).crypto = webcrypto;
}

// Supported audiences for outbound JWT signing
export type JwtAudience = 'signal' | 'activekg';

// jose importPKCS8/importSPKI return opaque key objects — use Awaited<ReturnType> for Node compat
type ImportedKey = Awaited<ReturnType<typeof importPKCS8>>;

// Cache imported keys to avoid re-parsing PEM on every call
let cachedPrivateKey: ImportedKey | null = null;
let cachedSignalPublicKey: ImportedKey | null = null;

const ALGORITHM = 'RS256';
const ISSUER = 'vantahire';
const DEFAULT_EXPIRY = '5m';

async function getPrivateKey(): Promise<ImportedKey> {
  if (cachedPrivateKey) return cachedPrivateKey;

  const pem = process.env.VANTAHIRE_JWT_PRIVATE_KEY;
  if (!pem) {
    throw new Error('VANTAHIRE_JWT_PRIVATE_KEY environment variable is not set');
  }

  const decoded = pem.includes('-----BEGIN') ? pem : Buffer.from(pem, 'base64').toString('utf-8');
  cachedPrivateKey = await importPKCS8(decoded, ALGORITHM);
  return cachedPrivateKey;
}

async function getSignalPublicKey(): Promise<ImportedKey> {
  if (cachedSignalPublicKey) return cachedSignalPublicKey;

  const pem = process.env.SIGNAL_JWT_PUBLIC_KEY;
  if (!pem) {
    throw new Error('SIGNAL_JWT_PUBLIC_KEY environment variable is not set');
  }

  const decoded = pem.includes('-----BEGIN') ? pem : Buffer.from(pem, 'base64').toString('utf-8');
  cachedSignalPublicKey = await importSPKI(decoded, ALGORITHM);
  return cachedSignalPublicKey;
}

/**
 * Sign an outbound JWT for service-to-service calls to Signal.
 *
 * Signal v3 expects these custom claims (snake_case on the wire):
 * - tenant_id: string (required)
 * - scopes: space-delimited string (e.g. 'jobs:source jobs:results')
 * - actor_type: defaults to 'service'
 * - request_id: optional, for request correlation
 */
export async function signServiceJwt(
  audience: JwtAudience,
  opts: {
    tenantId: string;
    scopes: string;           // space-delimited scopes string
    requestId?: string;
    actorType?: string;
  },
): Promise<string> {
  const privateKey = await getPrivateKey();

  const jwt = new SignJWT({
    tenant_id: opts.tenantId,
    scopes: opts.scopes,
    actor_type: opts.actorType ?? 'service',
    ...(opts.requestId ? { request_id: opts.requestId } : {}),
  })
    .setProtectedHeader({ alg: ALGORITHM, kid: process.env.VANTAHIRE_JWT_ACTIVE_KID || 'v1' })
    .setIssuer(ISSUER)
    .setSubject('vantahire-backend')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(DEFAULT_EXPIRY)
    .setJti(randomUUID());

  return jwt.sign(privateKey);
}

/** Verified callback claims from Signal. */
export interface VerifiedCallbackClaims {
  jti: string;
  tenantId: string;
  requestId: string;
  acquisitionGeneration?: number;
  executionAttemptId?: string;
  scopes: string;
}

/**
 * Verify an inbound JWT from Signal callbacks.
 *
 * Signal callback JWTs have:
 * - iss: 'signal'
 * - aud: 'vantahire'
 * - sub: 'sourcing'
 * - scopes: 'callbacks:write' (string, not space-delimited list)
 * - tenant_id, request_id (snake_case custom claims)
 */
export async function verifySignalCallbackJwt(
  token: string,
): Promise<VerifiedCallbackClaims> {
  const publicKey = await getSignalPublicKey();

  const { payload } = await jwtVerify(token, publicKey, {
    issuer: 'signal',
    audience: 'vantahire',
    algorithms: [ALGORITHM],
    clockTolerance: 5,
  });

  // Verify scopes claim — exact token match, not substring
  const rawScopes = payload.scopes as string | undefined;
  if (!rawScopes) {
    throw new Error('JWT missing scopes claim');
  }
  const scopeList = rawScopes.split(' ').filter(Boolean);
  if (!scopeList.includes('callbacks:write')) {
    throw new Error(`JWT scopes mismatch: expected 'callbacks:write', got '${rawScopes}'`);
  }

  // Require jti for replay protection
  if (!payload.jti) {
    throw new Error('JWT missing jti claim (required for replay protection)');
  }

  // Require tenant_id and request_id
  const tenantId = payload.tenant_id as string | undefined;
  if (!tenantId) {
    throw new Error('JWT missing tenant_id claim');
  }

  const requestId = payload.request_id as string | undefined;
  if (!requestId) {
    throw new Error('JWT missing request_id claim');
  }

  const acquisitionGeneration =
    typeof payload.acquisition_generation === 'number'
      ? payload.acquisition_generation
      : undefined;
  const executionAttemptId =
    typeof payload.execution_attempt_id === 'string'
      ? payload.execution_attempt_id
      : undefined;

  return {
    jti: payload.jti,
    tenantId,
    requestId,
    ...(acquisitionGeneration != null
      ? { acquisitionGeneration }
      : {}),
    ...(executionAttemptId ? { executionAttemptId } : {}),
    scopes: rawScopes,
  };
}

/**
 * Clear cached keys. Useful for testing or key rotation.
 */
export function clearKeyCache(): void {
  cachedPrivateKey = null;
  cachedSignalPublicKey = null;
}
