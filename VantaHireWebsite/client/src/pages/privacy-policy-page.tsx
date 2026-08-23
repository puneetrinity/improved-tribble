import { Helmet } from "react-helmet-async";
import { Shield, Database, Eye, Lock, Mail, UserCheck, Clock, Cookie, Baby, FileText } from "lucide-react";
import LegalPageLayout, { type LegalSection } from "@/components/LegalPageLayout";
import {
  legalSubsectionCls as subsectionCls,
  legalH4Cls as h4Cls,
  legalListCls as listCls,
  legalLinkCls as linkCls,
  legalNoteCls as noteCls,
  legalContactCardCls as contactCardCls,
  legalContactOrgCls as contactOrgCls,
  legalContactRowCls as contactRowCls,
  legalContactSubjectCls as contactSubjectCls,
  legalInfoItemCls as infoItemCls,
  legalInfoLabelCls as infoLabelCls,
  legalInfoDescCls as infoDescCls,
} from "@/lib/shared-styles";

const highlightBoxGreen =
  "flex items-center gap-[10px] py-[14px] px-[18px] rounded-[14px] text-[0.88rem] mt-4 bg-[rgba(52,209,122,0.08)] border border-[rgba(52,209,122,0.18)] text-e-green";

const infoGridCls =
  "grid grid-cols-2 gap-px bg-white/[0.06] border border-white/[0.06] rounded-lg overflow-hidden my-4 max-md:grid-cols-2 max-sm:grid-cols-1";
const securityGridCls =
  "grid grid-cols-3 gap-px bg-white/[0.06] border border-white/[0.06] rounded-lg overflow-hidden my-4 max-md:grid-cols-2 max-sm:grid-cols-1";

const rightsGridCls =
  "grid grid-cols-2 gap-[10px] my-3 mb-4 max-md:grid-cols-1";
const rightItemCls =
  "flex flex-col gap-[3px] p-[14px] bg-white/[0.04] border border-white/[0.08] rounded-[14px] backdrop-blur-xl";
const rightNameCls = "font-mono text-[0.72rem] font-medium tracking-[0.04em] text-e-text";
const rightDescCls = "text-[0.82rem] text-e-text3 leading-[1.4]";

