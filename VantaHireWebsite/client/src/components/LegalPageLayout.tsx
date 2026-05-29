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

const sidebarLinkBase =
  "flex items-center gap-2 py-[8px] px-[12px] text-[0.78rem] font-normal text-e-text3 no-underline rounded-xl transition-colors duration-200";
const sidebarLinkHover = "hover:text-e-text2 hover:bg-white/[0.03]";
const sidebarLinkActive = "text-e-blue bg-[rgba(75,142,240,0.1)]";

const sectionIconBox =
  "flex items-center justify-center w-[34px] h-[34px] rounded-xl bg-[rgba(75,142,240,0.12)] text-e-blue shrink-0";

const sectionTitleCls =
  "font-display text-[1.45rem] font-medium text-e-text tracking-[-0.02em]";

const sectionBodyCls = "text-e-text2 text-sm leading-[1.8] [&>p]:mb-3 [&>p:last-child]:mb-0";

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
    <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
      <GridOverlay />
      <div className="relative z-10">
        <HomepageNav />

        <div className="relative pt-[140px] px-12 pb-[60px] text-center max-w-[1100px] mx-auto animate-hr-fade-up max-md:pt-[100px] max-md:px-5 max-md:pb-10">
          <div
            className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[760px] -translate-x-1/2"
            style={{
              background: "radial-gradient(ellipse, rgba(75,142,240,0.12) 0%, rgba(52,209,122,0.05) 42%, transparent 72%)",
              filter: "blur(80px)",
            }}
          />
          <div className="relative font-mono text-[0.68rem] font-medium text-e-blue tracking-[0.12em] uppercase mb-[14px]">
            {sectionLabel}
          </div>
          <h1 className="relative font-display text-[clamp(2.6rem,5vw,4rem)] font-medium leading-[1.08] tracking-[-0.03em] mb-5 text-e-text">
            {heroTitle}
          </h1>
          <p className="relative text-base leading-[1.8] text-e-text2 mx-auto max-w-[560px]">{heroDesc}</p>
          <div className="relative font-mono text-[0.7rem] tracking-[0.08em] text-e-text3 mt-6 uppercase">
            {lastUpdated}
          </div>
        </div>

        <div className="grid grid-cols-[220px_1fr] gap-12 max-w-[1100px] mx-auto px-12 pb-[100px] max-md:grid-cols-1 max-md:gap-0 max-md:px-5 max-md:pb-[60px]">
          <aside className="relative max-md:hidden">
            <div className="sticky top-[80px]">
              <div className="font-mono text-[0.6rem] font-medium tracking-[0.12em] uppercase text-e-text3 mb-4 pl-1">
                On this page
              </div>
              <nav className="flex flex-col gap-[4px]">
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

          <main className="flex flex-col rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0.02)_100%)] backdrop-blur-xl px-8 max-md:px-0 max-md:bg-transparent max-md:border-0">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                data-legal-section
                className="py-9 border-b border-white/[0.06] last:border-b-0"
                style={{ animation: `hr-fade-up 0.6s ease-out ${index * 0.05}s both` }}
              >
                <div className="flex items-center gap-[12px] mb-5">
                  <span className={sectionIconBox}>{section.icon}</span>
                  <h2 className={sectionTitleCls}>{section.title}</h2>
                </div>
                <div className={sectionBodyCls}>{section.content}</div>
              </section>
            ))}
          </main>
        </div>

        <HomepageFooter />
      </div>
    </div>
  );
}
