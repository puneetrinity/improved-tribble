import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { trackEvent } from "@/lib/analytics";
import { Menu, X } from "lucide-react";
import vantahireLogo from "@/assets/vantahire-logo.png";

const HomepageNav = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, logoutMutation } = useAuth();

  return (
    <nav className="hr-nav">
      <Link href="/" className="hr-nav-brand" style={{ textDecoration: 'none' }}>
        <img src={vantahireLogo} alt="VantaHire" width={28} height={28} style={{ height: '28px', width: 'auto' }} />
        VantaHire
      </Link>

      {/* Desktop center links */}
      <ul className="hr-nav-center">
        {!user && (
          <>
            <li><Link href="/features">Features</Link></li>
            <li><Link href="/use-cases">Solutions</Link></li>
            <li><Link href="/pricing">Pricing</Link></li>
          </>
        )}
        {user && user.role === 'super_admin' && (
          <>
            <li><Link href="/admin">Admin</Link></li>
            <li><Link href="/admin/super">Super Admin</Link></li>
          </>
        )}
        {user && (user.role === 'recruiter' || user.role === 'super_admin') && (
          <li><Link href="/analytics">Analytics</Link></li>
        )}
      </ul>

      {/* Desktop right */}
      <div className="hr-nav-right">
        <Link href="/jobs" className="hr-nav-signin">Jobs</Link>

        {user && user.role === 'candidate' && (
          <Link href="/my-dashboard" className="hr-nav-signin">Dashboard</Link>
        )}
        {user && user.role === 'recruiter' && (
          <Link href="/recruiter-dashboard" className="hr-nav-signin">Dashboard</Link>
        )}
        {user && user.role === 'hiring_manager' && (
          <Link href="/hiring-manager" className="hr-nav-signin">Dashboard</Link>
        )}

        {user ? (
          <>
            <span className="hr-nav-signin" style={{ cursor: 'default' }}>Hi, {user.firstName}</span>
            <button
              className="hr-btn-get-started"
              onClick={() => logoutMutation.mutate()}
            >
              Logout
            </button>
          </>
        ) : (
          <a
            href="/recruiter-auth"
            className="hr-btn-get-started"
            onClick={(e) => {
              e.preventDefault();
              trackEvent("cta_click", { location: "site_header", action: "get_started" });
              window.location.href = '/recruiter-auth';
            }}
          >
            Get started
          </a>
        )}

        {/* Mobile hamburger */}
        <button
          className="hr-mobile-toggle"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Toggle menu"
          data-testid="mobile-menu-button"
        >
          {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && (
        <div className="hr-mobile-menu" data-testid="mobile-nav">
          {!user && (
            <>
              <Link href="/features" onClick={() => setIsMenuOpen(false)}>Features</Link>
              <Link href="/use-cases" onClick={() => setIsMenuOpen(false)}>Solutions</Link>
              <Link href="/pricing" onClick={() => setIsMenuOpen(false)}>Pricing</Link>
            </>
          )}
          <Link href="/jobs" onClick={() => setIsMenuOpen(false)}>Jobs</Link>
          {user && user.role === 'super_admin' && (
            <Link href="/admin" onClick={() => setIsMenuOpen(false)}>Admin</Link>
          )}
          {user && user.role === 'candidate' && (
            <Link href="/my-dashboard" onClick={() => setIsMenuOpen(false)}>Dashboard</Link>
          )}
          {user && user.role === 'recruiter' && (
            <Link href="/recruiter-dashboard" onClick={() => setIsMenuOpen(false)}>Dashboard</Link>
          )}
          {user && user.role === 'hiring_manager' && (
            <Link href="/hiring-manager" onClick={() => setIsMenuOpen(false)}>Dashboard</Link>
          )}
          {user ? (
            <button
              className="hr-btn-get-started"
              style={{ width: '100%', marginTop: '8px' }}
              onClick={() => { logoutMutation.mutate(); setIsMenuOpen(false); }}
            >
              Logout
            </button>
          ) : (
            <a
              href="/recruiter-auth"
              className="hr-btn-get-started"
              style={{ display: 'block', textAlign: 'center', marginTop: '8px' }}
              onClick={(e) => {
                e.preventDefault();
                trackEvent("cta_click", { location: "site_header_mobile", action: "get_started" });
                window.location.href = '/recruiter-auth';
              }}
            >
              Get started
            </a>
          )}
        </div>
      )}
    </nav>
  );
};

export default HomepageNav;
