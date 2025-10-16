import Star from "@/components/illustrations/Star";
import { useState, useRef, useEffect } from "react";
import { 
  Monitor, 
  Smartphone, 
  GraduationCap, 
  Building2, 
  Landmark,
  Cpu,
  Beaker,
  Braces,
  ShieldCheck,
  Cloud
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Industry {
  icon: React.ReactNode;
  color: string;
  name: string;
  description: string;
  keyPositions: string[];
}

const industries: Industry[] = [
  {
    icon: <Monitor className="h-8 w-8 text-white" />,
    color: "#2D81FF",
    name: "Technology & SaaS",
    description: "We specialize in scaling engineering teams for SaaS platforms, from early-stage startups to enterprise solutions.",
    keyPositions: ["Full-Stack Engineers", "Product Managers", "DevOps Specialists", "UX/UI Designers", "QA Automation Engineers"]
  },
  {
    icon: <Smartphone className="h-8 w-8 text-white" />,
    color: "#7B38FB", 
    name: "Telecom & Networking",
    description: "Our telecom recruitment focuses on specialized engineers with expertise in wireless, fiber, and emerging network architectures.",
    keyPositions: ["Network Architects", "Systems Engineers", "RF Engineers", "5G Specialists", "SDN/NFV Engineers"]
  },
  {
    icon: <GraduationCap className="h-8 w-8 text-white" />,
    color: "#FF5BA8",
    name: "EdTech & Higher Education",
    description: "We help educational institutions and EdTech companies build innovative teams focused on transforming learning experiences.",
    keyPositions: ["Learning Experience Designers", "ML Engineers", "Education Data Scientists", "Product Managers", "Student Success Specialists"]
  },
  {
    icon: <Building2 className="h-8 w-8 text-white" />,
    color: "#FF9D4A",
    name: "Enterprise Software",
    description: "Our talent acquisition for enterprise software companies focuses on scalability, security, and integration expertise.",
    keyPositions: ["Solutions Architects", "Enterprise Integration Specialists", "Account Executives", "Customer Success Managers", "Technical Consultants"]
  },
  {
    icon: <Landmark className="h-8 w-8 text-white" />,
    color: "#50E3C2",
    name: "FinTech & Startups",
    description: "We help innovative fintech companies disrupt traditional financial services with specialized technical and compliance talent.",
    keyPositions: ["Blockchain Developers", "Payment Systems Engineers", "Financial Compliance Experts", "Cybersecurity Specialists", "Quantitative Analysts"]
  },
  {
    icon: <Cpu className="h-8 w-8 text-white" />,
    color: "#FF5BA8",
    name: "Semiconductor",
    description: "We connect semiconductor companies with specialized talent in chip design, verification, and manufacturing processes.",
    keyPositions: ["ASIC Design Engineers", "Verification Engineers", "Embedded Systems Developers", "Process Engineers", "Test Engineers"]
  },
  {
    icon: <Beaker className="h-8 w-8 text-white" />,
    color: "#2D81FF",
    name: "Biotech & Life Sciences",
    description: "Our specialized recruiters help biotech firms find the perfect balance of scientific expertise and technical innovation.",
    keyPositions: ["Computational Biologists", "Bioinformatics Specialists", "Research Scientists", "Clinical Data Managers", "Regulatory Affairs Specialists"]
  },
  {
    icon: <Braces className="h-8 w-8 text-white" />,
    color: "#7B38FB",
    name: "AI & Machine Learning",
    description: "We connect companies with AI/ML talent across various specializations from computer vision to natural language processing.",
    keyPositions: ["ML Engineers", "Research Scientists", "Data Engineers", "MLOps Specialists", "Applied AI Researchers"]
  },
  {
    icon: <ShieldCheck className="h-8 w-8 text-white" />,
    color: "#FF9D4A",
    name: "Cybersecurity",
    description: "Our security talent acquisition focuses on helping companies build robust security teams to protect critical assets.",
    keyPositions: ["Security Architects", "Penetration Testers", "Security Analysts", "Compliance Specialists", "Security Operations Engineers"]
  },
  {
    icon: <Cloud className="h-8 w-8 text-white" />,
    color: "#50E3C2",
    name: "Cloud Infrastructure",
    description: "We help companies find specialized talent to build, manage, and optimize cloud-native infrastructure at scale.",
    keyPositions: ["Cloud Architects", "DevOps Engineers", "SRE Specialists", "Platform Engineers", "Multi-Cloud Consultants"]
  }
];

const IndustryCard = ({ 
  industry, 
  isActive, 
  onClick,
  index = 0
}: { 
  industry: Industry; 
  isActive: boolean; 
  onClick: () => void;
  index?: number;
}) => {
  const [isHovering, setIsHovering] = useState(false);
  
  return (
    <div 
      className={`
        relative overflow-hidden transition-all duration-500 cursor-pointer
        p-6 rounded-xl backdrop-blur-lg group
        ${isActive 
          ? 'bg-gradient-to-br from-white/10 to-white/5 premium-card border border-white/10' 
          : 'bg-white/5 hover:bg-gradient-to-br hover:from-white/8 hover:to-white/5 border border-white/5 hover:border-white/10'
        }
      `}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{
        boxShadow: isActive 
          ? `0 10px 30px -5px rgba(${industry.color === '#7B38FB' ? '123, 56, 251' : industry.color === '#2D81FF' ? '45, 129, 255' : industry.color === '#FF5BA8' ? '255, 91, 168' : industry.color === '#FF9D4A' ? '255, 157, 74' : '80, 227, 194'}, 0.25)`
          : 'none',
        transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      {/* Top decorative accent */}
      <div 
        className={`absolute top-0 left-0 right-0 h-0.5 opacity-60 ${isActive ? 'opacity-100' : 'group-hover:opacity-100'}`}
        style={{ 
          background: `linear-gradient(to right, transparent, ${industry.color}, transparent)`,
          transition: 'all 0.5s ease'
        }}
      ></div>
      
      <div className="flex items-center">
        <div 
          className={`
            p-3.5 rounded-xl mr-5 flex items-center justify-center
            transition-all duration-500
            ${isActive ? 'scale-110' : 'group-hover:scale-105'}
          `}
          style={{ 
            background: `linear-gradient(135deg, ${industry.color}, ${industry.color}CC)`,
            boxShadow: isActive || isHovering 
              ? `0 8px 20px -4px ${industry.color}80, 0 0 10px ${industry.color}40` 
              : `0 4px 10px -2px ${industry.color}30`
          }}
        >
          {industry.icon}
        </div>
        <div>
          <h3 className={`
            text-xl font-bold transition-all duration-300
            ${isActive ? 'text-white animate-gradient-text' : 'text-white/90 group-hover:text-white'}
          `}>
            {industry.name}
          </h3>
        </div>
      </div>
      
      {isActive && (
        <div className="mt-6 pt-4 border-t border-white/10 animate-fade-in">
          <p className="text-base text-white/80 mb-4 leading-relaxed">
            {industry.description}
          </p>
          <h4 className="text-sm font-semibold mb-3 text-white/90 flex items-center">
            <span className="h-3 w-3 rounded-full mr-2" style={{ backgroundColor: industry.color }}></span>
            Key Positions
          </h4>
          <div className="flex flex-wrap gap-2">
            {industry.keyPositions.map((position, idx) => (
              <span 
                key={idx}
                className="inline-block text-xs px-3 py-1.5 rounded-full text-white/90 transition-all duration-300 hover:text-white hover:scale-105"
                style={{ 
                  animationDelay: `${(index * 0.1) + (idx * 0.1)}s`,
                  animation: 'bounce-in 0.5s forwards',
                  backgroundColor: `${industry.color}30`,
                  border: `1px solid ${industry.color}40`,
                  boxShadow: `0 2px 5px ${industry.color}10`
                }}
              >
                {position}
              </span>
            ))}
          </div>
        </div>
      )}
      
      {/* Premium hover effect - subtle gradient overlay */}
      <div 
        className={`absolute inset-0 opacity-0 transition-opacity duration-500 pointer-events-none ${isHovering && !isActive ? 'opacity-10' : ''}`}
        style={{ 
          background: `radial-gradient(circle at center, ${industry.color}80 0%, transparent 70%)`,
        }}
      />
      
      {/* Animated corner accent */}
      <div 
        className={`absolute bottom-1.5 right-1.5 w-5 h-5 transition-all duration-500 opacity-0 ${isActive ? 'opacity-100' : 'group-hover:opacity-70'}`}
      >
        <div className="absolute bottom-0 right-0 w-full h-[1px]" 
             style={{ background: `linear-gradient(to left, ${industry.color}, transparent)` }}></div>
        <div className="absolute bottom-0 right-0 h-full w-[1px]" 
             style={{ background: `linear-gradient(to top, ${industry.color}, transparent)` }}></div>
      </div>
    </div>
  );
};

const Industries = () => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [isInView, setIsInView] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
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
      id="industries" 
      ref={sectionRef}
      className="bg-gradient-to-b from-[#1E0B40] to-[#2D1B69] py-20 relative overflow-hidden"
    >
      {/* Premium background decorations */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
      <div className="absolute top-0 right-0 w-96 h-96 bg-[#7B38FB]/15 rounded-full blur-[100px] animate-pulse-slow"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#2D81FF]/15 rounded-full blur-[100px] animate-pulse-slow" style={{ animationDelay: '1.2s' }}></div>
      <div className="absolute top-1/3 left-1/4 w-72 h-72 bg-[#FF5BA8]/10 rounded-full blur-[80px] animate-pulse-slow" style={{ animationDelay: '0.8s' }}></div>
      
      {/* Animated particles */}
      <div className="absolute w-2 h-2 bg-blue-300/40 rounded-full top-1/4 right-1/3 animate-float-path" 
          style={{animationDelay: '0.3s', animationDuration: '15s'}}></div>
      <div className="absolute w-3 h-3 bg-purple-300/40 rounded-full bottom-1/3 left-1/4 animate-float-path" 
          style={{animationDelay: '1.5s', animationDuration: '18s'}}></div>
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <div className={`${isInView ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.2s' }}>
            <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mx-auto mb-6 animate-slide-right" 
                 style={{ animationDelay: '0.3s' }}></div>
                 
            <div className="relative inline-block">
              <Star className="w-12 h-12 absolute -top-6 -left-10 animate-pulse-slow" />
              <h2 className="text-4xl md:text-5xl font-bold animate-gradient-text inline-block">
                Industries We Serve
              </h2>
            </div>
            
            <p className="text-lg text-white/80 max-w-2xl mx-auto mt-6 leading-relaxed animate-slide-up" 
               style={{ animationDelay: '0.5s' }}>
              Our specialized recruiters have deep expertise across multiple industries, 
              allowing us to find the perfect talent match for your unique requirements.
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {industries.slice(0, 5).map((industry, index) => (
            <div 
              key={index} 
              className={`transform transition-all duration-700 ${isInView ? 'animate-slide-up' : 'opacity-0'}`}
              style={{ animationDelay: `${0.3 + (index * 0.1)}s` }}
            >
              <IndustryCard 
                industry={industry}
                isActive={activeIndex === index}
                onClick={() => setActiveIndex(activeIndex === index ? null : index)}
                index={index}
              />
            </div>
          ))}
        </div>
        
        <div className={`mt-12 ${activeIndex !== null ? 'animate-fade-in' : 'hidden'}`} style={{ animationDuration: '0.3s' }}>
          <div className="flex justify-center">
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-white/70 hover:text-white hover:bg-white/10 backdrop-blur-sm px-6 py-2 rounded-full border border-white/10 premium-card group"
              onClick={() => setActiveIndex(null)}
            >
              <span className="group-hover:tracking-wide transition-all duration-300">Close Details</span>
            </Button>
          </div>
        </div>
        
        <div className={`mt-20 ${isInView ? 'animate-slide-up' : 'opacity-0'}`} style={{ animationDelay: '0.7s' }}>
          <div className="relative">
            {/* Gradient edges for carousel effect */}
            <div className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-[#1E0B40] to-transparent z-10"></div>
            <div className="absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-[#1E0B40] to-transparent z-10"></div>
            
            <div className="flex overflow-x-auto py-8 scrollbar-hide space-x-5 relative">
              <div className="flex space-x-5 animate-scroll">
                {industries.slice(5).map((industry, index) => (
                  <div key={index + 5} className="flex-shrink-0 w-72">
                    <div className="bg-gradient-to-br from-white/8 to-white/3 backdrop-blur-lg p-5 rounded-xl h-full flex flex-col border border-white/5 premium-card hover:border-white/10 transition-all duration-500">
                      <div className="flex items-center mb-4">
                        <div 
                          className="p-3 rounded-xl mr-4 flex items-center justify-center shadow-lg"
                          style={{ 
                            background: `linear-gradient(135deg, ${industry.color}, ${industry.color}CC)`,
                            boxShadow: `0 4px 15px -3px ${industry.color}40`
                          }}
                        >
                          {industry.icon}
                        </div>
                        <h3 className="text-lg font-bold text-white/90">{industry.name}</h3>
                      </div>
                      <p className="text-sm text-white/70 flex-grow leading-relaxed">{industry.description}</p>
                      
                      {/* Decorative corner accent */}
                      <div className="absolute bottom-2 right-2 w-4 h-4">
                        <div className="absolute bottom-0 right-0 w-full h-[1px]" 
                             style={{ background: `linear-gradient(to left, ${industry.color}50, transparent)` }}></div>
                        <div className="absolute bottom-0 right-0 h-full w-[1px]" 
                             style={{ background: `linear-gradient(to top, ${industry.color}50, transparent)` }}></div>
                      </div>
                    </div>
                  </div>
                ))}
                {industries.slice(5).map((industry, index) => (
                  <div key={`dup-${index + 5}`} className="flex-shrink-0 w-72">
                    <div className="bg-gradient-to-br from-white/8 to-white/3 backdrop-blur-lg p-5 rounded-xl h-full flex flex-col border border-white/5 premium-card hover:border-white/10 transition-all duration-500">
                      <div className="flex items-center mb-4">
                        <div 
                          className="p-3 rounded-xl mr-4 flex items-center justify-center shadow-lg"
                          style={{ 
                            background: `linear-gradient(135deg, ${industry.color}, ${industry.color}CC)`,
                            boxShadow: `0 4px 15px -3px ${industry.color}40`
                          }}
                        >
                          {industry.icon}
                        </div>
                        <h3 className="text-lg font-bold text-white/90">{industry.name}</h3>
                      </div>
                      <p className="text-sm text-white/70 flex-grow leading-relaxed">{industry.description}</p>
                      
                      {/* Decorative corner accent */}
                      <div className="absolute bottom-2 right-2 w-4 h-4">
                        <div className="absolute bottom-0 right-0 w-full h-[1px]" 
                             style={{ background: `linear-gradient(to left, ${industry.color}50, transparent)` }}></div>
                        <div className="absolute bottom-0 right-0 h-full w-[1px]" 
                             style={{ background: `linear-gradient(to top, ${industry.color}50, transparent)` }}></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          <div className="text-center mt-12">
            <p className="text-white/80 font-medium mb-5 animate-fade-in" style={{ animationDelay: '0.9s' }}>
              Don't see your industry? We have expertise in many more sectors.
            </p>
            <Button
              variant="gradient"
              size="xl"
              className="rounded-full premium-card hover:scale-105 transform transition-all duration-300 group animate-fade-in shadow-lg"
              style={{ animationDelay: '1.1s' }}
              onClick={() => {
                const contactSection = document.getElementById("contact");
                if (contactSection) {
                  contactSection.scrollIntoView({ behavior: "smooth" });
                }
              }}
            >
              <span className="group-hover:tracking-wide transition-all duration-300">Contact Us About Your Industry</span>
            </Button>
          </div>
        </div>
        
        {/* Bottom decorative accent */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#7B38FB]/30 to-transparent"></div>
      </div>
    </section>
  );
};

export default Industries;
