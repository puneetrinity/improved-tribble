# VantaHire API Documentation

## Base URL
```
http://localhost:5000/api
```

## Authentication

VantaHire uses session-based authentication. Users must log in to receive a session cookie that authenticates subsequent requests.

### Session Management
- Sessions are stored in PostgreSQL with express-session
- Session cookies are HTTP-only and secure in production
- Sessions expire after 24 hours of inactivity

## Error Responses

All API endpoints return consistent error responses:

```json
{
  "error": "Error message description",
  "code": "ERROR_CODE", // Optional
  "details": {...} // Optional additional details
}
```

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (not logged in)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

## Rate Limiting

Certain endpoints have rate limiting applied:
- Job posting: 10 requests per hour per user
- Job applications: 5 requests per minute per user
- AI analysis: 20 requests per hour per user
- Contact form: 5 requests per hour per IP

## Authentication Endpoints

### POST /auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "full_name": "John Doe",
  "role": "candidate" | "recruiter"
}
```

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "full_name": "John Doe",
  "role": "candidate",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

### POST /auth/login
Authenticate user and create session.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "full_name": "John Doe",
  "role": "candidate"
}
```

### POST /auth/logout
End user session.

**Response:**
```json
{
  "message": "Logged out successfully"
}
```

### GET /user
Get current authenticated user information.

