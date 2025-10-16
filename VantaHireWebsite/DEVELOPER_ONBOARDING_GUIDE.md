# VantaHire Developer Onboarding Guide

## Welcome to VantaHire Development Team

This guide will help new developers quickly understand the codebase and start contributing effectively to the VantaHire platform.

## Day 1: Environment Setup

### Prerequisites Check
```bash
# Verify Node.js version (18+)
node --version

# Verify PostgreSQL installation
psql --version

# Verify Git configuration
git config --list
```

### Project Setup
```bash
# Clone and setup
git clone <repository-url>
cd vantahire
npm install

# Database setup
createdb vantahire
npm run db:push

# Start development
npm run dev
```

### Test Your Setup
1. Visit `http://localhost:5000` - should see VantaHire homepage
2. Register a new candidate account
3. Register a new recruiter account
4. Create a test job posting
5. Apply to the job as a candidate

## Day 2-3: Codebase Exploration

### Key Files to Review
1. `shared/schema.ts` - Database schema and types
2. `server/routes.ts` - API endpoints
3. `client/src/App.tsx` - Frontend routing
4. `client/src/hooks/useAuth.ts` - Authentication logic
5. `server/auth.ts` - Backend authentication

### Architecture Understanding
```
Frontend (React) → API Routes (Express) → Database (PostgreSQL)
                ↓
         TanStack Query (State Management)
                ↓
           Drizzle ORM (Database Layer)
```

### Component Structure
- **Pages**: Full-page components in `client/src/pages/`
- **Components**: Reusable UI in `client/src/components/`
- **Hooks**: Custom React hooks in `client/src/hooks/`
- **UI Library**: Shadcn/ui components in `client/src/components/ui/`

## Day 4-5: First Contributions

### Recommended First Tasks
1. **Fix a small UI bug** - Look for spacing, alignment issues
2. **Add form validation** - Enhance existing forms with better error messages
3. **Write tests** - Add missing test cases for existing functionality
4. **Update documentation** - Improve code comments or README sections

### Development Workflow
```bash
# Create feature branch
git checkout -b feature/your-feature-name

# Make changes and test
npm test
npm run test:e2e

# Commit with clear message
git commit -m "feat: add user profile validation"

# Push and create PR
git push origin feature/your-feature-name
```

## Common Development Patterns

### Adding New API Endpoint
```typescript
// 1. Add to server/routes.ts
app.get("/api/new-endpoint", requireAuth, async (req, res) => {
  try {
    const result = await db.select().from(table);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// 2. Use in frontend with TanStack Query
const { data, isLoading } = useQuery({
  queryKey: ['/api/new-endpoint'],
  queryFn: () => fetch('/api/new-endpoint').then(res => res.json())
});
```

### Adding New Database Table
```typescript
// 1. Add to shared/schema.ts
export const newTable = pgTable('new_table', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  created_at: timestamp('created_at').defaultNow(),
});

// 2. Create insert schema
export const insertNewTableSchema = createInsertSchema(newTable);
export type InsertNewTable = z.infer<typeof insertNewTableSchema>;
export type SelectNewTable = typeof newTable.$inferSelect;

// 3. Push to database
npm run db:push
```

### Adding New React Page
```typescript
// 1. Create page component
export default function NewPage() {
  return (
    <div>
      <Header />
      {/* Page content */}
      <Footer />
    </div>
  );
}

// 2. Add route to App.tsx
<Route path="/new-page" component={NewPage} />
```

## Code Quality Standards

### TypeScript Usage
- Always use TypeScript for new files
- Import types from `shared/schema.ts`
- Use proper type annotations for function parameters
- Avoid `any` type - use `unknown` if uncertain

### React Best Practices
- Use functional components with hooks
- Implement proper loading states
- Handle errors gracefully with try-catch
- Use React.memo for expensive components
- Keep components small and focused

### Backend Standards
- Always validate request data with Zod
- Use proper HTTP status codes
- Implement rate limiting for sensitive endpoints
- Log errors appropriately
- Use transactions for multi-table operations

### Testing Requirements
- Unit tests for utility functions
- Integration tests for API endpoints
- Component tests for React components
- E2E tests for user workflows
- Minimum 80% code coverage

## Debugging Guide

### Common Issues and Solutions

#### Database Connection Issues
```bash
# Check if PostgreSQL is running
sudo service postgresql status

# Check database exists
psql -l | grep vantahire

# Reset database schema
npm run db:push
```

