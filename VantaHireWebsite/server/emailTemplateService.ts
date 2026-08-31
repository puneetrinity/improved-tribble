/**
 * Email Template Service
 * Handles template rendering with variable replacement and sending
 */

import { db } from './db';
import { emailTemplates, applications, emailAuditLog, automationEvents } from '../shared/schema';
import { eq, asc, and, or, isNull } from 'drizzle-orm';
import { getEmailService } from './simpleEmailService';
import type { EmailTemplate } from '../shared/schema';
import {
  CandidatePrivacyRestrictedError,
  requireCandidatePrivacyAllowed,
} from './candidate-privacy/decision';

/**
 * Log an automation event for the Operations Command Center
 */
export async function logAutomationEvent(
  automationKey: string,
  targetType: 'application' | 'job' | 'user',
  targetId: number,
  outcome: 'success' | 'failed' | 'skipped' = 'success',
  options?: {
    errorMessage?: string;
    metadata?: Record<string, any>;
    triggeredBy?: number;
    organizationId?: number | undefined;
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
      ...(options?.organizationId != null && { organizationId: options.organizationId }),
    });
  } catch (error) {
    console.error('[AutomationEvent] Failed to log event:', error);
    // Don't throw - logging should not break the main flow
  }
}

async function getOrganizationIdForApplication(applicationId: number): Promise<number | undefined> {
  await requireCandidatePrivacyAllowed(
    { type: 'application', id: applicationId },
    { globalUse: false },
  );
  const application = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
    with: { job: true },
  });
  return application?.job?.organizationId ?? undefined;
}

async function getTemplateByTypeForOrg(
  templateType: string,
  organizationId?: number
): Promise<EmailTemplate | undefined> {
  if (organizationId != null) {
    const [orgTemplate] = await db
      .select()
      .from(emailTemplates)
      .where(and(
        eq(emailTemplates.templateType, templateType),
        eq(emailTemplates.organizationId, organizationId)
      ))
      .limit(1);
    if (orgTemplate) return orgTemplate;
  }

  const [globalTemplate] = await db
    .select()
    .from(emailTemplates)
    .where(and(
      eq(emailTemplates.templateType, templateType),
      isNull(emailTemplates.organizationId)
    ))
    .limit(1);
  return globalTemplate;
}

export interface TemplateVariables {
  candidate_name?: string;
  job_title?: string;
  interview_date?: string;
  interview_time?: string;
  interview_location?: string;
  recruiter_name?: string;
  company_name?: string;
  new_status?: string;
  // Co-recruiter invitation variables
  inviter_name?: string;
  invitee_name?: string;
  greeting?: string;
  accept_url?: string;
  dashboard_url?: string;
  expiry_days?: string;
  [key: string]: string | undefined;
}

/**
 * Replace template variables like {{variable_name}} with actual values
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariables
): string {
  let rendered = template;

  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    rendered = rendered.replace(regex, value || '');
  });

  // Remove any remaining unreplaced variables
  rendered = rendered.replace(/{{[^}]+}}/g, '');

  return rendered;
}

/**
 * Render both subject and body of an email template
 */
export function renderEmailTemplate(
  template: EmailTemplate,
  variables: TemplateVariables
): { subject: string; body: string } {
  return {
    subject: renderTemplate(template.subject, variables),
    body: renderTemplate(template.body, variables),
  };
}

type SendTemplatedEmailOptions = {
  customVariables?: Partial<TemplateVariables>;
  subjectOverride?: string;
  bodyOverride?: string;
};

function isSendTemplatedEmailOptions(
  value: Partial<TemplateVariables> | SendTemplatedEmailOptions
): value is SendTemplatedEmailOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('customVariables' in value || 'subjectOverride' in value || 'bodyOverride' in value)
  );
}

export interface AuthorizedTemplatedEmailContext {
  applicationId: number;
  templateId: number;
  organizationId: number;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  recruiterName: string;
  templateName: string;
  templateType: string;
  templateSubject: string;
  templateBody: string;
}

