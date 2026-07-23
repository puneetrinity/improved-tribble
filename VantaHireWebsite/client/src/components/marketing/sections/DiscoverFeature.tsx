// @charset "utf-8"
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";

interface CandidateRecord {
  initials: string;
  bg: string;
  color: string;
  name: string;
  role: string;
  score: string;
  scoreColor: string;
  sources: string;
}

const DATASETS: Record<string, CandidateRecord[]> = {
  "Backend Engineer": [
    { initials: "AK", bg: "rgba(52,209,122,0.15)", color: "#34D17A", name: "Arjun Krishnamurthy", role: "Sr. Backend · 7yrs · Python,FastAPI", score: "96%", scoreColor: "#34D17A", sources: "3 sources merged" },
    { initials: "PV", bg: "rgba(75,142,240,0.15)", color: "#4B8EF0", name: "Priya Venkatesh", role: "Backend Dev · 5yrs · FastAPI,Docker", score: "91%", scoreColor: "#4B8EF0", sources: "2 sources merged" },
    { initials: "RS", bg: "rgba(245,200,66,0.15)", color: "#F5C842", name: "Rohit Sharma", role: "Sr. Developer · 6yrs · Django,Redis", score: "84%", scoreColor: "#F5C842", sources: "1 source" },
  ],
  "Product Designer": [
    { initials: "SK", bg: "rgba(52,209,122,0.15)", color: "#34D17A", name: "Sandhya Krishnan", role: "Sr. Designer · 6yrs · Figma,Systems", score: "94%", scoreColor: "#34D17A", sources: "3 sources merged" },
    { initials: "AM", bg: "rgba(75,142,240,0.15)", color: "#4B8EF0", name: "Aditya Mehta", role: "UX Designer · 4yrs · Figma,Research", score: "88%", scoreColor: "#4B8EF0", sources: "2 sources merged" },
  ],
  "ML Engineer": [
    { initials: "VN", bg: "rgba(52,209,122,0.15)", color: "#34D17A", name: "Vikram Nair", role: "ML Engineer · 5yrs · PyTorch,MLOps", score: "97%", scoreColor: "#34D17A", sources: "4 sources merged" },
    { initials: "DS", bg: "rgba(75,142,240,0.15)", color: "#4B8EF0", name: "Divya Sharma", role: "Data Scientist · 4yrs · sklearn,HuggingFace", score: "89%", scoreColor: "#4B8EF0", sources: "2 sources merged" },
  ],
  "Growth Marketer": [
    { initials: "AS", bg: "rgba(75,142,240,0.15)", color: "#4B8EF0", name: "Ananya Singh", role: "Growth · 4yrs · SEO,Paid,Analytics", score: "92%", scoreColor: "#4B8EF0", sources: "3 sources merged" },
    { initials: "KG", bg: "rgba(52,209,122,0.15)", color: "#34D17A", name: "Kunal Gupta", role: "Growth Manager · 5yrs · CRO,Email", score: "87%", scoreColor: "#34D17A", sources: "2 sources merged" },
  ],
};

const CHIPS = ["Backend Engineer", "Product Designer", "ML Engineer", "Growth Marketer"];

const bullets = [
  "25+ sources aggregated into a single candidate profile",
  "AI fit scoring ranks by skills, experience, and role relevance",
  "Contact info, work history, tech stacks enriched automatically",
  "From job description to ranked shortlist in minutes",
];

function ThinkingDots() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "24px 12px" }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[0, 1, 2].map((index) => (
          <motion.div
            key={index}
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: index * 0.15 }}
            style={{ width: 5, height: 5, borderRadius: "50%", background: "#4B8EF0", opacity: 0.6 }}
          />
        ))}
      </div>
      <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.65rem", color: "#9CA3AF" }}>
        Searching 25+ sources...
      </span>
    </div>
  );
}

