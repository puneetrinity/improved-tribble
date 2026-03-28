import { Link } from "wouter";
import vantahireLogo from "@/assets/vantahire-logo.png";

interface FooterProps {
  minimal?: boolean;
}

const Footer = ({ minimal = false }: FooterProps) => {
  // Minimal footer for ATS pages
  if (minimal) {
    return (
      <footer className="bg-[#0d0d1a] border-t border-primary/20 py-6 relative z-10">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-white/50 text-sm">
              © 2026 VantaHire. All rights reserved.
            </p>
            <div className="flex flex-wrap gap-6 justify-center">
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('cookie-consent:open', { detail: { reset: true } }));
                }}
                className="text-white/50 text-sm hover:text-warning transition-colors"
              >
                Cookie Preferences
              </button>
              <Link
                href="/privacy-policy"
                className="text-white/50 text-sm hover:text-warning transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms-of-service"
                className="text-white/50 text-sm hover:text-warning transition-colors"
              >
                Terms of Service
              </Link>
              <Link
                href="/cookie-policy"
                className="text-white/50 text-sm hover:text-warning transition-colors"
              >
                Cookie Policy
              </Link>
              <a
                href="mailto:hello@vantahire.com"
                className="text-white/70 text-sm hover:text-warning transition-colors"
              >
                hello@vantahire.com
              </a>
            </div>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)] py-16 relative z-10">
      <div className="container mx-auto px-4">
        {/* Footer Content Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12 max-w-6xl mx-auto">
          {/* Brand Column */}
          <div className="lg:col-span-1">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <img src={vantahireLogo} alt="VantaHire" width={36} height={36} className="h-9 w-auto" />
              <span className="text-xl font-bold gradient-text-mixed">VantaHire</span>
            </Link>
            <p className="text-[var(--text-muted)] text-sm leading-relaxed max-w-xs">
              AI + Human Expertise for Faster, Fairer Hiring. Serving startups and enterprises across India and APAC.
            </p>
          </div>

          {/* Product Column */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-5">
              Product
            </h4>
            <ul className="space-y-3">
              <li>
                <Link href="/product" className="text-[var(--text-muted)] text-sm hover:text-primary transition-colors">
                  Product
                </Link>
              </li>
              <li>
                <Link href="/features" className="text-[var(--text-muted)] text-sm hover:text-primary transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="text-[var(--text-muted)] text-sm hover:text-primary transition-colors">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>

          {/* Solutions Column */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-5">
              Solutions
            </h4>
            <ul className="space-y-3">
              <li>
                <Link href="/solutions" className="text-[var(--text-muted)] text-sm hover:text-primary transition-colors">
                  Solutions
                </Link>
              </li>
              <li>
                <Link href="/recruiters" className="text-[var(--text-muted)] text-sm hover:text-primary transition-colors">
                  Recruiters
                </Link>
              </li>
            </ul>
          </div>

          {/* Company Column */}
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-5">
              Company
            </h4>
            <ul className="space-y-3">
              <li>
                <Link href="/jobs" className="text-[var(--text-muted)] text-sm hover:text-primary transition-colors">
                  Jobs
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Footer Bottom */}
        <div className="border-t border-[var(--border-subtle)] pt-8 max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-[var(--text-muted)] text-sm">
              © 2026 VantaHire. All rights reserved.
            </p>
            <div className="flex flex-wrap gap-6 justify-center">
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('cookie-consent:open', { detail: { reset: true } }));
                }}
                className="text-[var(--text-muted)] text-sm hover:text-warning transition-colors"
              >
                Cookie Preferences
              </button>
              <Link
                href="/privacy-policy"
                className="text-[var(--text-muted)] text-sm hover:text-warning transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms-of-service"
                className="text-[var(--text-muted)] text-sm hover:text-warning transition-colors"
              >
                Terms of Service
              </Link>
              <Link
                href="/cookie-policy"
                className="text-[var(--text-muted)] text-sm hover:text-warning transition-colors"
              >
                Cookie Policy
              </Link>
              <a
                href="mailto:hello@vantahire.com"
                className="text-[var(--text-secondary)] text-sm hover:text-warning transition-colors"
              >
                hello@vantahire.com
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
