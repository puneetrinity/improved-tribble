import Cube from "@/components/illustrations/Cube";
import { useState, useEffect, useRef } from "react";
import { Check, Trophy, Users, Building, Star, Award, Gem, TrendingUp } from "lucide-react";

interface Stat {
  value: string;
  label: string;
  icon: React.ReactNode;
  color: string;
}

// Enhanced premium stat card with animations
const StatCard = ({ stat, index = 0 }: { stat: Stat; index?: number }) => (
  <div 
    className="bg-gradient-to-br from-[hsl(var(--vanta-dark))] to-[hsl(var(--vanta-dark))]/80 backdrop-blur-lg p-6 rounded-xl shadow-lg premium-card border border-white/5 hover:shadow-xl transition-all duration-500 group"
    style={{ animationDelay: `${index * 0.2}s` }}
  >
    <div className="flex items-center gap-5">
      <div className={`rounded-full p-3.5 ${stat.color} shadow-lg group-hover:shadow-${stat.color.split('bg-')[1]}/30 transition-all duration-300 group-hover:scale-110`}>
        {stat.icon}
      </div>
      <div>
        <h4 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/80 group-hover:tracking-wide transition-all duration-300">{stat.value}</h4>
        <p className="text-sm text-white/70 group-hover:text-white/90 transition-all duration-300">{stat.label}</p>
      </div>
    </div>
  </div>
);

