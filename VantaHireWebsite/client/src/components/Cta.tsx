import { trackEvent } from "@/lib/analytics";
import { btnPrimary, btnSecondary, sectionLabel } from "@/lib/shared-styles";

const Cta = () => {
  const openCalendar = () => {
    trackEvent("cta_click", { location: "cta_block", action: "book_demo" });
    window.open('https://cal.com/vantahire/quick-connect', '_blank');
  };

  return (
    <div className="grid grid-cols-[28px_1fr_28px] md:grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
      <div></div>
      <div className="border-b border-[rgba(255,255,255,0.07)]">
        <section className="text-center py-[100px] px-12 max-md:py-[60px] max-md:px-5 border-t-0">
          <div className={sectionLabel}>Get Started Today</div>
          <h2 className="font-satoshi text-[clamp(2rem,4vw,2.8rem)] max-sm:text-[1.6rem] font-normal leading-[1.2] tracking-tight mb-4 text-hr-text max-w-[560px] mx-auto">Ready to Transform Your<br />Recruitment Workflow?</h2>
          <p className="text-base max-sm:text-[0.9rem] leading-[1.7] text-hr-text-secondary max-w-[520px] mx-auto mb-9 text-center">
            Join hundreds of recruitment agencies already using VantaHire to place candidates faster and grow their business.
          </p>
          <div className="flex items-center justify-center gap-3 max-md:flex-col max-md:w-full">
            <button
              className={btnPrimary}
              onClick={openCalendar}
            >
              Book a Demo →
            </button>
            <a
              href="/pricing"
              className={btnSecondary}
              onClick={() => trackEvent("cta_click", { location: "cta_block", action: "view_pricing" })}
            >
              View Pricing
            </a>
          </div>
        </section>
      </div>
      <div></div>
    </div>
  );
};

export default Cta;
