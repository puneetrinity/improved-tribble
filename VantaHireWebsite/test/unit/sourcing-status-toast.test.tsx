import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ toast: vi.fn(), update: vi.fn(), dismiss: vi.fn() }));
vi.mock('../../client/src/hooks/use-toast', () => ({ toast: mocks.toast }));
import {
  pickSourcingNotice,
  useSourcingStatusToast,
  AUTO_DISMISS_MS,
  type SourcingNotice,
} from '../../client/src/components/sourcing/sourcing-status-toast';

const rc = (state: string, extra: Record<string, unknown> = {}) =>
  ({ state, processed: 300, total: 300, updatedAt: '2026-10-20T07:37:51Z', notificationDelivered: false, ...extra }) as never;

describe('pickSourcingNotice', () => {
  it('turns a stalled search into a persistent attention notice', () => {
    const n = pickSourcingNotice({ rcProgress: rc('stalled', { processed: 12 }) })!;
    expect(n.tone).toBe('attention');
    expect(n.title).toBe('Search needs attention');
    expect(n.description).toContain('We’re letting support know.');
  });

  it('says results are ready once the run has completed, never "being prepared"', () => {
    const n = pickSourcingNotice({ rcProgress: rc('partial'), runStatus: 'completed' })!;
    expect(n).toMatchObject({ tone: 'done', title: 'Your results are ready.' });
    expect(n.description).not.toContain('being prepared');
  });

  it('keeps "being prepared" while results are not ready yet', () => {
    const n = pickSourcingNotice({ rcProgress: rc('complete'), runStatus: 'processing' })!;
    expect(n.description).toContain('Your results are being prepared.');
  });

  it('shows the most severe notice when several apply', () => {
    const n = pickSourcingNotice({
      rcProgress: rc('complete'),
      runStatus: 'completed',
      briefSourcingNotice: true,
      capabilityError: true,
      onCapabilityRetry: () => {},
    })!;
    expect(n.tone).toBe('failed');
    expect(n.key).toBe('capability-error');
    expect(n.retry).toBeTypeOf('function');
  });

  it('classifies governed messages by severity', () => {
    expect(pickSourcingNotice({ governedMessage: 'We couldn’t start this search. (Reason: X)' })!.tone).toBe('failed');
    expect(pickSourcingNotice({ governedMessage: 'Your allowance or hiring criteria changed. Click Find candidates to check and confirm again.' })!.tone).toBe('attention');
    expect(pickSourcingNotice({ governedMessage: 'Search started. Each job gets one search, so you can’t start another for this job.' })!.tone).toBe('info');
  });

  it('returns nothing when there is nothing to say', () => {
    expect(pickSourcingNotice({})).toBeNull();
  });
});

describe('useSourcingStatusToast', () => {
  let root: Root;
  let host: HTMLDivElement;
  let handles: Array<{ id: string; update: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> }>;
  function Harness({ scope, notice }: { scope: string; notice: SourcingNotice | null }) {
    useSourcingStatusToast(scope, notice);
    return null;
  }
  const render = (notice: SourcingNotice | null, scope = 'job:192:run:r1') =>
    act(() => root.render(<Harness scope={scope} notice={notice} />));
  const propsOf = (i: number) => mocks.toast.mock.calls[i][0];
  // Render a toast body to inspect the dismiss control.
  const body = (i: number) => {
    const el = document.createElement('div');
    const r = createRoot(el);
    act(() => r.render(<>{propsOf(i).description}</>));
    return { el, unmount: () => act(() => r.unmount()) };
  };
  beforeEach(() => {
    handles = [];
    window.sessionStorage.clear();
    mocks.toast.mockReset().mockImplementation(() => {
      const h = { id: `t${handles.length + 1}`, update: vi.fn(), dismiss: vi.fn() };
      handles.push(h);
      return h;
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const stalled: SourcingNotice = { key: 'rc:attention:x', tone: 'attention', title: 'Search needs attention', description: '12 of 300 profiles checked.' };
  const failure: SourcingNotice = { key: 'capability-error', tone: 'failed', title: 'We couldn’t load search settings.' };

  it('persists attention/failure toasts and auto-dismisses info', () => {
    render(stalled);
    expect(propsOf(0).duration).toBe(Number.POSITIVE_INFINITY);
    expect(propsOf(0).type).toBe('foreground');
    render({ key: 'governed:started', tone: 'info', title: 'Search started.' });
    expect(propsOf(1).duration).toBe(AUTO_DISMISS_MS);
    expect(propsOf(1).type).toBe('background');
  });

  it('never overrides the shared toast open handler', () => {
    render(stalled);
    expect(propsOf(0)).not.toHaveProperty('onOpenChange');
  });

  it('does not re-open on polling; updates counts in place', () => {
    render(stalled);
    render({ ...stalled });
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    render({ ...stalled, description: '20 of 300 profiles checked.' });
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(handles[0].update).toHaveBeenCalledTimes(1);
  });

  it('closes the toast when the condition clears', () => {
    render(stalled);
    render(null);
    expect(handles[0].dismiss).toHaveBeenCalledTimes(1);
  });

  it('A → B → A: a resolved error closes even when the earlier warning returns (R1)', () => {
    render(stalled); // A
    render(failure); // B replaces A
    expect(handles[0].dismiss).toHaveBeenCalledTimes(1);
    render(stalled); // B resolved, A applies again (already shown once)
    expect(handles[1].dismiss).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });

  it('closes its toast when the page unmounts (R2)', () => {
    render(failure);
    act(() => root.unmount());
    expect(handles[0].dismiss).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it('switching jobs without unmounting closes the old toast and does not suppress the new job (R2)', () => {
    render(failure, 'job:1:run:a');
    render(failure, 'job:2:run:b');
    expect(handles[0].dismiss).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });

  it('retry always calls the current handler (R2)', () => {
    const first = vi.fn();
    const second = vi.fn();
    render({ ...failure, retry: first });
    render({ ...failure, retry: second });
    propsOf(0).action.props.onClick();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('persistent notices have a visible, labelled 44px dismiss control; info does not (R3)', () => {
    render(stalled);
    const b = body(0);
    const button = b.el.querySelector('button[aria-label="Dismiss notification"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.className).toMatch(/\bh-11\b/);
    expect(button.className).toMatch(/\bw-11\b/);
    b.unmount();
    render({ key: 'governed:started', tone: 'info', title: 'Search started.' });
    const info = body(1);
    expect(info.el.querySelector('button')).toBeNull();
    info.unmount();
  });

  it('a dismissed persistent notice stays dismissed for that job after a reload, not for other jobs (R2)', () => {
    render(stalled, 'job:192:run:r1');
    const b = body(0);
    act(() => (b.el.querySelector('button') as HTMLButtonElement).click());
    b.unmount();
    expect(handles[0].dismiss).toHaveBeenCalledTimes(1);
    // Simulate a reload: fresh hook instance, same job.
    act(() => root.unmount());
    root = createRoot(host);
    render(stalled, 'job:192:run:r1');
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    render(stalled, 'job:193:run:r9');
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });
});
