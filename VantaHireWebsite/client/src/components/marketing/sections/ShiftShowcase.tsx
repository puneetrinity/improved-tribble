import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";

const MOCK_WINDOW: React.CSSProperties = {
  background: "#F8F9FC",
  color: "#111827",
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  boxShadow: "0 32px 80px rgba(0,0,0,0.5)",
  padding: 22,
  fontFamily: "var(--font-body)",
  fontSize: "0.82rem",
  width: "100%",
  maxWidth: 560,
  margin: "0 auto",
};

function WindowBar() {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: "#D7DBE7" }} />
      ))}
    </div>
  );
}

const ATS_STATUS: Record<string, { bg: string; fg: string }> = {
  "In review": { bg: "rgba(75,142,240,0.12)", fg: "#2F6FD0" },
  "On hold": { bg: "rgba(245,200,66,0.16)", fg: "#8A6510" },
  Archived: { bg: "#EEF0F4", fg: "#6B7280" },
};

function AtsPanel() {
  const rows: Array<[string, string, string, string, string]> = [
    ["AK", "A. Krishnamurthy", "Mar 12", "In review", "#4B8EF0"],
    ["PS", "P. Sharma", "Mar 09", "In review", "#34D17A"],
    ["RM", "R. Mehta", "Feb 28", "On hold", "#F5C842"],
    ["SI", "S. Iyer", "Feb 21", "On hold", "#4B8EF0"],
    ["VN", "V. Nair", "Feb 14", "Archived", "#34D17A"],
  ];
  return (
    <div style={MOCK_WINDOW}>
      <WindowBar />
      <table style={{ width: "100%", borderCollapse: "collapse", color: "#6B7280" }}>
        <thead>
          <tr>
            {["Candidate", "Applied", "Status"].map((h) => (
              <th key={h} style={{ textAlign: "left", fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "#9CA3AF", padding: "8px 10px", borderBottom: "1px solid #E5E7EB" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([initials, name, date, status, tint]) => (
            <tr key={name}>
              <td style={{ padding: "9px 10px", borderBottom: "1px solid #F1F3F7" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 26, height: 26, borderRadius: "50%", background: `${tint}1f`, color: tint === "#F5C842" ? "#8A6510" : tint, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.6rem", fontWeight: 600, flexShrink: 0 }}>{initials}</span>
                  <span style={{ color: "#374151", fontWeight: 500 }}>{name}</span>
                </span>
              </td>
              <td style={{ padding: "9px 10px", borderBottom: "1px solid #F1F3F7" }}>{date}</td>
              <td style={{ padding: "9px 10px", borderBottom: "1px solid #F1F3F7" }}>
                <span style={{ fontSize: "0.66rem", padding: "2px 9px", borderRadius: 100, background: ATS_STATUS[status]!.bg, color: ATS_STATUS[status]!.fg }}>{status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 12, fontSize: "0.7rem", color: "#9CA3AF", textAlign: "center" }}>5 records · sorted by date · nothing ranked, nothing learned</div>
    </div>
  );
}

const FLOOD = [
  ["Backend Dev", "6y · Pune"], ["SW Engineer", "4y · Remote"], ["Sr. Backend", "8y · Noida"],
  ["Python Dev", "3y · Bengaluru"], ["Platform Eng", "7y · Gurgaon"], ["Backend Dev", "5y · Remote"],
  ["SDE II", "4y · Hyderabad"], ["Go Developer", "6y · Pune"], ["API Engineer", "5y · Remote"],
  ["Sr. SWE", "9y · Noida"], ["Backend Dev", "2y · Chennai"], ["DevOps Eng", "6y · Remote"],
  ["Java Dev", "7y · Mumbai"], ["Node Engineer", "4y · Remote"], ["SW Engineer", "5y · Delhi"],
  ["Sr. Platform", "8y · Bengaluru"],
] as const;

function TiPanel({ animate }: { animate: boolean }) {
  return (
    <div style={MOCK_WINDOW}>
      <WindowBar />
      <div style={{ position: "relative", maxHeight: 232, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))", gap: 8 }}>
          {FLOOD.map(([role, meta], i) => {
            const tint = ["#4B8EF0", "#34D17A", "#F5C842"][i % 3]!;
            return (
              <motion.div
                key={role + meta}
                initial={animate ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: animate ? Math.min(i * 0.045, 0.7) : 0 }}
                style={{ display: "flex", gap: 8, alignItems: "center", border: "1px solid #E5E7EB", borderRadius: 9, padding: "8px 10px", background: "#FFFFFF", color: "#6B7280", fontSize: "0.66rem" }}
              >
                <span style={{ width: 22, height: 22, borderRadius: 7, background: `${tint}1a`, color: tint === "#F5C842" ? "#8A6510" : tint, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.58rem", fontWeight: 700, flexShrink: 0 }}>{role[0]}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", color: "#374151", fontWeight: 600, fontSize: "0.7rem", whiteSpace: "nowrap" }}>{role}</span>
                  {meta}
                </span>
              </motion.div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 30, paddingBottom: 4, textAlign: "center", fontSize: "0.7rem", color: "#6B7280", background: "linear-gradient(transparent, #F8F9FC 70%)" }}>
          …4,831 more · unranked
        </div>
      </div>
    </div>
  );
}

const RANKED = [
  { initials: "AK", name: "Arjun Krishnamurthy", meta: "Sr. Backend · 7y", score: "96%", tint: "#4B8EF0", chips: [["Python + K8s match", "ev"], ["Seniority fit", "ev"]] },
  { initials: "PS", name: "Priya Sharma", meta: "Backend · 6y", score: "93%", tint: "#34D17A", chips: [["You met her in March", "mem"], ["Go + Postgres", "ev"]] },
  { initials: "RM", name: "Rahul Mehta", meta: "Platform · 8y", score: "91%", tint: "#F5C842", chips: [["Java + AWS", "ev"]] },
] as const;

function DiPanel({ animate }: { animate: boolean }) {
  return (
    <div style={{ ...MOCK_WINDOW, padding: 18 }}>
      <WindowBar />
      <div>
        {RANKED.map((c, i) => (
          <motion.div
            key={c.initials}
            initial={animate ? { opacity: 0, y: 14 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: animate ? 0.12 * i : 0 }}
            style={{ display: "grid", gridTemplateColumns: "34px 1fr auto", gap: 12, alignItems: "center", padding: "9px 10px", borderBottom: i < RANKED.length - 1 ? "1px solid #ECEFF5" : "none" }}
          >
            <span style={{ width: 34, height: 34, borderRadius: "50%", background: `${c.tint}26`, color: c.tint === "#F5C842" ? "#B8860B" : c.tint, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.66rem", fontWeight: 600 }}>{c.initials}</span>
            <span>
              <span style={{ display: "block", fontWeight: 600 }}>{c.name}</span>
              <span style={{ display: "block", color: "#6B7280", fontSize: "0.72rem", marginBottom: 3 }}>{c.meta}</span>
              {c.chips.map(([label, kind]) => (
                <span key={label} style={{ display: "inline-block", fontSize: "0.62rem", padding: "2px 8px", borderRadius: 100, marginRight: 4, background: kind === "mem" ? "rgba(52,209,122,0.12)" : "rgba(75,142,240,0.1)", color: kind === "mem" ? "#1FA45C" : "#2F6FD0" }}>{label}</span>
              ))}
            </span>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.8rem", color: "#1FA45C" }}>{c.score}</span>
          </motion.div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontSize: "0.7rem", color: "#9CA3AF", textAlign: "center" }}>Top 100 ranked · evidence attached · memory applied</div>
    </div>
  );
}

interface Beat {
  key: string;
  label: string;
  accent: string;
  rung: string;
  title: string;
  hook: string;
  caption: string;
  panel: (animate: boolean) => React.ReactNode;
}

const BEATS: Beat[] = [
  {
    key: "ats",
    label: "ATS",
    accent: "#6C7590",
    rung: "Rung 01",
    title: "ATS",
    hook: "The system of record",
    caption: "Keeps records. Tracks who applied. Nothing ranked, nothing learned.",
    panel: () => <AtsPanel />,
  },
  {
    key: "ti",
    label: "Talent intelligence",
    accent: "#C7CDDE",
    rung: "Rung 02",
    title: "Talent intelligence",
    hook: "The system of insight",
    caption: "Tells you who exists — 4,847 profiles, impressive and unranked. Now what? And when this search ends, everything it taught you is gone.",
    panel: (animate) => <TiPanel animate={animate} />,
  },
  {
    key: "di",
    label: "Decision intelligence",
    accent: "#4B8EF0",
    rung: "Rung 03",
    title: "Decision intelligence",
    hook: "The system of action",
    caption: "Ranks, remembers, recommends — the same market, turned into a decision. You met her in March.",
    panel: (animate) => <DiPanel animate={animate} />,
  },
];

export default function ShiftShowcase() {
  const [activeTab, setActiveTab] = useState(0);
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const stepCount = BEATS.length;
  const active = (BEATS[activeTab] ?? BEATS[0])!;

  // Same pinned scroll-story mechanics as the layers showcase: native scroll
  // drives the active beat, position:sticky holds the screen, nothing hijacks
  // the wheel. Mobile stays natural flow with tap tabs.
  const { scrollYProgress } = useScroll({
    target: trackRef as React.RefObject<HTMLElement>,
    offset: ["start start", "end end"],
  });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (isMobile) return;
    const idx = Math.min(stepCount - 1, Math.max(0, Math.floor(v * stepCount)));
    setActiveTab((t) => (t === idx ? t : idx));
  });

  const goToBeat = (index: number) => {
    if (isMobile || !trackRef.current) {
      setActiveTab(index);
      return;
    }
    const el = trackRef.current;
    const top = window.scrollY + el.getBoundingClientRect().top;
    const track = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + ((index + 0.5) / stepCount) * track, behavior: "smooth" });
  };

  const headerBlock = (
    <div style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center", padding: isMobile ? "0 0 2rem" : "110px 4rem 56px" }}>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.62rem", letterSpacing: "0.14em", color: "#4B8EF0", textTransform: "uppercase", marginBottom: "1rem" }}>
        The Shift
      </div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.2rem,4.2vw,3.2rem)", lineHeight: 1.1, color: "#F4F5FA", fontWeight: 400, margin: 0 }}>
        From records to{" "}
        <span style={{ fontStyle: "italic", background: "linear-gradient(135deg, #4B8EF0, #34D17A)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          decisions.
        </span>
      </h2>
    </div>
  );

  const innerContent = (
    <div style={{ maxWidth: 1180, margin: "0 auto", width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: isMobile ? "1.25rem" : "2.5rem", flexWrap: isMobile ? "wrap" : "nowrap" }}>
        {BEATS.map((beat, index) => {
          const isActive = index === activeTab;
          const accent = beat.key === "di" ? "#4B8EF0" : "#8891AA";
          return (
            <button
              key={beat.key}
              onClick={() => goToBeat(index)}
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.9rem",
                color: isActive ? "#FFFFFF" : "#8891AA",
                background: isActive ? `${accent}1f` : "rgba(255,255,255,0.03)",
                border: `1px solid ${isActive ? `${accent}66` : "rgba(255,255,255,0.07)"}`,
                borderRadius: 100,
                padding: isMobile ? "10px 18px" : "10px 26px",
                whiteSpace: "nowrap",
                cursor: "pointer",
                transition: "all 0.25s",
                boxShadow: isActive ? `0 0 20px ${accent}1a` : "none",
                textDecoration: beat.key === "ti" && activeTab === 2 ? "line-through" : "none",
              }}
            >
              {beat.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.35, ease: "easeInOut" }}
          style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1.2fr)", gap: isMobile ? "1.5rem" : "5rem", alignItems: "center" }}
        >
          <div style={{ position: "relative", zIndex: 2 }}>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#3D4460", letterSpacing: "0.12em" }}>{active.rung}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? "2rem" : "2.6rem", color: active.key === "di" ? "#4B8EF0" : "#F4F5FA", lineHeight: 1.05, marginBottom: "0.4rem", marginTop: "0.25rem" }}>{active.title}</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: "0.9rem", fontStyle: "italic", color: active.key === "di" ? "#4B8EF0" : "#8891AA", opacity: 0.75, marginBottom: "1rem" }}>{active.hook}</div>
            <p style={{ fontFamily: "var(--font-body)", fontSize: "0.98rem", color: active.key === "di" ? "#C7CDDE" : "#8891AA", lineHeight: 1.7, margin: 0 }}>{active.caption}</p>
          </div>
          <div style={{ height: isMobile ? "auto" : "min(calc(100vh - 280px), 560px)", display: "flex", alignItems: "center", minWidth: 0, position: "relative", zIndex: 1 }}>
            {active.panel(!reducedMotion)}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );

  // GEO block: the ladder as permanent, server-rendered, always-visible text.
  const ladderRecap = (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: isMobile ? "2rem 1.25rem 3rem" : "2rem 4rem 4rem", textAlign: "center" }}>
      <p style={{ fontFamily: "var(--font-body)", fontSize: "0.95rem", color: "#8891AA", lineHeight: 1.8, margin: 0 }}>
        An ATS keeps records — it tracks who applied. Talent intelligence adds insight — it tells you
        who exists. Decision intelligence ranks, remembers, and recommends — it tells you what to do
        next.
      </p>
      <p style={{ margin: "0.9rem 0 0" }}>
        <a href="/what-is-decision-intelligence" style={{ fontFamily: "var(--font-body)", fontSize: "0.82rem", color: "#6C7590", textDecoration: "none" }}>
          More on decision intelligence →
        </a>
      </p>
    </div>
  );

  if (isMobile) {
    return (
      <section id="features" style={{ position: "relative" }}>
        <div style={{ padding: "56px 1.25rem 0" }}>{headerBlock}</div>
        <div style={{ padding: "0 1.25rem" }}>{innerContent}</div>
        {ladderRecap}
      </section>
    );
  }

  return (
    <section id="features" style={{ position: "relative" }}>
      {headerBlock}
      <div ref={trackRef} style={{ height: `${stepCount * 100}vh`, position: "relative" }}>
        <div style={{ position: "sticky", top: 0, height: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "88px 4rem 28px", overflow: "visible" }}>
          {innerContent}
        </div>
      </div>
      {ladderRecap}
    </section>
  );
}