function isAuthorizedTemplatedEmailContext(value: unknown): value is AuthorizedTemplatedEmailContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as AuthorizedTemplatedEmailContext;
  const positive = (item: unknown) => typeof item === 'number' && Number.isSafeInteger(item) && item > 0;
  const boundedText = (item: unknown, max: number) => typeof item === 'string' && item.length > 0 && item.length <= max;
  return positive(context.applicationId)
    && positive(context.templateId)
    && positive(context.organizationId)
    && boundedText(context.candidateName, 1_000)
    && boundedText(context.candidateEmail, 1_000)
    && boundedText(context.jobTitle, 2_000)
    && boundedText(context.recruiterName, 1_000)
    && boundedText(context.templateName, 1_000)
    && boundedText(context.templateType, 1_000)
    && boundedText(context.templateSubject, 20_000)
    && boundedText(context.templateBody, 1_000_000);
}

/**
 * Deliver a manually-authorized application email without re-reading its
 * application, job or template by global id. The caller supplies only the
 * immutable statement-bound context produced by the 2H authorization module.
 */
export async function sendAuthorizedTemplatedEmail(
  context: AuthorizedTemplatedEmailContext,
  options: SendTemplatedEmailOptions = {},
): Promise<void> {
  if (!isAuthorizedTemplatedEmailContext(context)) {
    throw new Error('AUTHORIZED_EMAIL_CONTEXT_INVALID');
  }

  const variables: TemplateVariables = {
    candidate_name: context.candidateName,
    job_title: context.jobTitle,
    recruiter_name: context.recruiterName,
    company_name: 'VantaHire',
    ...options.customVariables,
  };
  const renderedSubject = renderTemplate(context.templateSubject, variables);
  const renderedBody = renderTemplate(context.templateBody, variables);
  const subject = options.subjectOverride && options.subjectOverride.trim().length > 0
    ? options.subjectOverride
    : renderedSubject;
  const body = options.bodyOverride && options.bodyOverride.trim().length > 0
    ? options.bodyOverride
    : renderedBody;

  let previewUrl: string | null = null;
  let status: 'success' | 'failed' = 'success';
  let errorMessage: string | null = null;

  try {
    const svc = await getEmailService();
    if (!svc || typeof svc.sendEmail !== 'function') {
      status = 'failed';
      errorMessage = 'Email service unavailable';
    } else {
      await requireCandidatePrivacyAllowed(
        { type: 'application', id: context.applicationId },
        { globalUse: false },
      );
      const result = await svc.sendEmail({
        to: context.candidateEmail,
        subject,
        text: body,
      });
      if (result && typeof result === 'object' && 'messageId' in result) {
        const nodemailerInfo = result as { messageId?: unknown };
        if (typeof nodemailerInfo.messageId === 'string' && process.env.SMTP_HOST?.includes('ethereal')) {
          previewUrl = `https://ethereal.email/message/${nodemailerInfo.messageId}`;
        }
      }
    }
  } catch (error) {
    if (error instanceof CandidatePrivacyRestrictedError) throw error;
    status = 'failed';
    errorMessage = 'Email provider unavailable';
  }

  await db.insert(emailAuditLog).values({
    applicationId: context.applicationId,
    templateId: context.templateId,
    templateType: context.templateType,
    recipientEmail: context.candidateEmail,
    subject,
    status,
    errorMessage,
    previewUrl,
  });
}

/**
 * Send an email using a template with application context
 */
