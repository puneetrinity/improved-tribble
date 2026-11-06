/** The consent popup shows exactly the approved, versioned text, and its fingerprint is what we send. */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { canonicalProfileJson } from "../../../../server/candidate-product/profile-contracts";
import { ConsentStep, CONSENT_PURPOSES } from "./ConsentStep";
import { CONSENT_COPY_CURRENT, CONSENT_COPY_V1, CONSENT_COPY_V1_HASH, CONSENT_COPY_V2, CONSENT_COPY_V2_HASH } from "./consent-copy";

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { if (root) act(() => root!.unmount()); root = null; host?.remove(); host = null; });
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
async function mount() {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  const [privacy, terms] = CONSENT_COPY_CURRENT.documents;
  await act(async () => { root!.render(<ConsentStep textVersion="1" privacyUrl={privacy.url} termsUrl={terms.url} privacySettingsUrl="/my-dashboard#privacy" jobsUrl="/jobs" onDecide={() => undefined} />); });
}

describe("consent copy", () => {
  const sha = (c: unknown) => createHash("sha256").update(canonicalProfileJson(c), "utf8").digest("hex");
  it("fingerprint is sha256 of the canonical JSON of the whole record; v1 stays as recorded", () => {
    expect(sha(CONSENT_COPY_V1)).toBe(CONSENT_COPY_V1_HASH);
    expect(CONSENT_COPY_V1_HASH).toBe("ee5cd5b23456e6aaa5e5711f0d3b3b18e10d9d274b6b7da73b2afef3a17b2aa8");
    expect(sha(CONSENT_COPY_V2)).toBe(CONSENT_COPY_V2_HASH);
  });

  it("v2 changes only the version and the withdrawal sentence; the popup shows v2", () => {
    const { copyVersion: _a, withdrawal: _b, ...v1 } = CONSENT_COPY_V1;
    const { copyVersion: _c, withdrawal: _d, ...v2 } = CONSENT_COPY_V2;
    expect(v2).toEqual(v1);
    expect(CONSENT_COPY_V2.copyVersion).toBe(2);
    expect(CONSENT_COPY_CURRENT).toBe(CONSENT_COPY_V2);
  });

  it("covers every purpose once, with the ids the server records", () => {
    const ids = CONSENT_COPY_V1.sections.flatMap(s => s.purposes.map(p => p.id));
    expect([...ids].sort()).toEqual([...CONSENT_PURPOSES].sort());
  });

  it("the popup shows exactly this text, in this order", async () => {
    await mount();
    const page = norm(host!.textContent);
    const c = CONSENT_COPY_CURRENT;
    const expected = [c.title, c.intro, ...c.sections.flatMap(s => [s.label, ...s.purposes.flatMap(p => [p.title, p.text])]), c.withdrawal.text, c.agreement];
    let from = 0;
    for (const text of expected) {
      const at = page.indexOf(norm(text), from);
      expect(at, `missing or out of order: ${text.slice(0, 40)}`).toBeGreaterThanOrEqual(0);
      from = at + norm(text).length;
    }
    for (const d of c.documents) {
      const link = Array.from(host!.querySelectorAll("a")).find(a => a.textContent === d.label)!;
      expect(link.getAttribute("href")).toBe(d.url);
    }
    expect(Array.from(host!.querySelectorAll("a")).some(a => a.textContent === c.withdrawal.linkLabel)).toBe(true);
  });

  it("the decline screen shows exactly this text", async () => {
    await mount();
    const notNow = Array.from(host!.querySelectorAll("button")).find(b => b.textContent === "Not now")!;
    await act(async () => { notNow.click(); });
    const page = norm(host!.textContent);
    expect(page).toContain(CONSENT_COPY_CURRENT.decline.title);
    expect(page).toContain(norm(CONSENT_COPY_CURRENT.decline.text));
  });
});
