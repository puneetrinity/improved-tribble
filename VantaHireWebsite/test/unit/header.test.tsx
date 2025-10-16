import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Header from '@/components/Header';
import { AuthProvider } from '@/hooks/use-auth';

// Mock useLocation hook from wouter
vi.mock('wouter', () => ({
  useLocation: () => ['/', vi.fn()],
  Link: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
      </AuthProvider>
    </QueryClientProvider>
  );
};

describe('Header Component', () => {
  it('renders VantaHire logo', () => {
    render(<Header />, { wrapper: createWrapper() });
    expect(screen.getByText('VantaHire')).toBeInTheDocument();
  });

  it('shows mobile menu toggle on small screens', () => {
    render(<Header />, { wrapper: createWrapper() });
    const menuButton = screen.getByRole('button', { name: /menu/i });
    expect(menuButton).toBeInTheDocument();
  });

  it('toggles mobile menu when clicked', () => {
    render(<Header />, { wrapper: createWrapper() });
    const menuButton = screen.getByRole('button', { name: /menu/i });
    
    fireEvent.click(menuButton);
    // Menu should be visible after click
    expect(screen.getByText('Jobs')).toBeVisible();
  });

  it('displays navigation links', () => {
    render(<Header />, { wrapper: createWrapper() });
    expect(screen.getByText('Jobs')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();
  });

  it('shows auth buttons when user is not logged in', () => {
    render(<Header />, { wrapper: createWrapper() });
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });
});