export async function sendTemplatedEmail(
  applicationId: number,
  templateId: number,
  customVariablesOrOptions: Partial<TemplateVariables> | SendTemplatedEmailOptions = {}
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

  const organizationId = application.job?.organizationId ?? undefined;
  // Fetch email template scoped to org (or global default)
  const templateWhere = organizationId != null
    ? and(
      eq(emailTemplates.id, templateId),
      or(eq(emailTemplates.organizationId, organizationId), isNull(emailTemplates.organizationId))
    )
    : eq(emailTemplates.id, templateId);
  const template = await db.query.emailTemplates.findFirst({
    where: templateWhere,
  });

  if (!template) {
    throw new Error(`Email template ${templateId} not found`);
  }

  const options = isSendTemplatedEmailOptions(customVariablesOrOptions)
    ? customVariablesOrOptions
    : { customVariables: customVariablesOrOptions };

  // Build variables from application data
  const variables: TemplateVariables = {
    candidate_name: application.name,
    job_title: application.job?.title || 'Position',
    recruiter_name: application.job?.postedBy
      ? `${application.job.postedBy.firstName || ''} ${application.job.postedBy.lastName || ''}`.trim()
      : 'Hiring Team',
    company_name: 'VantaHire',
    ...options.customVariables,
  };

  // Render template
  const rendered = renderEmailTemplate(template, variables);
  const subject = options.subjectOverride && options.subjectOverride.trim().length > 0
    ? options.subjectOverride
    : rendered.subject;
  const body = options.bodyOverride && options.bodyOverride.trim().length > 0
    ? options.bodyOverride
    : rendered.body;

  let previewUrl: string | null = null;
  let status: 'success' | 'failed' = 'success';
  let errorMessage: string | null = null;

  try {
    // Send email
    const svc = await getEmailService();
    if (!svc || typeof svc.sendEmail !== 'function') {
      console.warn('Email service unavailable; skipping send.');
      status = 'failed';
      errorMessage = 'Email service unavailable';
    } else {
      // Recheck at the provider boundary so a request accepted after the load
      // cannot race into an outbound candidate message.
      await requireCandidatePrivacyAllowed(
        { type: 'application', id: applicationId },
        { globalUse: false },
      );
      const result = await svc.sendEmail({
        to: application.email,
        subject,
        text: body,
      });

      // Extract preview URL if available (Ethereal)
      if (result && typeof result === 'object' && 'messageId' in result) {
        const nodemailerInfo = result as any;
        if (nodemailerInfo.messageId && process.env.SMTP_HOST?.includes('ethereal')) {
          previewUrl = `https://ethereal.email/message/${nodemailerInfo.messageId}`;
        }
      }

      console.log(`✉️  Sent ${template.name} to ${application.email}`);
    }
  } catch (error: any) {
    if (error instanceof CandidatePrivacyRestrictedError) {
      throw error;
    }
    status = 'failed';
    errorMessage = error?.message || 'Unknown error';
    console.error(`Failed to send ${template.name} to ${application.email}:`, error);
  }

  // Log to audit table
  await db.insert(emailAuditLog).values({
    applicationId,
    templateId,
    templateType: template.templateType,
    recipientEmail: application.email,
    subject,
    status,
    errorMessage,
    previewUrl,
  });
}

/**
 * Send interview invitation email
 */
export async function sendInterviewInvitation(
  applicationId: number,
  interviewDetails: {
    date: string;
    time: string;
    location: string;
  }
): Promise<void> {
  // Find the interview invitation template
  const organizationId = await getOrganizationIdForApplication(applicationId);
  const template = await getTemplateByTypeForOrg('interview_invite', organizationId);

  if (!template) {
    await logAutomationEvent('email.interview_invite', 'application', applicationId, 'failed', {
      errorMessage: 'Interview invitation template not found',
      organizationId,
    });
    throw new Error('Interview invitation template not found. Run seed script.');
  }

  try {
    await sendTemplatedEmail(applicationId, template.id, {
      interview_date: interviewDetails.date,
      interview_time: interviewDetails.time,
      interview_location: interviewDetails.location,
    });
    await logAutomationEvent('email.interview_invite', 'application', applicationId, 'success', {
      metadata: { templateId: template.id, ...interviewDetails },
      organizationId,
    });
  } catch (error: any) {
    await logAutomationEvent('email.interview_invite', 'application', applicationId, 'failed', {
      errorMessage: error?.message || 'Unknown error',
      organizationId,
    });
    throw error;
  }
}

/**
 * Send application status update email
 */
