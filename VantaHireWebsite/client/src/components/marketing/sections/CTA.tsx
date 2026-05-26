// @charset "utf-8"
import { motion } from "framer-motion";
import ealanaMoth from "@/assets/ealana-moth (1).svg";

export default function CTA() {
  return (
    <section style={{ padding: "140px 4rem", textAlign: "center", position: "relative", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 700,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "radial-gradient(ellipse, rgba(75,142,240,0.07) 0%, rgba(52,209,122,0.04) 45%, transparent 70%)",
          filter: "blur(80px)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>
        <motion.div
          style={{ position: "relative", width: 90, height: 99, margin: "0 auto 2rem" }}
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        >
          <div
            style={{
              position: "absolute",
              inset: -50,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(75,142,240,0.18) 0%, rgba(52,209,122,0.08) 40%, transparent 70%)",
              filter: "blur(50px)",
              pointerEvents: "none",
            }}
          />
          <img
            src={ealanaMoth}
            alt="ealana moth"
            style={{ position: "relative", zIndex: 1, width: 90, height: 99 }}
          />
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: "clamp(3.5rem, 6vw, 5.5rem)",
            color: "#F4F5FA",
            letterSpacing: "-0.025em",
            marginBottom: "1.25rem",
            fontWeight: 400,
          }}
        >
          That&apos;s ealana.
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.15 }}
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: "1.05rem",
            color: "#8891AA",
            fontWeight: 300,
            maxWidth: 460,
            margin: "0 auto 2.5rem",
            lineHeight: 1.75,
          }}
        >
          If this sounds like the way recruiting should work, we&apos;d love to show you around.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.3 }}
        >
          <motion.button
            whileHover={{ scale: 1.04, boxShadow: "0 8px 60px rgba(75,142,240,0.55)" }}
            whileTap={{ scale: 0.97 }}
            style={{
              background: "#4B8EF0",
              color: "white",
              padding: "14px 36px",
              borderRadius: 10,
              fontFamily: "'DM Sans', sans-serif",
              fontSize: "0.95rem",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
              boxShadow: "0 0 40px rgba(75,142,240,0.35)",
            }}
          >
            Get Started →
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
}
