import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import { trackEvent } from "@/lib/analytics";
import { Menu, X } from "lucide-react";
import ealanaMoth from "@/assets/ealana-moth (1).svg";
import { useAuth } from "@/hooks/use-auth";

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

function BrandMark({ compact = false, showWord = true }: { compact?: boolean; showWord?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: compact ? "0.55rem" : "0.7rem" }}>
      <span
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: compact ? 34 : 38,
          height: compact ? 34 : 38,
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
          background:
            "radial-gradient(circle at 30% 30%, rgba(75,142,240,0.24), transparent 58%), radial-gradient(circle at 70% 70%, rgba(52,209,122,0.18), transparent 62%), rgba(255,255,255,0.03)",
          boxShadow: "0 0 32px rgba(75,142,240,0.14)",
        }}
      >
        <motion.img
          src={ealanaMoth}
          alt="ealana moth"
          style={{ width: compact ? 21 : 24, height: compact ? 21 : 24, position: "relative", zIndex: 1 }}
          animate={{ y: [0, -1.5, 0], rotate: [0, -2, 2, 0] }}
          transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
        />
      </span>
      {showWord ? (
        <span
          style={{
            fontFamily: "Outfit, sans-serif",
            fontSize: compact ? "1.02rem" : "1.08rem",
            fontWeight: 600,
            letterSpacing: "-0.03em",
            color: "#F4F5FA",
            textShadow: "0 0 24px rgba(75,142,240,0.18)",
          }}
        >
          ealana
        </span>
      ) : null}
    </span>
  );
}

export type HomepageNavAudience = "public" | "candidate";