export async function sendStatusUpdateEmail(
  applicationId: number,
  newStatus: string
): Promise<void> {
  const organizationId = await getOrganizationIdForApplication(applicationId);
  const template = await getTemplateByTypeForOrg('status_update', organizationId);

  if (!template) {
    console.warn('Status update template not found, skipping email');
    await logAutomationEvent('email.status_update', 'application', applicationId, 'skipped', {
      errorMessage: 'Status update template not found',
      metadata: { newStatus },
      organizationId,
    });
    return;
  }

  try {
    await sendTemplatedEmail(applicationId, template.id, {
      new_status: newStatus,
    });
    await logAutomationEvent('email.status_update', 'application', applicationId, 'success', {
      metadata: { templateId: template.id, newStatus },
      organizationId,
    });
  } catch (error: any) {
    await logAutomationEvent('email.status_update', 'application', applicationId, 'failed', {
      errorMessage: error?.message || 'Unknown error',
      metadata: { newStatus },
      organizationId,
    });
  }
}

/**
 * Send application received confirmation
 */
export async function sendApplicationReceivedEmail(
  applicationId: number
): Promise<void> {
  const organizationId = await getOrganizationIdForApplication(applicationId);
  const template = await getTemplateByTypeForOrg('application_received', organizationId);

  if (!template) {
    console.warn('Application received template not found, skipping email');
    await logAutomationEvent('email.application_received', 'application', applicationId, 'skipped', {
      errorMessage: 'Application received template not found',
      organizationId,
    });
    return;
  }

  try {
    await sendTemplatedEmail(applicationId, template.id);
    await logAutomationEvent('email.application_received', 'application', applicationId, 'success', {
      metadata: { templateId: template.id },
      organizationId,
    });
  } catch (error: any) {
    await logAutomationEvent('email.application_received', 'application', applicationId, 'failed', {
      errorMessage: error?.message || 'Unknown error',
      organizationId,
    });
  }
}

/**
 * Send job offer email
 */
export async function sendOfferEmail(
  applicationId: number
): Promise<void> {
  const organizationId = await getOrganizationIdForApplication(applicationId);
  const template = await getTemplateByTypeForOrg('offer_extended', organizationId);

  if (!template) {
    console.warn('Offer template not found, skipping email');
    await logAutomationEvent('email.offer_extended', 'application', applicationId, 'skipped', {
      errorMessage: 'Offer template not found',
      organizationId,
    });
    return;
  }

  try {
    await sendTemplatedEmail(applicationId, template.id);
    await logAutomationEvent('email.offer_extended', 'application', applicationId, 'success', {
      metadata: { templateId: template.id },
      organizationId,
    });
  } catch (error: any) {
    await logAutomationEvent('email.offer_extended', 'application', applicationId, 'failed', {
      errorMessage: error?.message || 'Unknown error',
      organizationId,
    });
  }
}

/**
 * Send rejection email
 */
export async function sendRejectionEmail(
  applicationId: number
): Promise<void> {
  const organizationId = await getOrganizationIdForApplication(applicationId);
  const template = await getTemplateByTypeForOrg('rejection', organizationId);

  if (!template) {
    console.warn('Rejection template not found, skipping email');
    await logAutomationEvent('email.rejection', 'application', applicationId, 'skipped', {
      errorMessage: 'Rejection template not found',
      organizationId,
    });
    return;
  }

  try {
    await sendTemplatedEmail(applicationId, template.id);
    await logAutomationEvent('email.rejection', 'application', applicationId, 'success', {
      metadata: { templateId: template.id },
      organizationId,
    });
  } catch (error: any) {
    await logAutomationEvent('email.rejection', 'application', applicationId, 'failed', {
      errorMessage: error?.message || 'Unknown error',
      organizationId,
    });
  }
}

/**
 * Send co-recruiter invitation email using database template
 */
