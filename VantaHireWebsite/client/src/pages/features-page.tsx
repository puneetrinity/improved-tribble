import CTA from "@/components/marketing/sections/CTA";
import DiscoverFeature from "@/components/marketing/sections/DiscoverFeature";
import FlowFeature from "@/components/marketing/sections/FlowFeature";
import MemoryFeature from "@/components/marketing/sections/MemoryFeature";
import GridOverlay from "@/components/GridOverlay";
import HomepageFooter from "@/components/HomepageFooter";
import HomepageNav from "@/components/HomepageNav";
import { motion } from "framer-motion";
import { Helmet } from "react-helmet-async";
import { useIsMobile } from "@/hooks/use-mobile";

const breadcrumbJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://ealana.com/" },
    { "@type": "ListItem", position: 2, name: "Features", item: "https://ealana.com/features" },
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
  const isMobile = useIsMobile();
  return (
    <>
      <Helmet>
        <title>Features | ealana - Six Pillars of AI-Native Recruiting</title>
        <meta name="description" content="Resume Knowledge Graph, AI Candidate Discovery, WhatsApp + Email Outreach, Client Feedback Portal, Recruiter Dashboard, and Job Command Center. All the capabilities recruiters need." />
        <link rel="canonical" href="https://ealana.com/features" />
        <meta property="og:title" content="Features | ealana - Six Pillars of AI-Native Recruiting" />
        <meta property="og:description" content="Resume Knowledge Graph, AI Discovery, WhatsApp Outreach, Client Portal, Dashboard, and Command Center - every capability recruiters need." />
        <meta property="og:url" content="https://ealana.com/features" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://ealana.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Features | ealana - Six Pillars of AI-Native Recruiting" />
        <meta name="twitter:description" content="Resume Knowledge Graph, AI Discovery, WhatsApp Outreach, Client Portal, Dashboard, and Command Center." />
        <meta name="twitter:image" content="https://ealana.com/twitter-image.jpg" />
        <script type="application/ld+json">{breadcrumbJsonLd}</script>
      </Helmet>

      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />
          <section style={{ minHeight: "60vh", padding: isMobile ? "96px 1.25rem 56px" : "140px 4rem 80px", position: "relative", overflow: "hidden" }}>
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
                    <motion.span key={word} variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: isMobile ? "clamp(2.5rem, 12vw, 3.3rem)" : "clamp(3.5rem, 6vw, 5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#F4F5FA" }}>
                      {word}
                    </motion.span>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: "0.3em", flexWrap: "wrap" }}>
                  <motion.span variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: isMobile ? "clamp(2.5rem, 12vw, 3.3rem)" : "clamp(3.5rem, 6vw, 5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#F4F5FA" }}>
                    One
                  </motion.span>
                  <motion.span variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: isMobile ? "clamp(2.5rem, 12vw, 3.3rem)" : "clamp(3.5rem, 6vw, 5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, fontStyle: "italic", background: "linear-gradient(135deg, #4B8EF0, #34D17A)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                    signal.
                  </motion.span>
                </div>
              </motion.div>
              <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.9, ease: [0.25, 0.1, 0.25, 1] }} style={{ fontFamily: "var(--font-body)", fontSize: isMobile ? "0.98rem" : "1.05rem", color: "#8891AA", fontWeight: 300, maxWidth: 520, margin: "0 auto", lineHeight: 1.75 }}>
                Discover finds the right people. Memory keeps everything your team learns. Flow gets the outreach done.
              </motion.p>
              <motion.div initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 1.1 } } }} style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: isMobile ? "1.75rem" : "2.5rem", flexWrap: "wrap" }}>
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
