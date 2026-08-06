import { Router } from "express";
import type { Express, Request, Response } from "express";
import { db } from "../db";
import { webhookEvents, organizationSubscriptions, organizations, organizationMembers, users, checkoutIntents, type WebhookStatus } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import {
  verifyWebhookSignature,
  parseWebhookEvent,
  type CashfreeWebhookPayload,
} from "../lib/cashfreeClient";
import {
  updatePaymentTransaction,
  getTransactionByCashfreeOrder,
  generateInvoiceNumber,
} from "../lib/invoiceService";
import { generateAndStoreInvoicePdf } from "../lib/invoicePdfService";
import {
  createPaidSubscription,
  clearPaymentFailure,
  recordPaymentFailure,
  renewSubscription,
  downgradeToFree,
  getOrganizationSubscription,
  updateSubscriptionSeats,
} from "../lib/subscriptionService";
import { addProratedSeatCredits, addPurchasedCredits, bulkAllocateCreditsForUpgrade } from "../lib/creditService";
import { executeAutoDowngrade } from "../lib/seatService";
import { getEmailService } from "../simpleEmailService";

async function getOrganizationBillingContact(orgId: number): Promise<{
  organizationName: string;
  billingEmail: string | null;
  billingName: string | null;
} | null> {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
  });

  if (!org) {
    return null;
  }

  let billingEmail = org.billingContactEmail || null;
  let billingName = org.billingContactName || null;

  if (!billingEmail) {
    const owner = await db
      .select({
        email: users.username,
        firstName: users.firstName,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(
        and(
          eq(organizationMembers.organizationId, orgId),
          eq(organizationMembers.role, 'owner')
        )
      )
      .limit(1);

    if (owner.length > 0) {
      billingEmail = owner[0].email;
      billingName = billingName || owner[0].firstName || null;
    }
  }

  return {
    organizationName: org.name,
    billingEmail,
    billingName,
  };
}

// Check if webhook event has already been processed
async function isEventProcessed(provider: string, eventId: string): Promise<boolean> {
  const existing = await db.query.webhookEvents.findFirst({
    where: and(
      eq(webhookEvents.provider, provider),
      eq(webhookEvents.eventId, eventId)
    ),
  });
  return !!existing;
}

// Record webhook event
async function recordWebhookEvent(
  provider: string,
  eventId: string,
  eventType: string,
  payload: any,
  status: WebhookStatus,
  errorMessage?: string
): Promise<void> {
  await db.insert(webhookEvents).values({
    provider,
    eventId,
    eventType,
    payload,
    status,
    errorMessage,
  }).onConflictDoNothing();
}

// Handle successful payment
async function handlePaymentSuccess(
  orderId: string,
  paymentId: string,
  paymentAmount: number,
  paymentMethod: string
): Promise<void> {
  console.log(`[Webhook] handlePaymentSuccess called: orderId=${orderId}, paymentId=${paymentId}, amount=${paymentAmount}`);

  // Get transaction
  const transaction = await getTransactionByCashfreeOrder(orderId);
  console.log(`[Webhook] Transaction lookup result: ${transaction ? `id=${transaction.id}, type=${transaction.type}, status=${transaction.status}, orgId=${transaction.organizationId}` : 'NOT FOUND'}`);

  // If no transaction, check if this is a public checkout intent (no transaction created)
  if (!transaction) {
    // Check for checkout intent by orderId
    const intent = await db.query.checkoutIntents.findFirst({
      where: eq(checkoutIntents.cashfreeOrderId, orderId),
    });

    if (intent) {
      console.log(`No transaction for order ${orderId}, but found checkout intent ${intent.id}`);
      await handleCheckoutIntentPayment(intent.id, paymentId, paymentAmount);
      return;
    }

    console.error(`Transaction not found for order ${orderId}`);
    return;
  }

  // Skip if already completed
  if (transaction.status === 'completed') {
    console.log(`Transaction ${transaction.id} already completed, skipping`);
    return;
  }

  // Generate invoice number (but don't mark completed yet - do that AFTER subscription is created)
  const invoiceNumber = generateInvoiceNumber(transaction.organizationId);

  // If subscription type, activate subscription FIRST (before marking transaction completed)
  if (transaction.type === 'subscription') {
    const metadata = transaction.metadata as {
      planId: number;
      seats: number;
      billingCycle: 'monthly' | 'annual';
      checkoutIntentId?: number;
    };
    console.log(`[Webhook] Processing subscription transaction: id=${transaction.id}, orgId=${transaction.organizationId}, metadata=${JSON.stringify(metadata)}`);

    // Handle checkout intent flow (public checkout)
    if (metadata?.checkoutIntentId) {
      await handleCheckoutIntentPayment(metadata.checkoutIntentId, paymentId, paymentAmount);
    } else if (metadata?.planId && metadata?.seats) {
      // Create paid subscription
      console.log(`[Webhook] Creating subscription: orgId=${transaction.organizationId}, planId=${metadata.planId}, seats=${metadata.seats}, billingCycle=${metadata.billingCycle}`);
      try {
        const newSub = await createPaidSubscription(
          transaction.organizationId,
          metadata.planId,
          metadata.seats,
          metadata.billingCycle
        );
        console.log(`[Webhook] Subscription created: id=${newSub.id}, planId=${newSub.planId}, status=${newSub.status}`);
      } catch (subError: any) {
        console.error(`[Webhook] FAILED to create subscription for org ${transaction.organizationId}:`, subError.message);
        throw subError;
      }

      // Allocate credits to all members
      const subscription = await getOrganizationSubscription(transaction.organizationId);
      console.log(`[Webhook] Fetched subscription after create: ${subscription ? `id=${subscription.id}, plan=${subscription.plan.name}` : 'NULL'}`);
      if (subscription) {
        const creditsPerSeat = subscription.plan.aiCreditsPerSeatMonthly;
        const maxRollover = subscription.plan.maxCreditRolloverMonths || 3;
        const includedCredits = creditsPerSeat * Math.max(1, subscription.seats || 1);
        const cap = includedCredits * maxRollover;

        await bulkAllocateCreditsForUpgrade(
          transaction.organizationId,
          includedCredits,
          cap
        );

        const emailService = await getEmailService();
        if (emailService) {
          const contact = await getOrganizationBillingContact(transaction.organizationId);
          if (contact?.billingEmail) {
            const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
            const subject = `Subscription activated - ${contact.organizationName}`;
            const html = `
              <h2>Subscription Activated</h2>
              <p>Hello${contact.billingName ? ` ${contact.billingName}` : ''},</p>
              <p>Your <strong>${subscription.plan.displayName}</strong> subscription is now active.</p>
              <ul>
                <li><strong>Seats:</strong> ${subscription.seats}</li>
                <li><strong>Billing Cycle:</strong> ${subscription.billingCycle}</li>
                <li><strong>Amount Paid:</strong> ₹${(paymentAmount / 100).toFixed(2)}</li>
              </ul>
              <p>You can manage billing here: <a href="${baseUrl}/org/billing">${baseUrl}/org/billing</a></p>
            `;
            const text = `Subscription activated for ${contact.organizationName}.\nPlan: ${subscription.plan.displayName}\nSeats: ${subscription.seats}\nBilling cycle: ${subscription.billingCycle}\nAmount paid: ₹${(paymentAmount / 100).toFixed(2)}\n\nManage billing: ${baseUrl}/org/billing`;
            await emailService.sendEmail({
              to: contact.billingEmail,
              subject,
              html,
              text,
            });
          }
        }
      }
    } else {
      throw new Error('Missing subscription metadata for payment');
    }
  }

  // If seat addition, update seats
  if (transaction.type === 'seat_addition') {
    const metadata = transaction.metadata as {
      additionalSeats?: number;
      proratedAmount?: number;
      proratedCredits?: number;
      creditPeriodStart?: string;
      creditPeriodEnd?: string;
    } | null;
    const subscription = await getOrganizationSubscription(transaction.organizationId);

    if (!subscription) {
      throw new Error(`Subscription not found for org ${transaction.organizationId}`);
    }

    if (!metadata?.additionalSeats) {
      throw new Error('Missing seat addition metadata for payment');
    }

    // Calculate new seat count and update subscription
    const newSeats = subscription.seats + metadata.additionalSeats;
    await updateSubscriptionSeats(subscription.id, newSeats);
    if (metadata.proratedCredits && metadata.proratedCredits > 0) {
      await addProratedSeatCredits(
        transaction.organizationId,
        metadata.proratedCredits,
        {
          reason: "seat_add_proration",
          additionalSeats: metadata.additionalSeats,
          cashfreeOrderId: transaction.cashfreeOrderId,
          creditPeriodStart: metadata.creditPeriodStart,
          creditPeriodEnd: metadata.creditPeriodEnd,
        },
      );
    }

    console.log(`Seat addition completed: org ${transaction.organizationId} now has ${newSeats} seats (+${metadata.additionalSeats})`);

    const emailService = await getEmailService();
    if (emailService) {
      const contact = await getOrganizationBillingContact(transaction.organizationId);
      if (contact?.billingEmail) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        const subject = `Seats added - ${contact.organizationName}`;
        const html = `
            <h2>Seats Added</h2>
            <p>Hello${contact.billingName ? ` ${contact.billingName}` : ''},</p>
            <p>${metadata.additionalSeats} seat(s) were added to your subscription.</p>
            <ul>
              <li><strong>New total seats:</strong> ${newSeats}</li>
              <li><strong>Included AI credits added now:</strong> ${metadata.proratedCredits || 0}</li>
              <li><strong>Amount Paid:</strong> ₹${(paymentAmount / 100).toFixed(2)}</li>
            </ul>
            <p>Manage billing here: <a href="${baseUrl}/org/billing">${baseUrl}/org/billing</a></p>
          `;
        const text = `Seats added for ${contact.organizationName}.\nAdded seats: ${metadata.additionalSeats}\nNew total seats: ${newSeats}\nIncluded AI credits added now: ${metadata.proratedCredits || 0}\nAmount paid: ₹${(paymentAmount / 100).toFixed(2)}\n\nManage billing: ${baseUrl}/org/billing`;
        await emailService.sendEmail({
          to: contact.billingEmail,
          subject,
          html,
          text,
        });
      }
    }
  }

  if (transaction.type === 'credit_pack') {
    const metadata = transaction.metadata as { quantity?: number; credits?: number } | null;

    if (!metadata?.quantity || !metadata?.credits) {
      throw new Error('Missing credit pack metadata for payment');
    }

    await addPurchasedCredits(
      transaction.organizationId,
      metadata.credits,
      `credit_pack:${metadata.quantity}`,
    );

    const emailService = await getEmailService();
    if (emailService) {
      const contact = await getOrganizationBillingContact(transaction.organizationId);
      if (contact?.billingEmail) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        const subject = `Extra AI credits added - ${contact.organizationName}`;
        const html = `
          <h2>Extra AI Credits Added</h2>
          <p>Hello${contact.billingName ? ` ${contact.billingName}` : ''},</p>
          <p>Your organization now has <strong>${metadata.credits}</strong> additional AI credits available.</p>
          <ul>
            <li><strong>Packs purchased:</strong> ${metadata.quantity}</li>
            <li><strong>Credits added:</strong> ${metadata.credits}</li>
            <li><strong>Amount Paid:</strong> ₹${(paymentAmount / 100).toFixed(2)}</li>
          </ul>
          <p>Manage billing here: <a href="${baseUrl}/org/billing">${baseUrl}/org/billing</a></p>
        `;
        const text = `Extra AI credits added for ${contact.organizationName}.\nPacks purchased: ${metadata.quantity}\nCredits added: ${metadata.credits}\nAmount paid: ₹${(paymentAmount / 100).toFixed(2)}\n\nManage billing: ${baseUrl}/org/billing`;
        await emailService.sendEmail({
          to: contact.billingEmail,
          subject,
          html,
          text,
        });
      }
    }
  }

  // NOW mark transaction as completed (after subscription/seats are created successfully)
  await updatePaymentTransaction(transaction.id, {
    status: 'completed',
    cashfreePaymentId: paymentId,
    cashfreePaymentMethod: paymentMethod,
    invoiceNumber,
    completedAt: new Date(),
  });

  // Generate invoice PDF asynchronously (don't block the webhook)
  generateAndStoreInvoicePdf(transaction.id).catch(err => {
    console.error(`Failed to generate invoice PDF for transaction ${transaction.id}:`, err);
  });

  console.log(`Payment success processed for order ${orderId}`);
}

