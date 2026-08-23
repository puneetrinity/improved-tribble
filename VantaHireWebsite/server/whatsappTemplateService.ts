/**
 * WhatsApp Template Service
 * Handles template rendering with variable replacement and sending
 * Pattern follows emailTemplateService.ts
 */

import { db } from './db';
import { whatsappTemplates, applications, whatsappAuditLog, automationEvents } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { getWhatsAppService } from './whatsappService';
import { formatToE164, getDefaultCountry } from './lib/phoneUtils';
import type { WhatsappTemplate } from '../shared/schema';
import {
  CandidatePrivacyRestrictedError,
  requireCandidatePrivacyAllowed,
} from './candidate-privacy/decision';

export interface WhatsAppTemplateVariables {
  candidate_name?: string;
  job_title?: string;
  interview_date?: string;
  interview_time?: string;
  interview_location?: string;
  recruiter_name?: string;
  company_name?: string;
  new_status?: string;
  [key: string]: string | undefined;
}

/**
 * Parameter order definitions for each template type.
 * These MUST match the {{1}}, {{2}}, {{3}} placeholders in the template body.
 *
 * Template definitions from seedWhatsAppTemplates.ts:
 *
 * application_received: "Hello {{1}}, thank you for applying for the {{2}} position at VantaHire.
 *                        We have received your application and will review it shortly. Best regards, {{3}}"
 *
 * interview_invite: "Hello {{1}}, we are pleased to invite you for an interview for the {{2}} position.
 *                    Date: {{3}} Time: {{4}} Location: {{5}} Please confirm your availability. Best regards, {{6}}"
 *
 * status_update: "Hello {{1}}, your application for {{2}} has been updated to: {{3}}.
 *                 We will keep you informed of any further updates. Best regards, {{4}}"
 *
 * offer_extended: "Congratulations {{1}}! We are delighted to extend an offer for the {{2}} position at VantaHire.
 *                  Please check your email for the detailed offer letter. Best regards, {{3}}"
 *
 * rejection: "Hello {{1}}, thank you for your interest in the {{2}} position. After careful review,
 *             we have decided to move forward with other candidates. We encourage you to apply for future opportunities. Best regards, {{3}}"
 */
const TEMPLATE_PARAMETER_ORDER: Record<string, string[]> = {
  application_received: ['candidate_name', 'job_title', 'recruiter_name'],
  interview_invite: ['candidate_name', 'job_title', 'interview_date', 'interview_time', 'interview_location', 'recruiter_name'],
  offer_extended: ['candidate_name', 'job_title', 'recruiter_name'],
  rejection: ['candidate_name', 'job_title', 'recruiter_name'],
};

/**
 * Get ordered parameters array from variables object based on template type
 * This ensures parameters are sent in the correct order for WhatsApp Cloud API
 */
function getOrderedParameters(
  templateType: string,
  variables: WhatsAppTemplateVariables
): string[] {
  const order = TEMPLATE_PARAMETER_ORDER[templateType];

  if (!order) {
    console.warn(`[WhatsApp] Unknown template type: ${templateType}. Using alphabetical order (may be incorrect).`);
    return Object.keys(variables).sort().map(key => variables[key] || '');
  }

  return order.map(key => variables[key] || '');
}

/**
 * Log an automation event for the Operations Command Center
 */
async function logWhatsAppAutomationEvent(
  automationKey: string,
  targetType: 'application' | 'job' | 'user',
  targetId: number,
  outcome: 'success' | 'failed' | 'skipped' = 'success',
  options?: {
    errorMessage?: string;
    metadata?: Record<string, any>;
    triggeredBy?: number;
  }
): Promise<void> {
  try {
    await db.insert(automationEvents).values({
      automationKey,
      targetType,
      targetId,
      outcome,
      errorMessage: options?.errorMessage || null,
      metadata: options?.metadata || null,
      triggeredBy: options?.triggeredBy || null,
    });
  } catch (error) {
    console.error('[WhatsApp AutomationEvent] Failed to log event:', error);
  }
}

/**
 * Render template body by replacing numbered placeholders with variables
 * WhatsApp templates use {{1}}, {{2}}, etc. as placeholders
 */
