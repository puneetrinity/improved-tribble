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
    const deliverySource = read('../outreachDelivery.ts');
    const signalRoutesSource = read('../../signal.routes.ts');

    expect(manualSource).toContain('sendTrackedOutreachEmail({');
    expect(manualSource).not.toContain('waitForEnrichmentCompletion');
    expect(manualSource).not.toMatch(/to:\s*candidate\.foundEmail/);
    expect(schedulerSource).toContain('sendTrackedOutreachEmail({');
    expect(schedulerSource).not.toMatch(/to:\s*candidate\.foundEmail/);
    expect(deliverySource).toContain('deliverWithRevalidatedContact(input.contact');
    expect(deliverySource).toContain('isSuppressed:');
    expect(signalRoutesSource).toMatch(
      /app\.post\('\/api\/candidates\/:candidateId\/find-contact', csrfProtection,/,
    );
  });

  it('claims a scheduled campaign before sending from a replica', () => {
    const schedulerSource = read('../outreachScheduler.ts');

    expect(schedulerSource).toContain(
      '.returning({ id: candidateOutreachSchedules.id })',
    );
    expect(schedulerSource).toContain('if (claimed.length === 0)');
  });

  it('serializes dispatch against applications and hygiene events', () => {
    const deliverySource = read('../outreachDelivery.ts');
    const applicationSource = read('../../applications.routes.ts');
    const unsubscribeSource = read('../../outreachCompliance.routes.ts');
    const webhookSource = read('../../webhooks/brevo.webhook.ts');

    expect(deliverySource).toContain('withOutreachDispatchFence(');
    expect(deliverySource).toContain(
      'const currentContact = await revalidateCandidateContact(input.contact)',
    );
    expect(deliverySource).toContain(
      'hashOutreachEmail(currentEmail) !== hashOutreachEmail(email)',
    );
    expect(applicationSource).toContain('lockCandidateOutreach(tx, sourcedCandidate.id)');
    expect(unsubscribeSource).toContain(
      'lockCandidateOutreach(tx, claims.sourcedCandidateId)',
    );
    expect(unsubscribeSource).toContain(
      'lockOutreachEmailHash(tx, claims.emailHash)',
    );
    expect(webhookSource).toContain(
      'lockCandidateOutreach(tx, log.sourcedCandidateId)',
    );
    expect(webhookSource).toContain(
      'lockOutreachEmailHash(tx, hashOutreachEmail(event.email))',
    );
    expect(applicationSource).toContain(
      'Application persistence and drip cancellation are one commit',
    );
    expect(applicationSource).toContain('executor: tx');
    expect(webhookSource).toContain('const observedSentAt = lockedLog.sentAt ?? now');
    expect(webhookSource).toContain(
      'COALESCE(${sourcedCandidateOutreachLog.sentAt}, ${observedSentAt})',
    );
    expect(webhookSource).toContain('const eventPrecedesRecordedDelivery = Boolean(');
    expect(webhookSource).toContain("WHEN ${eventType} = 'hard_bounce'");
  });

  it('keeps unsubscribe scanner-safe and follow-ups automatic', () => {
    const unsubscribeSource = read('../../outreachCompliance.routes.ts');
    const manualSource = read('../../coldOutreach.routes.ts');

    const getHandler = unsubscribeSource.slice(
      unsubscribeSource.indexOf("app.get('/api/outreach/unsubscribe'"),
      unsubscribeSource.indexOf("app.post('/api/outreach/unsubscribe'"),
    );
    expect(getHandler).not.toContain('suppressOrgEmail({');
    expect(unsubscribeSource).toContain('<form method="post"');
    expect(manualSource).toContain('if (campaignRound !== 1)');
    expect(manualSource).toContain(
      'Follow-up rounds are sent automatically after 3 days',
    );
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
