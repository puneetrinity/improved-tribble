import { db } from "../db";
import {
  paymentTransactions,
  organizations,
  organizationSubscriptions,
  subscriptionPlans,
  type PaymentTransaction,
  type Organization,
  type PaymentTransactionType,
  type PaymentStatus,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

// Company details for invoices
const COMPANY_LEGAL_NAME = process.env.COMPANY_LEGAL_NAME || 'Ealana Platforms Private Limited';
const COMPANY_GSTIN = process.env.COMPANY_GSTIN || '';
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || '';
const COMPANY_STATE = process.env.COMPANY_STATE || 'Maharashtra';
const GST_RATE = parseInt(process.env.GST_RATE || '0', 10);

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number; // in paise
  amount: number; // in paise
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;

  // Seller info
  sellerName: string;
  sellerGstin: string;
  sellerAddress: string;
  sellerState: string;

  // Buyer info
  buyerName: string;
  buyerGstin: string | null;
  buyerAddress: string | null;
  buyerState: string | null;

  // Line items
  lineItems: InvoiceLineItem[];

  // Totals
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  totalAmount: number;

  // Payment info
  paymentMethod: string | null;
  paymentId: string | null;
  transactionId: number;
  notes: string[];
}

// Generate invoice number
export function generateInvoiceNumber(orgId: number): string {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const timestamp = Date.now().toString().slice(-6);

  return `INV-${year}${month}-${orgId}-${timestamp}`;
}

// Determine GST type (CGST+SGST or IGST)
function calculateGST(
  amount: number,
  buyerState: string | null
): { cgst: number; sgst: number; igst: number } {
  if (GST_RATE <= 0) {
    return {
      cgst: 0,
      sgst: 0,
      igst: 0,
    };
  }

  const gstAmount = Math.round(amount * GST_RATE / 100);

  // If buyer is in same state as seller, split into CGST + SGST
  // Otherwise, charge IGST
  if (buyerState && buyerState.toLowerCase() === COMPANY_STATE.toLowerCase()) {
    const halfGst = Math.round(gstAmount / 2);
    return {
      cgst: halfGst,
      sgst: gstAmount - halfGst, // Handle rounding
      igst: 0,
    };
  }

  return {
    cgst: 0,
    sgst: 0,
    igst: gstAmount,
  };
}

// Create payment transaction
export async function createPaymentTransaction(
  organizationId: number,
  subscriptionId: number | null,
  type: PaymentTransactionType,
  amount: number,
  taxAmount: number,
  totalAmount: number,
  status: PaymentStatus,
  cashfreeOrderId?: string,
  metadata?: Record<string, any>
): Promise<PaymentTransaction> {
  const invoiceNumber = status === 'completed' ? generateInvoiceNumber(organizationId) : null;

  const [transaction] = await db.insert(paymentTransactions).values({
    organizationId,
    subscriptionId,
    type,
    amount,
    taxAmount,
    totalAmount,
    status,
    cashfreeOrderId,
    invoiceNumber,
    metadata,
    completedAt: status === 'completed' ? new Date() : null,
  }).returning();

  return transaction;
}

// Update payment transaction
export async function updatePaymentTransaction(
  transactionId: number,
  updates: Partial<{
    status: PaymentStatus;
    cashfreePaymentId: string;
    cashfreePaymentMethod: string;
    failureReason: string;
    invoiceNumber: string;
    invoiceUrl: string;
    completedAt: Date;
  }>
): Promise<PaymentTransaction> {
  const [updated] = await db.update(paymentTransactions)
    .set(updates)
    .where(eq(paymentTransactions.id, transactionId))
    .returning();

  return updated;
}

// Get transaction by Cashfree order ID
export async function getTransactionByCashfreeOrder(
  orderId: string
): Promise<PaymentTransaction | undefined> {
  return db.query.paymentTransactions.findFirst({
    where: eq(paymentTransactions.cashfreeOrderId, orderId),
  });
}

