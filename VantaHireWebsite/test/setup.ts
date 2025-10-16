import '@testing-library/jest-dom';
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Mock server for API testing
export const server = setupServer(
  http.get('/api/jobs', () => {
    return HttpResponse.json([
      {
        id: 1,
        title: 'Senior Developer',
        type: 'full-time',
        location: 'Remote',
        description: 'Test job description',
        skills: ['React', 'TypeScript'],
        deadline: null,
        postedBy: 1,
        createdAt: new Date(),
        isActive: true,
        status: 'approved',
        reviewComments: null,
        expiresAt: null,
        reviewedBy: null,
        reviewedAt: null
      }
    ]);
  }),
  http.get('/api/user', () => {
    return new HttpResponse(null, { status: 401 });
  }),
  http.post('/api/login', () => {
    return HttpResponse.json({
      id: 1,
      username: 'testuser',
      email: 'test@example.com',
      role: 'candidate',
      createdAt: new Date()
    });
  })
);

// Enable API mocking before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

// Reset any runtime request handlers
afterEach(() => {
  cleanup();
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => server.close());

// Mock environment variables
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));