// Handle checkout intent payment (public checkout flow)
async function handleCheckoutIntentPayment(
  intentId: number,
  paymentId: string,
  paymentAmount: number
): Promise<void> {
  // Get checkout intent
  const intent = await db.query.checkoutIntents.findFirst({
    where: eq(checkoutIntents.id, intentId),
    with: {
      plan: true,
    },
  });

  if (!intent) {
    console.error(`Checkout intent not found: ${intentId}`);
    return;
  }

  if (intent.status === 'paid' || intent.status === 'claimed') {
    console.log(`Checkout intent ${intentId} already processed, skipping`);
    return;
  }

  // Update intent to paid
  await db.update(checkoutIntents)
    .set({
      status: 'paid',
      paidAt: new Date(),
    })
    .where(eq(checkoutIntents.id, intentId));

  // If org already exists (checkout-create-org flow), create subscription
  if (intent.organizationId) {
    await createPaidSubscription(
      intent.organizationId,
      intent.planId,
      intent.seats,
      intent.billingCycle as 'monthly' | 'annual'
    );

    // Allocate credits
    const subscription = await getOrganizationSubscription(intent.organizationId);
    if (subscription) {
      const creditsPerSeat = subscription.plan.aiCreditsPerSeatMonthly;
      const maxRollover = subscription.plan.maxCreditRolloverMonths || 3;
      const includedCredits = creditsPerSeat * Math.max(1, subscription.seats || 1);
      const cap = includedCredits * maxRollover;

      await bulkAllocateCreditsForUpgrade(
        intent.organizationId,
        includedCredits,
        cap
      );
    }

    console.log(`Checkout intent ${intentId} completed for existing org ${intent.organizationId}`);
    return;
  }

  // For public checkout (no org yet), send claim email
  const emailService = await getEmailService();
  if (emailService && intent.claimToken) {
    const baseUrl = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:5000';
    const claimUrl = `${baseUrl}/claim/${intent.claimToken}`;
    const subject = `Complete your VantaHire subscription`;
    const html = `
      <h2>Payment Successful!</h2>
      <p>Thank you for subscribing to VantaHire!</p>
      <p>Your payment of ₹${(paymentAmount / 100).toFixed(2)} has been received.</p>
      <p><strong>Organization Name:</strong> ${intent.orgName}</p>
      <p><strong>Plan:</strong> ${intent.plan?.displayName || 'Growth'}</p>
      <p><strong>Seats:</strong> ${intent.seats}</p>
      <h3>Next Steps</h3>
      <p>Click the button below to set up your account and access your organization:</p>
      <p style="margin: 20px 0;">
        <a href="${claimUrl}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          Complete Setup
        </a>
      </p>
      <p>Or copy this link: ${claimUrl}</p>
      <p><em>This link will expire in 7 days.</em></p>
    `;
    const text = `Payment Successful!\n\nThank you for subscribing to VantaHire.\nYour payment of ₹${(paymentAmount / 100).toFixed(2)} has been received.\n\nOrganization: ${intent.orgName}\nPlan: ${intent.plan?.displayName || 'Growth'}\nSeats: ${intent.seats}\n\nComplete your setup: ${claimUrl}\n\nThis link will expire in 7 days.`;

    await emailService.sendEmail({
      to: intent.email,
      subject,
      html,
      text,
    });

    console.log(`Claim email sent to ${intent.email} for checkout intent ${intentId}`);
  }

  console.log(`Checkout intent ${intentId} paid, awaiting claim`);
}

