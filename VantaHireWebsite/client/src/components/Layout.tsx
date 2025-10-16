import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Menu, X, User, LogOut, Briefcase, Plus } from "lucide-react";
import { useState, useEffect } from "react";
import Footer from "@/components/Footer";

interface LayoutProps {
  children: React.ReactNode;
}

const Layout = ({ children }: LayoutProps) => {
  const [location, setLocation] = useLocation();
  const { user, logoutMutation } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const isJobsRoute = location.startsWith('/jobs') || location === '/auth';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Header */}
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
        
        {/* Bottom accent line */}
        <div className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#7B38FB]/40 to-transparent animate-shine 
                        transition-opacity duration-500 ${scrollPosition > 50 ? 'opacity-100' : 'opacity-0'}`}>
        </div>
        
        <nav className="container mx-auto px-4 flex items-center justify-between">
          {/* Logo */}
          <div className="text-2xl font-bold relative group">
            <Link 
              href="/" 
              className="animate-gradient-text font-extrabold tracking-wide"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              VantaHire
            </Link>
            <div className="absolute -inset-1 rounded-full blur-md bg-gradient-to-r from-[#7B38FB]/0 via-[#7B38FB]/0 to-[#FF5BA8]/0 
                          group-hover:from-[#7B38FB]/10 group-hover:via-[#7B38FB]/20 group-hover:to-[#FF5BA8]/10 
                          opacity-0 group-hover:opacity-100 transition-all duration-700 -z-10"></div>
          </div>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            {isJobsRoute ? (
              <>
                <a 
                  href="/jobs" 
                  className={`relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group ${
                    location === "/jobs" ? 'text-white font-medium' : 'text-white/70'
                  }`}
                  onClick={(e) => { e.preventDefault(); setLocation("/jobs"); }}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    Jobs
                  </span>
                  <span 
                    className={`absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 
                              ${location === "/jobs" ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`}
                  ></span>
                </a>

                {user && (user.role === 'recruiter' || user.role === 'admin') && (
                  <a 
                    href="/jobs/post" 
                    className={`relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group ${
                      location === "/jobs/post" ? 'text-white font-medium' : 'text-white/70'
                    }`}
                    onClick={(e) => { e.preventDefault(); setLocation("/jobs/post"); }}
                  >
                    <span className="relative z-10 flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Post Job
                    </span>
                    <span 
                      className={`absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 
                                ${location === "/jobs/post" ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'}`}
                    ></span>
                  </a>
                )}
              </>
            ) : (
              <>
                <a 
                  href="/#about" 
                  className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                  onClick={(e) => {
                    e.preventDefault();
                    if (window.location.pathname === '/') {
                      document.getElementById("about")?.scrollIntoView({ behavior: "smooth" });
                    } else {
                      window.location.href = '/#about';
                    }
                  }}
                >
                  <span className="relative z-10">About</span>
                  <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                </a>
                
                <a 
                  href="/#services" 
                  className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                  onClick={(e) => {
                    e.preventDefault();
                    if (window.location.pathname === '/') {
                      document.getElementById("services")?.scrollIntoView({ behavior: "smooth" });
                    } else {
                      window.location.href = '/#services';
                    }
                  }}
                >
                  <span className="relative z-10">Services</span>
                  <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                </a>

                <a 
                  href="/jobs" 
                  className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                  onClick={(e) => { e.preventDefault(); setLocation("/jobs"); }}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    Jobs
                  </span>
                  <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                </a>
              </>
            )}

            {/* Dashboard links for authenticated users based on role */}
            {user && user.role === 'candidate' && (
              <a 
                href="/my-dashboard" 
                className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                onClick={(e) => { e.preventDefault(); setLocation("/my-dashboard"); }}
              >
                <span className="relative z-10">My Dashboard</span>
                <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
              </a>
            )}

            {user && user.role === 'recruiter' && (
              <a 
                href="/recruiter-dashboard" 
                className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                onClick={(e) => { e.preventDefault(); setLocation("/recruiter-dashboard"); }}
              >
                <span className="relative z-10">Recruiter Dashboard</span>
                <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
              </a>
            )}

            {/* Admin links */}
            {user && user.role === 'admin' && (
              <>
                <a 
                  href="/admin" 
                  className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                  onClick={(e) => { e.preventDefault(); setLocation("/admin"); }}
                >
                  <span className="relative z-10">Admin</span>
                  <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                </a>
                <a 
                  href="/analytics" 
                  className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                  onClick={(e) => { e.preventDefault(); setLocation("/analytics"); }}
                >
                  <span className="relative z-10">Analytics</span>
                  <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                </a>
              </>
            )}

            {/* User Actions */}
            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-white/70 text-sm">
                  Welcome, {user.firstName || user.username}
                </span>
                <Button
                  onClick={handleLogout}
                  variant="outline"
                  size="sm"
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </Button>
              </div>
            ) : (
              <div className="flex items-center space-x-4">
                <a 
                  href="/candidate-auth" 
                  className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                  onClick={(e) => { e.preventDefault(); setLocation("/candidate-auth"); }}
                >
                  <span className="relative z-10">Job Seekers</span>
                  <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                </a>
                <a 
                  href="/recruiter-auth" 
                  className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                  onClick={(e) => { e.preventDefault(); setLocation("/recruiter-auth"); }}
                >
                  <span className="relative z-10">Recruiters</span>
                  <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                </a>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <Button
              onClick={toggleMenu}
              variant="ghost"
              size="sm"
              className="text-white hover:bg-white/10"
            >
              {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </Button>
          </div>
        </nav>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 p-6 transition-all duration-500 flex flex-col" style={{ backgroundColor: '#0A0A0F' }}>
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
                onClick={toggleMenu}
                className="text-white/70 hover:text-white transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="flex flex-col space-y-6">
              {isJobsRoute ? (
                <>
                  <a 
                    href="/jobs" 
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/jobs"); setIsMenuOpen(false); }}
                  >
                    Jobs
                  </a>
                  {user && (user.role === 'recruiter' || user.role === 'admin') && (
                    <a 
                      href="/jobs/post" 
                      className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                      onClick={(e) => { e.preventDefault(); setLocation("/jobs/post"); setIsMenuOpen(false); }}
                    >
                      Post Job
                    </a>
                  )}
                </>
              ) : (
                <>
                  <a 
                    href="/#about" 
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => {
                      e.preventDefault();
                      setIsMenuOpen(false);
                      if (window.location.pathname === '/') {
                        document.getElementById("about")?.scrollIntoView({ behavior: "smooth" });
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
                        document.getElementById("services")?.scrollIntoView({ behavior: "smooth" });
                      } else {
                        window.location.href = '/#services';
                      }
                    }}
                  >
                    Services
                  </a>
                  <a 
                    href="/jobs" 
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/jobs"); setIsMenuOpen(false); }}
                  >
                    Jobs
                  </a>
                </>
              )}
              
              {/* Mobile dashboard links based on role */}
              {user && user.role === 'candidate' && (
                <a 
                  href="/my-dashboard" 
                  className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                  onClick={(e) => { e.preventDefault(); setLocation("/my-dashboard"); setIsMenuOpen(false); }}
                >
                  My Dashboard
                </a>
              )}

              {user && user.role === 'recruiter' && (
                <a 
                  href="/recruiter-dashboard" 
                  className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                  onClick={(e) => { e.preventDefault(); setLocation("/recruiter-dashboard"); setIsMenuOpen(false); }}
                >
                  Recruiter Dashboard
                </a>
              )}

              {user && user.role === 'admin' && (
                <>
                  <a 
                    href="/admin" 
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/admin"); setIsMenuOpen(false); }}
                  >
                    Admin
                  </a>
                  <a 
                    href="/analytics" 
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/analytics"); setIsMenuOpen(false); }}
                  >
                    Analytics
                  </a>
                </>
              )}

              {user ? (
                <Button
                  onClick={() => { handleLogout(); setIsMenuOpen(false); }}
                  variant="outline"
                  className="w-full border-white/20 text-white hover:bg-white/10"
                >
                  Logout
                </Button>
              ) : (
                <div className="space-y-6">
                  <a 
                    href="/candidate-auth" 
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/candidate-auth"); setIsMenuOpen(false); }}
                  >
                    Job Seekers
                  </a>
                  <a 
                    href="/recruiter-auth" 
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/recruiter-auth"); setIsMenuOpen(false); }}
                  >
                    Recruiters
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="pt-20">
        {children}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default Layout;