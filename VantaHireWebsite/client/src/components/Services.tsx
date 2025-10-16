import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { User, Building, GraduationCap } from "lucide-react";

interface ServiceCardProps {
  title: string;
  items: string[];
  icon: React.ReactNode;
  accentColor: string;
  bgColor: string;
  detailItems?: string[];
}

const ServiceCard = ({ 
  title, 
  items, 
  icon, 
  accentColor,
  bgColor,
  detailItems = [] 
}: ServiceCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  // Extract color hex without the 'text-' prefix for styling
  const colorHex = accentColor === 'text-[#2D81FF]' ? '#2D81FF' : 
                   accentColor === 'text-[#FF9D4A]' ? '#FF9D4A' : 
                   accentColor === 'text-[#FF5BA8]' ? '#FF5BA8' : '#7B38FB';

  return (
    <div 
      className={`service-card rounded-xl p-8 premium-card border border-white/5 backdrop-blur-lg transition-all duration-500 group
        ${isExpanded ? 'bg-gradient-to-br from-black/50 to-black/30 scale-105 shadow-2xl border-white/10' : 
                      'bg-gradient-to-br from-black/30 to-black/10 hover:border-white/10'}
      `}
      style={{ 
        boxShadow: isExpanded || isHovered 
          ? `0 10px 30px -5px rgba(${colorHex.replace('#', '').match(/../g)?.map(x => parseInt(x, 16)).join(', ') || '0,0,0'}, 0.2)` 
          : 'none' 
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Top accent line with gradient */}
      <div 
        className={`absolute top-0 left-0 right-0 h-1 opacity-60 ${isExpanded || isHovered ? 'opacity-100' : ''}`}
        style={{ 
          background: `linear-gradient(to right, transparent, ${colorHex}, transparent)`,
          transition: 'all 0.5s ease'
        }}
      ></div>
      
      <div className="flex flex-col items-center text-center relative">
        {/* Icon with dynamic glow effect */}
        <div 
          className={`w-20 h-20 mb-6 p-4 rounded-xl flex items-center justify-center transition-all duration-500
                    ${isExpanded ? 'scale-110' : isHovered ? 'scale-105' : ''}
          `}
          style={{ 
            background: `linear-gradient(135deg, ${colorHex}40, ${colorHex}15)`,
            boxShadow: isExpanded || isHovered ? `0 8px 32px -4px ${colorHex}30` : 'none'
          }}
        >
          <div className="relative">
            {icon}
            {/* Animated pulse glow behind icon */}
            <div 
              className="absolute inset-0 rounded-full blur-md -z-10 animate-pulse-slow" 
              style={{ 
                backgroundColor: `${colorHex}30`,
                opacity: isExpanded || isHovered ? 0.8 : 0.4
              }}
            ></div>
          </div>
        </div>
        
        <h3 className={`text-2xl font-bold mb-5 animate-gradient-text transition-all duration-300 ${isExpanded ? 'text-2xl' : ''}`}
            style={{ 
              backgroundImage: `linear-gradient(90deg, white, ${colorHex})`,
              WebkitBackgroundClip: 'text'
            }}
        >
          {title}
        </h3>
        
        <ul className="space-y-4 text-left w-full">
          {items.map((item, index) => (
            <li key={index} className="flex items-center group">
              <span 
                className={`mr-3 h-2 w-2 rounded-full transition-all duration-300 group-hover:scale-150 flex-shrink-0`}
                style={{ backgroundColor: colorHex }}
              ></span>
              <span className="text-white/80 group-hover:text-white transition-all duration-300">{item}</span>
            </li>
          ))}
        </ul>
        
        {detailItems.length > 0 && (
          <div className={`mt-6 w-full overflow-hidden transition-all duration-500 ${isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent mb-5"></div>
            <ul className="space-y-3 text-left text-sm pt-2">
              {detailItems.map((detail, index) => (
                <li key={index} className="flex items-start animate-fade-in" style={{ animationDelay: `${index * 0.1}s` }}>
                  <span className="mr-3 flex-shrink-0 mt-1">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path 
                        d="M5 12H19M19 12L12 5M19 12L12 19" 
                        stroke={colorHex} 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <span className="text-white/80">{detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        
        {detailItems.length > 0 && (
          <Button 
            variant="ghost" 
            size="sm" 
            className={`mt-6 hover:bg-white/10 border border-white/10 backdrop-blur-sm rounded-full px-5 py-1 group-hover:border-white/20 transition-all duration-300`}
            style={{ color: colorHex }}
            onClick={toggleExpand}
          >
            <span className="relative">
              {isExpanded ? 'Show Less' : 'Learn More'}
              <span 
                className="absolute bottom-0 left-0 h-px w-0 group-hover:w-full transition-all duration-300"
                style={{ background: colorHex }}
              ></span>
            </span>
          </Button>
        )}
        
        {/* Decorative corner accent */}
        <div 
          className={`absolute bottom-1.5 right-1.5 w-5 h-5 transition-all duration-500 opacity-0 ${isExpanded || isHovered ? 'opacity-100' : ''}`}
        >
          <div className="absolute bottom-0 right-0 w-full h-[1px]" 
               style={{ background: `linear-gradient(to left, ${colorHex}, transparent)` }}></div>
          <div className="absolute bottom-0 right-0 h-full w-[1px]" 
               style={{ background: `linear-gradient(to top, ${colorHex}, transparent)` }}></div>
        </div>
      </div>
    </div>
  );
};

const Services = () => {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    
    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    
    return () => observer.disconnect();
  }, []);
  
  return (
    <section 
      id="services" 
      ref={sectionRef}
      className="bg-gradient-to-b from-[#2D1B69] to-[#1E0B40] relative overflow-hidden py-24"
    >
      {/* Premium background decorations */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
      
      {/* Premium background glow effects */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-[#7B38FB]/10 rounded-full blur-[50px] animate-pulse-slow"></div>
      <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-[#2D81FF]/10 rounded-full blur-[50px] animate-pulse-slow" style={{ animationDelay: '1.5s' }}></div>
      <div className="absolute top-1/3 right-1/3 w-72 h-72 bg-[#FF5BA8]/10 rounded-full blur-[40px] animate-pulse-slow" style={{ animationDelay: '0.8s' }}></div>
      
      {/* Animated floating particles */}
      <div className="absolute w-3 h-3 bg-blue-300/40 rounded-full top-1/4 right-1/3 animate-float-path" 
           style={{animationDelay: "0.3s", animationDuration: "15s"}}></div>
      <div className="absolute w-2 h-2 bg-purple-300/40 rounded-full bottom-1/3 left-1/4 animate-float-path" 
           style={{animationDelay: "1.5s", animationDuration: "18s"}}></div>
      <div className="absolute w-4 h-4 bg-pink-300/40 rounded-full top-1/2 right-1/4 animate-float-path" 
           style={{animationDelay: "0.8s", animationDuration: "20s"}}></div>
      
      <div className="container mx-auto px-4 py-10 relative z-10">
        <div className={`text-center mb-20 ${isVisible ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.2s' }}>
          <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mx-auto mb-6 animate-slide-right" 
               style={{ animationDelay: '0.3s' }}></div>
               
          <h2 className="text-4xl md:text-5xl font-bold mb-6 animate-gradient-text inline-block">
            Our Services
          </h2>
          
          <p className="text-lg text-white/80 max-w-2xl mx-auto leading-relaxed animate-slide-up" 
             style={{ animationDelay: '0.5s' }}>
            Specialized recruitment solutions tailored to your specific needs, 
            whether you're a company, candidate, or educational institution.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className={`transform transition-all duration-1000 ${isVisible ? 'animate-slide-left' : 'opacity-0 -translate-x-20'}`}
               style={{animationDelay: "150ms"}}>
            <ServiceCard
              title="For Individuals"
              items={[
                "SWOT Analysis & Career Planning",
                "Resume & LinkedIn Optimization",
                "Skill Gap Assessment & Upskilling Pathway",
                "Interview Preparation Bootcamps",
                "Personal Branding & Networking Mastery"
              ]}
              detailItems={[]}
              icon={<User className="w-full h-full text-white" />}
              accentColor="text-[#2D81FF]"
              bgColor="rgba(30, 11, 64, 0.8)"
            />
          </div>
          
          <div className={`transform transition-all duration-1000 ${isVisible ? 'animate-slide-up' : 'opacity-0 translate-y-20'}`}
               style={{animationDelay: "300ms"}}>
            <ServiceCard
              title="For Organizations"
              items={[
                "Recruitment Consulting (AI-driven + Traditional)",
                "DEI Hiring and Leadership Search",
                "Freelancer Recruiter Marketplace",
                "Employer Branding Strategy",
                "Recruiter Upskilling Programs"
              ]}
              detailItems={[]}
              icon={<Building className="w-full h-full text-white" />}
              accentColor="text-[#FF9D4A]"
              bgColor="rgba(30, 11, 64, 0.8)"
            />
          </div>
          
          <div className={`transform transition-all duration-1000 ${isVisible ? 'animate-slide-right' : 'opacity-0 translate-x-20'}`}
               style={{animationDelay: "450ms"}}>
            <ServiceCard
              title="For Colleges & Universities"
              items={[
                "Corporate Readiness Bootcamps",
                "Resume Writing & LinkedIn Workshops",
                "Mock Interviews & Group Discussions",
                "Guest Lectures & Panel Discussions",
                "Entrepreneurship Cell Setup"
              ]}
              detailItems={[]}
              icon={<GraduationCap className="w-full h-full text-white" />}
              accentColor="text-[#FF5BA8]"
              bgColor="rgba(30, 11, 64, 0.8)"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default Services;
