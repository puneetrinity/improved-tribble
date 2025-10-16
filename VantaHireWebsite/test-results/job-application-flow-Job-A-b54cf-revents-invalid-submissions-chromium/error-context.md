# Test info

- Name: Job Application Flow >> form validation prevents invalid submissions
- Location: /home/runner/workspace/test/e2e/job-application-flow.spec.ts:55:3

# Error details

```
Error: browserType.launch: Executable doesn't exist at /home/runner/workspace/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
╔═════════════════════════════════════════════════════════════════════════╗
║ Looks like Playwright Test or Playwright was just installed or updated. ║
║ Please run the following command to download new browsers:              ║
║                                                                         ║
║     npx playwright install                                              ║
║                                                                         ║
║ <3 Playwright Team                                                      ║
╚═════════════════════════════════════════════════════════════════════════╝
```

# Test source

```ts
   1 | import { test, expect } from '@playwright/test';
   2 | import { injectAxe, checkA11y } from 'axe-playwright';
   3 |
   4 | test.describe('Job Application Flow', () => {
   5 |   test.beforeEach(async ({ page }) => {
   6 |     await page.goto('/');
   7 |     await injectAxe(page);
   8 |   });
   9 |
   10 |   test('complete job application workflow', async ({ page }) => {
   11 |     // Navigate to jobs page
   12 |     await page.click('text=Jobs');
   13 |     await expect(page).toHaveURL('/jobs');
   14 |     
   15 |     // Verify jobs are loaded
   16 |     await expect(page.locator('[data-testid="job-card"]').first()).toBeVisible();
   17 |     
   18 |     // Click on first job
   19 |     await page.click('[data-testid="job-card"]');
   20 |     await expect(page).toHaveURL(/\/jobs\/\d+/);
   21 |     
   22 |     // Verify job details are displayed
   23 |     await expect(page.locator('h1')).toContainText('Job Details');
   24 |     await expect(page.locator('[data-testid="job-title"]')).toBeVisible();
   25 |     
   26 |     // Start application process
   27 |     await page.click('text=Apply Now');
   28 |     
   29 |     // Fill application form
   30 |     await page.fill('[data-testid="applicant-name"]', 'John Doe');
   31 |     await page.fill('[data-testid="applicant-email"]', 'john.doe@example.com');
   32 |     await page.fill('[data-testid="applicant-phone"]', '+1234567890');
   33 |     
   34 |     // Upload resume
   35 |     const fileInput = page.locator('input[type="file"]');
   36 |     await fileInput.setInputFiles({
   37 |       name: 'resume.pdf',
   38 |       mimeType: 'application/pdf',
   39 |       buffer: Buffer.from('Mock PDF content')
   40 |     });
   41 |     
   42 |     // Fill cover letter
   43 |     await page.fill('[data-testid="cover-letter"]', 'I am very interested in this position because...');
   44 |     
   45 |     // Submit application
   46 |     await page.click('text=Submit Application');
   47 |     
   48 |     // Verify success message
   49 |     await expect(page.locator('text=Application submitted successfully')).toBeVisible();
   50 |     
   51 |     // Check accessibility
   52 |     await checkA11y(page);
   53 |   });
   54 |
>  55 |   test('form validation prevents invalid submissions', async ({ page }) => {
      |   ^ Error: browserType.launch: Executable doesn't exist at /home/runner/workspace/.cache/ms-playwright/chromium_headless_shell-1169/chrome-linux/headless_shell
   56 |     await page.goto('/jobs');
   57 |     await page.click('[data-testid="job-card"]');
   58 |     await page.click('text=Apply Now');
   59 |     
   60 |     // Try to submit empty form
   61 |     await page.click('text=Submit Application');
   62 |     
   63 |     // Verify validation messages appear
   64 |     await expect(page.locator('text=Full Name')).toBeVisible();
   65 |     await expect(page.locator('text=Email')).toBeVisible();
   66 |     
   67 |     // Fill invalid email
   68 |     await page.fill('[data-testid="applicant-email"]', 'invalid-email');
   69 |     await page.click('text=Submit Application');
   70 |     
   71 |     // Should still show validation error
   72 |     await expect(page.locator('text=Please enter a valid email')).toBeVisible();
   73 |   });
   74 |
   75 |   test('recruiter can review applications', async ({ page }) => {
   76 |     // Login as recruiter
   77 |     await page.goto('/auth');
   78 |     await page.fill('[data-testid="username"]', 'recruiter');
   79 |     await page.fill('[data-testid="password"]', 'recruiter123');
   80 |     await page.click('text=Sign In');
   81 |     
   82 |     // Navigate to application management
   83 |     await page.goto('/applications');
   84 |     
   85 |     // Verify applications are listed
   86 |     await expect(page.locator('[data-testid="application-row"]').first()).toBeVisible();
   87 |     
   88 |     // Review first application
   89 |     await page.click('[data-testid="review-application"]');
   90 |     
   91 |     // Change status to shortlisted
   92 |     await page.selectOption('[data-testid="status-select"]', 'shortlisted');
   93 |     await page.fill('[data-testid="review-notes"]', 'Strong candidate with relevant experience');
   94 |     await page.click('text=Save Review');
   95 |     
   96 |     // Verify status updated
   97 |     await expect(page.locator('text=shortlisted')).toBeVisible();
   98 |   });
   99 |
  100 |   test('admin approval workflow', async ({ page }) => {
  101 |     // Login as admin
  102 |     await page.goto('/auth');
  103 |     await page.fill('[data-testid="username"]', 'admin');
  104 |     await page.fill('[data-testid="password"]', 'admin123');
  105 |     await page.click('text=Sign In');
  106 |     
  107 |     // Navigate to admin dashboard
  108 |     await page.goto('/admin');
  109 |     
  110 |     // Verify admin stats are displayed
  111 |     await expect(page.locator('[data-testid="total-jobs"]')).toBeVisible();
  112 |     await expect(page.locator('[data-testid="pending-reviews"]')).toBeVisible();
  113 |     
  114 |     // Review pending job
  115 |     await page.click('text=Pending Jobs');
  116 |     await page.click('[data-testid="review-job"]');
  117 |     
  118 |     // Approve job
  119 |     await page.click('text=Approve');
  120 |     await page.fill('[data-testid="review-comments"]', 'Job posting approved - meets quality standards');
  121 |     await page.click('text=Confirm Approval');
  122 |     
  123 |     // Verify job is approved
  124 |     await expect(page.locator('text=approved')).toBeVisible();
  125 |   });
  126 |
  127 |   test('search and filter functionality', async ({ page }) => {
  128 |     await page.goto('/jobs');
  129 |     
  130 |     // Test search
  131 |     await page.fill('[data-testid="search-input"]', 'React Developer');
  132 |     await page.press('[data-testid="search-input"]', 'Enter');
  133 |     
  134 |     // Verify filtered results
  135 |     await expect(page.locator('[data-testid="job-card"]')).toContainText('React');
  136 |     
  137 |     // Test location filter
  138 |     await page.selectOption('[data-testid="location-filter"]', 'Remote');
  139 |     
  140 |     // Verify location-filtered results
  141 |     await expect(page.locator('[data-testid="job-location"]')).toContainText('Remote');
  142 |     
  143 |     // Test job type filter
  144 |     await page.selectOption('[data-testid="type-filter"]', 'full-time');
  145 |     
  146 |     // Verify type-filtered results
  147 |     await expect(page.locator('[data-testid="job-type"]')).toContainText('full-time');
  148 |     
  149 |     // Clear filters
  150 |     await page.click('[data-testid="clear-filters"]');
  151 |     
  152 |     // Verify all jobs are shown again
  153 |     await expect(page.locator('[data-testid="job-card"]')).toHaveCount(5, { timeout: 10000 });
  154 |   });
  155 |
```