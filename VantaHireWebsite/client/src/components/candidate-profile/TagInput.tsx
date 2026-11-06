// Tag/chip input. Behaviour adapted from 21st.dev "Tag Input" (ddoemonn): chips inside the
// field, Enter or comma adds, pasting a comma/newline list adds each item, Backspace on an
// empty field first highlights the last chip then removes it, arrow keys move between chips,
// duplicate flash, n/max counter and polite screen-reader announcements.
// Changes: app theme tokens, 32px chips with 28px remove targets (the original's 14px is too
// small to tap), a per-item length limit, the server's case-insensitive uniqueness rule,
// `framer-motion` (installed) in place of `motion/react`, and a controlled value/onChange API.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const CHIP = { type: "spring", stiffness: 700, damping: 46, mass: 0.5 } as const;
const EXIT = { duration: 0.18, ease: [0.4, 0, 1, 1] as const } as const;
const INSTANT = { duration: 0 } as const;
const clean = (raw: string) => raw.normalize("NFC").trim().replace(/\s+/gu, " ");
const SPLIT = /[,\n\r\t]+/;

type Props = {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  maxLength?: number | undefined;
  placeholder?: string | undefined;
  hint?: string | undefined;
  error?: string | null | undefined;
  disabled?: boolean | undefined;
};

export function TagInput({ label, values, onChange, max, maxLength = 100, placeholder = "Type and press Enter", hint, error, disabled }: Props) {
  const uid = useId();
  const inputId = `${uid}-input`, hintId = `${uid}-hint`, msgId = `${uid}-msg`;
  const inputRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  const [draft, setDraft] = useState("");
  const [armed, setArmed] = useState(-1);
  const [notice, setNotice] = useState<string | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  const armedIndex = armed >= values.length ? -1 : armed;
  const full = values.length >= max;

  function add(raws: string[]) {
    const next = [...values];
    let added = 0;
    let refusal: string | null = null;
    for (const raw of raws) {
      const v = clean(raw);
      if (!v) continue;
      if (next.length >= max) { refusal = `You can add up to ${max}.`; break; }
      if (Array.from(v).length > maxLength) { refusal = `Keep each entry under ${maxLength} characters.`; continue; }
      const twin = next.find(t => clean(t).toLowerCase() === v.toLowerCase());
      if (twin) {
        refusal = `"${twin}" is already added.`;
        if (flashTimer.current) clearTimeout(flashTimer.current);
        setFlashed(twin); flashTimer.current = setTimeout(() => setFlashed(null), 460);
        continue;
      }
      next.push(v); added += 1;
    }
    if (added) { onChange(next); setDraft(""); setArmed(-1); setAnnouncement(`${added === 1 ? next[next.length - 1] : `${added} entries`} added, ${next.length} total.`); }
    setNotice(refusal);
    if (refusal) setAnnouncement(refusal);
  }
  function removeAt(i: number) {
    if (i < 0 || i >= values.length) return;
    const gone = values[i]!;
    onChange(values.filter((_, n) => n !== i));
    setArmed(-1); setNotice(null);
    setAnnouncement(`${gone} removed, ${values.length - 1} left.`);
  }
  function arm(i: number) { setArmed(i); setAnnouncement(`${values[i]} selected. Press Backspace again to remove it.`); }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add([draft]); return; }
    if (e.key === "Backspace" && draft === "") {
      e.preventDefault(); if (e.repeat) return;
      if (armedIndex >= 0) removeAt(armedIndex); else if (values.length) arm(values.length - 1);
      return;
    }
    if (e.key === "Delete" && armedIndex >= 0) { e.preventDefault(); removeAt(armedIndex); return; }
    if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0 && values.length) {
      e.preventDefault(); arm(armedIndex < 0 ? values.length - 1 : Math.max(0, armedIndex - 1)); return;
    }
    if (e.key === "ArrowRight" && armedIndex >= 0) { e.preventDefault(); if (armedIndex >= values.length - 1) setArmed(-1); else arm(armedIndex + 1); return; }
    if (e.key === "Escape" && armedIndex >= 0) { e.preventDefault(); setArmed(-1); }
  }

  const rows = useMemo(() => values.map((tag, i) => ({ tag, key: `${tag}#${values.slice(0, i).filter(t => t === tag).length}` })), [values]);
  const message = error ?? notice;
  const describedBy = [hint && hintId, message && msgId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium leading-none text-foreground">{label}</label>
      <ul aria-label={`${label} added`}
        onPointerDown={e => { if (e.target !== e.currentTarget) return; e.preventDefault(); inputRef.current?.focus(); }}
        className={cn(
          "flex min-h-11 max-h-40 list-none flex-wrap items-center gap-1.5 overflow-y-auto overscroll-contain rounded-md border border-input bg-background p-1.5",
          "transition-[border-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background",
          error && "border-destructive", disabled && "cursor-not-allowed opacity-50",
        )}>
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map(({ tag, key }, i) => {
            const lit = armedIndex === i || flashed === tag;
            return (
              <motion.li key={key} layout="position"
                initial={reduced ? false : { opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                exit={reduced ? { opacity: 0, transition: INSTANT } : { opacity: 0, scale: 0.9, transition: EXIT }}
                transition={reduced ? INSTANT : { default: CHIP, layout: CHIP }}
                className={cn("flex h-8 max-w-full shrink-0 select-none items-center gap-0.5 rounded-full border pl-3 pr-0.5 text-sm transition-colors duration-150",
                  lit ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-foreground")}>
                <span className="truncate">{tag}</span>
                <button type="button" disabled={disabled} aria-label={`Remove ${tag}`}
                  onMouseDown={e => e.preventDefault()} onClick={() => { removeAt(i); inputRef.current?.focus(); }}
                  className={cn("grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                    lit ? "text-primary-foreground/80 hover:text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground")}>
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
        <li className="flex min-w-32 flex-1">
          <input ref={inputRef} id={inputId} type="text" value={draft} disabled={disabled || full}
            placeholder={full ? `Limit of ${max} reached` : placeholder}
            aria-invalid={!!error} aria-describedby={describedBy}
            autoComplete="off" spellCheck={false} enterKeyHint="done"
            onChange={e => { setDraft(e.target.value); setArmed(-1); setNotice(null); }}
            onKeyDown={onKeyDown}
            onPaste={e => { const text = e.clipboardData.getData("text"); if (!SPLIT.test(text)) return; e.preventDefault(); add(text.split(SPLIT)); }}
            onBlur={() => { setArmed(-1); if (draft.trim()) add([draft]); }}
            className="h-8 w-full bg-transparent px-1.5 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm" />
        </li>
      </ul>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 flex-1">
          {message
            ? <p id={msgId} role={error ? "alert" : undefined} className={error ? "text-sm text-destructive" : "text-xs text-foreground"}>{message}</p>
            : hint && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <p className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden>{values.length} / {max}</p>
      </div>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</span>
    </div>
  );
}
