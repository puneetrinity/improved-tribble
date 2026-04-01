import cron from 'node-cron';
import { storage } from './storage';
import { db } from './db';
import {
  jobs,
  applications,
  users,
  hiringManagerInvitations,
  coRecruiterInvitations,
  organizationSubscriptions,
  organizationMembers,
  organizations,
  subscriptionPlans,
  subscriptionAlerts
} from '@shared/schema';
import { lt, eq, and, sql, or, gte, lte, isNull } from 'drizzle-orm';
import { getEmailService } from './simpleEmailService';
import { resetOrgCredits } from './lib/creditService';

// Job lifecycle scheduler with activity-based deactivation
export function startJobScheduler() {
  // Gate scheduler to prevent duplicate runs in multi-instance deployments
  if (process.env.ENABLE_SCHEDULER !== 'true') {
    console.log('⏸️  Job scheduler disabled (ENABLE_SCHEDULER not set to true)');
    console.log('   Set ENABLE_SCHEDULER=true on ONE instance to enable scheduled jobs');
    return;
  }

  console.log('✅ Job scheduler enabled - starting cron jobs');

  // Run daily at 2 AM: Send warning emails (7 days before deactivation)
  cron.schedule('0 2 * * *', async () => {
    console.log('Running job expiration warning check...');

    try {
      await sendDeactivationWarnings();
    } catch (error) {
      console.error('Error during warning email send:', error);
    }
  });

  // Run daily at 3 AM: Deactivate old inactive jobs (activity-based)
  cron.schedule('0 3 * * *', async () => {
    console.log('Running activity-based job deactivation check...');

    try {
      await deactivateInactiveJobs();
    } catch (error) {
      console.error('Error during job deactivation:', error);
    }
  });

  // Run weekly on Sunday at 4 AM: Clean up declined jobs and expired invitations
  cron.schedule('0 4 * * 0', async () => {
    console.log('Running weekly cleanup...');

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Archive declined jobs older than 30 days
      const archivedJobs = await db
        .update(jobs)
        .set({
          isActive: false,
          deactivatedAt: new Date(),
          deactivationReason: 'declined'
        })
        .where(
          and(
            eq(jobs.status, 'declined'),
            lt(jobs.createdAt, thirtyDaysAgo)
          )
        )
        .returning();

      if (archivedJobs.length > 0) {
        console.log(`Archived ${archivedJobs.length} declined jobs`);
      } else {
        console.log('No declined jobs to archive');
      }

      // Clean up expired hiring manager invitations
      await cleanupExpiredInvitations();

      // Clean up old AI fit jobs
      await cleanupOldAiFitJobs();

    } catch (error) {
      console.error('Error during weekly cleanup:', error);
    }
  });

  // Run daily at 5 AM: Send subscription renewal reminders (7 days and 3 days before)
  cron.schedule('0 5 * * *', async () => {
    console.log('Running subscription renewal reminder check...');

    try {
      await sendSubscriptionRenewalReminders();
    } catch (error) {
      console.error('Error during subscription renewal reminders:', error);
    }
  });

  // Run daily at 6 AM: Process grace period expirations
  cron.schedule('0 6 * * *', async () => {
    console.log('Running subscription grace period check...');

    try {
      await processGracePeriodExpirations();
    } catch (error) {
      console.error('Error during grace period processing:', error);
    }
  });

  // Run on the 1st of each month at 1 AM: Reset monthly AI credits
  cron.schedule('0 1 1 * *', async () => {
    console.log('Running monthly AI credit reset...');

    try {
      await resetMonthlyAiCredits();
    } catch (error) {
      console.error('Error during monthly credit reset:', error);
    }
  });

  // Run daily at 7 AM: Clean up expired organization invites
  cron.schedule('0 7 * * *', async () => {
    console.log('Running organization invite cleanup...');

    try {
      await cleanupExpiredOrgInvites();
    } catch (error) {
      console.error('Error during org invite cleanup:', error);
    }
  });

  console.log('📅 Job scheduler started successfully:');
  console.log('   - Warning emails: Daily at 2 AM (7 days before deactivation)');
  console.log('   - Job deactivation: Daily at 3 AM (activity-based)');
  console.log('   - Weekly cleanup: Sunday at 4 AM (declined jobs + expired invitations + old AI fit jobs)');
  console.log('   - Subscription renewal reminders: Daily at 5 AM');
  console.log('   - Grace period processing: Daily at 6 AM');
  console.log('   - Monthly credit reset: 1st of month at 1 AM');
  console.log('   - Org invite cleanup: Daily at 7 AM');
}

