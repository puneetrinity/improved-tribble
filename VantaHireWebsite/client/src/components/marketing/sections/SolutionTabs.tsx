import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";

const TABS = ["Recruitment Agencies", "Staffing Firms", "In-House Teams"];

const BEFORE = [
  [
    "Researchers spend 60% of time on manual sourcing",
    "Duplicate candidates across different client pipelines",
    "Knowledge lost every time a recruiter leaves",
    "Clients want updates but data lives in spreadsheets",
  ],
  [
    "High volume roles need faster turnaround than ATS allows",
    "Same candidates placed twice — no shared memory",
    "Outreach scattered across WhatsApp, email, calls",
    "No visibility into which sources actually perform",
  ],
  [
    "Every new role starts from zero — no candidate memory",
    "Hiring managers give feedback on Slack, lost forever",
    "Interview scheduling takes days of back-and-forth",
    "Per-hire cost grows every year with no compound effect",
  ],
];

const AFTER = [
  [
    "25+ sources searched automatically in minutes",
    "Unified candidate pool across all client pipelines",
    "Every note, every decision stored and searchable forever",
    "Client portal with live pipeline — no more update calls",
  ],
  [
    "AI ranking cuts shortlisting from days to hours",
    "Shared memory flags duplicates across all placements",
    "WhatsApp + email outreach from one unified screen",
    "Source analytics show exactly what's working",
  ],
  [
    "Past candidates resurface automatically for new roles",
    "Structured feedback portal linked directly to pipeline",
    "Self-serve scheduling with calendar links and reminders",
    "Per-hire cost drops as hiring intelligence compounds",
  ],
];

const METRICS = [
  [
    { num: "3×", label: "faster candidate delivery" },
    { num: "60%", label: "less time on manual sourcing" },
    { num: "100%", label: "client pipeline visibility" },
  ],
  [
    { num: "5×", label: "more roles filled per recruiter" },
    { num: "Zero", label: "duplicate placements" },
    { num: "40%", label: "lower cost per placement" },
  ],
  [
    { num: "25+", label: "sources in one search" },
    { num: "60%", label: "lower per-hire cost by year 2" },
    { num: "Zero", label: "knowledge lost when team changes" },
  ],
];

type MetricCellProps = {
  num: string;
  label: string;
  animKey: number;
};

function MetricCell({ num, label, animKey }: MetricCellProps) {
  const [display, setDisplay] = useState(num);

  useEffect(() => {
    setDisplay("");
    const timeout = window.setTimeout(() => setDisplay(num), 50);
    return () => window.clearTimeout(timeout);
  }, [animKey, num]);

  return (
    <div style={{ background: "#09091A", padding: "1.5rem", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem", color: "#F4F5FA", lineHeight: 1 }}>
        {display}
      </div>
      <div style={{ fontFamily: "var(--font-body)", fontSize: "0.8rem", color: "#8891AA", marginTop: "0.25rem" }}>
        {label}
      </div>
    </div>
  );
}

export default function SolutionTabs() {
  const [activeTab, setActiveTab] = useState(0);
  const isMobile = useIsMobile();
  const beforeItems = BEFORE[activeTab] ?? [];
  const afterItems = AFTER[activeTab] ?? [];
  const metrics = METRICS[activeTab] ?? [];

  return (
    <section style={{ padding: isMobile ? "56px 1.25rem 80px" : "80px 4rem 120px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: isMobile ? "flex-start" : "center", gap: 8, marginBottom: isMobile ? "2rem" : "4rem", flexWrap: isMobile ? "nowrap" : "wrap", overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? 4 : 0 }}>
          {TABS.map((tab, i) => {
            const isActive = activeTab === i;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.88rem",
                  color: isActive ? "#F4F5FA" : "#8891AA",
                  background: isActive ? "rgba(75,142,240,0.1)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isActive ? "rgba(75,142,240,0.35)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: 100,
                  padding: isMobile ? "10px 18px" : "10px 24px",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  boxShadow: isActive ? "0 0 20px rgba(75,142,240,0.1)" : "none",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = "#F4F5FA";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = "#8891AA";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
                  }
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "1rem" : "3rem", alignItems: "start" }}>
              <div style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.28)", borderRadius: 16, padding: isMobile ? "1.25rem" : "2rem", boxShadow: "0 0 40px rgba(239,68,68,0.10)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#EF4444", boxShadow: "0 0 8px rgba(239,68,68,0.5)", flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#EF4444", letterSpacing: "0.12em" }}>BEFORE EALANA</span>
                </div>
                {beforeItems.map((text) => (
                  <div key={text} style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                    <span style={{ color: "#EF4444", fontSize: "0.8rem", flexShrink: 0, marginTop: 2 }}>✕</span>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "#8891AA", lineHeight: 1.6 }}>{text}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "rgba(52,209,122,0.07)", border: "1px solid rgba(52,209,122,0.32)", borderRadius: 16, padding: isMobile ? "1.25rem" : "2rem", boxShadow: "0 0 40px rgba(52,209,122,0.12)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#34D17A", boxShadow: "0 0 8px rgba(52,209,122,0.5)", flexShrink: 0 }} />
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#34D17A", letterSpacing: "0.12em" }}>WITH EALANA</span>
                </div>
                {afterItems.map((text) => (
                  <div key={text} style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                    <span style={{ color: "#34D17A", fontSize: "0.8rem", flexShrink: 0, marginTop: 2 }}>✓</span>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "#8891AA", lineHeight: 1.6 }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3,1fr)", gap: 1, marginTop: "1rem", background: "rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden" }}>
              {metrics.map(({ num, label }) => (
                <MetricCell key={num + label} num={num} label={label} animKey={activeTab} />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
