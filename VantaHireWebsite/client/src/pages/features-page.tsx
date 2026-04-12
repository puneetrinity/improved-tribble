import { Helmet } from "react-helmet-async";
import { trackEvent } from "@/lib/analytics";
import { btnPrimary, btnSecondary, sectionLabel } from "@/lib/shared-styles";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";

const breadcrumbJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://vantahire.com/" },
    { "@type": "ListItem", "position": 2, "name": "Features", "item": "https://vantahire.com/features" }
  ]
});

interface Pillar {
  layer: string;
  title: string;
  label: string;
  outcome: string;
  features: string[];
  accentColor: string;
  accentBg: string;
}

const pillars: Pillar[] = [
  {
    layer: "Intelligence",
    title: "Resume Knowledge Graph",
    label: "Every resume builds your hiring intelligence",
    outcome: "Recruiters never start from scratch. The talent library grows with every resume added to the system.",
    features: [
      "Resumes chunked into sentence-aware segments, embedded, and indexed into a vector-based knowledge graph",
      "Talent Search is live — recruiters search their talent pool using natural language with hybrid ranking",
      "Bulk resume import with AI-powered field extraction (name, email, phone, skills, experience)",
      "Past candidates become searchable and reusable for new roles, even across different job titles",
      "No manual tagging or categorization required"
    ],
    accentColor: "#A78BFA",
    accentBg: "rgba(124,58,237,0.15)"
  },
  {
    layer: "Intelligence",
    title: "AI Candidate Discovery",
    label: "AI-sourced candidates, ranked for recruiter action",
    outcome: "Recruiters get a ranked call sheet, not a raw database dump. They know who to contact first and why.",
    features: [
      "AI sourcing returns ranked candidates with fit scores — skill match, seniority, location, freshness",
      "Results tiered: Best Matches (high confidence) and Broader Pool (expanded criteria)",
      "Identity confidence badges on every lead",
      "Pool scan + web discovery sourcing flow — your talent pool is searched first, then the web",
      "No Boolean skills needed — describe the role and let the AI work"
    ],
    accentColor: "#F59E0B",
    accentBg: "rgba(245,158,11,0.15)"
  },
  {
    layer: "Outreach",
    title: "WhatsApp + Email Engagement",
    label: "Reach candidates instantly via email and WhatsApp",
    outcome: "Candidates respond on the channel they actually check. No-shows drop. Recruiters stop using personal phones.",
    features: [
      "Email and WhatsApp outreach native to the platform — no third-party integrations",
      "WhatsApp runs through Cloud API with pre-approved templates and full audit log",
      "Stage-based automation triggers — move to a stage and the message fires automatically",
      "90%+ WhatsApp read rates vs 15-20% email open rates in India and APAC (industry benchmark)",
      "Every message logged for compliance"
    ],
    accentColor: "#10B981",
    accentBg: "rgba(16,185,129,0.15)"
  },
  {
    layer: "Operations",
    title: "Client Feedback Portal",
    label: "Share shortlists with clients. Get feedback without the back-and-forth.",
    outcome: "Agencies close placements faster. Zero email ping-pong. All feedback visible in one dashboard across all clients and jobs.",
    features: [
      "Client portal generates a shareable link — no login required for clients",
      "Structured feedback per candidate: approve, hold, or reject",
      "Feedback appears in the recruiter dashboard in real time",
      "Multi-client view — see all feedback across all clients and jobs in one place",
      "No email chains. No chasing. Act on structured feedback."
    ],
    accentColor: "#06B6D4",
    accentBg: "rgba(6,182,212,0.15)"
  },
  {
    layer: "Operations",
    title: "Recruiter Productivity Dashboard",
    label: "One recruiter. Many open roles. Zero chaos.",
    outcome: "A single recruiter manages more roles without dropping candidates. Leadership gets real-time visibility without asking for updates.",
    features: [
      "Action-item dashboard with daily priorities across all jobs",
      "Bulk pipeline actions — move, email, archive",
      "Job health scoring (Green/Amber/Red) with stale candidate alerts",
      "Analytics: pipeline velocity, conversion rates, time-in-stage, source performance",
      "Day-1 productive — no training needed"
    ],
    accentColor: "#8B5CF6",
    accentBg: "rgba(139,92,246,0.15)"
  },
  {
    layer: "Operations",
    title: "Job Command Center",
    label: "Post, source, and screen — one command center per job",
    outcome: "Everything that matters for a role lives in one place. No switching between sourcing tools, email clients, spreadsheets, and calendar apps.",
    features: [
      "Single job view with full sub-navigation across all functions",
      "AI-assisted JD writing with bias detection and SEO scoring",
      "Application screening with AI fit scores",
      "From \"I have a JD\" to \"I'm messaging the top 5 leads\" without ever leaving VantaHire",
      "Replaces 4-6 separate tools"
    ],
    accentColor: "#A78BFA",
    accentBg: "rgba(124,58,237,0.15)"
  }
];

