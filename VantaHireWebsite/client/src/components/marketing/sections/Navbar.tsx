import { useEffect, useState, type MouseEvent } from "react";
import { motion } from "framer-motion";
import { Link, useLocation } from "wouter";
import logo from "@/assets/vantahire-logo.png";

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
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ opacity: floated ? 0 : 1, y: floated ? -10 : 0 }} transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }} style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 48px", height: 64, background: scrolled ? "rgba(8,10,20,0.6)" : "rgba(8,10,20,0.4)", backdropFilter: "blur(40px) saturate(200%)", WebkitBackdropFilter: "blur(40px) saturate(200%)", borderBottom: scrolled ? "1px solid rgba(255,255,255,0.08)" : "1px solid transparent", pointerEvents: floated ? "none" : "all" }}>
        <Link href="/" className="font-display italic text-xl text-e-text" style={{ textShadow: "0 0 30px rgba(75,142,240,0.4)", letterSpacing: "-0.01em" }}>
          <img src={logo} alt="ealana" style={{ height: 32 }} />
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "2.5rem" }}>
          <Link href="/features" className="font-body text-sm transition-colors duration-200" style={{ color: isActive("/features") ? "#4B8EF0" : undefined }} {...linkProps("/features")}>Features</Link>
          <Link href="/solutions" className="font-body text-sm transition-colors duration-200" style={{ color: isActive("/solutions") ? "#4B8EF0" : undefined }} {...linkProps("/solutions")}>Solutions</Link>
          <a href="#" className="font-body text-sm text-e-text2 hover:text-e-text transition-colors duration-200">Pricing</a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <motion.button whileHover={{ borderColor: "rgba(255,255,255,0.18)", color: "#F4F5FA" }} className="font-body text-xs text-e-text2 rounded-lg border transition-all duration-200" style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(12px) saturate(150%)", WebkitBackdropFilter: "blur(12px) saturate(150%)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)", padding: "8px 16px", cursor: "pointer", borderRadius: 8 }}>Book a demo</motion.button>
          <motion.button whileHover={{ scale: 1.02, boxShadow: "0 4px 30px rgba(75,142,240,0.45)" }} whileTap={{ scale: 0.97 }} className="font-body text-xs text-white font-medium rounded-lg" style={{ background: "#4B8EF0", boxShadow: "0 0 20px rgba(75,142,240,0.3)", padding: "8px 16px", cursor: "pointer" }}>Get Started</motion.button>
        </div>
      </motion.div>

      <motion.div animate={{ opacity: floated ? 1 : 0, y: floated ? 0 : -10 }} transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }} style={{ position: "fixed", top: 16, left: 0, right: 0, zIndex: 100, display: "flex", justifyContent: "center", pointerEvents: floated ? "all" : "none" }}>
        <div style={{ minWidth: 520, height: 48, borderRadius: 100, background: "rgba(255,255,255,0.06)", backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", gap: "2rem" }}>
          <Link href="/" className="font-display italic text-e-text" style={{ fontSize: "1.1rem", textShadow: "0 0 30px rgba(75,142,240,0.4)", letterSpacing: "-0.01em", flexShrink: 0 }}>ealana</Link>
          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <Link href="/features" className="font-body transition-colors duration-200" style={{ fontSize: "0.82rem", color: isActive("/features") ? "#4B8EF0" : "#8891AA" }} {...linkProps("/features")}>Features</Link>
            <Link href="/solutions" className="font-body transition-colors duration-200" style={{ fontSize: "0.82rem", color: isActive("/solutions") ? "#4B8EF0" : "#8891AA" }} {...linkProps("/solutions")}>Solutions</Link>
            <a href="#" className="font-body transition-colors duration-200" style={{ fontSize: "0.82rem", color: "#8891AA" }} onMouseEnter={(event) => { event.currentTarget.style.color = "#F4F5FA"; }} onMouseLeave={(event) => { event.currentTarget.style.color = "#8891AA"; }}>Pricing</a>
          </div>
          <motion.button whileHover={{ scale: 1.02, boxShadow: "0 4px 30px rgba(75,142,240,0.45)" }} whileTap={{ scale: 0.97 }} className="font-body text-white font-medium rounded-lg" style={{ fontSize: "0.8rem", padding: "7px 16px", background: "#4B8EF0", boxShadow: "0 0 20px rgba(75,142,240,0.3)", cursor: "pointer", flexShrink: 0 }}>Get Started</motion.button>
        </div>
      </motion.div>
    </>
  );
}

