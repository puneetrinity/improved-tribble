import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';

test.describe('Job Application Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await injectAxe(page);
  });

  test('complete job application workflow', async ({ page }) => {
    // Navigate to jobs page
    await page.click('text=Jobs');
    await expect(page).toHaveURL('/jobs');
    
    // Verify jobs are loaded
    await expect(page.locator('[data-testid="job-card"]').first()).toBeVisible();
    
    // Click on first job
    await page.click('[data-testid="job-card"]');
    await expect(page).toHaveURL(/\/jobs\/\d+/);
    
    // Verify job details are displayed
    await expect(page.locator('h1')).toContainText('Job Details');
    await expect(page.locator('[data-testid="job-title"]')).toBeVisible();
    
    // Start application process
    await page.click('text=Apply Now');
    
    // Fill application form
    await page.fill('[data-testid="applicant-name"]', 'John Doe');
    await page.fill('[data-testid="applicant-email"]', 'john.doe@example.com');
    await page.fill('[data-testid="applicant-phone"]', '+1234567890');
    
    // Upload resume
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('Mock PDF content')
    });
    
    // Fill cover letter
    await page.fill('[data-testid="cover-letter"]', 'I am very interested in this position because...');
    
    // Submit application
    await page.click('text=Submit Application');
    
    // Verify success message
    await expect(page.locator('text=Application submitted successfully')).toBeVisible();
    
    // Check accessibility
    await checkA11y(page);
  });

  test('form validation prevents invalid submissions', async ({ page }) => {
    await page.goto('/jobs');
    await page.click('[data-testid="job-card"]');
    await page.click('text=Apply Now');
    
    // Try to submit empty form
    await page.click('text=Submit Application');
    
    // Verify validation messages appear
    await expect(page.locator('text=Full Name')).toBeVisible();
    await expect(page.locator('text=Email')).toBeVisible();
    
    // Fill invalid email
    await page.fill('[data-testid="applicant-email"]', 'invalid-email');
    await page.click('text=Submit Application');
    
    // Should still show validation error
    await expect(page.locator('text=Please enter a valid email')).toBeVisible();
  });

  test('recruiter can review applications', async ({ page }) => {
    // Login as recruiter
    await page.goto('/auth');
    await page.fill('[data-testid="username"]', 'recruiter');
    await page.fill('[data-testid="password"]', 'recruiter123');
    await page.click('text=Sign In');
    
    // Navigate to application management
    await page.goto('/applications');
    
    // Verify applications are listed
    await expect(page.locator('[data-testid="application-row"]').first()).toBeVisible();
    
    // Review first application
    await page.click('[data-testid="review-application"]');
    
    // Change status to shortlisted
    await page.selectOption('[data-testid="status-select"]', 'shortlisted');
    await page.fill('[data-testid="review-notes"]', 'Strong candidate with relevant experience');
    await page.click('text=Save Review');
    
    // Verify status updated
    await expect(page.locator('text=shortlisted')).toBeVisible();
  });

  test('admin approval workflow', async ({ page }) => {
    // Login as admin
    await page.goto('/auth');
    await page.fill('[data-testid="username"]', 'admin');
    await page.fill('[data-testid="password"]', 'admin123');
    await page.click('text=Sign In');
    
    // Navigate to admin dashboard
    await page.goto('/admin');
    
    // Verify admin stats are displayed
    await expect(page.locator('[data-testid="total-jobs"]')).toBeVisible();
    await expect(page.locator('[data-testid="pending-reviews"]')).toBeVisible();
    
    // Review pending job
    await page.click('text=Pending Jobs');
    await page.click('[data-testid="review-job"]');
    
    // Approve job
    await page.click('text=Approve');
    await page.fill('[data-testid="review-comments"]', 'Job posting approved - meets quality standards');
    await page.click('text=Confirm Approval');
    
    // Verify job is approved
    await expect(page.locator('text=approved')).toBeVisible();
  });

  test('search and filter functionality', async ({ page }) => {
    await page.goto('/jobs');
    
    // Test search
    await page.fill('[data-testid="search-input"]', 'React Developer');
    await page.press('[data-testid="search-input"]', 'Enter');
    
    // Verify filtered results
    await expect(page.locator('[data-testid="job-card"]')).toContainText('React');
    
    // Test location filter
    await page.selectOption('[data-testid="location-filter"]', 'Remote');
    
    // Verify location-filtered results
    await expect(page.locator('[data-testid="job-location"]')).toContainText('Remote');
    
    // Test job type filter
    await page.selectOption('[data-testid="type-filter"]', 'full-time');
    
    // Verify type-filtered results
    await expect(page.locator('[data-testid="job-type"]')).toContainText('full-time');
    
    // Clear filters
    await page.click('[data-testid="clear-filters"]');
    
    // Verify all jobs are shown again
    await expect(page.locator('[data-testid="job-card"]')).toHaveCount(5, { timeout: 10000 });
  });

  test('mobile responsiveness', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    await page.goto('/');
    
    // Test mobile navigation visibility and functionality
    await expect(page.locator('[data-testid="mobile-menu-button"]')).toBeVisible();
    await page.click('[data-testid="mobile-menu-button"]');
    await expect(page.locator('[data-testid="mobile-nav"]')).toBeVisible();
    
    // Test mobile menu navigation links
    await expect(page.locator('[data-testid="mobile-nav"] a').first()).toBeVisible();
    
    // Navigate to jobs page on mobile
    await page.goto('/jobs');
    await expect(page).toHaveURL('/jobs');
    
    // Verify page header is responsive on mobile
    await expect(page.locator('h1')).toBeVisible();
    
    // Test responsive layout elements
    await expect(page.locator('.container')).toBeVisible();
    
    // Verify the page doesn't have horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1); // Allow 1px tolerance
    
    // Test responsive navigation header on jobs page
    await expect(page.locator('[data-testid="mobile-menu-button"]')).toBeVisible();
  });
});