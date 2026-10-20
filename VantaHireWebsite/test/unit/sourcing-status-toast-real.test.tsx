import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Toaster } from '../../client/src/components/ui/toaster';
import { useSourcingStatusToast, type SourcingNotice } from '../../client/src/components/sourcing/sourcing-status-toast';

// Real shared toaster (no mocks): proves rendering, the visible dismiss control and page-leave cleanup end to end.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
function Page({ notice }: { notice: SourcingNotice | null }) {
  useSourcingStatusToast('job:192:run:r1', notice);
  return null;
}
const stalled: SourcingNotice = { key: 'rc:attention:x', tone: 'attention', title: 'Search needs attention', description: 'We’re letting support know.' };
const visibleNotices = () =>
  Array.from(document.querySelectorAll('[data-sourcing-notice]')).filter((el) => el.closest('[data-state="open"]'));
beforeEach(() => {
  window.sessionStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('renders in the real toaster, and the labelled dismiss button closes it', async () => {
  await act(async () => root.render(<><Toaster /><Page notice={stalled} /></>));
  expect(visibleNotices()).toHaveLength(1);
  expect(document.body.textContent).toContain('Search needs attention');
  const button = document.querySelector('button[aria-label="Dismiss notification"]') as HTMLButtonElement;
  expect(button).toBeTruthy();
  await act(async () => button.click());
  expect(visibleNotices()).toHaveLength(0);
});

it('leaving the page closes its notice in the real toaster', async () => {
  function App({ show }: { show: boolean }) {
    return <><Toaster />{show ? <Page notice={{ ...stalled, key: 'rc:attention:y' }} /> : null}</>;
  }
  await act(async () => root.render(<App show />));
  expect(visibleNotices()).toHaveLength(1);
  await act(async () => root.render(<App show={false} />));
  expect(visibleNotices()).toHaveLength(0);
});
