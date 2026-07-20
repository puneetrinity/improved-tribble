import { Link } from "wouter";
import ealanaMoth from "@/assets/ealana-moth (1).svg";

const HomepageFooter = () => {
  const openCookiePreferences = () => {
    window.dispatchEvent(new CustomEvent("cookie-consent:open", { detail: { reset: true } }));
  };

  return (
    <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
      <div></div>
      <div className="border-b border-[rgba(255,255,255,0.07)]">
        <footer className="border-t-0 px-5 pb-6 pt-12 sm:px-8 lg:px-12">
          <div className="mx-auto mb-8 grid max-w-[1100px] gap-4 sm:gap-5 lg:grid-cols-[2.2fr_repeat(3,1fr)] lg:gap-10">
            <div>
              <div className="flex items-center gap-2.5 font-bold text-base text-hr-text mb-3 no-underline">
                <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[radial-gradient(circle_at_30%_30%,rgba(75,142,240,0.22),transparent_58%),radial-gradient(circle_at_70%_70%,rgba(52,209,122,0.18),transparent_62%),rgba(255,255,255,0.03)] shadow-[0_0_30px_rgba(75,142,240,0.12)]">
                  <img src={ealanaMoth} alt="ealana moth" width={26} height={26} className="h-[26px] w-[26px]" />
                </div>
                <span className="font-outfit text-[1.02rem] font-semibold tracking-[-0.02em] text-hr-text">ealana</span>
              </div>
              <div className="max-w-[360px] rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-5 lg:border-0 lg:bg-transparent lg:p-0">
                <p className="font-outfit text-[1rem] font-medium leading-[1.35] text-hr-text">
                  The Neural OS for Talent
                </p>
                <p className="mt-1 text-[0.82rem] text-hr-text-muted leading-[1.6]">
                  Cut the noise. Find the signal.
                </p>
                <div className="mt-5 flex items-center gap-3 text-[0.95rem] font-semibold max-sm:flex-wrap">
                  <span className="text-[#4B8EF0]">Discover</span>
                  <span className="text-[0.72rem] tracking-[0.3em] text-[#4B8EF0]/75">·····</span>
                  <span className="text-[#34D17A]">Memory</span>
                  <span className="text-[0.72rem] tracking-[0.3em] text-[#34D17A]/75">·····</span>
                  <span className="text-[#F5C842]">Flow</span>
                </div>
              </div>
            </div>
            <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-5 lg:border-0 lg:bg-transparent lg:p-0">
              <h5 className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-hr-text-secondary mb-3.5">Product</h5>
              <ul className="list-none flex flex-col gap-[9px] p-0 m-0">
                <li><Link href="/solutions" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Solutions</Link></li>
                <li><Link href="/pricing" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Pricing</Link></li>
                <li><Link href="/jobs" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Browse Jobs</Link></li>
              </ul>
            </div>
            <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-5 lg:border-0 lg:bg-transparent lg:p-0">
              <h5 className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-hr-text-secondary mb-3.5">Company</h5>
              <ul className="list-none flex flex-col gap-[9px] p-0 m-0">
                <li><a href="https://cal.com/ealana/quick-connect" target="_blank" rel="noopener noreferrer" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Book a Demo</a></li>
                <li><a href="mailto:info@ealana.com" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Contact</a></li>
              </ul>
            </div>
            <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] p-5 lg:border-0 lg:bg-transparent lg:p-0">
              <h5 className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-hr-text-secondary mb-3.5">Legal</h5>
              <ul className="list-none flex flex-col gap-[9px] p-0 m-0">
                <li>
                  <button
                    type="button"
                    onClick={openCookiePreferences}
                    className="bg-transparent border-none p-0 text-hr-text-muted text-[0.82rem] transition-colors duration-200 hover:text-hr-text"
                  >
                    Cookie Preferences
                  </button>
                </li>
                <li><Link href="/privacy-policy" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Privacy Policy</Link></li>
                <li><Link href="/terms-of-service" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Terms of Service</Link></li>
                <li><Link href="/cookie-policy" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Cookie Policy</Link></li>
              </ul>
            </div>
          </div>
          <div className="mx-auto flex max-w-[1100px] flex-col gap-2 border-t border-[rgba(255,255,255,0.08)] pt-5 text-center text-[0.78rem] text-hr-text-muted sm:flex-row sm:items-center sm:justify-between sm:text-left">
            <span>Copyright 2026 ealana. All rights reserved.</span>
            <span>Made in India.</span>
          </div>
        </footer>
      </div>
      <div></div>
    </div>
  );
};

export default HomepageFooter;
