import nodemailer from 'nodemailer';
import type { ContactSubmission } from '@shared/schema';

// Types
interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

// Email service using Nodemailer
class EmailService {
  private transporter: nodemailer.Transporter;
  private fromEmail: string;
  private toEmail: string;
  
  constructor(config: EmailConfig, toEmail: string) {
    this.transporter = nodemailer.createTransport(config);
    this.fromEmail = config.auth.user;
    this.toEmail = toEmail;
  }
  
  // Test the email connection
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      console.log('Email service is ready to send messages');
      return true;
    } catch (error) {
      console.error('Error connecting to email service:', error);
      return false;
    }
  }
  
  // Send notification for new contact submission
  async sendContactNotification(submission: ContactSubmission): Promise<boolean> {
    try {
      const { name, email, phone, company, message } = submission;
      
      const mailOptions = {
        from: `"VantaHire Contact" <${this.fromEmail}>`,
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
      
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent successfully:', info.messageId);
      return true;
    } catch (error) {
      console.error('Error sending email notification:', error);
      return false;
    }
  }
}

// Create a test account with Ethereal Email (a testing service that doesn't require setup)
const createTestEmailAccount = async (): Promise<EmailService | null> => {
  try {
    // Create a test account with Ethereal (fake emails for testing)
    const testAccount = await nodemailer.createTestAccount();
    console.log('Created test email account:', testAccount.user);
    
    // Standalone EmailService class for Ethereal test emails
    class EtherealEmailService extends EmailService {
      constructor(config: EmailConfig, toEmail: string) {
        super(config, toEmail);
      }
      
      async verifyConnection(): Promise<boolean> {
        try {
          await this.transporter.verify();
          console.log('Ethereal email service is ready to send messages');
          return true;
        } catch (error) {
          console.error('Error connecting to Ethereal email service:', error);
          return false;
        }
      }
      
      async sendContactNotification(submission: ContactSubmission): Promise<boolean> {
        try {
          const { name, email, phone, company, message } = submission;
          
          const mailOptions = {
            from: `"VantaHire Contact" <${this.fromEmail}>`,
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
          
          // Send email with Ethereal (no real emails sent)
          const info = await this.transporter.sendMail(mailOptions);
          
          // Log the URL where you can view the email (Ethereal feature)
          console.log('Test email sent!');
          console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
          console.log('To view the email, open this URL in your browser.');
          
          return true;
        } catch (error) {
          console.error('Error sending test email notification:', error);
          return false;
        }
      }
    }
    
    const config: EmailConfig = {
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    };
    
    // Use the notification email from env or default to test account
    const notificationEmail = process.env.NOTIFICATION_EMAIL || testAccount.user;
    
    console.log('Using Ethereal test email configuration - NO REAL EMAILS WILL BE SENT');
    console.log('Email preview links will be displayed in the console when a form is submitted');
    
    return new EtherealEmailService(config, notificationEmail);
  } catch (error) {
    console.error('Failed to create test email account:', error);
    return null;
  }
};

// Get email service from environment variables or create a test one
const getEmailService = async (): Promise<EmailService | null> => {
  console.log('Setting up email service for notifications...');
  
  // Always use Ethereal for reliable testing without requiring credentials
  console.log('Creating test email account with Ethereal...');
  return await createTestEmailAccount();
};

// Initialize the email service asynchronously
let emailServiceInstance: EmailService | null = null;

// Function to get or initialize the email service
export async function getEmailServiceInstance(): Promise<EmailService | null> {
  if (!emailServiceInstance) {
    emailServiceInstance = await getEmailService();
  }
  return emailServiceInstance;
}

// For backwards compatibility with existing code
export const emailService = null;