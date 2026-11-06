import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CURRENCIES, preferencesSchema } from "@shared/candidate-profile";
import { preferenceSectionSchema } from "@shared/candidate-spark-v3";
import { ZodError, type ZodIssue } from "zod";
import { sectionValue, type Preferences, type SparkSection } from "@/lib/candidate-profile-api";
import { CountrySelect, Field, selectClass, countryName } from "./fields";
import { TagInput } from "./TagInput";
import { toErrors } from "./validation";

type Place = { city: string; countryCode: string };

export const DEFAULT_PREFERENCES: Preferences = {
  desiredRoles: [], preferredSeniority: [], workArrangements: [],
  locations: { mode: "anywhere" }, remoteRegions: null,
  relocation: { mode: "discuss", destinations: [] },
  employmentTypes: [], availability: { mode: "unknown" },
  compensation: { mode: "open_to_discussion" },
  strengths: { roles: "flexible", location: "flexible", workArrangement: "flexible", employmentType: "flexible", compensation: "flexible" },
};

const ARRANGEMENTS = [["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "On-site"]] as const;
const TYPES = [["permanent", "Permanent"], ["contract", "Contract"], ["gig_freelance", "Gig / freelance"], ["part_time", "Part-time"], ["internship", "Internship"]] as const;
/** The older (v2) preferences format has no gig / freelance type. */
const V2_TYPES = TYPES.filter(([k]) => k !== "gig_freelance");
type EditSection = "roles" | "arrangement" | "employment_types" | "location" | "relocation" | "availability" | "compensation";
const SECTION_OF: Record<string, EditSection> = { desiredRoles: "roles", preferredSeniority: "roles", workArrangements: "arrangement", remoteRegions: "arrangement",
  employmentTypes: "employment_types", locations: "location", relocation: "relocation", availability: "availability", compensation: "compensation" };
/** Where a section's errors show in the form (the v3 section value paths, prefixed). */
const ERROR_PREFIX: Record<EditSection, string> = { roles: "", arrangement: "", employment_types: "employmentTypes", location: "locations", relocation: "relocation", availability: "availability", compensation: "compensation" };
const ERROR_FALLBACK: Record<EditSection, string> = { roles: "desiredRoles", arrangement: "workArrangements", employment_types: "employmentTypes", location: "locations.places", relocation: "relocation.destinations", availability: "availability", compensation: "compensation.targetMin" };

type Props = { initial: Preferences | null; disabled?: boolean | undefined; busy?: boolean | undefined; onSave: (preferences: Preferences) => void;
  /** Reports whether the visible preferences differ from the saved ones. */
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  /** spark profile: preferences are saved by section. Questions in `unanswered` start with nothing
   * chosen (never an assumed default), and only questions the candidate touches are saved. */
  spark?: { unanswered: SparkSection[]; onSaveSections: (preferences: Preferences, sections: SparkSection[]) => void } | undefined };

export function PreferencesForm({ initial, disabled, busy, onSave, onDirtyChange, spark }: Props) {
  const [v, setV] = useState<Preferences>(initial ?? DEFAULT_PREFERENCES);
  const [baseline] = useState(() => JSON.stringify(initial ?? DEFAULT_PREFERENCES));
  const dirty = JSON.stringify(v) !== baseline;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const [tried, setTried] = useState(false);
  // Compensation inputs are kept as typed text until saved.
  const comp = v.compensation.mode === "target" ? v.compensation : null;
  const [touched, setTouched] = useState<Set<EditSection>>(() => new Set());
  const blank = (s: EditSection) => !!spark?.unanswered.includes(s) && !touched.has(s);
  const sparkCheck = spark ? checkSections(v, [...touched]) : null;
  const parsed = spark ? { success: sparkCheck!.ok } : preferencesSchema.safeParse(v);
  const errors = !tried ? {} : spark ? sparkCheck!.errors : !parsed.success ? toErrors((parsed as any).error) : {};
  const locked = disabled || busy;
  const set = (patch: Partial<Preferences>) => {
    setTouched(prev => { const next = new Set(prev); for (const k of Object.keys(patch)) if (SECTION_OF[k]) next.add(SECTION_OF[k]!); return next; });
    setV(prev => ({ ...prev, ...patch }));
  };
  const toggle = <T extends string>(list: T[], item: T, on: boolean) => on ? [...list, item] : list.filter(x => x !== item);

  function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!parsed.success) return;
    if (spark) spark.onSaveSections(v, [...touched]); else onSave(v);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-8" aria-label="Job preferences">
      <Section title="Roles" disabled={locked}>
        <TagInput label="Roles you want" values={v.desiredRoles} max={10} maxLength={200} disabled={locked}
          placeholder="e.g. Backend engineer" hint="Add at least one, up to 10." error={errors.desiredRoles}
          onChange={desiredRoles => set({ desiredRoles })} />
        <TagInput label="Seniority (optional)" values={v.preferredSeniority} max={8} disabled={locked}
          placeholder="e.g. Senior" error={errors.preferredSeniority} onChange={preferredSeniority => set({ preferredSeniority })} />
      </Section>

      <Section title="How you want to work" disabled={locked}>
        <CheckGroup label="Work arrangement" options={ARRANGEMENTS} values={v.workArrangements} disabled={locked} error={errors.workArrangements}
          onToggle={(k, on) => {
            const workArrangements = toggle(v.workArrangements, k, on);
            set({ workArrangements, remoteRegions: workArrangements.includes("remote") ? (v.remoteRegions ?? { mode: "worldwide" }) : null });
          }} />
        {v.workArrangements.includes("remote") && v.remoteRegions && (
          <ModeRadio label="Where can you work remotely from?" value={v.remoteRegions.mode} disabled={locked}
            options={[["worldwide", "Anywhere"], ["countries", "Specific countries"]]}
            onChange={mode => set({ remoteRegions: mode === "worldwide" ? { mode: "worldwide" } : { mode: "countries", countries: [] } })}>
            {v.remoteRegions.mode === "countries" && (
              <CountryList values={v.remoteRegions.countries} disabled={locked} error={errors["remoteRegions.countries"] ?? errors.remoteRegions}
                onChange={countries => set({ remoteRegions: { mode: "countries", countries } })} />
            )}
          </ModeRadio>
        )}
        <CheckGroup label="Employment type" options={spark ? TYPES : V2_TYPES} values={v.employmentTypes} disabled={locked} error={errors.employmentTypes}
          onToggle={(k, on) => set({ employmentTypes: toggle(v.employmentTypes, k, on) })} />
      </Section>

      <Section title="Location" disabled={locked}>
        <ModeRadio label="Where do you want to work?" value={blank("location") ? "" : v.locations.mode} disabled={locked}
          options={[["anywhere", "Anywhere"], ["specific", "Specific cities"]]}
          onChange={mode => set({ locations: mode === "anywhere" ? { mode: "anywhere" } : { mode: "specific", places: [] } })}>
          {!blank("location") && v.locations.mode === "specific" && (
            <PlaceList places={v.locations.places} disabled={locked} error={errors["locations.places"]}
              onChange={places => set({ locations: { mode: "specific", places } })} />
          )}
        </ModeRadio>
        <ModeRadio label="Open to relocating?" value={blank("relocation") ? "" : v.relocation.mode} disabled={locked}
          options={[["yes", "Yes"], ["discuss", "Open to discussing"], ["no", "No"]]}
          onChange={mode => set({ relocation: { mode: mode as "yes" | "no" | "discuss", destinations: mode === "no" ? [] : v.relocation.destinations } })}>
          {!blank("relocation") && v.relocation.mode !== "no" && (
            <PlaceList label="Places you'd move to (optional)" places={v.relocation.destinations} disabled={locked} min={0}
              error={errors["relocation.destinations"]} onChange={destinations => set({ relocation: { ...v.relocation, destinations } })} />
          )}
        </ModeRadio>
      </Section>

      <Section title="Availability">
        <ModeRadio label="When can you start?" value={blank("availability") ? "" : v.availability.mode} disabled={locked}
          options={[["unknown", "Not sure yet"], ["immediate", "Immediately"], ["notice_days", "After a notice period"], ["date", "From a date"]]}
          onChange={mode => set({ availability: mode === "date" ? { mode: "date", date: "" } : mode === "notice_days" ? { mode: "notice_days", days: 30 } : { mode: mode as "unknown" | "immediate" } })}>
          {v.availability.mode === "notice_days" && (
            <Field label="Notice period in days" error={errors["availability.days"]}>
              {({ id, describedBy, invalid }) => <Input id={id} type="number" min={0} max={730} className="min-h-11 max-w-40" disabled={locked} aria-invalid={invalid} aria-describedby={describedBy}
                value={v.availability.mode === "notice_days" ? v.availability.days : 0} onChange={e => set({ availability: { mode: "notice_days", days: Number(e.target.value) } })} />}
            </Field>
          )}
          {v.availability.mode === "date" && (
            <Field label="Start date" error={errors["availability.date"] ?? errors.availability}>
              {({ id, describedBy, invalid }) => <Input id={id} type="date" className="min-h-11 max-w-56" disabled={locked} aria-invalid={invalid} aria-describedby={describedBy}
                value={v.availability.mode === "date" ? v.availability.date : ""} onChange={e => set({ availability: { mode: "date", date: e.target.value } })} />}
            </Field>
          )}
        </ModeRadio>
      </Section>

      <Section title="Pay" disabled={locked}>
        <ModeRadio label="Salary expectations" value={blank("compensation") ? "" : v.compensation.mode} disabled={locked}
          options={[["open_to_discussion", "Open to discussion"], ["target", "I have a target"]]}
          onChange={mode => set({ compensation: mode === "target" ? { mode: "target", currency: "INR", period: "annual", component: "ctc", targetMin: "", targetMax: "", hardMinimum: null } : { mode: "open_to_discussion" } })}>
          {comp && !blank("compensation") && (
            <div className="grid gap-4 md:grid-cols-3">
              <NativeSelect label="Currency" value={comp.currency} disabled={locked} options={Array.from(CURRENCIES).map(c => [c, c] as const)}
                onChange={currency => set({ compensation: { ...comp, currency } })} />
              <NativeSelect label="Per" value={comp.period} disabled={locked} options={[["annual", "Year"], ["monthly", "Month"], ["hourly", "Hour"]]}
                onChange={period => set({ compensation: { ...comp, period: period as typeof comp.period } })} />
              <NativeSelect label="Covers" value={comp.component} disabled={locked} options={[["ctc", "CTC"], ["base", "Base pay"], ["total", "Total pay"]]}
                onChange={component => set({ compensation: { ...comp, component: component as typeof comp.component } })} />
              <Money label="Target from" value={comp.targetMin} disabled={locked} error={errors["compensation.targetMin"] ?? errors.compensation}
                onChange={targetMin => set({ compensation: { ...comp, targetMin } })} />
              <Money label="Target up to" value={comp.targetMax} disabled={locked} error={errors["compensation.targetMax"]}
                onChange={targetMax => set({ compensation: { ...comp, targetMax } })} />
              <Money label="Lowest you'd accept (optional)" value={comp.hardMinimum ?? ""} disabled={locked} error={errors["compensation.hardMinimum"]}
                onChange={h => set({ compensation: { ...comp, hardMinimum: h.trim() ? h : null } })} />
            </div>
          )}
        </ModeRadio>
      </Section>

      {tried && !parsed.success && <p role="alert" className="text-sm text-destructive">Fix the highlighted details before saving.</p>}
      <Button type="submit" disabled={locked} className="min-h-11 cursor-pointer">{busy ? "Saving…" : "Save preferences"}</Button>
    </form>
  );
}

