// @charset "utf-8"
import { useState, useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { DiscoverPanel } from "./DiscoverFeature";
import { MemoryPanel } from "./MemoryFeature";
import { FlowPanel } from "./FlowFeature";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const isMobile = useIsMobile();
  const sectionRef = useRef<HTMLElement>(null);
  const stepCount = TABS.length;
  const active = (TABS[activeTab] ?? TABS[0])!;


  // Scroll-jacking: when this section centers in the viewport we lock the page
  // scroll. Each deliberate wheel/key/touch gesture advances one layer
  // (Discover → Memory → Flow). Scrolling past the last layer (or above the
  // first) releases the lock and resumes normal page scroll. Both directions.
  // Desktop only — mobile keeps tap-to-switch tabs (scroll-jacking touch is an
  // anti-pattern and unreliable with mobile browser chrome).

  // Clicking a tab smoothly centers the section, locks, and jumps to that layer.
  // Normal scrolling everywhere. The old scroll-jack (wheel capture + viewport
  // lock + stepped tabs) felt like stutter and fought the user's scroll; tabs
  // are click-driven with a gentle auto-advance that pauses on interaction.
  const interactedRef = useRef(false);
  const goToStep = (index: number) => {
    interactedRef.current = true;
    setActiveTab(index);
  };

  useEffect(() => {
    if (isMobile) return;
    const id = setInterval(() => {
      if (interactedRef.current) return; // user took over — stop rotating
      setActiveTab((t) => (t + 1) % stepCount);
    }, 6500);
    return () => clearInterval(id);
  }, [isMobile, stepCount]);

  const innerContent = (
    <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: isMobile ? "1.5rem" : "1.75rem", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.62rem", letterSpacing: "0.14em", color: "#4B8EF0", textTransform: "uppercase", marginBottom: "1rem" }}>
          How Ealana Works
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.2rem,4.2vw,3.2rem)", lineHeight: 1.1, color: "#F4F5FA", fontWeight: 400, margin: 0 }}>
          Three layers. One right hire.
        </h2>
      </div>

      <div style={{ display: "flex", justifyContent: isMobile ? "flex-start" : "center", gap: 8, marginBottom: "1.25rem", overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? 4 : 0 }}>
        {TABS.map((tab, index) => {
          const isActive = index === activeTab;
          return (
            <button
              key={tab.label}
              onClick={() => goToStep(index)}
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "0.9rem",
                color: isActive ? "#FFFFFF" : "#8891AA",
                background: isActive ? `${tab.accent}1f` : "rgba(255,255,255,0.03)",
                border: `1px solid ${isActive ? `${tab.accent}66` : "rgba(255,255,255,0.07)"}`,
                borderRadius: 100,
                padding: isMobile ? "10px 20px" : "10px 28px",
                whiteSpace: "nowrap",
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
          style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "1.5rem" : "5rem", alignItems: "center" }}
        >
          <div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#3D4460", letterSpacing: "0.12em" }}>{active.layerNum}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "2.7rem", color: active.accent, lineHeight: 1, marginBottom: "0.4rem", marginTop: "0.25rem" }}>{active.title}</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: "0.9rem", fontStyle: "italic", color: active.accent, opacity: 0.7, marginBottom: "1rem" }}>{active.hook}</div>
            <p style={{ fontFamily: "var(--font-body)", fontSize: "0.95rem", color: "#8891AA", lineHeight: 1.7, marginBottom: "1.25rem" }}>{active.description}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {active.bullets.map((bullet) => (
                <div key={bullet} style={{ display: "flex", gap: 10 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: active.accent, flexShrink: 0, marginTop: 7 }} />
                  <span style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "#8891AA", lineHeight: 1.6 }}>{bullet}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ position: "relative" }}>
            <motion.div
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              style={{
                position: "absolute",
                top: isMobile ? -14 : -26,
                right: 0,
                zIndex: 3,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 11px",
                borderRadius: 100,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "0.6rem",
                letterSpacing: "0.04em",
                color: active.accent,
                background: `${active.accent}1f`,
                border: `1px solid ${active.accent}59`,
                boxShadow: `0 6px 18px ${active.accent}26`,
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              <span style={{ fontSize: "0.7rem" }}>👇</span> Try it out here
            </motion.div>
            <div style={{ height: isMobile ? "auto" : "min(68vh, 640px)", overflow: "hidden", position: "relative", borderRadius: 16 }}>
              {active.panel}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 32, background: "linear-gradient(to bottom, transparent, rgba(5,6,14,0.85))", pointerEvents: "none" }} />
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );

  if (isMobile) {
    return (
      <section id="features" style={{ padding: "72px 1.25rem" }}>
        {innerContent}
      </section>
    );
  }

  return (
    <section
      id="features"
      ref={sectionRef}
      style={{
        padding: "110px 4rem 90px",
      }}
    >
      {innerContent}
    </section>
  );
}
