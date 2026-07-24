// @charset "utf-8"
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";

interface TimelineEntry {
  date: string;
  name: string;
  note: string;
  tag: string;
  tagBg: string;
  tagColor: string;
}

interface ResurfacedEntry {
  score: string;
  reason: string;
  matchedRole: string;
}

const TIMELINE: TimelineEntry[] = [
  { date: "Mar 2026 · Backend Role", name: "Priya Venkatesh", note: "Strong system design. Starting new job — timing issue.", tag: "Not now", tagBg: "rgba(245,200,66,0.1)", tagColor: "#F5C842" },
  { date: "Jan 2026 · ML Role", name: "Karthik Reddy", note: "Excellent PyTorch. Overqualified for that role.", tag: "Keep warm", tagBg: "rgba(75,142,240,0.1)", tagColor: "#4B8EF0" },
  { date: "Nov 2025 · Design Role", name: "Rohan Mehta", note: "Good portfolio. Wanted remote only.", tag: "Maybe later", tagBg: "rgba(0,0,0,0.04)", tagColor: "#4B5563" },
  { date: "Sep 2025 · Frontend Role", name: "Divya Iyer", note: "Strong React skills. Salary above budget then.", tag: "Budget issue", tagBg: "rgba(239,68,68,0.1)", tagColor: "#EF4444" },
  { date: "Jul 2025 · Product Role", name: "Sneha Patel", note: "Great instincts. Too junior at that time.", tag: "Too early", tagBg: "rgba(0,0,0,0.04)", tagColor: "#4B5563" },
];

const RESURFACED: ResurfacedEntry[] = [
  { score: "94% fit", reason: "She left her previous job 3 months ago. New Backend role matches her exact stack.", matchedRole: "Senior Backend Engineer · Bangalore" },
  { score: "97% fit", reason: "New Senior ML role opened. His PyTorch depth is exactly what this role needs.", matchedRole: "Senior ML Engineer · Hyderabad" },
  { score: "91% fit", reason: "New role is fully remote. His constraint is now solved.", matchedRole: "Product Designer · Remote" },
  { score: "88% fit", reason: "Budget approved for senior hire. She's been at same company 8 months.", matchedRole: "Sr. Frontend Engineer · Mumbai" },
  { score: "85% fit", reason: "2 years passed. She now has the seniority this product role needs.", matchedRole: "Product Manager · Bangalore" },
];

const bullets = [
  "Full hiring history across your entire team, searchable",
  "Past candidates resurface automatically for new roles",
  "Fit scores get sharper with every recruiter decision",
  "Per-hire cost drops — stop paying to re-find people",
];

