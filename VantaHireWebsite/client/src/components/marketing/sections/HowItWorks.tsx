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

  // ── Scroll-jack state (refs so listeners never see stale values) ──
  const stepRef = useRef(0);          // current layer index
  // phase: idle → engaging (smoothly easing into center) → locked (stepping)
  const phaseRef = useRef<"idle" | "engaging" | "locked">("idle");
  const canEngageRef = useRef(true);  // hysteresis guard against instant re-lock
  const lockYRef = useRef(0);         // scrollY the page rests at while locked
  const accumRef = useRef(0);         // wheel delta accumulator
  const lastStepRef = useRef(0);      // timestamp of last step (cooldown)
  const prevDeltaRef = useRef(Number.POSITIVE_INFINITY); // previous center-delta
  const rafRef = useRef<number | null>(null); // in-flight smooth-scroll animation

  const setStep = (n: number) => {
    stepRef.current = n;
    setActiveTab(n);
  };

  // Scroll-jacking: when this section centers in the viewport we lock the page
  // scroll. Each deliberate wheel/key/touch gesture advances one layer
  // (Discover → Memory → Flow). Scrolling past the last layer (or above the
  // first) releases the lock and resumes normal page scroll. Both directions.
  // Desktop only — mobile keeps tap-to-switch tabs (scroll-jacking touch is an
  // anti-pattern and unreliable with mobile browser chrome).
  useEffect(() => {
    if (isMobile) return;

    const STEP_THRESHOLD = 60;  // wheel delta needed to count as one "hard scroll"
    const COOLDOWN = 700;       // ms between steps so one gesture = one layer
    const ENTER_TH = 0.2;       // engage when section center within 20% vh of center
    const EXIT_TH = 0.5;        // re-arm only after section leaves center by 50% vh
    const TOUCH_THRESHOLD = 44; // px of swipe to count as one step
    const ENGAGE_MS = 520;      // duration of the smooth "settle into center" glide

    const getCenterDelta = () => {
      const el = sectionRef.current;
      if (!el) return Number.POSITIVE_INFINITY;
      const rect = el.getBoundingClientRect();
      return rect.top + rect.height / 2 - window.innerHeight / 2;
    };

    // Eased glide to a target scrollY (easeOutCubic). Replaces the old instant
    // snap — this is what makes the section arrive smoothly instead of popping.
    const smoothScrollTo = (targetY: number, onDone: () => void) => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      const startY = window.scrollY;
      const dist = targetY - startY;
      if (Math.abs(dist) < 2) {
        window.scrollTo(0, targetY);
        onDone();
        return;
      }
      const startT = performance.now();
      const ease = (t: number) => 1 - Math.pow(1 - t, 3);
      const frame = (now: number) => {
        const t = Math.min((now - startT) / ENGAGE_MS, 1);
        window.scrollTo(0, Math.round(startY + dist * ease(t)));
        if (t < 1) {
          rafRef.current = requestAnimationFrame(frame);
        } else {
          rafRef.current = null;
          onDone();
        }
      };
      rafRef.current = requestAnimationFrame(frame);
    };

    const engage = (dir: "down" | "up") => {
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const targetY = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
      phaseRef.current = "engaging";
      accumRef.current = 0;
      lastStepRef.current = Date.now();
      lockYRef.current = targetY;
      setStep(dir === "down" ? 0 : stepCount - 1);
      smoothScrollTo(targetY, () => {
        lockYRef.current = window.scrollY;
        lastStepRef.current = Date.now(); // brief settle before first step counts
        phaseRef.current = "locked";
      });
    };

    const release = () => {
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      phaseRef.current = "idle";
      canEngageRef.current = false; // don't immediately re-lock (hysteresis)
      accumRef.current = 0;
    };

    const doStep = (dir: 1 | -1) => {
      if (Date.now() - lastStepRef.current < COOLDOWN) return;
      if (dir > 0) {
        if (stepRef.current < stepCount - 1) {
          setStep(stepRef.current + 1);
          lastStepRef.current = Date.now();
        } else {
          release();
        }
      } else {
        if (stepRef.current > 0) {
          setStep(stepRef.current - 1);
          lastStepRef.current = Date.now();
        } else {
          release();
        }
      }
    };

    const onScroll = () => {
      const vh = window.innerHeight;
      const d = getCenterDelta();

      // While engaging or locked we never fight the scroll — no re-pinning.
      // (Wheel/touch/keys are blocked, so the page stays put on its own.)
      if (phaseRef.current !== "idle") {
        prevDeltaRef.current = d;
        return;
      }
      if (!canEngageRef.current) {
        if (Math.abs(d) > EXIT_TH * vh) canEngageRef.current = true;
        prevDeltaRef.current = d;
        return;
      }
      const crossed =
        (prevDeltaRef.current > 0 && d <= 0) || (prevDeltaRef.current < 0 && d >= 0);
      if (Math.abs(d) < ENTER_TH * vh || crossed) {
        engage(prevDeltaRef.current > 0 ? "down" : "up");
      }
      prevDeltaRef.current = d;
    };

    const onWheel = (e: WheelEvent) => {
      if (phaseRef.current === "idle") return;
      e.preventDefault(); // hold the page during both the glide and the lock
      if (phaseRef.current !== "locked") return; // no stepping mid-glide
      if (Date.now() - lastStepRef.current < COOLDOWN) {
        accumRef.current = 0;
        return;
      }
      accumRef.current += e.deltaY;
      if (Math.abs(accumRef.current) < STEP_THRESHOLD) return;
      const dir = accumRef.current > 0 ? 1 : -1;
      accumRef.current = 0;
      doStep(dir);
    };

    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current === "idle") return;
      if (["ArrowDown", "PageDown", " ", "ArrowUp", "PageUp"].includes(e.key)) {
        e.preventDefault();
        if (phaseRef.current !== "locked") return;
        if (["ArrowDown", "PageDown", " "].includes(e.key)) doStep(1);
        else doStep(-1);
      }
    };

    let touchStartY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (phaseRef.current === "idle") return;
      e.preventDefault();
      if (phaseRef.current !== "locked") return;
      const y = e.touches[0]?.clientY ?? 0;
      const dy = touchStartY - y;
      if (Math.abs(dy) < TOUCH_THRESHOLD) return;
      touchStartY = y;
      doStep(dy > 0 ? 1 : -1);
    };

    prevDeltaRef.current = getCenterDelta();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("resize", onScroll);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("resize", onScroll);
    };
  }, [isMobile, stepCount]);

  // Clicking a tab smoothly centers the section, locks, and jumps to that layer.
  const goToStep = (index: number) => {
    const el = sectionRef.current;
    if (isMobile || !el) {
      setActiveTab(index);
      return;
    }
    const rect = el.getBoundingClientRect();
    const targetY = window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
    phaseRef.current = "locked";
    lockYRef.current = targetY;
    canEngageRef.current = false;
    accumRef.current = 0;
    lastStepRef.current = Date.now();
    window.scrollTo({ top: targetY, behavior: "smooth" });
    setStep(index);
  };

  const innerContent = (
    <div style={{ maxWidth: 1100, margin: "0 auto", width: "100%" }}>
      <div style={{ marginBottom: isMobile ? "2rem" : "2.5rem", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.62rem", letterSpacing: "0.14em", color: "#4B8EF0", textTransform: "uppercase", marginBottom: "1rem" }}>
          How Ealana Works
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2.4rem,5vw,3.8rem)", lineHeight: 1.1, color: "#F4F5FA", fontWeight: 400, margin: 0 }}>
          Three layers. One right hire.
        </h2>
      </div>

      <div style={{ display: "flex", justifyContent: isMobile ? "flex-start" : "center", gap: 8, marginBottom: "2rem", overflowX: isMobile ? "auto" : "visible", paddingBottom: isMobile ? 4 : 0 }}>
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
            {active.panel}
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
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 4rem",
        overflow: "hidden",
      }}
    >
      {innerContent}
    </section>
  );
}