export async function sendCoRecruiterInvitationEmail(
  email: string,
  opts: {
    inviterName: string;
    inviteeName?: string;
    jobTitle: string;
    acceptUrl: string;
    expiryDays: number;
    organizationId?: number | undefined;
  }
): Promise<boolean> {
  const svc = await getEmailService();
  if (!svc) {
    console.warn('[CoRecruiterEmail] Email service unavailable');
    return false;
  }

  // Try to find the template (org-specific, else global)
  const template = await getTemplateByTypeForOrg('co_recruiter_invitation', opts.organizationId);

  const greeting = opts.inviteeName ? `Hi ${opts.inviteeName},` : 'Hi,';

  let subject: string;
  let body: string;

  if (template) {
    const templateVars: TemplateVariables = {
      inviter_name: opts.inviterName,
      greeting,
      job_title: opts.jobTitle,
      accept_url: opts.acceptUrl,
      expiry_days: String(opts.expiryDays),
    };
    if (opts.inviteeName) {
      templateVars.invitee_name = opts.inviteeName;
    }
    const rendered = renderEmailTemplate(template, templateVars);
    subject = rendered.subject;
    body = rendered.body;
  } else {
    // Fallback to hardcoded template if not in database
    subject = `You're invited to collaborate on "${opts.jobTitle}"`;
    body = `${greeting}

${opts.inviterName} has invited you to collaborate as a co-recruiter on the job posting:

${opts.jobTitle}

As a co-recruiter, you'll have full access to:
- View and manage all applications for this job
- Update candidate stages and statuses
- Send forms and emails to candidates
- Access job analytics and reports

Accept your invitation: ${opts.acceptUrl}

This invitation expires in ${opts.expiryDays} days.

If you didn't expect this invitation, you can safely ignore this email.`;
  }

  try {
    await svc.sendEmail({
      to: email,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
    });
    console.log(`[CoRecruiterEmail] Invitation sent to ${email}`);
    return true;
  } catch (err) {
    console.error(`[CoRecruiterEmail] Failed to send invitation to ${email}:`, err);
    return false;
  }
}

/**
 * Send co-recruiter added notification email using database template
 */
export async function sendCoRecruiterAddedEmail(
  email: string,
  opts: {
    inviterName: string;
    recruiterFirstName?: string | null;
    jobTitle: string;
    dashboardUrl: string;
    organizationId?: number | undefined;
  }
): Promise<boolean> {
  const svc = await getEmailService();
  if (!svc) {
    console.warn('[CoRecruiterEmail] Email service unavailable');
    return false;
  }

  // Try to find the template (org-specific, else global)
  const template = await getTemplateByTypeForOrg('co_recruiter_added', opts.organizationId);

  const greeting = opts.recruiterFirstName ? `Hi ${opts.recruiterFirstName},` : 'Hi,';

  let subject: string;
  let body: string;

  if (template) {
    const rendered = renderEmailTemplate(template, {
      inviter_name: opts.inviterName,
      greeting,
      job_title: opts.jobTitle,
      dashboard_url: opts.dashboardUrl,
    });
    subject = rendered.subject;
    body = rendered.body;
  } else {
    // Fallback to hardcoded template
    subject = `You've been added as a co-recruiter on "${opts.jobTitle}"`;
    body = `${greeting}

${opts.inviterName} has added you as a co-recruiter on the job posting:

${opts.jobTitle}

You now have full access to manage applications and collaborate on this hiring process.

View your dashboard: ${opts.dashboardUrl}`;
  }

  try {
    await svc.sendEmail({
      to: email,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>'),
    });
    console.log(`[CoRecruiterEmail] Added notification sent to ${email}`);
    return true;
  } catch (err) {
    console.error(`[CoRecruiterEmail] Failed to send added notification to ${email}:`, err);
    return false;
  }
}

/**
 * Notify all recruiters on a job about a new application
 */
