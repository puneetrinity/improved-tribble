# Job Lifecycle Implementation - Complete Guide

> **Historical implementation note.** References to automatic startup
> migration or `MIGRATE_ON_START` are superseded by the append-only release
> migrator and read-only `schema-ready` startup contract in Flow Gate 1A0-R.

## 🎯 Overview

This document outlines the complete implementation of the **Job Deactivation/Reactivation System** for VantaHire. This feature allows jobs to be deactivated while preserving all application data, and enables admins to reactivate jobs when needed.

---

## ✅ **COMPLETED: Backend Implementation (Phases 1-5)**

### **Phase 1: Database Schema** ✅

#### **Files Modified:**
- `shared/schema.ts` (lines 26-57)
- `server/bootstrapSchema.ts` (lines 247-283)

#### **What Was Added:**

**1. New Columns in `jobs` Table:**
```sql
deactivated_at TIMESTAMP           -- When job was deactivated
reactivated_at TIMESTAMP           -- When job was last reactivated
reactivation_count INTEGER DEFAULT 0  -- Number of times reactivated
deactivation_reason TEXT           -- Reason: 'manual', 'auto_expired', 'filled', 'cancelled'
warning_email_sent BOOLEAN DEFAULT FALSE  -- Warning email sent flag
```

**2. New Table: `job_audit_log`:**
```sql
CREATE TABLE job_audit_log (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  action TEXT NOT NULL,  -- 'created', 'approved', 'declined', 'deactivated', 'reactivated'
  performed_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT,
  metadata JSONB,
  timestamp TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Indexes:
- job_audit_log_job_id_idx
- job_audit_log_timestamp_idx
- job_audit_log_action_idx
```

**3. Backfill Logic:**
- Existing inactive jobs automatically assigned `deactivatedAt = updatedAt`
- Reason set to `'manual'` for historical jobs

---

### **Phase 2: API Guards & Security** ✅

#### **Files Modified:**
- `server/routes.ts` (lines 35-95, 457-486, 489-508, 751-774)

#### **What Was Added:**

**1. Middleware: `checkJobActive`**
- Checks job ownership (recruiters can only access their own jobs)
- Enforces read-only access on inactive jobs
- Returns 404 for inactive jobs (public users)
- Allows specific read-only actions on inactive jobs

**2. Read-Only Action Whitelist:**
```typescript
const ALLOWED_INACTIVE_ACTIONS = [
  'GET /api/jobs/:id',                     // View job details
  'GET /api/jobs/:id/applications',        // View applications
  'POST /api/applications/:id/email',      // Send rejection emails
  'GET /api/applications/:id/resume',      // Download resume
  'POST /api/jobs/:id/applications/export' // Export data
];
```

**3. Updated Endpoints:**
- **GET /api/jobs/:id** - Returns 404 for inactive jobs (public)
- **POST /api/jobs/:id/apply** - Race condition guard (checks `isActive` before creating application)
- **GET /api/jobs/:id/applications** - Ownership check for recruiters

---

### **Phase 3: Storage Layer** ✅

#### **Files Modified:**
- `server/storage.ts` (lines 1-36, 254-322, 62-63)

#### **What Was Added:**

**1. Updated `updateJobStatus` Function:**
```typescript
async updateJobStatus(
  id: number,
  isActive: boolean,
  reason?: string,
  performedBy?: number
): Promise<Job | undefined>
```

**Behavior:**
- **Deactivating (active → inactive):**
  - Sets `deactivatedAt = NOW()`
  - Sets `deactivationReason` (default: 'manual')
  - Resets `warningEmailSent = false`

- **Reactivating (inactive → active):**
  - Sets `reactivatedAt = NOW()`
  - Increments `reactivationCount`
  - Clears `deactivationReason`

- **Audit Logging:**
  - Automatically logs action if `performedBy` provided
  - Includes metadata (previous/new status, reactivation count)

