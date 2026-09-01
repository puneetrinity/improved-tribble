// @vitest-environment node
import '../setup.integration';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../../server/routes';
import { db } from '../../server/db';
import {
  organizations,
  organizationInvites,
  organizationSubscriptions,
  paymentTransactions,
  subscriptionAuditLog,
  subscriptionPlans,
  users,
  webhookEvents,
} from '@shared/schema';
import { eq, inArray, gte } from 'drizzle-orm';
import { createPaidSubscription } from '../../server/lib/subscriptionService';
import {
  createOrganizationWithOwner,
  createRecruiterUser,
  ensurePlan,
} from '../utils/db-helpers';

const emailMocks = vi.hoisted(() => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  sendContactNotification: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../server/simpleEmailService', () => ({
  getEmailService: vi.fn(async () => emailMocks),
}));

vi.mock('../../server/lib/invoicePdfService', () => ({
  generateAndStoreInvoicePdf: vi.fn().mockResolvedValue(null),
}));

const HAS_DB = !!process.env.DATABASE_URL;
const maybeDescribe = HAS_DB ? describe : describe.skip;

if (!HAS_DB) {
  console.warn('[TEST] Skipping invite/webhook integration tests: DATABASE_URL not set');
}

maybeDescribe('Invite + Cashfree webhook flows', () => {
  let app: express.Express;
  let server: any;

  const created = {
    userIds: [] as number[],
    orgIds: [] as number[],
    planIds: [] as number[],
    subscriptionIds: [] as number[],
    transactionIds: [] as number[],
    inviteIds: [] as number[],
  };
  let webhookCleanupAfter: Date | null = null;

  beforeAll(async () => {
    process.env.CASHFREE_WEBHOOK_SECRET = '';
    process.env.BASE_URL = 'http://localhost:5000';

    app = express();
    server = await registerRoutes(app);
  });

  afterAll(() => {
    server?.close();
  });

  afterEach(async () => {
    emailMocks.sendEmail.mockClear();
    emailMocks.sendContactNotification.mockClear();

    if (!HAS_DB) return;

    if (created.inviteIds.length > 0) {
      await db.delete(organizationInvites)
        .where(inArray(organizationInvites.id, created.inviteIds));
    }

    if (created.transactionIds.length > 0) {
      await db.delete(paymentTransactions)
        .where(inArray(paymentTransactions.id, created.transactionIds));
    }

    if (created.orgIds.length > 0) {
      await db.delete(subscriptionAuditLog)
        .where(inArray(subscriptionAuditLog.organizationId, created.orgIds));
    }

    if (created.subscriptionIds.length > 0) {
      await db.delete(organizationSubscriptions)
        .where(inArray(organizationSubscriptions.id, created.subscriptionIds));
    }

    if (created.orgIds.length > 0) {
      await db.delete(organizations)
        .where(inArray(organizations.id, created.orgIds));
    }

    if (created.userIds.length > 0) {
      await db.delete(users)
        .where(inArray(users.id, created.userIds));
    }

    if (created.planIds.length > 0) {
      await db.delete(subscriptionPlans)
        .where(inArray(subscriptionPlans.id, created.planIds));
    }

    if (webhookCleanupAfter) {
      await db.delete(webhookEvents)
        .where(gte(webhookEvents.processedAt, webhookCleanupAfter));
    }

    created.userIds = [];
    created.orgIds = [];
    created.planIds = [];
    created.subscriptionIds = [];
    created.transactionIds = [];
    created.inviteIds = [];
    webhookCleanupAfter = null;
  });

  it('sends invite email with accept link', async () => {
    const owner = await createRecruiterUser({
      username: `owner_${Date.now()}@example.com`,
      password: 'password',
    });
    created.userIds.push(owner.id);

    const { plan, created: planCreated } = await ensurePlan(`test_plan_${Date.now()}`);
    if (planCreated) created.planIds.push(plan.id);

    const org = await createOrganizationWithOwner({
      name: `Test Org ${Date.now()}`,
      ownerId: owner.id,
      billingContactEmail: `billing_${Date.now()}@example.com`,
    });
    created.orgIds.push(org.id);

    const subscription = await createPaidSubscription(org.id, plan.id, 2, 'monthly');
    created.subscriptionIds.push(subscription.id);

    const agent = request.agent(app);
    await agent.post('/api/login').send({
      username: owner.username,
      password: 'password',
      expectedRole: ['recruiter'],
    });

    const csrfResponse = await agent.get('/api/csrf-token');
    const csrfToken = csrfResponse.body?.token;

    const inviteEmail = `invite_${Date.now()}@example.com`;
    const inviteResponse = await agent
      .post('/api/organizations/members/invite')
      .set('x-csrf-token', csrfToken)
      .send({ email: inviteEmail, role: 'member' });

    expect(inviteResponse.status).toBe(201);
    expect(inviteResponse.body).not.toHaveProperty('token');
    expect(inviteResponse.body).not.toHaveProperty('version');

    if (inviteResponse.body?.id) {
      created.inviteIds.push(inviteResponse.body.id);
    }

    expect(emailMocks.sendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = emailMocks.sendEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe(inviteEmail.toLowerCase());
    const plaintextToken = String(emailArgs.html).match(/\/recruiter-auth\?invite=([0-9a-f]{64})/)?.[1];
    expect(plaintextToken).toMatch(/^[0-9a-f]{64}$/);
    const persisted = await db.query.organizationInvites.findFirst({
      where: eq(organizationInvites.id, inviteResponse.body.id),
    });
    expect(persisted?.token).toBe(createHash('sha256').update(plaintextToken!).digest('hex'));
    expect(persisted?.state).toBe('pending');
    expect(persisted?.version).toBe(1);
  });

  it('includes invite token in verification email link during registration', async () => {
    const inviteToken = randomBytes(32).toString('hex');
    const email = `register_${Date.now()}@example.com`;

    const response = await request(app)
      .post('/api/register')
      .send({
        username: email,
        password: 'ValidPass1!',
        firstName: 'Invite',
        lastName: 'Tester',
        role: 'recruiter',
        inviteToken,
      });

    expect(response.status).toBe(201);
    expect(emailMocks.sendEmail).toHaveBeenCalledTimes(1);

    const emailArgs = emailMocks.sendEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe(email.toLowerCase());
    expect(emailArgs.html).toContain('/verify-email/');
    expect(emailArgs.html).toContain(`?invite=${inviteToken}`);

    const createdUser = await db.query.users.findFirst({
      where: eq(users.username, email.toLowerCase()),
    });
    if (createdUser) {
      created.userIds.push(createdUser.id);
    }
  });

  it('processes subscription payment webhook and sends billing email', async () => {
    const owner = await createRecruiterUser({
      username: `billing_owner_${Date.now()}@example.com`,
      password: 'password',
    });
    created.userIds.push(owner.id);

    const { plan, created: planCreated } = await ensurePlan(`billing_plan_${Date.now()}`);
    if (planCreated) created.planIds.push(plan.id);

    const org = await createOrganizationWithOwner({
      name: `Billing Org ${Date.now()}`,
      ownerId: owner.id,
      billingContactEmail: `billing_contact_${Date.now()}@example.com`,
      billingContactName: 'Billing Owner',
    });
    created.orgIds.push(org.id);

    const cashfreeOrderId = `order_${Date.now()}`;
    const [transaction] = await db.insert(paymentTransactions).values({
      organizationId: org.id,
      type: 'subscription',
      amount: 99900,
      taxAmount: 0,
      totalAmount: 99900,
      currency: 'INR',
      status: 'pending',
      cashfreeOrderId,
      metadata: {
        planId: plan.id,
        seats: 2,
        billingCycle: 'monthly',
      },
    }).returning();
    created.transactionIds.push(transaction.id);

    webhookCleanupAfter = new Date();

    const webhookResponse = await request(app)
      .post('/api/webhooks/cashfree')
      .send({
        type: 'PAYMENT_SUCCESS_WEBHOOK',
        data: {
          order: {
            order_id: cashfreeOrderId,
            order_amount: 999,
            order_currency: 'INR',
            order_status: 'PAID',
          },
          payment: {
            cf_payment_id: `pay_${Date.now()}`,
            payment_status: 'SUCCESS',
            payment_amount: 999,
            payment_method: { payment_method_type: 'card' },
          },
        },
      });

    expect(webhookResponse.status).toBe(200);

    const updatedTransaction = await db.query.paymentTransactions.findFirst({
      where: eq(paymentTransactions.id, transaction.id),
    });
    expect(updatedTransaction?.status).toBe('completed');
    expect(updatedTransaction?.invoiceNumber).toBeTruthy();

    const subscription = await db.query.organizationSubscriptions.findFirst({
      where: eq(organizationSubscriptions.organizationId, org.id),
    });
    expect(subscription).toBeTruthy();
    if (subscription) {
      created.subscriptionIds.push(subscription.id);
      expect(subscription.planId).toBe(plan.id);
      expect(subscription.seats).toBe(2);
    }

    expect(emailMocks.sendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = emailMocks.sendEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe(org.billingContactEmail?.toLowerCase());
    expect(emailArgs.html).toContain('/org/billing');
  });
});
