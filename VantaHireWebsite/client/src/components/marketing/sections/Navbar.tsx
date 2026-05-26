import { useEffect, useState, type MouseEvent } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import logo from "@/assets/ealana_logo.svg";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [floated, setFloated] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const fn = () => {
      setScrolled(window.scrollY > 20);
      setFloated(window.scrollY > 80);
    };

    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const isActive = (path: string) => location === path;

  const linkProps = (path: string) => ({
    onMouseEnter: (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isActive(path)) event.currentTarget.style.color = "#F4F5FA";
    },
    onMouseLeave: (event: MouseEvent<HTMLAnchorElement>) => {
      if (!isActive(path)) event.currentTarget.style.color = "";
    },
  });

  return (
    <>
      <motion.div
        initial={{ y: -20, opacity: 0 }}
        animate={{ opacity: floated ? 0 : 1, y: floated ? -10 : 0 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 48px",
          height: 64,
          background: scrolled ? "rgba(8,10,20,0.6)" : "rgba(8,10,20,0.4)",
          backdropFilter: "blur(40px) saturate(200%)",
          WebkitBackdropFilter: "blur(40px) saturate(200%)",
          borderBottom: scrolled ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent",
          pointerEvents: floated ? "none" : "all",
        }}
      >
        <Link
          href="/"
          className="text-e-text"
          style={{ display: "flex", alignItems: "center" }}
        >
          <img src={logo} alt="ealana" style={{ height: 32 }} />
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "2.5rem" }}>
          <Link
            href="/features"
            className="font-body text-sm transition-colors duration-200"
            style={{ color: isActive("/features") ? "#4B8EF0" : undefined }}
            {...linkProps("/features")}
          >
            Features
          </Link>
          <Link
            href="/solutions"
            className="font-body text-sm transition-colors duration-200"
            style={{ color: isActive("/solutions") ? "#4B8EF0" : undefined }}
            {...linkProps("/solutions")}
          >
            Solutions
          </Link>
          <a href="#" className="font-body text-sm text-e-text2 hover:text-e-text transition-colors duration-200">
            Pricing
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <motion.button
            whileHover={{ borderColor: "rgba(255,255,255,0.18)", color: "#F4F5FA" }}
            className="font-body text-xs text-e-text2 rounded-lg border transition-all duration-200"
            style={{
              background: "rgba(255,255,255,0.06)",
              backdropFilter: "blur(12px) saturate(150%)",
              WebkitBackdropFilter: "blur(12px) saturate(150%)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
              padding: "8px 16px",
              cursor: "pointer",
              borderRadius: 8,
            }}
          >
            Book a demo
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: "0 4px 30px rgba(75,142,240,0.45)" }}
            whileTap={{ scale: 0.97 }}
            className="font-body text-xs text-white font-medium rounded-lg"
            style={{
              background: "#4B8EF0",
              boxShadow: "0 0 20px rgba(75,142,240,0.3)",
              padding: "8px 16px",
              cursor: "pointer",
            }}
          >
            Get Started
          </motion.button>
        </div>
      </motion.div>

      <motion.div
        animate={{ opacity: floated ? 1 : 0, y: floated ? 0 : -10 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        style={{
          position: "fixed",
          top: 16,
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          justifyContent: "center",
          pointerEvents: floated ? "all" : "none",
        }}
      >
        <div
          style={{
            minWidth: 520,
            height: 48,
            borderRadius: 100,
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(40px) saturate(180%)",
            WebkitBackdropFilter: "blur(40px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(255,255,255,0.05)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px",
            gap: "2rem",
          }}
        >
          <Link
            href="/"
            className="font-display italic text-e-text"
            style={{ fontSize: "1.1rem", textShadow: "0 0 30px rgba(75,142,240,0.4)", letterSpacing: "-0.01em", flexShrink: 0 }}
          >
            ealana
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <Link
              href="/features"
              className="font-body transition-colors duration-200"
              style={{ fontSize: "0.82rem", color: isActive("/features") ? "#4B8EF0" : "#8891AA" }}
              {...linkProps("/features")}
            >
              Features
            </Link>
            <Link
              href="/solutions"
              className="font-body transition-colors duration-200"
              style={{ fontSize: "0.82rem", color: isActive("/solutions") ? "#4B8EF0" : "#8891AA" }}
              {...linkProps("/solutions")}
            >
              Solutions
            </Link>
            <a
              href="#"
              className="font-body transition-colors duration-200"
              style={{ fontSize: "0.82rem", color: "#8891AA" }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = "#F4F5FA";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = "#8891AA";
              }}
            >
              Pricing
            </a>
          </div>
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: "0 4px 30px rgba(75,142,240,0.45)" }}
            whileTap={{ scale: 0.97 }}
            className="font-body text-white font-medium rounded-lg"
            style={{
              fontSize: "0.8rem",
              padding: "7px 16px",
              background: "#4B8EF0",
              boxShadow: "0 0 20px rgba(75,142,240,0.3)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            Get Started
          </motion.button>
        </div>
      </motion.div>
    </>
  );
}