// Generate invoice data for a completed transaction
export async function generateInvoiceData(transactionId: number): Promise<InvoiceData | null> {
  const transaction = await db.query.paymentTransactions.findFirst({
    where: eq(paymentTransactions.id, transactionId),
    with: {
      organization: true,
      subscription: {
        with: {
          plan: true,
        },
      },
    },
  });

  if (!transaction || transaction.status !== 'completed') {
    return null;
  }

  const org = transaction.organization as Organization;
  const subscription = transaction.subscription;
  const plan = subscription?.plan;

  // Determine line item description
  let description = 'Subscription';
  let quantity = 1;
  let unitPrice = transaction.amount;
  if (plan) {
    description = `${plan.displayName} Plan - ${subscription?.seats || 1} seat(s)`;
    if (subscription?.billingCycle === 'annual') {
      description += ' (Annual)';
    } else {
      description += ' (Monthly)';
    }
  }

  if (transaction.type === 'seat_addition') {
    const seats = (transaction.metadata as any)?.additionalSeats || 1;
    const proratedCredits = (transaction.metadata as any)?.proratedCredits || 0;
    description = `Additional seats - ${seats} seat(s) (Prorated)`;
    if (proratedCredits > 0) {
      description += ` (+${proratedCredits} included AI credits this cycle)`;
    }
  }

  const notes: string[] = [];
  if (transaction.type === 'credit_pack') {
    const packQuantity = (transaction.metadata as any)?.quantity || 1;
    const credits = (transaction.metadata as any)?.credits || 0;
    description = `Extra AI credit packs - ${packQuantity} pack(s) (${credits} credits added)`;
    quantity = packQuantity;
    unitPrice = Math.round(transaction.amount / packQuantity);
    notes.push(`${credits} purchased AI credits were added to the shared organization credit pool.`);
    notes.push(`Included monthly credits are consumed before purchased credits.`);
  }

  if (transaction.type === 'seat_addition') {
    const proratedCredits = (transaction.metadata as any)?.proratedCredits || 0;
    if (proratedCredits > 0) {
      notes.push(`${proratedCredits} prorated included AI credits were added to the shared organization pool for the current monthly credit cycle.`);
    }
    notes.push(`Future monthly credit allocations will use the new paid seat count.`);
  }

  const lineItems: InvoiceLineItem[] = [{
    description,
    quantity,
    unitPrice,
    amount: transaction.amount,
  }];

  // Calculate GST
  const gst = calculateGST(transaction.amount, org.billingState);

  const invoiceDate = transaction.completedAt || new Date();
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + 30);

  return {
    invoiceNumber: transaction.invoiceNumber || generateInvoiceNumber(org.id),
    invoiceDate,
    dueDate,

    sellerName: COMPANY_LEGAL_NAME,
    sellerGstin: COMPANY_GSTIN,
    sellerAddress: COMPANY_ADDRESS,
    sellerState: COMPANY_STATE,

    buyerName: org.billingName || org.name,
    buyerGstin: org.gstin,
    buyerAddress: org.billingAddress
      ? `${org.billingAddress}, ${org.billingCity}, ${org.billingState} - ${org.billingPincode}`
      : null,
    buyerState: org.billingState,

    lineItems,

    subtotal: transaction.amount,
    cgst: gst.cgst,
    sgst: gst.sgst,
    igst: gst.igst,
    cgstRate: GST_RATE > 0 ? GST_RATE / 2 : 0,
    sgstRate: GST_RATE > 0 ? GST_RATE / 2 : 0,
    igstRate: GST_RATE,
    totalAmount: transaction.totalAmount,

    paymentMethod: transaction.cashfreePaymentMethod,
    paymentId: transaction.cashfreePaymentId,
    transactionId: transaction.id,
    notes,
  };
}

// Get organization invoices
export async function getOrganizationInvoices(
  orgId: number,
  limit: number = 20
): Promise<PaymentTransaction[]> {
  return db.query.paymentTransactions.findMany({
    where: and(
      eq(paymentTransactions.organizationId, orgId),
      eq(paymentTransactions.status, 'completed')
    ),
    orderBy: desc(paymentTransactions.completedAt),
    limit,
  });
}

// Get all transactions for organization (including pending/failed)
export async function getOrganizationTransactions(
  orgId: number,
  limit: number = 50
): Promise<PaymentTransaction[]> {
  return db.query.paymentTransactions.findMany({
    where: eq(paymentTransactions.organizationId, orgId),
    orderBy: desc(paymentTransactions.createdAt),
    limit,
  });
}

// Format amount for display (paise to rupees)
export function formatAmount(amountInPaise: number): string {
  return `₹${(amountInPaise / 100).toFixed(2)}`;
}

// Calculate prorated amount for mid-cycle changes
export function calculateProratedAmount(
  pricePerUnit: number,
  units: number,
  daysRemaining: number,
  totalDays: number
): number {
  const dailyRate = (pricePerUnit * units) / totalDays;
  return Math.round(dailyRate * daysRemaining);
}

// Get monthly recurring revenue (MRR) for admin analytics
// Uses paidSeats (not seats) to exclude admin-granted free seats
export async function calculateMRR(): Promise<{
  mrr: number;
  activeSubscriptions: number;
  totalSeats: number;
  totalPaidSeats: number;
}> {
  const subscriptions = await db.query.organizationSubscriptions.findMany({
    where: eq(organizationSubscriptions.status, 'active'),
    with: {
      plan: true,
    },
  });

  let mrr = 0;
  let totalSeats = 0;
  let totalPaidSeats = 0;

  for (const sub of subscriptions) {
    const plan = sub.plan;
    if (plan.name === 'free') continue;

    const monthlyPrice = sub.billingCycle === 'annual'
      ? plan.pricePerSeatAnnual / 12
      : plan.pricePerSeatMonthly;

    // Use paidSeats for MRR calculation (excludes admin-granted free seats)
    mrr += monthlyPrice * (sub.paidSeats || 0);
    totalSeats += sub.seats;
    totalPaidSeats += sub.paidSeats || 0;
  }

  return {
    mrr,
    activeSubscriptions: subscriptions.filter((s: typeof subscriptions[number]) => s.plan.name !== 'free').length,
    totalSeats,
    totalPaidSeats,
  };
}
