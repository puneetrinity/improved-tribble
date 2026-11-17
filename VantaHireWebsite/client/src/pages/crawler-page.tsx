import { Helmet } from "react-helmet-async";
import { Bot, FileText, ShieldCheck, Gauge, Ban, Mail } from "lucide-react";
import LegalPageLayout, { type LegalSection } from "@/components/LegalPageLayout";
import {
  legalListCls as listCls,
  legalNoteCls as noteCls,
  legalContactCardCls as contactCardCls,
  legalContactOrgCls as contactOrgCls,
  legalContactRowCls as contactRowCls,
  legalContactSubjectCls as contactSubjectCls,
} from "@/lib/shared-styles";

const codeCls =
  "font-mono text-[0.78rem] leading-relaxed text-e-blue bg-[rgba(75,142,240,0.08)] border border-[rgba(75,142,240,0.15)] rounded-[10px] py-[10px] px-[14px] my-[12px] overflow-x-auto whitespace-pre";

const sections: LegalSection[] = [
  {
    id: "what-it-is",
    icon: <Bot size={16} />,
    label: "Overview",
    title: "What EalanaJobsBot is",
    content: (
      <>
        <p>
          EalanaJobsBot is the crawler operated by Ealana Platforms Private Limited. It reads job
          postings that employers have published on their public careers pages, so that ealana can
          show those openings to job seekers and send them to the employer&apos;s own page to apply.
        </p>
        <p>Every request it sends carries this identity:</p>
        <pre className={codeCls}>
          EalanaJobsBot/1.0 (+https://ealana.com/crawler; crawler@ealana.com)
        </pre>
      </>
    ),
  },
  {
    id: "what-it-reads",
    icon: <FileText size={16} />,
    label: "What it reads",
    title: "What it reads, and what it does not",
    content: (
      <>
        <p>It reads only what a visitor to a public careers page can see without signing in:</p>
        <ul className={listCls}>
          <li>Job title, description, location and job reference</li>
          <li>Posting and closing dates, where the page shows them</li>
          <li>The link to the employer&apos;s own job page and application page</li>
        </ul>
        <p>It does not:</p>
        <ul className={listCls}>
          <li>Sign in, create accounts, or go behind a login</li>
          <li>Submit applications or any other form</li>
          <li>Read applicant, candidate or employee records</li>
        </ul>
      </>
    ),
  },
  {
    id: "how-it-behaves",
    icon: <Gauge size={16} />,
    label: "Behaviour",
    title: "How it behaves on your site",
    content: (
      <ul className={listCls}>
        <li>
          It reads <code>robots.txt</code> for each site and follows the rules for{" "}
          <code>EalanaJobsBot</code>, or for <code>*</code> when it is not named.
        </li>
        <li>It follows a <code>Crawl-delay</code> when your <code>robots.txt</code> sets one.</li>
        <li>It spaces its requests to each site instead of sending them in bursts.</li>
        <li>
          When a site answers &quot;429 Too Many Requests&quot; or &quot;503 Service Unavailable&quot;, it stops
          and waits. It waits for the time in <code>Retry-After</code> when one is given, and
          longer after repeated refusals.
        </li>
      </ul>
    ),
  },
  {
    id: "control",
    icon: <Ban size={16} />,
    label: "Your controls",
    title: "How to slow it down or stop it",
    content: (
      <>
        <p>To stop EalanaJobsBot from reading your site, add this to your <code>robots.txt</code>:</p>
        <pre className={codeCls}>{"User-agent: EalanaJobsBot\nDisallow: /"}</pre>
        <p>To slow it down, set a delay in seconds between requests:</p>
        <pre className={codeCls}>{"User-agent: EalanaJobsBot\nCrawl-delay: 10"}</pre>
        <p className={noteCls}>
          You can also write to us. Tell us the careers page address, and we will stop collecting
          from it and remove its jobs from ealana.
        </p>
      </>
    ),
  },
  {
    id: "corrections",
    icon: <ShieldCheck size={16} />,
    label: "Corrections",
    title: "Wrong or out-of-date job information",
    content: (
      <p>
        Jobs are re-read regularly and removed after the employer&apos;s page stops listing them. If
        ealana shows a job of yours that is wrong or has closed, write to us with the job link and
        we will correct or remove it.
      </p>
    ),
  },
  {
    id: "contact",
    icon: <Mail size={16} />,
    label: "Contact",
    title: "Contact",
    content: (
      <>
        <p>For anything about the crawler, including opt-out requests:</p>
        <div className={contactCardCls}>
          <div className={contactOrgCls}>Ealana Platforms Private Limited</div>
          <div className={contactRowCls}>
            <Mail size={13} />
            <span>crawler@ealana.com</span>
          </div>
          <div className={contactSubjectCls}>Subject: EalanaJobsBot</div>
        </div>
      </>
    ),
  },
];

export default function CrawlerPage() {
  return (
    <>
      <Helmet>
        <title>EalanaJobsBot | ealana</title>
        <meta name="description" content="What the EalanaJobsBot crawler reads, how it behaves, and how site owners can slow it down or stop it." />
        <link rel="canonical" href="https://ealana.com/crawler" />
        <meta property="og:title" content="EalanaJobsBot | ealana" />
        <meta property="og:description" content="What the EalanaJobsBot crawler reads, how it behaves, and how to control it." />
        <meta property="og:url" content="https://ealana.com/crawler" />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="https://ealana.com/og-image.jpg" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="EalanaJobsBot | ealana" />
        <meta name="twitter:description" content="What the EalanaJobsBot crawler reads, how it behaves, and how to control it." />
        <meta name="twitter:image" content="https://ealana.com/twitter-image.jpg" />
      </Helmet>

      <LegalPageLayout
        sectionLabel="Crawler"
        heroTitle="About EalanaJobsBot."
        heroDesc="What our job-posting crawler reads, how it behaves on your site, and how to slow it down or stop it."
        lastUpdated="Last Updated: November 17, 2026"
        sections={sections}
      />
    </>
  );
}
