// @charset "utf-8"
import { useRef, useState, type ReactNode } from "react";
import { motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";

const mono = { fontFamily: "'JetBrains Mono',monospace" };
const body = { fontFamily: "'DM Sans',sans-serif" };

function cardStyle(active: boolean, accent: string) {
  return {
    background: "#0D0F1E",
    border: `1px solid ${active ? `${accent}4D` : "rgba(255,255,255,0.07)"}`,
    borderRadius: 16,
    padding: "1.25rem",
    height: "100%",
    boxSizing: "border-box" as const,
    boxShadow: active ? `0 0 40px ${accent}14` : "none",
    transition: "border-color 0.5s, box-shadow 0.5s",
  };
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ ...mono, fontSize: "0.55rem", borderRadius: 100, padding: "2px 8px", background: `${color}18`, color, flexShrink: 0 }}>
      {label}
    </span>
  );
}

function DiscoverCard({ active }: { active: boolean }) {
  const accent = "#4B8EF0";
  return (
    <div style={cardStyle(active, accent)}>
      <div style={{ ...mono, fontSize: "0.58rem", letterSpacing: "0.12em", color: accent, marginBottom: 14 }}>DISCOVER</div>
      <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, padding: "8px 12px", marginBottom: 12, ...mono, fontSize: "0.65rem", color: "#8891AA" }}>
        Senior Backend Engineer · Bangalore
      </div>
      {[
        { initials: "AK", name: "Arjun K.", role: "Sr. Backend", score: "96%", scoreColor: "#34D17A", bg: "rgba(75,142,240,0.15)", ic: "#4B8EF0" },
        { initials: "PV", name: "Priya V.", role: "Backend Dev", score: "91%", scoreColor: "#4B8EF0", bg: "rgba(52,209,122,0.15)", ic: "#34D17A" },
      ].map((row) => (
        <div key={row.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, background: row.bg, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: "0.48rem", color: row.ic }}>{row.initials}</div>
          <div style={{ flex: 1 }}>
            <div style={{ ...body, fontSize: "0.72rem", color: "#F4F5FA" }}>{row.name}</div>
            <div style={{ ...mono, fontSize: "0.52rem", color: "#3D4460" }}>{row.role}</div>
          </div>
          <Badge label={row.score} color={row.scoreColor} />
        </div>
      ))}
    </div>
  );
}

function MemoryCard({ active }: { active: boolean }) {
  const accent = "#34D17A";
  return (
    <div style={cardStyle(active, accent)}>
      <div style={{ ...mono, fontSize: "0.58rem", letterSpacing: "0.12em", color: accent, marginBottom: 14 }}>MEMORY</div>
      <div style={{ position: "relative", paddingLeft: 16, marginBottom: 12 }}>
        <div style={{ position: "absolute", left: 3, top: 4, bottom: 4, width: 1, background: "rgba(52,209,122,0.2)" }} />
        {["Priya V. · Mar 2026 · Not now", "Karthik R. · Jan 2026 · Keep warm"].map((text, index) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, position: "relative" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent, position: "absolute", left: -16, flexShrink: 0 }} />
            <span style={{ ...body, fontSize: "0.72rem", color: "#8891AA" }}>{text}</span>
          </div>
        ))}
      </div>
      <div style={{ background: "rgba(52,209,122,0.06)", border: "1px solid rgba(52,209,122,0.2)", borderRadius: 8, padding: "8px 12px" }}>
        <div style={{ ...mono, fontSize: "0.58rem", color: accent, marginBottom: 4 }}>↑ Resurfaced</div>
        <div style={{ ...body, fontSize: "0.75rem", color: "#F4F5FA" }}>Priya V. · 96% fit</div>
      </div>
    </div>
  );
}

function FlowCard({ active }: { active: boolean }) {
  const accent = "#F5C842";
  return (
    <div style={cardStyle(active, accent)}>
      <div style={{ ...mono, fontSize: "0.58rem", letterSpacing: "0.12em", color: accent, marginBottom: 14 }}>FLOW</div>
      {[
        { icon: "💬", label: "WhatsApp → Arjun K.", badge: "Delivered", badgeColor: "#34D17A" },
        { icon: "📧", label: "Email → Priya V.", badge: "Opened", badgeColor: "#4B8EF0" },
        { icon: "📅", label: "Interview · Rohit S.", badge: "Tomorrow 3pm", badgeColor: "#F5C842" },
      ].map((row, index) => (
        <div key={index} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <span style={{ fontSize: "0.9rem" }}>{row.icon}</span>
          <span style={{ ...body, fontSize: "0.72rem", color: "#8891AA", flex: 1 }}>{row.label}</span>
          <Badge label={row.badge} color={row.badgeColor} />
        </div>
      ))}
    </div>
  );
}

