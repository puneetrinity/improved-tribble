import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({ pool: {} }));

import {
  CandidatePrivacyConfigurationError,
  loadCandidatePrivacyConfig,
} from '../../candidate-privacy/config';
import { privacyAllowedSql } from '../../candidate-privacy/decision';
import { decisionForRemote } from '../../candidate-privacy/models';

function read(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('candidate privacy contracts', () => {
  it('is disabled by default and enforces every bounded timing control', () => {
    expect(loadCandidatePrivacyConfig({})).toEqual({
      intakeEnabled: false,
      memoryTimeoutMs: 5_000,
      pollMs: 30_000,
      staleMs: 120_000,
      leaseMs: 60_000,
      pageSize: 100,
    });
    expect(() => loadCandidatePrivacyConfig({
      FLOW_CANDIDATE_PRIVACY_HTTP_TIMEOUT_MS: '10001',
    })).toThrow(CandidatePrivacyConfigurationError);
    expect(() => loadCandidatePrivacyConfig({
      FLOW_CANDIDATE_PRIVACY_POLL_MS: '4999',
    })).toThrow(CandidatePrivacyConfigurationError);
    expect(() => loadCandidatePrivacyConfig({
      FLOW_CANDIDATE_PRIVACY_STALE_MS: '300001',
    })).toThrow(CandidatePrivacyConfigurationError);
    expect(() => loadCandidatePrivacyConfig({
      FLOW_CANDIDATE_PRIVACY_PAGE_SIZE: '501',
    })).toThrow(CandidatePrivacyConfigurationError);
  });

  it('maps remote state conservatively and never represents hard purge', () => {
    expect(decisionForRemote('active_quarantine', 'withdraw_global_matching')).toBe('block_global');
    expect(decisionForRemote('active_quarantine', 'request_erasure')).toBe('block_all');
    expect(decisionForRemote('needs_review', 'withdraw_global_matching')).toBe('review');
    expect(read('../../candidate-privacy/models.ts')).not.toContain('hard_purge_eligible');
    expect(read('../../candidate-privacy/routes.ts')).not.toContain('hard_purge_eligible');
  });

  it('builds a correlated SQL predicate for the requested scope', () => {
    const existing = privacyAllowedSql('application', 'applications.id', { globalUse: false });
    const global = privacyAllowedSql('application', 'applications.id', { globalUse: true });
    for (const predicate of [existing, global]) {
      expect(predicate).toContain('candidate_privacy_subject_links');
      expect(predicate).toContain("privacy_link.application_id=applications.id");
      expect(predicate).toContain("'needs_review'");
      expect(predicate).toContain('NOT EXISTS');
    }
    expect(existing).toContain("IN ('block_all','review')");
    expect(global).toContain("IN ('block_global','block_all','review')");
  });

  it('registers exactly the locked six-route delta', () => {
    const privacyRoutes = read('../../candidate-privacy/routes.ts');
    const poolRoutes = read('../../talent-pool.routes.ts');
    const registrations = privacyRoutes.match(/app\.(?:get|post|put|patch|delete)\s*\(/g) ?? [];
    expect(registrations).toHaveLength(5);
    expect(privacyRoutes).toContain('"/api/candidate/privacy/reauth"');
    expect(privacyRoutes).toContain('"/api/candidate/privacy/status"');
    expect(privacyRoutes).toContain('"/api/candidate/privacy/requests"');
    expect(privacyRoutes).toContain('"/api/admin/privacy/requests"');
    expect(privacyRoutes).toContain('"/api/admin/privacy/requests/:requestId"');
    expect(poolRoutes).toContain('"/api/talent-pool/:id/restore"');
  });

  it('keeps intake authority before body-dependent behavior', () => {
    const source = read('../../candidate-privacy/routes.ts');
    const candidate = source.slice(
      source.indexOf('"/api/candidate/privacy/requests"'),
      source.indexOf('"/api/admin/privacy/requests"'),
    );
    expect(candidate.indexOf('requireVerifiedCandidate')).toBeLessThan(candidate.indexOf('candidateRequestSchema.safeParse'));
    expect(candidate.indexOf('requireRecentPrivacyAuth')).toBeLessThan(candidate.indexOf('candidateRequestSchema.safeParse'));
    expect(candidate.indexOf('intakeDisabled')).toBeLessThan(candidate.indexOf('candidateRequestSchema.safeParse'));

    const admin = source.slice(
      source.indexOf('"/api/admin/privacy/requests"'),
      source.indexOf('"/api/admin/privacy/requests/:requestId"'),
    );
    expect(admin.indexOf('requireRole(["super_admin"])')).toBeLessThan(admin.indexOf('operatorRequestSchema.safeParse'));
    expect(admin.indexOf('intakeDisabled')).toBeLessThan(admin.indexOf('operatorRequestSchema.safeParse'));
    expect(admin).not.toMatch(/recruiter|organization_admin/);
  });

  it('keeps outbox bodies transient and Memory failures constant', () => {
    const repository = read('../../candidate-privacy/repository.ts');
    const memoryClient = read('../../candidate-privacy/memory-client.ts');
    const processor = read('../../candidate-privacy/processor.ts');
    expect(repository).toContain('transientIdentifiersForRequest');
    expect(repository).not.toMatch(/INSERT INTO candidate_privacy_outbox[\s\S]{0,220}(?:payload|body|email|phone)/);
    expect(memoryClient).not.toContain('console.');
    expect(memoryClient).not.toContain('response.json()');
    expect(memoryClient).toContain('Buffer.byteLength(body, "utf8") > 256 * 1024');
    expect(processor).toContain('errorType: error instanceof Error ? error.constructor.name');
  });

  it('preserves action separation and removes physical pool deletion', () => {
    const storage = read('../../storage.ts');
    const routes = read('../../talent-pool.routes.ts');
    expect(storage).not.toMatch(/\.(?:delete|remove)\s*\(\s*talentPool\s*\)/);
    expect(storage).toContain('.update(talentPool)');
    expect(storage).toContain('.insert(talentPoolMembershipEvents)');
    expect(routes).toContain('globally deletes or opts the person out');
    expect(routes).not.toContain('createLocalPrivacyRequest');
  });

  it('keeps legal copy truthful and numeric retention claims removed', () => {
    const policy = read('../../../client/src/pages/privacy-policy-page.tsx');
    const terms = read('../../../client/src/pages/terms-of-service-page.tsx');
    expect(policy).toContain('quarantine');
    expect(policy).toContain('Privacy &amp; Data');
    expect(policy).not.toMatch(/2 years|two years|active job.*1 year|active job.*one year/i);
    expect(terms).toContain('organization');
    expect(terms).toContain('global erasure');
  });
});
