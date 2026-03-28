import { Link } from "wouter";
import vantahireLogo from "@/assets/vantahire-logo.png";

const HomepageFooter = () => {
  const openCookiePreferences = () => {
    window.dispatchEvent(new CustomEvent("cookie-consent:open", { detail: { reset: true } }));
  };

  return (
    <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
      <div></div>
      <div className="border-b border-[rgba(255,255,255,0.07)]">
        <footer className="pt-14 px-12 pb-7 max-md:pt-10 max-md:px-5 max-md:pb-5 border-t-0">
          <div className="grid grid-cols-[2fr_repeat(3,1fr)] gap-10 max-w-[1100px] mx-auto mb-10 max-md:grid-cols-2 max-md:gap-6 max-sm:grid-cols-1 max-sm:gap-5">
            <div>
              <div className="flex items-center gap-2 font-bold text-base text-hr-text mb-3 no-underline">
                <img src={vantahireLogo} alt="VantaHire" width={24} height={24} className="h-6 w-auto" />
                <span className="font-outfit bg-gradient-to-br from-[#a78bfa] to-[#fbbf24] bg-clip-text [-webkit-background-clip:text] [-webkit-text-fill-color:transparent]">VantaHire</span>
              </div>
              <p className="text-[0.82rem] text-hr-text-muted leading-[1.6] max-w-[260px]">AI-powered recruitment infrastructure for modern agencies. Source, engage, and place candidates faster.</p>
            </div>
            <div>
              <h5 className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-hr-text-secondary mb-3.5">Product</h5>
              <ul className="list-none flex flex-col gap-[9px] p-0 m-0">
                <li><Link href="/jobs" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Browse Jobs</Link></li>
                <li><Link href="/features" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Features</Link></li>
                <li><Link href="/pricing" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Pricing</Link></li>
              </ul>
            </div>
            <div>
              <h5 className="text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-hr-text-secondary mb-3.5">Company</h5>
              <ul className="list-none flex flex-col gap-[9px] p-0 m-0">
                <li><a href="https://cal.com/vantahire/quick-connect" target="_blank" rel="noopener noreferrer" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Book a Demo</a></li>
                <li><a href="mailto:hello@vantahire.com" className="text-hr-text-muted no-underline text-[0.82rem] transition-colors duration-200 hover:text-hr-text">Contact</a></li>
              </ul>
            </div>
            <div>
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
          <div className="max-w-[1100px] mx-auto pt-5 border-t border-[rgba(255,255,255,0.08)] flex items-center justify-between gap-4 text-[0.78rem] text-hr-text-muted max-md:flex-col max-md:text-center">
            <span>© 2026 VantaHire. All rights reserved.</span>
            <span>Made in India 🇮🇳</span>
          </div>
        </footer>
      </div>
      <div></div>
    </div>
  );
};

export default HomepageFooter;
