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
  "font-mono text-[0.7rem] font-normal tracking-[0.02em] text-e-blue bg-[rgba(75,142,240,0.1)] border border-[rgba(75,142,240,0.15)] py-[3px] px-[10px] rounded-[10px]";

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
          ealana uses essential cookies and browser storage to operate and secure the service.
          Optional analytics technologies load only after you accept analytics in the consent banner.
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
            These cookies are necessary for session-backed parts of the service and its security.
            They support:
          </p>
          <ul className={listCls}>
            <li>User authentication and session management</li>
            <li>Security features and CSRF protection</li>
            <li>Keeping an authenticated session for up to 24 hours</li>
          </ul>
          <div className={cookieNamesCls}>
            <span className={cookieTagCls}>connect.sid</span>
            <span className={cookieTagCls}>__Host-psifi.x-csrf-token</span>
          </div>
        </div>

        <div className={subsectionCls}>
          <h4 className={h4Cls}>2. Analytics Cookies (Optional)</h4>
          <p>
            If you accept analytics, we may load Google Analytics and the Apollo website tracker.
            These services help us understand:
          </p>
          <ul className={listCls}>
            <li>Pages visited and time spent on each page</li>
            <li>Click patterns and navigation paths</li>
            <li>Browser type, device, and screen resolution</li>
            <li>Approximate location derived by the provider</li>
          </ul>
          <p className={noteCls}>Providers: Google Analytics and Apollo website analytics</p>
          <div className={cookieNamesCls}>
            <span className={cookieTagCls}>_ga</span>
            <span className={cookieTagCls}>_ga_*</span>
            <span className={cookieTagCls}>provider-managed identifiers</span>
          </div>
        </div>

        <div className={subsectionCls}>
          <h4 className={h4Cls}>3. Preferences and Local Storage</h4>
          <p>
            We use browser storage for interface preferences and for recording your analytics choice:
          </p>
          <ul className={listCls}>
            <li>Remember whether the application sidebar is open</li>
            <li>Store accepted or declined analytics consent in local storage</li>
            <li>Remember product tours and other interface state</li>
          </ul>
          <div className={cookieNamesCls}>
            <span className={cookieTagCls}>sidebar_state</span>
            <span className={cookieTagCls}>consent.analytics (local storage)</span>
          </div>
        </div>

        <div className={subsectionCls}>
          <h4 className={h4Cls}>4. Operational Monitoring</h4>
          <p>
            We may collect limited technical error and performance information needed to operate,
            secure, and troubleshoot the service. This is operational telemetry, not a promise that
            a separate "performance cookie" is placed on your device. It may include:
          </p>
          <ul className={listCls}>
            <li>Load times and page rendering speed</li>
            <li>Error tracking and debugging</li>
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
          Optional analytics providers may set or read their own cookies or similar identifiers
          after you accept analytics. A provider-hosted payment page may also use cookies under
          that provider's policy when you choose to visit it.
        </p>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Google Analytics</h4>
          <p>
            When analytics is accepted and configured, Google Analytics measures website traffic
            and usage. It may set cookies such as <code>_ga</code> and property-specific
            <code>_ga_*</code> cookies.
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
          <h4 className={h4Cls}>Apollo Website Tracker</h4>
          <p>
            When analytics is accepted and configured, the Apollo website tracker may measure
            visits and interactions using provider-managed browser identifiers.
          </p>
        </div>
        <div className={subsectionCls}>
          <h4 className={h4Cls}>Hosted Payment Pages</h4>
          <p>
            If paid checkout is available and you open a provider-hosted payment page, that separate
            page may use cookies under the payment provider's own policy. Those cookies are not set
            by ealana's application pages.
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
              Some cookies last only for the browser session. The ealana authentication cookie has
              a configured lifetime of up to 24 hours.
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
          <li><strong>Authentication cookie</strong> - Up to 24 hours</li>
          <li><strong>Sidebar preference cookie</strong> - Up to 7 days</li>
          <li><strong>Analytics consent</strong> - Stored in local storage until you reset it or clear site data</li>
          <li><strong>Analytics identifiers</strong> - Provider-managed and removable through your browser controls</li>
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
            When no analytics choice is stored, ealana shows a consent banner. You can accept or
            decline optional analytics. Declining does not load the Google Analytics or Apollo
            website tracker from this consent flow. Essential session and security cookies are not
            controlled by the analytics choice because authenticated service features need them.
          </p>
          <button
            className="inline-flex items-center gap-2 mt-[14px] bg-e-blue text-white border-none rounded-xl font-ui font-medium text-[0.85rem] py-[10px] px-5 cursor-pointer no-underline transition-all duration-200 hover:brightness-110"
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
            Note: Blocking essential cookies may prevent sign-in or other session-backed features.
          </p>
        </div>

        <div className={subsectionCls}>
          <h4 className={h4Cls}>Browser-Specific Instructions</h4>
          <ul className={listCls}>
            <li>
              <strong>Chrome</strong> -{" "}
              <a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer" className={linkCls}>
                Manage cookies in Chrome
              </a>
            </li>
            <li>
              <strong>Firefox</strong> -{" "}
              <a href="https://support.mozilla.org/en-US/kb/cookies-information-websites-store-on-your-computer" target="_blank" rel="noopener noreferrer" className={linkCls}>
                Manage cookies in Firefox
              </a>
            </li>
            <li>
              <strong>Safari</strong> -{" "}
              <a href="https://support.apple.com/guide/safari/manage-cookies-sfri11471/mac" target="_blank" rel="noopener noreferrer" className={linkCls}>
                Manage cookies in Safari
              </a>
            </li>
            <li>
              <strong>Edge</strong> -{" "}
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
          <li>Reset interface preferences and settings</li>
          <li>Affect site functionality and performance</li>
          <li>Require a new analytics choice if you also clear local storage</li>
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
        ealana does not currently use a browser "Do Not Track" signal as the analytics choice for
        this consent flow. You can decline analytics through our consent banner and use browser
        controls to clear cookies and local storage.
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
            Ealana Platforms Private Limited
          </div>
          <div className={contactRowCls}>
            <Mail size={13} />
            <span>info@ealana.com</span>
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
        heroDesc="The cookies, local storage, and consent-based analytics used by ealana, and how to control them."
        lastUpdated="Last Updated: August 26, 2026"
        sections={sections}
      />
    </>
  );
}
