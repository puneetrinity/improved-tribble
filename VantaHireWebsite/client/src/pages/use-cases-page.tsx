import { Helmet } from "react-helmet-async";
import { trackEvent } from "@/lib/analytics";
import { Rocket, Building2, Users, Briefcase, Code, Wifi, CreditCard, HeartPulse, Car } from "lucide-react";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/use-cases.css";

const breadcrumbJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://vantahire.com/" },
    { "@type": "ListItem", "position": 2, "name": "Use Cases", "item": "https://vantahire.com/use-cases" }
  ]
});

const useCases = [
  {
    icon: <Rocket size={20} />,
    title: "Startups",
    subtitle: "Hire your first 10 engineers without breaking the bank",
    description: "You're moving fast and can't afford to waste time on bad hires. VantaHire's AI helps you find quality candidates quickly, while our free tier lets you get started without upfront costs.",
    features: [
      "Free tier to get started",
      "AI-powered screening for quality over quantity",
      "Move fast without sacrificing hire quality"
    ]
  },
  {
    icon: <Building2 size={20} />,
    title: "Agencies",
    subtitle: "Manage multiple clients from one dashboard",
    description: "Juggling multiple clients? VantaHire keeps everything organized with separate pipelines, client-specific templates, and unified reporting.",
    features: [
      "Multi-client workspace",
      "White-label options available",
      "Bulk actions for efficiency"
    ]
  },
  {
    icon: <Users size={20} />,
    title: "Enterprises",
    subtitle: "Scale hiring across departments with consistency",
    description: "Standardize your hiring process across teams. Role-based access, custom workflows, and analytics that leadership actually uses.",
    features: [
      "Custom approval workflows",
      "Department-level reporting",
      "SSO and enterprise security"
    ]
  },
  {
    icon: <Briefcase size={20} />,
    title: "HR Teams",
    subtitle: "Replace spreadsheets with smart automation",
    description: "Stop tracking candidates in Excel. VantaHire gives you a proper system with automation, templates, and analytics—without the enterprise price tag.",
    features: [
      "Easy migration from spreadsheets",
      "Automated status updates",
      "Simple, intuitive interface"
    ]
  }
];

const industries = [
  {
    icon: <Code size={18} />,
    name: "IT & Technology",
    description: "Find developers, engineers, and tech leads who actually match your stack."
  },
  {
    icon: <Wifi size={18} />,
    name: "Telecom",
    description: "Hire network engineers, RF specialists, and telecom professionals."
  },
  {
    icon: <CreditCard size={18} />,
    name: "Fintech",
    description: "Source compliance-savvy talent for your financial technology needs."
  },
  {
    icon: <HeartPulse size={18} />,
    name: "Healthcare",
    description: "Recruit healthcare IT professionals and medical technology specialists."
  },
  {
    icon: <Car size={18} />,
    name: "Automotive",
    description: "Find embedded systems engineers and automotive software talent."
  }
];

export default function UseCasesPage() {
  return (
    <>
      <Helmet>
        <title>Use Cases | VantaHire - Built for Teams Like Yours</title>
        <meta name="description" content="See how startups, agencies, enterprises, and HR teams use VantaHire to hire faster. Industry solutions for IT, Telecom, Fintech, Healthcare, and Automotive." />
        <link rel="canonical" href="https://vantahire.com/use-cases" />
        <meta property="og:title" content="Use Cases | VantaHire - Built for Teams Like Yours" />
        <meta property="og:description" content="From startups to enterprises, see how teams use VantaHire to transform their hiring." />
        <meta property="og:url" content="https://vantahire.com/use-cases" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://vantahire.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Use Cases | VantaHire - Built for Teams Like Yours" />
        <meta name="twitter:description" content="From startups to enterprises, see how teams use VantaHire to transform their hiring." />
        <meta name="twitter:image" content="https://vantahire.com/twitter-image.jpg" />
        <script type="application/ld+json">
          {breadcrumbJsonLd}
        </script>
      </Helmet>

      <div className="homepage-redesign public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />

          {/* Hero */}
          <div className="hr-uc-hero">
            <div className="hr-section-label">Solutions</div>
            <h1 className="hr-section-title">Built for teams like yours.</h1>
            <p className="hr-section-desc">
              From startups to enterprises, see how teams use VantaHire
              to hire smarter and faster across India and APAC.
            </p>
          </div>

          {/* Use Case Cards */}
          <div className="hr-uc-cards-section">
          <div className="hr-uc-grid">
            {useCases.map((useCase, index) => (
              <div key={index} className="hr-uc-card">
                <div className="hr-uc-card-icon">
                  {useCase.icon}
                </div>
                <h3 className="hr-uc-card-title">{useCase.title}</h3>
                <p className="hr-uc-card-subtitle">{useCase.subtitle}</p>
                <p className="hr-uc-card-desc">{useCase.description}</p>
                <ul className="hr-uc-features">
                  {useCase.features.map((feature, featureIndex) => (
                    <li key={featureIndex}>{feature}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          </div>

          {/* Industries Section */}
          <div className="hr-uc-industries-section">
            <div className="hr-uc-industries-header">
              <div className="hr-section-label">Industries</div>
              <h2 className="hr-section-title">Deep expertise where it matters.</h2>
              <p className="hr-section-desc">
                Specialized hiring workflows for the industries where great talent makes the biggest difference.
              </p>
            </div>
            <div className="hr-uc-industries-grid">
              {industries.map((industry, index) => (
                <div key={index} className="hr-uc-industry-card">
                  <div className="hr-uc-industry-icon">
                    {industry.icon}
                  </div>
                  <h3 className="hr-uc-industry-name">{industry.name}</h3>
                  <p className="hr-uc-industry-desc">{industry.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA Section */}
          <div className="hr-uc-cta">
            <div className="hr-section-label">Get Started</div>
            <h2 className="hr-section-title">Ready to transform your hiring?</h2>
            <p className="hr-section-desc">
              Join teams across industries who hire smarter with VantaHire.
            </p>
            <div className="hr-uc-cta-buttons">
              <a
                href="/recruiter-auth"
                className="hr-btn hr-btn--primary hr-btn--xl"
                onClick={() => trackEvent("cta_click", { location: "use_cases", action: "start_free" })}
              >
                Get Started Free
              </a>
              <a
                href="https://cal.com/vantahire/quick-connect"
                target="_blank"
                rel="noopener noreferrer"
                className="hr-btn hr-btn--secondary hr-btn--xl"
                onClick={() => trackEvent("cta_click", { location: "use_cases", action: "get_walkthrough" })}
              >
                Talk to Sales
              </a>
            </div>
          </div>

          <HomepageFooter />
        </div>
      </div>
    </>
  );
}