#### Frontend Build Issues
```bash
# Clear node modules and reinstall
rm -rf node_modules package-lock.json
npm install

# Check for TypeScript errors
npx tsc --noEmit
```

#### Authentication Problems
```bash
# Check session configuration
# Verify SESSION_SECRET in .env
# Clear browser cookies and try again
```

### Debugging Tools
- **React DevTools** - Browser extension for React debugging
- **Network Tab** - Monitor API calls and responses
- **Console Logs** - Use `console.log` strategically, remove before committing
- **Postman/Thunder Client** - Test API endpoints directly
- **Database GUI** - Use pgAdmin or similar for database inspection

## Performance Optimization

### Frontend Performance
- Use React.lazy for code splitting
- Implement virtualization for large lists
- Optimize images and assets
- Minimize bundle size with tree shaking
- Use React Query for efficient data fetching

### Backend Performance
- Add database indexes for frequently queried columns
- Use connection pooling for database
- Implement caching for static data
- Optimize SQL queries
- Use compression middleware

### Database Performance
```sql
-- Add indexes for common queries
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_applications_user_id ON applications(user_id);
CREATE INDEX idx_applications_job_id ON applications(job_id);
```

## Security Guidelines

### Input Validation
```typescript
// Always validate with Zod schemas
const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const result = schema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({ error: result.error });
}
```

### Authentication Checks
```typescript
// Use middleware for protected routes
app.get("/api/protected", requireAuth, (req, res) => {
  // req.user is available here
});

// Check user roles
app.post("/api/admin-only", requireRole(['admin']), (req, res) => {
  // Only admin users can access
});
```

### Data Sanitization
- Never directly insert user input into SQL queries
- Use parameterized queries via Drizzle ORM
- Sanitize HTML content if displaying user-generated content
- Validate file uploads and restrict file types

## Useful Commands

### Development
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run test         # Run unit tests
npm run test:e2e     # Run end-to-end tests
npm run lint         # Check code style
npm run type-check   # TypeScript type checking
```

### Database
```bash
npm run db:push      # Push schema changes to database
npm run db:studio    # Open Drizzle Studio (database GUI)
npm run db:seed      # Seed database with test data
npm run create-admin # Create admin user
```

### Testing
```bash
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report
npm run test:unit    # Run only unit tests
npm run test:integration # Run only integration tests
```

## Team Communication

### Code Review Process
1. Create PR with clear description
2. Include screenshots for UI changes
3. Add relevant labels and reviewers
4. Address feedback promptly
5. Squash commits before merging

### Issue Reporting
- Use provided issue templates
- Include reproduction steps
- Add relevant labels
- Assign to appropriate team members
- Link related PRs and issues

### Documentation Updates
- Update README for setup changes
- Document new API endpoints
- Add code comments for complex logic
- Update type definitions
- Keep changelog current

## Resources and References

### Documentation
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [TanStack Query](https://tanstack.com/query/latest)
- [Shadcn/ui Components](https://ui.shadcn.com/)

### Tools
- [VS Code Extensions](https://code.visualstudio.com/) - ES7+ React snippets, TypeScript Hero
- [Chrome DevTools](https://developers.google.com/web/tools/chrome-devtools)
- [Postman](https://www.postman.com/) - API testing
- [pgAdmin](https://www.pgadmin.org/) - PostgreSQL administration

### Team Contacts
- **Lead Developer**: [Contact Information]
- **DevOps Engineer**: [Contact Information]
- **UI/UX Designer**: [Contact Information]
- **Product Manager**: [Contact Information]

## Troubleshooting Checklist

When you encounter issues:

1. **Check the logs** - Both browser console and server console
2. **Verify environment variables** - Ensure all required variables are set
3. **Test API endpoints** - Use Postman or curl to test backend directly
4. **Check database state** - Verify data exists and is correct
5. **Clear caches** - Browser cache, node_modules, build cache
6. **Restart services** - Stop and start development server
7. **Ask for help** - Don't spend more than 30 minutes on a blocker

## Next Steps

After completing this onboarding:

1. **Pick your first issue** - Look for "good first issue" labels
2. **Join team meetings** - Attend daily standups and planning sessions
3. **Set up development tools** - Configure your preferred IDE and extensions
4. **Read team documentation** - Review coding standards and architecture decisions
5. **Start contributing** - Begin with small improvements and bug fixes

Welcome to the team! We're excited to have you contribute to VantaHire's success.