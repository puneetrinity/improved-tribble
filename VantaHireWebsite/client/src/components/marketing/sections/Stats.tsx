// @charset "utf-8"
import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";

interface CountUpProps {
  target: number;
  suffix?: string;
  duration?: number;
  inView: boolean;
}

const STATS = [
  { value: 25, suffix: "+", label: "sources aggregated", accent: "#4B8EF0", countUp: true },
  { value: "3×", label: "faster shortlisting", accent: "#34D17A", countUp: false },
  { value: 60, suffix: "%", label: "lower per-hire cost", accent: "#F5C842", countUp: true },
  { value: "Zero", label: "tab-switching required", accent: "#4B8EF0", countUp: false },
] as const;

function CountUp({ target, suffix = "", duration = 1500, inView }: CountUpProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(tick);
      else setDisplay(target);
    };
    requestAnimationFrame(tick);
  }, [inView, target, duration]);

  return <>{display}{suffix}</>;
}

export default function Stats() {
  const ref = useRef<HTMLElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} style={{ background: "rgba(13,15,30,0.6)", borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {STATS.map((stat, index) => (
          <div key={index} style={{ display: "flex" }}>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.55, delay: index * 0.1, ease: [0.25, 0.1, 0.25, 1] }} style={{ flex: 1, padding: "2.5rem 2rem", textAlign: "center" }}>
              <div style={{ width: 28, height: 2, borderRadius: 2, background: stat.accent, margin: "0 auto 1rem" }} />
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: "3rem", color: "#F4F5FA", lineHeight: 1 }}>
                {stat.countUp ? <CountUp target={stat.value as number} suffix={stat.suffix} inView={inView} /> : stat.value}
              </div>
              <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "0.82rem", color: "#8891AA", marginTop: "0.4rem" }}>{stat.label}</div>
            </motion.div>
            {index < STATS.length - 1 && <div style={{ width: 1, background: "rgba(255,255,255,0.06)", height: 60, alignSelf: "center" }} />}
          </div>
        ))}
      </div>
    </section>
  );
}
