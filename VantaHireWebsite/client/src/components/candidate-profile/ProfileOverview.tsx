// Profile-first view: the candidate's confirmed-or-draft profile shown the way an employer
// would read it, with an Edit control per section. Work history adapts the 21st.dev
// "Experience Timeline" (shadcnui-blocks): a vertical rail with a company marker per
// employer. Changes: roles are grouped under each employer with total time there, dates are
// partial (year / month), no tech badges, and every section has an empty state adapted from
// 21st.dev "Empty" (cnippet-dev) instead of disappearing.
import { useEffect, useState, type ReactNode } from "react";
import { Briefcase, Building2, FolderGit2, GraduationCap, Linkedin, MapPin, Pencil, Plus, Wrench, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ManualProfile } from "@/lib/candidate-profile-api";
import type { ProfileSection } from "./ProfessionalDetailsForm";

type DateValue = { value: string; precision: "year" | "month" | "day" } | null;
type Dated = { start: DateValue; end: DateValue; current: boolean };
type Employment = ManualProfile["employment"][number] & Dated;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmt(d: DateValue): string {
  if (!d) return "";
  const [y, m] = d.value.split("-");
  return d.precision === "year" || !m ? y! : `${MONTHS[Number(m) - 1]} ${y}`;
}
export function dateRange(r: Dated): string {
  const a = fmt(r.start), b = r.current ? "Present" : fmt(r.end);
  return a && b ? `${a} – ${b}` : a || b;
}
/** Months between two partial dates; a missing month counts as January. Null if unknown. */
function months(start: DateValue, end: DateValue, current: boolean, now = new Date()): number | null {
  if (!start) return null;
  const [sy, sm] = start.value.split("-").map(Number);
  let ey: number, em: number;
  if (current) { ey = now.getFullYear(); em = now.getMonth() + 1; }
  else if (end) { const [y, m] = end.value.split("-").map(Number); ey = y!; em = m ?? 1; }
  else return null;
  const n = (ey - sy!) * 12 + (em - (sm ?? 1));
  return n >= 0 ? n : null;
}
export function duration(total: number): string {
  const y = Math.floor(total / 12), m = total % 12;
  return [y && `${y} yr`, m && `${m} mo`].filter(Boolean).join(" ") || "Less than a month";
}

export type EmployerGroup = { employer: string; roles: Employment[]; total: number | null };
/** Group roles under the same employer (case-insensitive), most recent employer first. */
export function groupByEmployer(rows: Employment[]): EmployerGroup[] {
  const groups = new Map<string, EmployerGroup>();
  for (const r of rows) {
    const key = r.employer.trim().toLowerCase();
    const g = groups.get(key) ?? { employer: r.employer.trim(), roles: [], total: 0 };
    g.roles.push(r); groups.set(key, g);
  }
  const startKey = (r: Employment) => r.current ? "9999" : (r.end?.value ?? r.start?.value ?? "");
  return [...groups.values()].map(g => {
    g.roles.sort((a, b) => startKey(b).localeCompare(startKey(a)));
    // Span from the earliest start to the latest end, so overlapping roles aren't double counted.
    const starts = g.roles.map(r => r.start).filter(Boolean) as NonNullable<DateValue>[];
    const first = starts.sort((a, b) => a.value.localeCompare(b.value))[0] ?? null;
    const latest = g.roles[0]!;
    g.total = first ? months(first, latest.end, latest.current) : null;
    // Year-only dates can't measure short stints: "2018 – 2018" isn't "less than a month".
    if (g.total !== null && g.total < 12 && first?.precision === "year") g.total = null;
    return g;
  }).sort((a, b) => startKey(b.roles[0]!).localeCompare(startKey(a.roles[0]!)));
}

type Props = { profile: ManualProfile | null; canEdit: boolean; onEdit: (section: ProfileSection) => void };

/** The candidate's LinkedIn photo, linked directly (never fetched or stored by us). LinkedIn links
 * expire, so a broken or missing image shows initials instead. Candidate-facing only. */
