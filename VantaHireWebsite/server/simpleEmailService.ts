import nodemailer from 'nodemailer';
import type { ContactSubmission } from '@shared/schema';

// Simple interface for our email service
export interface EmailService {
  sendContactNotification(submission: ContactSubmission): Promise<boolean>;
  sendEmail?(opts: { to: string; subject: string; text: string }): Promise<boolean>;
}

// Implementation using Ethereal (a fake SMTP service for testing)
export class TestEmailService implements EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private toEmail: string;
  
  constructor(toEmail: string) {
    this.toEmail = toEmail;
  }
  
  // Initialize the transporter with an Ethereal test account
  async initialize(): Promise<boolean> {
    try {
      // Create a test account at Ethereal
      const testAccount = await nodemailer.createTestAccount();
      
      console.log('Created test email account:', testAccount.user);
      
      // Create a transporter using the test account
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false, // Use TLS
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      
      return true;
    } catch (error) {
      console.error('Failed to create test email account:', error);
      return false;
    }
  }
  
  // Send a notification email for a contact form submission
  async sendContactNotification(submission: ContactSubmission): Promise<boolean> {
    if (!this.transporter) {
      const initialized = await this.initialize();
      if (!initialized) {
        return false;
      }
    }
    
    try {
      const { name, email, phone, company, message } = submission;
      
      // Create email options
      const mailOptions = {
        from: '"VantaHire Contact" <no-reply@vantahire.com>',
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
      if (!this.transporter) {
        throw new Error("Email transporter not initialized");
      }
      const info = await this.transporter.sendMail(mailOptions);
      
      // Log the preview URL (Ethereal feature)
      console.log('Email notification sent successfully!');
      console.log('View email here: %s', nodemailer.getTestMessageUrl(info));
      console.log('(Copy and paste this URL into your browser to view the email)');
      
      return true;
    } catch (error) {
      console.error('Error sending email notification:', error);
      return false;
    }
  }
  
  async sendEmail(opts: { to: string; subject: string; text: string}): Promise<boolean> {
    if (!this.transporter) {
      const initialized = await this.initialize();
      if (!initialized) return false;
    }
    try {
      if (!this.transporter) return false;
      const info = await this.transporter.sendMail({
        from: '"VantaHire" <no-reply@vantahire.com>',
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
      });
      console.log('Email sent:', nodemailer.getTestMessageUrl(info));
      return true;
    } catch (e) {
      console.error('Email send error:', e);
      return false;
    }
  }
}

// Create and export a singleton instance
let emailServiceInstance: EmailService | null = null;

export async function getEmailService(): Promise<EmailService | null> {
  if (!emailServiceInstance) {
    console.log('Initializing email service...');
    const service = new TestEmailService('prafulladeori@gmail.com');
    emailServiceInstance = service;
  }
  
  return emailServiceInstance;
}
