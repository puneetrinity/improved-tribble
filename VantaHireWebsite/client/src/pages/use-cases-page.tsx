import { Helmet } from "react-helmet-async";
import { trackEvent } from "@/lib/analytics";
import { btnPrimary, btnSecondary, sectionLabel } from "@/lib/shared-styles";
import { Rocket, Building2, Users, Briefcase, Code, Wifi, CreditCard, HeartPulse, Car } from "lucide-react";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";

const breadcrumbJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://vantahire.com/" },
    { "@type": "ListItem", "position": 2, "name": "Solutions", "item": "https://vantahire.com/solutions" }
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
    title: "Talent Teams",
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

const btnDemo = btnPrimary;
const btnOutline = btnSecondary;

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
        <script type="application/ld+json">
          {breadcrumbJsonLd}
        </script>
      </Helmet>

      <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />

          {/* Hero */}
          <div className="pt-[140px] px-12 pb-20 text-center max-w-[1100px] mx-auto animate-hr-fade-up max-md:pt-[100px] max-md:px-5 max-md:pb-[60px]">
            <div className={sectionLabel}>Solutions</div>
            <h1 className="font-satoshi text-[clamp(2.4rem,5vw,3.4rem)] font-normal leading-[1.2] tracking-tight mb-5 text-hr-text">Built for teams like yours.</h1>
            <p className="text-base leading-[1.7] text-hr-text-secondary max-w-[560px] mx-auto">
              From startups to enterprises, see how teams use VantaHire
              to hire smarter and faster across India and APAC.
            </p>
          </div>

          {/* Use Case Cards */}
          <div className="px-12 max-md:px-5">
            <div
              className="grid grid-cols-2 max-md:grid-cols-1 gap-px bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.08)] rounded-lg overflow-hidden max-w-[1100px] mx-auto"
              style={{ animation: 'hr-fade-up 0.8s ease-out 0.1s both' }}
            >
              {useCases.map((useCase, index) => (
                <div key={index} className="bg-hr-bg py-9 px-8 max-md:py-7 max-md:px-6 flex flex-col transition-colors duration-200 hover:bg-hr-bg-elevated">
                  <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[rgba(124,58,237,0.1)] text-hr-accent-hover mb-5 shrink-0">
                    {useCase.icon}
                  </div>
                  <h3 className="font-satoshi text-[1.35rem] font-medium text-hr-text tracking-[-0.01em] mb-1">{useCase.title}</h3>
                  <p className="font-dm text-[0.82rem] text-hr-accent-hover mb-3.5 font-medium">{useCase.subtitle}</p>
                  <p className="text-[0.92rem] leading-[1.7] text-hr-text-secondary mb-5">{useCase.description}</p>
                  <ul className="list-none p-0 m-0 flex flex-col gap-1.5 mt-auto">
                    {useCase.features.map((feature, featureIndex) => (
                      <li key={featureIndex} className="flex items-center gap-2.5 text-[0.82rem] text-hr-text-muted before:content-[''] before:w-1 before:h-1 before:rounded-full before:bg-hr-accent before:opacity-60 before:shrink-0">{feature}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Industries Section */}
          <div className="max-w-[1100px] mx-auto py-[100px] px-12 max-md:py-[60px] max-md:px-5">
            <div className="text-center mb-[60px] animate-hr-fade-up">
              <div className={sectionLabel}>Industries</div>
              <h2 className="font-satoshi text-[clamp(2rem,4vw,2.8rem)] font-normal leading-[1.2] tracking-tight mb-4 text-hr-text">Deep expertise where it matters.</h2>
              <p className="text-base leading-[1.7] text-hr-text-secondary max-w-[520px] mx-auto">
                Specialized hiring workflows for the industries where great talent makes the biggest difference.
              </p>
            </div>
            <div
              className="grid grid-cols-5 max-lg:grid-cols-3 max-md:grid-cols-2 max-sm:grid-cols-1 gap-px bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.08)] rounded-lg overflow-hidden"
              style={{ animation: 'hr-fade-up 0.8s ease-out 0.1s both' }}
            >
              {industries.map((industry, index) => (
                <div key={index} className="bg-hr-bg py-7 px-5 flex flex-col items-center text-center transition-colors duration-200 hover:bg-hr-bg-elevated">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-[rgba(124,58,237,0.1)] text-hr-accent-hover mb-3.5">
                    {industry.icon}
                  </div>
                  <h3 className="font-satoshi text-[0.95rem] font-medium text-hr-text mb-2">{industry.name}</h3>
                  <p className="text-[0.8rem] leading-[1.55] text-hr-text-muted">{industry.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* CTA Section */}
          <div className="text-center max-w-[1100px] mx-auto px-12 pb-[100px] animate-hr-fade-up max-md:px-5 max-md:pb-[60px]">
            <div className={sectionLabel}>Get Started</div>
            <h2 className="font-satoshi text-[clamp(2rem,4vw,2.8rem)] font-normal leading-[1.2] tracking-tight mb-4 text-hr-text max-w-[480px] mx-auto">Ready to transform your hiring?</h2>
            <p className="text-base leading-[1.7] text-hr-text-secondary max-w-[520px] mx-auto text-center mb-9">
              Join teams across industries who hire smarter with VantaHire.
            </p>
            <div className="flex gap-3 justify-center max-md:flex-col max-md:items-center">
              <a
                href="/recruiter-auth"
                className={btnDemo}
                onClick={() => trackEvent("cta_click", { location: "use_cases", action: "start_free" })}
              >
                Get Started Free
              </a>
              <a
                href="https://cal.com/vantahire/quick-connect"
                target="_blank"
                rel="noopener noreferrer"
                className={btnOutline}
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
