import { Helmet } from "react-helmet-async";
import { FileText, Scale, Users, Shield, AlertTriangle, Ban, Briefcase, CreditCard, Gavel, Puzzle, Mail } from "lucide-react";
import LegalPageLayout, { type LegalSection } from "@/components/LegalPageLayout";
import "@/styles/terms-of-service.css";

const sections: LegalSection[] = [
  {
    id: "agreement",
    icon: <Scale size={16} />,
    label: "Agreement",
    title: "Agreement to Terms",
    content: (
      <>
        <p>
          These Terms of Service ("Terms") govern your access to and use of VantaHire, an applicant
          tracking system and recruitment platform operated by <a href="https://www.airevolabs.com" target="_blank" rel="noopener noreferrer" className="hr-legal-link">Airevolabs LLP</a>
          {" "}("VantaHire," "we," "us," or "our").
        </p>
        <p>
          By accessing or using VantaHire, you agree to be bound by these Terms. If you do not agree
          to these Terms, you may not access or use our services.
        </p>
        <p>
          We reserve the right to modify these Terms at any time. Continued use of our services after
          changes constitutes acceptance of the modified Terms.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    icon: <Users size={16} />,
    label: "Accounts",
    title: "User Accounts and Roles",
    content: (
      <>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">Account Types</h4>
          <p>VantaHire offers different account types:</p>
          <div className="hr-tos-roles-grid">
            {[
              { role: "Candidates", desc: "Individuals seeking employment who can apply to job postings" },
              { role: "Recruiters", desc: "Professionals who post jobs and manage applications" },
              { role: "Administrators", desc: "Users with elevated permissions to manage the platform" },
            ].map((item) => (
              <div key={item.role} className="hr-tos-role-item">
                <span className="hr-tos-role-name">{item.role}</span>
                <span className="hr-tos-role-desc">{item.desc}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">Account Registration</h4>
          <p>To use VantaHire, you must:</p>
          <ul className="hr-legal-list">
            <li>Be at least 18 years of age</li>
            <li>Provide accurate and complete registration information</li>
            <li>Maintain the security of your account credentials</li>
            <li>Notify us immediately of any unauthorized access</li>
            <li>Be responsible for all activities under your account</li>
          </ul>
        </div>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">Account Termination</h4>
          <p>
            We reserve the right to suspend or terminate your account at any time for violation of
            these Terms, fraudulent activity, or any other reason we deem appropriate.
          </p>
        </div>
      </>
    ),
  },
  {
    id: "acceptable-use",
    icon: <Ban size={16} />,
    label: "Usage",
    title: "Acceptable Use",
    content: (
      <>
        <p>You agree to use VantaHire only for lawful purposes. You may not:</p>
        <ul className="hr-legal-list">
          <li>Violate any applicable laws or regulations</li>
          <li>Infringe on intellectual property rights of others</li>
          <li>Submit false, misleading, or fraudulent information</li>
          <li>Upload malicious code, viruses, or harmful content</li>
          <li>Attempt to gain unauthorized access to our systems</li>
          <li>Scrape, harvest, or collect user data without permission</li>
          <li>Harass, abuse, or harm other users</li>
          <li>Use automated systems (bots) to access our services</li>
          <li>Reverse engineer or decompile our platform</li>
          <li>Resell or redistribute our services without authorization</li>
        </ul>
      </>
    ),
  },
  {
    id: "intellectual-property",
    icon: <Shield size={16} />,
    label: "IP",
    title: "Content and Intellectual Property",
    content: (
      <>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">Your Content</h4>
          <p>
            You retain ownership of content you submit to VantaHire (resumes, applications, job postings, etc.).
            By submitting content, you grant us a non-exclusive, worldwide, royalty-free license to use,
            store, and display your content for the purpose of providing our services.
          </p>
        </div>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">Our Content</h4>
          <p>
            VantaHire's platform, design, features, and functionality are owned by <a href="https://www.airevolabs.com" target="_blank" rel="noopener noreferrer" className="hr-legal-link">Airevolabs LLP</a> and are protected by copyright, trademark, and other intellectual
            property laws. You may not copy, modify, or distribute our content without permission.
          </p>
        </div>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">AI-Generated Content</h4>
          <p>
            AI-generated fit scores, recommendations, and analysis are provided for informational
            purposes only. We do not guarantee their accuracy and they should not be the sole basis
            for hiring decisions.
          </p>
        </div>
      </>
    ),
  },
  {
    id: "jobs",
    icon: <Briefcase size={16} />,
    label: "Jobs",
    title: "Job Postings and Applications",
    content: (
      <>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">For Recruiters</h4>
          <ul className="hr-legal-list">
            <li>Job postings must be accurate and comply with employment laws</li>
            <li>You may not post discriminatory job listings</li>
            <li>You are responsible for reviewing applications and making hiring decisions</li>
            <li>You must handle candidate data in compliance with privacy laws</li>
            <li>You may not use VantaHire for unlawful recruitment practices</li>
          </ul>
        </div>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">For Candidates</h4>
          <ul className="hr-legal-list">
            <li>Applications must contain truthful and accurate information</li>
            <li>You may not submit fraudulent credentials or resumes</li>
            <li>You understand that applying does not guarantee employment</li>
            <li>You authorize recruiters to view and download your application materials</li>
          </ul>
        </div>
      </>
    ),
  },
  {
    id: "payment",
    icon: <CreditCard size={16} />,
    label: "Payment",
    title: "Payment and Subscriptions",
    content: (
      <>
        <p>
          VantaHire may offer paid features or subscription plans in the future. If you purchase
          a subscription:
        </p>
        <ul className="hr-legal-list">
          <li>Fees are non-refundable except as required by law</li>
          <li>Paid access lasts for the billing term you purchase at checkout</li>
          <li>We may change pricing with advance notice</li>
          <li>You are responsible for completing payment for any future billing term you purchase</li>
        </ul>
      </>
    ),
  },
  {
    id: "disclaimers",
    icon: <AlertTriangle size={16} />,
    label: "Disclaimers",
    title: "Disclaimers and Limitations",
    content: (
      <>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">No Warranty</h4>
          <p>
            VantaHire is provided "as is" without warranties of any kind, either express or implied.
            We do not guarantee that our services will be uninterrupted, error-free, or secure.
          </p>
        </div>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">Limitation of Liability</h4>
          <p>
            To the maximum extent permitted by law, <a href="https://www.airevolabs.com" target="_blank" rel="noopener noreferrer" className="hr-legal-link">Airevolabs LLP</a> shall
            not be liable for any indirect, incidental, special, consequential, or punitive damages
            arising from your use of VantaHire.
          </p>
        </div>
        <div className="hr-legal-subsection">
          <h4 className="hr-legal-h4">Third-Party Services</h4>
          <p>
            VantaHire may integrate with third-party services (Google Cloud, OpenAI, etc.).
            We are not responsible for the availability or content of third-party services.
          </p>
        </div>
        <div className="hr-legal-highlight-box hr-legal-highlight-box--purple">
          <AlertTriangle size={14} />
          <span>Use of VantaHire's AI features is subject to these limitations. Always exercise independent judgement in hiring decisions.</span>
        </div>
      </>
    ),
  },
  {
    id: "indemnification",
    icon: <Gavel size={16} />,
    label: "Indemnity",
    title: "Indemnification",
    content: (
      <>
        <p>
          You agree to indemnify and hold harmless <a href="https://www.airevolabs.com" target="_blank" rel="noopener noreferrer" className="hr-legal-link">Airevolabs LLP</a>,
          its officers, directors, employees, and agents from any claims, damages, losses, or
          expenses arising from:
        </p>
        <ul className="hr-legal-list">
          <li>Your violation of these Terms</li>
          <li>Your violation of any law or regulation</li>
          <li>Your infringement of third-party rights</li>
          <li>Your use of VantaHire</li>
        </ul>
      </>
    ),
  },
  {
    id: "governing-law",
    icon: <FileText size={16} />,
    label: "Law",
    title: "Governing Law and Disputes",
    content: (
      <>
        <p>
          These Terms are governed by the laws of India. Any disputes arising from these Terms or
          your use of VantaHire shall be resolved through binding arbitration in accordance with
          Indian arbitration laws.
        </p>
        <p>
          You agree to waive any right to a jury trial or to participate in a class action lawsuit.
        </p>
      </>
    ),
  },
  {
    id: "severability",
    icon: <Puzzle size={16} />,
    label: "Severability",
    title: "Severability",
    content: (
      <p>
        If any provision of these Terms is found to be unenforceable or invalid, that provision
        will be limited or eliminated to the minimum extent necessary, and the remaining provisions
        will remain in full force and effect.
      </p>
    ),
  },
  {
    id: "contact",
    icon: <Mail size={16} />,
    label: "Contact",
    title: "Contact Information",
    content: (
      <>
        <p>
          If you have questions about these Terms of Service, please contact us:
        </p>
        <div className="hr-legal-contact-card">
          <div className="hr-legal-contact-org">
            <a href="https://www.airevolabs.com" target="_blank" rel="noopener noreferrer">Airevolabs LLP</a>
          </div>
          <div className="hr-legal-contact-row">
            <Mail size={13} />
            <span>legal@vantahire.com</span>
          </div>
          <div className="hr-legal-contact-subject">Subject: Terms of Service Inquiry</div>
        </div>
      </>
    ),
  },
];

export default function TermsOfServicePage() {
  return (
    <>
      <Helmet>
        <title>Terms of Service | VantaHire</title>
        <meta name="description" content="VantaHire Terms of Service. Read our terms and conditions for using our recruiter-first ATS platform." />
        <link rel="canonical" href="https://vantahire.com/terms-of-service" />
        <meta property="og:title" content="Terms of Service | VantaHire" />
        <meta property="og:description" content="Terms and conditions for using VantaHire ATS platform." />
        <meta property="og:url" content="https://vantahire.com/terms-of-service" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://vantahire.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Terms of Service | VantaHire" />
        <meta name="twitter:description" content="Terms and conditions for using VantaHire ATS platform." />
        <meta name="twitter:image" content="https://vantahire.com/twitter-image.jpg" />
      </Helmet>

      <LegalPageLayout
        sectionLabel="Terms of Service"
        heroTitle="Fair terms, clear expectations."
        heroDesc="Please read these terms carefully before using VantaHire. They outline your rights, responsibilities, and the rules that govern our platform."
        lastUpdated="Last Updated: January 2025"
        sections={sections}
      />
    </>
  );
}
