/** /candidate-auth: spark sign-up and sign-in behind the server switch, with the exact consent record. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/hooks/use-auth";
import CandidateAuth from "@/pages/candidate-auth";
import { CONSENT_COPY_CURRENT_HASH } from "./consent-copy";
import { passwordProblem } from "./CandidateSignup";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; vi.unstubAllGlobals(); queryClient.clear(); window.location.hash = ""; });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const button = (name: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === name)!;
async function type(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;
async function mount(spark: boolean, handlers: Record<string, Handler> = {}) {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const calls: { path: string; body: any }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    calls.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const h = handlers[`${init?.method ?? "GET"} ${url.pathname}`];
    if (h) return h(url, init);
    if (url.pathname === "/api/client-config") return json(200, { candidateSparkSignupEnabled: spark });
    if (url.pathname === "/api/user") return json(401, { error: "Not authenticated" });
    if (url.pathname === "/api/csrf-token") return json(200, { token: "t" });
    return json(404, {});
  }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(<QueryClientProvider client={queryClient}><AuthProvider><CandidateAuth /></AuthProvider></QueryClientProvider>); });
  await flush();
  return calls;
}
async function signUp(email = "new@example.com", password = "Str0ng!pass") {
  await type("su-email", email); await type("su-password", password);
  await act(async () => { button("Create account").click(); }); await flush(2);
  // No server field for the optional marketing choice yet, so it isn't offered (never collected and dropped).
  expect(text()).toContain("I agree to the uses above");
  expect(text()).not.toContain("Send me ealana news and tips");
  expect(document.querySelectorAll('[role="dialog"] button[role="checkbox"]')).toHaveLength(1);
  const agree = document.querySelector('[role="dialog"] button[role="checkbox"]') as HTMLButtonElement;
  await act(async () => { agree.click(); }); await flush(1);
  await act(async () => { button("Agree and continue").click(); }); await flush();
}

describe("candidate auth page", () => {
  it("spark sign-in offers Forgot password: one neutral answer, never 'sent' when rate-limited", async () => {
    window.location.hash = "#signin";
    let status = 200;
    const calls = await mount(true, { "POST /api/forgot-password": () => json(status, { message: "If an account exists with this email, a password reset link has been sent." }) });
    await type("si-email", "someone@example.com");
    await act(async () => { button("Forgot password?").click(); }); await flush(1);
    expect((document.getElementById("fp-email") as HTMLInputElement).value).toBe("someone@example.com");
    status = 429;
    await act(async () => { button("Send reset link").click(); }); await flush();
    expect(text()).toContain("Too many reset requests");
    expect(text()).not.toContain("we've sent a link");
    status = 200;
    await act(async () => { button("Send reset link").click(); }); await flush();
    expect(calls.filter(c => c.path === "/api/forgot-password").map(c => c.body)).toEqual([{ email: "someone@example.com" }, { email: "someone@example.com" }]);
    expect(text()).toContain("If there's an account for someone@example.com, we've sent a link to reset your password.");
    await act(async () => { button("Back to sign in").click(); }); await flush(1);
    expect(document.getElementById("si-password")).not.toBeNull();
  });

  it("the old candidate page also offers Forgot password", async () => {
    await mount(false, { "POST /api/forgot-password": () => json(200, {}) });
    await act(async () => { button("Forgot password?").click(); }); await flush(1);
    await type("fp-email", "someone@example.com");
    await act(async () => { button("Send reset link").click(); }); await flush();
    expect(text()).toContain("we've sent a link to reset your password");
  });

  it("keeps the current page when spark sign-up is off", async () => {
    await mount(false);
    expect(text()).toContain("Candidate Portal");
    expect(document.getElementById("su-email")).toBeNull();
  });

  it("checks the password the way the server does, naming what's missing", () => {
    expect(passwordProblem("Short1!")).toBe("Use at least 10 characters.");
    expect(passwordProblem("Abcdef1!x")).toBe("Use at least 10 characters.");
    expect(passwordProblem("alllowercase1!")).toBe("Add an upper-case letter.");
    expect(passwordProblem("NoNumbersHere")).toBe("Add a number and a symbol.");
    expect(passwordProblem("lowercaseonly")).toBe("Add an upper-case letter, a number and a symbol.");
    expect(passwordProblem("Str0ng!pass")).toBeUndefined();
  });

  it("signs up with the exact consent record, then asks the candidate to check their email", async () => {
    const calls = await mount(true, { "POST /api/register": () => json(201, { requiresVerification: true, networkIntentStatus: "recorded" }) });
    expect(text()).toContain("At least 10 characters, with upper and lower case, a number and a symbol.");
    await type("su-email", "new@example.com"); await type("su-password", "weakpassword");
    await act(async () => { button("Create account").click(); }); await flush(2);
    expect(text()).toContain("Add an upper-case letter, a number and a symbol.");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await signUp();
    const reg = calls.find(c => c.path === "/api/register")!.body;
    expect(reg).toMatchObject({ username: "new@example.com", password: "Str0ng!pass", role: "candidate",
      networkIntent: { schemaVersion: 2, accepted: true, copyVersion: 2, copyHash: CONSENT_COPY_CURRENT_HASH } });
    expect(Object.keys(reg.networkIntent).sort()).toEqual(["accepted", "copyHash", "copyVersion", "idempotencyKey", "schemaVersion"]);
    expect(UUID.test(reg.networkIntent.idempotencyKey)).toBe(true);
    expect(JSON.stringify(reg)).not.toContain("marketing");
    expect(text()).toContain("Check your email");
    expect(text()).toContain("new@example.com");
    // The profile lookup isn't connected yet, so it isn't promised.
    expect(text()).not.toContain("look up your professional profile");
  });

  it("a retried sign-up reuses the same key; the server's message is shown when it refuses", async () => {
    let n = 0;
    const calls = await mount(true, { "POST /api/register": () => (++n === 1 ? json(503, { error: "busy" }) : json(400, { error: "An account with this email already exists" })) });
    await signUp();
    expect(text()).toContain("We couldn't create your account. Please try again.");
    await act(async () => { button("Agree and continue").click(); }); await flush();
    expect(text()).toContain("An account with this email already exists");
    const keys = calls.filter(c => c.path === "/api/register").map(c => c.body.networkIntent.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("an unverified sign-in goes to Check your email", async () => {
    window.location.hash = "#signin";
    await mount(true, { "POST /api/login": () => json(403, { error: "Please verify your email", code: "EMAIL_NOT_VERIFIED" }) });
    expect(text()).toContain("Welcome back.");
    await type("si-email", "Back@Example.com"); await type("si-password", "anything");
    await act(async () => { button("Sign in").click(); }); await flush();
    expect(text()).toContain("Check your email");
    expect(text()).toContain("back@example.com");
  });
});