const sections: LegalSection[] = [
  {
    id: "introduction",
    icon: <Shield size={16} />,
    label: "Overview",
    title: "Introduction",
    content: (
      <>
        <p>
          ealana, operated by Ealana Platforms Private Limited ("we," "our," or "us"),
          is committed to protecting your privacy. This Privacy Policy explains how we collect,
          use, disclose, and safeguard your information when you use our applicant tracking system
          and recruitment platform.
        </p>
        <p>
          By using ealana, you agree to the collection and use of information in accordance
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
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Personal Information</h4>
          <p>When you register or use our services, we may collect:</p>
          <ul className={listCls}>
            <li>Name, email address, and contact information</li>
            <li>Resume/CV and professional credentials</li>
            <li>Employment history and educational background</li>
            <li>Skills, certifications, and professional qualifications</li>
            <li>LinkedIn profile and other professional social media links</li>
            <li>Application responses and form submissions</li>
          </ul>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Automatically Collected Information</h4>
          <ul className={listCls}>
            <li>IP address, browser type, and device information</li>
            <li>Usage data and interaction patterns</li>
            <li>Cookies and similar tracking technologies</li>
            <li>Analytics data about how you use our platform</li>
          </ul>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>AI-Generated Data</h4>
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
        <ul className={listCls}>
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
        <div className={subsectionCls}>
          <h4 className={h4Cls}>With Recruiters and Employers</h4>
          <p>
            When you apply for a job, your application data, resume, and AI fit scores are shared
            with the recruiter or employer posting that position. They can view, download, and
            manage your application through our platform.
          </p>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Service Providers</h4>
          <p>We may share your information with trusted third-party service providers who assist us in:</p>
          <ul className={listCls}>
            <li>Cloud storage and hosting (Google Cloud Storage)</li>
            <li>Email delivery services</li>
            <li>Analytics and performance monitoring</li>
            <li>AI and machine learning services (OpenAI API)</li>
          </ul>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Legal Requirements</h4>
          <p>
            We may disclose your information if required by law, court order, or government request,
            or to protect our rights, property, or safety.
          </p>
        </div>
        <div className={highlightBoxGreen}>
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
        <div className={securityGridCls}>
          {[
            { label: "HTTPS/TLS", desc: "Encrypted data transmission" },
            { label: "Auth", desc: "Secure authentication & sessions" },
            { label: "CSRF", desc: "Protection on all state changes" },
            { label: "Audits", desc: "Regular security assessments" },
            { label: "RBAC", desc: "Role-based access controls" },
            { label: "GCP", desc: "Google Cloud Platform storage" },
          ].map((item) => (
            <div key={item.label} className={infoItemCls}>
              <span className={infoLabelCls}>{item.label}</span>
              <span className={infoDescCls}>{item.desc}</span>
            </div>
          ))}
        </div>
        <p className={noteCls}>
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
        <div className={rightsGridCls}>
          {[
            { right: "Access", desc: "Request a copy of your personal data" },
            { right: "Rectification", desc: "Correct inaccurate or incomplete information" },
            { right: "Erasure review", desc: "Ask us to restrict active use and review data for erasure" },
            { right: "Portability", desc: "Receive your data in a structured, machine-readable format" },
            { right: "Objection", desc: "Object to certain types of data processing" },
            { right: "Global matching opt-out", desc: "Stop new global matching and recommendations" },
          ].map((item) => (
            <div key={item.right} className={rightItemCls}>
              <span className={rightNameCls}>{item.right}</span>
              <span className={rightDescCls}>{item.desc}</span>
            </div>
          ))}
        </div>
        <p>
          Signed-in candidates can use <a href="/my-dashboard?tab=privacy" className={linkCls}>Privacy &amp; Data</a>.
          If you cannot sign in, contact us using the support path below. A request immediately restricts the
          covered active use and places it in a reversible quarantine while secure delivery and review continue;
          it is not a promise of immediate hard deletion.
        </p>
        <p>
          Stopping global matching prevents new cross-organization matching, recommendations and promotion.
          Existing organization-private application, workflow and audit records may remain restricted to the
          organization that already received them.
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
          We retain personal information only as needed to provide the service, protect its integrity,
          support existing organization workflows and meet applicable requirements. Our current controls
          restrict active use and place an erasure request into protected review; automated hard-deletion
          schedules are not yet part of this control.
        </p>
        <ul className={listCls}>
          <li><strong>Candidate controls</strong> - Global matching can be stopped and active profile use can be restricted for erasure review</li>
          <li><strong>Existing applications</strong> - Organization-private workflow and audit records may remain restricted rather than being immediately destroyed</li>
          <li><strong>Hard deletion</strong> - Any later destructive action follows a separately reviewed retention and authority process</li>
          <li><strong>Support</strong> - Contact us if the signed-in Privacy &amp; Data controls are unavailable</li>
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
          <a href="/cookie-policy" className={linkCls}>Cookie Policy</a>.
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
        ealana is not intended for individuals under the age of 18. We do not knowingly collect
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
          Your continued use of ealana after changes are posted constitutes acceptance of the updated policy.
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
        <div className={contactCardCls}>
          <div className={contactOrgCls}>
            Ealana Platforms Private Limited
          </div>
          <div className={contactRowCls}>
            <Mail size={13} />
            <span>info@ealana.com</span>
          </div>
          <div className={contactSubjectCls}>Subject: Privacy Policy Inquiry</div>
        </div>
      </>
    ),
  },
];

export default function PrivacyPolicyPage() {
  return (
    <>
      <Helmet>
        <title>Privacy Policy | ealana</title>
        <meta name="description" content="ealana Privacy Policy. Learn how we collect, use, and protect your personal information when using our recruiter-first ATS platform." />
        <link rel="canonical" href="https://ealana.com/privacy-policy" />
        <meta property="og:title" content="Privacy Policy | ealana" />
        <meta property="og:description" content="Learn how ealana protects your privacy and handles your data." />
        <meta property="og:url" content="https://ealana.com/privacy-policy" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://ealana.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Privacy Policy | ealana" />
        <meta name="twitter:description" content="Learn how ealana protects your privacy and handles your data." />
        <meta name="twitter:image" content="https://ealana.com/twitter-image.jpg" />
      </Helmet>

      <LegalPageLayout
        sectionLabel="Privacy Policy"
        heroTitle="Your data, your trust."
        heroDesc="We take your privacy seriously. Here's everything you need to know about how we collect, use, and protect your information."
        lastUpdated="Last Updated: August 2026"
        sections={sections}
      />
    </>
  );
}
