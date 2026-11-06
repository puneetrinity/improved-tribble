// Accessible segmented control (radio group) with a sliding thumb.
// Adapted from 21st.dev "Segmented Control" (ddoemonn): same keyboard model (arrows,
// Home/End, roving tabindex) and reduced-motion handling; colours moved to the app's
// theme tokens, 44px tap height, and `framer-motion` (the installed package) in place of `motion/react`.
import { useCallback, useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

const SPRING = { type: "spring", stiffness: 520, damping: 34, mass: 0.45 } as const;
const SEG = "flex min-h-10 items-center justify-center px-3 text-center text-sm font-medium whitespace-nowrap";

export type SegmentedOption = { value: string; label: string; disabled?: boolean | undefined };
type Props = {
  options: SegmentedOption[];
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean | undefined;
  className?: string | undefined;
};

export function SegmentedControl({ options, label, value, onValueChange, disabled, className }: Props) {
  const count = Math.max(1, options.length);
  const template = `repeat(${count}, minmax(0, 1fr))`;
  const found = options.findIndex(o => o.value === value);
  const index = found < 0 ? 0 : found;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const reduced = useReducedMotion();
  const pos = useMotionValue(index);
  const thumbX = useTransform(pos, v => `${v * 100}%`);
  const maskX = useTransform(pos, v => `${v * -100}%`);

  useEffect(() => {
    if (reduced) { pos.set(index); return; }
    const controls = animate(pos, index, SPRING);
    return () => controls.stop();
  }, [index, reduced, pos]);

  const usable = (i: number) => !disabled && !options[i]?.disabled;
  const seek = useCallback((from: number, dir: number) => {
    let i = from;
    for (let k = 0; k < count; k++) { i = (i + dir + count) % count; if (!options[i]?.disabled) return i; }
    return from;
  }, [count, options]);
  const go = (i: number) => {
    const option = options[i];
    if (!option || !usable(i)) return;
    buttons.current[i]?.focus();
    if (option.value !== value) onValueChange(option.value);
  };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const moves: Record<string, () => number> = {
      ArrowRight: () => seek(i, 1), ArrowDown: () => seek(i, 1), ArrowLeft: () => seek(i, -1), ArrowUp: () => seek(i, -1),
      Home: () => seek(count - 1, 1), End: () => seek(0, -1),
    };
    const move = moves[e.key];
    if (move) { e.preventDefault(); go(move()); }
  };

  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}
      className={cn("relative inline-block select-none rounded-lg border border-border bg-muted p-[3px]", disabled && "opacity-60", className)}>
      <div className="relative grid" style={{ gridTemplateColumns: template, touchAction: "manipulation" }}>
        {options.map(o => <span key={o.value} aria-hidden className={cn(SEG, "pointer-events-none text-muted-foreground")}>{o.label}</span>)}
        <motion.div aria-hidden initial={false}
          className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden rounded-md bg-primary shadow-sm"
          style={{ width: `${100 / count}%`, x: thumbX }}>
          <motion.div className="absolute inset-0" style={{ x: maskX }} initial={false}>
            <div className="absolute inset-y-0 left-0 grid" style={{ width: `${count * 100}%`, gridTemplateColumns: template }}>
              {options.map(o => <span key={o.value} className={cn(SEG, "text-primary-foreground")}>{o.label}</span>)}
            </div>
          </motion.div>
        </motion.div>
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: template }}>
          {options.map((o, i) => (
            <button key={o.value} ref={n => { buttons.current[i] = n; }} type="button" role="radio"
              aria-checked={i === index} aria-disabled={!usable(i) || undefined} tabIndex={i === index ? 0 : -1}
              onClick={() => usable(i) && o.value !== value && onValueChange(o.value)} onKeyDown={e => onKeyDown(e, i)}
              className="min-h-10 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed aria-disabled:cursor-not-allowed">
              <span className="sr-only">{o.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
