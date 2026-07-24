import GridOverlay from "@/components/GridOverlay";
import HomepageFooter from "@/components/HomepageFooter";
import HomepageNav from "@/components/HomepageNav";
import CTA from "@/components/marketing/sections/CTA";
import { Helmet } from "react-helmet-async";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ReactNode } from "react";

type Props = {
  title: string;
  description: string;
  path: string; // e.g. "/what-is-decision-intelligence"
  headline: string;
  datePublished: string;
  children: ReactNode;
};

export default function ArticleLayout({ title, description, path, headline, datePublished, children }: Props) {
  const isMobile = useIsMobile();
  const url = `https://ealana.com${path}`;
  const jsonLd = JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "@id": `${url}#article`,
      headline,
      url,
      datePublished,
      dateModified: datePublished,
      author: { "@type": "Person", "@id": "https://ealana.com/about#founder", name: "Puneet Kumar", url: "https://www.linkedin.com/in/puneet-gleuck/" },
      publisher: { "@id": "https://ealana.com/#organization" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://ealana.com/" },
        { "@type": "ListItem", position: 2, name: headline, item: url },
      ],
    },
  ]);

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={url} />
        <meta property="og:type" content="article" />
        <script type="application/ld+json">{jsonLd}</script>
      </Helmet>
      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10">
          <HomepageNav />
          <article
            className="e-article mx-auto px-5 sm:px-6"
            style={{ maxWidth: 760, paddingTop: isMobile ? 130 : 170, paddingBottom: isMobile ? 48 : 80 }}
          >
            {children}
          </article>
          <CTA />
          <HomepageFooter />
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        .e-article h1 { font-family: 'Outfit', sans-serif; font-size: clamp(2.1rem, 6vw, 2.9rem); line-height: 1.12; letter-spacing: -0.025em; color: #F4F5FA; font-weight: 600; margin: 0 0 1.5rem; }
        .e-article h2 { font-family: 'Outfit', sans-serif; font-size: clamp(1.45rem, 4vw, 1.75rem); letter-spacing: -0.02em; color: #F4F5FA; font-weight: 600; margin: 2.75rem 0 1rem; }
        .e-article p, .e-article li { font-family: var(--font-body); font-size: 1.02rem; font-weight: 300; line-height: 1.8; color: #A6ADC3; }
        .e-article p { margin: 0 0 1.15rem; }
        .e-article ul { margin: 0 0 1.15rem; padding-left: 1.4rem; }
        .e-article li { margin-bottom: 0.5rem; }
        .e-article strong { color: #E7EAF4; font-weight: 500; }
        .e-article a { color: #4B8EF0; text-decoration: none; }
        .e-article a:hover { text-decoration: underline; }
        .e-article blockquote { margin: 1.75rem 0; padding: 1.25rem 1.5rem; border-left: 3px solid #4B8EF0; background: rgba(75,142,240,0.06); border-radius: 0 12px 12px 0; }
        .e-article blockquote p { margin: 0; color: #DDE2F0; font-weight: 400; font-size: 1.06rem; }
        .e-article table { width: 100%; border-collapse: collapse; font-family: var(--font-body); font-size: 0.92rem; margin: 1.25rem 0 1.75rem; }
        .e-article th { text-align: left; padding: 10px 14px; color: #8891AA; font-weight: 600; font-size: 0.76rem; letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.1); }
        .e-article td { padding: 12px 14px; color: #A6ADC3; font-weight: 300; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: top; line-height: 1.6; }
        .e-article td:first-child { color: #E7EAF4; font-weight: 500; }
        .e-article .table-scroll { overflow-x: auto; }
        .e-article .table-scroll table { min-width: 540px; }
        .e-article .meta-line { font-family: var(--font-body); font-size: 0.8rem; color: #6C7590; margin-bottom: 2.25rem; }
      ` }} />
    </>
  );
}
