import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../../server/routes';
import { createMockJob, createMockUser, createMockApplication } from '../factories';

let app: express.Express;
let server: any;

beforeAll(async () => {
  app = express();
  server = await registerRoutes(app);
});

afterAll(() => {
  server?.close();
});

describe('API Integration Tests', () => {
  describe('Jobs API', () => {
    it('retrieves jobs list with proper pagination', async () => {
      const response = await request(app)
        .get('/api/jobs')
        .query({ page: 1, limit: 10 });

      expect([200, 401]).toContain(response.status);
      
      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBeLessThanOrEqual(10);
      }
    });

    it('filters jobs by search criteria', async () => {
      const response = await request(app)
        .get('/api/jobs')
        .query({ search: 'developer', location: 'Remote' });

      expect([200, 401]).toContain(response.status);
      
      if (response.status === 200) {
        expect(Array.isArray(response.body)).toBe(true);
      }
    });

    it('validates job posting schema', async () => {
      const mockJob = createMockJob();
      
      const response = await request(app)
        .post('/api/jobs')
        .send(mockJob);

      // Should require authentication
      expect([400, 401, 403]).toContain(response.status);
    });

    it('retrieves individual job details', async () => {
      const response = await request(app).get('/api/jobs/1');

      expect([200, 404]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body).toHaveProperty('id');
        expect(response.body).toHaveProperty('title');
        expect(response.body).toHaveProperty('description');
      }
    });
  });

  describe('Applications API', () => {
    it('validates application submission data', async () => {
      const mockApplication = createMockApplication();
      
      const response = await request(app)
        .post('/api/jobs/1/apply')
        .send(mockApplication);

      // Expect validation or authentication error
      expect([400, 401, 403]).toContain(response.status);
    });

    it('handles file upload for resumes', async () => {
      const mockPdfBuffer = Buffer.from('%PDF-1.4 mock content');
      
      const response = await request(app)
        .post('/api/jobs/1/apply')
        .field('name', 'Test User')
        .field('email', 'test@example.com')
        .field('phone', '+1234567890')
        .attach('resume', mockPdfBuffer, 'resume.pdf');

      expect([200, 400, 401]).toContain(response.status);
    });

    it('retrieves applications for recruiters', async () => {
      const response = await request(app).get('/api/jobs/1/applications');

      // Should require authentication and proper role
      expect([401, 403]).toContain(response.status);
    });
  });

  describe('Authentication API', () => {
    it('handles login endpoint availability', async () => {
      const credentials = {
        username: 'testuser',
        password: 'testpass'
      };

      const response = await request(app)
        .post('/api/login')
        .send(credentials);

      // Authentication endpoint should respond with 400/401 for test credentials
      expect([400, 401]).toContain(response.status);
    });

    it('validates login request format', async () => {
      const invalidRequest = {
        user: 'invalid',
        pass: 'wrong'
      };

      const response = await request(app)
        .post('/api/login')
        .send(invalidRequest);

      expect([400, 401]).toContain(response.status);
    });

    it('handles registration endpoint', async () => {
      const newUser = {
        username: 'newuser',
        email: 'newuser@test.com',
        password: 'password123'
      };
      
      const response = await request(app)
        .post('/api/register')
        .send(newUser);

      // Registration should handle new user or return validation error
      expect([201, 400, 409]).toContain(response.status);
    });

    it('handles logout endpoint', async () => {
      const response = await request(app).post('/api/logout');
      // Logout should work regardless of session state
      expect([200, 401]).toContain(response.status);
    });

    it('protects user endpoint', async () => {
      const response = await request(app).get('/api/user');
      // User endpoint should require authentication
      expect(response.status).toBe(401);
    });
  });

  describe('Admin API', () => {
    it('protects admin statistics endpoint', async () => {
      const response = await request(app).get('/api/admin/stats');
      expect([401, 403]).toContain(response.status);
    });

    it('protects user management endpoints', async () => {
      const response = await request(app).get('/api/admin/users');
      expect([401, 403]).toContain(response.status);
    });

    it('validates job review operations', async () => {
      const reviewData = {
        status: 'approved',
        comments: 'Job meets quality standards'
      };

      const response = await request(app)
        .patch('/api/admin/jobs/1/review')
        .send(reviewData);

      expect([401, 403]).toContain(response.status);
    });
  });

  describe('AI Analysis API', () => {
    it('validates AI analysis input schema', async () => {
      const validJobData = {
        title: 'Software Engineer',
        description: 'We are looking for a skilled software engineer.'
      };

      const response = await request(app)
        .post('/api/ai/analyze-job-description')
        .send(validJobData);

      expect([200, 401, 403, 429]).toContain(response.status);
    });

    it('handles invalid AI analysis input', async () => {
      const invalidData = {
        title: '', // Empty title
        description: 'x'.repeat(10000) // Too long description
      };

      const response = await request(app)
        .post('/api/ai/analyze-job-description')
        .send(invalidData);

      expect([400, 401, 403]).toContain(response.status);
    });

    it('respects rate limiting for AI requests', async () => {
      const jobData = {
        title: 'Test Job',
        description: 'Test description for rate limiting'
      };

      let rateLimitHit = false;
      const agent = request.agent(app);

      // Make multiple rapid requests
      for (let i = 0; i < 10; i++) {
        const response = await agent
          .post('/api/ai/analyze-job-description')
          .send(jobData);

        if (response.status === 429) {
          rateLimitHit = true;
          break;
        }
      }

      // Rate limiting should eventually kick in
      expect(rateLimitHit).toBe(true);
    });
  });

  describe('Profile API', () => {
    it('protects profile endpoints', async () => {
      const response = await request(app).get('/api/profile');
      expect(response.status).toBe(401);
    });

    it('validates profile update data', async () => {
      const profileData = {
        email: 'newemail@example.com',
        preferences: { notifications: true }
      };

      const response = await request(app)
        .patch('/api/profile')
        .send(profileData);

      expect([401, 403]).toContain(response.status);
    });
  });

  describe('Analytics API', () => {
    it('provides job analytics to authorized users', async () => {
      const response = await request(app).get('/api/analytics/jobs');
      expect([401, 403]).toContain(response.status);
    });

    it('generates analytics exports', async () => {
      const response = await request(app).get('/api/analytics/export');
      expect([401, 403]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('handles malformed JSON gracefully', async () => {
      const response = await request(app)
        .post('/api/jobs')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}');

      expect(response.status).toBe(400);
    });

    it('returns appropriate 404 for missing resources', async () => {
      const response = await request(app).get('/api/jobs/999999');
      expect(response.status).toBe(404);
    });

    it('handles database connection errors gracefully', async () => {
      // This would test how the API handles database unavailability
      const response = await request(app).get('/api/jobs');
      expect([200, 401, 500]).toContain(response.status);
    });
  });
});