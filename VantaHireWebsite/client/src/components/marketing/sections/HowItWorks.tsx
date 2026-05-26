// @charset "utf-8"
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DiscoverPanel } from "./DiscoverFeature";
import { MemoryPanel } from "./MemoryFeature";
import { FlowPanel } from "./FlowFeature";

interface TabConfig {
  label: string;
  accent: string;
  layerNum: string;
  title: string;
  hook: string;
  description: string;
  bullets: string[];
  panel: ReactNode;
}

const TABS: TabConfig[] = [
  {
    label: "Discover",
    accent: "#4B8EF0",
    layerNum: "Layer 01",
    title: "Discover",
    hook: "Find the signal others miss",
    description: "25+ sources aggregated into one ranked list. No more tab switching between LinkedIn, Naukri, GitHub. ealana finds candidates others miss and scores them by real fit — not keywords.",
    bullets: [
      "25+ sources merged into one unified profile",
      "AI fit scoring by skills and experience",
      "From job description to shortlist in minutes",
    ],
    panel: <DiscoverPanel />,
  },
  {
    label: "Memory",
    accent: "#34D17A",
    layerNum: "Layer 02",
    title: "Memory",
    hook: "Never lose the signal",
    description: "Every candidate your team finds, every note, every not right now — stored and connected. When the right role opens months later, the right person resurfaces automatically.",
    bullets: [
      "Full hiring history searchable across your team",
      "Past candidates resurface for new roles automatically",
      "Fit scores sharpen with every recruiter decision",
    ],
    panel: <MemoryPanel />,
  },
  {
    label: "Flow",
    accent: "#F5C842",
    layerNum: "Layer 03",
    title: "Flow",
    hook: "Act on the signal",
    description: "WhatsApp, email, scheduling — all from one screen. No tab switching. No copy-pasting. Just one place to move candidates through your pipeline.",
    bullets: [
      "WhatsApp + email outreach with delivery tracking",
      "Interview scheduling with calendar links",
      "Hiring manager feedback in one structured place",
    ],
    panel: <FlowPanel />,
  },
];

export default function HowItWorks() {
  const [activeTab, setActiveTab] = useState(0);
  const active = (TABS[activeTab] ?? TABS[0])!;

  return (
    <section id="features" style={{ padding: "120px 4rem" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ marginBottom: "4rem", textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.62rem", letterSpacing: "0.14em", color: "#4B8EF0", textTransform: "uppercase", marginBottom: "1rem" }}>
            How Ealana Works
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.4rem,5vw,3.8rem)", lineHeight: 1.1, color: "#F4F5FA", fontWeight: 400, margin: 0 }}>
            Three layers. One right hire.
          </h2>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: "3rem" }}>
          {TABS.map((tab, index) => {
            const isActive = index === activeTab;
            return (
              <button
                key={tab.label}
                onClick={() => setActiveTab(index)}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "0.9rem",
                  color: isActive ? "#FFFFFF" : "#8891AA",
                  background: isActive ? `${tab.accent}1f` : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isActive ? `${tab.accent}66` : "rgba(255,255,255,0.07)"}`,
                  borderRadius: 100,
                  padding: "10px 28px",
                  cursor: "pointer",
                  transition: "all 0.25s",
                  boxShadow: isActive ? `0 0 20px ${tab.accent}1a` : "none",
                }}
              >
                {tab.label}
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
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5rem", alignItems: "center" }}
          >
            <div>
              <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#3D4460", letterSpacing: "0.12em" }}>{active.layerNum}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "3.5rem", color: active.accent, lineHeight: 1, marginBottom: "0.5rem", marginTop: "0.35rem" }}>{active.title}</div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: "0.9rem", fontStyle: "italic", color: active.accent, opacity: 0.7, marginBottom: "1.5rem" }}>{active.hook}</div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: "0.97rem", color: "#8891AA", lineHeight: 1.8, marginBottom: "2rem" }}>{active.description}</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {active.bullets.map((bullet) => (
                  <div key={bullet} style={{ display: "flex", gap: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: active.accent, flexShrink: 0, marginTop: 7 }} />
                    <span style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "#8891AA", lineHeight: 1.6 }}>{bullet}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>{active.panel}</div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
