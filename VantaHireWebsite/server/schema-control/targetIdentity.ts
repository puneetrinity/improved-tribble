// Gate 1A0-F — Flow schema-control: target identity + credential separation.
//
// Purpose: make it impossible to apply a migration to the wrong (or copied)
// database, and to ever run migrations with a runtime credential. Every
// production database carries an opaque, random `schema_control_identity`
// row (system=`flow`, environment, target_id). A release migration must be
// handed the *expected* target id + system/environment + an explicit one-run
// apply flag, and a dedicated migration credential. Runtime processes never
// receive or fall back to the migration/owner credential.
//
// This module performs NO DDL and reads only the control-plane identity row.

import { createHash } from "node:crypto";

export const SYSTEM = "flow" as const;

export type ResolvedEnvironment = "production" | "staging" | "development";

/** A one-way, non-reversible fingerprint safe to print in logs. */
export function safeTargetFingerprint(targetId: string): string {
  if (!targetId) return "(none)";
  return `flow:${createHash("sha256").update(targetId, "utf8").digest("hex").slice(0, 12)}`;
}

export interface MigrationCredentials {
  /** Dedicated migration/owner connection string. Never used at runtime. */
  migrateUrl: string;
  /** Expected opaque target id this run is allowed to touch. */
  expectedTargetId: string;
  /** Declared environment for this run. */
  environment: ResolvedEnvironment;
  /** Fresh identity creation is allowed only in explicitly disposable development. */
  allowFreshInitialization: boolean;
}

export class TargetIdentityError extends Error {}

export function resolveSchemaEnvironment(env: NodeJS.ProcessEnv): ResolvedEnvironment {
  const raw = (env.FLOW_SCHEMA_ENVIRONMENT ?? env.NODE_ENV ?? "").trim().toLowerCase();
  if (raw === "production") return "production";
  if (raw === "staging") return "staging";
  if (raw === "development") return "development";
  throw new TargetIdentityError(
    "FLOW_SCHEMA_ENVIRONMENT (or NODE_ENV) must explicitly be production, staging, or development; missing/unknown environments never fall back to development.",
  );
}

/**
 * Resolve the credentials + guards required to RUN a release migration.
 * Fails closed: in production/staging every guard is mandatory and there is
 * no single-credential fallback. A development run may use one disposable
 * credential only when explicitly labelled.
 */
export function resolveMigrationCredentials(
  env: NodeJS.ProcessEnv = process.env,
): MigrationCredentials {
  const environment = resolveSchemaEnvironment(env);
  const applyFlag = (env.FLOW_MIGRATION_APPLY ?? "").trim();
  if (applyFlag !== "1") {
    throw new TargetIdentityError(
      "FLOW_MIGRATION_APPLY=1 is required to apply migrations (explicit one-run opt-in).",
    );
  }

  const migrateUrl = (env.FLOW_MIGRATE_DATABASE_URL ?? "").trim();
  const expectedTargetId = (env.FLOW_SCHEMA_TARGET_ID ?? "").trim();

  if (environment === "development") {
    // Explicitly-labelled disposable single-credential mode for local/CI only.
    const disposable = (env.FLOW_SCHEMA_DISPOSABLE ?? "").trim() === "1";
    if (disposable) {
      const url = migrateUrl || (env.DATABASE_URL ?? "").trim();
      if (!url) {
        throw new TargetIdentityError(
          "Disposable development migration requires FLOW_MIGRATE_DATABASE_URL or DATABASE_URL.",
        );
      }
      return {
        migrateUrl: url,
        expectedTargetId: expectedTargetId || "dev-disposable",
        environment,
        allowFreshInitialization: true,
      };
    }
  }

  // Production / staging (and non-disposable development): all guards mandatory.
  if (!migrateUrl) {
    throw new TargetIdentityError(
      "FLOW_MIGRATE_DATABASE_URL (dedicated migration credential) is required; runtime DATABASE_URL is never used to migrate.",
    );
  }
  if (!expectedTargetId) {
    throw new TargetIdentityError(
      "FLOW_SCHEMA_TARGET_ID (expected opaque target id) is required; identity is never inferred from a hostname or database name.",
    );
  }
  return { migrateUrl, expectedTargetId, environment, allowFreshInitialization: false };
}

/**
 * Reduce an operational error to a bounded message that cannot echo a DSN,
 * password, bearer token, or other common secret assignment into logs/ledger.
 */
export function safeOperationalMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown error");
  return raw
    .replace(/\b(?:postgres(?:ql)?):\/\/[^\s'"`]+/gi, "[REDACTED_DSN]")
    .replace(/\b(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .slice(0, 1000);
}

export interface SchemaControlIdentityRow {
  system: string;
  environment: string;
  target_id: string;
}

/**
 * Assert the database the caller connected to carries the expected identity.
 * `readIdentity` is injected so this module performs no I/O itself and stays
 * trivially unit-testable. It must be a read-only lookup of the control-plane
 * identity row.
 */
export function assertTargetIdentity(
  expected: { system: string; environment: string; targetId: string },
  actual: SchemaControlIdentityRow | null,
): void {
  if (actual === null) {
    throw new TargetIdentityError(
      `No schema-control identity present for ${safeTargetFingerprint(expected.targetId)}; ` +
        "an unadopted or freshly-copied database must be given a new identity before it can accept migrations.",
    );
  }
  if (
    actual.system !== expected.system ||
    actual.environment !== expected.environment ||
    actual.target_id !== expected.targetId
  ) {
    // Never print the actual/expected raw ids — only a safe fingerprint of expected.
    throw new TargetIdentityError(
      `Refusing to migrate: connected database identity does not match the expected target ` +
        `${safeTargetFingerprint(expected.targetId)} (system/environment/target mismatch).`,
    );
  }
}
