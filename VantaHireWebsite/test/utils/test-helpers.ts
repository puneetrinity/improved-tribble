import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, RenderOptions } from '@testing-library/react';
import { ReactElement, ReactNode } from 'react';

// Create a test query client with disabled retries and cache
export const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: 0,
    },
    mutations: {
      retry: false,
    },
  },
});

// Test wrapper that provides React Query context
interface TestWrapperProps {
  children: ReactNode;
  queryClient?: QueryClient;
}

export const TestWrapper = ({ children, queryClient }: TestWrapperProps) => {
  const client = queryClient || createTestQueryClient();
  
  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
};

// Custom render function that includes providers
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
}

export const renderWithProviders = (
  ui: ReactElement,
  options: CustomRenderOptions = {}
) => {
  const { queryClient, ...renderOptions } = options;
  
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <TestWrapper queryClient={queryClient}>
      {children}
    </TestWrapper>
  );

  return render(ui, { wrapper: Wrapper, ...renderOptions });
};

// Mock API responses
export const mockApiResponse = (data: any, status = 200) => ({
  json: () => Promise.resolve(data),
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
});

// Test data generators
export const generateTestData = {
  job: (overrides = {}) => ({
    id: 1,
    title: 'Software Engineer',
    type: 'full-time',
    location: 'Remote',
    description: 'We are looking for a skilled software engineer.',
    skills: ['React', 'TypeScript'],
    deadline: null,
    postedBy: 1,
    createdAt: new Date(),
    isActive: true,
    status: 'approved',
    reviewComments: null,
    expiresAt: null,
    reviewedBy: null,
    reviewedAt: null,
    ...overrides
  }),
  
  user: (overrides = {}) => ({
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    role: 'candidate',
    createdAt: new Date(),
    ...overrides
  }),
  
  application: (overrides = {}) => ({
    id: 1,
    jobId: 1,
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    resumeUrl: 'https://example.com/resume.pdf',
    coverLetter: 'I am interested in this position.',
    status: 'pending',
    submittedAt: new Date(),
    reviewedAt: null,
    notes: null,
    viewed: false,
    downloaded: false,
    ...overrides
  })
};

// Accessibility testing helpers
export const checkAccessibility = async (container: HTMLElement) => {
  const { toHaveNoViolations } = await import('jest-axe');
  expect.extend(toHaveNoViolations);
  
  const axe = await import('axe-core');
  const results = await axe.run(container);
  expect(results).toHaveNoViolations();
};

// Performance testing helpers
export const measurePerformance = async (fn: () => Promise<void>) => {
  const start = performance.now();
  await fn();
  const end = performance.now();
  return end - start;
};

// Form testing helpers
export const fillForm = async (form: HTMLFormElement, data: Record<string, string>) => {
  const { fireEvent } = await import('@testing-library/react');
  
  Object.entries(data).forEach(([name, value]) => {
    const input = form.querySelector(`[name="${name}"]`) as HTMLInputElement;
    if (input) {
      fireEvent.change(input, { target: { value } });
    }
  });
};

// Wait for element helpers
export const waitForApiCall = (timeout = 5000) => new Promise(resolve => {
  setTimeout(resolve, timeout);
});

// Mock file helpers
export const createMockFile = (name = 'test.pdf', content = 'Mock PDF content') => {
  return new File([content], name, { type: 'application/pdf' });
};

// Error boundary testing
export const TestErrorBoundary = ({ children }: { children: ReactNode }) => {
  try {
    return <>{children}</>;
  } catch (error) {
    return <div>Something went wrong: {error instanceof Error ? error.message : 'Unknown error'}</div>;
  }
};