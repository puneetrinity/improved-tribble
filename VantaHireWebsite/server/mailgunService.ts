import FormData from 'form-data';
import Mailgun from 'mailgun.js';
import type { ContactSubmission } from '@shared/schema';

// Create a Mailgun client
const mailgun = new Mailgun(FormData);

class MailgunService {
  private client: any;
  private domain: string;
  private fromEmail: string;
  private toEmail: string;
  
  constructor(apiKey: string, domain: string, fromEmail: string, toEmail: string) {
    this.client = mailgun.client({ username: 'api', key: apiKey });
    this.domain = domain;
    this.fromEmail = fromEmail;
    this.toEmail = toEmail;
  }
  
  // Send notification for new contact submission
  async sendContactNotification(submission: ContactSubmission): Promise<boolean> {
    try {
      const { name, email, phone, company, message } = submission;
      
      const messageData = {
        from: `VantaHire <${this.fromEmail}>`,
        to: this.toEmail,
        subject: `New Contact Form Submission from ${name}`,
        html: `
          <h2>New Contact Form Submission</h2>
          <p><strong>Date:</strong> ${new Date(submission.submittedAt || Date.now()).toLocaleString()}</p>
          <hr />
          <h3>Contact Details:</h3>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
          <p><strong>Company:</strong> ${company || 'Not provided'}</p>
          <h3>Message:</h3>
          <p>${message}</p>
        `,
        text: `
          New Contact Form Submission
          
          Date: ${new Date(submission.submittedAt || Date.now()).toLocaleString()}
          
          Contact Details:
          Name: ${name}
          Email: ${email}
          Phone: ${phone || 'Not provided'}
          Company: ${company || 'Not provided'}
          
          Message:
          ${message}
        `
      };
      
      // Send the email
      const result = await this.client.messages.create(this.domain, messageData);
      console.log('Email sent successfully:', result.id);
      return true;
    } catch (error) {
      console.error('Error sending email notification:', error);
      return false;
    }
  }
  
  // Verify the connection by sending a test email
  async verifyConnection(): Promise<boolean> {
    try {
      const testData = {
        from: `VantaHire <${this.fromEmail}>`,
        to: this.toEmail,
        subject: 'Mailgun Connection Test',
        text: 'This is a test email to verify Mailgun configuration.',
        html: '<p>This is a test email to verify Mailgun configuration.</p>'
      };
      
      const result = await this.client.messages.create(this.domain, testData);
      console.log('Test email sent successfully:', result.id);
      return true;
    } catch (error) {
      console.error('Error connecting to Mailgun:', error);
      return false;
    }
  }
}

// Get Mailgun credentials from environment variables
const getMailgunService = (): MailgunService | null => {
  const { 
    MAILGUN_API_KEY, 
    MAILGUN_DOMAIN,
    MAILGUN_FROM_EMAIL,
    NOTIFICATION_EMAIL
  } = process.env;
  
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN || !NOTIFICATION_EMAIL) {
    console.warn('Mailgun service not configured. Missing required environment variables.');
    return null;
  }
  
  // Default from email if not specified
  const fromEmail = MAILGUN_FROM_EMAIL || `noreply@${MAILGUN_DOMAIN}`;
  
  console.log(`Mailgun service configured for domain ${MAILGUN_DOMAIN}`);
  return new MailgunService(MAILGUN_API_KEY, MAILGUN_DOMAIN, fromEmail, NOTIFICATION_EMAIL);
};

export const mailgunService = getMailgunService();