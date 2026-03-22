import { Link } from "wouter";
import vantahireLogo from "@/assets/vantahire-logo.png";

const HomepageFooter = () => {
  return (
    <div className="hr-struct-section">
      <div className="struct-gutter"></div>
      <div className="struct-body">
        <footer className="hr-footer" style={{ borderTop: 'none' }}>
          <div className="hr-footer-grid">
            <div>
              <div className="hr-footer-brand">
                <img src={vantahireLogo} alt="VantaHire" width={24} height={24} style={{ height: '24px', width: 'auto' }} />
                VantaHire
              </div>
              <p className="hr-footer-tagline">AI-powered recruitment infrastructure for modern agencies. Source, engage, and place candidates faster.</p>
            </div>
            <div className="hr-footer-col">
              <h5>Product</h5>
              <ul>
                <li><Link href="/features">Intelligence Layer</Link></li>
                <li><Link href="/features">Outreach Layer</Link></li>
                <li><Link href="/features">Operations Layer</Link></li>
                <li><Link href="/features">Integrations</Link></li>
                <li><Link href="/pricing">Pricing</Link></li>
              </ul>
            </div>
            <div className="hr-footer-col">
              <h5>Company</h5>
              <ul>
                <li><Link href="/about">About</Link></li>
                <li><Link href="/jobs">Careers</Link></li>
                <li><Link href="/blog">Blog</Link></li>
                <li><a href="mailto:hello@vantahire.com">Contact</a></li>
              </ul>
            </div>
            <div className="hr-footer-col">
              <h5>Resources</h5>
              <ul>
                <li><Link href="/product">Documentation</Link></li>
                <li><Link href="/product">API Reference</Link></li>
                <li><a href="mailto:hello@vantahire.com">Help Center</a></li>
                <li><Link href="/status">Status</Link></li>
              </ul>
            </div>
            <div className="hr-footer-col">
              <h5>Legal</h5>
              <ul>
                <li><Link href="/privacy-policy">Privacy Policy</Link></li>
                <li><Link href="/terms-of-service">Terms of Service</Link></li>
                <li><Link href="/cookie-policy">Cookie Policy</Link></li>
                <li><Link href="/privacy-policy">GDPR</Link></li>
              </ul>
            </div>
          </div>
          <div className="hr-footer-bottom">
            <span>© 2026 VantaHire. All rights reserved.</span>
            <span>Made in India 🇮🇳</span>
          </div>
        </footer>
      </div>
      <div className="struct-gutter"></div>
    </div>
  );
};

export default HomepageFooter;
