// @charset "utf-8"
import { useState, useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "framer-motion";
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
    description: "Email outreach, WhatsApp status updates, interview scheduling — all from one screen. No tab switching. No copy-pasting. Just one place to move candidates through your pipeline.",
    bullets: [
      "Email outreach with delivery tracking",
      "WhatsApp status updates to staged candidates",
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
  const trackRef = useRef<HTMLDivElement>(null);
  const stepCount = TABS.length;
  const active = (TABS[activeTab] ?? TABS[0])!;


  // Pinned scroll-story (desktop): the section is stepCount viewports tall and
  // the content pins via position:sticky while NATIVE scroll progress selects
  // the active layer (Discover → Memory → Flow). This holds the screen for the
  // three layers — they're the product — without wheel-hijacking: momentum,
  // trackpads, keyboard, and scrollbars all keep working, so no stutter.
  const { scrollYProgress } = useScroll({
    target: trackRef as React.RefObject<HTMLElement>,
    offset: ["start start", "end end"],
  });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (isMobile) return;
    const idx = Math.min(stepCount - 1, Math.max(0, Math.floor(v * stepCount)));
    setActiveTab((t) => (t === idx ? t : idx));
  });

  // Clicking a tab scrolls to that layer's slice of the pinned track.
  const goToStep = (index: number) => {
    if (isMobile || !trackRef.current) {
      setActiveTab(index);
      return;
    }
    const el = trackRef.current;
    const top = window.scrollY + el.getBoundingClientRect().top;
    const track = el.offsetHeight - window.innerHeight;
    const target = top + ((index + 0.5) / stepCount) * track;
    window.scrollTo({ top: target, behavior: "smooth" });
  };

  const headerBlock = (
    <div style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center", padding: isMobile ? "0 0 2rem" : "110px 4rem 56px" }}>
      <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.62rem", letterSpacing: "0.14em", color: "#4B8EF0", textTransform: "uppercase", marginBottom: "1rem" }}>
        How ealana Works
      </div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.2rem,4.2vw,3.2rem)", lineHeight: 1.1, color: "#F4F5FA", fontWeight: 400, margin: 0 }}>
        Three layers. One right hire.
      </h2>
    </div>
  );

  const innerContent = (
    <div style={{ maxWidth: 1180, margin: "0 auto", width: "100%" }}>
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
            {/* Fixed-height stage keeps tab switches reflow-free; NO clipping —
                the mock windows fit the stage and their large soft drop-shadows
                must fade naturally (clipping turns them into hard slabs). */}
            <div style={{ height: isMobile ? "auto" : "min(calc(100vh - 240px), 760px)", position: "relative" }}>
              {active.panel}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );

  if (isMobile) {
    return (
      <section id="features" style={{ padding: "72px 1.25rem" }}>
        {headerBlock}
        {innerContent}
      </section>
    );
  }

  // Header scrolls away in normal flow; the pin then gives the tabs + demo the
  // full viewport (the header was eating ~350px of the pinned screen and the
  // mocks looked small — user feedback).
  return (
    <section id="features" ref={sectionRef}>
      {headerBlock}
      <div ref={trackRef} style={{ height: `${stepCount * 100}vh`, position: "relative" }}>
        <div
          style={{
            position: "sticky",
            top: 0,
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            overflow: "hidden",
            padding: "88px 4rem 28px",
          }}
        >
          {innerContent}
        </div>
      </div>
    </section>
  );
}