export function CandidatePhoto({ url, name, className = "h-14 w-14 text-lg" }: { url?: string | null | undefined; name?: string | null | undefined; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const initials = (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";
  if (url && !broken) {
    return <img src={url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)}
      className={`shrink-0 rounded-full border border-border object-cover ${className}`} />;
  }
  return <span aria-hidden className={`flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary ${className}`}>{initials}</span>;
}

export function ProfileOverview({ profile, canEdit, onEdit }: Props) {
  const p = profile;
  const initials = (p?.displayName ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";
  const place = p?.currentLocation ? [p.currentLocation.city, p.currentLocation.displayCountry].filter(Boolean).join(", ") : "";
  const groups = groupByEmployer((p?.employment ?? []) as Employment[]);

  return (
    <div className="divide-y divide-border">
      {/* Identity */}
      <div className="flex items-start gap-4 pb-6">
        <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">{initials}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xl font-semibold text-foreground">{p?.displayName || <span className="text-muted-foreground">Your name</span>}</h3>
          <p className="mt-0.5 text-base text-foreground/80">{p?.headline || <span className="text-muted-foreground">Add a headline, for example "Backend engineer, payments"</span>}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {place && <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden />{place}</span>}
            {p?.linkedinUrl && (
              <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Linkedin className="h-4 w-4" aria-hidden />LinkedIn
              </a>
            )}
          </div>
        </div>
        {canEdit && <EditButton label="Edit name, headline and location" onClick={() => onEdit("basics")} />}
      </div>

      <Section title="Work experience" icon={Briefcase} canEdit={canEdit} filled={groups.length > 0} onEdit={() => onEdit("employment")}
        empty={{ title: "Add your work history", body: "Employers read this first. Add your current role to start; you can add more later.", action: "Add a role" }}>
        <ol className="relative ml-4 border-l-2 border-border">
          {groups.map(g => (
            <li key={g.employer.toLowerCase()} className="relative pb-6 pl-8 last:pb-0">
              <span aria-hidden className="absolute -left-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background">
                <Building2 className="h-4 w-4 text-muted-foreground" />
              </span>
              <p className="font-semibold text-foreground">{g.employer}</p>
              {g.total !== null && <p className="text-sm text-muted-foreground">{duration(g.total)}</p>}
              <ul className="mt-3 space-y-3">
                {g.roles.map(r => (
                  <li key={r.id}>
                    <p className="font-medium text-foreground">{r.title}</p>
                    {dateRange(r) && <p className="text-sm text-muted-foreground">{dateRange(r)}</p>}
                    {r.description && <p className="mt-1 max-w-prose whitespace-pre-line text-sm text-foreground/80">{r.description}</p>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Skills" icon={Wrench} canEdit={canEdit} filled={(p?.skills.length ?? 0) > 0} onEdit={() => onEdit("skills")}
        empty={{ title: "Add your skills", body: "List the tools and strengths you use at work. You don't need a résumé for this.", action: "Add skills" }}>
        <ul className="flex flex-wrap gap-2">
          {p?.skills.map(s => <li key={s}><Badge variant="outline" className="rounded-full border-border bg-muted/60 px-3 py-1 text-sm font-normal text-foreground">{s}</Badge></li>)}
        </ul>
      </Section>

      <Section title="Education" icon={GraduationCap} canEdit={canEdit} filled={(p?.education.length ?? 0) > 0} onEdit={() => onEdit("education")}
        empty={{ title: "Add education", body: "Degrees, diplomas or certificates.", action: "Add education" }} optional>
        <ul className="space-y-3">
          {p?.education.map(e => (
            <li key={e.id}>
              <p className="font-medium text-foreground">{e.institution}</p>
              <p className="text-sm text-muted-foreground">{[e.qualification, dateRange(e as unknown as Dated)].filter(Boolean).join(" · ")}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Projects" icon={FolderGit2} canEdit={canEdit} filled={(p?.projects.length ?? 0) > 0} onEdit={() => onEdit("projects")}
        empty={{ title: "Add a project", body: "Something you built or led that shows what you can do.", action: "Add a project" }} optional>
        <ul className="space-y-3">
          {p?.projects.map(x => (
            <li key={x.id}>
              <p className="font-medium text-foreground">{x.name}</p>
              {x.description && <p className="mt-1 max-w-prose text-sm text-foreground/80">{x.description}</p>}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0 cursor-pointer gap-1.5 text-muted-foreground hover:text-foreground" onClick={onClick} aria-label={label}>
      <Pencil className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Edit</span>
    </Button>
  );
}

function Section({ title, icon: Icon, filled, canEdit, onEdit, empty, optional, children }: {
  title: string; icon: LucideIcon; filled: boolean; canEdit: boolean; onEdit: () => void; optional?: boolean | undefined;
  empty: { title: string; body: string; action: string }; children: ReactNode;
}) {
  return (
    <section aria-label={title} className="py-6 last:pb-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-base font-semibold text-foreground"><Icon className="h-4 w-4 text-muted-foreground" aria-hidden />{title}</h4>
        {filled && canEdit && <EditButton label={`Edit ${title.toLowerCase()}`} onClick={onEdit} />}
      </div>
      {filled ? children : (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{empty.title}{optional && <span className="ml-2 text-xs font-normal text-muted-foreground">Optional</span>}</p>
            <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{empty.body}</p>
          </div>
          {canEdit && (
            <Button type="button" variant={optional ? "outline" : "default"} className="min-h-11 shrink-0 cursor-pointer gap-1.5" onClick={onEdit}>
              <Plus className="h-4 w-4" aria-hidden />{empty.action}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
