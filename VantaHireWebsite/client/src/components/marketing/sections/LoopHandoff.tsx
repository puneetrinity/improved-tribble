import { motion, useReducedMotion } from "framer-motion";
import { Link } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";

const LAYERS = [
  { label: "Discover", color: "#4B8EF0", pos: { top: 0, left: "50%", transform: "translateX(-50%)" } },
  { label: "Memory", color: "#34D17A", pos: { bottom: 34, right: -4 } },
  { label: "Flow", color: "#F5C842", pos: { bottom: 34, left: -4 } },
] as const;

export default function LoopHandoff() {
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();

  return (
    <section style={{ padding: isMobile ? "56px 1.25rem" : "88px 4rem 96px", position: "relative" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? "2.5rem" : "3.5rem" }}>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.62rem", letterSpacing: "0.14em", color: "#34D17A", textTransform: "uppercase", marginBottom: "1rem" }}>
            Delivered as three layers
          </div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2rem,4vw,3rem)", lineHeight: 1.1, color: "#F4F5FA", fontWeight: 400, margin: 0 }}>
            The loop that compounds.
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "300px 1fr", gap: isMobile ? "2.5rem" : "5rem", alignItems: "center" }}>
          <div style={{ position: "relative", width: 280, height: 280, margin: "0 auto" }} role="img" aria-label="Cycle: Discover feeds Memory, Memory sharpens Discover, Flow executes and feeds back">
            <motion.div
              {...(reducedMotion
                ? {}
                : { animate: { rotate: 360 }, transition: { duration: 46, repeat: Infinity, ease: "linear" } })}
              style={{ position: "absolute", inset: 26, border: "1.5px dashed rgba(255,255,255,0.16)", borderRadius: "50%" }}
            />
            <motion.div
              {...(reducedMotion
                ? {}
                : { animate: { rotate: 360 }, transition: { duration: 14, repeat: Infinity, ease: "linear" } })}
              style={{ position: "absolute", inset: 26, borderRadius: "50%", pointerEvents: "none" }}
            >
              <span style={{ position: "absolute", top: -4, left: "50%", marginLeft: -4, width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #4B8EF0, #34D17A)", boxShadow: "0 0 12px rgba(75,142,240,0.8)" }} />
            </motion.div>
            {LAYERS.map((l) => (
              <span
                key={l.label}
                style={{
                  position: "absolute",
                  ...l.pos,
                  padding: "8px 17px",
                  borderRadius: 100,
                  fontFamily: "var(--font-body)",
                  fontSize: "0.85rem",
                  fontWeight: 500,
                  color: l.color,
                  border: `1px solid ${l.color}80`,
                  background: "rgba(17,19,38,0.95)",
                  boxShadow: `0 0 18px ${l.color}22`,
                }}
              >
                {l.label}
              </span>
            ))}
          </div>

          <div>
            <p style={{ fontFamily: "var(--font-body)", fontSize: isMobile ? "1rem" : "1.08rem", color: "#A6ADC3", fontWeight: 300, lineHeight: 1.75, margin: "0 0 1rem" }}>
              Every search feeds <strong style={{ color: "#F4F5FA", fontWeight: 500 }}>Memory</strong>. Every decision sharpens{" "}
              <strong style={{ color: "#F4F5FA", fontWeight: 500 }}>Discover</strong>. Every outreach and interview lives in{" "}
              <strong style={{ color: "#F4F5FA", fontWeight: 500 }}>Flow</strong> — one record, not three tools&apos; worth of exports.
            </p>
            <p style={{ fontFamily: "var(--font-body)", fontSize: isMobile ? "1rem" : "1.08rem", color: "#F4F5FA", fontWeight: 500, lineHeight: 1.75, margin: "0 0 1.75rem" }}>
              Your next hire starts smarter than your last.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {LAYERS.map((l) => (
                <Link
                  key={l.label}
                  href="/features"
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "0.84rem",
                    padding: "9px 19px",
                    borderRadius: 100,
                    border: `1px solid ${l.color}66`,
                    color: l.color,
                    textDecoration: "none",
                    transition: "background 0.2s",
                    cursor: "pointer",
                  }}
                >
                  Explore {l.label} →
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