/** spark: each touched question is checked on its own against the server's exported section
 * schema (v3 also allows gig / freelance). Only the branch for this section's answer is reported,
 * with paths relative to the answer. */
function sectionIssues(section: EditSection, value: unknown): ZodError | null {
  const r = preferenceSectionSchema.safeParse({ section, answered: true, value });
  if (r.success) return null;
  const own = (issues: ZodIssue[]) => !issues.some(i => i.path[0] === "section" || i.path[0] === "answered");
  const union = r.error.issues.find(i => i.code === "invalid_union") as (ZodIssue & { unionErrors?: ZodError[] }) | undefined;
  const issues = union?.unionErrors ? (union.unionErrors.find(e => own(e.issues))?.issues ?? []) : r.error.issues;
  return new ZodError(issues.map(i => ({ ...i, path: i.path[0] === "value" ? i.path.slice(1) : i.path })));
}
function checkSections(v: Preferences, sections: EditSection[]): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  for (const section of sections) {
    const issues = sectionIssues(section, sectionValue(section, v));
    if (!issues) continue;
    for (const [path, msg] of Object.entries(toErrors(issues))) {
      const key = path === "_form" ? ERROR_FALLBACK[section] : ERROR_PREFIX[section] ? `${ERROR_PREFIX[section]}.${path}` : path;
      if (!errors[key]) errors[key] = msg;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// Ordinary preferences are always flexible (they rank jobs, they don't hide them), so there is no
// "Must have" control. The stored v2 `strengths` field is passed through unchanged, never edited here.
function Section({ title, children }: { title: string; disabled?: boolean | undefined; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-4 md:p-6">
      <legend className="text-base font-semibold text-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function ModeRadio({ label, value, options, onChange, disabled, children }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void; disabled?: boolean | undefined; children?: ReactNode | undefined }) {
  const id = useId();
  return (
    <div className="space-y-3">
      <p id={id} className="text-sm font-medium text-foreground">{label}</p>
      <RadioGroup aria-labelledby={id} value={value} onValueChange={onChange} disabled={disabled} className="flex flex-wrap gap-x-6 gap-y-1">
        {options.map(([k, text]) => (
          <div key={k} className="flex min-h-11 items-center gap-2">
            <RadioGroupItem id={`${id}-${k}`} value={k} />
            <Label htmlFor={`${id}-${k}`} className="cursor-pointer font-normal">{text}</Label>
          </div>
        ))}
      </RadioGroup>
      {children}
    </div>
  );
}

function CheckGroup<T extends string>({ label, options, values, onToggle, disabled, error }: { label: string; options: readonly (readonly [T, string])[]; values: T[]; onToggle: (k: T, on: boolean) => void; disabled?: boolean | undefined; error?: string | undefined }) {
  const id = useId();
  return (
    <div className="space-y-2" role="group" aria-labelledby={id}>
      <p id={id} className="text-sm font-medium text-foreground">{label} <span className="font-normal text-muted-foreground">(choose at least one)</span></p>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {options.map(([k, text]) => (
          <div key={k} className="flex min-h-11 items-center gap-2">
            <Checkbox id={`${id}-${k}`} checked={values.includes(k)} disabled={disabled} onCheckedChange={c => onToggle(k, c === true)} className="h-5 w-5" />
            <Label htmlFor={`${id}-${k}`} className="cursor-pointer font-normal">{text}</Label>
          </div>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function NativeSelect({ label, value, options, onChange, disabled }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void; disabled?: boolean | undefined }) {
  return (
    <Field label={label}>
      {({ id }) => (
        <select id={id} className={selectClass} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
          {options.map(([k, text]) => <option key={k} value={k}>{text}</option>)}
        </select>
      )}
    </Field>
  );
}

function Money({ label, value, onChange, disabled, error }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean | undefined; error?: string | undefined }) {
  return (
    <Field label={label} error={error} hint="Numbers only, e.g. 2500000">
      {({ id, describedBy, invalid }) => (
        <Input id={id} inputMode="decimal" className="min-h-11" value={value} disabled={disabled} aria-invalid={invalid} aria-describedby={describedBy}
          onChange={e => onChange(e.target.value.replace(/[,\s]/g, ""))} />
      )}
    </Field>
  );
}

function PlaceList({ places, onChange, disabled, error, label = "Cities", min = 1 }: { places: Place[]; onChange: (p: Place[]) => void; disabled?: boolean | undefined; error?: string | undefined; label?: string | undefined; min?: number | undefined }) {
  const [city, setCity] = useState(""), [country, setCountry] = useState("");
  const canAdd = city.trim() && country && places.length < 20;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">{label}{min > 0 && <span className="font-normal text-muted-foreground"> (add at least one)</span>}</p>
      {places.length > 0 && (
        <ul className="space-y-2">
          {places.map((p, i) => (
            <li key={`${p.city}-${p.countryCode}-${i}`} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span>{p.city}, {countryName(p.countryCode)}</span>
              <Button type="button" variant="ghost" size="icon" disabled={disabled} className="h-11 w-11 cursor-pointer" aria-label={`Remove ${p.city}`} onClick={() => onChange(places.filter((_, n) => n !== i))}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Field label="City">{({ id }) => <Input id={id} className="min-h-11" value={city} maxLength={200} disabled={disabled} onChange={e => setCity(e.target.value)} />}</Field>
        <CountrySelect label="Country" value={country} disabled={disabled} onChange={setCountry} />
        <Button type="button" variant="outline" disabled={disabled || !canAdd} className="min-h-11 cursor-pointer"
          onClick={() => { onChange([...places, { city: city.trim(), countryCode: country }]); setCity(""); setCountry(""); }}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />Add
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function CountryList({ values, onChange, disabled, error }: { values: string[]; onChange: (v: string[]) => void; disabled?: boolean | undefined; error?: string | undefined }) {
  return (
    <div className="space-y-3">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Countries added">
          {values.map(c => (
            <li key={c} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-sm">
              {countryName(c)}
              <Button type="button" variant="ghost" size="icon" disabled={disabled} className="h-7 w-7 cursor-pointer rounded-full" aria-label={`Remove ${countryName(c)}`} onClick={() => onChange(values.filter(x => x !== c))}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <CountrySelect label="Add a country" value="" exclude={values} disabled={disabled}
        onChange={c => { if (c && !values.includes(c)) onChange([...values, c]); }} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
