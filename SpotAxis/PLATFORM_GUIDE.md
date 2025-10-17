# SpotAxis Platform User Guide

## 🚀 Quick Start

**Platform URL**: https://authentic-motivation-production.up.railway.app

### Default Admin Login
- **Username**: `admin`
- **Password**: `SpotAxis2025!`
- **Admin Panel**: https://authentic-motivation-production.up.railway.app/admin/

---

## 👥 User Roles

SpotAxis has three main user types:

1. **Admin** - Platform administrator (you)
2. **Recruiter** - Company hiring managers who post jobs and review candidates
3. **Candidate/Talent** - Job seekers who apply for positions

---

## 📋 Initial Setup (First Time)

### Step 1: Create a Company Profile
1. Login as **admin** at `/admin/`
2. Go to **Companies** → **Add Company**
3. Fill in:
   - Company name
   - Industry
   - Company size
   - Location
   - Logo (optional)
4. **Important**: Create a **Subdomain** for the company:
   - Go to **Common** → **Subdomains** → **Add Subdomain**
   - Slug: e.g., `acme` (will be `acme.spotaxis.com`)
   - Link to the company you created
   - Set as active

### Step 2: Create a Recruiter Account
1. Go to **Users** → **Add User**
2. Create username/password
3. Set **Profile** = "Recruiter"
4. Save and then link to company:
   - Go to **Companies** → **Recruiters** → **Add Recruiter**
   - Select the user you created
   - Select the company
   - Set permissions (admin, can_post_jobs, etc.)

### Step 3: Create Subscription/Package (Optional)
1. Go to **Payments** → **Packages** → Create pricing plans
2. Assign subscription to company in **Companies** → **Subscriptions**

---

## 🏢 For Recruiters

### How to Post a Job

1. **Login** at `https://authentic-motivation-production.up.railway.app/login/`
2. Go to **Dashboard** or navigate to "Post Job"
3. Fill in job details:
   - Job Title (e.g., "Senior Software Engineer")
   - Department
   - Location
   - Job Type (Full-time, Part-time, Contract)
   - Salary Range
   - Job Description (supports rich text)
   - Requirements/Qualifications
   - Skills required
4. **Publishing Options**:
   - Set publish date (can schedule for future)
   - Set expiry date
   - Choose visibility (public/private)
5. **Click "Post Job"**

### How to Manage Applications

1. Go to **Jobs** → **Applications**
2. View applicants for each job
3. **Candidate Pipeline**:
   - New Applications
   - Screening
   - Interview Scheduled
   - Offer Extended
   - Hired / Rejected
4. **Actions**:
   - View candidate profile/resume
   - Download resume as PDF
   - Move candidate between pipeline stages
   - Add notes/comments
   - Schedule interviews
   - Send emails to candidates

### Team Management

1. Go to **Settings** → **Team**
2. Invite team members (recruiters)
3. Set permissions:
   - Admin (full access)
   - Can post jobs
   - Can review candidates
   - Read-only access

---

## 🎯 For Candidates

### How to Create Profile

1. Go to `/signup/talent/`
2. Fill in:
   - Personal info (name, email, phone)
   - Location
   - Upload resume/CV
   - Add work experience
   - Add education
   - Skills
   - Portfolio links
3. **Profile is public** - recruiters can find you

### How to Apply for Jobs

1. Browse jobs at `/jobs/`
2. Click on job listing
3. Click "Apply Now"
4. Attach resume or use profile resume
5. Add cover letter (optional)
6. Submit application

### Track Applications

1. Login at `/login/`
2. Go to "My Applications"
3. See status of each application:
   - Applied
   - Under Review
   - Interview Scheduled
   - Offer Received
   - Hired / Not Selected

---

## 🔗 VantaHire Integration

SpotAxis can feed job listings to VantaHire (the modern job board).

### Integration Setup

**In VantaHire (improved-tribble service):**

Set these environment variables in Railway:
```bash
SPOTAXIS_INTEGRATION_ENABLED=true
SPOTAXIS_BASE_URL=https://authentic-motivation-production.up.railway.app
SPOTAXIS_CAREERS_URL=https://authentic-motivation-production.up.railway.app/jobs
```

**How it works:**
1. Recruiters post jobs in SpotAxis
2. Jobs are automatically available via API at `/api/vacancy/`
3. VantaHire fetches and displays jobs with modern UI
4. Candidates apply through VantaHire
5. Applications are tracked in SpotAxis

---

## 📊 Key Features

