import { useEffect, useRef, useState } from "react";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import GridOverlay from "@/components/GridOverlay";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/components.css";
import "@/styles/legal-page.css";

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
    sectionsRef.current = document.querySelectorAll(".hr-legal-section");
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
    <div className="homepage-redesign public-theme min-h-screen">
      <GridOverlay />
      <div className="relative z-10">
        <HomepageNav />

        {/* Hero */}
        <div className="hr-legal-hero">
          <div className="hr-section-label">{sectionLabel}</div>
          <h1 className="hr-section-title">{heroTitle}</h1>
          <p className="hr-section-desc">{heroDesc}</p>
          <div className="hr-legal-last-updated">{lastUpdated}</div>
        </div>

        {/* Content */}
        <div className="hr-legal-layout">
          {/* Sidebar Navigation */}
          <aside className="hr-legal-sidebar">
            <div className="hr-legal-sidebar-inner">
              <div className="hr-legal-sidebar-label">On this page</div>
              <nav className="hr-legal-sidebar-nav">
                {sections.map((section) => (
                  <a
                    key={section.id}
                    href={`#${section.id}`}
                    className={`hr-legal-sidebar-link ${activeSection === section.id ? "active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(section.id)?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    <span className="hr-legal-sidebar-icon">{section.icon}</span>
                    <span>{section.label}</span>
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Main Content */}
          <main className="hr-legal-main">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                className="hr-legal-section"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="hr-legal-section-header">
                  <span className="hr-legal-section-icon">{section.icon}</span>
                  <h2 className="hr-legal-section-title">{section.title}</h2>
                </div>
                <div className="hr-legal-section-body">
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