**Headers:**
```
Cookie: session_cookie
```

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "full_name": "John Doe",
  "role": "candidate"
}
```

## Job Endpoints

### GET /jobs
Retrieve job listings with optional filtering.

**Query Parameters:**
- `search` - Search in title and description
- `location` - Filter by location
- `job_type` - Filter by job type (full-time, part-time, contract, internship)
- `experience_level` - Filter by experience (entry, mid, senior, executive)
- `salary_min` - Minimum salary filter
- `salary_max` - Maximum salary filter
- `skills` - Comma-separated skills to match
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 20, max: 100)

**Example Request:**
```
GET /api/jobs?search=developer&location=New York&job_type=full-time&page=1&limit=10
```

**Response:**
```json
{
  "jobs": [
    {
      "id": 1,
      "title": "Senior Frontend Developer",
      "description": "We are looking for...",
      "company": "Tech Corp",
      "location": "New York, NY",
      "salary_min": 80000,
      "salary_max": 120000,
      "job_type": "full-time",
      "experience_level": "senior",
      "skills": ["React", "TypeScript", "Node.js"],
      "status": "active",
      "expires_at": "2024-12-31T23:59:59.000Z",
      "view_count": 156,
      "application_count": 23,
      "created_at": "2024-01-01T00:00:00.000Z",
      "posted_by": {
        "id": 2,
        "full_name": "Jane Smith",
        "email": "jane@techcorp.com"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "pages": 5
  }
}
```

### GET /jobs/:id
Get detailed information about a specific job.

**Response:**
```json
{
  "id": 1,
  "title": "Senior Frontend Developer",
  "description": "Detailed job description...",
  "company": "Tech Corp",
  "location": "New York, NY",
  "salary_min": 80000,
  "salary_max": 120000,
  "job_type": "full-time",
  "experience_level": "senior",
  "skills": ["React", "TypeScript", "Node.js"],
  "requirements": "Bachelor's degree in...",
  "benefits": "Health insurance, 401k...",
  "status": "active",
  "expires_at": "2024-12-31T23:59:59.000Z",
  "view_count": 156,
  "application_count": 23,
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z",
  "posted_by": {
    "id": 2,
    "full_name": "Jane Smith",
    "email": "jane@techcorp.com"
  }
}
```

### POST /jobs
Create a new job posting. **Requires recruiter or admin role.**

**Request Body:**
```json
{
  "title": "Senior Frontend Developer",
  "description": "We are looking for an experienced frontend developer...",
  "company": "Tech Corp",
  "location": "New York, NY",
  "salary_min": 80000,
  "salary_max": 120000,
  "job_type": "full-time",
  "experience_level": "senior",
  "skills": ["React", "TypeScript", "Node.js"],
  "requirements": "Bachelor's degree in Computer Science...",
  "benefits": "Health insurance, 401k matching...",
  "expires_at": "2024-12-31T23:59:59.000Z"
}
```

**Response:**
```json
{
  "id": 1,
  "title": "Senior Frontend Developer",
  "status": "active",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

### PATCH /jobs/:id/status
Update job status. **Requires recruiter or admin role.**

**Request Body:**
```json
{
  "status": "active" | "paused" | "expired" | "draft"
}
```

**Response:**
```json
{
  "id": 1,
  "status": "paused",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

### GET /my-jobs
Get jobs posted by the current user. **Requires authentication.**

**Response:**
```json
{
  "jobs": [
    {
      "id": 1,
      "title": "Senior Frontend Developer",
      "company": "Tech Corp",
      "status": "active",
      "application_count": 23,
      "view_count": 156,
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

## Application Endpoints

### POST /jobs/:id/apply
Submit an application for a job.

**Request:** Multipart form data
- `cover_letter` - Text field with cover letter
- `resume` - File upload (PDF, DOC, DOCX, max 5MB)

**Response:**
```json
{
  "id": 1,
  "job_id": 1,
  "status": "pending",
  "applied_at": "2024-01-01T00:00:00.000Z",
  "resume_url": "https://cloudinary.com/resume.pdf"
}
```

### GET /jobs/:id/applications
Get applications for a specific job. **Requires recruiter or admin role.**

**Query Parameters:**
- `status` - Filter by application status
- `page` - Page number
- `limit` - Results per page

**Response:**
```json
{
  "applications": [
    {
      "id": 1,
      "user_id": 3,
      "candidate": {
        "id": 3,
        "full_name": "John Doe",
        "email": "john@example.com"
      },
      "status": "pending",
      "cover_letter": "I am interested in this position...",
      "resume_url": "https://cloudinary.com/resume.pdf",
      "applied_at": "2024-01-01T00:00:00.000Z",
      "viewed_at": null,
      "downloaded_at": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 23,
    "pages": 2
  }
}
```

### GET /my-applications
Get applications submitted by the current user.

**Response:**
```json
{
  "applications": [
    {
      "id": 1,
      "job": {
        "id": 1,
        "title": "Senior Frontend Developer",
        "company": "Tech Corp"
      },
      "status": "pending",
      "applied_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### GET /my-applications-received
Get applications received for jobs posted by current user. **Requires recruiter or admin role.**

**Response:**
```json
{
  "applications": [
    {
      "id": 1,
      "job": {
        "id": 1,
        "title": "Senior Frontend Developer"
      },
      "candidate": {
        "id": 3,
        "full_name": "John Doe",
        "email": "john@example.com"
      },
      "status": "pending",
      "applied_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### PATCH /applications/:id/status
Update application status. **Requires recruiter or admin role.**

**Request Body:**
```json
{
  "status": "pending" | "reviewed" | "accepted" | "rejected",
  "notes": "Optional feedback for the candidate"
}
```

**Response:**
```json
{
  "id": 1,
  "status": "reviewed",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

### PATCH /applications/bulk
Update multiple applications at once. **Requires recruiter or admin role.**

**Request Body:**
```json
{
  "application_ids": [1, 2, 3],
  "status": "reviewed",
  "notes": "Bulk update notes"
}
```

**Response:**
```json
{
  "updated_count": 3,
  "message": "Applications updated successfully"
}
```

### PATCH /applications/:id/view
Mark application as viewed. **Requires recruiter or admin role.**

**Response:**
```json
{
  "id": 1,
  "viewed_at": "2024-01-01T00:00:00.000Z"
}
```

### PATCH /applications/:id/download
Mark resume as downloaded. **Requires recruiter or admin role.**

**Response:**
```json
{
  "id": 1,
  "downloaded_at": "2024-01-01T00:00:00.000Z"
}
```

### DELETE /applications/:id/withdraw
Withdraw an application. **Requires authentication and ownership.**

**Response:**
```json
{
  "message": "Application withdrawn successfully"
}
```

## Profile Endpoints

### GET /profile
Get current user's profile.

**Response:**
```json
{
  "id": 1,
  "user_id": 1,
  "phone": "+1234567890",
  "location": "New York, NY",
  "experience_years": 5,
  "skills": ["React", "TypeScript", "Node.js"],
  "bio": "Experienced frontend developer...",
  "linkedin_url": "https://linkedin.com/in/johndoe",
  "portfolio_url": "https://johndoe.dev",
  "resume_url": "https://cloudinary.com/resume.pdf",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

### POST /profile
Create user profile (first time setup).

**Request Body:**
```json
{
  "phone": "+1234567890",
  "location": "New York, NY",
  "experience_years": 5,
  "skills": ["React", "TypeScript", "Node.js"],
  "bio": "Experienced frontend developer...",
  "linkedin_url": "https://linkedin.com/in/johndoe",
  "portfolio_url": "https://johndoe.dev"
}
```

### PATCH /profile
Update user profile.

**Request Body:** Same as POST /profile (all fields optional)

**Response:**
```json
{
  "id": 1,
  "updated_at": "2024-01-01T00:00:00.000Z",
  "message": "Profile updated successfully"
}
```

## Analytics Endpoints

### GET /analytics/jobs
Get job analytics for current user. **Requires authentication.**

**Response:**
```json
{
  "summary": {
    "total_jobs": 5,
    "active_jobs": 3,
    "total_applications": 45,
    "total_views": 1250
  },
  "jobs": [
    {
      "id": 1,
      "title": "Senior Frontend Developer",
      "view_count": 156,
      "application_count": 23,
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### GET /analytics/jobs/:id
Get detailed analytics for a specific job. **Requires recruiter or admin role.**

**Response:**
```json
{
  "job": {
    "id": 1,
    "title": "Senior Frontend Developer",
    "view_count": 156,
    "application_count": 23
  },
  "daily_views": [
    {
      "date": "2024-01-01",
      "views": 15
    }
  ],
  "application_status_breakdown": {
    "pending": 10,
    "reviewed": 8,
    "accepted": 3,
    "rejected": 2
  }
}
```

### GET /analytics/export
Export analytics data. **Requires recruiter or admin role.**

**Query Parameters:**
- `format` - Export format (csv, json)
- `date_from` - Start date (YYYY-MM-DD)
- `date_to` - End date (YYYY-MM-DD)

**Response:** File download

## AI Features

### POST /ai/analyze-job-description
Analyze job description for optimization. **Requires recruiter or admin role.**

**Request Body:**
```json
{
  "title": "Senior Frontend Developer",
  "description": "We are looking for an experienced developer..."
}
```

**Response:**
```json
{
  "clarity_score": 8.5,
  "inclusion_score": 7.2,
  "seo_score": 6.8,
  "overall_score": 7.5,
  "bias_flags": [
    "Consider using 'experienced' instead of 'ninja' or 'rockstar'"
  ],
  "seo_keywords": [
    "frontend developer",
    "react",
    "typescript"
  ],
  "suggestions": [
    "Add more specific technical requirements",
    "Include information about company culture",
    "Specify remote work options"
  ],
  "model_version": "1.0"
}
```

### POST /ai/score-job
Generate optimization score for job posting. **Requires recruiter or admin role.**

**Request Body:**
```json
{
  "job_id": 1
}
```

**Response:**
```json
{
  "job_id": 1,
  "score": 7.5,
  "analysis": {
    "clarity_score": 8.5,
    "inclusion_score": 7.2,
    "seo_score": 6.8,
    "overall_score": 7.5
  },
  "recommendations": [
    "Improve job title specificity",
    "Add more inclusive language",
    "Optimize for search keywords"
  ]
}
```

## Admin Endpoints

### GET /admin/stats
Get system-wide statistics. **Requires admin role.**

**Response:**
```json
{
  "users": {
    "total": 1250,
    "candidates": 980,
    "recruiters": 270,
    "new_this_month": 125
  },
  "jobs": {
    "total": 450,
    "active": 320,
    "new_this_month": 45
  },
  "applications": {
    "total": 2850,
    "pending": 150,
    "new_this_month": 285
  }
}
```

### GET /admin/users
Get all users for management. **Requires admin role.**

**Query Parameters:**
- `role` - Filter by user role
- `search` - Search by name or email
- `page` - Page number
- `limit` - Results per page

**Response:**
```json
{
  "users": [
    {
      "id": 1,
      "email": "user@example.com",
      "full_name": "John Doe",
      "role": "candidate",
      "created_at": "2024-01-01T00:00:00.000Z",
      "last_login": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1250,
    "pages": 25
  }
}
```

### PATCH /admin/users/:id/role
Update user role. **Requires admin role.**

**Request Body:**
```json
{
  "role": "candidate" | "recruiter" | "admin"
}
```

**Response:**
```json
{
  "id": 1,
  "role": "recruiter",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

### GET /admin/jobs/all
Get all jobs for moderation. **Requires admin role.**

**Response:**
```json
{
  "jobs": [
    {
      "id": 1,
      "title": "Senior Frontend Developer",
      "company": "Tech Corp",
      "status": "active",
      "posted_by": {
        "id": 2,
        "full_name": "Jane Smith"
      },
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### PATCH /admin/jobs/:id/review
Review and approve/reject job posting. **Requires admin role.**

**Request Body:**
```json
{
  "status": "approved" | "rejected",
  "notes": "Reason for rejection or approval notes"
}
```

**Response:**
```json
{
  "id": 1,
  "status": "approved",
  "reviewed_at": "2024-01-01T00:00:00.000Z"
}
```

### DELETE /admin/jobs/:id
Delete job posting. **Requires admin role.**

**Response:**
```json
{
  "message": "Job deleted successfully"
}
```

## Contact Form

### POST /contact
Submit contact form.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "company": "Acme Corp",
  "subject": "Partnership Inquiry",
  "message": "I would like to discuss..."
}
```

**Response:**
```json
{
  "id": 1,
  "message": "Contact form submitted successfully",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

### GET /contact
Get contact form submissions. **Requires admin role.**

**Response:**
```json
{
  "submissions": [
    {
      "id": 1,
      "name": "John Doe",
      "email": "john@example.com",
      "company": "Acme Corp",
      "subject": "Partnership Inquiry",
      "message": "I would like to discuss...",
      "status": "pending",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

## Webhooks

### POST /webhooks/email-status
Handle email delivery status updates (used by email service providers).

**Request Body:**
```json
{
  "event": "delivered" | "bounced" | "opened",
  "email": "user@example.com",
  "message_id": "msg_123",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## SDK Examples

### JavaScript/TypeScript
```typescript
// Initialize client
const api = new VantaHireAPI('http://localhost:5000/api');

// Login
const user = await api.auth.login({
  email: 'user@example.com',
  password: 'password123'
});

// Get jobs
const jobs = await api.jobs.list({
  search: 'developer',
  location: 'New York'
});

// Apply for job
const application = await api.jobs.apply(jobId, {
  coverLetter: 'I am interested...',
  resume: fileObject
});
```

### Python
```python
# Initialize client
from vantahire_api import VantaHireAPI
api = VantaHireAPI('http://localhost:5000/api')

# Login
user = api.auth.login(
    email='user@example.com',
    password='password123'
)

# Get jobs
jobs = api.jobs.list(
    search='developer',
    location='New York'
)

# Apply for job
application = api.jobs.apply(
    job_id=job_id,
    cover_letter='I am interested...',
    resume=open('resume.pdf', 'rb')
)
```

## Testing

### Health Check
```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0",
  "database": "connected",
  "services": {
    "email": "configured",
    "storage": "available",
    "ai": "available"
  }
}
```

### Test Email Service
```
GET /test-email
```
**Requires admin role.**

**Response:**
```json
{
  "status": "success",
  "message": "Test email sent successfully"
}
```

## Changelog

### v1.0.0 (Current)
- Initial API release
- Authentication and user management
- Job posting and application system
- Basic analytics and reporting
- Admin dashboard functionality
- AI job analysis integration
- File upload system

### Planned Features
- Real-time notifications via WebSocket
- Advanced search with Elasticsearch
- Interview scheduling system
- Video interview integration
- Enhanced analytics and reporting
- Mobile API optimizations
- GraphQL endpoint support

## Support

For API support and questions:
- Documentation: [Link to full documentation]
- Issues: [GitHub Issues URL]
- Email: api-support@vantahire.com
- Discord: [Discord Server URL]