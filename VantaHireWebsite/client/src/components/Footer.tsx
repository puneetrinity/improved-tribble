import { Link, useLocation } from "wouter";

const Footer = () => {
  const [location] = useLocation();

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleNavigation = (e: React.MouseEvent, sectionId: string) => {
    e.preventDefault();
    
    // If we're on the homepage, scroll to section
    if (location === '/') {
      scrollToSection(sectionId);
    } else {
      // Navigate to homepage first, then scroll
      window.location.href = `/#${sectionId}`;
    }
  };

  return (
    <footer className="bg-gradient-to-b from-[#2D1B69] to-[#1E0B40] relative overflow-hidden py-12">
      {/* Top accent line */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#7B38FB]/30 to-transparent"></div>
      
      {/* Background effects */}
      <div className="absolute top-0 left-1/4 w-64 h-64 bg-[#7B38FB]/5 rounded-full blur-[80px] animate-pulse-slow"></div>
      <div className="absolute bottom-0 right-1/4 w-64 h-64 bg-[#FF5BA8]/5 rounded-full blur-[80px] animate-pulse-slow" 
           style={{ animationDelay: '1.2s' }}></div>
           
      <div className="container mx-auto px-4 relative z-10">
        {/* Main footer content */}
        <div className="text-center">
          {/* VantaHire logo */}
          <div className="mb-8">
            <Link href="/" className="inline-block">
              <h2 className="text-4xl font-bold bg-gradient-to-r from-[#FF5BA8] to-[#7B38FB] bg-clip-text text-transparent hover:scale-105 transition-transform duration-300">
                VantaHire
              </h2>
            </Link>
          </div>
          
          {/* Navigation links */}
          <div className="flex flex-wrap justify-center gap-8 mb-8">
            <button 
              onClick={(e) => handleNavigation(e, 'about')}
              className="text-white/70 hover:text-white transition-all duration-300 text-lg font-medium relative group"
            >
              About
              <span className="absolute bottom-0 left-0 h-px w-0 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] group-hover:w-full transition-all duration-300"></span>
            </button>
            
            <button 
              onClick={(e) => handleNavigation(e, 'services')}
              className="text-white/70 hover:text-white transition-all duration-300 text-lg font-medium relative group"
            >
              Services
              <span className="absolute bottom-0 left-0 h-px w-0 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] group-hover:w-full transition-all duration-300"></span>
            </button>
            
            <button 
              onClick={(e) => handleNavigation(e, 'industries')}
              className="text-white/70 hover:text-white transition-all duration-300 text-lg font-medium relative group"
            >
              Industries
              <span className="absolute bottom-0 left-0 h-px w-0 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] group-hover:w-full transition-all duration-300"></span>
            </button>
            
            <button 
              onClick={(e) => handleNavigation(e, 'contact')}
              className="text-white/70 hover:text-white transition-all duration-300 text-lg font-medium relative group"
            >
              Contact
              <span className="absolute bottom-0 left-0 h-px w-0 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] group-hover:w-full transition-all duration-300"></span>
            </button>
          </div>
        </div>
        
        {/* Divider line */}
        <div className="border-t border-white/10 mb-6"></div>
        
        {/* Bottom section */}
        <div className="flex flex-col md:flex-row justify-between items-center">
          {/* Copyright */}
          <div className="text-white/60 mb-4 md:mb-0 text-center md:text-left">
            © 2025 VantaHire. All rights reserved.
          </div>
          
          {/* Legal links */}
          <div className="flex flex-wrap gap-6 justify-center">
            <button 
              onClick={() => {
                window.dispatchEvent(new CustomEvent('cookie-consent:open', { detail: { reset: true } }));
              }}
              className="text-white/60 hover:text-white transition-all duration-300 relative group"
            >
              Cookie Preferences
              <span className="absolute bottom-0 left-0 h-px w-0 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] group-hover:w-full transition-all duration-300"></span>
            </button>

            <button 
              onClick={(e) => e.preventDefault()}
              className="text-white/60 hover:text-white transition-all duration-300 relative group"
            >
              Privacy Policy
              <span className="absolute bottom-0 left-0 h-px w-0 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] group-hover:w-full transition-all duration-300"></span>
            </button>
            
            <button 
              onClick={(e) => e.preventDefault()}
              className="text-white/60 hover:text-white transition-all duration-300 relative group"
            >
              Terms of Service
              <span className="absolute bottom-0 left-0 h-px w-0 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] group-hover:w-full transition-all duration-300"></span>
            </button>
            
            <button 
              onClick={(e) => e.preventDefault()}
              className="text-white/60 hover:text-white transition-all duration-300 relative group"
            >
              Cookie Policy
              <span className="absolute bottom-0 left-0 h-px w-0 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] group-hover:w-full transition-all duration-300"></span>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
