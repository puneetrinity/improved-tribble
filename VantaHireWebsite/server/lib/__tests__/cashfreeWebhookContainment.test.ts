// @vitest-environment node
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const webhookFindFirstMock = vi.fn();
const checkoutIntentFindFirstMock = vi.fn();
const insertOnConflictMock = vi.fn();
const insertValuesMock = vi.fn(() => ({ onConflictDoNothing: insertOnConflictMock }));
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
const updateMock = vi.fn();
const selectMock = vi.fn();
const getTransactionByCashfreeOrderMock = vi.fn();
const updatePaymentTransactionMock = vi.fn();
const generateAndStoreInvoicePdfMock = vi.fn();
const createPaidSubscriptionMock = vi.fn();
const updateSubscriptionSeatsMock = vi.fn();
const bulkAllocateCreditsForUpgradeMock = vi.fn();
const addProratedSeatCreditsMock = vi.fn();
const addPurchasedCreditsMock = vi.fn();
const getEmailServiceMock = vi.fn();

vi.mock('../../db', () => ({
  db: {
    query: {
      webhookEvents: { findFirst: webhookFindFirstMock },
      checkoutIntents: { findFirst: checkoutIntentFindFirstMock },
    },
    insert: insertMock,
    update: updateMock,
    select: selectMock,
  },
}));

vi.mock('../invoiceService', () => ({
  updatePaymentTransaction: updatePaymentTransactionMock,
  getTransactionByCashfreeOrder: getTransactionByCashfreeOrderMock,
  generateInvoiceNumber: vi.fn(() => 'INV-TEST'),
}));

vi.mock('../invoicePdfService', () => ({
  generateAndStoreInvoicePdf: generateAndStoreInvoicePdfMock,
}));

vi.mock('../subscriptionService', () => ({
  createPaidSubscription: createPaidSubscriptionMock,
  clearPaymentFailure: vi.fn(),
  recordPaymentFailure: vi.fn(),
  renewSubscription: vi.fn(),
  downgradeToFree: vi.fn(),
  getOrganizationSubscription: vi.fn(),
  updateSubscriptionSeats: updateSubscriptionSeatsMock,
}));

vi.mock('../creditService', () => ({
  addProratedSeatCredits: addProratedSeatCreditsMock,
  addPurchasedCredits: addPurchasedCreditsMock,
  bulkAllocateCreditsForUpgrade: bulkAllocateCreditsForUpgradeMock,
}));

vi.mock('../seatService', () => ({
  executeAutoDowngrade: vi.fn(),
}));

vi.mock('../../simpleEmailService', () => ({
  getEmailService: getEmailServiceMock,
}));

const TEST_SECRET = 'cashfree-containment-test-secret';
const TEST_TIMESTAMP = '1786017600';
const SUCCESS_PAYLOAD = {
  type: 'PAYMENT_SUCCESS_WEBHOOK',
  data: {
    order: { order_id: 'ORD_PENDING_TEST' },
    payment: {
      cf_payment_id: 'PAYMENT_TEST',
      payment_status: 'SUCCESS',
      payment_amount: 1,
    },
  },
};

let registerCashfreeWebhook: typeof import('../../webhooks/cashfree.webhook').registerCashfreeWebhook;
let originalWebhookSecret: string | undefined;

function buildApp(captureRawBody: boolean) {
  const app = express();
  app.use(express.json(captureRawBody
    ? {
        verify: (req: express.Request & { rawBody?: string }, _res, buffer) => {
          req.rawBody = buffer.toString('utf8');
        },
      }
    : undefined));
  registerCashfreeWebhook(app);
  return app;
}

function signatureFor(rawBody: string) {
  return crypto
    .createHmac('sha256', TEST_SECRET)
    .update(TEST_TIMESTAMP + rawBody)
    .digest('base64');
}

