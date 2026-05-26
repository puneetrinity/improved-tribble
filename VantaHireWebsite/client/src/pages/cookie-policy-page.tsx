import { Helmet } from "react-helmet-async";
import { Cookie, Settings, BarChart3, Shield, Trash2, Clock, Globe, Mail } from "lucide-react";
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
  legalInfoGridCls as infoGridCls,
  legalInfoItemCls as infoItemCls,
  legalInfoLabelCls as infoLabelCls,
  legalInfoDescCls as infoDescCls,
} from "@/lib/shared-styles";

const cookieNamesCls = "flex flex-wrap gap-[6px] mt-[10px]";
const cookieTagCls =
  "font-mono text-[0.7rem] font-normal tracking-[0.02em] text-hr-accent-hover bg-[rgba(124,58,237,0.1)] border border-[rgba(124,58,237,0.15)] py-[3px] px-[10px] rounded-[3px]";

const sections: LegalSection[] = [
  {
    id: "what-are-cookies",
    icon: <Cookie size={16} />,
    label: "Overview",
    title: "What Are Cookies?",
    content: (
      <>
        <p>
          Cookies are small text files that are placed on your device when you visit a website.
          They are widely used to make websites work more efficiently and provide a better user experience.
        </p>
        <p>
          ealana uses cookies and similar tracking technologies to enhance your experience,
          analyse usage, and provide personalised features.
        </p>
      </>
    ),
  },
  {
    id: "types-of-cookies",
    icon: <Settings size={16} />,
    label: "Types",
    title: "Types of Cookies We Use",
    content: (
      <>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>1. Essential Cookies (Always Active)</h4>
          <p>
            These cookies are necessary for the website to function and cannot be disabled.
            They enable core functionality such as:
          </p>
          <ul className={listCls}>
            <li>User authentication and session management</li>
            <li>Security features and CSRF protection</li>
            <li>Remember your login status</li>
            <li>Shopping cart functionality (if applicable)</li>
          </ul>
          <div className={cookieNamesCls}>
            <span className={cookieTagCls}>session_id</span>
            <span className={cookieTagCls}>csrf_token</span>
          </div>
        </div>

        <div className={subsectionCls}>
          <h4 className={h4Cls}>2. Analytics Cookies (Optional)</h4>
          <p>
            These cookies help us understand how visitors use our platform by collecting
            anonymous information about:
          </p>
          <ul className={listCls}>
            <li>Pages visited and time spent on each page</li>
            <li>Click patterns and navigation paths</li>
            <li>Browser type, device, and screen resolution</li>
            <li>Geographic location (country/city level)</li>
          </ul>
          <p className={noteCls}>Service provider: Google Analytics</p>
          <div className={cookieNamesCls}>
            <span className={cookieTagCls}>_ga</span>
            <span className={cookieTagCls}>_gid</span>
            <span className={cookieTagCls}>_gat</span>
          </div>
        </div>

        <div className={subsectionCls}>
          <h4 className={h4Cls}>3. Functional Cookies (Optional)</h4>
          <p>
            These cookies enable enhanced functionality and personalisation:
          </p>
          <ul className={listCls}>
            <li>Remember your preferences (language, theme)</li>
            <li>Store your cookie consent choices</li>
            <li>Personalise content based on your role (candidate/recruiter)</li>
            <li>Remember form inputs to prevent data loss</li>
          </ul>
          <div className={cookieNamesCls}>
            <span className={cookieTagCls}>cookie_consent</span>
            <span className={cookieTagCls}>user_preferences</span>
          </div>
        </div>

        <div className={subsectionCls}>
          <h4 className={h4Cls}>4. Performance Cookies (Optional)</h4>
          <p>
            These cookies help us monitor and improve platform performance:
          </p>
          <ul className={listCls}>
            <li>Load times and page rendering speed</li>
            <li>Error tracking and debugging</li>
            <li>A/B testing for feature improvements</li>
            <li>Server response times</li>
          </ul>
        </div>
      </>
    ),
  },
  {
    id: "third-party-cookies",
    icon: <BarChart3 size={16} />,
    label: "Third-Party",
    title: "Third-Party Cookies",
    content: (
      <>
        <p>
          We use third-party services that may set their own cookies on your device:
        </p>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Google Analytics</h4>
          <p>
            We use Google Analytics to analyse website traffic and user behaviour. Google Analytics
            sets cookies to track sessions and collect anonymous usage data.
          </p>
          <p>
            Learn more:{" "}
            <a
              href="https://policies.google.com/technologies/cookies"
              target="_blank"
              rel="noopener noreferrer"
              className={linkCls}
            >
              Google Cookie Policy
            </a>
          </p>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Google Cloud Platform</h4>
          <p>
            We use Google Cloud for hosting and file storage. Google may set cookies for
            authentication and performance monitoring.
          </p>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>OpenAI API</h4>
          <p>
            Our AI-powered features use OpenAI's API. While OpenAI does not set cookies directly
            on our site, your data is processed by their servers in accordance with their privacy policy.
          </p>
        </div>
      </>
    ),
  },
  {
    id: "cookie-duration",
    icon: <Clock size={16} />,
    label: "Duration",
    title: "Cookie Duration",
    content: (
      <>
        <div className={infoGridCls}>
          <div className={infoItemCls}>
            <span className={infoLabelCls}>Session Cookies</span>
            <span className={infoDescCls}>
              Temporary cookies that are deleted when you close your browser. Used for authentication
              and session management.
            </span>
          </div>
          <div className={infoItemCls}>
            <span className={infoLabelCls}>Persistent Cookies</span>
            <span className={infoDescCls}>
              Remain on your device for a set period or until manually deleted.
            </span>
          </div>
        </div>
        <ul className={listCls}>
          <li><strong>Analytics cookies</strong> â€” Up to 2 years</li>
          <li><strong>Preference cookies</strong> â€” Up to 1 year</li>
          <li><strong>Consent cookies</strong> â€” Up to 1 year</li>
        </ul>
      </>
    ),
  },
  {
    id: "managing-preferences",
    icon: <Shield size={16} />,
    label: "Manage",
    title: "Managing Your Cookie Preferences",
    content: (
      <>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Cookie Consent Banner</h4>
          <p>
            When you first visit ealana, you will see a cookie consent banner. You can choose
            to accept or decline optional cookies. Essential cookies cannot be disabled as they
            are necessary for the site to function.
          </p>
          <button
            className="inline-flex items-center gap-2 mt-[14px] bg-hr-accent text-white border-none rounded-none font-dm font-medium text-[0.85rem] py-[10px] px-5 cursor-pointer no-underline transition-colors duration-200 hover:bg-hr-accent-hover"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('cookie-consent:open', { detail: { reset: true } }));
            }}
          >
            <Settings size={14} />
            Manage Cookie Preferences
          </button>
        </div>

        <div className={subsectionCls}>
          <h4 className={h4Cls}>Browser Settings</h4>
          <p>
            Most browsers allow you to control cookies through their settings. You can:
          </p>
          <ul className={listCls}>
            <li>Block all cookies</li>
            <li>Block third-party cookies only</li>
            <li>Delete cookies after each session</li>
            <li>Set exceptions for specific websites</li>
          </ul>
          <p className={noteCls}>
            Note: Blocking essential cookies may prevent you from using ealana.
          </p>
        </div>

        <div className={subsectionCls}>
          <h4 className={h4Cls}>Browser-Specific Instructions</h4>
          <ul className={listCls}>
            <li>
              <strong>Chrome</strong> â€”{" "}
              <a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className={linkCls}>
                Manage cookies in Chrome
              </a>
            </li>
            <li>
              <strong>Firefox</strong> â€”{" "}
              <a href="https://support.mozilla.org/en-US/kb/cookies-information-websites-store-on-your-computer" target="_blank" rel="noopener noreferrer" className={linkCls}>
                Manage cookies in Firefox
              </a>
            </li>
            <li>
              <strong>Safari</strong> â€”{" "}
              <a href="https://support.apple.com/guide/safari/manage-cookies-sfri11471/mac" target="_blank" rel="noopener noreferrer" className={linkCls}>
                Manage cookies in Safari
              </a>
            </li>
            <li>
              <strong>Edge</strong> â€”{" "}
              <a href="https://support.microsoft.com/en-us/microsoft-edge/delete-cookies-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09" target="_blank" rel="noopener noreferrer" className={linkCls}>
                Manage cookies in Edge
              </a>
            </li>
          </ul>
        </div>
      </>
    ),
  },
  {
    id: "deleting-cookies",
    icon: <Trash2 size={16} />,
    label: "Deleting",
    title: "Deleting Cookies",
    content: (
      <>
        <p>
          You can delete cookies at any time through your browser settings. However, this may:
        </p>
        <ul className={listCls}>
          <li>Log you out of your account</li>
          <li>Reset your preferences and settings</li>
          <li>Affect site functionality and performance</li>
          <li>Require you to accept the cookie banner again</li>
        </ul>
      </>
    ),
  },
  {
    id: "do-not-track",
    icon: <Globe size={16} />,
    label: "DNT",
    title: "Do Not Track (DNT)",
    content: (
      <p>
        Some browsers include a "Do Not Track" (DNT) feature. Currently, there is no industry
        standard for responding to DNT signals. ealana does not currently respond to DNT
        signals, but you can manage your cookie preferences through our consent banner.
      </p>
    ),
  },
  {
    id: "changes",
    icon: <Clock size={16} />,
    label: "Changes",
    title: "Changes to This Policy",
    content: (
      <p>
        We may update this Cookie Policy from time to time to reflect changes in technology,
        legislation, or our practices. We will notify you of any significant changes by updating
        the "Last Updated" date at the top of this page.
      </p>
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
          If you have questions about our use of cookies, please contact us:
        </p>
        <div className={contactCardCls}>
          <div className={contactOrgCls}>
            <a href="https://www.airevolabs.com" target="_blank" rel="noopener noreferrer">Airevolabs LLP</a>
          </div>
          <div className={contactRowCls}>
            <Mail size={13} />
            <span>privacy@ealana.com</span>
          </div>
          <div className={contactSubjectCls}>Subject: Cookie Policy Inquiry</div>
        </div>
      </>
    ),
  },
];

export default function CookiePolicyPage() {
  return (
    <>
      <Helmet>
        <title>Cookie Policy | ealana</title>
        <meta name="description" content="ealana Cookie Policy. Learn about the cookies we use and how to manage your preferences." />
        <link rel="canonical" href="https://ealana.com/cookie-policy" />
        <meta property="og:title" content="Cookie Policy | ealana" />
        <meta property="og:description" content="Learn about cookies used on ealana and manage your preferences." />
        <meta property="og:url" content="https://ealana.com/cookie-policy" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://ealana.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Cookie Policy | ealana" />
        <meta name="twitter:description" content="Learn about cookies used on ealana and manage your preferences." />
        <meta name="twitter:image" content="https://ealana.com/twitter-image.jpg" />
      </Helmet>

      <LegalPageLayout
        sectionLabel="Cookie Policy"
        heroTitle="How we use cookies."
        heroDesc="We use cookies to improve your experience and analyse how our platform is used. Here's everything you need to know."
        lastUpdated="Last Updated: January 2025"
        sections={sections}
      />
    </>
  );
}