// Handle payment failure
async function handlePaymentFailure(
  orderId: string,
  failureReason?: string
): Promise<void> {
  const transaction = await getTransactionByCashfreeOrder(orderId);
  if (!transaction) {
    console.error(`Transaction not found for order ${orderId}`);
    return;
  }

  // Update transaction
  const updateData: { status: 'failed'; failureReason?: string } = {
    status: 'failed',
  };
  if (failureReason) {
    updateData.failureReason = failureReason;
  }
  await updatePaymentTransaction(transaction.id, updateData);

  // Record payment failure for subscription
  if (transaction.subscriptionId) {
    const updated = await recordPaymentFailure(transaction.subscriptionId);

    const emailService = await getEmailService();
    if (emailService) {
      const contact = await getOrganizationBillingContact(transaction.organizationId);
      if (contact?.billingEmail) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        const graceEnd = updated.gracePeriodEndDate
          ? new Date(updated.gracePeriodEndDate).toLocaleDateString()
          : 'in 3 days';
        const subject = `Payment failed - ${contact.organizationName}`;
        const html = `
          <h2>Payment Failed</h2>
          <p>Hello${contact.billingName ? ` ${contact.billingName}` : ''},</p>
          <p>We couldn't process your subscription payment for <strong>${contact.organizationName}</strong>.</p>
          <p>Your grace period ends on <strong>${graceEnd}</strong>.</p>
          <p>Please complete a new payment from billing to avoid a downgrade.</p>
          <p>Manage billing here: <a href="${baseUrl}/org/billing">${baseUrl}/org/billing</a></p>
          ${failureReason ? `<p>Reason: ${failureReason}</p>` : ''}
        `;
        const text = `Payment failed for ${contact.organizationName}. Grace period ends on ${graceEnd}. Complete a new payment from billing to avoid downgrade.\n\nManage billing: ${baseUrl}/org/billing${failureReason ? `\nReason: ${failureReason}` : ''}`;
        await emailService.sendEmail({
          to: contact.billingEmail,
          subject,
          html,
          text,
        });
      }
    }

    console.log(`Payment failure recorded for subscription ${transaction.subscriptionId}`);
  }
}