const About = () => {
  const [isInView, setIsInView] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
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

  const tabs = [
    { name: "The Problem", icon: <Users className="h-5 w-5" /> },
    { name: "Our Approach", icon: <Trophy className="h-5 w-5" /> },
    { name: "The Result", icon: <Building className="h-5 w-5" /> }
  ];

  const tabContents = [
    <div key="story" className="space-y-4">
      <p className="text-lg leading-relaxed">
        We talked to recruiters across consulting firms, agencies, and fast-growing teams and heard the same thing:
      </p>
      <p className="text-lg leading-relaxed text-white/90 italic">
        "My ATS works against me, not with me."
      </p>
      <p className="text-lg leading-relaxed">
        Most systems were built without recruiter input and optimized for enterprise complexity. Simple questions like
        "how many candidates are in my pipeline?" take multiple screens and exports.
      </p>
      <p className="text-lg leading-relaxed">
        So we built the ATS recruiters actually wanted: <span className="text-[#FF5BA8] font-semibold">every workflow validated by recruiters,
        every screen optimized for velocity</span>.
      </p>
    </div>,
    <div key="approach" className="space-y-4">
      <p className="text-lg leading-relaxed font-semibold text-white">
        What makes us different:
      </p>
      <ul className="space-y-3 mt-4">
        {[
          "Recruiter-first, not afterthought: If it adds clicks, it doesn't ship.",
          "Velocity over bureaucracy: Built for teams that move fastâ€”not approval chains.",
          "Clarity over complexity: Answers at a glance, not buried in reports.",
          "Human decisions, AI acceleration: Smart algorithms surface candidates; you make the calls."
        ].map((item, i) => (
          <li key={i} className="flex items-start">
            <Check className="h-5 w-5 text-[#7B38FB] mr-2 mt-1 flex-shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>,
    <div key="impact" className="space-y-4">
      <p className="text-lg leading-relaxed">
        <span className="font-semibold text-white">2,500+ placements.</span> <span className="font-semibold text-white">96% satisfaction.</span> <span className="font-semibold text-white">20+ years of expertise.</span>
      </p>
      <p className="text-lg leading-relaxed">
        From consulting firms managing 50+ roles to startups hiring their first engineer,
        we've helped teams recruit faster without the complexity.
      </p>
      <p className="text-lg leading-relaxed text-white/90 italic">
        "For the first time, I open my ATS and know exactly what to do."
      </p>
    </div>
  ];

  return (
    <section
      id="about"
      ref={sectionRef}
      className="bg-[var(--vh-bg-primary)] relative overflow-hidden py-24"
    >
      {/* Premium background decorations */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary/20 rounded-full blur-[50px] animate-pulse-slow"></div>
      <div className="absolute top-0 right-0 w-96 h-96 bg-info/20 rounded-full blur-[50px] animate-pulse-slow" 
           style={{ animationDelay: '1.2s' }}></div>
      <div className="absolute top-1/2 left-1/4 w-72 h-72 bg-primary/10 rounded-full blur-[40px] animate-pulse-slow"
           style={{ animationDelay: '0.6s' }}></div>
           
      {/* Animated particles */}
      <div className="absolute w-3 h-3 bg-info/50/40 rounded-full top-1/3 right-1/3 animate-float-path" 
          style={{animationDuration: '20s'}}></div>
      <div className="absolute w-2 h-2 bg-primary/70/40 rounded-full bottom-1/4 left-1/4 animate-float-path" 
          style={{animationDelay: '0.8s', animationDuration: '16s'}}></div>
      
      <div className="container mx-auto px-4 relative z-10">
        <div className={`text-center mb-12 ${isInView ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.2s' }}>
          <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mx-auto mb-6 animate-slide-right"
               style={{ animationDelay: '0.3s' }}></div>

          <h2 className="text-4xl md:text-5xl font-bold mb-6 animate-gradient-text inline-block">
            Why ealana?
          </h2>

          <p className="text-lg text-white/80 max-w-2xl mx-auto animate-slide-up" style={{ animationDelay: '0.6s' }}>
            We built ealana because your ATS wasn't built for you. Discover our recruiter-first approach.
          </p>
        </div>

        {/* Key Stats - Always Visible */}
        <div className={`grid grid-cols-1 md:grid-cols-3 gap-6 mb-16 max-w-4xl mx-auto ${isInView ? 'animate-slide-up' : 'opacity-0'}`} style={{ animationDelay: '0.8s' }}>
          <StatCard stat={{
            value: "20+",
            label: "Years of Experience",
            icon: <Users className="h-5 w-5 text-white" />,
            color: "bg-[#7B38FB]"
          }} index={0} />
          <StatCard stat={{
            value: "2.5K+",
            label: "Successful Placements",
            icon: <Award className="h-5 w-5 text-white" />,
            color: "bg-[#2D81FF]"
          }} index={1} />
          <StatCard stat={{
            value: "96%",
            label: "Client Satisfaction",
            icon: <Star className="h-5 w-5 text-white" />,
            color: "bg-[#FF5BA8]"
          }} index={2} />
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          {/* Left side - Cube + Stats */}
          <div className="lg:col-span-4 space-y-10">
            <div className={`transition-all duration-1000 ${isInView ? 'animate-slide-up' : 'opacity-0'}`} style={{ animationDelay: '0.4s' }}>
              <div className="relative py-8">
                <div className="absolute inset-0 bg-gradient-to-r from-[#2D81FF]/20 to-[#7B38FB]/20 rounded-full blur-[40px] animate-pulse-slow"></div>
                <div className="relative flex justify-center">
                  <Cube className="w-48 h-48 animate-float-path" />
                </div>
                <div className="absolute h-px w-full bg-gradient-to-r from-transparent via-[#7B38FB]/50 to-transparent bottom-0 animate-shine"></div>
              </div>
            </div>
          </div>
          
          {/* Right side - Content and Tabs */}
          <div className="lg:col-span-8">
            <div className={`transition-all duration-700 ${isInView ? 'animate-slide-up' : 'opacity-0'}`} style={{ animationDelay: '0.5s' }}>
              {/* Premium Tabs */}
              <div className="flex border-b border-white/10 mb-8 overflow-x-auto pb-0.5 no-scrollbar">
                {tabs.map((tab, index) => (
                  <button
                    key={index}
                    onClick={() => setActiveTab(index)}
                    className={`flex items-center px-6 py-4 font-medium transition-all duration-300 whitespace-nowrap relative group
                      ${activeTab === index 
                        ? 'text-white' 
                        : 'text-white/60 hover:text-white/90'
                      }
                    `}
                  >
                    <span className={`mr-2 transition-all duration-300 ${activeTab === index ? 'text-[#7B38FB]' : 'group-hover:text-[#7B38FB]/80'}`}>
                      {tab.icon}
                    </span>
                    {tab.name}
                    
                    {/* Animated active indicator */}
                    {activeTab === index && (
                      <div className="absolute bottom-0 left-0 w-full h-0.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] animate-slide-right"></div>
                    )}
                  </button>
                ))}
              </div>
              
              {/* Premium Tab Content with card styling */}
              <div className="relative min-h-[300px]">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-white/5 to-white/0 -z-10 backdrop-blur-sm"></div>
                <div className="bg-gradient-to-br from-[hsl(var(--vanta-dark))]/90 to-[hsl(var(--vanta-dark))]/70 backdrop-blur-sm p-8 rounded-xl border border-white/5 shadow-lg premium-card">
                  <div className="animate-fade-in">
                    {tabContents[activeTab]}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Bottom decorative accent */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#7B38FB]/30 to-transparent"></div>
    </section>
  );
};

export default About;
