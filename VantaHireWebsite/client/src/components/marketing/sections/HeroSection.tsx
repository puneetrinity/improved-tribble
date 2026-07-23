// @charset "utf-8"
import { motion } from "framer-motion";
import ealanaMoth from "@/assets/ealana-moth (1).svg";
import { useIsMobile } from "@/hooks/use-mobile";

const words = ["Cut", "the", "noise.", "Find", "the"];

export function HeroSection() {
  const isMobile = useIsMobile();
  const goToLogin = () => {
    window.location.href = "/recruiter-auth";
  };

  const goToHowItWorks = () => {
    if (window.location.pathname === "/") {
      document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    window.location.href = "/#features";
  };

  return (
    <section
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-5 text-center sm:px-6"
      style={{ paddingTop: isMobile ? 92 : 64, paddingBottom: isMobile ? 48 : 24 }}
    >
      <div className="absolute inset-0 pointer-events-none">
        <div
          style={{
            position: "absolute",
            top: "-15%",
            left: "-10%",
            width: 700,
            height: 600,
            background: "radial-gradient(circle, rgba(27,54,130,0.32) 0%, transparent 65%)",
            filter: "blur(80px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "5%",
            right: "-10%",
            width: 500,
            height: 500,
            background: "radial-gradient(circle, rgba(18,72,46,0.26) 0%, transparent 65%)",
            filter: "blur(80px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.25, 0.1, 0.25, 1] }}
        className="relative z-10 mb-8"
      >
        <div style={{ position: "relative", width: isMobile ? 82 : 110, height: isMobile ? 90 : 121 }}>
          <div
            style={{
              position: "absolute",
              inset: -44,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(75,142,240,0.18) 0%, rgba(52,209,122,0.08) 40%, transparent 70%)",
              filter: "blur(33px)",
              pointerEvents: "none",
            }}
          />
          <motion.img
            src={ealanaMoth}
            alt="ealana moth"
            style={{ position: "relative", zIndex: 1, width: isMobile ? 82 : 110, height: isMobile ? 90 : 121 }}
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </motion.div>

      <motion.h1
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.09, delayChildren: 0.35 } } }}
        className="relative z-10 mb-5 mt-0 flex max-w-[18rem] flex-wrap justify-center gap-x-[0.25em] font-normal sm:mb-6 sm:max-w-none"
        style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: isMobile ? "clamp(2.45rem, 12vw, 3.25rem)" : "clamp(3.2rem, 6.5vw, 5.8rem)",
          lineHeight: 1.08,
          letterSpacing: "-0.025em",
          color: "#F4F5FA",
        }}
      >
        {words.map((word) => (
          <motion.span
            key={word}
            variants={{
              hidden: { y: 30, opacity: 0 },
              visible: {
                y: 0,
                opacity: 1,
                transition: { duration: 0.65, ease: [0.25, 0.1, 0.25, 1] },
              },
            }}
          >
            {word}
          </motion.span>
        ))}
        <motion.span
          variants={{
            hidden: { y: 30, opacity: 0 },
            visible: {
              y: 0,
              opacity: 1,
              transition: { duration: 0.65, ease: [0.25, 0.1, 0.25, 1] },
            },
          }}
          style={{
            fontStyle: "italic",
            background: "linear-gradient(135deg, #4B8EF0 0%, #34D17A 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
            display: "inline-block",
            lineHeight: 1.15,
            paddingBottom: "0.12em",
          }}
        >
          signal.
        </motion.span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.0 }}
        className="relative z-10 mb-8 max-w-xl font-body leading-relaxed text-e-text2"
        style={{ fontSize: isMobile ? "0.98rem" : "1.05rem", fontWeight: 300 }}
      >
        <span className="block">
          From{" "}
          <span className="relative inline-block">
            talent intelligence
            <motion.span
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 1.6, ease: "easeOut" }}
              className="absolute left-0 top-1/2 h-[2px] w-full origin-left bg-current opacity-80"
              aria-hidden="true"
            />
          </span>{" "}
          to{" "}
          <motion.strong
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, delay: 2.05 }}
            className="font-semibold text-e-text"
          >
            decision intelligence
          </motion.strong>{" "}
          — the Neural OS for Talent.
        </span>
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.15 }}
        className="relative z-10 mb-6 flex w-full max-w-sm flex-col items-stretch gap-3 sm:max-w-none sm:flex-row sm:items-center sm:justify-center"
      >
        <motion.button
          whileHover={{ scale: 1.03, boxShadow: "0 8px 40px rgba(75,142,240,0.5)" }}
          whileTap={{ scale: 0.97 }}
          className="font-body rounded-xl px-7 py-3 text-sm font-medium text-white sm:w-auto"
          style={{ background: "#4B8EF0", boxShadow: "0 0 28px rgba(75,142,240,0.35)" }}
          onClick={goToLogin}
        >
          Get Started -&gt;
        </motion.button>
        <motion.button
          whileHover={{ borderColor: "rgba(255,255,255,0.18)", color: "#F4F5FA" }}
          className="font-body rounded-xl px-6 py-3 text-sm text-e-text2 transition-all duration-200 sm:w-auto"
          style={{
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(12px) saturate(150%)",
            WebkitBackdropFilter: "blur(12px) saturate(150%)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
          }}
          onClick={goToHowItWorks}
        >
          See how it works
        </motion.button>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4 }}
        className="relative z-10 font-body text-e-text3"
        style={{ fontSize: "0.75rem" }}
      >
        Free to start - No credit card - Made in India
      </motion.p>
    </section>
  );
}

export default HeroSection;
