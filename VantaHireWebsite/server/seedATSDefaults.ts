/**
 * Seed default ATS data: Pipeline stages and email templates
 * Run once to populate default stages and email templates
 */

import { db } from './db';
import { pipelineStages, emailTemplates } from '../shared/schema';
import { eq } from 'drizzle-orm';

export async function seedDefaultPipelineStages() {
  console.log('🌱 Seeding default pipeline stages...');

  const defaultStages = [
    { name: 'Applied', order: 1, color: '#6b7280', isDefault: true }, // gray
    { name: 'Screening', order: 2, color: '#3b82f6', isDefault: true }, // blue
    { name: 'Interview Scheduled', order: 3, color: '#f59e0b', isDefault: true }, // amber
    { name: 'Offer Extended', order: 4, color: '#10b981', isDefault: true }, // green
    { name: 'Hired', order: 5, color: '#059669', isDefault: true }, // emerald
    { name: 'Rejected', order: 6, color: '#ef4444', isDefault: true }, // red
  ];

  for (const stage of defaultStages) {
    // Check if stage already exists
    const existing = await db.query.pipelineStages.findFirst({
      where: eq(pipelineStages.name, stage.name)
    });

    if (!existing) {
      await db.insert(pipelineStages).values(stage);
      console.log(`  ✓ Created stage: ${stage.name}`);
    } else {
      console.log(`  ⊘ Stage already exists: ${stage.name}`);
    }
  }

  console.log('✅ Pipeline stages seeded\n');
}

export async function seedDefaultEmailTemplates() {
  console.log('🌱 Seeding default email templates...');

  const defaultTemplates = [
    {
      name: 'Interview Invitation',
      subject: 'Interview Invitation - {{job_title}} at VantaHire',
      body: `Dear {{candidate_name}},

Thank you for applying for the {{job_title}} position at VantaHire!

We're impressed with your application and would like to invite you for an interview.

📅 Date: {{interview_date}}
🕐 Time: {{interview_time}}
📍 Location: {{interview_location}}

Please confirm your availability by replying to this email. If you have any questions or need to reschedule, don't hesitate to reach out.

We look forward to speaking with you!

Best regards,
{{recruiter_name}}
VantaHire Recruitment Team`,
      templateType: 'interview_invite',
      isDefault: true,
    },
    {
      name: 'Application Received',
      subject: 'Application Received - {{job_title}}',
      body: `Dear {{candidate_name}},

Thank you for your interest in the {{job_title}} position at VantaHire!

We've received your application and our team is currently reviewing all submissions. We'll be in touch soon regarding the next steps in our hiring process.

If you have any questions in the meantime, please don't hesitate to contact us.

Best regards,
{{recruiter_name}}
VantaHire Recruitment Team`,
      templateType: 'application_received',
      isDefault: true,
    },
    {
      name: 'Application Status Update',
      subject: 'Update on Your Application - {{job_title}}',
      body: `Dear {{candidate_name}},

We wanted to update you on your application for the {{job_title}} position.

Your application status has been updated to: {{new_status}}

We appreciate your patience throughout this process. If you have any questions, please feel free to reach out.

Best regards,
{{recruiter_name}}
VantaHire Recruitment Team`,
      templateType: 'status_update',
      isDefault: true,
    },
    {
      name: 'Offer Extended',
      subject: 'Job Offer - {{job_title}} at VantaHire',
      body: `Dear {{candidate_name}},

Congratulations! We're pleased to extend an offer for the {{job_title}} position at VantaHire.

We believe you'll be a great addition to our team. Attached you'll find the formal offer letter with details about compensation, benefits, and start date.

Please review the offer and let us know if you have any questions. We're excited about the possibility of you joining our team!

Best regards,
{{recruiter_name}}
VantaHire Recruitment Team`,
      templateType: 'offer_extended',
      isDefault: true,
    },
    {
      name: 'Application Not Selected',
      subject: 'Update on Your Application - {{job_title}}',
      body: `Dear {{candidate_name}},

Thank you for your interest in the {{job_title}} position at VantaHire and for taking the time to apply.

After careful consideration, we've decided to move forward with other candidates whose experience more closely aligns with our current needs.

We were impressed by your background and encourage you to apply for future opportunities that match your skills and experience. We'll keep your resume on file for consideration.

We wish you all the best in your job search.

Best regards,
{{recruiter_name}}
VantaHire Recruitment Team`,
      templateType: 'rejection',
      isDefault: true,
    },
  ];

  for (const template of defaultTemplates) {
    // Check if template already exists
    const existing = await db.query.emailTemplates.findFirst({
      where: eq(emailTemplates.name, template.name)
    });

    if (!existing) {
      await db.insert(emailTemplates).values(template);
      console.log(`  ✓ Created template: ${template.name}`);
    } else {
      console.log(`  ⊘ Template already exists: ${template.name}`);
    }
  }

  console.log('✅ Email templates seeded\n');
}

export async function seedAllATSDefaults() {
  try {
    await seedDefaultPipelineStages();
    await seedDefaultEmailTemplates();
    console.log('🎉 All ATS default data seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding ATS defaults:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedAllATSDefaults()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