export default function HomepageNav({
  audience = "public",
}: {
  audience?: HomepageNavAudience;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [floated, setFloated] = useState(false);
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();
  const candidateAudience = audience === "candidate";
  const authenticatedCandidate =
    candidateAudience && user?.role === "candidate";

  useEffect(() => {
    const handleScroll = () => {
      setFloated(window.scrollY > 80);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMenuOpen]);

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-[1000] md:hidden">
        <div
          className="flex h-16 items-center justify-between px-4 sm:px-5"
          style={{
            background: "rgba(8,10,20,0.8)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <Link href="/" style={{ textDecoration: "none" }}>
            <BrandMark showWord={false} />
          </Link>

          <button
            className="rounded-full border border-white/10 bg-white/[0.03] p-2 text-[#F4F5FA] shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
            data-testid="mobile-menu-button"
          >
            {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <div
          className={`${isMenuOpen ? "flex" : "hidden"} min-h-[calc(100svh-4rem)] flex-col gap-4 overflow-y-auto px-4 py-5`}
          style={{
            background: "linear-gradient(180deg, rgba(8,10,20,0.98) 0%, rgba(11,14,28,0.98) 100%)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
          data-testid="mobile-nav"
        >
          <div className="rounded-[28px] border border-white/8 bg-white/[0.03] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.25)]">
            <div className="mb-3 px-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[#4B8EF0]">
              Explore
            </div>
            <div className="flex flex-col gap-2">
              {!candidateAudience ? (
                <>
                  <Link
                    href="/features"
                    className="rounded-xl border border-transparent bg-white/[0.02] px-4 py-3 text-[0.875rem] font-medium text-[#F4F5FA] no-underline transition-colors hover:border-white/12 hover:bg-white/[0.05]"
                    style={{ fontFamily: '"DM Sans", sans-serif' }}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Features
                  </Link>
                  <Link href="/solutions" className="rounded-xl border border-transparent bg-white/[0.02] px-4 py-3 text-[0.875rem] font-medium text-[#F4F5FA] no-underline transition-colors hover:border-white/12 hover:bg-white/[0.05]" style={{ fontFamily: '"DM Sans", sans-serif' }} onClick={() => setIsMenuOpen(false)}>
                    Solutions
                  </Link>
                  <Link href="/pricing" className="rounded-xl border border-transparent bg-white/[0.02] px-4 py-3 text-[0.875rem] font-medium text-[#F4F5FA] no-underline transition-colors hover:border-white/12 hover:bg-white/[0.05]" style={{ fontFamily: '"DM Sans", sans-serif' }} onClick={() => setIsMenuOpen(false)}>
                    Pricing
                  </Link>
                </>
              ) : null}
              <Link href="/jobs" className="rounded-xl border border-transparent bg-white/[0.02] px-4 py-3 text-[0.875rem] font-medium text-[#F4F5FA] no-underline transition-colors hover:border-white/12 hover:bg-white/[0.05]" style={{ fontFamily: '"DM Sans", sans-serif' }} onClick={() => setIsMenuOpen(false)}>
                Jobs
              </Link>
              {authenticatedCandidate ? (
                <Link href="/my-dashboard" className="rounded-xl border border-transparent bg-white/[0.02] px-4 py-3 text-[0.875rem] font-medium text-[#F4F5FA] no-underline transition-colors hover:border-white/12 hover:bg-white/[0.05]" style={{ fontFamily: '"DM Sans", sans-serif' }} onClick={() => setIsMenuOpen(false)}>
                  Dashboard
                </Link>
              ) : null}
            </div>
          </div>

          {!candidateAudience ? (
            <div className="mt-auto rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(75,142,240,0.10)_0%,rgba(255,255,255,0.03)_100%)] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
              <div className="mb-3 px-2 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-[#8891AA]">
                Start Here
              </div>
              <a
                href="https://cal.com/ealana/quick-connect"
                target="_blank"
                rel="noopener noreferrer"
                className="mb-2 block rounded-lg border border-white/12 bg-white/[0.04] px-4 py-[9px] text-center text-[0.82rem] font-medium text-[#F4F5FA] no-underline transition-colors hover:bg-white/[0.07]"
                style={{ fontFamily: '"DM Sans", sans-serif' }}
                onClick={() => {
                  setIsMenuOpen(false);
                  trackEvent("cta_click", { location: "site_header_mobile", action: "book_demo" });
                }}
              >
                Book a demo
              </a>
              <a
                href="/recruiter-auth"
                className="block rounded-lg bg-[#4B8EF0] px-4 py-[9px] text-center text-[0.82rem] font-medium text-white no-underline shadow-[0_12px_30px_rgba(75,142,240,0.28)] transition-transform hover:translate-y-[-1px]"
                style={{ fontFamily: '"DM Sans", sans-serif' }}
                onClick={() => {
                  setIsMenuOpen(false);
                  trackEvent("cta_click", { location: "site_header_mobile", action: "get_started" });
                }}
              >
                Get Started {"->"}
              </a>
            </div>
          ) : authenticatedCandidate ? (
            <button
              type="button"
              className="mt-auto rounded-lg border border-white/12 bg-white/[0.04] px-4 py-[9px] text-center text-[0.82rem] font-medium text-[#F4F5FA] transition-colors hover:bg-white/[0.07]"
              style={{ fontFamily: '"DM Sans", sans-serif' }}
              onClick={() => {
                setIsMenuOpen(false);
                logoutMutation.mutate();
              }}
              disabled={logoutMutation.isPending}
            >
              {logoutMutation.isPending ? "Signing out..." : "Logout"}
            </button>
          ) : null}
        </div>
      </div>

      <motion.div
        className="hidden max-md:hidden md:flex"
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
          <BrandMark />
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
          {!candidateAudience ? (
            <>
              <Link
                href="/features"
                style={linkStyle}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
              >
                Features
              </Link>
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
            </>
          ) : null}
          <Link
            href="/jobs"
            style={linkStyle}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
          >
            Jobs
          </Link>
          {authenticatedCandidate ? (
            <Link
              href="/my-dashboard"
              style={linkStyle}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
            >
              Dashboard
            </Link>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
          {!candidateAudience ? (
            <>
              <a
                href="https://cal.com/ealana/quick-connect"
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
                Get Started {"->"}
              </a>
            </>
          ) : authenticatedCandidate ? (
            <button
              type="button"
              style={{ ...ghostButtonStyle, cursor: "pointer" }}
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              {logoutMutation.isPending ? "Signing out..." : "Logout"}
            </button>
          ) : null}
        </div>
      </motion.div>

      <motion.div
        className="hidden max-md:hidden md:flex"
        animate={{ opacity: floated ? 1 : 0, y: floated ? 0 : -10 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
        style={{
          position: "fixed",
          top: 16,
          left: 0,
          right: 0,
          justifyContent: "center",
          zIndex: 1000,
          pointerEvents: floated ? "all" : "none",
        }}
      >
        <div
          style={{
            background: "rgba(8,10,20,0.72)",
            backdropFilter: "blur(40px) saturate(180%)",
            WebkitBackdropFilter: "blur(40px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.12)",
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
            <BrandMark compact />
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            {!candidateAudience ? (
              <>
                <Link
                  href="/features"
                  style={pillLinkStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
                >
                  Features
                </Link>
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
              </>
            ) : authenticatedCandidate ? (
              <Link
                href="/my-dashboard"
                style={pillLinkStyle}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#F4F5FA")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "#8891AA")}
              >
                Dashboard
              </Link>
            ) : null}
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

          {!candidateAudience ? (
            <a
              href="/recruiter-auth"
              style={pillButtonStyle}
              onClick={() => trackEvent("cta_click", { location: "site_header_floating", action: "get_started" })}
            >
              Get Started {"->"}
            </a>
          ) : authenticatedCandidate ? (
            <button
              type="button"
              style={{ ...pillButtonStyle, border: 0, cursor: "pointer" }}
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              {logoutMutation.isPending ? "Signing out..." : "Logout"}
            </button>
          ) : null}
        </div>
      </motion.div>
    </>
  );
}