/**
 * Send warning emails 7 days before auto-deactivation
 */
async function sendDeactivationWarnings(): Promise<void> {
  const fiftyThreeDaysAgo = new Date();
  fiftyThreeDaysAgo.setDate(fiftyThreeDaysAgo.getDate() - 53); // 60 - 7 = 53 days old

  // Find jobs that are 53 days old and haven't received warning email yet
  const jobsNearExpiry = await db
    .select({
      job: jobs,
      recruiter: users
    })
    .from(jobs)
    .leftJoin(users, eq(jobs.postedBy, users.id))
    .where(
      and(
        eq(jobs.isActive, true),
        eq(jobs.status, 'approved'),
        lt(jobs.createdAt, fiftyThreeDaysAgo),
        eq(jobs.warningEmailSent, false)
      )
    );

  if (jobsNearExpiry.length === 0) {
    console.log('No jobs need warning emails');
    return;
  }

  console.log(`Sending warning emails for ${jobsNearExpiry.length} jobs...`);

  const emailService = await getEmailService();
  if (!emailService) {
    console.warn('Email service not configured - skipping warning emails');
    return;
  }

  for (const { job, recruiter } of jobsNearExpiry) {
    if (!recruiter) continue;

    try {
      await emailService.sendEmail({
        to: recruiter.username, // Assuming username is email
        subject: `Action Required: Job "${job.title}" will auto-close in 7 days`,
        html: `
          <h2>Job Expiration Warning</h2>
          <p>Hello ${recruiter.firstName || recruiter.username},</p>
          <p>Your job posting <strong>"${job.title}"</strong> will be automatically deactivated in 7 days due to inactivity.</p>

          <h3>Job Details:</h3>
          <ul>
            <li><strong>Title:</strong> ${job.title}</li>
            <li><strong>Location:</strong> ${job.location}</li>
            <li><strong>Posted:</strong> ${new Date(job.createdAt).toLocaleDateString()}</li>
            <li><strong>Auto-closes:</strong> ${new Date(new Date(job.createdAt).getTime() + 60 * 24 * 60 * 60 * 1000).toLocaleDateString()}</li>
          </ul>

          <h3>Why is this happening?</h3>
          <p>Jobs are automatically deactivated after 60 days to ensure our listings stay fresh and relevant.</p>

          <h3>What can you do?</h3>
          <ul>
            <li>If the position is still open: No action needed, it will deactivate automatically</li>
            <li>If you filled the position: You can manually close it now</li>
            <li>After deactivation: Contact an admin to reactivate if needed</li>
          </ul>

          <p>Login to your dashboard to manage this job posting.</p>
          <p>Thank you for using VantaHire!</p>
        `
      });

      // Mark warning as sent
      await db
        .update(jobs)
        .set({ warningEmailSent: true })
        .where(eq(jobs.id, job.id));

      console.log(`Warning email sent for job ${job.id}: "${job.title}"`);
    } catch (error) {
      console.error(`Failed to send warning for job ${job.id}:`, error);
    }
  }

  console.log(`Sent ${jobsNearExpiry.length} warning emails`);
}

/**
 * Deactivate jobs older than 60 days with no recent activity
 */
