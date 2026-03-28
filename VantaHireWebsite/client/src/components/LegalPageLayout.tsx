import { useEffect, useRef, useState } from "react";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";

export interface LegalSection {
  id: string;
  icon: React.ReactNode;
  label: string;
  title: string;
  content: React.ReactNode;
}

interface LegalPageLayoutProps {
  sectionLabel: string;
  heroTitle: string;
  heroDesc: string;
  lastUpdated: string;
  sections: LegalSection[];
  children?: React.ReactNode;
}

/* ── Reusable class-name constants ── */
const sidebarLinkBase =
  "flex items-center gap-2 py-[7px] px-[10px] text-[0.78rem] font-normal text-hr-text-muted no-underline rounded-[4px] transition-colors duration-200";
const sidebarLinkHover = "hover:text-hr-text-secondary hover:bg-white/[0.03]";
const sidebarLinkActive = "text-hr-accent-hover bg-[rgba(124,58,237,0.08)]";

const sectionIconBox =
  "flex items-center justify-center w-[30px] h-[30px] rounded-[6px] bg-[rgba(124,58,237,0.1)] text-hr-accent-hover shrink-0";

const sectionTitleCls =
  "font-satoshi text-[1.35rem] font-medium text-hr-text tracking-[-0.01em]";

const sectionBodyCls = "text-hr-text-secondary text-[0.92rem] leading-[1.75] [&>p]:mb-3 [&>p:last-child]:mb-0";

export default function LegalPageLayout({
  sectionLabel,
  heroTitle,
  heroDesc,
  lastUpdated,
  sections,
}: LegalPageLayoutProps) {
  const [activeSection, setActiveSection] = useState<string>("");
  const sectionsRef = useRef<NodeListOf<Element> | null>(null);

  useEffect(() => {
    sectionsRef.current = document.querySelectorAll("[data-legal-section]");
    const handleScroll = () => {
      let current = "";
      sectionsRef.current?.forEach((section) => {
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

  return (
    <div className="font-dm leading-normal bg-hr-bg text-hr-text antialiased public-theme min-h-screen">
      <GridOverlay />
      <div className="relative z-10">
        <HomepageNav />

        {/* Hero */}
        <div className="pt-[140px] px-12 pb-[60px] text-center max-w-[1100px] mx-auto animate-hr-fade-up max-md:pt-[100px] max-md:px-5 max-md:pb-10">
          <div className="font-mono text-[0.68rem] font-medium text-hr-accent-hover tracking-[0.12em] uppercase mb-[14px]">{sectionLabel}</div>
          <h1 className="font-satoshi text-[clamp(2.4rem,5vw,3.4rem)] font-normal leading-[1.2] tracking-[-0.01em] mb-5 text-hr-text">{heroTitle}</h1>
          <p className="text-base leading-[1.7] text-hr-text-secondary mx-auto max-w-[520px]">{heroDesc}</p>
          <div className="font-mono text-[0.7rem] tracking-[0.08em] text-hr-text-muted mt-6 uppercase">
            {lastUpdated}
          </div>
        </div>

        {/* Content */}
        <div className="grid grid-cols-[200px_1fr] gap-12 max-w-[1100px] mx-auto px-12 pb-[100px] max-md:grid-cols-1 max-md:gap-0 max-md:px-5 max-md:pb-[60px]">
          {/* Sidebar Navigation */}
          <aside className="relative max-md:hidden">
            <div className="sticky top-[80px]">
              <div className="font-mono text-[0.6rem] font-medium tracking-[0.12em] uppercase text-hr-text-muted mb-4 pl-1">
                On this page
              </div>
              <nav className="flex flex-col gap-[2px]">
                {sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className={`${sidebarLinkBase} ${sidebarLinkHover} ${
                      activeSection === section.id ? sidebarLinkActive : ""
                    }`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    <span
                      className={`flex items-center shrink-0 ${
                        activeSection === section.id ? "opacity-100" : "opacity-60"
                      }`}
                    >
                      {section.icon}
                    </span>
                    <span>{section.label}</span>
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="flex flex-col">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                data-legal-section
                className="py-9 border-b border-white/[0.06] last:border-b-0"
                style={{
                  animation: `hr-fade-up 0.6s ease-out ${index * 0.05}s both`,
                }}
              >
                <div className="flex items-center gap-[10px] mb-5">
                  <span className={sectionIconBox}>{section.icon}</span>
                  <h2 className={sectionTitleCls}>{section.title}</h2>
                </div>
                <div className={sectionBodyCls}>
                  {section.content}
                </div>
              </section>
            ))}
          </main>
        </div>

        <HomepageFooter />
      </div>
    </div>
  );
}
