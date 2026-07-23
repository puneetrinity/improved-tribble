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

const words1 = ["Decision", "intelligence"];
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
        <title>Features | ealana — Decision Intelligence for Recruiting</title>
        <meta name="description" content="ealana turns recruiting into decision intelligence: Discover ranks candidates by real fit, Memory compounds what your team learns, and Flow runs the outreach." />
        <link rel="canonical" href="https://ealana.com/features" />
        <meta property="og:title" content="Features | ealana — Decision Intelligence for Recruiting" />
        <meta property="og:description" content="ealana turns recruiting into decision intelligence: Discover ranks candidates by real fit, Memory compounds what your team learns, and Flow runs the outreach." />
        <meta property="og:url" content="https://ealana.com/features" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://ealana.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Features | ealana — Decision Intelligence for Recruiting" />
        <meta name="twitter:description" content="ealana turns recruiting into decision intelligence: Discover ranks candidates by real fit, Memory compounds what your team learns, and Flow runs the outreach." />
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
              <motion.h1 variants={wordVariants} initial="hidden" animate="visible" style={{ marginTop: 0, marginBottom: "1.5rem" }}>
                <span style={{ display: "flex", justifyContent: "center", gap: "0.3em", flexWrap: "wrap" }}>
                  {words1.map((word) => (
                    <motion.span key={word} variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: isMobile ? "clamp(2.5rem, 12vw, 3.3rem)" : "clamp(3.5rem, 6vw, 5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#F4F5FA" }}>
                      {word}
                    </motion.span>
                  ))}
                </span>
                <span style={{ display: "flex", justifyContent: "center", gap: "0.3em", flexWrap: "wrap" }}>
                  <motion.span variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: isMobile ? "clamp(2.5rem, 12vw, 3.3rem)" : "clamp(3.5rem, 6vw, 5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#F4F5FA" }}>
                    for
                  </motion.span>
                  <motion.span variants={wordItem} style={{ display: "inline-block", fontFamily: "var(--font-display)", fontSize: isMobile ? "clamp(2.5rem, 12vw, 3.3rem)" : "clamp(3.5rem, 6vw, 5.5rem)", fontWeight: 700, letterSpacing: "-0.025em", lineHeight: 1.1, fontStyle: "italic", background: "linear-gradient(135deg, #4B8EF0, #34D17A)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
                    recruiting.
                  </motion.span>
                </span>
              </motion.h1>
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
          <section style={{ padding: isMobile ? "56px 1.25rem" : "96px 4rem", position: "relative" }}>
            <div style={{ maxWidth: 900, margin: "0 auto" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? "1.7rem" : "2.3rem", fontWeight: 600, letterSpacing: "-0.02em", color: "#F4F5FA", textAlign: "center", marginBottom: "1.25rem" }}>
                What is decision intelligence?
              </h2>
              <p style={{ fontFamily: "var(--font-body)", fontSize: isMobile ? "0.98rem" : "1.05rem", color: "#8891AA", fontWeight: 300, lineHeight: 1.75, textAlign: "center", maxWidth: 720, margin: "0 auto" }}>
                Decision intelligence in recruiting is the layer above talent intelligence. Talent
                intelligence tells you who exists; decision intelligence ranks, remembers, and
                recommends — so recruiters act on evidence instead of instinct, and every hiring
                cycle starts smarter than the last. ealana delivers it as three connected layers:
                Discover, Memory, and Flow.
              </p>
              <p style={{ fontFamily: "var(--font-body)", fontSize: isMobile ? "0.98rem" : "1.05rem", color: "#8891AA", fontWeight: 300, lineHeight: 1.75, textAlign: "center", maxWidth: 720, margin: "1.15rem auto 0" }}>
                The practical test is simple: when a search ends, ask what the system learned. If
                the answer is nothing — if the next role starts from a blank query box — you have a
                database, not decision intelligence. ealana passes that test by design: every
                search enriches Memory, every ranked candidate carries their evidence, and every
                cycle starts from what came before.
              </p>

              <h2 style={{ fontFamily: "var(--font-display)", fontSize: isMobile ? "1.7rem" : "2.3rem", fontWeight: 600, letterSpacing: "-0.02em", color: "#F4F5FA", textAlign: "center", margin: "4rem 0 1.75rem" }}>
                ealana vs a traditional ATS
              </h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse", fontFamily: "var(--font-body)", fontSize: "0.93rem", lineHeight: 1.6 }}>
                  <thead>
                    <tr>
                      {["", "Traditional ATS", "ealana"].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "12px 16px", color: h === "ealana" ? "#4B8EF0" : "#8891AA", fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.1)", fontSize: "0.8rem", letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Where candidates come from", "Waits for applicants to arrive", "Discover searches the market and ranks the top 100 by real fit"],
                      ["What the system remembers", "Static records you dig through", "Memory compounds every search and candidate — your next hire starts smarter than your last"],
                      ["How outreach happens", "Manual emails and follow-ups", "Email outreach with delivery tracking; WhatsApp status updates to staged candidates"],
                      ["How decisions get made", "Gut feel and scattered notes", "Fit scores with evidence, in one pipeline"],
                    ].map(([dim, ats, eal]) => (
                      <tr key={dim}>
                        <td style={{ padding: "14px 16px", color: "#F4F5FA", fontWeight: 500, borderBottom: "1px solid rgba(255,255,255,0.05)", verticalAlign: "top" }}>{dim}</td>
                        <td style={{ padding: "14px 16px", color: "#8891AA", fontWeight: 300, borderBottom: "1px solid rgba(255,255,255,0.05)", verticalAlign: "top" }}>{ats}</td>
                        <td style={{ padding: "14px 16px", color: "#C7CDDE", fontWeight: 400, borderBottom: "1px solid rgba(255,255,255,0.05)", verticalAlign: "top", background: "rgba(75,142,240,0.05)" }}>{eal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: isMobile ? "0.98rem" : "1.05rem", color: "#8891AA", fontWeight: 300, lineHeight: 1.75, maxWidth: 780, margin: "1.75rem auto 0" }}>
                These aren't just feature differences — they compound differently. A traditional
                ATS is worth roughly the same on day 400 as on day 4: it holds more records, but it
                hasn't learned anything. A decision intelligence platform gets more valuable every
                cycle, because each search adds to what the system knows about the market and each
                decision teaches it what your team actually values.
              </p>
              <p style={{ fontFamily: "var(--font-body)", fontSize: isMobile ? "0.98rem" : "1.05rem", color: "#8891AA", fontWeight: 300, lineHeight: 1.75, maxWidth: 780, margin: "1.15rem auto 0" }}>
                And because Discover, Memory, and Flow share one data model, there is nothing to
                sync, export, or reconcile. The search you ran, the shortlist you built, and the
                outreach you sent are one record, not three tools' worth of exports — which is why
                the workflow holds together at the moments a stitched-together stack falls apart.
              </p>
            </div>
          </section>
          <CTA />
          <HomepageFooter />
        </div>
      </div>
    </>
  );
}