async function deactivateInactiveJobs(): Promise<void> {
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  // Find old active jobs
  const oldJobs = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.isActive, true),
        eq(jobs.status, 'approved'),
        lt(jobs.createdAt, sixtyDaysAgo)
      )
    );

  if (oldJobs.length === 0) {
    console.log('No jobs to deactivate');
    return;
  }

  console.log(`Checking ${oldJobs.length} old jobs for activity...`);

  let deactivatedCount = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < oldJobs.length; i += BATCH_SIZE) {
    const batch = oldJobs.slice(i, i + BATCH_SIZE);

    for (const job of batch) {
      try {
        // Check for recent applications (last 14 days)
        const recentApplications = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(applications)
          .where(
            and(
              eq(applications.jobId, job.id),
              sql`${applications.appliedAt} > ${fourteenDaysAgo}`
            )
          );

        const hasRecentActivity = recentApplications[0]?.count > 0;

        // Check for upcoming interviews
        const upcomingInterviews = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(applications)
          .where(
            and(
              eq(applications.jobId, job.id),
              sql`${applications.interviewDate} > NOW()`
            )
          );

        const hasUpcomingInterviews = upcomingInterviews[0]?.count > 0;

        // Only deactivate if no recent activity and no upcoming interviews
        if (!hasRecentActivity && !hasUpcomingInterviews) {
          await storage.updateJobStatus(job.id, false, 'auto_expired', 1); // performedBy: system admin (ID 1)
          deactivatedCount++;
          console.log(`Deactivated job ${job.id}: "${job.title}" (no recent activity)`);
        } else {
          console.log(`Keeping job ${job.id}: "${job.title}" (has recent activity or interviews)`);
        }
      } catch (error) {
        console.error(`Error processing job ${job.id}:`, error);
      }
    }
  }

  console.log(`Deactivated ${deactivatedCount} of ${oldJobs.length} old jobs`);
}

// Utility function to manually expire a job
export async function expireJob(jobId: number, reason?: string, performedBy?: number): Promise<boolean> {
  try {
    const result = await storage.updateJobStatus(jobId, false, reason || 'manual', performedBy);
    return !!result;
  } catch (error) {
    console.error('Error expiring job:', error);
    return false;
  }
}

// Get jobs that are about to expire (within 7 days)
export async function getJobsNearExpiry(): Promise<any[]> {
  try {
    const fiftyThreeDaysAgo = new Date();
    fiftyThreeDaysAgo.setDate(fiftyThreeDaysAgo.getDate() - 53);

    const nearExpiryJobs = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.isActive, true),
          lt(jobs.createdAt, fiftyThreeDaysAgo),
          eq(jobs.warningEmailSent, false)
        )
      );

    return nearExpiryJobs;
  } catch (error) {
    console.error('Error getting jobs near expiry:', error);
    return [];
  }
}

/**
 * Clean up expired hiring manager invitations
 * - Mark expired pending invitations as 'expired'
 * - Delete old expired/accepted invitations (older than 30 days)
 */
async function cleanupExpiredInvitations(): Promise<void> {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // ===== Hiring Manager Invitations =====
    // Mark pending invitations past expiry as 'expired'
    const hmMarkedExpired = await db
      .update(hiringManagerInvitations)
      .set({ status: 'expired' })
      .where(
        and(
          eq(hiringManagerInvitations.status, 'pending'),
          lt(hiringManagerInvitations.expiresAt, now)
        )
      )
      .returning();

    if (hmMarkedExpired.length > 0) {
      console.log(`Marked ${hmMarkedExpired.length} pending hiring manager invitations as expired`);
    }

    // Delete old expired or accepted invitations (older than 30 days)
    const hmDeleted = await db
      .delete(hiringManagerInvitations)
      .where(
        and(
          or(
            eq(hiringManagerInvitations.status, 'expired'),
            eq(hiringManagerInvitations.status, 'accepted')
          ),
          lt(hiringManagerInvitations.createdAt, thirtyDaysAgo)
        )
      )
      .returning();

    if (hmDeleted.length > 0) {
      console.log(`Deleted ${hmDeleted.length} old hiring manager invitations (expired/accepted > 30 days)`);
    }

    // ===== Co-Recruiter Invitations =====
    // Mark pending invitations past expiry as 'expired'
    const crMarkedExpired = await db
      .update(coRecruiterInvitations)
      .set({ status: 'expired' })
      .where(
        and(
          eq(coRecruiterInvitations.status, 'pending'),
          lt(coRecruiterInvitations.expiresAt, now)
        )
      )
      .returning();

    if (crMarkedExpired.length > 0) {
      console.log(`Marked ${crMarkedExpired.length} pending co-recruiter invitations as expired`);
    }

    // Delete old expired or accepted invitations (older than 30 days)
    const crDeleted = await db
      .delete(coRecruiterInvitations)
      .where(
        and(
          or(
            eq(coRecruiterInvitations.status, 'expired'),
            eq(coRecruiterInvitations.status, 'accepted')
          ),
          lt(coRecruiterInvitations.createdAt, thirtyDaysAgo)
        )
      )
      .returning();

    if (crDeleted.length > 0) {
      console.log(`Deleted ${crDeleted.length} old co-recruiter invitations (expired/accepted > 30 days)`);
    }

    if (hmDeleted.length === 0 && crDeleted.length === 0) {
      console.log('No old invitations to delete');
    }
  } catch (error) {
    console.error('Error cleaning up expired invitations:', error);
  }
}

