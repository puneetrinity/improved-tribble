import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

// The production guard is intentionally plain ESM so CI can execute it before
// TypeScript compilation.
// @ts-expect-error JavaScript guard has no declaration file.
import { checkCandidatePrivacySurfaces } from '../../../scripts/check-candidate-privacy-surfaces.mjs';

const APP_ROOT = join(dirname(new URL(import.meta.url).pathname), '../../..');
const MANIFEST = 'server/candidate-privacy/surfaces.json';
const scratch: string[] = [];

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function updateCensusHash(root: string): void {
  const path = join(root, MANIFEST);
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    sources: Array<{ file: string }>;
    source_census_sha256: string;
  };
  manifest.source_census_sha256 = sha256(
    manifest.sources
      .map(({ file }) => file)
      .sort()
      .map((file) => `${file}\0${sha256(readFileSync(join(root, file)))}\n`)
      .join(''),
  );
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'flow-privacy-surface-test-'));
  scratch.push(root);
  const manifest = JSON.parse(readFileSync(join(APP_ROOT, MANIFEST), 'utf8')) as {
    sources: Array<{ file: string }>;
  };
  for (const { file } of manifest.sources) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(APP_ROOT, file), target);
  }
  mkdirSync(dirname(join(root, MANIFEST)), { recursive: true });
  cpSync(join(APP_ROOT, MANIFEST), join(root, MANIFEST));
  updateCensusHash(root);
  return root;
}

function mutate(root: string, file: string, update: (source: string) => string): string[] {
  const path = join(root, file);
  writeFileSync(path, update(readFileSync(path, 'utf8')), { mode: 0o600 });
  updateCensusHash(root);
  return checkCandidatePrivacySurfaces(root);
}

afterEach(() => {
  while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});

describe('candidate privacy surface guard', () => {
  it('accepts the checked-in complete census', () => {
    expect(checkCandidatePrivacySurfaces(fixture())).toEqual([]);
  });

  it('rejects an unfenced aggregate reader even after its hash is refreshed', () => {
    const problems = mutate(fixture(), 'server/storage.ts', (source) => {
      const start = source.indexOf('async getJobHealthSummary');
      const fence = source.indexOf('applicationPrivacyAllowed(false)', start);
      return `${source.slice(0, fence)}true${source.slice(fence + 'applicationPrivacyAllowed(false)'.length)}\n// applicationPrivacyAllowed(false)\n`;
    });
    expect(problems.some((problem) => problem.includes('application aggregate privacy predicate'))).toBe(true);
  });

  it('rejects a privacy filter moved after the caller-visible limit', () => {
    const problems = mutate(fixture(), 'server/candidates.semantic.routes.ts', (source) =>
      `${source.replaceAll("privacyAllowedSql('application'", "privacyAllowedSqlAfterLimit('application'")}\n// privacyAllowedSql('application'\n`,
    );
    expect(problems.some((problem) => problem.includes('semantic-search SQL privacy predicate'))).toBe(true);
  });

  it('rejects a missing organization-analytics aggregate fence', () => {
    const problems = mutate(fixture(), 'server/lib/orgAnalyticsService.ts', (source) =>
      source.replace('applicationPrivacyAllowed()', 'true'),
    );
    expect(problems.some((problem) => problem.includes(
      'getOrgAnalyticsOverview SQL-before-aggregate privacy predicates',
    ))).toBe(true);
  });

  it('rejects a retained raw outbox body', () => {
    const problems = mutate(fixture(), 'server/schema-migrations/0001_candidate_privacy_flow.sql', (source) =>
      source.replace('request_id uuid NOT NULL UNIQUE', 'payload jsonb,\n  request_id uuid NOT NULL UNIQUE'),
    );
    expect(problems).toContain('privacy outbox persists a raw request or identity field.');
  });

  it('rejects a worker publication recheck gap', () => {
    const problems = mutate(fixture(), 'server/aiWorker.ts', (source) =>
      `${source.replaceAll('requireCandidatePrivacyAllowed(', 'privacyFenceRemoved(')}\n// requireCandidatePrivacyAllowed(\n`,
    );
    expect(problems).toContain('AI worker load/provider/publication privacy rechecks are incomplete.');
  });

  it('rejects recruiter authority over a global directive', () => {
    const problems = mutate(fixture(), 'server/candidate-privacy/routes.ts', (source) =>
      source.replace('requireRole(["super_admin"])', 'requireRole(["recruiter"])'),
    );
    expect(problems).toContain('recruiter or organization authority can mint a global privacy action.');
  });

  it('rejects physical talent-pool deletion', () => {
    const problems = mutate(fixture(), 'server/storage.ts', (source) =>
      `${source}\n// mutation canary: db.delete(talentPool)\n`,
    );
    expect(problems.some((problem) => problem.includes('physical talent-pool deletion'))).toBe(true);
  });

  it('rejects a missing feed lifecycle transition', () => {
    const problems = mutate(fixture(), 'server/candidate-privacy/repository.ts', (source) => {
      const start = source.indexOf('export async function applyMemoryChanges');
      const call = source.indexOf('await syncLocalRequestState(', start);
      return `${source.slice(0, call)}await Promise.resolve(${source.slice(call + 'await syncLocalRequestState('.length)}`;
    });
    expect(problems).toContain(
      'Memory feed no longer advances the local privacy request lifecycle atomically.',
    );
  });

  it('rejects a missing snapshot lifecycle transition', () => {
    const problems = mutate(fixture(), 'server/candidate-privacy/repository.ts', (source) => {
      const start = source.indexOf('export async function replaceProjectionFromSnapshot');
      const call = source.indexOf('await syncLocalRequestState(', start);
      return `${source.slice(0, call)}await Promise.resolve(${source.slice(call + 'await syncLocalRequestState('.length)}`;
    });
    expect(problems).toContain(
      'Memory snapshot no longer advances the local privacy request lifecycle atomically.',
    );
  });

  it('rejects a new unclassified candidate-bearing source', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'server/unclassifiedCandidateReader.ts'),
      'export const leak = () => db.query.applications.findMany();\n',
      { mode: 0o600 },
    );
    expect(checkCandidatePrivacySurfaces(root)).toContain(
      'unclassified candidate-bearing source: server/unclassifiedCandidateReader.ts',
    );
  });
});