function expectNoSideEffects() {
  expect(webhookFindFirstMock).not.toHaveBeenCalled();
  expect(checkoutIntentFindFirstMock).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(selectMock).not.toHaveBeenCalled();
  expect(getTransactionByCashfreeOrderMock).not.toHaveBeenCalled();
  expect(updatePaymentTransactionMock).not.toHaveBeenCalled();
  expect(generateAndStoreInvoicePdfMock).not.toHaveBeenCalled();
  expect(createPaidSubscriptionMock).not.toHaveBeenCalled();
  expect(updateSubscriptionSeatsMock).not.toHaveBeenCalled();
  expect(bulkAllocateCreditsForUpgradeMock).not.toHaveBeenCalled();
  expect(addProratedSeatCreditsMock).not.toHaveBeenCalled();
  expect(addPurchasedCreditsMock).not.toHaveBeenCalled();
  expect(getEmailServiceMock).not.toHaveBeenCalled();
}

beforeAll(async () => {
  originalWebhookSecret = process.env.CASHFREE_WEBHOOK_SECRET;
  process.env.CASHFREE_WEBHOOK_SECRET = TEST_SECRET;
  vi.resetModules();
  ({ registerCashfreeWebhook } = await import('../../webhooks/cashfree.webhook'));
});

afterAll(() => {
  if (originalWebhookSecret === undefined) {
    delete process.env.CASHFREE_WEBHOOK_SECRET;
  } else {
    process.env.CASHFREE_WEBHOOK_SECRET = originalWebhookSecret;
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CASHFREE_WEBHOOK_SECRET = TEST_SECRET;
  webhookFindFirstMock.mockResolvedValue(undefined);
  insertOnConflictMock.mockResolvedValue(undefined);
});

describe('Cashfree webhook containment', () => {
  it('fails closed without configuration before touching a pending order', async () => {
    delete process.env.CASHFREE_WEBHOOK_SECRET;
    const app = buildApp(true);

    const response = await request(app)
      .post('/api/webhooks/cashfree')
      .send(SUCCESS_PAYLOAD);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'Webhook unavailable' });
    expectNoSideEffects();
  });

  it('rejects a parsed request when the authentic raw body is unavailable', async () => {
    const app = buildApp(false);

    const response = await request(app)
      .post('/api/webhooks/cashfree')
      .set('x-webhook-signature', 'unused')
      .set('x-webhook-timestamp', TEST_TIMESTAMP)
      .send(SUCCESS_PAYLOAD);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing raw body' });
    expectNoSideEffects();
  });

  it('rejects missing signature headers before processing', async () => {
    const app = buildApp(true);

    const response = await request(app)
      .post('/api/webhooks/cashfree')
      .send(SUCCESS_PAYLOAD);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Missing signature' });
    expectNoSideEffects();
  });

  it('rejects an invalid signature before processing', async () => {
    const app = buildApp(true);

    const response = await request(app)
      .post('/api/webhooks/cashfree')
      .set('x-webhook-signature', 'malformed')
      .set('x-webhook-timestamp', TEST_TIMESTAMP)
      .send(SUCCESS_PAYLOAD);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Invalid signature' });
    expectNoSideEffects();
  });

  it('processes a correctly signed request over the captured raw body', async () => {
    const app = buildApp(true);
    const rawBody = JSON.stringify({ type: 'UNHANDLED_TEST_EVENT' });

    const response = await request(app)
      .post('/api/webhooks/cashfree')
      .set('content-type', 'application/json')
      .set('x-webhook-signature', signatureFor(rawBody))
      .set('x-webhook-timestamp', TEST_TIMESTAMP)
      .send(rawBody);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(webhookFindFirstMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'cashfree',
      eventType: 'UNHANDLED_TEST_EVENT',
      status: 'skipped',
    }));
    expect(insertOnConflictMock).toHaveBeenCalledTimes(1);
  });

  it('does not register the public order-verification route', async () => {
    const app = buildApp(true);

    const response = await request(app)
      .get('/api/webhooks/cashfree/verify/ORD_PENDING_TEST');

    expect(response.status).toBe(404);
    expectNoSideEffects();
  });
});