**2. New Function: `logJobAction`**
```typescript
async logJobAction(data: {
  jobId: number;
  action: 'created' | 'approved' | 'declined' | 'deactivated' | 'reactivated';
  performedBy: number;
  reason?: string;
  metadata?: any;
}): Promise<JobAuditLog>
```

---

### **Phase 4: Client-Side Helpers** ✅

#### **Files Created:**
- `client/src/lib/jobLifecycleHelpers.ts`

#### **What Was Added:**

**1. `isOldApplicant(application, job)`**
- Returns `true` if application was submitted before job reactivation
- Used to display "Old Applicant" badge in UI

**2. `getCandidateApplicationStatus(application, job)`**
- Returns candidate-friendly status messages:
  - `'active'` - Application in review
  - `'recently_closed'` - Job closed X days after application
  - `'closed'` - Job position closed
  - `'error'` - Race condition (applied after deactivation)

**3. `getDaysUntilAutoDeactivation(job, maxAgeDays)`**
- Calculates days remaining until auto-deactivation
- Returns `null` if not applicable

**4. `isJobReadOnly(job)`**
- Returns `true` if job is inactive (read-only mode)

---

### **Phase 5: Job Scheduler** ✅

#### **Files Modified:**
- `server/jobScheduler.ts` (complete rewrite)

#### **What Was Added:**

**1. Warning Emails (Daily at 2 AM):**
- Finds jobs that are 53 days old (7 days before 60-day cutoff)
- Sends warning email to recruiter if `warningEmailSent = false`
- Marks `warningEmailSent = true` after sending

**Email Template:**
- Subject: "Action Required: Job '[Title]' will auto-close in 7 days"
- Includes job details, reason, and actions recruiter can take

**2. Activity-Based Deactivation (Daily at 3 AM):**
- Finds jobs older than 60 days with `isActive = true`
- Checks for recent activity:
  - Recent applications (last 14 days)
  - Upcoming interviews
- **Only deactivates if NO recent activity and NO upcoming interviews**
- Uses batch processing (100 jobs at a time) for scalability
- Calls `storage.updateJobStatus()` with reason `'auto_expired'`

**3. Declined Job Cleanup (Weekly on Sunday at 4 AM):**
- Archives declined jobs older than 30 days
- Sets `deactivatedAt`, `isActive = false`, `deactivationReason = 'declined'`

**4. New Utility Functions:**
- `expireJob(jobId, reason?, performedBy?)` - Manual job expiration
- `getJobsNearExpiry()` - Get jobs within 7 days of expiration

---

## 🚧 **PENDING: Frontend UI Implementation (Phase 4)**

The following UI components need to be updated. The helper functions are ready in `client/src/lib/jobLifecycleHelpers.ts`.

### **1. Application Management UI - Old Applicant Badge**

**File to Modify:** `client/src/pages/application-management.tsx` or relevant application list component

**What to Add:**
```tsx
import { isOldApplicant } from '@/lib/jobLifecycleHelpers';

// In the application list rendering:
{isOldApplicant(application, job) && (
  <Badge variant="outline" className="ml-2 text-yellow-600 border-yellow-600">
    Old Applicant
  </Badge>
)}
```

**Purpose:** Distinguish applications submitted before job reactivation from new applications.

---

### **2. Application Management UI - Read-Only Banner**

**File to Modify:** `client/src/pages/application-management.tsx`

**What to Add:**
```tsx
import { isJobReadOnly } from '@/lib/jobLifecycleHelpers';

// At the top of the application management view:
{isJobReadOnly(job) && (
  <Alert className="mb-4 border-yellow-600 bg-yellow-50">
    <AlertCircle className="h-4 w-4 text-yellow-600" />
    <AlertTitle className="text-yellow-800">Job Inactive</AlertTitle>
    <AlertDescription className="text-yellow-700">
      This job is currently closed. You can view applications and send emails, but cannot add new candidates or schedule interviews. Contact an admin to reactivate.
    </AlertDescription>
  </Alert>
)}
```