const featItem = "flex items-start gap-2.5 py-2.5 px-3 bg-hr-bg-elevated border border-[rgba(255,255,255,0.08)] rounded-[7px] text-[0.82rem] text-hr-text-secondary leading-[1.5]";
const featCheck = "w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 mt-px text-[0.6rem] font-bold";
const btnDemo = btnPrimary;
const btnPricing = btnSecondary;

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
        <script type="application/ld+json">
          {breadcrumbJsonLd}
        </script>
      </Helmet>

      <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />

          {/* Hero */}
          <div className="text-center pt-[140px] px-12 pb-20 max-w-[720px] mx-auto max-lg:pt-[120px] max-lg:px-6 max-lg:pb-[60px] max-md:pt-[100px] max-md:px-5 max-md:pb-12 max-sm:pt-[88px] max-sm:px-4 max-sm:pb-9">
            <div className={`${sectionLabel} mb-[18px]`}>Platform Capabilities</div>
            <h1 className="font-satoshi text-[clamp(2.4rem,5vw,3.4rem)] max-md:text-[clamp(1.8rem,6vw,2.4rem)] max-sm:text-[1.7rem] font-normal leading-[1.15] tracking-tight mb-4 text-hr-text">Six Pillars of<br />AI-Native Recruiting</h1>
            <p className="text-base leading-[1.7] text-hr-text-secondary max-w-[520px] mx-auto">Three layers. Six capabilities. Every recruiter action covered — from sourcing to placement.</p>
          </div>

          {/* Pillars */}
          <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
            <div></div>
            <div>
              <div className="max-w-[1100px] mx-auto flex flex-col gap-12 px-12 pb-[100px] max-lg:px-6 max-lg:pb-20 max-md:px-5 max-md:pb-[60px] max-md:gap-9 max-sm:px-4 max-sm:pb-12 max-sm:gap-7">
                {pillars.map((pillar, index) => {
                  const isReverse = index % 2 !== 0;
                  return (
                    <div
                      key={index}
                      className={`grid ${isReverse ? 'grid-cols-[1.3fr_1fr]' : 'grid-cols-[1fr_1.3fr]'} gap-12 items-start max-lg:gap-8 max-md:grid-cols-1 max-md:gap-6`}
                    >
                      <div className={isReverse ? 'order-2 max-md:order-1' : ''}>
                        <div className="font-mono text-[0.62rem] text-hr-text-muted tracking-[0.12em] uppercase mb-2.5">
                          Layer {String(index + 1).padStart(2, '0')} — {pillar.layer}
                        </div>
                        <h2 className="font-satoshi text-[1.7rem] font-normal leading-[1.25] text-hr-text mb-2">{pillar.title}</h2>
                        <div className="text-[0.88rem] text-hr-accent-hover mb-4 leading-[1.5]">{pillar.label}</div>
                        <p className="text-[0.875rem] leading-[1.7] text-hr-text-secondary">
                          <span className="text-hr-text font-medium">Outcome: </span>
                          {pillar.outcome}
                        </p>
                      </div>

                      <div className={`bg-hr-bg-card border border-[rgba(255,255,255,0.08)] rounded-[10px] overflow-hidden ${isReverse ? 'order-1 max-md:order-2' : ''}`}>
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[rgba(255,255,255,0.08)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[rgba(255,255,255,0.12)]"></span>
                          <span className="w-1.5 h-1.5 rounded-full bg-[rgba(255,255,255,0.12)]"></span>
                          <span className="w-1.5 h-1.5 rounded-full bg-[rgba(255,255,255,0.12)]"></span>
                          <span className="flex-1 text-center font-mono text-[0.6rem] text-hr-text-muted">{pillar.title}</span>
                        </div>
                        <div className="p-5">
                          <div className="flex flex-col gap-2.5">
                            {pillar.features.map((feat, i) => (
                              <div key={i} className={featItem}>
                                <span
                                  className={featCheck}
                                  style={{ background: pillar.accentBg, color: pillar.accentColor }}
                                >
                                  ✓
                                </span>
                                <span>{feat}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div></div>
          </div>

          {/* CTA */}
          <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
            <div></div>
            <div>
              <section className="text-center py-20 px-12 max-md:py-[60px] max-md:px-5">
                <div className={sectionLabel}>Get Started Today</div>
                <h2 className="font-satoshi text-[clamp(2rem,4vw,2.8rem)] font-normal leading-[1.2] tracking-tight mb-4 text-hr-text">Try AI Sourcing</h2>
                <p className="text-base leading-[1.7] text-hr-text-secondary max-w-[520px] mx-auto mb-9">
                  Start free and explore every capability VantaHire offers.
                </p>
                <div className="flex items-center justify-center gap-3 max-md:flex-col max-md:w-full">
                  <a
                    href="/recruiter-auth"
                    className={btnDemo}
                    onClick={() => trackEvent("cta_click", { location: "features", action: "start_free" })}
                  >
                    Start Free →
                  </a>
                  <button
                    className={btnPricing}
                    onClick={() => {
                      trackEvent("cta_click", { location: "features", action: "book_demo" });
                      window.open('https://cal.com/vantahire/quick-connect', '_blank');
                    }}
                  >
                    Book a Demo
                  </button>
                </div>
              </section>
            </div>
            <div></div>
          </div>

          <HomepageFooter />
        </div>
      </div>
    </>
  );
}