*** Delete File: D:\Coding\Vantahire Work\improved-tribble\VantaHireWebsite\client\src\pages\Home.tsx
*** Add File: D:\Coding\Vantahire Work\improved-tribble\VantaHireWebsite\client\src\pages\Home.tsx
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import CTA from "@/components/marketing/sections/CTA";
import HowItWorks from "@/components/marketing/sections/HowItWorks";
import HeroSection from "@/components/marketing/sections/HeroSection";
import Platform from "@/components/marketing/sections/Platform";
import ProblemSection from "@/components/marketing/sections/ProblemSection";
import Stats from "@/components/marketing/sections/Stats";
import { Helmet } from "react-helmet-async";

const Home = () => {
  return (
    <>
      <Helmet>
        <title>VantaHire — AI-Native Recruiting Platform | Human Decisions, AI Acceleration</title>
        <meta name="description" content="The AI-native recruiting platform for startups and agencies. AI candidate sourcing, WhatsApp outreach, client portal, and pipeline management. Start free." />
        <link rel="canonical" href="https://vantahire.com/" />
        <meta property="og:title" content="VantaHire — AI-Native Recruiting Platform | Human Decisions, AI Acceleration" />
        <meta property="og:description" content="The AI-native recruiting platform for startups and agencies. AI candidate sourcing, WhatsApp outreach, client portal, and pipeline management. Start free." />
        <meta property="og:url" content="https://vantahire.com/" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://vantahire.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="VantaHire — AI-Native Recruiting Platform | Human Decisions, AI Acceleration" />
        <meta name="twitter:description" content="The AI-native recruiting platform for startups and agencies. AI candidate sourcing, WhatsApp outreach, client portal, and pipeline management. Start free." />
        <meta name="twitter:image" content="https://vantahire.com/twitter-image.jpg" />
      </Helmet>
      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />
          <HeroSection />
          <ProblemSection />
          <HowItWorks />
          <Platform />
          <Stats />
          <CTA />
          <HomepageFooter />
        </div>
      </div>
    </>
  );
};

export default Home;

*** Delete File: D:\Coding\Vantahire Work\improved-tribble\VantaHireWebsite\client\src\pages\features-page.tsx
*** Add File: D:\Coding\Vantahire Work\improved-tribble\VantaHireWebsite\client\src\pages\features-page.tsx
import CTA from "@/components/marketing/sections/CTA";
import DiscoverFeature from "@/components/marketing/sections/DiscoverFeature";
import FlowFeature from "@/components/marketing/sections/FlowFeature";
import MemoryFeature from "@/components/marketing/sections/MemoryFeature";
import GridOverlay from "@/components/GridOverlay";
import HomepageFooter from "@/components/HomepageFooter";
import HomepageNav from "@/components/HomepageNav";
import { motion } from "framer-motion";
import { Helmet } from "react-helmet-async";

const breadcrumbJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://vantahire.com/" },
    { "@type": "ListItem", position: 2, name: "Features", item: "https://vantahire.com/features" },
  ],
});

const words1 = ["Three", "layers."];
const wordVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.09 } } };
const wordItem = {
  hidden: { y: 28, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] } },
};
const pills = [
  { label: "Discover", color: "#4B8EF0" },
  { label: "Memory", color: "#34D17A" },
  { label: "Flow", color: "#F5C842" },
];

