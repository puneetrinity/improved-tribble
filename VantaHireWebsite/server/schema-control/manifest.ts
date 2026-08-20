// Gate 1A0-F — Flow schema-control: append-only migration manifest + checksums.
//
// The manifest is the single ordered schema authority for Flow. Entry 0 is the
// immutable exact-catalog baseline (produced/reconciled under Gate 1A0-P from
// the deployed catalog); every later schema/data change is a new immutable
// entry. Applied content is immutable: once any environment records a
// checksum, a repair is a NEW forward migration, never an edit. There is no
// checksum-transition escape hatch.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface MigrationEntry {
  /** Zero-padded ordinal, e.g. "0000" (baseline), "0001", … */
  version: string;
  /** File name within the migrations directory. */
  file: string;
  /** SHA-256 of the exact file bytes. */
  checksum: string;
  /** SQL text (loaded eagerly so the runner never re-reads mutated bytes). */
  sql: string;
  /**
   * A migration is one transaction unless it explicitly opts out via a
   * leading `-- schema-control: no-transaction` directive (which additionally
   * requires its own approval/compensation plan before use).
   */
  transactional: boolean;
}

export class ManifestError extends Error {}

const NAME_RE = /^(\d{4,})_[a-z0-9]+(?:[-_][a-z0-9]+)*\.sql$/;

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Load the ordered, contiguous manifest from a directory of `NNNN_name.sql`
 * files. Rejects gaps, duplicate versions, and malformed names so a reordered
 * or missing migration cannot silently pass.
 */
export function loadManifest(dir: string): MigrationEntry[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const entries: MigrationEntry[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const m = NAME_RE.exec(file);
    if (!m || m[1] === undefined) {
      throw new ManifestError(`Migration file has an invalid name: ${file}`);
    }
    const version = m[1];
    if (seen.has(version)) {
      throw new ManifestError(`Duplicate migration version ${version} (${file}).`);
    }
    seen.add(version);
    const bytes = readFileSync(join(dir, file));
    const sql = bytes.toString("utf8");
    entries.push({
      version,
      file,
      checksum: sha256(bytes),
      sql,
      transactional: !/^\s*--\s*schema-control:\s*no-transaction\b/im.test(sql),
    });
  }

  // Contiguity: versions must be strictly increasing with no gap, starting at 0.
  entries.sort((a, b) => Number(a.version) - Number(b.version));
  entries.forEach((e, i) => {
    if (Number(e.version) !== i) {
      throw new ManifestError(
        `Migration ordering is not contiguous: expected version ${i}, found ${e.version} (${e.file}).`,
      );
    }
  });
  if (entries.length === 0) {
    throw new ManifestError("Empty migration manifest: the baseline (0000) is required.");
  }

  // The human-reviewable lock is mandatory at runtime too, not merely in CI.
  // It pins both immutable SQL bytes and the stable production-catalog
  // expectation used to prove the baseline on disposable PostgreSQL.
  let lock: {
    format_version?: unknown;
    catalog_lock_sha256?: unknown;
    migrations?: unknown;
  };
  try {
    lock = JSON.parse(readFileSync(join(dir, "checksums.lock"), "utf8"));
  } catch {
    throw new ManifestError("Migration checksum lock is missing or invalid JSON.");
  }
  if (
    lock.format_version !== 1 ||
    typeof lock.catalog_lock_sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(lock.catalog_lock_sha256) ||
    !lock.migrations ||
    typeof lock.migrations !== "object" ||
    Array.isArray(lock.migrations)
  ) {
    throw new ManifestError("Migration checksum lock has an unsupported shape.");
  }
  let catalogLockBytes: Buffer;
  try {
    catalogLockBytes = readFileSync(join(dir, "catalog.lock.json"));
  } catch {
    throw new ManifestError("Catalog lock is missing.");
  }
  if (sha256(catalogLockBytes) !== lock.catalog_lock_sha256) {
    throw new ManifestError("Catalog lock checksum changed — regenerate only through an approved catalog gate.");
  }

  const pinned = lock.migrations as Record<string, unknown>;
  const expectedVersions = entries.map((entry) => entry.version);
  const pinnedVersions = Object.keys(pinned).sort((a, b) => Number(a) - Number(b));
  if (JSON.stringify(pinnedVersions) !== JSON.stringify(expectedVersions)) {
    throw new ManifestError("Migration checksum lock versions do not exactly match the ordered manifest.");
  }
  for (const entry of entries) {
    if (pinned[entry.version] !== entry.checksum) {
      throw new ManifestError(
        `Migration ${entry.version} (${entry.file}) does not match the immutable checksum lock.`,
      );
    }
  }
  return entries;
}

/**
 * Compare the on-disk manifest against the applied ledger. Returns the ordered
 * list of not-yet-applied entries, and throws on any integrity violation:
 * a checksum that differs from what was applied, or an applied version that no
 * longer exists on disk (history rewrite).
 */
export function diffManifest(
  manifest: MigrationEntry[],
  applied: Array<{ version: string; checksum: string }>,
): MigrationEntry[] {
  const appliedByVersion = new Map(applied.map((a) => [a.version, a.checksum]));
  for (const a of applied) {
    const onDisk = manifest.find((e) => e.version === a.version);
    if (!onDisk) {
      throw new ManifestError(
        `Applied migration ${a.version} is missing on disk — applied history must never be rewritten.`,
      );
    }
    if (onDisk.checksum !== a.checksum) {
      throw new ManifestError(
        `Applied migration ${a.version} (${onDisk.file}) checksum changed — applied content is immutable; write a new forward migration instead.`,
      );
    }
  }
  return manifest.filter((e) => !appliedByVersion.has(e.version));
}
