import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Shield, Database, Eye, Lock, Mail, UserCheck, Clock, Cookie, Baby, FileText } from "lucide-react";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/privacy-policy.css";

const GridOverlay = () => (
  <div className="hr-page-grid-overlay">
    <div className="hr-page-grid-overlay-inner">
      <div className="grid-col line-both">
        <span className="hr-grid-diamond" style={{ left: '-4px', top: '56px' }}></span>
        <span className="hr-grid-diamond" style={{ right: '-4px', top: '56px' }}></span>
      </div>
      <div className="grid-col"></div>
      <div className="grid-col"></div>
      <div className="grid-col line-both">
        <span className="hr-grid-diamond" style={{ left: '-4px', top: '56px' }}></span>
        <span className="hr-grid-diamond" style={{ right: '-4px', top: '56px' }}></span>
      </div>
    </div>
  </div>
);

interface PolicySection {
  id: string;
  icon: React.ReactNode;
  label: string;
  title: string;
  content: React.ReactNode;
}

export default function PrivacyPolicyPage() {
  const [activeSection, setActiveSection] = useState<string>("");

  useEffect(() => {
    const handleScroll = () => {
      const sections = document.querySelectorAll(".hr-pp-section");
      let current = "";
      sections.forEach((section) => {
        const rect = section.getBoundingClientRect();
        if (rect.top <= 200) {
          current = section.id;
        }
      });
      setActiveSection(current);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const sections: PolicySection[] = [
    {
      id: "introduction",
      icon: <Shield size={16} />,
      label: "Overview",
      title: "Introduction",
      content: (
        <>
          <p>
            VantaHire, a brand of <a href="https://www.airevolabs.com" target="_blank" rel="noopener noreferrer" className="hr-pp-link">Airevolabs LLP</a> ("we," "our," or "us"),
            is committed to protecting your privacy. This Privacy Policy explains how we collect,
            use, disclose, and safeguard your information when you use our applicant tracking system
            and recruitment platform.
          </p>
          <p>
            By using VantaHire, you agree to the collection and use of information in accordance
            with this policy. If you do not agree with our policies and practices, please do not use our services.
          </p>
        </>
      ),
    },
    {
      id: "information-we-collect",
      icon: <Database size={16} />,
      label: "Collection",
      title: "Information We Collect",
      content: (
        <>
          <div className="hr-pp-subsection">
            <h4 className="hr-pp-h4">Personal Information</h4>
            <p>When you register or use our services, we may collect:</p>
            <ul className="hr-pp-list">
              <li>Name, email address, and contact information</li>
              <li>Resume/CV and professional credentials</li>
              <li>Employment history and educational background</li>
              <li>Skills, certifications, and professional qualifications</li>
              <li>LinkedIn profile and other professional social media links</li>
              <li>Application responses and form submissions</li>
            </ul>
          </div>
          <div className="hr-pp-subsection">
            <h4 className="hr-pp-h4">Automatically Collected Information</h4>
            <ul className="hr-pp-list">
              <li>IP address, browser type, and device information</li>
              <li>Usage data and interaction patterns</li>
              <li>Cookies and similar tracking technologies</li>
              <li>Analytics data about how you use our platform</li>
            </ul>
          </div>
          <div className="hr-pp-subsection">
            <h4 className="hr-pp-h4">AI-Generated Data</h4>
            <p>
              Our platform uses AI to analyse resumes and match candidates with jobs. This analysis
              generates fit scores and recommendations, which are stored with your application data.
            </p>
          </div>
        </>
      ),
    },
    {
      id: "how-we-use",
      icon: <Eye size={16} />,
      label: "Usage",
      title: "How We Use Your Information",
      content: (
        <>
          <p>We use the collected information for:</p>
          <ul className="hr-pp-list">
            <li>Processing and managing job applications</li>
            <li>Matching candidates with suitable job opportunities</li>
            <li>Communicating with you about your applications and our services</li>
            <li>Providing AI-powered resume analysis and job fit scoring</li>
            <li>Improving our platform and user experience</li>
            <li>Sending notifications about application status updates</li>
            <li>Conducting analytics and research to enhance our services</li>
            <li>Complying with legal obligations and protecting our rights</li>
            <li>Preventing fraud and ensuring platform security</li>
          </ul>
        </>
      ),
    },
    {
      id: "data-sharing",
      icon: <Lock size={16} />,
      label: "Sharing",
      title: "Data Sharing and Disclosure",
      content: (
        <>
          <div className="hr-pp-subsection">
            <h4 className="hr-pp-h4">With Recruiters and Employers</h4>
            <p>
              When you apply for a job, your application data, resume, and AI fit scores are shared
              with the recruiter or employer posting that position. They can view, download, and
              manage your application through our platform.
            </p>
          </div>
          <div className="hr-pp-subsection">
            <h4 className="hr-pp-h4">Service Providers</h4>
            <p>We may share your information with trusted third-party service providers who assist us in:</p>
            <ul className="hr-pp-list">
              <li>Cloud storage and hosting (Google Cloud Storage)</li>
              <li>Email delivery services</li>
              <li>Analytics and performance monitoring</li>
              <li>AI and machine learning services (OpenAI API)</li>
            </ul>
          </div>
          <div className="hr-pp-subsection">
            <h4 className="hr-pp-h4">Legal Requirements</h4>
            <p>
              We may disclose your information if required by law, court order, or government request,
              or to protect our rights, property, or safety.
            </p>
          </div>
          <div className="hr-pp-highlight-box">
            <Lock size={14} />
            <span>We do not sell, rent, or trade your personal information to third parties for marketing purposes.</span>
          </div>
        </>
      ),
    },
    {
      id: "data-security",
      icon: <Shield size={16} />,
      label: "Security",
      title: "Data Security",
      content: (
        <>
          <p>
            We implement industry-standard security measures to protect your information, including:
          </p>
          <div className="hr-pp-security-grid">
            {[
              { label: "HTTPS/TLS", desc: "Encrypted data transmission" },
              { label: "Auth", desc: "Secure authentication & sessions" },
              { label: "CSRF", desc: "Protection on all state changes" },
              { label: "Audits", desc: "Regular security assessments" },
              { label: "RBAC", desc: "Role-based access controls" },
              { label: "GCP", desc: "Google Cloud Platform storage" },
            ].map((item) => (
              <div key={item.label} className="hr-pp-security-item">
                <span className="hr-pp-security-label">{item.label}</span>
                <span className="hr-pp-security-desc">{item.desc}</span>
              </div>
            ))}
          </div>
          <p className="hr-pp-note">
            No method of transmission over the internet is 100% secure. While we strive to
            protect your information, we cannot guarantee absolute security.
          </p>
        </>
      ),
    },
    {
      id: "your-rights",
      icon: <UserCheck size={16} />,
      label: "Rights",
      title: "Your Rights",
      content: (
        <>
          <p>You have the right to:</p>
          <div className="hr-pp-rights-list">
            {[
              { right: "Access", desc: "Request a copy of your personal data" },
              { right: "Rectification", desc: "Correct inaccurate or incomplete information" },
              { right: "Deletion", desc: "Request deletion of your account and associated data" },
              { right: "Portability", desc: "Receive your data in a structured, machine-readable format" },
              { right: "Objection", desc: "Object to certain types of data processing" },
              { right: "Withdrawal", desc: "Withdraw consent for optional data processing" },
            ].map((item) => (
              <div key={item.right} className="hr-pp-right-item">
                <span className="hr-pp-right-name">{item.right}</span>
                <span className="hr-pp-right-desc">{item.desc}</span>
              </div>
            ))}
          </div>
          <p>
            To exercise these rights, please contact us using the information provided below.
          </p>
        </>
      ),
    },
    {
      id: "data-retention",
      icon: <Clock size={16} />,
      label: "Retention",
      title: "Data Retention",
      content: (
        <>
          <p>
            We retain your personal information for as long as necessary to provide our services and
            comply with legal obligations. Specifically:
          </p>
          <ul className="hr-pp-list">
            <li><strong>Active accounts</strong> — Data retained while your account is active</li>
            <li><strong>Inactive accounts</strong> — May be deleted after 2 years of inactivity</li>
            <li><strong>Application data</strong> — Retained as long as the job posting is active plus 1 year</li>
            <li><strong>Legal requirements</strong> — Data may be retained longer if required by law</li>
          </ul>
        </>
      ),
    },
    {
      id: "cookies",
      icon: <Cookie size={16} />,
      label: "Cookies",
      title: "Cookies and Tracking",
      content: (
        <>
          <p>
            We use cookies and similar tracking technologies to enhance your experience.
            For detailed information, please see our{" "}
            <a href="/cookie-policy" className="hr-pp-link">Cookie Policy</a>.
          </p>
          <p>
            You can manage your cookie preferences through our Cookie Consent banner or your browser settings.
          </p>
        </>
      ),
    },
    {
      id: "children",
      icon: <Baby size={16} />,
      label: "Children",
      title: "Children's Privacy",
      content: (
        <p>
          VantaHire is not intended for individuals under the age of 18. We do not knowingly collect
          personal information from children. If we become aware that we have collected data from a
          child, we will take steps to delete such information.
        </p>
      ),
    },
    {
      id: "changes",
      icon: <FileText size={16} />,
      label: "Changes",
      title: "Changes to This Policy",
      content: (
        <>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any significant
            changes by posting the new policy on this page and updating the "Last Updated" date.
          </p>
          <p>
            Your continued use of VantaHire after changes are posted constitutes acceptance of the updated policy.
          </p>
        </>
      ),
    },
    {
      id: "contact",
      icon: <Mail size={16} />,
      label: "Contact",
      title: "Contact Us",
      content: (
        <>
          <p>
            If you have questions about this Privacy Policy or our data practices, please contact us:
          </p>
          <div className="hr-pp-contact-card">
            <div className="hr-pp-contact-org">
              <a href="https://www.airevolabs.com" target="_blank" rel="noopener noreferrer">Airevolabs LLP</a>
            </div>
            <div className="hr-pp-contact-row">
              <Mail size={13} />
              <span>privacy@vantahire.com</span>
            </div>
            <div className="hr-pp-contact-subject">Subject: Privacy Policy Inquiry</div>
          </div>
        </>
      ),
    },
  ];

  return (
    <>
      <Helmet>
        <title>Privacy Policy | VantaHire</title>
        <meta name="description" content="VantaHire Privacy Policy. Learn how we collect, use, and protect your personal information when using our recruiter-first ATS platform." />
        <link rel="canonical" href="https://vantahire.com/privacy-policy" />
        <meta property="og:title" content="Privacy Policy | VantaHire" />
        <meta property="og:description" content="Learn how VantaHire protects your privacy and handles your data." />
        <meta property="og:url" content="https://vantahire.com/privacy-policy" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://vantahire.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Privacy Policy | VantaHire" />
        <meta name="twitter:description" content="Learn how VantaHire protects your privacy and handles your data." />
        <meta name="twitter:image" content="https://vantahire.com/twitter-image.jpg" />
      </Helmet>

      <div className="homepage-redesign public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />

          {/* Hero */}
          <div className="hr-pp-hero">
            <div className="hr-section-label">Privacy Policy</div>
            <h1 className="hr-section-title">Your data, your trust.</h1>
            <p className="hr-section-desc">
              We take your privacy seriously. Here's everything you need to know about
              how we collect, use, and protect your information.
            </p>
            <div className="hr-pp-last-updated">Last Updated: January 2025</div>
          </div>

          {/* Content */}
          <div className="hr-pp-layout">
            {/* Sidebar Navigation */}
            <aside className="hr-pp-sidebar">
              <div className="hr-pp-sidebar-inner">
                <div className="hr-pp-sidebar-label">On this page</div>
                <nav className="hr-pp-sidebar-nav">
                  {sections.map((section) => (
                    <a
                      key={section.id}
                      href={`#${section.id}`}
                      className={`hr-pp-sidebar-link ${activeSection === section.id ? "active" : ""}`}
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      <span className="hr-pp-sidebar-icon">{section.icon}</span>
                      <span>{section.label}</span>
                    </a>
                  ))}
                </nav>
              </div>
            </aside>

            {/* Main Content */}
            <main className="hr-pp-main">
              {sections.map((section, index) => (
                <section
                  key={section.id}
                  id={section.id}
                  className="hr-pp-section"
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div className="hr-pp-section-header">
                    <span className="hr-pp-section-icon">{section.icon}</span>
                    <h2 className="hr-pp-section-title">{section.title}</h2>
                  </div>
                  <div className="hr-pp-section-body">
                    {section.content}
                  </div>
                </section>
              ))}
            </main>
          </div>

          <HomepageFooter />
        </div>
      </div>
    </>
  );
}