/**
 * Clean up old AI fit jobs
 * - Delete completed/failed/cancelled jobs older than 30 days
 */
async function cleanupOldAiFitJobs(): Promise<void> {
  try {
    const deleted = await storage.cleanupOldAiFitJobs(30);
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} old AI fit jobs`);
    } else {
      console.log('No old AI fit jobs to clean up');
    }
  } catch (error) {
    console.error('Error cleaning up old AI fit jobs:', error);
  }
}

// ========================================
// Subscription & Organization Scheduled Tasks
// ========================================

/**
 * Send subscription renewal reminders
 * - 7 days before period end
 * - 3 days before period end
 */
export async function sendSubscriptionRenewalReminders(): Promise<void> {
  const emailService = await getEmailService();
  if (!emailService) {
    console.warn('Email service not configured - skipping renewal reminders');
    return;
  }

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  // Find subscriptions ending in ~7 days (between 6.5 and 7.5 days)
  const sevenDayMin = new Date(now.getTime() + 6.5 * 24 * 60 * 60 * 1000);
  const sevenDayMax = new Date(now.getTime() + 7.5 * 24 * 60 * 60 * 1000);

  // Find subscriptions ending in ~3 days (between 2.5 and 3.5 days)
  const threeDayMin = new Date(now.getTime() + 2.5 * 24 * 60 * 60 * 1000);
  const threeDayMax = new Date(now.getTime() + 3.5 * 24 * 60 * 60 * 1000);

  // Find subscriptions ending in ~1 day (between 0.5 and 1.5 days)
  const oneDayMin = new Date(now.getTime() + 0.5 * 24 * 60 * 60 * 1000);
  const oneDayMax = new Date(now.getTime() + 1.5 * 24 * 60 * 60 * 1000);

  try {
    // 7-day reminders
    const sevenDaySubscriptions = await db
      .select({
        subscription: organizationSubscriptions,
        organization: organizations,
        plan: subscriptionPlans,
      })
      .from(organizationSubscriptions)
      .innerJoin(organizations, eq(organizationSubscriptions.organizationId, organizations.id))
      .innerJoin(subscriptionPlans, eq(organizationSubscriptions.planId, subscriptionPlans.id))
      .where(
        and(
          eq(organizationSubscriptions.status, 'active'),
          gte(organizationSubscriptions.currentPeriodEnd, sevenDayMin),
          lte(organizationSubscriptions.currentPeriodEnd, sevenDayMax)
        )
      );

    for (const { subscription, organization, plan } of sevenDaySubscriptions) {
      // Check if we already sent a 7-day reminder
      const existingAlert = await db
        .select()
        .from(subscriptionAlerts)
        .where(
          and(
            eq(subscriptionAlerts.subscriptionId, subscription.id),
            eq(subscriptionAlerts.alertType, 'renewal_7day')
          )
        )
        .limit(1);

      if (existingAlert.length > 0) continue;

      // Get billing contact or org owner
      const billingEmail = organization.billingContactEmail || await getOrgOwnerEmail(organization.id);
      if (!billingEmail) continue;

      await emailService.sendEmail({
        to: billingEmail,
        subject: `VantaHire paid term ends in 7 days - ${organization.name}`,
        html: `
          <h2>Paid Term Reminder</h2>
          <p>Hello,</p>
          <p>Your current VantaHire paid term for <strong>${organization.name}</strong> ends in 7 days.</p>

          <h3>Billing Details:</h3>
          <ul>
            <li><strong>Plan:</strong> ${plan.displayName}</li>
            <li><strong>Seats:</strong> ${subscription.seats}</li>
            <li><strong>Billing Cycle:</strong> ${subscription.billingCycle}</li>
            <li><strong>Term End Date:</strong> ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}</li>
          </ul>

          <p>If you want uninterrupted paid access, please visit billing before the term ends.</p>
          <p>You can review seats and billing from your account settings.</p>

          <p>Thank you for using VantaHire!</p>
        `
      });

      // Record the alert
      await db.insert(subscriptionAlerts).values({
        subscriptionId: subscription.id,
        alertType: 'renewal_7day',
        recipientEmail: billingEmail,
        emailStatus: 'sent'
      });

      console.log(`Sent 7-day renewal reminder for org ${organization.id}`);
    }

    // 3-day reminders
    const threeDaySubscriptions = await db
      .select({
        subscription: organizationSubscriptions,
        organization: organizations,
        plan: subscriptionPlans,
      })
      .from(organizationSubscriptions)
      .innerJoin(organizations, eq(organizationSubscriptions.organizationId, organizations.id))
      .innerJoin(subscriptionPlans, eq(organizationSubscriptions.planId, subscriptionPlans.id))
      .where(
        and(
          eq(organizationSubscriptions.status, 'active'),
          gte(organizationSubscriptions.currentPeriodEnd, threeDayMin),
          lte(organizationSubscriptions.currentPeriodEnd, threeDayMax)
        )
      );

    for (const { subscription, organization, plan } of threeDaySubscriptions) {
      // Check if we already sent a 3-day reminder
      const existingAlert = await db
        .select()
        .from(subscriptionAlerts)
        .where(
          and(
            eq(subscriptionAlerts.subscriptionId, subscription.id),
            eq(subscriptionAlerts.alertType, 'renewal_3day')
          )
        )
        .limit(1);

      if (existingAlert.length > 0) continue;

      const billingEmail = organization.billingContactEmail || await getOrgOwnerEmail(organization.id);
      if (!billingEmail) continue;

      await emailService.sendEmail({
        to: billingEmail,
        subject: `VantaHire paid term ends in 3 days - ${organization.name}`,
        html: `
          <h2>Paid Term Reminder</h2>
          <p>Hello,</p>
          <p>Your current VantaHire paid term for <strong>${organization.name}</strong> ends in 3 days.</p>

          <h3>Billing Details:</h3>
          <ul>
            <li><strong>Plan:</strong> ${plan.displayName}</li>
            <li><strong>Seats:</strong> ${subscription.seats}</li>
            <li><strong>Term End Date:</strong> ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}</li>
          </ul>

          <p>If you want uninterrupted paid access, please complete your next payment from billing.</p>
          <p>Thank you for using VantaHire!</p>
        `
      });

      await db.insert(subscriptionAlerts).values({
        subscriptionId: subscription.id,
        alertType: 'renewal_3day',
        recipientEmail: billingEmail,
        emailStatus: 'sent'
      });

      console.log(`Sent 3-day renewal reminder for org ${organization.id}`);
    }

    // 1-day reminders
    const oneDaySubscriptions = await db
      .select({
        subscription: organizationSubscriptions,
        organization: organizations,
        plan: subscriptionPlans,
      })
      .from(organizationSubscriptions)
      .innerJoin(organizations, eq(organizationSubscriptions.organizationId, organizations.id))
      .innerJoin(subscriptionPlans, eq(organizationSubscriptions.planId, subscriptionPlans.id))
      .where(
        and(
          eq(organizationSubscriptions.status, 'active'),
          gte(organizationSubscriptions.currentPeriodEnd, oneDayMin),
          lte(organizationSubscriptions.currentPeriodEnd, oneDayMax)
        )
      );

    for (const { subscription, organization, plan } of oneDaySubscriptions) {
      // Check if we already sent a 1-day reminder
      const existingAlert = await db
        .select()
        .from(subscriptionAlerts)
        .where(
          and(
            eq(subscriptionAlerts.subscriptionId, subscription.id),
            eq(subscriptionAlerts.alertType, 'renewal_1day')
          )
        )
        .limit(1);

      if (existingAlert.length > 0) continue;

      const billingEmail = organization.billingContactEmail || await getOrgOwnerEmail(organization.id);
      if (!billingEmail) continue;

      await emailService.sendEmail({
        to: billingEmail,
        subject: `VantaHire paid term ends tomorrow - ${organization.name}`,
        html: `
          <h2>Paid Term Ends Tomorrow</h2>
          <p>Hello,</p>
          <p>Your current VantaHire paid term for <strong>${organization.name}</strong> ends <strong>tomorrow</strong>.</p>

          <h3>Billing Details:</h3>
          <ul>
            <li><strong>Plan:</strong> ${plan.displayName}</li>
            <li><strong>Seats:</strong> ${subscription.seats}</li>
            <li><strong>Term End Date:</strong> ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}</li>
          </ul>

          <p>Please complete your next payment from billing today to avoid any service interruption.</p>
          <p>Thank you for using VantaHire!</p>
        `
      });

      await db.insert(subscriptionAlerts).values({
        subscriptionId: subscription.id,
        alertType: 'renewal_1day',
        recipientEmail: billingEmail,
        emailStatus: 'sent'
      });

      console.log(`Sent 1-day renewal reminder for org ${organization.id}`);
    }
  } catch (error) {
    console.error('Error sending renewal reminders:', error);
  }
}

/**
 * Process grace period expirations
 * - After 3-day grace period, downgrade to Free plan
 * - Unseat members beyond the free tier limit
 */
export async function processGracePeriodExpirations(): Promise<void> {
  const now = new Date();

  try {
    // Find subscriptions past their grace period
    const expiredGraceSubscriptions = await db
      .select({
        subscription: organizationSubscriptions,
        organization: organizations,
      })
      .from(organizationSubscriptions)
      .innerJoin(organizations, eq(organizationSubscriptions.organizationId, organizations.id))
      .where(
        and(
          eq(organizationSubscriptions.status, 'past_due'),
          lte(organizationSubscriptions.gracePeriodEndDate, now)
        )
      );

    if (expiredGraceSubscriptions.length === 0) {
      console.log('No grace periods expired');
      return;
    }

    const emailService = await getEmailService();

    for (const { subscription, organization } of expiredGraceSubscriptions) {
      console.log(`Processing grace period expiration for org ${organization.id}`);

      // Get the free plan
      const freePlan = await db
        .select()
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.name, 'free'))
        .limit(1);

      if (freePlan.length === 0) {
        console.error('Free plan not found in database');
        continue;
      }

      // Downgrade to free plan
      await db
        .update(organizationSubscriptions)
        .set({
          planId: freePlan[0].id,
          seats: 1,
          status: 'cancelled',
          cancelledAt: now,
          updatedAt: now,
        })
        .where(eq(organizationSubscriptions.id, subscription.id));

      // Unseat all members except the owner (who is most recently active)
      const members = await db
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, organization.id))
        .orderBy(sql`
          CASE WHEN ${organizationMembers.role} = 'owner' THEN 0 ELSE 1 END,
          ${organizationMembers.lastActivityAt} DESC NULLS LAST
        `);

      // Keep only the first member (owner) seated
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        if (i === 0) {
          // Keep owner seated
          await db
            .update(organizationMembers)
            .set({ seatAssigned: true })
            .where(eq(organizationMembers.id, member.id));
        } else {
          // Unseat others
          await db
            .update(organizationMembers)
            .set({
              seatAssigned: false,
              creditsAllocated: 0,
              creditsUsed: 0,
              creditsRollover: 0,
            })
            .where(eq(organizationMembers.id, member.id));

          // Notify unseated member
          if (emailService) {
            const memberUser = await db
              .select()
              .from(users)
              .where(eq(users.id, member.userId))
              .limit(1);

            if (memberUser.length > 0) {
              await emailService.sendEmail({
                to: memberUser[0].username,
                subject: `Your seat has been removed - ${organization.name}`,
                html: `
                  <h2>Seat Removed</h2>
                  <p>Hello ${memberUser[0].firstName || memberUser[0].username},</p>
                  <p>Your seat in <strong>${organization.name}</strong> has been removed due to a subscription downgrade.</p>
                  <p>The organization's payment failed and the grace period has expired.</p>
                  <p>Please contact your organization owner for more information.</p>
                `
              });
            }
          }
        }
      }

      // Notify org owner
      const ownerEmail = await getOrgOwnerEmail(organization.id);
      if (ownerEmail && emailService) {
        await emailService.sendEmail({
          to: ownerEmail,
          subject: `VantaHire subscription cancelled - ${organization.name}`,
          html: `
            <h2>Subscription Cancelled</h2>
            <p>Hello,</p>
            <p>Your VantaHire subscription for <strong>${organization.name}</strong> has been cancelled due to payment failure.</p>
            <p>Your organization has been downgraded to the Free plan with 1 seat.</p>
            <p>To restore paid access, please start a new payment from billing.</p>
          `
        });
      }

      console.log(`Downgraded org ${organization.id} to Free plan after grace period expiration`);
    }
  } catch (error) {
    console.error('Error processing grace period expirations:', error);
  }
}

/**
 * Reset monthly AI credits for all organization members
 * - Allocate new credits based on plan
 * - Calculate rollover (up to 3-month cap)
 */
async function resetMonthlyAiCredits(): Promise<void> {
  try {
    const activeSubscriptions = await db.query.organizationSubscriptions.findMany({
      where: eq(organizationSubscriptions.status, 'active'),
    });

    console.log(`Processing credit reset for ${activeSubscriptions.length} active subscriptions`);

    for (const subscription of activeSubscriptions) {
      await resetOrgCredits(subscription.organizationId);
      console.log(`Reset org credits for org ${subscription.organizationId}`);
    }

    console.log('Monthly credit reset completed');
  } catch (error) {
    console.error('Error during monthly credit reset:', error);
  }
}

/**
 * Clean up expired organization invites
 */
async function cleanupExpiredOrgInvites(): Promise<void> {
  try {
    const { organizationInvites } = await import('@shared/schema');
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Mark expired pending invites
    await db
      .update(organizationInvites)
      .set({ acceptedAt: null }) // Keep as pending but expired
      .where(
        and(
          isNull(organizationInvites.acceptedAt),
          lt(organizationInvites.expiresAt, now)
        )
      );

    // Delete old invites (accepted or expired more than 30 days ago)
    const deleted = await db
      .delete(organizationInvites)
      .where(
        and(
          lt(organizationInvites.expiresAt, thirtyDaysAgo)
        )
      )
      .returning();

    if (deleted.length > 0) {
      console.log(`Cleaned up ${deleted.length} old organization invites`);
    } else {
      console.log('No old organization invites to clean up');
    }
  } catch (error) {
    console.error('Error cleaning up organization invites:', error);
  }
}

/**
 * Helper: Get organization owner's email
 */
async function getOrgOwnerEmail(organizationId: number): Promise<string | null> {
  const ownerMember = await db
    .select({
      user: users,
    })
    .from(organizationMembers)
    .innerJoin(users, eq(organizationMembers.userId, users.id))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.role, 'owner')
      )
    )
    .limit(1);

  return ownerMember.length > 0 ? ownerMember[0].user.username : null;
}
