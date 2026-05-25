// @charset "utf-8"
import { motion } from "framer-motion";

interface MothSVGProps {
  size?: number;
}

const MothSVG = ({ size = 90 }: MothSVGProps) => (
  <motion.div style={{ position: "relative", width: size, height: size * 1.1, margin: "0 auto 2rem" }} animate={{ y: [0, -10, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
    <div style={{ position: "absolute", inset: -50, borderRadius: "50%", background: "radial-gradient(circle, rgba(75,142,240,0.18) 0%, rgba(52,209,122,0.08) 40%, transparent 70%)", filter: "blur(50px)", pointerEvents: "none" }} />
    <svg width={size} height={size * 1.1} viewBox="0 0 120 132" fill="none">
      <motion.path d="M60 52 C50 28,18 18,8 38 C0 54,18 72,60 70 Z" fill="#4B8EF0" opacity={0.95} animate={{ scaleX: [1, 0.87, 1] }} transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }} style={{ transformOrigin: "right center" }} />
      <motion.path d="M60 70 C38 76,16 85,20 98 C24 108,46 100,60 86 Z" fill="#4B8EF0" opacity={0.5} animate={{ scaleX: [1, 0.84, 1] }} transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: 0.1 }} style={{ transformOrigin: "right center" }} />
      <motion.path d="M60 52 C70 28,102 18,112 38 C120 54,102 72,60 70 Z" fill="#34D17A" opacity={0.95} animate={{ scaleX: [1, 0.87, 1] }} transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: 0.15 }} style={{ transformOrigin: "left center" }} />
      <motion.path d="M60 70 C82 76,104 85,100 98 C96 108,74 100,60 86 Z" fill="#34D17A" opacity={0.5} animate={{ scaleX: [1, 0.84, 1] }} transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: 0.25 }} style={{ transformOrigin: "left center" }} />
      <ellipse cx="60" cy="68" rx="4" ry="20" fill="#0D0F1E" />
      <circle cx="60" cy="60" r="4.5" fill="#F5C842" />
      <circle cx="60" cy="60" r="2" fill="rgba(255,255,255,0.5)" />
      <path d="M58 50 C55 38,46 30,40 22" stroke="#3D4460" strokeWidth="1" strokeLinecap="round" fill="none" />
      <path d="M62 50 C65 38,74 30,80 22" stroke="#3D4460" strokeWidth="1" strokeLinecap="round" fill="none" />
      <circle cx="40" cy="22" r="2" fill="#3D4460" />
      <circle cx="80" cy="22" r="2" fill="#3D4460" />
    </svg>
  </motion.div>
);

export default function CTA() {
  return (
    <section style={{ padding: "140px 4rem", textAlign: "center", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 900, height: 700, top: "50%", left: "50%", transform: "translate(-50%, -50%)", background: "radial-gradient(ellipse, rgba(75,142,240,0.07) 0%, rgba(52,209,122,0.04) 45%, transparent 70%)", filter: "blur(80px)", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <MothSVG size={90} />
        <motion.h2 initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }} style={{ fontFamily: "'Outfit', sans-serif", fontSize: "clamp(3.5rem, 6vw, 5.5rem)", color: "#F4F5FA", letterSpacing: "-0.025em", marginBottom: "1.25rem", fontWeight: 400 }}>
          That&apos;s ealana.
        </motion.h2>
        <motion.p initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.15 }} style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "1.05rem", color: "#8891AA", fontWeight: 300, maxWidth: 460, margin: "0 auto 2.5rem", lineHeight: 1.75 }}>
          If this sounds like the way recruiting should work, we&apos;d love to show you around.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.3 }}>
          <motion.button whileHover={{ scale: 1.04, boxShadow: "0 8px 60px rgba(75,142,240,0.55)" }} whileTap={{ scale: 0.97 }} style={{ background: "#4B8EF0", color: "white", padding: "14px 36px", borderRadius: 10, fontFamily: "'DM Sans', sans-serif", fontSize: "0.95rem", fontWeight: 500, border: "none", cursor: "pointer", boxShadow: "0 0 40px rgba(75,142,240,0.35)" }}>
            Get Started →
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
