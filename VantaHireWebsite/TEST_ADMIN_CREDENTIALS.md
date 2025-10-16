# Test Admin Credentials

## Admin Account
**Username:** `admin`
**Password:** `admin123`
**Role:** Admin
**Access:** Full admin dashboard with job review capabilities

## Test Recruiter Account
**Username:** `recruiter`
**Password:** `recruiter123`
**Role:** Recruiter
**Access:** Job posting and application management

## How to Test Phase 2 Features

### 1. Login as Admin
1. Navigate to `/auth` 
2. Use credentials: `admin` / `admin123`
3. Click "Admin" in the navigation menu
4. Access the admin dashboard at `/admin`

### 2. Admin Dashboard Features
- **Statistics Overview**: View pending, approved, and declined job counts
- **Job Review Tabs**: Switch between pending, approved, and declined jobs
- **Review Actions**: Approve or decline jobs with optional comments
- **Job Details**: Full job information display with skills and requirements

### 3. Test the Approval Workflow
1. Login as recruiter (`recruiter` / `recruiter123`)
2. Post a new job at `/jobs/post`
3. Job will appear as "pending" status
4. Login as admin to review and approve/decline
5. Only approved jobs appear in public listings at `/jobs`

### 4. Job Lifecycle Testing
- **New Jobs**: Start as "pending" status (hidden from public)
- **Admin Review**: Admin can approve/decline with comments
- **Public Visibility**: Only approved jobs show in public listings
- **Auto-Expiry**: Jobs automatically expire after 60 days

## Test Jobs Created
The system automatically creates 3 test jobs in "pending" status:
1. Senior Full Stack Developer (San Francisco, CA)
2. UX/UI Designer (Remote)
3. DevOps Engineer (Austin, TX)

These jobs will appear in the admin dashboard for review testing.

## Navigation Access
- **Admin Link**: Only visible to admin users in navigation
- **Role-Based Display**: Navigation adapts based on user role
- **Mobile Support**: Admin functionality works on all devices

## Security Testing
- Admin routes are protected (try accessing `/admin` without login)
- Role-based access control prevents non-admins from accessing admin features
- Session management maintains secure authentication state