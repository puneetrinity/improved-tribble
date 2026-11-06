import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { manualProfileSchema } from "@shared/candidate-profile";
import type { ManualProfile } from "@/lib/candidate-profile-api";
import { CountrySelect, RowListEditor, TextField, countryName, type Row } from "./fields";
import { TagInput } from "./TagInput";
import { toErrors } from "./validation";

export const EMPTY_PROFILE: ManualProfile = {
  displayName: "", headline: "", linkedinUrl: null, currentLocation: null,
  skills: [], employment: [], education: [], projects: [],
};
const blankRow = () => ({ id: crypto.randomUUID(), start: null, end: null, current: false });

type Props = { initial: ManualProfile | null; disabled?: boolean | undefined; busy?: boolean | undefined; onSave: (profile: ManualProfile) => void;
  /** Reports whether the visible details differ from the saved ones. */
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  /** Show only one part of the profile (the rest is kept and saved unchanged). */
  section?: ProfileSection | undefined;
  /** Optional cancel action, shown next to Save in a section editor. */
  onCancel?: (() => void) | undefined };

export type ProfileSection = "basics" | "skills" | "employment" | "education" | "projects";
const SECTION_FIELDS: Record<ProfileSection, string[]> = {
  basics: ["displayName", "headline", "currentLocation", "linkedinUrl"],
  skills: ["skills"], employment: ["employment"], education: ["education"], projects: ["projects"],
};
const SECTION_LABEL: Record<ProfileSection, string> = {
  basics: "Name, headline and location", skills: "Skills", employment: "Work experience", education: "Education", projects: "Projects",
};

