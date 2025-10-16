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

  const tabs = [
    { name: "Our Story", icon: <Users className="h-5 w-5" /> },
    { name: "Our Approach", icon: <Trophy className="h-5 w-5" /> },
    { name: "Our Impact", icon: <Building className="h-5 w-5" /> }
  ];

  const tabContents = [
    <div key="story" className="space-y-4">
      <p className="text-lg leading-relaxed">
        We're more than recruiters—we're future-makers. At VantaHire, cutting-edge AI meets over 20 years 
        of recruiting mastery to transform how companies, candidates, and institutions connect, grow, and thrive.
      </p>
      <p className="text-lg leading-relaxed">
        Born in 2025 from the collective passion of seasoned TA professionals, our leadership has architected 
        hiring engines at Adobe, Ericsson, Cloudera, Cradlepoint—and powered rapid scale-ups for countless startups. 
        We know what it takes to build high-impact teams and careers that last.
      </p>
    </div>,
    <div key="approach" className="space-y-4">
      <p className="text-lg leading-relaxed">
        What Sets Us Apart:
      </p>
      <ul className="space-y-2 mt-4">
        {[
          "AI-First, Human-Focused: Smart automation supercharges our processes, but people remain at the heart of every decision.", 
          "DEI by Design: We champion inclusive sourcing strategies that expand your talent pool and drive innovation through diversity.", 
          "Upskilling & Coaching: From personalized training pathways to one-on-one career coaching, we empower recruiters and candidates to up their game.", 
          "Community-Powered Growth: Join a thriving network of TA professionals—exchange insights, sharpen skills, and grow together."
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
        With over 20 years of combined experience and 2,500+ successful placements, we've helped hundreds of
        companies scale their teams with exceptional talent. Our 96% client satisfaction rate reflects our
        commitment to delivering results that exceed expectations.
      </p>
      <p className="text-lg leading-relaxed">
        Our Promise: We don't just fill roles. We craft end-to-end talent ecosystems that fuel long-term
        success—today and into tomorrow's world of work. Let's build your future, together.
      </p>
    </div>
  ];

  return (
    <section 
      id="about" 
      ref={sectionRef}
      className="bg-gradient-to-b from-[#2D1B69] to-[#1E0B40] relative overflow-hidden py-24"
    >
      {/* Premium background decorations */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-purple-500/20 rounded-full blur-[50px] animate-pulse-slow"></div>
      <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/20 rounded-full blur-[50px] animate-pulse-slow" 
           style={{ animationDelay: '1.2s' }}></div>
      <div className="absolute top-1/2 left-1/4 w-72 h-72 bg-pink-500/10 rounded-full blur-[40px] animate-pulse-slow"
           style={{ animationDelay: '0.6s' }}></div>
           
      {/* Animated particles */}
      <div className="absolute w-3 h-3 bg-blue-300/40 rounded-full top-1/3 right-1/3 animate-float-path" 
          style={{animationDuration: '20s'}}></div>
      <div className="absolute w-2 h-2 bg-purple-300/40 rounded-full bottom-1/4 left-1/4 animate-float-path" 
          style={{animationDelay: '0.8s', animationDuration: '16s'}}></div>
      
      <div className="container mx-auto px-4 relative z-10">
        <div className={`text-center mb-12 ${isInView ? 'animate-fade-in' : 'opacity-0'}`} style={{ animationDelay: '0.2s' }}>
          <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mx-auto mb-6 animate-slide-right"
               style={{ animationDelay: '0.3s' }}></div>

          <h2 className="text-4xl md:text-5xl font-bold mb-6 animate-gradient-text inline-block">
            About Us
          </h2>

          <p className="text-lg text-white/80 max-w-2xl mx-auto animate-slide-up" style={{ animationDelay: '0.6s' }}>
            Discover the story, approach, and impact that makes VantaHire your ideal recruitment partner
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