export function renderWhatsAppTemplate(
  template: string,
  variablesList: string[]
): string {
  let rendered = template;

  variablesList.forEach((value, index) => {
    const placeholder = `{{${index + 1}}}`;
    rendered = rendered.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value || '');
  });

  return rendered;
}

/**
 * Send a WhatsApp message using a template with application context
 */
export async function sendWhatsAppTemplatedMessage(
  applicationId: number,
  templateId: number,
  customVariables: Partial<WhatsAppTemplateVariables> = {}
): Promise<void> {
  await requireCandidatePrivacyAllowed(
    { type: 'application', id: applicationId },
    { globalUse: false },
  );

  // Fetch application with job and recruiter data
  const application = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
    with: {
      job: {
        with: {
          postedBy: true,
        },
      },
    },
  });

  if (!application) {
    throw new Error(`Application ${applicationId} not found`);
  }

  // Fetch WhatsApp template
  const template = await db.query.whatsappTemplates.findFirst({
    where: eq(whatsappTemplates.id, templateId),
  });

  if (!template) {
    throw new Error(`WhatsApp template ${templateId} not found`);
  }

  // Build variables from application data
  const variables: WhatsAppTemplateVariables = {
    candidate_name: application.name,
    job_title: application.job?.title || 'Position',
    recruiter_name: application.job?.postedBy
      ? `${application.job.postedBy.firstName || ''} ${application.job.postedBy.lastName || ''}`.trim()
      : 'Hiring Team',
    company_name: 'VantaHire',
    ...customVariables,
  };

  // Format phone number
  const formattedPhone = formatToE164(application.phone, getDefaultCountry());

  if (!formattedPhone) {
    console.warn(`[WhatsApp] Invalid phone number for application ${applicationId}: ${application.phone}`);
    await logWhatsAppAutomationEvent(
      `whatsapp.${template.templateType}`,
      'application',
      applicationId,
      'failed',
      { errorMessage: 'Invalid phone number', metadata: { phone: application.phone } }
    );

    // Log to audit table
    await db.insert(whatsappAuditLog).values({
      applicationId,
      templateId,
      templateType: template.templateType,
      recipientPhone: application.phone,
      status: 'failed',
      errorCode: 'INVALID_PHONE',
      errorMessage: 'Invalid phone number format',
      templateVariables: variables,
    });

    return;
  }

  let status: 'sent' | 'failed' = 'sent';
  let messageId: string | undefined;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;

  try {
    // Get WhatsApp service
    const svc = await getWhatsAppService();
    if (!svc) {
      console.warn('[WhatsApp] WhatsApp service unavailable; skipping send.');
      status = 'failed';
      errorMessage = 'WhatsApp service unavailable';
    } else {
      // Get ordered parameters array for the template type
      const orderedParams = getOrderedParameters(template.templateType, variables);

      // Send message with ordered parameters
      await requireCandidatePrivacyAllowed(
        { type: 'application', id: applicationId },
        { globalUse: false },
      );
      const result = await svc.sendTemplateMessage({
        to: formattedPhone,
        templateName: template.metaTemplateName,
        languageCode: template.language,
        parameters: orderedParams,
      });

      if (result.success) {
        messageId = result.messageId;
        console.log(`📱 WhatsApp sent ${template.name} to ${formattedPhone}`);
      } else {
        status = 'failed';
        errorCode = result.error?.code;
        errorMessage = result.error?.message;
        console.error(`Failed to send WhatsApp ${template.name} to ${formattedPhone}:`, result.error);
      }
    }
  } catch (error: any) {
    if (error instanceof CandidatePrivacyRestrictedError) {
      throw error;
    }
    status = 'failed';
    errorMessage = error?.message || 'Unknown error';
    console.error(`[WhatsApp] Failed to send ${template.name} to ${formattedPhone}:`, error);
  }

  // Log to audit table
  await db.insert(whatsappAuditLog).values({
    applicationId,
    templateId,
    templateType: template.templateType,
    recipientPhone: formattedPhone,
    messageId,
    status,
    errorCode,
    errorMessage,
    templateVariables: variables,
  });

  // Log automation event
  const eventOptions: {
    errorMessage?: string;
    metadata?: Record<string, any>;
  } = {
    metadata: { templateId, messageId },
  };
  if (errorMessage) {
    eventOptions.errorMessage = errorMessage;
  }
  await logWhatsAppAutomationEvent(
    `whatsapp.${template.templateType}`,
    'application',
    applicationId,
    status === 'sent' ? 'success' : 'failed',
    eventOptions
  );
}

