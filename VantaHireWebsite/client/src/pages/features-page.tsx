import { Helmet } from "react-helmet-async";
import { trackEvent } from "@/lib/analytics";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/homepage.css";
import "@/styles/features.css";

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
    accentColor: "var(--hr-accent-hover)",
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
    accentColor: "var(--hr-yellow)",
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
    accentColor: "var(--hr-green)",
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
    accentColor: "var(--hr-cyan)",
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
    accentColor: "var(--hr-purple)",
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
    accentColor: "var(--hr-accent-hover)",
    accentBg: "rgba(124,58,237,0.15)"
  }
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
        <script type="application/ld+json">
          {breadcrumbJsonLd}
        </script>
      </Helmet>

      <div className="homepage-redesign public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />

          <div className="hr-feat-hero">
            <div className="hr-section-label">Platform Capabilities</div>
            <h1 className="hr-section-title">Six Pillars of<br />AI-Native Recruiting</h1>
            <p className="hr-section-desc">Three layers. Six capabilities. Every recruiter action covered — from sourcing to placement.</p>
          </div>

          <div className="hr-struct-section">
            <div className="struct-gutter"></div>
            <div className="struct-body struct-body--divider"></div>
            <div className="struct-gutter"></div>
          </div>

          <div className="hr-struct-section">
            <div className="struct-gutter"></div>
            <div className="struct-body">
              <div className="hr-pillars">
                {pillars.map((pillar, index) => (
                  <div
                    key={index}
                    className={`hr-pillar${index % 2 !== 0 ? ' reverse' : ''}`}
                  >
                    <div className="hr-pillar-text">
                      <div className="hr-pillar-layer">
                        Layer {String(index + 1).padStart(2, '0')} — {pillar.layer}
                      </div>
                      <h2>{pillar.title}</h2>
                      <div className="hr-pillar-label">{pillar.label}</div>
                      <p className="hr-pillar-outcome">
                        <span className="hr-pillar-outcome-label">Outcome: </span>
                        {pillar.outcome}
                      </p>
                    </div>

                    <div className="hr-pillar-detail">
                      <div className="hr-mock-bar">
                        <div className="dots"><span></span><span></span><span></span></div>
                        <span className="bar-title">{pillar.title}</span>
                      </div>
                      <div className="hr-pillar-detail-body">
                        <div className="hr-pillar-features">
                          {pillar.features.map((feat, i) => (
                            <div key={i} className="hr-pillar-feat-item">
                              <span
                                className="hr-pillar-feat-check"
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
                ))}
              </div>
            </div>
            <div className="struct-gutter"></div>
          </div>

          <div className="hr-struct-section">
            <div className="struct-gutter"></div>
            <div className="struct-body">
              <section className="hr-feat-cta hr-cta-section">
                <div className="hr-section-label">Get Started Today</div>
                <h2 className="hr-section-title">Try AI Sourcing</h2>
                <p className="hr-section-desc">
                  Start free and explore every capability VantaHire offers.
                </p>
                <div className="hr-cta-btns">
                  <a
                    href="/recruiter-auth"
                    className="hr-btn-demo"
                    onClick={() => trackEvent("cta_click", { location: "features", action: "start_free" })}
                  >
                    Start Free →
                  </a>
                  <button
                    className="hr-btn-pricing"
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
            <div className="struct-gutter"></div>
          </div>

          <HomepageFooter />
        </div>
      </div>
    </>
  );
}
