import GridOverlay from "@/components/GridOverlay";
import HomepageFooter from "@/components/HomepageFooter";
import HomepageNav from "@/components/HomepageNav";
import CTA from "@/components/marketing/sections/CTA";
import { motion } from "framer-motion";
import { Helmet } from "react-helmet-async";
import { useIsMobile } from "@/hooks/use-mobile";

const jsonLd = JSON.stringify([
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://ealana.com/" },
      { "@type": "ListItem", position: 2, name: "About", item: "https://ealana.com/about" },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": "https://ealana.com/about#webpage",
    url: "https://ealana.com/about",
    name: "About ealana",
    about: { "@id": "https://ealana.com/#organization" },
  },
  {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": "https://ealana.com/about#founder",
    name: "Puneet Kumar",
    jobTitle: "Founder & CEO",
    sameAs: ["https://www.linkedin.com/in/puneet-gleuck/"],
    worksFor: { "@id": "https://ealana.com/#organization" },
    knowsAbout: ["Recruitment", "Talent Acquisition", "Decision Intelligence", "AI Sourcing"],
  },
]);

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.25, 0.1, 0.25, 1] as const },
};

export default function AboutPage() {
  const isMobile = useIsMobile();
  return (
    <>
      <Helmet>
        <title>About | ealana — Built by a recruiter who lived the problem</title>
        <meta
          name="description"
          content="ealana is a decision intelligence platform for recruiting, built by founder Puneet Kumar — 13+ years running recruitment before building the system recruiters actually need."
        />
        <link rel="canonical" href="https://ealana.com/about" />
        <script type="application/ld+json">{jsonLd}</script>
      </Helmet>
      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <HomepageNav />

        <section
          className="relative px-5 text-center sm:px-6"
          style={{ paddingTop: isMobile ? 140 : 180, paddingBottom: isMobile ? 40 : 64 }}
        >
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
            className="mx-auto max-w-4xl font-normal"
            style={{
              fontFamily: "'Outfit', sans-serif",
              fontSize: isMobile ? "clamp(2.1rem, 9vw, 2.8rem)" : "clamp(2.8rem, 5vw, 4.2rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.025em",
              color: "#F4F5FA",
            }}
          >
            Built by a recruiter who{" "}
            <span
              style={{
                fontStyle: "italic",
                background: "linear-gradient(135deg, #4B8EF0 0%, #34D17A 100%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              lived the problem.
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.25 }}
            className="mx-auto mt-6 max-w-2xl font-body leading-relaxed text-e-text2"
            style={{ fontSize: isMobile ? "0.98rem" : "1.08rem", fontWeight: 300 }}
          >
            ealana is a decision intelligence platform for recruiting — built by someone who spent
            over a decade inside the problem it solves.
          </motion.p>
        </section>

        <section className="relative mx-auto max-w-3xl px-5 pb-16 sm:px-6 sm:pb-24">
          <motion.div {...fadeUp} className="space-y-6 font-body leading-relaxed text-e-text2" style={{ fontSize: "1.02rem", fontWeight: 300 }}>
            <h2
              className="font-normal text-e-text"
              style={{ fontFamily: "'Outfit', sans-serif", fontSize: isMobile ? "1.6rem" : "2rem", letterSpacing: "-0.02em" }}
            >
              Why ealana exists
            </h2>
            <p>
              Every recruiting tool solves one slice of the job. Sourcing extensions find people.
              Applicant tracking systems track them. Outreach tools message them. But nothing
              connects discovery, memory, and execution into a single intelligent system — so
              recruiters re-source the same roles from scratch every quarter, and everything a team
              learns about candidates evaporates after each search.
            </p>
            <p>
              ealana closes that gap. Discover finds and ranks candidates by real fit. Memory keeps
              every candidate and every search, so the system starts smarter each cycle instead of
              starting from zero. Flow runs the outreach and pipeline work that turns a shortlist
              into a hire. Together they move recruiting from talent intelligence — knowing who
              exists — to decision intelligence: knowing who to act on, and why.
            </p>
          </motion.div>
        </section>

        <section className="relative mx-auto max-w-3xl px-5 pb-16 sm:px-6 sm:pb-24">
          <motion.div
            {...fadeUp}
            className="rounded-[24px] border border-white/10 p-7 sm:p-10"
            style={{ background: "linear-gradient(180deg, rgba(17,19,38,0.9) 0%, rgba(13,15,30,0.9) 100%)" }}
          >
            <h2
              className="font-normal text-e-text"
              style={{ fontFamily: "'Outfit', sans-serif", fontSize: isMobile ? "1.6rem" : "2rem", letterSpacing: "-0.02em" }}
            >
              The founder
            </h2>
            <div className="mt-6 space-y-5 font-body leading-relaxed text-e-text2" style={{ fontSize: "1.02rem", fontWeight: 300 }}>
              <p>
                <strong className="font-semibold text-e-text">Puneet Kumar</strong> spent 13+ years
                in recruitment — building and scaling technical hiring across APAC. At Cradlepoint
                (acquired by Ericsson) he grew the India R&amp;D team from zero to 250+ engineers;
                at Cloudera and Hortonworks he ran large-scale talent operations. He wasn't managing
                from a distance — he was the hiring machine himself: sourcing, screening, offers,
                and vendor coordination across hundreds of roles in three countries.
              </p>
              <p>
                That experience revealed the pattern ealana is built on: recruiting should get
                smarter every cycle, not start from zero. So he moved from operations to product and
                built the system he wished he'd had — architecting the sourcing pipeline, the
                workflow engine, and the knowledge graph himself.
              </p>
              <a
                href="https://www.linkedin.com/in/puneet-gleuck/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:opacity-90"
                style={{ background: "#4B8EF0", boxShadow: "0 0 20px rgba(75,142,240,0.3)" }}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ width: 16, height: 16 }}>
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.555V9h3.564v11.452z" />
                </svg>
                Connect on LinkedIn
              </a>
            </div>
          </motion.div>
        </section>

        <section className="relative mx-auto max-w-3xl px-5 pb-20 sm:px-6 sm:pb-28">
          <motion.div {...fadeUp} className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Founded by", value: "A recruiter who lived the problem" },
              { label: "Built for", value: "Recruiting teams everywhere" },
              { label: "Reach us", value: "info@ealana.com" },
            ].map((f) => (
              <div
                key={f.label}
                className="rounded-2xl border border-white/10 p-5 text-center"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <div className="font-body text-e-text3" style={{ fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {f.label}
                </div>
                <div className="mt-2 font-body text-e-text" style={{ fontSize: "0.98rem" }}>
                  {f.value}
                </div>
              </div>
            ))}
          </motion.div>
        </section>

        <CTA />
        <HomepageFooter />
      </div>
    </>
  );
}
