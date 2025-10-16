import cron from 'node-cron';
import { storage } from './storage';
import { db } from './db';
import { jobs } from '@shared/schema';
import { lt, eq } from 'drizzle-orm';

// Job expiration scheduler
export function startJobScheduler() {
  // Run daily at 2 AM to check for expired jobs
  cron.schedule('0 2 * * *', async () => {
    console.log('Running job expiration check...');
    
    try {
      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
      
      // Find and expire jobs older than 60 days
      const expiredJobs = await db
        .update(jobs)
        .set({ 
          isActive: false,
          expiresAt: new Date()
        })
        .where(
          lt(jobs.createdAt, sixtyDaysAgo)
        )
        .returning();
      
      if (expiredJobs.length > 0) {
        console.log(`Expired ${expiredJobs.length} jobs older than 60 days`);
      } else {
        console.log('No jobs to expire');
      }
    } catch (error) {
      console.error('Error during job expiration check:', error);
    }
  });

  // Run weekly on Sunday at 3 AM to clean up old declined jobs
  cron.schedule('0 3 * * 0', async () => {
    console.log('Running declined job cleanup...');
    
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Archive declined jobs older than 30 days
      const archivedJobs = await db
        .update(jobs)
        .set({ 
          isActive: false
        })
        .where(
          eq(jobs.status, 'declined')
        )
        .returning();
      
      if (archivedJobs.length > 0) {
        console.log(`Archived ${archivedJobs.length} declined jobs`);
      } else {
        console.log('No declined jobs to archive');
      }
    } catch (error) {
      console.error('Error during declined job cleanup:', error);
    }
  });

  console.log('Job scheduler started - checking for expired jobs daily at 2 AM');
}

// Utility function to manually expire a job
export async function expireJob(jobId: number): Promise<boolean> {
  try {
    const [expiredJob] = await db
      .update(jobs)
      .set({ 
        isActive: false,
        expiresAt: new Date()
      })
      .where(eq(jobs.id, jobId))
      .returning();
    
    return !!expiredJob;
  } catch (error) {
    console.error('Error expiring job:', error);
    return false;
  }
}

// Get jobs that are about to expire (within 7 days)
export async function getJobsNearExpiry(): Promise<any[]> {
  try {
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    
    const fiftyThreeDaysAgo = new Date();
    fiftyThreeDaysAgo.setDate(fiftyThreeDaysAgo.getDate() - 53);
    
    const nearExpiryJobs = await db
      .select()
      .from(jobs)
      .where(
        lt(jobs.createdAt, fiftyThreeDaysAgo)
      );
    
    return nearExpiryJobs;
  } catch (error) {
    console.error('Error getting jobs near expiry:', error);
    return [];
  }
}