export async function notifyRecruitersNewApplication(
  applicationId: number,
  jobId: number,
  application: {
    name: string;
    email: string;
    phone?: string | null;
    coverLetter?: string | null;
  },
  job: {
    title: string;
    location: string;
  }
): Promise<void> {
  await requireCandidatePrivacyAllowed(
    { type: 'application', id: applicationId },
    { globalUse: false },
  );

  const svc = await getEmailService();
  if (!svc) {
    console.warn('[RecruiterNotify] Email service unavailable, skipping notification');
    return;
  }

  // Import storage dynamically to avoid circular dependency
  const { storage } = await import('./storage');

  // Get all recruiters on this job
  const recruiters = await storage.getJobRecruiters(jobId);

  if (recruiters.length === 0) {
    console.warn(`[RecruiterNotify] No recruiters found for job ${jobId}`);
    return;
  }

  const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
  const applicationUrl = `${BASE_URL}/jobs/${jobId}/applications`;
  const resumeUrl = `${BASE_URL}/api/applications/${applicationId}/resume`;

  const subject = `New Application: ${application.name} applied for ${job.title}`;
  const html = `
    <h2>New Application Received</h2>
    <p>A new candidate has applied for your job posting.</p>

    <h3>Candidate Details</h3>
    <ul>
      <li><strong>Name:</strong> ${application.name}</li>
      <li><strong>Email:</strong> ${application.email}</li>
      <li><strong>Phone:</strong> ${application.phone || 'Not provided'}</li>
    </ul>

    <h3>Job Details</h3>
    <ul>
      <li><strong>Position:</strong> ${job.title}</li>
      <li><strong>Location:</strong> ${job.location}</li>
    </ul>

    ${application.coverLetter ? `<h3>Cover Letter</h3><p>${application.coverLetter}</p>` : ''}

    <p style="margin-top: 20px;">
      <a href="${applicationUrl}" style="background-color: #7B38FB; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
        View Application
      </a>
      &nbsp;&nbsp;
      <a href="${resumeUrl}" style="background-color: #6b7280; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
        Download Resume
      </a>
    </p>

    <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
      This is an automated notification from VantaHire ATS.
    </p>
  `;

  // Send to all recruiters and track results
  let successCount = 0;
  let failedCount = 0;
  const failedEmails: string[] = [];

  const sendPromises = recruiters.map(async (recruiter) => {
    try {
      // Each provider write gets its own last-moment check because this fan-out
      // can span long enough for the privacy projection to change mid-send.
      await requireCandidatePrivacyAllowed(
        { type: 'application', id: applicationId },
        { globalUse: false },
      );
      await svc.sendEmail({
        to: recruiter.username,
        subject,
        html,
      });
      successCount++;
      console.log(`[RecruiterNotify] Notified ${recruiter.username} about application ${applicationId}`);
    } catch (err) {
      if (err instanceof CandidatePrivacyRestrictedError) {
        throw err;
      }
      failedCount++;
      failedEmails.push(recruiter.username);
      console.error(`[RecruiterNotify] Failed to notify ${recruiter.username}:`, err);
    }
  });

  await Promise.all(sendPromises);

  // Log automation event with detailed results
  const outcome = failedCount === 0 ? 'success' : (successCount === 0 ? 'failed' : 'success');
  const jobRecord = await storage.getJob(jobId);
  const logOpts: NonNullable<Parameters<typeof logAutomationEvent>[4]> = {
    metadata: {
      jobId,
      totalRecruiters: recruiters.length,
      successCount,
      failedCount,
      ...(failedEmails.length > 0 ? { failedEmails } : {}),
    },
    organizationId: jobRecord?.organizationId ?? undefined,
    ...(failedCount > 0 ? { errorMessage: `Failed to notify ${failedCount} recruiter(s)` } : {}),
  };
  await logAutomationEvent('email.notify_recruiters_new_application', 'application', applicationId, outcome, logOpts);
}

/**
 * Get all available email templates
 */
export async function getAllTemplates(): Promise<EmailTemplate[]> {
  return db.query.emailTemplates.findMany({
    orderBy: (templates: any, { asc }: any) => [asc(templates.templateType), asc(templates.name)],
  });
}

/**
 * Get templates by type
 */
export async function getTemplatesByType(
  templateType: string
): Promise<EmailTemplate[]> {
  return db.query.emailTemplates.findMany({
    where: eq(emailTemplates.templateType, templateType),
  });
}

/**
 * Create a new email template
 */
export async function createEmailTemplate(
  templateData: {
    name: string;
    subject: string;
    body: string;
    templateType: string;
    createdBy?: number;
  }
): Promise<EmailTemplate> {
  const [newTemplate] = await db
    .insert(emailTemplates)
    .values({
      ...templateData,
      isDefault: false,
    })
    .returning();

  return newTemplate;
}