export default function FeaturesPage() {
  return (
    <>
      <Helmet>
        <title>Features | VantaHire - Six Pillars of AI-Native Recruiting</title>
        <meta name="description" content="Resume Knowledge Graph, AI Candidate Discovery, WhatsApp + Email Outreach, Client Feedback Portal, Recruiter Dashboard, and Job Command Center. All the capabilities recruiters need." />
        <link rel="canonical" href="https://vantahire.com/features" />
        <meta property="og:title" content="Features | VantaHire - Six Pillars of AI-Native Recruiting" />
        <meta property="og:description" content="Resume Knowledge Graph, AI Discovery, WhatsApp Outreach, Client Portal, Dashboard, and Command Center — every capability recruiters need." />
        <meta property="og:url" content="https://vantahire.com/features" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://vantahire.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Features | VantaHire - Six Pillars of AI-Native Recruiting" />
        <meta name="twitter:description" content="Resume Knowledge Graph, AI Discovery, WhatsApp Outreach, Client Portal, Dashboard, and Command Center." />
        <meta name="twitter:image" content="https://vantahire.com/twitter-image.jpg" />
        <script type="application/ld+json">{breadcrumbJsonLd}</script>
      </Helmet>

      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />
          <section style={{ minHeight: "60vh", padding: "140px 4rem 80px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 700, height: 500, background: "radial-gradient(ellipse, rgba(75,142,240,0.07) 0%, rgba(52,209,122,0.04) 40%, transparent 70%)", filter: "blur(80px)", pointerEvents: "none" }} />
            <div style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center", position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: "1.5rem" }}>
                <div style={{ height: 1, width: 60, background: "#4B8EF0", opacity: 0.2 }} />
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.65rem", color: "#4B8EF0", letterSpacing: "0.14em", textTransform: "uppercase" }}>FEATURES</span>
                <div style={{ height: 1, width: 60, background: "#4B8EF0", opacity: 0.2 }} />
              </div>
              <motion.div variants={wordVariants} initial="hidden" animate="visible" style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", justifyContent: "center", gap: "0.3em", flexWrap: "wrap" }}>
                  {words1.map((word) => (
                    <motion.span key={word} variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: "clamp(3.5rem, 6vw, 5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#F4F5FA" }}>
                      {word}
                    </motion.span>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: "0.3em", flexWrap: "wrap" }}>
                  <motion.span variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: "clamp(3.5rem, 6vw, 5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#F4F5FA" }}>One</motion.span>
                  <motion.span variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: "clamp(3.5rem, 6vw, 5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, fontStyle: "italic", background: "linear-gradient(135deg, #4B8EF0, #34D17A)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>signal.</motion.span>
                </div>
              </motion.div>
              <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.9, ease: [0.25, 0.1, 0.25, 1] }} style={{ fontFamily: "var(--font-body)", fontSize: "1.05rem", color: "#8891AA", fontWeight: 300, maxWidth: 520, margin: "0 auto", lineHeight: 1.75 }}>
                Discover finds the right people. Memory keeps everything your team learns. Flow gets the outreach done.
              </motion.p>
              <motion.div initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 1.1 } } }} style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: "2.5rem", flexWrap: "wrap" }}>
                {pills.map(({ label, color }) => (
                  <motion.div key={label} variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] } } }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 100, border: `1px solid ${color}33`, background: `${color}0f` }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <span style={{ fontFamily: "var(--font-body)", fontSize: "0.85rem", color }}>{label}</span>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </section>
          <DiscoverFeature />
          <div style={{ height: 1, background: "rgba(255,255,255,0.04)", maxWidth: 1100, margin: "0 auto" }} />
          <MemoryFeature />
          <div style={{ height: 1, background: "rgba(255,255,255,0.04)", maxWidth: 1100, margin: "0 auto" }} />
          <FlowFeature />
          <CTA />
          <HomepageFooter />
        </div>
      </div>
    </>
  );
}

*** Delete File: D:\Coding\Vantahire Work\improved-tribble\VantaHireWebsite\client\src\pages\use-cases-page.tsx
*** Add File: D:\Coding\Vantahire Work\improved-tribble\VantaHireWebsite\client\src\pages\use-cases-page.tsx
import CTA from "@/components/marketing/sections/CTA";
import HowItWorks from "@/components/marketing/sections/HowItWorks";
import Platform from "@/components/marketing/sections/Platform";
import GridOverlay from "@/components/GridOverlay";
import HomepageFooter from "@/components/HomepageFooter";
import HomepageNav from "@/components/HomepageNav";
import { motion } from "framer-motion";
import { Helmet } from "react-helmet-async";

const breadcrumbJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://vantahire.com/" },
    { "@type": "ListItem", position: 2, name: "Solutions", item: "https://vantahire.com/solutions" },
  ],
});

const wordVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.09 } } };
const wordItem = {
  hidden: { y: 28, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] } },
};
const line1 = ["Built", "for", "the", "way"];
const line2plain = ["recruiters"];
const line2grad = ["actually", "work."];
const personas = [{ label: "🏢 Recruitment Agencies" }, { label: "👥 Staffing Firms" }, { label: "🏠 In-House Teams" }];

export default function UseCasesPage() {
  return (
    <>
      <Helmet>
        <title>Solutions | VantaHire — Built for Startups, Agencies & HR Teams</title>
        <meta name="description" content="See how startups, recruiting agencies, enterprises, and HR teams use VantaHire to hire faster. AI sourcing, client portal, and pipeline management for every team size." />
        <link rel="canonical" href="https://vantahire.com/solutions" />
        <meta property="og:title" content="Solutions | VantaHire — Built for Startups, Agencies & HR Teams" />
        <meta property="og:description" content="See how startups, recruiting agencies, enterprises, and HR teams use VantaHire to hire faster." />
        <meta property="og:url" content="https://vantahire.com/solutions" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://vantahire.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Solutions | VantaHire — Built for Startups, Agencies & HR Teams" />
        <meta name="twitter:description" content="See how startups, recruiting agencies, enterprises, and HR teams use VantaHire to hire faster." />
        <meta name="twitter:image" content="https://vantahire.com/twitter-image.jpg" />
        <script type="application/ld+json">{breadcrumbJsonLd}</script>
      </Helmet>

      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />
          <section style={{ minHeight: "55vh", padding: "140px 4rem 80px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: "35%", transform: "translateX(-50%)", width: 600, height: 450, background: "radial-gradient(ellipse, rgba(75,142,240,0.07) 0%, transparent 70%)", filter: "blur(80px)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", top: 0, left: "65%", transform: "translateX(-50%)", width: 500, height: 400, background: "radial-gradient(ellipse, rgba(52,209,122,0.05) 0%, transparent 70%)", filter: "blur(80px)", pointerEvents: "none" }} />
            <div style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center", position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: "1.5rem" }}>
                <div style={{ height: 1, width: 60, background: "#4B8EF0", opacity: 0.2 }} />
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.65rem", color: "#4B8EF0", letterSpacing: "0.14em", textTransform: "uppercase" }}>SOLUTIONS</span>
                <div style={{ height: 1, width: 60, background: "#4B8EF0", opacity: 0.2 }} />
              </div>
              <motion.div variants={wordVariants} initial="hidden" animate="visible" style={{ marginBottom: "1.5rem" }}>
                <div style={{ display: "flex", justifyContent: "center", gap: "0.3em", flexWrap: "wrap" }}>
                  {line1.map((word) => (
                    <motion.span key={word} variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: "clamp(3.5rem,6vw,5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#F4F5FA" }}>{word}</motion.span>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: "0.3em", flexWrap: "wrap" }}>
                  {line2plain.map((word) => (
                    <motion.span key={word} variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: "clamp(3.5rem,6vw,5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#F4F5FA" }}>{word}</motion.span>
                  ))}
                  {line2grad.map((word) => (
                    <motion.span key={word} variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: "clamp(3.5rem,6vw,5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, fontStyle: "italic", background: "linear-gradient(135deg, #4B8EF0, #34D17A)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>{word}</motion.span>
                  ))}
                </div>
              </motion.div>
              <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.9, ease: [0.25, 0.1, 0.25, 1] }} style={{ fontFamily: "var(--font-body)", fontSize: "1.05rem", color: "#8891AA", fontWeight: 300, maxWidth: 520, margin: "0 auto", lineHeight: 1.75 }}>
                Whether you run an agency, staff at scale, or hire in-house — ealana adapts to how your team works.
              </motion.p>
              <motion.div initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 1.1 } } }} style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: "2.5rem", flexWrap: "wrap" }}>
                {personas.map(({ label }) => (
                  <motion.div key={label} variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.1, 0.25, 1] } } }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 18px", borderRadius: 100, border: "1px solid rgba(75,142,240,0.2)", background: "rgba(75,142,240,0.06)" }}>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: "0.85rem", color: "#4B8EF0" }}>{label}</span>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          </section>
          <HowItWorks />
          <Platform />
          <CTA />
          <HomepageFooter />
        </div>
      </div>
    </>
  );
}