/**
 * Send interview invitation via WhatsApp
 */
export async function sendWhatsAppInterviewInvitation(
  applicationId: number,
  interviewDetails: {
    date: string;
    time: string;
    location: string;
  }
): Promise<void> {
  const template = await db.query.whatsappTemplates.findFirst({
    where: eq(whatsappTemplates.templateType, 'interview_invite'),
  });

  if (!template) {
    await logWhatsAppAutomationEvent('whatsapp.interview_invite', 'application', applicationId, 'skipped', {
      errorMessage: 'Interview invitation template not found',
    });
    console.warn('[WhatsApp] Interview invitation template not found');
    return;
  }

  const location = interviewDetails.location.trim();
  const displayLocation = location.toLowerCase().startsWith('http') ? 'Online Interview (Check email for link)' : location;

  await sendWhatsAppTemplatedMessage(applicationId, template.id, {
    interview_date: interviewDetails.date,
    interview_time: interviewDetails.time,
    interview_location: displayLocation,
  });
}

/**
 * Send application status update via WhatsApp
 */
export async function sendWhatsAppStatusUpdate(
  applicationId: number,
  newStatus: string
): Promise<void> {
  const template = await db.query.whatsappTemplates.findFirst({
    where: eq(whatsappTemplates.templateType, 'status_update'),
  });

  if (!template) {
    await logWhatsAppAutomationEvent('whatsapp.status_update', 'application', applicationId, 'skipped', {
      errorMessage: 'Status update template not found',
      metadata: { newStatus },
    });
    console.warn('[WhatsApp] Status update template not found');
    return;
  }

  await sendWhatsAppTemplatedMessage(applicationId, template.id, {
    new_status: newStatus,
  });
}

/**
 * Send application received confirmation via WhatsApp
 */
export async function sendWhatsAppApplicationReceived(
  applicationId: number
): Promise<void> {
  const template = await db.query.whatsappTemplates.findFirst({
    where: eq(whatsappTemplates.templateType, 'application_received'),
  });

  if (!template) {
    await logWhatsAppAutomationEvent('whatsapp.application_received', 'application', applicationId, 'skipped', {
      errorMessage: 'Application received template not found',
    });
    console.warn('[WhatsApp] Application received template not found');
    return;
  }

  await sendWhatsAppTemplatedMessage(applicationId, template.id);
}

/**
 * Send offer notification via WhatsApp
 */
export async function sendWhatsAppOfferNotification(
  applicationId: number
): Promise<void> {
  const template = await db.query.whatsappTemplates.findFirst({
    where: eq(whatsappTemplates.templateType, 'offer_extended'),
  });

  if (!template) {
    await logWhatsAppAutomationEvent('whatsapp.offer_extended', 'application', applicationId, 'skipped', {
      errorMessage: 'Offer template not found',
    });
    console.warn('[WhatsApp] Offer template not found');
    return;
  }

  await sendWhatsAppTemplatedMessage(applicationId, template.id);
}

/**
 * Send rejection notification via WhatsApp
 */
export async function sendWhatsAppRejectionNotification(
  applicationId: number
): Promise<void> {
  const template = await db.query.whatsappTemplates.findFirst({
    where: eq(whatsappTemplates.templateType, 'rejection'),
  });

  if (!template) {
    await logWhatsAppAutomationEvent('whatsapp.rejection', 'application', applicationId, 'skipped', {
      errorMessage: 'Rejection template not found',
    });
    console.warn('[WhatsApp] Rejection template not found');
    return;
  }

  await sendWhatsAppTemplatedMessage(applicationId, template.id);
}

/**
 * Get all available WhatsApp templates
 */
export async function getAllWhatsAppTemplates(): Promise<WhatsappTemplate[]> {
  return db.query.whatsappTemplates.findMany({
    orderBy: (templates: any, { asc }: any) => [asc(templates.templateType), asc(templates.name)],
  });
}

/**
 * Get WhatsApp templates by type
 */
export async function getWhatsAppTemplatesByType(
  templateType: string
): Promise<WhatsappTemplate[]> {
  return db.query.whatsappTemplates.findMany({
    where: eq(whatsappTemplates.templateType, templateType),
  });
}
