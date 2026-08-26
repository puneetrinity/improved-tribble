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
          This policy describes our data practices. Ordinary use is not treated as a substitute
          for a separate choice or other authority where one is required. Our{" "}
          <a href="/terms-of-service" className={linkCls}>Terms of Service</a> govern use of
          the platform.
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
          <p>
            We may receive personal information from you, a recruiter or employer, or an
            authorized recruitment source. Depending on how you use the service, this may include:
          </p>
          <ul className={listCls}>
            <li>Name, email address, and contact information</li>
            <li>Resume/CV and professional credentials</li>
            <li>Employment history and educational background</li>
            <li>Skills, certifications, and professional qualifications</li>
            <li>Professional profile links and information made available for recruitment</li>
            <li>Application responses and form submissions</li>
            <li>Recruitment workflow information, such as application status and communications</li>
          </ul>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Automatically Collected Information</h4>
          <ul className={listCls}>
            <li>IP address, browser type, and device information</li>
            <li>Usage data and interaction patterns</li>
            <li>Session, security, and preference information stored in cookies or local storage</li>
            <li>Analytics data when you allow optional analytics technologies</li>
          </ul>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>AI-Generated Data</h4>
          <p>
            Our platform may use AI to analyse resumes, assist with recruitment workflows, and
            match candidates with jobs. This may generate fit scores, summaries, or recommendations
            stored with recruitment data. These outputs assist people; they should not be the sole
            basis for a hiring decision.
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
          <li>Matching candidates with suitable job opportunities where permitted</li>
          <li>Communicating with you about your applications and our services</li>
          <li>Providing AI-powered resume analysis and job fit scoring</li>
          <li>Improving our platform and user experience</li>
          <li>Sending notifications about application status updates</li>
          <li>Measuring and improving the service, including consented analytics</li>
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
            When you apply for a job, your application data, resume, and related recruitment
            analysis are made available to the organization handling that application. Authorized
            members of that organization may view, download, and manage the application through
            organization-scoped workflows. Organizations are not authorized to use another
            organization's private recruitment history.
          </p>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Service Providers</h4>
          <p>
            We use service providers to operate the platform. They may process information on our
            behalf for:
          </p>
          <ul className={listCls}>
            <li>Cloud hosting, file storage, databases, and queues</li>
            <li>Email, messaging, and other communications</li>
            <li>Payments, where paid checkout is available</li>
            <li>Consent-based analytics and operational error monitoring</li>
            <li>AI inference and related technical processing</li>
          </ul>
          <p>
            The information made available to a provider depends on the feature and service it
            supports. Provider terms and privacy commitments apply where relevant.
          </p>
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
          We use technical and organizational safeguards designed to protect your information,
          including:
        </p>
        <div className={securityGridCls}>
          {[
            { label: "HTTPS/TLS", desc: "Encrypted data transmission" },
            { label: "Sessions", desc: "Protected authentication cookies" },
            { label: "Requests", desc: "CSRF controls on covered session routes" },
            { label: "Access", desc: "Scoped controls on covered routes" },
            { label: "Data", desc: "Restricted database credentials" },
            { label: "Recovery", desc: "Managed backups and release controls" },
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
    label: "Choices",
    title: "Your Choices and Requests",
    content: (
      <>
        <p>
          Depending on your relationship with ealana and applicable requirements, you may ask us to:
        </p>
        <div className={rightsGridCls}>
          {[
            { right: "Access inquiry", desc: "Ask what personal information we process about you" },
            { right: "Correction", desc: "Ask us to correct inaccurate or incomplete information" },
            { right: "Erasure review", desc: "Ask us to restrict active use and review data for erasure" },
            { right: "Global matching opt-out", desc: "Stop new global matching and recommendations" },
            { right: "Application withdrawal", desc: "Withdraw an application through its organization workflow" },
            { right: "Privacy grievance", desc: "Contact us if a privacy control or response needs review" },
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
        <p>
          Withdrawing an application, leaving an organization's talent pool, stopping future global matching,
          and requesting erasure review are different actions. Withdrawing an application does not itself erase
          a profile. A recruiter can remove only its own organization's pool membership and cannot create a global
          opt-out or erasure request on the candidate's behalf.
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
          We retain personal information to provide the service, protect its integrity, support existing
          organization workflows, maintain security and audit records, and meet applicable requirements.
          Final per-data-class retention periods are not yet automated. Our current controls restrict active
          use and place an erasure request into protected review; automated hard-deletion schedules are not
          yet part of this control.
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
          We use essential cookies and local storage to operate and secure the service. Optional
          analytics technologies load only after you accept them.
          For detailed information, please see our{" "}
          <a href="/cookie-policy" className={linkCls}>Cookie Policy</a>.
        </p>
        <p>
          You can change your analytics choice through Cookie Preferences and manage cookies or
          local storage through your browser settings.
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
        child, we will restrict active use and address it through our verified privacy process.
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
          Where required, we will provide additional notice or obtain a new choice before a
          materially different use of personal information.
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
          If you have questions or want to make an access, correction, matching opt-out, erasure-review,
          or privacy-grievance request, please contact us:
        </p>
        <div className={contactCardCls}>
          <div className={contactOrgCls}>
            Ealana Platforms Private Limited
          </div>
          <div className={contactRowCls}>
            <Mail size={13} />
            <span>info@ealana.com</span>
          </div>
          <div className={contactSubjectCls}>Subject: Privacy Request — Access / Correction / Opt-out / Erasure</div>
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
        heroDesc="How ealana collects, uses, shares, protects, retains, and responds to requests about personal information."
        lastUpdated="Last Updated: August 26, 2026"
        sections={sections}
      />
    </>
  );
}