export function DiscoverPanel() {
  const [activeChip, setActiveChip] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [thinking, setThinking] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const [hintChip, setHintChip] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.4 });
  const interactedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  function triggerSearch(chip: string) {
    if (thinking) return;
    setActiveChip(chip);
    setThinking(true);
    setCandidates([]);
    const id = window.setTimeout(() => {
      setThinking(false);
      setCandidates(DATASETS[chip] || []);
    }, 900);
    timersRef.current.push(id);
  }

  function stopAutoplay() {
    interactedRef.current = true;
    setHintChip(null);
  }

  // Auto-demo when the panel scrolls into view: run the first search, then
  // pulse the next role chip to show it's interactive. Cancelled the instant
  // the user does anything; timers cleared on unmount.
  useEffect(() => {
    if (!inView) return;
    const t1 = window.setTimeout(() => {
      if (interactedRef.current) return;
      triggerSearch(CHIPS[0]!);
    }, 600);
    const t2 = window.setTimeout(() => {
      if (interactedRef.current) return;
      setHintChip(CHIPS[1]!);
    }, 2200);
    timersRef.current.push(t1, t2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  useEffect(() => () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    stopAutoplay();
    const val = event.target.value;
    setInputVal(val);
    const match = CHIPS.find((chip) => chip.toLowerCase().includes(val.toLowerCase()) && val.length > 2);
    if (match) triggerSearch(match);
  }

  function handleChipEnter(event: MouseEvent<HTMLButtonElement>, highlight: boolean) {
    if (!highlight) {
      event.currentTarget.style.color = "#4B8EF0";
      event.currentTarget.style.borderColor = "rgba(75,142,240,0.3)";
      event.currentTarget.style.background = "rgba(75,142,240,0.08)";
    }
  }

  function handleChipLeave(event: MouseEvent<HTMLButtonElement>, highlight: boolean) {
    if (highlight) {
      event.currentTarget.style.color = "#4B8EF0";
      event.currentTarget.style.borderColor = "rgba(75,142,240,0.3)";
      event.currentTarget.style.background = "rgba(75,142,240,0.08)";
    } else {
      event.currentTarget.style.color = "#4B5563";
      event.currentTarget.style.borderColor = "rgba(0,0,0,0.07)";
      event.currentTarget.style.background = "#FFFFFF";
    }
  }

  const statusText = candidates.length ? `Found ${candidates.length} matches · ranked by fit` : "Ready to search";

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      style={{
        background: "#F8F9FC",
        border: "1px solid rgba(75,142,240,0.2)",
        borderRadius: 18,
        boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 60px rgba(75,142,240,0.06)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: 38, background: "#EDEEF2", borderBottom: "1px solid rgba(0,0,0,0.07)", display: "flex", alignItems: "center", padding: "0 14px", gap: 6 }}>
        {["#EF4444", "#F5C842", "#34D17A"].map((color) => (
          <div key={color} style={{ width: 8, height: 8, borderRadius: "50%", background: color, opacity: 0.7 }} />
        ))}
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.58rem", color: "#9CA3AF", marginLeft: 8 }}>
          ealana / discover
        </span>
      </div>

      <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(0,0,0,0.07)", display: "flex", alignItems: "center", gap: 10, background: "#F1F2F6" }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, opacity: 0.6 }}>
          <circle cx="6" cy="6" r="4.5" stroke="#4B8EF0" strokeWidth="1.5" />
          <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="#4B8EF0" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          value={inputVal}
          onChange={handleInput}
          placeholder="Search a role or paste a JD..."
          style={{
            flex: 1,
            background: "none",
            border: "none",
            outline: "none",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "0.8rem",
            color: "#111827",
            caretColor: "#4B8EF0",
          }}
        />
        <span style={{ background: "rgba(75,142,240,0.1)", color: "#4B8EF0", fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(75,142,240,0.2)" }}>
          AI
        </span>
      </div>

      <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(0,0,0,0.07)", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CHIPS.map((chip) => {
          const isActive = activeChip === chip;
          const isHint = hintChip === chip;
          const highlight = isActive || isHint;
          return (
            <motion.button
              key={chip}
              onClick={() => { stopAutoplay(); triggerSearch(chip); }}
              animate={isHint
                ? { boxShadow: ["0 0 0 0 rgba(75,142,240,0.45)", "0 0 0 8px rgba(75,142,240,0)"] }
                : { boxShadow: "0 0 0 0 rgba(75,142,240,0)" }}
              transition={isHint ? { duration: 1.5, repeat: Infinity, ease: "easeOut" } : { duration: 0.3 }}
              style={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "0.6rem",
                color: highlight ? "#4B8EF0" : "#4B5563",
                background: highlight ? "rgba(75,142,240,0.08)" : "#FFFFFF",
                border: `1px solid ${highlight ? "rgba(75,142,240,0.3)" : "rgba(0,0,0,0.07)"}`,
                borderRadius: 100,
                padding: "4px 12px",
                cursor: "pointer",
                transition: "color 0.2s, background 0.2s, border-color 0.2s",
              }}
              onMouseEnter={(event) => handleChipEnter(event, highlight)}
              onMouseLeave={(event) => handleChipLeave(event, highlight)}
            >
              {chip}
            </motion.button>
          );
        })}
      </div>

      <div style={{ minHeight: 240, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
        {thinking && <ThinkingDots />}
        {!thinking && candidates.length === 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 240 }}>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.65rem", color: "#9CA3AF" }}>
              Try searching a role above
            </span>
          </div>
        )}
        <AnimatePresence>
          {!thinking &&
            candidates.map((candidate, index) => (
              <motion.div
                key={candidate.name}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, delay: index * 0.12 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 10px",
                  borderRadius: 10,
                  background: "#FFFFFF",
                  border: "1px solid rgba(0,0,0,0.07)",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                whileHover={{ borderColor: "rgba(75,142,240,0.2)", background: "rgba(75,142,240,0.04)" }}
              >
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: candidate.bg, color: candidate.color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", fontWeight: 600, flexShrink: 0 }}>
                  {candidate.initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", fontWeight: 500, color: "#111827" }}>{candidate.name}</div>
                  <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.62rem", color: "#4B5563", marginTop: 2 }}>{candidate.role}</div>
                  <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", color: "#9CA3AF", marginTop: 3 }}>{candidate.sources}</div>
                </div>
                <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.65rem", fontWeight: 500, padding: "3px 10px", borderRadius: 100, background: `${candidate.scoreColor}1f`, color: candidate.scoreColor, flexShrink: 0 }}>
                  {candidate.score}
                </div>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>

      <div style={{ padding: "8px 14px", borderTop: "1px solid rgba(0,0,0,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: candidates.length ? "#34D17A" : "#9CA3AF" }}>{statusText}</span>
        <span
          style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#4B8EF0", cursor: "pointer", opacity: 0.9 }}
          onMouseEnter={(event) => {
            event.currentTarget.style.opacity = "0.7";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.opacity = "0.9";
          }}
        >
          View all results →
        </span>
      </div>
    </motion.div>
  );
}

export default function DiscoverFeature() {
  const isMobile = useIsMobile();
  return (
    <section style={{ padding: isMobile ? "72px 1.25rem" : "120px 4rem" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "1.5rem" : "5rem", alignItems: "center" }}>
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#3D4460", letterSpacing: "0.12em", marginBottom: "0.5rem" }}>
            Layer 01
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "3rem", color: "#4B8EF0", marginBottom: "0.25rem", lineHeight: 1.1 }}>
            Discover
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: "0.9rem", fontStyle: "italic", color: "#4B8EF0", opacity: 0.7, marginBottom: "1.5rem" }}>
            Find the signal others miss
          </div>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "0.97rem", color: "#8891AA", lineHeight: 1.8, marginBottom: "2rem" }}>
            Most tools search one database and hand you 5,000 names. ealana aggregates from 25+ sources, merges scattered profiles into one view, and ranks a top-100 by real fit — precision-filtered by title, seniority, and experience, in seconds. Reachout-ready candidates, not a pile of maybes.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {bullets.map((bullet) => (
              <div key={bullet} style={{ display: "flex", gap: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4B8EF0", flexShrink: 0, marginTop: 7 }} />
                <span style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "#8891AA", lineHeight: 1.6 }}>{bullet}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <DiscoverPanel />
      </div>
    </section>
  );
}
