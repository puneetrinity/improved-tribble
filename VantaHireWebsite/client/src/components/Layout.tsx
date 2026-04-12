import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Menu, X, LogOut, Briefcase, Plus } from "lucide-react";
import { useState, useEffect, type CSSProperties } from "react";
import Footer from "@/components/Footer";
import QuickAccessBar from "@/components/QuickAccessBar";
import vantahireLogo from "@/assets/vantahire-logo.png";
import AtsSidebar from "@/components/AtsSidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

interface LayoutProps {
  children: React.ReactNode;
  noFooter?: boolean;
}

const Layout = ({ children, noFooter }: LayoutProps) => {
  const [location, setLocation] = useLocation();
  const { user, logoutMutation } = useAuth();
  const { data: orgData } = useOrganization();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Type guard to help TypeScript narrow the user type
  const isRecruiter = user?.role === 'recruiter';
  const isAdmin = user?.role === 'super_admin';
  const isHiringManager = user?.role === 'hiring_manager';
  const isCandidate = user?.role === 'candidate';

  // Organization role checks
  const orgRole = orgData?.membership?.role;
  const isOrgOwner = orgRole === 'owner';
  const isOrgAdmin = orgRole === 'admin';
  const isOrgOwnerOrAdmin = isOrgOwner || isOrgAdmin;
  const displayName = user?.firstName || user?.username || 'User';

  // Get role display label
  const getRoleLabel = (role: string | undefined) => {
    switch (role) {
      case 'admin': return 'Admin';
      case 'super_admin': return 'Admin';
      case 'recruiter': return 'Recruiter';
      case 'hiring_manager': return 'Hiring Manager';
      case 'candidate': return 'Candidate';
      default: return null;
    }
  };

  // ATS context detection - determines if we should use light ATS theme
  const atsUser = isRecruiter || isAdmin || isHiringManager || isCandidate;

  const isAtsRoute = (path: string): boolean => {
    const atsRoutes = [
      '/recruiter-dashboard',
      '/applications',
      '/candidates',
      '/my-jobs',
      '/jobs/post',
      '/admin',
      '/analytics',
      '/clients',
      '/hiring-manager',
      '/onboarding',
      '/my-dashboard',
      '/profile/settings',
      '/org/settings',
      '/org/team',
      '/org/billing',
      '/org/domain',
      '/org/analytics',
      '/org/choice',
      '/blocked/seat-removed',
    ];

    // Check exact matches first
    if (atsRoutes.some(route => path === route || path.startsWith(route + '/'))) {
      return true;
    }

    // Check for job management route patterns: /jobs/:id/applications, /jobs/:id/edit, /jobs/:id/pipeline, /jobs/:id/analytics
    if (path.match(/^\/jobs\/\d+\/(applications|edit|pipeline|analytics|sourcing|bulk-import)/)) {
      return true;
    }

    if (path.match(/^\/hiring-manager\/jobs\/\d+\/review/)) {
      return true;
    }

    return false;
  };

  const atsContext = atsUser && isAtsRoute(location);

  useEffect(() => {
    const handleScroll = () => {
      setScrollPosition(window.scrollY);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!atsContext) return;

    const syncSidebar = () => {
      const width = window.innerWidth;
      if (width >= 768 && width <= 1024) {
        setSidebarOpen(false);
        return;
      }
      if (width > 1024) {
        setSidebarOpen(true);
      }
    };

    syncSidebar();
    window.addEventListener("resize", syncSidebar);
    return () => window.removeEventListener("resize", syncSidebar);
  }, [atsContext]);

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const isJobsRoute = location.startsWith('/jobs');

  if (atsContext) {
    return (
      <div className="min-h-screen w-full overflow-x-hidden bg-[linear-gradient(180deg,#F4F6FA_0%,#EEF2F6_100%)] text-foreground ats-theme">
        <SidebarProvider
          defaultOpen
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          className="overflow-x-hidden"
          style={
            {
              "--sidebar-width": "16.5rem",
              "--sidebar-width-icon": "4.5rem",
            } as CSSProperties
          }
        >
          <AtsSidebar
            location={location}
            navigate={setLocation}
            onLogout={handleLogout}
            user={user}
            organizationData={orgData}
            isRecruiter={isRecruiter}
            isAdmin={isAdmin}
            isHiringManager={isHiringManager}
            isCandidate={isCandidate}
            isOrgOwner={isOrgOwner}
            isOrgOwnerOrAdmin={isOrgOwnerOrAdmin}
            displayName={displayName}
          />

          <SidebarInset className="min-h-svh overflow-x-hidden bg-transparent transition-[width] duration-200 ease-linear">
            <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border/70 bg-background/95 px-4 backdrop-blur md:hidden">
              <SidebarTrigger className="-ml-1" />
              <div className="flex min-w-0 items-center gap-2">
                <img src={vantahireLogo} alt="VantaHire" className="h-8 w-auto" />
                <span className="truncate text-sm font-semibold text-foreground">VantaHire ATS</span>
              </div>
            </div>

            <div className="flex min-h-[calc(100svh-3.5rem)] min-w-0 flex-1 flex-col overflow-x-hidden md:min-h-svh">
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
                {children}
              </div>
              {!noFooter && <Footer minimal />}
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    );
  }

  return (
    <div className={cn(
      "min-h-screen bg-background text-foreground",
      "public-theme"
    )}>
      {/* Quick Access Bar for authenticated users (not in ATS context) */}
      {user && <QuickAccessBar />}

      {/* Header (for public pages or as fallback) */}
      {!user && (
        <header className={`fixed top-0 left-0 right-0 transition-all duration-500 z-50
          ${scrollPosition > 50
            ? 'bg-[#0d0d1a]/95 backdrop-blur-lg shadow-lg py-3 border-b border-primary/20'
            : 'bg-[#0d0d1a]/80 backdrop-blur-sm py-6'}`}
        >
        {/* Premium background glow effects */}
        <div className={`absolute inset-0 -z-10 transition-opacity duration-700 ${scrollPosition > 50 ? 'opacity-100' : 'opacity-0'}`}>
          <div className="absolute left-1/4 w-48 h-12 bg-[#7B38FB]/10 rounded-full blur-[50px] animate-pulse-slow"></div>
          <div className="absolute right-1/4 w-48 h-12 bg-[#2D81FF]/10 rounded-full blur-[50px] animate-pulse-slow" 
               style={{ animationDelay: '1.2s' }}></div>
        </div>
        
        {/* Bottom accent line */}
        <div className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/40 to-transparent
                        transition-opacity duration-500 ${scrollPosition > 50 ? 'opacity-100' : 'opacity-50'}`}>
        </div>
        
        <nav className="container mx-auto px-4 flex items-center justify-between">
          {/* Logo */}
          <Link
            href="/"
            className="flex items-center gap-2 group"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          >
            <img
              src={vantahireLogo}
              alt="VantaHire"
              className="h-10 w-auto transition-transform duration-300 group-hover:scale-105"
            />
            <span className="text-xl font-bold gradient-text-mixed hidden sm:inline">VantaHire</span>
          </Link>
          
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

                {user && (isRecruiter || isAdmin) && (
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
                  href="/features"
                  className={`relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group ${
                    location === '/features' ? 'text-white font-medium' : 'text-white/70'
                  }`}
                  onClick={(e) => { e.preventDefault(); setLocation("/features"); }}
                >
                  <span className="relative z-10">Features</span>
                  <span className={`absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 ${
                    location === '/features' ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                  }`}></span>
                </a>

                <a
                  href="/pricing"
                  className={`relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group ${
                    location === '/pricing' ? 'text-white font-medium' : 'text-white/70'
                  }`}
                  onClick={(e) => { e.preventDefault(); setLocation("/pricing"); }}
                >
                  <span className="relative z-10">Pricing</span>
                  <span className={`absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 ${
                    location === '/pricing' ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                  }`}></span>
                </a>

                <a
                  href="/jobs"
                  className={`relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group ${
                    location === '/jobs' ? 'text-white font-medium' : 'text-white/70'
                  }`}
                  onClick={(e) => { e.preventDefault(); setLocation("/jobs"); }}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    Jobs
                  </span>
                  <span className={`absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 ${
                    location === '/jobs' ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100'
                  }`}></span>
                </a>
              </>
            )}


            {/* User Actions */}
            {user ? (
              <div className="flex items-center gap-4">
                <span className="text-white/70 text-sm">
                  Welcome, {displayName}
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
                  rel="nofollow"
                  className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                  onClick={(e) => { e.preventDefault(); setLocation("/candidate-auth"); }}
                >
                  <span className="relative z-10">Job Seekers</span>
                  <span className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] w-full transform origin-left transition-transform duration-300 scale-x-0 group-hover:scale-x-100"></span>
                </a>
                <a
                  href="/recruiter-auth"
                  rel="nofollow"
                  className="relative px-3 py-2 hover:text-white transition-all duration-300 overflow-hidden group text-white/70"
                  onClick={(e) => { e.preventDefault(); setLocation("/recruiter-auth"); }}
                >
                  <span className="relative z-10">For Recruiters</span>
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
          <div className="md:hidden fixed inset-0 z-50 p-6 transition-all duration-500 flex flex-col" style={{ backgroundColor: '#0d0d1a' }}>
            <div className="flex justify-between items-center mb-8">
              <Link
                href="/"
                className="flex items-center gap-2"
                onClick={() => {
                  setIsMenuOpen(false);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                <img
                  src={vantahireLogo}
                  alt="VantaHire"
                  className="h-10 w-auto"
                />
                <span className="text-xl font-bold gradient-text-mixed">VantaHire</span>
              </Link>
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
                  {user && (isRecruiter || isAdmin) && (
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
                    href="/features"
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/features"); setIsMenuOpen(false); }}
                  >
                    Features
                  </a>
                  <a
                    href="/pricing"
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/pricing"); setIsMenuOpen(false); }}
                  >
                    Pricing
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
              

              {user ? (
                <div className="space-y-6">
                  {(isRecruiter || isAdmin) && (
                    <>
                      <a
                        href="/recruiter-dashboard"
                        className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                        onClick={(e) => { e.preventDefault(); setLocation("/recruiter-dashboard"); setIsMenuOpen(false); }}
                      >
                        Dashboard
                      </a>
                      <a
                        href="/applications"
                        className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                        onClick={(e) => { e.preventDefault(); setLocation("/applications"); setIsMenuOpen(false); }}
                      >
                        Applications
                      </a>
                      <a
                        href="/candidates"
                        className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                        onClick={(e) => { e.preventDefault(); setLocation("/candidates"); setIsMenuOpen(false); }}
                      >
                        Talent Search
                      </a>
                      <a
                        href="/my-jobs"
                        className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                        onClick={(e) => { e.preventDefault(); setLocation("/my-jobs"); setIsMenuOpen(false); }}
                      >
                        My Jobs
                      </a>
                      <a
                        href="/pricing"
                        className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                        onClick={(e) => { e.preventDefault(); setLocation("/pricing"); setIsMenuOpen(false); }}
                      >
                        Pricing
                      </a>
                    </>
                  )}
                  <Button
                    onClick={() => { handleLogout(); setIsMenuOpen(false); }}
                    variant="outline"
                    className="w-full border-white/20 text-white hover:bg-white/10"
                  >
                    Logout
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  <a
                    href="/candidate-auth"
                    rel="nofollow"
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/candidate-auth"); setIsMenuOpen(false); }}
                  >
                    Job Seekers
                  </a>
                  <a
                    href="/recruiter-auth"
                    rel="nofollow"
                    className="text-xl relative px-2 py-1 text-white transition-all duration-300 border-l-2 pl-4 border-transparent hover:border-[#7B38FB]"
                    onClick={(e) => { e.preventDefault(); setLocation("/recruiter-auth"); setIsMenuOpen(false); }}
                  >
                    For Recruiters
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
      </header>
      )}

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
