import { Helmet } from "react-helmet-async";
import HomepageNav from "@/components/HomepageNav";
import HomepageFooter from "@/components/HomepageFooter";
import SolutionTabs from "@/components/marketing/sections/SolutionTabs";
import SolutionsCTA from "@/components/marketing/sections/SolutionsCTA";

export default function UseCasesPage() {
  return (
    <>
      <Helmet>
        <title>Solutions — ealana | Built for how recruiters work</title>
        <meta name="description" content="ealana adapts to recruitment agencies, staffing firms, and in-house teams." />
      </Helmet>
      <div style={{ fontFamily: "'DM Sans', sans-serif", background: '#080A14', color: '#F4F5FA', minHeight: '100vh' }}>
        <HomepageNav />
        <div style={{ paddingTop: '64px' }}>
          <div style={{ padding: '100px 4rem 60px', maxWidth: '1100px', margin: '0 auto', textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 24 }}>
              <div style={{ height: 1, background: '#4B8EF0', opacity: 0.2, width: 60 }} />
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '0.65rem', letterSpacing: '0.14em', color: '#4B8EF0', textTransform: 'uppercase' }}>Solutions</span>
              <div style={{ height: 1, background: '#4B8EF0', opacity: 0.2, width: 60 }} />
            </div>
            <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 'clamp(3rem,6vw,5rem)', color: '#F4F5FA', letterSpacing: '-0.025em', lineHeight: 1.1, marginBottom: '1.25rem', fontWeight: 400 }}>
              Built for the way<br />
              <em style={{ fontStyle: 'italic', background: 'linear-gradient(135deg, #4B8EF0 0%, #34D17A 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>recruiters actually work.</em>
            </h1>
            <p style={{ fontFamily: "'DM Sans',sans-serif", fontSize: '1.05rem', color: '#8891AA', fontWeight: 300, maxWidth: 520, margin: '0 auto', lineHeight: 1.75 }}>
              Whether you run an agency, staff at scale, or hire in-house — ealana adapts to how your team works.
            </p>
          </div>
          <SolutionTabs />
          <SolutionsCTA />
        </div>
        <HomepageFooter />
      </div>
    </>
  );
}