**Purpose:** Inform recruiters that the job is inactive and explain limitations.

---

### **3. Admin Dashboard - Reactivation Confirmation Dialog**

**File to Modify:** `client/src/pages/unified-admin-dashboard.tsx`

**What to Add:**
```tsx
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Play } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

function ReactivateJobButton({ job }: { job: Job }) {
  const queryClient = useQueryClient();

  const reactivateMutation = useMutation({
    mutationFn: async (jobId: number) => {
      const res = await fetch(`/api/admin/jobs/${jobId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: true, reason: 'manual_reactivation' })
      });
      if (!res.ok) throw new Error('Failed to reactivate');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['admin-jobs'] });
    }
  });

  const daysSinceDeactivation = job.deactivatedAt
    ? Math.floor((Date.now() - new Date(job.deactivatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Get application count (you'll need to fetch this)
  const applicationCount = 0; // TODO: Fetch from API

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Play className="h-4 w-4 mr-2" />
          Reactivate
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Reactivate "{job.title}"?</AlertDialogTitle>
        <AlertDialogDescription>
          <div className="space-y-2 text-sm">
            <p>Closed {daysSinceDeactivation} days ago</p>
            <p>{applicationCount} existing applications (will show as "old applicants")</p>
            <p className="text-yellow-600 font-semibold">
              ⚠️ This will re-publish the job to:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Public jobs listing</li>
              <li>Google Jobs (via sitemap)</li>
              <li>Recruiter dashboards</li>
            </ul>
            <p className="text-xs text-gray-500 mt-2">
              Reactivation count: {job.reactivationCount || 0}
            </p>
          </div>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => reactivateMutation.mutate(job.id)}>
            {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate Job'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

**Purpose:** Admin confirmation before reactivating a job, showing impact and history.

---

### **4. Candidate Dashboard - Improved Closed Job Messaging**

**File to Modify:** `client/src/pages/candidate-dashboard.tsx` or candidate application list component

**What to Add:**
```tsx
import { getCandidateApplicationStatus } from '@/lib/jobLifecycleHelpers';

// In the application list:
const status = getCandidateApplicationStatus(application, job);

<div className="flex items-center gap-2">
  {status.status === 'active' && (
    <Badge variant="default" className="bg-green-600">In Review</Badge>
  )}
  {status.status === 'recently_closed' && (
    <Badge variant="outline" className="text-yellow-600 border-yellow-600">
      Recently Closed
    </Badge>
  )}
  {status.status === 'closed' && (
    <Badge variant="outline" className="text-gray-500 border-gray-400">
      Position Closed
    </Badge>
  )}
  {status.status === 'error' && (
    <Badge variant="destructive">Closed</Badge>
  )}
  <span className="text-sm text-gray-600">{status.message}</span>
</div>
```

**Purpose:** Give candidates clear, contextual information about closed job applications.

---

## 📊 **Testing Guide**

### **Backend Testing (Completed)**

#### **1. Database Schema:**
```sql
-- Verify columns exist
\d jobs;

-- Should show:
-- deactivated_at, reactivated_at, reactivation_count, deactivation_reason, warning_email_sent

-- Verify audit log table
\d job_audit_log;
```

#### **2. API Endpoints:**

**Test Inactive Job (Public):**
```bash
# Should return 404 for inactive jobs
curl http://localhost:5000/api/jobs/{inactive_job_id}
```

**Test Race Condition Guard:**
```bash
# Create inactive job, try to apply - should return 400
curl -X POST http://localhost:5000/api/jobs/{inactive_job_id}/apply \
  -F "resume=@test.pdf" \
  -F "name=Test User" \
  -F "email=test@example.com" \
  -F "phone=1234567890"

# Response: { "error": "This job is no longer accepting applications", "jobClosed": true }
```

**Test Ownership Check:**
```bash
# Recruiter A tries to access Recruiter B's job applications - should return 403
curl http://localhost:5000/api/jobs/{recruiter_b_job}/applications \
  -H "Cookie: session_cookie_for_recruiter_a"
```

#### **3. Storage Functions:**

**Test Deactivation:**
```typescript
// In server console or test file:
const job = await storage.updateJobStatus(1, false, 'filled', 1);
console.log(job.deactivatedAt); // Should be current timestamp
console.log(job.deactivationReason); // Should be 'filled'
```

**Test Reactivation:**
```typescript
const job = await storage.updateJobStatus(1, true, undefined, 1);
console.log(job.reactivatedAt); // Should be current timestamp
console.log(job.reactivationCount); // Should be incremented
```

**Test Audit Logging:**
```sql
SELECT * FROM job_audit_log WHERE job_id = 1 ORDER BY timestamp DESC;
-- Should show 'deactivated' and 'reactivated' entries
```

#### **4. Scheduler Testing:**

**Test Warning Emails (Manual):**
```typescript
// In server console:
import { sendDeactivationWarnings } from './jobScheduler';
await sendDeactivationWarnings();
```

**Test Activity-Based Deactivation (Manual):**
```typescript
import { deactivateInactiveJobs } from './jobScheduler';
await deactivateInactiveJobs();
```

**Enable Scheduler in Production:**
```bash
ENABLE_SCHEDULER=true npm run dev
```

---

### **Frontend Testing (To Be Done)**

#### **1. Old Applicant Badge:**
- Create a job
- Add some applications
- Deactivate job (via admin)
- Reactivate job (via admin)
- Add new applications
- Verify old applications show "Old Applicant" badge

#### **2. Read-Only Banner:**
- Recruiter deactivates their job
- Open application management for that job
- Verify banner appears
- Verify mutation buttons are disabled (Add Candidate, Schedule Interview, Change Stage)

#### **3. Reactivation Dialog:**
- Admin views inactive jobs
- Clicks "Reactivate" button
- Verify dialog shows:
  - Days since deactivation
  - Application count
  - Warning about re-publishing
  - Reactivation count
- Confirm reactivation
- Verify job appears in public listings again

#### **4. Candidate Messaging:**
- Candidate views their applications
- For closed jobs, verify appropriate message appears:
  - "Application in review" (active)
  - "Job closed X days after your application" (recently closed)
  - "Job position closed" (closed)

---

## 🚀 **Deployment Instructions**

### **1. Database Migration**

The migration runs automatically on server start if `MIGRATE_ON_START=true`. No manual SQL needed.

**Verify Migration:**
```sql
-- Check new columns
SELECT deactivated_at, reactivated_at, reactivation_count, deactivation_reason, warning_email_sent
FROM jobs
LIMIT 5;

-- Check audit log table exists
SELECT COUNT(*) FROM job_audit_log;
```

### **2. Environment Variables**

**Add to Production `.env`:**
```bash
# Enable job scheduler (set on ONE instance only)
ENABLE_SCHEDULER=true

# Email settings (already configured)
EMAIL_AUTOMATION_ENABLED=true
SEND_FROM_EMAIL=no-reply@vantahire.com
SEND_FROM_NAME=VantaHire
```

### **3. Scheduler Deployment**

**Important:** Only enable scheduler on ONE instance to avoid duplicate cron jobs.

```bash
# Instance 1 (with scheduler):
ENABLE_SCHEDULER=true npm start

# Instance 2+ (without scheduler):
ENABLE_SCHEDULER=false npm start
```

### **4. Monitoring**

**Scheduler Logs:**
```bash
# Should see daily at 2 AM:
"Running job expiration warning check..."
"Sent X warning emails"

# Should see daily at 3 AM:
"Running activity-based job deactivation check..."
"Deactivated X of Y old jobs"
```

**Audit Log Query:**
```sql
-- Recent job lifecycle events
SELECT
  j.title,
  jal.action,
  jal.reason,
  u.username as performed_by,
  jal.timestamp
FROM job_audit_log jal
JOIN jobs j ON jal.job_id = j.id
JOIN users u ON jal.performed_by = u.id
ORDER BY jal.timestamp DESC
LIMIT 20;
```

---

## 📈 **Success Metrics**

### **Backend (All Working)**
- ✅ Database columns added with indexes
- ✅ Audit log table created and functional
- ✅ API guards prevent unauthorized access
- ✅ Race condition guard works
- ✅ Timestamp tracking accurate
- ✅ Scheduler runs without errors
- ✅ Warning emails send successfully
- ✅ Activity-based deactivation works

### **Frontend (To Be Implemented)**
- ⏳ Old applicant badge displays correctly
- ⏳ Read-only banner appears on inactive jobs
- ⏳ Reactivation dialog shows proper warnings
- ⏳ Candidate messaging is clear and helpful

---

## 🔧 **Troubleshooting**

### **Issue: Jobs not deactivating automatically**
```bash
# Check scheduler is enabled
echo $ENABLE_SCHEDULER  # Should be 'true'

# Check scheduler is running
# Look for log: "✅ Job scheduler enabled - starting cron jobs"

# Manually trigger deactivation
# (in server console or admin panel)
```

### **Issue: Warning emails not sending**
```bash
# Check email service configured
echo $EMAIL_AUTOMATION_ENABLED  # Should be 'true'
echo $SEND_FROM_EMAIL

# Check warning_email_sent flag
SELECT id, title, warning_email_sent FROM jobs WHERE is_active = true;

# Reset flag to test
UPDATE jobs SET warning_email_sent = false WHERE id = X;
```

### **Issue: Old applicant badge not showing**
- Verify `reactivatedAt` is set on job
- Verify application `appliedAt < job.reactivatedAt`
- Check `isOldApplicant()` function logic

---

## 🎉 **Summary**

**✅ 100% Complete (Backend):**
- Database schema with lifecycle tracking
- API security and guards
- Storage layer with audit logging
- Activity-based scheduler
- Warning email system

**⏳ To Be Done (Frontend):**
- Old applicant badge (5 minutes)
- Read-only banner (10 minutes)
- Reactivation dialog (15 minutes)
- Candidate messaging (10 minutes)

**Total Remaining Work:** ~40 minutes of UI implementation

---

## 📝 **API Reference**

### **Admin Endpoints**

**Reactivate Job:**
```http
PUT /api/admin/jobs/:id/status
Content-Type: application/json

{
  "isActive": true,
  "reason": "manual_reactivation"
}
```

**Deactivate Job:**
```http
PUT /api/admin/jobs/:id/status
Content-Type: application/json

{
  "isActive": false,
  "reason": "filled"
}
```

**Get Job Audit Log:**
```http
GET /api/admin/jobs/:id/audit
```

---

## 🔒 **Security Considerations**

1. ✅ **Ownership Checks:** Recruiters can only access their own jobs
2. ✅ **Race Condition Protection:** Double-check job status before application creation
3. ✅ **Audit Trail:** All deactivation/reactivation events logged
4. ✅ **Read-Only Enforcement:** Inactive jobs cannot accept new applications
5. ✅ **Public 404:** Inactive jobs hidden from public listings

---

## 📚 **Additional Resources**

- **Database Schema:** `shared/schema.ts:26-57`, `shared/schema.ts:123-136`
- **API Guards:** `server/routes.ts:35-95`
- **Storage Functions:** `server/storage.ts:254-322`
- **Scheduler:** `server/jobScheduler.ts`
- **Client Helpers:** `client/src/lib/jobLifecycleHelpers.ts`

---

**Last Updated:** 2025-10-28
**Implementation Status:** Backend 100% Complete, Frontend 0% Complete
**Estimated Frontend Completion:** 40 minutes
