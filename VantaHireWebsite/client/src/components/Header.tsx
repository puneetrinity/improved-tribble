import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Menu, X } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

const Header = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [activeSection, setActiveSection] = useState("hero");
  const [location] = useLocation();
  const { user, logoutMutation } = useAuth();

  // Track scroll position for header effects
  useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY);
      
      // Determine active section based on scroll position
      const sections = ["hero", "about", "services", "industries", "contact"];
      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (rect.top <= 100 && rect.bottom >= 100) {
            setActiveSection(section);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
      setActiveSection(id);
    }
    setIsMenuOpen(false);
  };

  return (
    <header className={`fixed top-0 left-0 right-0 transition-all duration-500 z-50 
      ${scrollPosition > 50 
        ? 'bg-gradient-to-r from-[#1E0B40]/90 to-[#2D1B69]/90 backdrop-blur-lg shadow-lg py-3 border-b border-white/5' 
        : 'py-6'}`}
    >
      {/* Premium background glow effects */}
      <div className={`absolute inset-0 -z-10 transition-opacity duration-700 ${scrollPosition > 50 ? 'opacity-100' : 'opacity-0'}`}>
        <div className="absolute left-1/4 w-48 h-12 bg-[#7B38FB]/10 rounded-full blur-[50px] animate-pulse-slow"></div>
        <div className="absolute right-1/4 w-48 h-12 bg-[#2D81FF]/10 rounded-full blur-[50px] animate-pulse-slow" 
             style={{ animationDelay: '1.2s' }}></div>
      </div>
      
      {/* Bottom accent line with animated gradient */}
      <div className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#7B38FB]/40 to-transparent animate-shine 
                      transition-opacity duration-500 ${scrollPosition > 50 ? 'opacity-100' : 'opacity-0'}`}>
      </div>
      
      <nav className="container mx-auto px-4 flex items-center justify-between">
        {/* Premium logo styling */}
        <div className="text-2xl font-bold relative group">
          <Link 
            href="/" 
            className="animate-gradient-text font-extrabold tracking-wide"
            onClick={() => {
              // Scroll to top when navigating to homepage
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            VantaHire
          </Link>
          {/* Subtle glow effect on hover */}
          <div className="absolute -inset-1 rounded-full blur-md bg-gradient-to-r from-[#7B38FB]/0 via-[#7B38FB]/0 to-[#FF5BA8]/0 
                        group-hover:from-[#7B38FB]/10 group-hover:via-[#7B38FB]/20 group-hover:to-[#FF5BA8]/10 
                        opacity-0 group-hover:opacity-100 transition-all duration-700 -z-10"></div>
        </div>
        
        {/* Enhanced desktop menu */}
        <div className="hidden md:flex items-center space-x-8">
          {/* Navigation links with premium hover effects */}
          <a 
            href="/#about" 
            className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
            onClick={(e) => {
              e.preventDefault();
              if (window.location.pathname === '/') {
                scrollToSection("about");
              } else {
                window.location.href = '/#about';
              }
            }}
          >
            <span className="relative z-10">About</span>
            <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
            <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
          </a>
          
          <a 
            href="/#services" 
            className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
            onClick={(e) => {
              e.preventDefault();
              if (window.location.pathname === '/') {
                scrollToSection("services");
              } else {
                window.location.href = '/#services';
              }
            }}
          >
            <span className="relative z-10">Services</span>
            <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
            <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
          </a>
          
          <a 
            href="/#industries" 
            className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
            onClick={(e) => {
              e.preventDefault();
              if (window.location.pathname === '/') {
                scrollToSection("industries");
              } else {
                window.location.href = '/#industries';
              }
            }}
          >
            <span className="relative z-10">Industries</span>
            <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
            <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
          </a>
          
          <a 
            href="/#contact" 
            className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
            onClick={(e) => {
              e.preventDefault();
              if (window.location.pathname === '/') {
                scrollToSection("contact");
              } else {
                window.location.href = '/#contact';
              }
            }}
          >
            <span className="relative z-10">Contact</span>
            <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
            <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
          </a>

          {/* Jobs link */}
          <Link href="/jobs" className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70 hover:text-white">
            <span className="relative z-10">Jobs</span>
            <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
            <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
          </Link>

          {/* Admin links for admin users */}
          {user && user.role === 'admin' && (
            <>
              <Link href="/admin" className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70 hover:text-white">
                <span className="relative z-10">Admin</span>
                <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
              </Link>
              <Link href="/admin/super" className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70 hover:text-white">
                <span className="relative z-10">Super Admin</span>
                <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
              </Link>
            </>
          )}

          {/* Analytics link for recruiters and admins */}
          {user && (user.role === 'recruiter' || user.role === 'admin') && (
            <Link href="/analytics" className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70 hover:text-white">
              <span className="relative z-10">Analytics</span>
              <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
              <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
            </Link>
          )}

          {/* Dashboard links for authenticated users based on role */}
          {user && user.role === 'candidate' && (
            <Link href="/my-dashboard" className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70 hover:text-white">
              <span className="relative z-10">My Dashboard</span>
              <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
              <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
            </Link>
          )}

          {/* Recruiter dashboard link */}
          {user && user.role === 'recruiter' && (
            <Link href="/recruiter-dashboard" className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70 hover:text-white">
              <span className="relative z-10">Recruiter Dashboard</span>
              <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
              <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
            </Link>
          )}

          {/* Auth links */}
          {user ? (
            <div className="flex items-center space-x-4">
              <span className="text-white/70 text-sm">Welcome, {user.firstName}</span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => logoutMutation.mutate()}
                className="border-white/20 text-white hover:bg-white/10"
              >
                Logout
              </Button>
            </div>
          ) : (
            <div className="flex items-center space-x-4">
              {/* Job Seekers and Recruiters links - temporarily hidden */}
              {false && (
                <>
                  <Link href="/candidate-auth" className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70 hover:text-white">
                    <span className="relative z-10">Job Seekers</span>
                    <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                    <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
                  </Link>
                  <Link href="/recruiter-auth" className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70 hover:text-white">
                    <span className="relative z-10">Recruiters</span>
                    <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                    <span className="absolute inset-0 -z-10 bg-white/0 group-hover:bg-white/5 transition-colors duration-300 rounded-md"></span>
                  </Link>
                </>
              )}
            </div>
          )}
          
          {/* Enhanced consultation button */}
          <Button 
            variant="gradient" 
            size="lg" 
            className="rounded-full premium-card hover:scale-105 transform transition-all duration-300 group shadow-lg"
            onClick={() => window.open('https://calendly.com/vantahire/30min', '_blank')}
          >
            <span className="group-hover:tracking-wide transition-all duration-300">
              Schedule a Free Consultation
            </span>
          </Button>
        </div>
        
        {/* Enhanced mobile menu button */}
        <button
          className="md:hidden text-white hover:bg-white/10 p-2 rounded-full transition-all duration-300 hover:scale-110
                    border border-white/0 hover:border-white/10 backdrop-blur-lg"
          onClick={toggleMenu}
          aria-label="Toggle menu"
          data-testid="mobile-menu-button"
        >
          <Menu className="h-6 w-6" />
        </button>
      </nav>

      {/* Mobile menu */}
      <div 
        className={cn(
          "fixed inset-0 z-50 p-6 transition-all duration-500 flex flex-col",
          isMenuOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
        )}
        data-testid="mobile-nav"
        style={{ backgroundColor: '#0A0A0F' }}
      >
        <div className="flex justify-between items-center mb-8">
          <div className="text-2xl font-bold">
            <Link 
              href="/" 
              className="animate-gradient-text font-extrabold"
              onClick={() => {
                setIsMenuOpen(false);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              VantaHire
            </Link>
          </div>
          <button
            className="text-white hover:bg-white/10 p-2 rounded-full transition-all"
            onClick={toggleMenu}
            aria-label="Close menu"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="flex flex-col space-y-6">
          <a 
            href="/#about" 
            className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
            onClick={(e) => {
              e.preventDefault();
              setIsMenuOpen(false);
              if (window.location.pathname === '/') {
                scrollToSection("about");
              } else {
                window.location.href = '/#about';
              }
            }}
          >
            About
          </a>
          <a 
            href="/#services" 
            className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
            onClick={(e) => {
              e.preventDefault();
              setIsMenuOpen(false);
              if (window.location.pathname === '/') {
                scrollToSection("services");
              } else {
                window.location.href = '/#services';
              }
            }}
          >
            Services
          </a>
          <a 
            href="/#industries" 
            className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
            onClick={(e) => {
              e.preventDefault();
              setIsMenuOpen(false);
              if (window.location.pathname === '/') {
                scrollToSection("industries");
              } else {
                window.location.href = '/#industries';
              }
            }}
          >
            Industries
          </a>
          <a 
            href="/#contact" 
            className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
            onClick={(e) => {
              e.preventDefault();
              setIsMenuOpen(false);
              if (window.location.pathname === '/') {
                scrollToSection("contact");
              } else {
                window.location.href = '/#contact';
              }
            }}
          >
            Contact
          </a>

          {/* Mobile Jobs link */}
          <Link 
            href="/jobs"
            className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
            onClick={() => setIsMenuOpen(false)}
          >
            Jobs
          </Link>

          {/* Mobile Admin link */}
          {user && user.role === 'admin' && (
            <Link 
              href="/admin"
              className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
              onClick={() => setIsMenuOpen(false)}
            >
              Admin
            </Link>
          )}

          {/* Mobile dashboard links based on role */}
          {user && user.role === 'candidate' && (
            <Link 
              href="/my-dashboard"
              className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
              onClick={() => setIsMenuOpen(false)}
            >
              My Dashboard
            </Link>
          )}

          {user && user.role === 'recruiter' && (
            <Link 
              href="/recruiter-dashboard"
              className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
              onClick={() => setIsMenuOpen(false)}
            >
              Recruiter Dashboard
            </Link>
          )}

          {/* Mobile Auth links */}
          {user ? (
            <div className="flex flex-col space-y-4 mt-4">
              <span className="text-white px-2">Welcome, {user.firstName}</span>
              <Button 
                variant="outline" 
                onClick={() => {
                  logoutMutation.mutate();
                  setIsMenuOpen(false);
                }}
                className="border-white/20 text-white hover:bg-white/10 w-full"
              >
                Logout
              </Button>
            </div>
          ) : (
            <div className="flex flex-col space-y-4 mt-4">
              {/* Mobile Job Seekers and Recruiters links - temporarily hidden */}
              {false && (
                <>
                  <Link 
                    href="/candidate-auth"
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Job Seekers
                  </Link>
                  <Link 
                    href="/recruiter-auth"
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={() => setIsMenuOpen(false)}
                  >
                    Recruiters
                  </Link>
                </>
              )}
            </div>
          )}
          
          <div className="mt-8">
            <Button 
              variant="gradient" 
              size="lg" 
              className="rounded-full w-full hover:shadow-lg hover:scale-105 transition-all duration-300"
              onClick={() => window.open('https://calendly.com/vantahire/30min', '_blank')}
            >
              Schedule a Free Consultation
            </Button>
          </div>
        </div>
        
        {/* Decorative elements */}
        <div className="absolute -z-10 w-32 h-32 rounded-full blur-3xl bg-[#7B38FB]/20 top-1/4 right-1/4"></div>
        <div className="absolute -z-10 w-32 h-32 rounded-full blur-3xl bg-[#FF5BA8]/20 bottom-1/4 left-1/4"></div>
      </div>
    </header>
  );
};

export default Header;