function AnimatedBeam({ progress, color }: { progress: MotionValue<number>; color: string }) {
  // pathLength normalization → the line draws linearly across the full 0→1
  // progress range (instead of finishing halfway like a fixed dash array does),
  // so it tracks the scroll tightly.
  const dashOffset = useTransform(progress, [0, 1], [1, 0]);
  const dotOpacity = useTransform(progress, [0.8, 1], [0, 1]);
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" fill="none" style={{ flexShrink: 0, alignSelf: "center" }}>
      <motion.path d="M0 30 Q30 30 60 30" stroke={color} strokeWidth="1.5" opacity="0.7" pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: dashOffset }} fill="none" />
      <motion.circle cx="54" cy="30" r="3" fill={color} style={{ opacity: dotOpacity }} />
    </svg>
  );
}

function ActiveCard({ progress, threshold, children }: { progress: MotionValue<number>; threshold: number; children: (active: boolean) => ReactNode }) {
  const [active, setActive] = useState(false);
  useMotionValueEvent(progress, "change", (value) => setActive(value >= threshold));
  return <div style={{ flex: 1 }}>{children(active)}</div>;
}

export default function Platform() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const isMobile = useIsMobile();
  // Tighter window so progress tracks scroll directly and both beams finish
  // while the cards are still comfortably in view (not after scrolling past).
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start 0.85", "center 0.5"] });
  const beam1Progress = useTransform(scrollYProgress, [0.15, 0.45], [0, 1]);
  const beam2Progress = useTransform(scrollYProgress, [0.5, 0.8], [0, 1]);

  return (
    <section ref={sectionRef} style={{ padding: isMobile ? "72px 0" : "120px 0" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", paddingLeft: isMobile ? "1.25rem" : "4rem", paddingRight: isMobile ? "1.25rem" : "4rem" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <span style={{ ...mono, fontSize: "0.62rem", letterSpacing: "0.14em", color: "#4B8EF0", textTransform: "uppercase" }}>One Platform</span>
        </div>

        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }} style={{ fontFamily: "'Outfit', sans-serif", fontSize: "clamp(2.5rem,5vw,4rem)", color: "#F4F5FA", textAlign: "center", lineHeight: 1.15, fontWeight: 400, marginBottom: 16 }}>
          Three layers. <em>One right hire.</em>
        </motion.h2>

        <motion.p initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: 0.15 }} style={{ ...body, fontSize: isMobile ? "0.98rem" : "1rem", color: "#8891AA", fontWeight: 300, maxWidth: 560, margin: `0 auto ${isMobile ? "2rem" : "5rem"}`, lineHeight: 1.75, textAlign: "center" }}>
          Discover, Memory, and Flow work together — so every search, every decision, and every outreach happens in one place.
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.8 }} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: "stretch", gap: isMobile ? 12 : 0 }}>
          <ActiveCard progress={scrollYProgress} threshold={0.1}>{(active) => <DiscoverCard active={active} />}</ActiveCard>
          {!isMobile ? <AnimatedBeam progress={beam1Progress} color="#4B8EF0" /> : null}
          <ActiveCard progress={scrollYProgress} threshold={0.45}>{(active) => <MemoryCard active={active} />}</ActiveCard>
          {!isMobile ? <AnimatedBeam progress={beam2Progress} color="#34D17A" /> : null}
          <ActiveCard progress={scrollYProgress} threshold={0.8}>{(active) => <FlowCard active={active} />}</ActiveCard>
        </motion.div>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.2 }} style={{ fontFamily: "'Outfit', sans-serif", fontStyle: "italic", fontSize: "1.3rem", color: "#8891AA", textAlign: "center", marginTop: "3rem" }}>
          Your system gets smarter with every hire.
        </motion.p>
      </div>
    </section>
  );
}
