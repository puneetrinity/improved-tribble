// Read-only summary of the candidate's private job preferences, shown beside the profile.
// Ordinary preferences are flexible: they rank jobs, never hide them, so no "Must have" badge.
import { Briefcase, Clock, Globe2, MapPin, Plane, Wallet, Pencil, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Preferences } from "@/lib/candidate-profile-api";
import { countryName } from "./fields";

const ARR: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
const TYPE: Record<string, string> = { permanent: "Permanent", contract: "Contract", gig_freelance: "Gig / freelance", part_time: "Part-time", internship: "Internship" };

/** Indian amounts read naturally in lakhs; other currencies use grouped figures. */
export function money(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  if (currency === "INR") return `₹${(n / 100000).toLocaleString("en-IN", { maximumFractionDigits: 1 })}L`;
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function pay(c: Preferences["compensation"]): string {
  if (c.mode === "open_to_discussion") return "Open to discussing pay";
  const t = c as { currency: string; period: string; component: string; targetMin: string; targetMax: string; hardMinimum: string | null };
  const per = t.period === "annual" ? "a year" : t.period === "monthly" ? "a month" : "an hour";
  const what = t.component === "base" ? "base" : t.component === "ctc" ? "CTC" : "total";
  const range = t.targetMin === t.targetMax ? money(t.targetMin, t.currency) : `${money(t.targetMin, t.currency)} – ${money(t.targetMax, t.currency)}`;
  return `${range} ${per}, ${what}${t.hardMinimum ? ` (no less than ${money(t.hardMinimum, t.currency)})` : ""}`;
}

function availability(a: Preferences["availability"]): string | null {
  const v = a as { mode: string; days?: number; date?: string };
  if (v.mode === "immediate") return "Available now";
  if (v.mode === "notice_days" && v.days) return `${v.days} days' notice`;
  if (v.mode === "date" && v.date) return `From ${v.date}`;
  return null;
}

function relocation(r: Preferences["relocation"]): string {
  const to = r.destinations.map(d => d.city).join(", ");
  if (r.mode === "yes") return to ? `Yes, to ${to}` : "Yes";
  if (r.mode === "discuss") return to ? `Maybe, to ${to}` : "Maybe, for the right job";
  return "No";
}

/** `notAnswered` rows say "Not answered" instead of a default, so we never imply an answer. */
export function PreferencesSummary({ preferences, canEdit, onEdit, notAnswered = [], unansweredSections }: { preferences: Preferences | null; canEdit: boolean; onEdit: () => void; notAnswered?: ("roles" | "where" | "how" | "pay")[];
  /** spark: the exact sections not yet answered; each row says "Not answered" instead of a default. */
  unansweredSections?: string[] | undefined }) {
  if (!preferences) {
    return (
      <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted/30 p-4">
        <p className="text-sm font-medium text-foreground">Tell us what you're looking for</p>
        <p className="text-sm text-muted-foreground">Roles, where you want to work and pay. We use this to find matching jobs.</p>
        {canEdit && <Button type="button" className="min-h-11 w-full cursor-pointer gap-1.5" onClick={onEdit}><SlidersHorizontal className="h-4 w-4" aria-hidden />Add job preferences</Button>}
      </div>
    );
  }
  const p = preferences;
  const places = p.locations.mode === "anywhere" ? "Anywhere" : (p.locations as { places: { city: string; countryCode: string }[] }).places
    .map(x => [x.city, countryName(x.countryCode)].filter(Boolean).join(", ")).join("; ");
  const no = (f: "roles" | "where" | "how" | "pay") => notAnswered.includes(f);
  const na = (section: string) => !!unansweredSections?.includes(section);
  const NA = "Not answered";
  const rows: { icon: LucideIcon; label: string; value: string}[] = [
    { icon: Briefcase, label: "Roles", value: no("roles") || na("roles") ? NA : [...p.desiredRoles, ...p.preferredSeniority.map(x => `${x} level`)].join(", ") || NA },
    { icon: MapPin, label: "Where", value: no("where") || na("location") ? NA : places },
    { icon: Plane, label: "Would move", value: no("where") || na("relocation") ? NA : relocation(p.relocation) },
    { icon: Globe2, label: "How", value: no("how") ? NA : [na("arrangement") ? "" : p.workArrangements.map(x => ARR[x] ?? x).join(", "), na("employment_types") ? "" : p.employmentTypes.map(x => TYPE[x] ?? x).join(", ")].filter(Boolean).join(" · ") || NA },
    { icon: Wallet, label: "Pay", value: no("pay") || na("compensation") ? NA : pay(p.compensation) },
  ];
  const when = na("availability") ? NA : availability(p.availability);
  if (when) rows.push({ icon: Clock, label: "Start", value: when });
  return (
    <div className="space-y-4">
      <dl className="space-y-4">
        {rows.map(r => (
          <div key={r.label} className="flex gap-3">
            <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {r.label}
              </dt>
              <dd className="mt-0.5 text-sm text-foreground">{r.value}</dd>
            </div>
          </div>
        ))}
      </dl>
      {canEdit && <Button type="button" variant="outline" className="min-h-11 w-full cursor-pointer gap-1.5" onClick={onEdit}><Pencil className="h-4 w-4" aria-hidden />Edit preferences</Button>}
    </div>
  );
}
