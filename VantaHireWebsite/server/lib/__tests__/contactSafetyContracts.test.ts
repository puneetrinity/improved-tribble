import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('contact safety deployment contracts', () => {
  it('runs the fail-closed schema migrator before every production process', () => {
    const packageJson = JSON.parse(read('../../../package.json')) as {
      scripts?: Record<string, string>;
    };
    const bootstrapSource = read('../../bootstrapSchema.ts');

    expect(packageJson.scripts?.['start:web']).toMatch(
      /node dist\/migrate\.js && .*node dist\/index\.js/,
    );
    expect(packageJson.scripts?.['start:worker']).toMatch(
      /node dist\/migrate\.js && .*node dist\/worker\.js/,
    );
    expect(packageJson.scripts?.['start:ai-worker']).toMatch(
      /node dist\/migrate\.js && .*node dist\/aiWorker\.js/,
    );
    expect(bootstrapSource).toContain('if (bootstrapFailures > 0)');
    expect(bootstrapSource).toContain('transaction rolled back');
  });

  it('revalidates through Signal before manual and scheduled sends', () => {
    const manualSource = read('../../coldOutreach.routes.ts');
    const schedulerSource = read('../outreachScheduler.ts');
    const signalRoutesSource = read('../../signal.routes.ts');

    expect(manualSource).toContain('deliverWithRevalidatedContact({');
    expect(manualSource).not.toContain('waitForEnrichmentCompletion');
    expect(manualSource).not.toMatch(/to:\s*candidate\.foundEmail/);
    expect(schedulerSource).toContain('deliverWithRevalidatedContact({');
    expect(schedulerSource).not.toMatch(/to:\s*candidate\.foundEmail/);
    expect(signalRoutesSource).toMatch(
      /app\.post\('\/api\/candidates\/:candidateId\/find-contact', csrfProtection,/,
    );
  });

  it('claims a scheduled campaign before sending from a replica', () => {
    const schedulerSource = read('../outreachScheduler.ts');

    expect(schedulerSource).toContain(
      '.returning({ id: scheduledOutreachCampaigns.id })',
    );
    expect(schedulerSource).toContain('if (claimed.length === 0)');
  });

  it('keeps a locally observed platform suppression monotonic', () => {
    const processorSource = read('../contactResolutionProcessor.ts');

    expect(processorSource).toContain(
      "email_resolve_status IS DISTINCT FROM 'suppressed'",
    );
  });

  it('fences background contact work to currently shortlisted candidates', () => {
    const processorSource = read('../contactResolutionProcessor.ts');
    const signalRoutesSource = read('../../signal.routes.ts');

    expect(processorSource).toContain("WHERE email_resolve_status = 'pending'\n          AND state = 'shortlisted'");
    expect(
      processorSource.match(/eq\(jobSourcedCandidates\.state, 'shortlisted'\)/g),
    ).toHaveLength(3);
    expect(processorSource).toContain(
      "WHERE id = ${candidateId}\n      AND state = 'shortlisted'",
    );
    expect(signalRoutesSource).toContain(
      "contactTransition.action === 'cancel_pending'",
    );
    expect(signalRoutesSource).toContain('emailResolveLeaseToken: null');
  });
});
