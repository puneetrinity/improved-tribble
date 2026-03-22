import { trackEvent } from "@/lib/analytics";

const Cta = () => {
  const openCalendar = () => {
    trackEvent("cta_click", { location: "cta_block", action: "book_demo" });
    window.open('https://cal.com/vantahire/quick-connect', '_blank');
  };

  return (
    <div className="hr-struct-section">
      <div className="struct-gutter"></div>
      <div className="struct-body">
        <section className="hr-cta-section" style={{ borderTop: 'none' }}>
          <div className="hr-section-label">Get Started Today</div>
          <h2 className="hr-section-title">Ready to Transform Your<br />Recruitment Workflow?</h2>
          <p className="hr-section-desc" style={{ margin: '0 auto 36px', textAlign: 'center' }}>
            Join hundreds of recruitment agencies already using VantaHire to place candidates faster and grow their business.
          </p>
          <div className="hr-cta-btns">
            <a
              href="/recruiter-auth"
              className="hr-btn-demo"
              onClick={(e) => {
                e.preventDefault();
                trackEvent("cta_click", { location: "cta_block", action: "book_demo" });
                window.location.href = '/recruiter-auth';
              }}
            >
              Book a Demo →
            </a>
            <button className="hr-btn-pricing" onClick={openCalendar}>
              View Pricing
            </button>
          </div>
        </section>
      </div>
      <div className="struct-gutter"></div>
    </div>
  );
};

export default Cta;
