import { useEffect, useState, type MouseEvent } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import { trackEvent } from "@/lib/analytics";
import { Menu, X } from "lucide-react";

const linkStyle = {
  fontFamily: '"DM Sans", sans-serif',
  fontSize: "0.875rem",
  color: "#8891AA",
  textDecoration: "none",
  transition: "color 0.2s ease",
} as const;

const pillLinkStyle = {
  ...linkStyle,
  fontSize: "0.82rem",
} as const;

const ghostButtonStyle = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#8891AA",
  borderRadius: 8,
  padding: "8px 18px",
  fontSize: "0.82rem",
  textDecoration: "none",
  fontFamily: '"DM Sans", sans-serif',
  transition: "all 0.2s ease",
} as const;

const primaryButtonStyle = {
  background: "#4B8EF0",
  color: "#FFFFFF",
  borderRadius: 8,
  padding: "8px 18px",
  fontSize: "0.82rem",
  fontWeight: 500,
  textDecoration: "none",
  fontFamily: '"DM Sans", sans-serif',
  boxShadow: "0 0 20px rgba(75,142,240,0.3)",
  transition: "all 0.2s ease",
} as const;

const pillButtonStyle = {
  ...primaryButtonStyle,
  padding: "7px 16px",
  fontSize: "0.8rem",
} as const;

export default function HomepageNav() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [floated, setFloated] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setFloated(window.scrollY > 80);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const handleFeaturesClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (window.location.pathname === "/") {
      e.preventDefault();
      document.getElementById("features")?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <>
      <div className="md:hidden fixed top-0 left-0 right-0 z-[1000]">
        <div
          className="h-16 flex items-center justify-between px-5"
          style={{
            background: "rgba(8,10,20,0.8)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <Link href="/" style={{ textDecoration: "none" }}>
            <span
              style={{
                fontFamily: "Outfit, sans-serif",
                fontStyle: "italic",
                fontSize: "1.2rem",
                color: "#F4F5FA",
                textShadow: "0 0 30px rgba(75,142,240,0.35)",
              }}
            >
              ealana
            </span>
          </Link>

          <button
            className="bg-transparent border-none text-[#F4F5FA] cursor-pointer p-1"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
            data-testid="mobile-menu-button"
          >
            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <div
          className={`${isMenuOpen ? "flex" : "hidden"} flex-col gap-3 px-6 py-4`}
          style={{
            background: "rgba(8,10,20,0.97)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
          data-testid="mobile-nav"
        >
          <a
            href="/#features"
            style={linkStyle}
            onClick={(e) => {
              setIsMenuOpen(false);
              handleFeaturesClick(e);
            }}
          >
            Features
          </a>
          <Link href="/solutions" style={linkStyle} onClick={() => setIsMenuOpen(false)}>
            Solutions
          </Link>
          <Link href="/pricing" style={linkStyle} onClick={() => setIsMenuOpen(false)}>
            Pricing
          </Link>
          <Link href="/jobs" style={linkStyle} onClick={() => setIsMenuOpen(false)}>
            Jobs
          </Link>
          <a
            href="https://cal.com/vantahire/quick-connect"
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...ghostButtonStyle, display: "block", textAlign: "center" }}
            onClick={() => {
              setIsMenuOpen(false);
              trackEvent("cta_click", { location: "site_header_mobile", action: "book_demo" });
            }}
          >
            Book a demo
          </a>
          <a
            href="/recruiter-auth"
            style={{ ...primaryButtonStyle, display: "block", textAlign: "center" }}
            onClick={() => {
              setIsMenuOpen(false);
              trackEvent("cta_click", { location: "site_header_mobile", action: "get_started" });
            }}
          >
            Get Early Access
          </a>
        </div>
      </div>

      <motion.div
        className="hidden md:flex"
        animate={{ opacity: floated ? 0 : 1, y: floated ? -10 : 0 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          height: 64,
          background: "rgba(8,10,20,0.8)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          transition: "all 0.35s ease",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 3rem",
          pointerEvents: floated ? "none" : "all",
        }}
      >
        <Link href="/" style={{ textDecoration: "none" }}>
          <span
            style={{
              fontFamily: "Outfit, sans-serif",
              fontStyle: "italic",
              fontSize: "1.2rem",
              color: "#F4F5FA",
              textShadow: "0 0 30px rgba(75,142,240,0.35)",
            }}
          >
            ealana
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
          <a
            href="/#features"
            style={linkStyle}
            onClick={handleFeaturesClick}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
          >
            Features
          </a>
          <Link
            href="/solutions"
            style={linkStyle}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
          >
            Solutions
          </Link>
          <Link
            href="/pricing"
            style={linkStyle}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
          >
            Pricing
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
          <Link
            href="/jobs"
            style={linkStyle}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
          >
            Jobs
          </Link>
          <a
            href="https://cal.com/vantahire/quick-connect"
            target="_blank"
            rel="noopener noreferrer"
            style={ghostButtonStyle}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
            onClick={() => trackEvent("cta_click", { location: "site_header", action: "book_demo" })}
          >
            Book a demo
          </a>
          <a
            href="/recruiter-auth"
            style={primaryButtonStyle}
            onClick={() => trackEvent("cta_click", { location: "site_header", action: "get_started" })}
          >
            Get Early Access
          </a>
        </div>
      </motion.div>

      <motion.div
        className="hidden md:flex"
        animate={{ opacity: floated ? 1 : 0, y: floated ? 0 : -10 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        style={{
          position: "fixed",
          top: 16,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          zIndex: 1000,
          pointerEvents: floated ? "all" : "none",
        }}
      >
        <div
          style={{
            background: "rgba(255,255,255,0.06)",
            backdropFilter: "blur(40px) saturate(180%)",
            WebkitBackdropFilter: "blur(40px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)",
            borderRadius: 100,
            height: 48,
            minWidth: 520,
            width: "fit-content",
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            gap: "2rem",
          }}
        >
          <Link href="/" style={{ textDecoration: "none", flexShrink: 0 }}>
            <span
              style={{
                fontFamily: "Outfit, sans-serif",
                fontStyle: "italic",
                fontSize: "1.05rem",
                color: "#F4F5FA",
                textShadow: "0 0 30px rgba(75,142,240,0.35)",
              }}
            >
              ealana
            </span>
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <a
              href="/#features"
              style={pillLinkStyle}
              onClick={handleFeaturesClick}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
            >
              Features
            </a>
            <Link
              href="/solutions"
              style={pillLinkStyle}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
            >
              Solutions
            </Link>
            <Link
              href="/pricing"
              style={pillLinkStyle}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
            >
              Pricing
            </Link>
            {location !== "/jobs" ? (
              <Link
                href="/jobs"
                style={pillLinkStyle}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
              >
                Jobs
              </Link>
            ) : null}
          </div>

          <a
            href="/recruiter-auth"
            style={pillButtonStyle}
            onClick={() => trackEvent("cta_click", { location: "site_header_floating", action: "get_started" })}
          >
            Get Early Access
          </a>
        </div>
      </motion.div>
    </>
  );
}
