// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

const privacyPolicy = read("../../../client/src/pages/privacy-policy-page.tsx");
const terms = read("../../../client/src/pages/terms-of-service-page.tsx");
const cookiePolicy = read("../../../client/src/pages/cookie-policy-page.tsx");
const cookieConsent = read("../../../client/src/components/CookieConsent.tsx");
const sidebar = read("../../../client/src/components/ui/sidebar.tsx");
const auth = read("../../auth.ts");
const csrf = read("../../csrf.ts");
const releaseGate = read("../../../docs/legal-policy-release-gate.md");

describe("public legal claims", () => {
  it("does not publish the retired provider or unsupported deletion/security promises", () => {
    const publicPolicies = `${privacyPolicy}\n${terms}\n${cookiePolicy}`;

    expect(publicPolicies).not.toContain("OpenAI");
    expect(privacyPolicy).not.toContain("after 2 years of inactivity");
    expect(privacyPolicy).not.toContain("job posting is active plus 1 year");
    expect(privacyPolicy).not.toContain("Protection on all state changes");
    expect(privacyPolicy).not.toContain("does not give it access");
    expect(privacyPolicy).not.toContain("we will take steps to delete such information");
    expect(privacyPolicy).not.toContain("We retain personal information only as needed");
    expect(privacyPolicy).not.toContain("Portability");
    expect(terms).not.toContain("binding arbitration");
    expect(terms).not.toContain("class action lawsuit");
    expect(terms).not.toContain("any other reason we deem appropriate");
    expect(privacyPolicy).toMatch(/automated hard-deletion\s+schedules are not\s+yet part of this control/);
    expect(privacyPolicy).toContain("Organizations are not authorized");
    expect(terms).toContain("cannot lawfully be waived");
  });

  it("preserves shipped 1AF wording and keeps the four candidate privacy actions distinct", () => {
    expect(privacyPolicy).toContain('right: "Erasure review"');
    expect(privacyPolicy).toContain('right: "Global matching opt-out"');
    expect(privacyPolicy).toContain("places it in a reversible quarantine");
    expect(privacyPolicy).toContain("it is not a promise of immediate hard deletion");
    expect(privacyPolicy).toContain("Withdrawing an application");
    expect(privacyPolicy).toContain("recruiter can remove only its own organization's pool membership");
    expect(terms).toContain("are different actions");
    expect(terms).toContain("may not re-import or recreate a suppressed profile");
  });

  it("names the cookie and storage keys the implementation actually uses", () => {
    const sessionStart = auth.indexOf("const sessionSettings: session.SessionOptions");
    const sessionEnd = auth.indexOf('app.set("trust proxy"', sessionStart);
    const sessionSettings = auth.slice(sessionStart, sessionEnd);

    expect(sessionSettings).not.toMatch(/\bname\s*:/);
    expect(sessionSettings).toContain("maxAge: 24 * 60 * 60 * 1000");
    expect(cookiePolicy).toContain("connect.sid");

    expect(csrf).toContain("__Host-psifi.x-csrf-token");
    expect(cookiePolicy).toContain("__Host-psifi.x-csrf-token");

    expect(sidebar).toContain('const SIDEBAR_COOKIE_NAME = "sidebar_state"');
    expect(sidebar).toContain("const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7");
    expect(cookiePolicy).toContain("sidebar_state");

    expect(cookieConsent).toContain("const CONSENT_KEY = 'consent.analytics'");
    expect(cookiePolicy).toContain("consent.analytics (local storage)");
  });

  it("loads analytics providers only from the accepted-consent branch", () => {
    const acceptStart = cookieConsent.indexOf("const accept = async () =>");
    const declineStart = cookieConsent.indexOf("const decline = () =>", acceptStart);
    const acceptBlock = cookieConsent.slice(acceptStart, declineStart);
    const declineBlock = cookieConsent.slice(declineStart, cookieConsent.indexOf("if (!visible)", declineStart));

    expect(acceptBlock).toContain("loadGoogleAnalytics();");
    expect(acceptBlock).toContain("loadApolloTracker(cfg.apolloAppId)");
    expect(declineBlock).not.toContain("loadGoogleAnalytics");
    expect(declineBlock).not.toContain("loadApolloTracker");
    expect(cookieConsent).toContain("if (val === 'accepted')");
  });

  it("blocks publication until the complete reversible privacy path is production-proved", () => {
    for (const gate of ["1AM", "1AF", "1AD", "1AR", "1AE"]) {
      expect(releaseGate).toContain(gate);
    }
    expect(releaseGate).toContain("READY — 1AE-P5 CLOSED; INDEPENDENT VERIFICATION REQUIRED BEFORE PUBLICATION");
    expect(releaseGate).toContain("c269c86f4eb38b725e66c0385f2154a48985870d");
    expect(releaseGate).toContain("Evidence for the cookie and security corrections");
    expect(releaseGate).toContain("security.txt");
    expect(releaseGate).toContain("Hard deletion");
    expect(releaseGate).toContain("Ealana does not currently have a separate legal team");
    expect(releaseGate).toContain("product owner");
    expect(releaseGate).toContain("13 November 2025 commencement notification");
    expect(releaseGate).toContain("restored auto-deploy on all seven runtimes");
    expect(releaseGate).toMatch(/no deployment was\s+queued/);
  });

  it("publishes one exact effective date across all three pages", () => {
    for (const policy of [privacyPolicy, terms, cookiePolicy]) {
      expect(policy).toContain("Last Updated: August 26, 2026");
    }
  });
});
