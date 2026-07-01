import nodemailer from 'nodemailer';
import type { ContactSubmission } from '@shared/schema';

// HTML escape function to prevent XSS in emails
function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Simple interface for our email service
export interface EmailService {
  sendContactNotification(submission: ContactSubmission): Promise<boolean>;
  sendEmail(opts: { to: string; subject: string; text?: string; html?: string }): Promise<boolean>;
}

// Generic SMTP email service (Brevo-compatible)
export class SMTPEmailService implements EmailService {
  private transporter: nodemailer.Transporter;
  private fromEmail: string;
  private fromName?: string;
  private notificationsTo?: string;

  constructor(opts: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    fromEmail: string;
    fromName?: string;
    notificationsTo?: string;
  }) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.auth,
    });
    this.fromEmail = opts.fromEmail;
    this.fromName = opts.fromName ?? '';
    if (opts.notificationsTo !== undefined) {
      this.notificationsTo = opts.notificationsTo;
    }
  }

  private buildFrom() {
    return this.fromName ? `"${this.fromName}" <${this.fromEmail}>` : this.fromEmail;
  }

  async sendContactNotification(submission: ContactSubmission): Promise<boolean> {
    try {
      const { name, email, phone, company, message } = submission;
      // Escape all user-provided fields to prevent HTML injection
      const safeName = escapeHtml(name);
      const safeEmail = escapeHtml(email);
      const safePhone = escapeHtml(phone) || 'Not provided';
      const safeCompany = escapeHtml(company) || 'Not provided';
      const safeMessage = escapeHtml(message);

      const info = await this.transporter.sendMail({
        from: this.buildFrom(),
        to: this.notificationsTo || this.fromEmail,
        subject: `New Contact Form Submission from ${safeName}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Date:</strong> ${new Date(submission.submittedAt || Date.now()).toLocaleString()}</p>
          <hr />
          <h3>Contact Details:</h3>
          <p><strong>Name:</strong> ${safeName}</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          <p><strong>Phone:</strong> ${safePhone}</p>
          <p><strong>Company:</strong> ${safeCompany}</p>
          <h3>Message:</h3>
          <p>${safeMessage}</p>
        `,
        text: `New submission from ${name} (${email})\nPhone: ${phone || 'N/A'}\nCompany: ${company || 'N/A'}\n\n${message}`,
      } as any);
      console.log('Contact notification sent:', info.messageId);
      return true;
    } catch (error) {
      console.error('Error sending contact notification:', error);
      return false;
    }
  }

  async sendEmail(opts: { to: string; subject: string; text?: string; html?: string }): Promise<boolean> {
    try {
      const info = await this.transporter.sendMail({
        from: this.buildFrom(),
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
      console.log('Email sent:', info.messageId);
      return true;
    } catch (e) {
      console.error('Email send error:', e);
      return false;
    }
  }
}

// Ethereal test email service (development fallback)
export class TestEmailService implements EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private fromEmail: string = 'info@ealana.com';
  private fromName: string = 'VantaHire';
  private notificationsTo?: string;

  constructor(notificationsTo?: string) {
    if (notificationsTo !== undefined) {
      this.notificationsTo = notificationsTo;
    }
  }

  private async ensureTransporter() {
    if (this.transporter) return;
    const testAccount = await nodemailer.createTestAccount();
    console.log('Created Ethereal account:', testAccount.user);
    this.transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  }

  private buildFrom() {
    return this.fromName ? `"${this.fromName}" <${this.fromEmail}>` : this.fromEmail;
  }

  async sendContactNotification(submission: ContactSubmission): Promise<boolean> {
    try {
      await this.ensureTransporter();
      const { name, email, phone, company, message } = submission;
      const info = await this.transporter!.sendMail({
        from: this.buildFrom(),
        to: this.notificationsTo || this.fromEmail,
        subject: `New Contact Form Submission from ${name}`,
        text: `New submission from ${name} (${email})\nPhone: ${phone || 'N/A'}\nCompany: ${company || 'N/A'}\n\n${message}`,
      });
      console.log('Ethereal preview URL:', nodemailer.getTestMessageUrl(info));
      return true;
    } catch (e) {
      console.error('Ethereal send error:', e);
      return false;
    }
  }

  async sendEmail(opts: { to: string; subject: string; text?: string; html?: string }): Promise<boolean> {
    try {
      await this.ensureTransporter();
      const info = await this.transporter!.sendMail({
        from: this.buildFrom(),
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
      console.log('Ethereal preview URL:', nodemailer.getTestMessageUrl(info));
      return true;
    } catch (e) {
      console.error('Ethereal send error:', e);
      return false;
    }
  }
}

// Singleton factory
let emailServiceInstance: EmailService | null = null;
export async function getEmailService(): Promise<EmailService | null> {
  if (emailServiceInstance) return emailServiceInstance;

  const provider = (process.env.EMAIL_PROVIDER || '').toLowerCase();
  const isProduction = process.env.NODE_ENV === 'production';
  const fromEmail = process.env.SEND_FROM_EMAIL;
  const fromName = process.env.SEND_FROM_NAME || 'VantaHire';
  const notificationsTo = process.env.NOTIFICATION_EMAIL || fromEmail;

  if (provider === 'brevo') {
    const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
    const port = parseInt(process.env.BREVO_SMTP_PORT || '587', 10);
    const user = process.env.BREVO_SMTP_USER || 'apikey';
    const pass = process.env.BREVO_SMTP_PASSWORD;
    const secure = port === 465;

    if (!fromEmail || !pass) {
      if (isProduction) {
        console.error('Brevo SMTP is not fully configured in production. Email sending is disabled.');
        return null;
      }
      console.warn('Brevo SMTP not fully configured. Falling back to Ethereal.');
    } else {
      console.log('Using Brevo SMTP for email sending');
      if (fromName !== undefined && notificationsTo !== undefined) {
        emailServiceInstance = new SMTPEmailService({
          host,
          port,
          secure,
          auth: { user, pass },
          fromEmail,
          fromName,
          notificationsTo,
        });
      } else if (fromName !== undefined) {
        emailServiceInstance = new SMTPEmailService({
          host,
          port,
          secure,
          auth: { user, pass },
          fromEmail,
          fromName,
        });
      } else if (notificationsTo !== undefined) {
        emailServiceInstance = new SMTPEmailService({
          host,
          port,
          secure,
          auth: { user, pass },
          fromEmail,
          notificationsTo,
        });
      } else {
        emailServiceInstance = new SMTPEmailService({
          host,
          port,
          secure,
          auth: { user, pass },
          fromEmail,
        });
      }
      return emailServiceInstance;
    }
  }

  if (isProduction) {
    console.error('No production email provider configured. Set EMAIL_PROVIDER=brevo and SMTP credentials.');
    return null;
  }

  console.log('Using Ethereal test email service (no real delivery)');
  emailServiceInstance = new TestEmailService(notificationsTo || undefined);
  return emailServiceInstance;
}
