import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), 'utf8');
}

describe('contact safety deployment contracts', () => {
  it('runs only read-only schema readiness before every production process', () => {
    const packageJson = JSON.parse(read('../../../package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['start:web']).toMatch(
      /node dist\/schema-ready\.js && .*node dist\/index\.js/,
    );
    expect(packageJson.scripts?.['start:worker']).toMatch(
      /node dist\/schema-ready\.js && .*node dist\/worker\.js/,
    );
    expect(packageJson.scripts?.['start:ai-worker']).toMatch(
      /node dist\/schema-ready\.js && .*node dist\/aiWorker\.js/,
    );
    for (const command of ['start:web', 'start:worker', 'start:ai-worker']) {
      expect(packageJson.scripts?.[command]).not.toMatch(/dist\/migrate|db:push|db:migrate(?!:release)/);
    }
  });

  it('keeps the hygiene outbox identical across schema and both deploy paths', () => {
    const schemaSource = read('../../../shared/schema.ts');
    const baselineSource = read('../../schema-migrations/0000_baseline.sql');
    const processorSource = read('../outreachHygieneProcessor.ts');

    for (const source of [schemaSource, baselineSource]) {
      expect(source).toContain('outreach_hygiene_intents');
      expect(source).toContain('outreach_delivery_correlations');
      expect(source).toContain('provider_event_id');
      expect(source).toContain('signal_candidate_id');
      expect(source).toContain('memory_global_candidate_id');
    }
    expect(schemaSource).toContain('Snapshot only. No FK');
    expect(baselineSource).not.toContain(
      'outreach_hygiene_intents_source_outreach_log_id_fkey',
    );
    expect(processorSource).toContain('source_outreach_log_id = NULL');
    expect(processorSource).not.toContain('delivery.recipient_email');
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
    const concurrencySource = read('../outreachConcurrency.ts');
    const hygieneProcessorSource = read('../outreachHygieneProcessor.ts');
    const schedulerSource = read('../outreachScheduler.ts');

    expect(deliverySource).toContain('withOutreachDispatchFence(');
    expect(deliverySource).toContain('.insert(outreachDeliveryCorrelations)');
    expect(deliverySource.indexOf('await ensureDeliveryCorrelation({')).toBeLessThan(
      deliverySource.indexOf('sendEmailWithReceipt({'),
    );
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
      'lockCandidateOutreach(tx, correlation.sourcedCandidateId)',
    );
    expect(webhookSource).toContain(
      'lockOutreachEmailHash(tx, correlation.emailHash)',
    );
    expect(webhookSource).toContain('.insert(outreachHygieneIntents)');
    expect(webhookSource).not.toContain('await suppressContactEvidence(');
    expect(concurrencySource).toContain('FROM outreach_hygiene_intents');
    expect(concurrencySource).toContain("reason = 'complaint'");
    expect(concurrencySource).toContain("status <> 'synced'");
    // Both hygiene gates must be person-scoped: a platform-wide condition would
    // let one unsynced complaint stop every send.
    expect(concurrencySource).toContain('signal_candidate_id = $1::text');
    expect(concurrencySource).toContain('signal_candidate_id = $2::text');
    expect(hygieneProcessorSource).toContain('await dependencies.suppress(');
    expect(hygieneProcessorSource).toContain('FOR UPDATE SKIP LOCKED');
    expect(deliverySource).toContain("reason: 'hygiene_sync_pending'");
    expect(schedulerSource).toContain('getSkippedOutreachDisposition(delivery.reason)');
    expect(schedulerSource).toContain(
      'await hasBlockingOutreachHygieneIntent(candidate.signalCandidateId ?? null)',
    );
    expect(applicationSource).toContain(
      'Application persistence and drip cancellation are one commit',
    );
    expect(applicationSource).toContain('executor: tx');
    expect(webhookSource).toContain('const observedSentAt = lockedLog?.sentAt ?? now');
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
