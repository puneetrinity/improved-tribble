// Single-file drag-and-drop upload. Adapted from 21st.dev "File Dropzone" (joyco):
// dashed drop area, icon, accepted types and size limit, selected-file view with a remove
// button, and inline errors. Changes: controlled value/onChange, single file only (every use
// here uploads one file), a dark tone for the public marketing theme, a best-effort
// client check of extension, size and emptiness (the server still validates type and
// content), an external error for failed uploads, 44px targets, and no image previews.
import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { AlertCircle, FileText, Loader2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: File | null;
  onChange: (file: File | null) => void;
  /** Comma-separated extensions, e.g. ".pdf,.doc,.docx". */
  accept: string;
  maxSizeMB: number;
  label: string;
  required?: boolean | undefined;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
  tone?: "light" | "dark" | undefined;
  id?: string | undefined;
  /** The page already renders a <label htmlFor={id}>; don't draw a second one. */
  externalLabel?: boolean | undefined;
  /** An error from outside, e.g. a failed upload. Shown until a new file is chosen. */
  error?: string | null | undefined;
};

export function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Returns an error message, or null when the file is acceptable. */
export function checkFile(file: File, accept: string, maxSizeMB: number): string | null {
  const allowed = accept.split(",").map(a => a.trim().toLowerCase()).filter(a => a.startsWith("."));
  const name = file.name.toLowerCase();
  if (allowed.length && !allowed.some(ext => name.endsWith(ext))) {
    return `Use a ${allowed.map(e => e.slice(1).toUpperCase()).join(", ")} file.`;
  }
  if (file.size > maxSizeMB * 1024 * 1024) return `That file is ${formatFileSize(file.size)}. The limit is ${maxSizeMB} MB.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

export function FileDropzone({ value, onChange, accept, maxSizeMB, label, required, hint, disabled, busy, tone = "light", id, externalLabel, error: externalError }: Props) {
  const auto = useId();
  const inputId = id ?? `${auto}-input`, hintId = `${auto}-hint`, errorId = `${auto}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? externalError ?? null;
  const dark = tone === "dark";
  const locked = disabled || busy;
  const types = accept.split(",").map(a => a.trim()).filter(a => a.startsWith(".")).map(a => a.slice(1).toUpperCase()).join(", ");

  function take(file: File | undefined) {
    if (!file) return;
    const problem = checkFile(file, accept, maxSizeMB);
    setLocalError(problem);
    if (!problem) onChange(file);
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false);
    if (!locked) take(e.dataTransfer.files?.[0]);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.key === "Enter" || e.key === " ") && !locked) { e.preventDefault(); inputRef.current?.click(); }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {!externalLabel && <label htmlFor={inputId} className={cn("text-sm font-medium", dark ? "text-[0.78rem] text-e-text2" : "text-foreground")}>
        {label}{required ? " *" : ""}
      </label>}
      <input ref={inputRef} id={inputId} type="file" accept={accept} className="sr-only" disabled={locked}
        aria-describedby={[hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined}
        aria-invalid={!!error}
        onChange={e => { take(e.target.files?.[0]); e.target.value = ""; }} />

      {value ? (
        <div className={cn("flex items-center gap-3 rounded-xl border p-3",
          dark ? "border-white/10 bg-white/[0.04]" : "border-border bg-muted/40")}>
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
            dark ? "border-white/10 bg-white/[0.06] text-e-text2" : "border-border bg-background text-muted-foreground")}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <FileText className="h-5 w-5" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-sm font-medium", dark ? "text-e-text" : "text-foreground")}>{value.name}</p>
            <p className={cn("text-xs", dark ? "text-e-text2" : "text-muted-foreground")}>{busy ? "Uploading…" : formatFileSize(value.size)}</p>
          </div>
          <button type="button" disabled={locked} onClick={() => { onChange(null); setLocalError(null); }} aria-label={`Remove ${value.name}`}
            className={cn("flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
              dark ? "text-e-text2 hover:bg-white/[0.06] hover:text-e-text focus-visible:ring-e-blue" : "text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-ring")}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <div role="button" tabIndex={locked ? -1 : 0} aria-disabled={locked || undefined}
          aria-label={`${label}: drop a file or press Enter to choose one`}
          onClick={() => !locked && inputRef.current?.click()} onKeyDown={onKeyDown}
          onDragEnter={e => { e.preventDefault(); if (!locked) setDragging(true); }}
          onDragOver={e => e.preventDefault()}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
          onDrop={onDrop}
          data-dragging={dragging || undefined}
          className={cn(
            "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2",
            dark
              ? "border-white/15 bg-white/[0.02] hover:border-e-blue/60 hover:bg-white/[0.04] focus-visible:ring-e-blue data-[dragging=true]:border-e-blue data-[dragging=true]:bg-e-blue/10"
              : "border-input bg-background hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-ring data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/5",
            error && (dark ? "border-red-400/60" : "border-destructive"),
            locked && "cursor-not-allowed opacity-60",
          )}>
          <span aria-hidden className={cn("flex h-11 w-11 items-center justify-center rounded-full border",
            dark ? "border-white/10 bg-white/[0.06] text-e-text2" : "border-border bg-muted text-muted-foreground")}>
            <Upload className="h-5 w-5" />
          </span>
          <p className={cn("text-sm font-medium", dark ? "text-e-text" : "text-foreground")}>
            {dragging ? "Drop to upload" : <>Drag your file here, or <span className={dark ? "text-e-blue" : "text-primary"}>browse</span></>}
          </p>
          <p className={cn("text-xs", dark ? "text-e-text2" : "text-muted-foreground")}>{types} · up to {maxSizeMB} MB</p>
        </div>
      )}

      {hint && !error && <p id={hintId} className={cn("text-xs", dark ? "text-e-text2" : "text-muted-foreground")}>{hint}</p>}
      {error && (
        <p id={errorId} role="alert" className={cn("flex items-center gap-1.5 text-xs", dark ? "text-red-300" : "text-destructive")}>
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />{error}
        </p>
      )}
    </div>
  );
}