export function MemoryPanel() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hintIndex, setHintIndex] = useState<number | null>(null);
  const panelTimeline = TIMELINE.slice(0, 4);
  const selectedTimeline = selectedIndex !== null ? TIMELINE[selectedIndex] : null;
  const selectedResurfaced = selectedIndex !== null ? RESURFACED[selectedIndex] : null;

  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.4 });
  const interactedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  function selectCandidate(index: number) {
    interactedRef.current = true;
    setHintIndex(null);
    setSelectedIndex((current) => (current === index ? null : index));
  }

  // Auto-demo: open the first past candidate, then pulse the second to invite
  // a click. Cancelled on any user interaction; timers cleared on unmount.
  useEffect(() => {
    if (!inView) return;
    const t1 = window.setTimeout(() => {
      if (interactedRef.current) return;
      setSelectedIndex(0);
    }, 700);
    const t2 = window.setTimeout(() => {
      if (interactedRef.current) return;
      setHintIndex(1);
    }, 2300);
    timersRef.current.push(t1, t2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  useEffect(() => () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  return (
    <motion.div
      ref={rootRef}
      initial={{ y: 30 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
      style={{
        background: "#F8F9FC",
        border: "1px solid rgba(52,209,122,0.2)",
        borderRadius: 18,
        boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 60px rgba(52,209,122,0.05)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 38, background: "#EDEEF2", borderBottom: "1px solid rgba(0,0,0,0.07)", display: "flex", alignItems: "center", padding: "0 14px", gap: 6 }}>
        {["#EF4444", "#F5C842", "#34D17A"].map((color) => (
          <div key={color} style={{ width: 8, height: 8, borderRadius: "50%", background: color, opacity: 0.7 }} />
        ))}
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.58rem", color: "#9CA3AF", marginLeft: 8 }}>
          ealana / memory
        </span>
      </div>

      <div style={{ display: "flex", minHeight: 360 }}>
        <div style={{ width: "55%", padding: "1rem 0.75rem", borderRight: "1px solid rgba(0,0,0,0.08)", maxHeight: "420px", overflowY: "auto" }}>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", color: "#9CA3AF", letterSpacing: "0.1em", marginBottom: "1rem" }}>
            PAST CANDIDATES
          </div>

          {panelTimeline.map((entry, index) => {
            const isSelected = selectedIndex === index;
            const isHint = hintIndex === index;
            const highlight = isSelected || isHint;
            return (
              <div key={entry.name} style={{ display: "flex", gap: 10, paddingBottom: 14, position: "relative" }}>
                <div style={{ width: 14, display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", border: `2px solid ${highlight ? "#34D17A" : "#9CA3AF"}`, background: "#F8F9FC", flexShrink: 0, transition: "border-color 0.3s" }} />
                  {index < panelTimeline.length - 1 && <div style={{ flex: 1, width: 1, background: "rgba(0,0,0,0.08)", marginTop: 2 }} />}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", color: "#9CA3AF", marginBottom: 4 }}>{entry.date}</div>
                  <motion.div
                    onClick={() => selectCandidate(index)}
                    animate={isHint
                      ? { boxShadow: ["0 0 0 0 rgba(52,209,122,0.45)", "0 0 0 8px rgba(52,209,122,0)"] }
                      : { boxShadow: "0 0 0 0 rgba(52,209,122,0)" }}
                    transition={isHint ? { duration: 1.5, repeat: Infinity, ease: "easeOut" } : { duration: 0.3 }}
                    style={{
                      background: highlight ? "rgba(52,209,122,0.08)" : "#FFFFFF",
                      border: `1px solid ${highlight ? "rgba(52,209,122,0.3)" : "rgba(0,0,0,0.07)"}`,
                      borderRadius: 7,
                      padding: "8px 10px",
                      cursor: "pointer",
                      transition: "background 0.3s, border-color 0.3s",
                    }}
                  >
                    <div style={{ fontFamily: "var(--font-body)", fontSize: "0.75rem", fontWeight: 500, color: "#111827" }}>{entry.name}</div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: "0.62rem", color: "#4B5563", lineHeight: 1.5, marginTop: 2 }}>{entry.note}</div>
                    <div style={{ display: "inline-block", marginTop: 5, fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", background: entry.tagBg, color: entry.tagColor, borderRadius: 4, padding: "2px 7px" }}>
                      {entry.tag}
                    </div>
                  </motion.div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ width: "45%", padding: "1rem 0.75rem" }}>
          <AnimatePresence mode="wait" initial={false}>
            {selectedIndex === null ? (
              <motion.div
                key="empty"
                initial={false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", minHeight: 280, textAlign: "center" }}
              >
                <div style={{ fontSize: "1.5rem", opacity: 0.3 }}>🧠</div>
                <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.62rem", color: "#9CA3AF", marginTop: 8 }}>
                  Click a candidate to see why they resurfaced
                </div>
              </motion.div>
            ) : selectedTimeline && selectedResurfaced ? (
              <motion.div
                key={selectedIndex}
                initial={{ y: 8 }}
                animate={{ y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
              >
                <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#34D17A", letterSpacing: "0.1em", marginBottom: "0.75rem" }}>
                  ← RESURFACED
                </div>

                <div style={{ background: "rgba(52,209,122,0.08)", border: "1px solid rgba(52,209,122,0.2)", borderRadius: 10, padding: "1rem", marginBottom: "0.75rem" }}>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "0.85rem", fontWeight: 500, color: "#111827" }}>{selectedTimeline.name}</div>
                  <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.65rem", color: "#34D17A", marginTop: 3 }}>{selectedResurfaced.score}</div>
                </div>

                <div style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 8, padding: "0.75rem" }}>
                  <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", color: "#9CA3AF", letterSpacing: "0.1em", marginBottom: 6 }}>
                    WHY NOW
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "0.75rem", color: "#4B5563", lineHeight: 1.6 }}>{selectedResurfaced.reason}</div>
                </div>

                <div style={{ marginTop: "0.75rem", background: "rgba(75,142,240,0.08)", border: "1px solid rgba(75,142,240,0.2)", borderRadius: 8, padding: "0.6rem 0.875rem" }}>
                  <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", color: "#4B8EF0", marginBottom: 3 }}>MATCHED ROLE</div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "0.75rem", color: "#111827" }}>{selectedResurfaced.matchedRole}</div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

export default function MemoryFeature() {
  const isMobile = useIsMobile();
  return (
    <section style={{ padding: isMobile ? "72px 1.25rem" : "120px 4rem" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "1.5rem" : "5rem", alignItems: "center" }}>
        <MemoryPanel />

        <motion.div
          initial={{ y: 30 }}
          whileInView={{ y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#3D4460", letterSpacing: "0.12em", marginBottom: "0.5rem" }}>
            Layer 02
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "3rem", color: "#34D17A", marginBottom: "0.25rem", lineHeight: 1.1 }}>
            Memory
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: "0.9rem", fontStyle: "italic", color: "#34D17A", opacity: 0.7, marginBottom: "1.5rem" }}>
            We remember everything for you
          </div>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "0.97rem", color: "#8891AA", lineHeight: 1.8, marginBottom: "2rem" }}>
            Every sourced candidate and every applicant becomes one verified profile — resume, skills, and history connected. Your pool compounds: repeat searches serve from memory, not credits, so you never pay twice for the same candidate. When the right role opens months later, the right person resurfaces automatically. What compounds globally is knowledge of the public talent market — your applicants, your uploads, and your decisions stay yours.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {bullets.map((bullet) => (
              <div key={bullet} style={{ display: "flex", gap: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#34D17A", flexShrink: 0, marginTop: 7 }} />
                <span style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "#8891AA", lineHeight: 1.6 }}>{bullet}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
