import HomepageFooter from "@/components/HomepageFooter";
import HomepageNav from "@/components/HomepageNav";
import GridOverlay from "@/components/GridOverlay";
import { AlertCircle, ArrowRight } from "lucide-react";
import { Helmet } from "react-helmet-async";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <>
      <Helmet>
        <title>Page Not Found | ealana</title>
        <meta name="description" content="This page doesn't exist or has moved. Head back to ealana — the Neural OS for Talent." />
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="font-ui leading-normal bg-e-bg text-e-text antialiased public-theme min-h-screen">
        <GridOverlay />
        <div className="relative z-10 flex min-h-screen flex-col">
          <HomepageNav />
          <main className="flex flex-1 items-center justify-center px-5 pt-[120px] pb-16">
            <div className="relative w-full max-w-[720px] overflow-hidden rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0.03)_100%)] p-8 shadow-[0_24px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl max-md:p-6">
              <div
                className="pointer-events-none absolute left-1/2 top-0 h-[280px] w-[520px] -translate-x-1/2"
                style={{
                  background: "radial-gradient(ellipse, rgba(75,142,240,0.16) 0%, rgba(52,209,122,0.08) 40%, transparent 72%)",
                  filter: "blur(70px)",
                }}
              />
              <div className="relative z-10">
                <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] text-[#F5C842] shadow-[0_0_36px_rgba(75,142,240,0.12)]">
                  <AlertCircle className="h-7 w-7" />
                </div>
                <div className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-e-blue">404</div>
                <h1 className="mb-3 font-display text-[clamp(2.4rem,4vw,3.4rem)] font-medium leading-[1.05] tracking-[-0.03em] text-e-text">
                  Page not found.
                </h1>
                <p className="max-w-[520px] text-[0.98rem] leading-[1.8] text-e-text2">
                  The page you&apos;re looking for doesn&apos;t exist, moved, or no longer lives here.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link
                    href="/recruiter-auth"
                    className="inline-flex items-center gap-2 rounded-xl bg-e-blue px-6 py-3 text-sm font-medium text-white no-underline transition-all duration-200 hover:brightness-110 hover:shadow-[0_8px_36px_rgba(75,142,240,0.35)]"
                  >
                    Get Started -&gt;
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/"
                    className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-6 py-3 text-sm font-medium text-e-text2 no-underline transition-all duration-200 hover:border-white/24 hover:bg-white/[0.06] hover:text-e-text"
                  >
                    Back to home
                  </Link>
                </div>
              </div>
            </div>
          </main>
          <HomepageFooter />
        </div>
      </div>
    </>
  );
}