### For Recruiters
- ✅ Post unlimited jobs
- ✅ Applicant Tracking System (ATS)
- ✅ Resume parsing and storage
- ✅ Candidate pipeline management
- ✅ Interview scheduling
- ✅ Email notifications
- ✅ Team collaboration
- ✅ Analytics dashboard
- ✅ Custom job board subdomain
- ✅ PDF resume generation
- ✅ Advanced search/filtering

### For Candidates
- ✅ Professional profile
- ✅ One-click applications
- ✅ Resume builder
- ✅ Job alerts
- ✅ Application tracking
- ✅ Social login (LinkedIn, Google, etc.)

---

## 🛠️ Admin Panel Features

Access at `/admin/`:

### Common
- Users (manage all user accounts)
- Profiles (recruiter, candidate, admin)
- Subdomains (company-specific sites)

### Companies
- Companies (organization profiles)
- Recruiters (hiring team members)
- Departments
- Locations

### Vacancies
- Vacancies (job postings)
- Applications
- Job categories
- Skills

### Candidates
- Candidates (talent profiles)
- Resumes
- Work experience
- Education
- Skills

### Payments
- Packages (pricing plans)
- Subscriptions
- Price slabs
- Transactions

### Activities
- System activity logs
- Notifications
- Email logs

---

## 📱 API Endpoints

SpotAxis provides REST APIs:

### Public APIs (no auth required)
- `GET /api/vacancy/` - List all active jobs
- `GET /api/vacancy/{id}/` - Get job details
- `GET /api/vacancy/{id}/pdf/` - Download job description PDF
- `POST /api/candidates/apply/` - Submit job application

### Authenticated APIs
- `GET /api/companies/` - List companies
- `GET /api/candidates/` - List candidates (recruiters only)
- `POST /api/vacancy/` - Create job posting
- `PUT /api/vacancy/{id}/` - Update job
- `DELETE /api/vacancy/{id}/` - Delete job

**API Authentication**: Session-based or Token-based (DRF)

---

## 🎨 Customization

### Company Branding

1. **Logo**: Upload in company profile
2. **Subdomain**: Set custom subdomain (e.g., `acme.spotaxis.com`)
3. **Career Page**: Customize at `/jobs/` with company branding
4. **CNAME**: Point your domain (e.g., `careers.acme.com`) to SpotAxis

### Email Templates

Customize email notifications in Django admin:
- Application received
- Interview scheduled
- Offer extended
- Application status updates

---

## 🚨 Common Workflows

### Workflow 1: Post Job → Hire Candidate

1. Recruiter logs in
2. Posts new job opening
3. Job appears on `/jobs/` and VantaHire
4. Candidates apply
5. Recruiter reviews applications
6. Moves candidates through pipeline:
   - Screen resumes → Shortlist
   - Schedule interviews
   - Extend offer
   - Mark as hired
7. Job is marked as filled

### Workflow 2: Candidate Registration → Application

1. Candidate visits `/signup/talent/`
2. Creates profile with resume
3. Browses jobs at `/jobs/`
4. Applies to multiple jobs
5. Receives confirmation email
6. Tracks application status in dashboard
7. Gets interview invitation
8. Receives offer

---

## 📞 Support & Troubleshooting

### Reset Admin Password
```bash
# In Railway Shell:
python manage.py changepassword admin
```

### Create Additional Superuser
```bash
python manage.py createsuperuser
```

### View Logs
- Railway Dashboard → authentic-motivation → Logs

### Database Access
- Railway Dashboard → Postgres-TSWi → Connect

---

## 🔐 Security Notes

- Change default admin password immediately
- Use strong passwords for all accounts
- Enable 2FA for admin accounts (configure in Django admin)
- Regularly backup database
- Review user permissions periodically

---

## 📈 Next Steps

1. **Create your first company profile**
2. **Set up recruiter account**
3. **Post a test job**
4. **Create a test candidate account** and apply
5. **Test the full hiring workflow**
6. **Configure VantaHire integration**
7. **Customize branding and emails**

---

## 🌐 Platform URLs

- **Home**: https://authentic-motivation-production.up.railway.app/
- **Jobs Board**: https://authentic-motivation-production.up.railway.app/jobs/
- **Candidate Signup**: https://authentic-motivation-production.up.railway.app/signup/talent/
- **Login**: https://authentic-motivation-production.up.railway.app/login/
- **Admin**: https://authentic-motivation-production.up.railway.app/admin/
- **Pricing**: https://authentic-motivation-production.up.railway.app/pricing/
- **API Docs**: https://authentic-motivation-production.up.railway.app/api/

---

**Questions?** Check the admin panel help sections or review the API documentation.