export function ProfessionalDetailsForm({ initial, disabled, busy, onSave, onDirtyChange, section, onCancel }: Props) {
  const [p, setP] = useState<ManualProfile>(() => {
    const base = initial ?? EMPTY_PROFILE;
    // Opening an empty list's editor starts with one blank entry to fill in.
    if (section === "employment" && base.employment.length === 0) return { ...base, employment: [{ ...blankRow(), employer: "", title: "", description: "" }] as ManualProfile["employment"] };
    if (section === "education" && base.education.length === 0) return { ...base, education: [{ ...blankRow(), institution: "", qualification: "", description: "" }] as ManualProfile["education"] };
    if (section === "projects" && base.projects.length === 0) return { ...base, projects: [{ ...blankRow(), name: "", description: "" }] as ManualProfile["projects"] };
    return base;
  });
  const [city, setCity] = useState(initial?.currentLocation?.city ?? "");
  const [country, setCountry] = useState(initial?.currentLocation?.countryCode ?? "");
  const [linkedin, setLinkedin] = useState(initial?.linkedinUrl ?? "");
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [tried, setTried] = useState(false);

  const candidate: ManualProfile = useMemo(() => ({
    ...p,
    linkedinUrl: linkedin.trim() ? linkedin.trim() : null,
    // City and country are saved together or not at all.
    currentLocation: city.trim() || country ? { city, countryCode: country, displayCountry: country ? countryName(country) : "" } : null,
  }), [p, city, country, linkedin]);
  // What the form showed when it mounted; the form remounts after each applied save.
  const [baseline] = useState(() => JSON.stringify(candidate));
  const dirty = JSON.stringify(candidate) !== baseline;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const parsed = manualProfileSchema.safeParse(candidate);
  const all = parsed.success ? {} : toErrors(parsed.error);
  const show = (k: string) => (tried || touched.has(k) ? all[k] : undefined);
  const touch = (k: string) => setTouched(prev => new Set(prev).add(k));
  const locked = disabled || busy;
  const shows = (part: ProfileSection) => !section || section === part;
  // Errors in parts this editor doesn't show still block saving; name those parts.
  const elsewhere = section ? (Object.keys(SECTION_FIELDS) as ProfileSection[]).filter(part => part !== section
    && Object.keys(all).some(k => SECTION_FIELDS[part].some(f => k === f || k.startsWith(`${f}.`)))) : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (parsed.success) onSave(candidate);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-8" aria-label="Professional details">
      {shows("basics") && <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Name" value={p.displayName} max={200} disabled={locked} error={show("displayName")}
          onChange={v => setP({ ...p, displayName: v })} onBlur={() => touch("displayName")} />
        <TextField label="Headline" value={p.headline} max={300} disabled={locked} error={show("headline")}
          hint="For example: Backend engineer, payments" onChange={v => setP({ ...p, headline: v })} onBlur={() => touch("headline")} />
        <TextField label="Current city" value={city} max={200} disabled={locked}
          error={show("currentLocation.city") ?? show("currentLocation")} onChange={setCity} onBlur={() => touch("currentLocation.city")} />
        <CountrySelect label="Current country" value={country} disabled={locked}
          error={show("currentLocation.countryCode")} onChange={setCountry} onBlur={() => touch("currentLocation.countryCode")} />
        <div className="md:col-span-2">
          <TextField label="LinkedIn profile (optional)" value={linkedin} max={300} disabled={locked} placeholder="https://linkedin.com/in/your-name"
            error={show("linkedinUrl")} onChange={setLinkedin} onBlur={() => touch("linkedinUrl")} />
        </div>
      </div>}

      {shows("skills") && <TagInput label="Skills" values={p.skills} max={200} disabled={locked} placeholder="Type a skill and press Enter"
        hint="Add at least one. You can list skills without a résumé or LinkedIn." error={show("skills")}
        onChange={skills => { setP({ ...p, skills }); touch("skills"); }} />}

      {shows("employment") && <RowListEditor hideTitle={!!section} title="Work experience" addLabel="Add a role" rows={p.employment as Row[]} max={200} prefix="employment" disabled={locked}
        errors={tried ? all : {}} makeRow={() => ({ ...blankRow(), employer: "", title: "", description: "" })}
        fields={[{ key: "title", label: "Job title", max: 200, required: true }, { key: "employer", label: "Employer", max: 200, required: true }, { key: "description", label: "What you did", max: 10000, multiline: true }]}
        onChange={rows => setP({ ...p, employment: rows as ManualProfile["employment"] })} />}

      {shows("education") && <RowListEditor hideTitle={!!section} title="Education" addLabel="Add education" rows={p.education as Row[]} max={50} prefix="education" disabled={locked}
        errors={tried ? all : {}} makeRow={() => ({ ...blankRow(), institution: "", qualification: "", description: "" })}
        fields={[{ key: "institution", label: "Institution", max: 200, required: true }, { key: "qualification", label: "Qualification", max: 300 }, { key: "description", label: "Details", max: 5000, multiline: true }]}
        onChange={rows => setP({ ...p, education: rows as ManualProfile["education"] })} />}

      {shows("projects") && <RowListEditor hideTitle={!!section} title="Projects" addLabel="Add a project" rows={p.projects as Row[]} max={50} prefix="projects" disabled={locked}
        errors={tried ? all : {}} makeRow={() => ({ ...blankRow(), name: "", description: "" })}
        fields={[{ key: "name", label: "Project name", max: 200, required: true }, { key: "description", label: "Description", max: 10000, multiline: true }]}
        onChange={rows => setP({ ...p, projects: rows as ManualProfile["projects"] })} />}

      {tried && !parsed.success && <p role="alert" className="text-sm text-destructive">
        {elsewhere.length ? `Also complete: ${elsewhere.map(x => SECTION_LABEL[x]).join(", ")}.` : "Fix the highlighted details before saving."}
      </p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={locked} className="min-h-11 cursor-pointer">{busy ? "Saving…" : section ? "Save" : "Save details"}</Button>
        {onCancel && <Button type="button" variant="ghost" className="min-h-11 cursor-pointer" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}
