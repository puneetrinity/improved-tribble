import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { JobPostingStepper } from '@/components/JobPostingStepper';
import { TooltipProvider } from '@/components/ui/tooltip';
import { renderWithProviders } from '../utils/test-helpers';

const fetchMock = vi.fn();
const setLocationMock = vi.fn();
const toastMock = vi.fn();

vi.mock('wouter', () => ({
  useLocation: () => ['/jobs/post', setLocationMock],
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/lib/queryClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queryClient')>('@/lib/queryClient');
  return {
    ...actual,
    apiRequest: vi.fn(),
    queryClient: {
      invalidateQueries: vi.fn(),
    },
  };
});

vi.mock('@/components/jd/JdAiAnalysisDrawer', () => ({
  JdAiAnalysisDrawer: () => null,
}));

function makeDescription(wordCount = 200) {
  return Array.from({ length: wordCount }, (_, index) => `word${index + 1}`).join(' ');
}

describe('JobPostingStepper loading boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('defers team and setup queries until their steps are reached', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <TooltipProvider>
        <JobPostingStepper />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(fetchMock).not.toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText(/job title/i), {
      target: { value: 'Senior Backend Engineer' },
    });
    fireEvent.change(screen.getByLabelText(/location/i), {
      target: { value: 'Remote' },
    });
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    fireEvent.change(screen.getByLabelText(/job description/i), {
      target: { value: makeDescription() },
    });
    await user.click(screen.getByRole('button', { name: /^next$/i }));
    await user.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/users?role=hiring_manager', { credentials: 'include' });
      expect(fetchMock).toHaveBeenCalledWith('/api/clients', { credentials: 'include' });
    });

    const urlsAfterStep3 = fetchMock.mock.calls.map(([url]) => url);
    expect(urlsAfterStep3).not.toContain('/api/my-jobs');
    expect(urlsAfterStep3).not.toContain('/api/email-templates');
    expect(urlsAfterStep3).not.toContain('/api/pipeline/stages');

    await user.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/my-jobs', { credentials: 'include' });
      expect(fetchMock).toHaveBeenCalledWith('/api/email-templates', { credentials: 'include' });
      expect(fetchMock).toHaveBeenCalledWith('/api/pipeline/stages', { credentials: 'include' });
    });
  }, 10000);
});