// Handle paid-term extension from a provider-side renewal event
async function handleSubscriptionRenewal(
  subscriptionId: string,
  status: string
): Promise<void> {
  // Find subscription by Cashfree ID
  const subscription = await db.query.organizationSubscriptions.findFirst({
    where: eq(organizationSubscriptions.cashfreeSubscriptionId, subscriptionId),
  });

  if (!subscription) {
    console.error(`Subscription not found for Cashfree ID ${subscriptionId}`);
    return;
  }

  if (status === 'ACTIVE') {
    const renewed = await renewSubscription(subscription.id);
    await clearPaymentFailure(subscription.id);
    console.log(`Subscription ${subscription.id} paid term extended`);

    const emailService = await getEmailService();
    if (emailService) {
      const contact = await getOrganizationBillingContact(subscription.organizationId);
      if (contact?.billingEmail) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        const renewalDate = renewed.currentPeriodEnd
          ? new Date(renewed.currentPeriodEnd).toLocaleDateString()
          : '';
        const subject = `Paid term extended - ${contact.organizationName}`;
        const html = `
          <h2>Paid Term Extended</h2>
          <p>Hello${contact.billingName ? ` ${contact.billingName}` : ''},</p>
          <p>Your paid term for <strong>${contact.organizationName}</strong> has been extended.</p>
          ${renewalDate ? `<p>Next paid term end date: ${renewalDate}</p>` : ''}
          <p>Manage billing here: <a href="${baseUrl}/org/billing">${baseUrl}/org/billing</a></p>
        `;
        const text = `Paid term extended for ${contact.organizationName}.${renewalDate ? ` Next paid term end date: ${renewalDate}.` : ''}\n\nManage billing: ${baseUrl}/org/billing`;
        await emailService.sendEmail({
          to: contact.billingEmail,
          subject,
          html,
          text,
        });
      }
    }
  } else if (status === 'PAST_DUE' || status === 'CANCELLED') {
    const updated = await recordPaymentFailure(subscription.id);
    console.log(`Subscription ${subscription.id} payment issue: ${status}`);

    const emailService = await getEmailService();
    if (emailService) {
      const contact = await getOrganizationBillingContact(subscription.organizationId);
      if (contact?.billingEmail) {
        const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
        const graceEnd = updated.gracePeriodEndDate
          ? new Date(updated.gracePeriodEndDate).toLocaleDateString()
          : 'in 3 days';
        const subject = `Payment issue - ${contact.organizationName}`;
        const html = `
          <h2>Payment Issue</h2>
          <p>Hello${contact.billingName ? ` ${contact.billingName}` : ''},</p>
          <p>We couldn't process the next paid term for <strong>${contact.organizationName}</strong>.</p>
          <p>Your grace period ends on <strong>${graceEnd}</strong>.</p>
          <p>Please complete a new payment from billing to avoid a downgrade.</p>
          <p>Manage billing here: <a href="${baseUrl}/org/billing">${baseUrl}/org/billing</a></p>
        `;
        const text = `Payment issue for ${contact.organizationName}. Grace period ends on ${graceEnd}. Complete a new payment from billing to avoid downgrade.\n\nManage billing: ${baseUrl}/org/billing`;
        await emailService.sendEmail({
          to: contact.billingEmail,
          subject,
          html,
          text,
        });
      }
    }
  }
}

