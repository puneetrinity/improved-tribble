import { motion } from "framer-motion";
import { trackEvent } from "@/lib/analytics";

const pills = [
  { label: "Agencies" },
  { label: "Staffing" },
  { label: "In-House" },
];

export default function SolutionsCTA() {
  return (
    <section style={{ padding: "120px 4rem", textAlign: "center", position: "relative", overflow: "hidden", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ position: "absolute", top: "50%", left: "30%", width: 500, height: 400, background: "radial-gradient(ellipse, rgba(75,142,240,0.07) 0%, transparent 70%)", filter: "blur(80px)", pointerEvents: "none", transform: "translate(-50%,-50%)" }} />
      <div style={{ position: "absolute", top: "50%", right: "20%", width: 400, height: 300, background: "radial-gradient(ellipse, rgba(52,209,122,0.05) 0%, transparent 70%)", filter: "blur(80px)", pointerEvents: "none", transform: "translateY(-50%)" }} />

      <div style={{ position: "relative" }}>
        <motion.div
          initial={{ y: 24 }}
          whileInView={{ y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ marginBottom: "1.25rem" }}
        >
          <div style={{ fontFamily: "var(--font-display)", fontSize: "clamp(3rem,5.5vw,5rem)", letterSpacing: "-0.025em", color: "#F4F5FA", lineHeight: 1.1 }}>
            Your team. Your workflow.
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "clamp(3rem,5.5vw,5rem)", letterSpacing: "-0.025em", lineHeight: 1.1, fontStyle: "italic", background: "linear-gradient(135deg, #4B8EF0, #34D17A)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            One platform.
          </div>
        </motion.div>

        <motion.p
          initial={{ y: 16 }}
          whileInView={{ y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ fontFamily: "var(--font-body)", fontSize: "1.05rem", color: "#8891AA", fontWeight: 300, maxWidth: 460, margin: "0 auto 2.5rem", lineHeight: 1.75 }}
        >
          ealana adapts to how your team recruits - agency, staffing, or in-house. Same platform. Different superpower.
        </motion.p>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } } }}
          style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: "2.5rem", flexWrap: "wrap" }}
        >
          {pills.map(({ label }) => (
            <motion.div
              key={label}
              variants={{ hidden: { y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5 } } }}
              style={{ display: "flex", alignItems: "center", padding: "8px 18px", borderRadius: 100, border: "1px solid rgba(75,142,240,0.2)", background: "rgba(75,142,240,0.06)" }}
            >
              <span style={{ fontFamily: "var(--font-body)", fontSize: "0.85rem", color: "#4B8EF0" }}>{label}</span>
            </motion.div>
          ))}
        </motion.div>

        <motion.div
          initial={{ y: 12 }}
          whileInView={{ y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
          style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}
        >
          <motion.a
            href="/recruiter-auth"
            whileHover={{ scale: 1.03, boxShadow: "0 0 60px rgba(75,142,240,0.5)" }}
            whileTap={{ scale: 0.97 }}
            style={{ background: "#4B8EF0", color: "white", border: "none", padding: "14px 36px", borderRadius: 10, fontFamily: "var(--font-body)", fontSize: "0.95rem", fontWeight: 500, boxShadow: "0 0 40px rgba(75,142,240,0.35)", cursor: "pointer", textDecoration: "none" }}
            onClick={() => trackEvent("cta_click", { location: "solutions_cta", action: "get_started" })}
          >
            Get Started -&gt;
          </motion.a>
          <motion.a
            href="https://cal.com/ealana/quick-connect"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ borderColor: "rgba(255,255,255,0.2)", color: "#F4F5FA" }}
            style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(12px) saturate(150%)", WebkitBackdropFilter: "blur(12px) saturate(150%)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)", color: "#8891AA", padding: "14px 28px", borderRadius: 10, fontFamily: "var(--font-body)", fontSize: "0.95rem", cursor: "pointer", transition: "all 0.2s", textDecoration: "none" }}
            onClick={() => trackEvent("cta_click", { location: "solutions_cta", action: "book_demo" })}
          >
            Book a demo
          </motion.a>
        </motion.div>

        <div style={{ marginTop: "1.5rem", fontFamily: "var(--font-body)", fontSize: "0.75rem", color: "#3D4460" }}>
          Free to start - No credit card - Made in India
        </div>
      </div>
    </section>
  );
}
