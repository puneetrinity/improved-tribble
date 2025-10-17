/**
 * Email Template Service
 * Handles template rendering with variable replacement and sending
 */

import { db } from './db';
import { emailTemplates, applications } from '../shared/schema';
import { eq, asc } from 'drizzle-orm';
import { getEmailService } from './simpleEmailService';
import type { EmailTemplate } from '../shared/schema';

export interface TemplateVariables {
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

/**
 * Send an email using a template with application context
 */
export async function sendTemplatedEmail(
  applicationId: number,
  templateId: number,
  customVariables: Partial<TemplateVariables> = {}
): Promise<void> {
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

  // Fetch email template
  const template = await db.query.emailTemplates.findFirst({
    where: eq(emailTemplates.id, templateId),
  });

  if (!template) {
    throw new Error(`Email template ${templateId} not found`);
  }

  // Build variables from application data
  const variables: TemplateVariables = {
    candidate_name: application.name,
    job_title: application.job?.title || 'Position',
    recruiter_name: application.job?.postedBy
      ? `${application.job.postedBy.firstName || ''} ${application.job.postedBy.lastName || ''}`.trim()
      : 'Hiring Team',
    company_name: 'VantaHire',
    ...customVariables,
  };

  // Render template
  const { subject, body } = renderEmailTemplate(template, variables);

  // Send email
  const svc = await getEmailService();
  if (!svc || typeof svc.sendEmail !== 'function') {
    console.warn('Email service unavailable; skipping send.');
    return;
  }
  await svc.sendEmail({
    to: application.email,
    subject,
    text: body,
  });

  console.log(`✉️  Sent ${template.name} to ${application.email}`);
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
  const template = await db.query.emailTemplates.findFirst({
    where: eq(emailTemplates.templateType, 'interview_invite'),
  });

  if (!template) {
    throw new Error('Interview invitation template not found. Run seed script.');
  }

  await sendTemplatedEmail(applicationId, template.id, {
    interview_date: interviewDetails.date,
    interview_time: interviewDetails.time,
    interview_location: interviewDetails.location,
  });
}

/**
 * Send application status update email
 */
export async function sendStatusUpdateEmail(
  applicationId: number,
  newStatus: string
): Promise<void> {
  const template = await db.query.emailTemplates.findFirst({
    where: eq(emailTemplates.templateType, 'status_update'),
  });

  if (!template) {
    console.warn('Status update template not found, skipping email');
    return;
  }

  await sendTemplatedEmail(applicationId, template.id, {
    new_status: newStatus,
  });
}

/**
 * Send application received confirmation
 */
export async function sendApplicationReceivedEmail(
  applicationId: number
): Promise<void> {
  const template = await db.query.emailTemplates.findFirst({
    where: eq(emailTemplates.templateType, 'application_received'),
  });

  if (!template) {
    console.warn('Application received template not found, skipping email');
    return;
  }

  await sendTemplatedEmail(applicationId, template.id);
}

/**
 * Get all available email templates
 */
export async function getAllTemplates(): Promise<EmailTemplate[]> {
  return db.query.emailTemplates.findMany({
    orderBy: (templates, { asc }) => [asc(templates.templateType), asc(templates.name)],
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
