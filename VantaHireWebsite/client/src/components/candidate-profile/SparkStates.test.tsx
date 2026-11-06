/** Shared spark screen states: offline, still working, signed out, password check. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OfflineBanner, ReauthDialog, SessionEnded, StillWorking } from "./SparkStates";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.useRealTimers(); vi.unstubAllGlobals(); });
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
async function mount(el: React.ReactElement) {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(el); });
}

describe("spark screen states", () => {
  it("offline banner appears only while offline and promises nothing about unsaved edits", async () => {
    await mount(<OfflineBanner />);
    expect(text()).not.toContain("offline");
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    expect(text()).toContain("You're offline. Reconnect to continue. Changes already saved are safe.");
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(text()).not.toContain("offline");
  });

  it("says 'Still working…' only after 8 seconds", async () => {
    vi.useFakeTimers();
    await mount(<StillWorking active />);
    await act(async () => { vi.advanceTimersByTime(7900); });
    expect(text()).not.toContain("Still working");
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(text()).toContain("Still working…");
  });

  it("signed-out screen links to sign in", async () => {
    await mount(<SessionEnded />);
    expect(text()).toContain("You've been signed out");
    expect(text()).toContain("Sign in again to continue. Anything you saved is kept.");
    expect(host!.querySelector("a")!.getAttribute("href")).toBe("/candidate-auth#signin");
  });

  it("password check: too many attempts and a lost session are not reported as a wrong password", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.useFakeTimers();
    let status = 429; const signedOut = vi.fn(), confirmed = vi.fn();
    const fetcher = vi.fn(async () => new Response(JSON.stringify(status === 401 ? { error: "Not authenticated" } : {}),
      { status, headers: status === 429 ? { "Retry-After": "75" } : {} })) as unknown as typeof fetch;
    await mount(<ReauthDialog open onCancel={() => undefined} onConfirmed={confirmed} onSignedOut={signedOut} fetcher={fetcher} />);
    const pw = document.getElementById("reauth-password") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(pw, "secret"); pw.dispatchEvent(new Event("input", { bubbles: true })); });
    const confirm = () => Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === "Confirm") as HTMLButtonElement;
    await act(async () => { confirm().click(); });
    expect(text()).toContain("Too many attempts. Please wait before trying again.");
    expect(text()).toContain("Try again in 1:15.");
    expect(confirm().disabled).toBe(true);
    // A direct form submit during the countdown sends nothing either.
    const sent = (fetcher as any).mock.calls.length;
    await act(async () => { document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect((fetcher as any).mock.calls.length).toBe(sent);
    expect(text()).not.toContain("That password isn't right.");
    // The wait ends: the countdown goes and Confirm works again.
    for (let i = 0; i < 76; i++) await act(async () => { vi.advanceTimersByTime(1000); });
    expect(text()).not.toContain("Try again in");
    status = 401;
    await act(async () => { confirm().click(); });
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("That password isn't right.");
    status = 200;
    await act(async () => { confirm().click(); });
    expect(confirmed).toHaveBeenCalledTimes(1);
  });
});
