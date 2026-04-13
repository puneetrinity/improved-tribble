import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { trackEvent } from "@/lib/analytics";
import { Menu, X } from "lucide-react";
import vantahireLogo from "@/assets/vantahire-logo.png";

const navLink = "text-hr-text-secondary no-underline font-dm text-sm font-normal transition-colors duration-200 hover:text-hr-text";
const btnGetStarted = "bg-hr-accent text-white border-none py-2 px-[18px] rounded-none font-dm text-sm font-medium leading-normal cursor-pointer no-underline transition-colors duration-200 hover:bg-hr-accent-hover";
const mobileLink = "text-hr-text-secondary no-underline font-dm text-sm py-1.5 block transition-colors duration-200 hover:text-hr-text";

const HomepageNav = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, logoutMutation } = useAuth();

  return (
    <nav className="fixed top-0 left-0 right-0 z-[1000] px-10 max-md:px-5 h-[60px] flex items-center justify-between bg-[rgba(12,12,16,0.85)] backdrop-blur-[16px] border-b border-[rgba(255,255,255,0.08)]">
      <Link href="/" className="flex items-center gap-2.5 font-bold text-xl text-hr-text no-underline">
        <img src={vantahireLogo} alt="VantaHire" width={28} height={28} className="h-7 w-auto" />
        <span className="font-outfit bg-gradient-to-br from-[#a78bfa] to-[#fbbf24] bg-clip-text [-webkit-background-clip:text] [-webkit-text-fill-color:transparent]">VantaHire</span>
      </Link>

      {/* Desktop center links */}
      <ul className="hidden md:flex items-center gap-8 list-none p-0 m-0">
        {!user && (
          <>
            <li><Link href="/features" className={navLink}>Features</Link></li>
            <li><Link href="/solutions" className={navLink}>Solutions</Link></li>
            <li><Link href="/pricing" className={navLink}>Pricing</Link></li>
          </>
        )}
        {user && user.role === 'super_admin' && (
          <>
            <li><Link href="/admin" className={navLink}>Admin</Link></li>
            <li><Link href="/admin/super" className={navLink}>Super Admin</Link></li>
          </>
        )}
        {user && (user.role === 'recruiter' || user.role === 'super_admin') && (
          <li><Link href="/analytics" className={navLink}>Analytics</Link></li>
        )}
      </ul>

      {/* Desktop right */}
      <div className="flex items-center gap-5">
        <Link href="/jobs" className={`${navLink} hidden md:inline`}>Jobs</Link>

        {user && user.role === 'candidate' && (
          <Link href="/my-dashboard" className={`${navLink} hidden md:inline`}>Dashboard</Link>
        )}
        {user && user.role === 'recruiter' && (
          <Link href="/recruiter-dashboard" className={`${navLink} hidden md:inline`}>Dashboard</Link>
        )}
        {user && user.role === 'hiring_manager' && (
          <Link href="/hiring-manager" className={`${navLink} hidden md:inline`}>Dashboard</Link>
        )}

        {user ? (
          <>
            <span className={`${navLink} hidden md:inline`} style={{ cursor: 'default' }}>Hi, {user.firstName}</span>
            <button
              className={`${btnGetStarted} hidden md:inline-block`}
              onClick={() => logoutMutation.mutate()}
            >
              Logout
            </button>
          </>
        ) : (
          <a
            href="/recruiter-auth"
            className={`${btnGetStarted} hidden md:inline-block`}
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
          className="block md:hidden bg-transparent border-none text-hr-text cursor-pointer p-1"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          aria-label="Toggle menu"
          data-testid="mobile-menu-button"
        >
          {isMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      <div
        className={`${isMenuOpen ? 'flex' : 'hidden'} absolute top-[60px] left-0 right-0 bg-[rgba(12,12,16,0.97)] backdrop-blur-[16px] border-b border-[rgba(255,255,255,0.08)] py-4 px-6 flex-col gap-3`}
        data-testid="mobile-nav"
      >
          {!user && (
            <>
              <Link href="/features" className={mobileLink} onClick={() => setIsMenuOpen(false)}>Features</Link>
              <Link href="/solutions" className={mobileLink} onClick={() => setIsMenuOpen(false)}>Solutions</Link>
              <Link href="/pricing" className={mobileLink} onClick={() => setIsMenuOpen(false)}>Pricing</Link>
            </>
          )}
          <Link href="/jobs" className={mobileLink} onClick={() => setIsMenuOpen(false)}>Jobs</Link>
          {user && user.role === 'super_admin' && (
            <Link href="/admin" className={mobileLink} onClick={() => setIsMenuOpen(false)}>Admin</Link>
          )}
          {user && user.role === 'candidate' && (
            <Link href="/my-dashboard" className={mobileLink} onClick={() => setIsMenuOpen(false)}>Dashboard</Link>
          )}
          {user && user.role === 'recruiter' && (
            <Link href="/recruiter-dashboard" className={mobileLink} onClick={() => setIsMenuOpen(false)}>Dashboard</Link>
          )}
          {user && user.role === 'hiring_manager' && (
            <Link href="/hiring-manager" className={mobileLink} onClick={() => setIsMenuOpen(false)}>Dashboard</Link>
          )}
          {user ? (
            <button
              className={`${btnGetStarted} w-full mt-2`}
              onClick={() => { logoutMutation.mutate(); setIsMenuOpen(false); }}
            >
              Logout
            </button>
          ) : (
            <a
              href="/recruiter-auth"
              className={`${btnGetStarted} block text-center mt-2`}
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
    </nav>
  );
};

export default HomepageNav;
