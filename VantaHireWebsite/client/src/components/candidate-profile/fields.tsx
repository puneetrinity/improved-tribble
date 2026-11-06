import { useId, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CountryCombobox } from "./CountryCombobox";

export type Errors = Record<string, string>;

export { COUNTRIES, countryName } from "./countries";

export function Field({ label, error, hint, children, id }: { label: string; error?: string | undefined; hint?: string | undefined; children: (props: { id: string; labelId: string; describedBy?: string | undefined; invalid: boolean }) => ReactNode; id?: string | undefined }) {
  const auto = useId(), fid = id ?? auto;
  const labelId = `${fid}-label`;
  const describedBy = [hint && `${fid}-hint`, error && `${fid}-err`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="space-y-2">
      <Label id={labelId} htmlFor={fid}>{label}</Label>
      {children({ id: fid, labelId, describedBy, invalid: !!error })}
      {hint && <p id={`${fid}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${fid}-err`} role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function TextField({ label, value, onChange, onBlur, error, hint, max, multiline, disabled, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; onBlur?: (() => void) | undefined; error?: string | undefined; hint?: string | undefined; max: number; multiline?: boolean | undefined; disabled?: boolean | undefined; placeholder?: string | undefined;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {({ id, describedBy, invalid }) => multiline
        ? <Textarea id={id} value={value} maxLength={max} rows={4} disabled={disabled} placeholder={placeholder} aria-invalid={invalid} aria-describedby={describedBy} onChange={e => onChange(e.target.value)} onBlur={onBlur} />
        : <Input id={id} value={value} maxLength={max} disabled={disabled} placeholder={placeholder} aria-invalid={invalid} aria-describedby={describedBy} onChange={e => onChange(e.target.value)} onBlur={onBlur} className="min-h-11" />}
    </Field>
  );
}

export const selectClass = "flex min-h-11 w-full cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-base text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

export function CountrySelect({ label, value, onChange, onBlur, error, disabled, exclude }: { label: string; value: string; onChange: (v: string) => void; onBlur?: (() => void) | undefined; error?: string | undefined; disabled?: boolean | undefined; allowEmpty?: boolean | undefined; exclude?: string[] | undefined }) {
  return (
    <Field label={label} error={error}>
      {({ id, labelId, describedBy, invalid }) => (
        <CountryCombobox id={id} labelId={labelId} value={value} disabled={disabled} invalid={invalid} describedBy={describedBy}
          exclude={exclude} onChange={onChange} onClose={onBlur} />
      )}
    </Field>
  );
}

// Partial dates: "2024", "2024-03" or "2024-03-15".
export type DateValue = { value: string; precision: "year" | "month" | "day" } | null;
export function parseDate(text: string): DateValue | "invalid" {
  const v = text.trim();
  if (!v) return null;
  if (/^[0-9]{4}$/.test(v)) return { value: v, precision: "year" };
  if (/^[0-9]{4}-[0-9]{2}$/.test(v)) return { value: v, precision: "month" };
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) return { value: v, precision: "day" };
  return "invalid";
}

export type RowField = { key: string; label: string; max: number; multiline?: boolean | undefined; required?: boolean | undefined };
export type Row = Record<string, any> & { id: string; start: DateValue; end: DateValue; current: boolean };

/** Repeatable cards for employment, education and projects. Each card keeps its id, so
 * edits never merge rows. */
export function RowListEditor({ title, addLabel, rows, fields, max, onChange, errors, prefix, disabled, makeRow, hideTitle }: {
  hideTitle?: boolean | undefined; title: string; addLabel: string; rows: Row[]; fields: RowField[]; max: number; onChange: (rows: Row[]) => void;
  errors: Errors; prefix: string; disabled?: boolean | undefined; makeRow: () => Row;
}) {
  const update = (i: number, patch: Partial<Row>) => onChange(rows.map((r, n) => n === i ? { ...r, ...patch } : r));
  return (
    <fieldset className="space-y-4">
      <legend className={hideTitle ? "sr-only" : "text-base font-semibold text-foreground"}>{title}</legend>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing added yet.</p>}
      {rows.map((row, i) => (
        <div key={row.id} className="space-y-4 rounded-lg border border-border p-4">
          <div className="grid gap-4 md:grid-cols-2">
            {fields.filter(f => !f.multiline).map(f => (
              <TextField key={f.key} label={f.label + (f.required ? "" : " (optional)")} value={row[f.key] ?? ""} max={f.max} disabled={disabled}
                error={errors[`${prefix}.${i}.${f.key}`]} onChange={v => update(i, { [f.key]: v })} />
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3 md:items-start">
            <DateText label="Start" value={row.start} disabled={disabled} onChange={d => update(i, { start: d })} />
            <DateText label="End" value={row.end} disabled={disabled || row.current} onChange={d => update(i, { end: d })} error={errors[`${prefix}.${i}`]} />
            <CurrentBox checked={row.current} disabled={disabled} onChange={c => update(i, { current: c, end: c ? null : row.end })} />
          </div>
          {fields.filter(f => f.multiline).map(f => (
            <TextField key={f.key} label={f.label + " (optional)"} multiline value={row[f.key] ?? ""} max={f.max} disabled={disabled}
              error={errors[`${prefix}.${i}.${f.key}`]} onChange={v => update(i, { [f.key]: v })} />
          ))}
          <Button type="button" variant="ghost" disabled={disabled} className="min-h-11 cursor-pointer text-destructive hover:text-destructive" onClick={() => onChange(rows.filter((_, n) => n !== i))}>
            <Trash2 className="mr-2 h-4 w-4" aria-hidden />Remove
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" disabled={disabled || rows.length >= max} className="min-h-11 cursor-pointer" onClick={() => onChange([...rows, makeRow()])}>
        <Plus className="mr-2 h-4 w-4" aria-hidden />{addLabel}
      </Button>
    </fieldset>
  );
}

function DateText({ label, value, onChange, disabled, error }: { label: string; value: DateValue; onChange: (d: DateValue) => void; disabled?: boolean | undefined; error?: string | undefined }) {
  const text = value?.value ?? "";
  return (
    <Field label={`${label} (optional)`} hint="Year, or year and month, e.g. 2024-03" error={error}>
      {({ id, describedBy, invalid }) => (
        <DateInput id={id} describedBy={describedBy} invalid={invalid} initial={text} disabled={disabled} onCommit={onChange} />
      )}
    </Field>
  );
}

function DateInput({ id, describedBy, invalid, initial, disabled, onCommit }: { id: string; describedBy?: string | undefined; invalid: boolean; initial: string; disabled?: boolean | undefined; onCommit: (d: DateValue) => void }) {
  const [text, setText] = useState(initial);
  const [bad, setBad] = useState(false);
  return (
    <>
      <Input id={id} value={disabled ? "" : text} disabled={disabled} inputMode="numeric" placeholder="YYYY-MM" aria-invalid={invalid || bad} aria-describedby={describedBy} className="min-h-11"
        onChange={e => { setText(e.target.value); setBad(false); }}
        onBlur={() => { const d = parseDate(text); if (d === "invalid") setBad(true); else onCommit(d); }} />
      {bad && <p role="alert" className="text-sm text-destructive">Use YYYY, YYYY-MM or YYYY-MM-DD.</p>}
    </>
  );
}

function CurrentBox({ checked, onChange, disabled }: { checked: boolean; onChange: (c: boolean) => void; disabled?: boolean | undefined }) {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center gap-3 md:mt-8">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={c => onChange(c === true)} className="h-5 w-5" />
      <Label htmlFor={id} className="cursor-pointer">Current</Label>
    </div>
  );
}