export function registerCashfreeWebhook(app: Express) {
  // Cashfree webhook endpoint (no CSRF, raw body needed for signature verification)
  app.post("/api/webhooks/cashfree", async (req: Request & { rawBody?: string }, res: Response) => {
    try {
      if (!process.env.CASHFREE_WEBHOOK_SECRET) {
        console.error('Cashfree webhook secret is not configured');
        res.status(503).json({ error: 'Webhook unavailable' });
        return;
      }

      const rawBody = req.rawBody;
      if (!rawBody) {
        console.error('Missing raw webhook body');
        res.status(400).json({ error: 'Missing raw body' });
        return;
      }

      const signature = req.headers['x-webhook-signature'] as string;
      const timestamp = req.headers['x-webhook-timestamp'] as string;

      if (!signature || !timestamp) {
        console.error('Missing webhook signature headers');
        res.status(400).json({ error: 'Missing signature' });
        return;
      }

      let isValid = false;
      try {
        isValid = verifyWebhookSignature(rawBody, signature, timestamp);
      } catch {
        // Malformed signatures can make timingSafeEqual throw on unequal buffer lengths.
      }
      if (!isValid) {
        console.error('Invalid webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const payload = req.body as CashfreeWebhookPayload;

      // Log the raw payload for debugging
      console.log('Cashfree webhook raw payload:', JSON.stringify(payload, null, 2));

      const event = parseWebhookEvent(payload);

      console.log(`Received Cashfree webhook: ${event.eventType}`, {
        eventId: event.eventId,
        orderId: event.orderId,
        paymentStatus: event.paymentStatus,
      });

      // Check idempotency - skip if already processed
      if (await isEventProcessed('cashfree', event.eventId)) {
        console.log(`Webhook event ${event.eventId} already processed, skipping`);
        res.json({ success: true, message: 'Already processed' });
        return;
      }

      // Process based on event type
      let status: WebhookStatus = 'processed';
      let errorMessage: string | undefined;

      try {
        switch (event.eventType) {
          case 'PAYMENT_SUCCESS_WEBHOOK':
          case 'PAYMENT_CAPTURED':
            if (event.orderId && event.paymentId) {
              await handlePaymentSuccess(
                event.orderId,
                event.paymentId,
                event.paymentAmount || 0,
                event.paymentMethod || 'unknown'
              );
            }
            break;

          case 'PAYMENT_FAILED_WEBHOOK':
          case 'PAYMENT_DECLINED':
          case 'PAYMENT_USER_DROPPED':
            if (event.orderId) {
              await handlePaymentFailure(event.orderId, event.errorReason || event.paymentStatus);
            }
            break;

          case 'SUBSCRIPTION_STATUS_CHANGED':
            if (event.subscriptionId && event.subscriptionStatus) {
              await handleSubscriptionRenewal(event.subscriptionId, event.subscriptionStatus);
            }
            break;

          default:
            console.log(`Unhandled webhook event type: ${event.eventType}`);
            status = 'skipped';
        }
      } catch (processingError: any) {
        console.error(`Error processing webhook ${event.eventId}:`, processingError);
        status = 'failed';
        errorMessage = processingError.message;
      }

      // Record the webhook event
      await recordWebhookEvent(
        'cashfree',
        event.eventId,
        event.eventType,
        payload,
        status,
        errorMessage
      );

      res.json({ success: true });
    } catch (error: any) {
      console.error('Webhook processing error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });
}
