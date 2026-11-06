// PREVIEW ONLY, never shipped: a keyword-based stand-in for the constrained AI interpreter, so
// the prototype can show proposals, clarifying questions and "can't help" without a model call.
// The real interpreter is a Codex backend endpoint returning the same typed result.
import type { AssistResult, Interpret, Op, Proposal } from "@/components/candidate-profile/SparkAssist";

const CITIES: Record<string, [string, string]> = {
  hyderabad: ["Hyderabad", "IN"], bengaluru: ["Bengaluru", "IN"], bangalore: ["Bengaluru", "IN"], mumbai: ["Mumbai", "IN"],
  pune: ["Pune", "IN"], chennai: ["Chennai", "IN"], delhi: ["Delhi", "IN"], gurugram: ["Gurugram", "IN"], noida: ["Noida", "IN"],
  dubai: ["Dubai", "AE"], singapore: ["Singapore", "SG"], london: ["London", "GB"],
};
/** PREVIEW ONLY: a few fictional entries standing in for ealana's own company registry. */
export const COMPANIES = [
  { id: "7d1c2f9e-0000-4000-8000-000000000001", name: "Ledgerly", domain: "ledgerly.example" },
  { id: "7d1c2f9e-0000-4000-8000-000000000002", name: "Northstar Pay", domain: "northstarpay.example" },
  { id: "7d1c2f9e-0000-4000-8000-000000000003", name: "Cashwave", domain: "cashwave.example" },
  { id: "7d1c2f9e-0000-4000-8000-000000000004", name: "Kitebyte", domain: "kitebyte.example" },
  { id: "7d1c2f9e-0000-4000-8000-000000000005", name: "Finmint", domain: "finmint.example" },
  { id: "7d1c2f9e-0000-4000-8000-000000000006", name: "Orbit Commerce", domain: "orbitcommerce.example" },
  { id: "7d1c2f9e-0000-4000-8000-000000000007", name: "Orbit Labs", domain: "orbitlabs.example" },
];
export const searchCompanies = async (q: string) => { await new Promise(r => setTimeout(r, 400)); const t = q.trim().toLowerCase(); return COMPANIES.filter(c => c.name.toLowerCase().includes(t)).slice(0, 5); };
const wait = () => new Promise(r => setTimeout(r, 900));
const cityIn = (t: string) => Object.entries(CITIES).find(([k]) => new RegExp(`\\b${k}\\b`, "i").test(t))?.[1];

/** Light tidy only: capitalise and end with a full stop. Words and numbers are kept exactly. */
function tidy(t: string) { const s = t.trim().replace(/\s+/g, " "); return s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : "."); }

export const simulateSpark: Interpret = async (useCase, raw, ctx) => {
  await wait();
  const text = raw.trim(), lower = text.toLowerCase();
  if (/ignore (all|previous)|system prompt|you are now/i.test(text))
    return { kind: "cannot_help", message: "I can only help with your profile and job preferences. You can change things directly instead." };

  const proposal = (ops: Op[]): Proposal => ({ kind: "proposal", baseVersion: ctx.baseVersion, ops, evidence: text.split("\n")[0]!.slice(0, 200) });
  if (useCase === "correction") {
    const rows = ctx.rows ?? [];
    // Exact employer name only; an end date applies to their latest role there, a start date to the first.
    const mine = rows.filter(r => new RegExp(`\\b${r.employer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text));
    const year = text.match(/\b(19|20)\d{2}\b/)?.[0];
    const isEnd = /(ended|left|until|finished|end)/i.test(text), isStart = /(started|joined|from|start)/i.test(text);
    if (mine.length && year && (isEnd || isStart)) {
      const r = isEnd ? mine[0]! : mine[mine.length - 1]!;
      return proposal([{ op: isEnd ? "employment_end" : "employment_start", rowId: r.id, employer: r.employer, title: r.title, year }]);
    }
    if (/\n(job dates|job title)/i.test(text)) return { kind: "cannot_help", message: "Tell me which job and what's right, for example \"Freshworks ended in 2022\"." };
    if (lower.includes("\nsomething else")) return { kind: "cannot_help", message: "I can't change that from here. Choose \"Yes, this is me\" and edit it on the review screen." };
    return { kind: "clarify", question: "Which part is wrong?", options: ["Job dates", "Job title", "Something else"] };
  }

  if (useCase === "impact") {
    if (text.split(/\s+/).length < 4) return { kind: "clarify", question: "Can you say a bit more? For example, what you built, owned or improved.", options: ["I'll add more"] };
    const r = ctx.row!;
    return proposal([{ op: "role_description", rowId: r.id, employer: r.employer, title: r.title, text: tidy(text) }]);
  }

  const ops: Op[] = [];
  if (useCase === "exclusions") {
    // Only the kinds we can enforce become exclusions. A company counts only when it is exactly one
    // registry entry (the card shows its name and domain to confirm); everything else is a note.
    for (const part of text.split(/,|;|\band\b|\n/i).map(s => s.trim()).filter(Boolean)) {
      if (/remote only|only remote|fully remote|no (on-?site|office)/i.test(part)) { ops.push({ op: "exclude", rule: { kind: "remote_only" } }); continue; }
      if (/\b(no|not|avoid)\b.*\btravel/i.test(part)) { ops.push({ op: "exclude", rule: { kind: "no_travel" } }); continue; }
      const name = part.replace(/^(no|not|avoid|exclude)\s+/i, "").trim().toLowerCase();
      const hits = COMPANIES.filter(c => c.name.toLowerCase() === name);
      if (hits.length === 1) { const c = hits[0]!; ops.push({ op: "exclude", rule: { kind: "exclude_company", companyId: c.id, companyName: c.name, domain: c.domain } }); continue; }
      ops.push({ op: "private_note", text: tidy(part).replace(/\.$/, "") });
    }
    return ops.length ? proposal(ops) : { kind: "clarify", question: "What would make you say no to a job?", options: ["Company type", "Working hours", "Travel"] };
  }

  // search change
  const c = cityIn(text);
  if (c && /(mov|relocat|shift)/i.test(text)) ops.push({ op: "add_place", city: c[0], countryCode: c[1] }, { op: "relocation", mode: "yes", city: c[0], countryCode: c[1] });
  else if (c) ops.push({ op: "add_place", city: c[0], countryCode: c[1] });
  if (/\blead\b/i.test(text)) ops.push({ op: "seniority", values: ["Lead"] }, { op: "add_role", role: "Lead Software Engineer" });
  if (/\bremote\b/i.test(text)) ops.push({ op: "arrangements", values: ["remote"] });
  const pay = text.match(/(\d{2,3})\s*(l|lakh|lpa)\b/i);
  if (pay) ops.push({ op: "pay_minimum", amount: String(Number(pay[1]) * 100000), currency: "INR" });
  if (ops.length) return proposal(ops) satisfies AssistResult;
  return { kind: "clarify", question: "What would you like to change?", options: ["Where I work", "The roles I want", "My pay"] };
};
