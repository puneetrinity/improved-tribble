import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import rocketGif from "../assets/3d-rocket.gif";

const Hero = () => {
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    // Add a slight delay for the fade-in effect
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 300);
    
    return () => clearTimeout(timer);
  }, []);
  
  // Function to open Calendly in a new window/tab
  const openCalendly = () => {
    window.open('https://calendly.com/vantahire/30min', '_blank');
  };
  
  const scrollToContact = () => {
    const contactSection = document.getElementById("contact");
    if (contactSection) {
      contactSection.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <section id="hero" className="container mx-auto px-4 pt-24 pb-16 md:pt-32 md:pb-24 overflow-hidden">
      <div className={`flex flex-col md:flex-row items-center transition-opacity duration-1000 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        <div className="md:w-1/2 mb-10 md:mb-0 relative">
          {/* Background decoration */}
          <div className="absolute -z-10 w-64 h-64 rounded-full bg-purple-500/10 blur-3xl -left-10 -top-10 animate-pulse-slow"></div>
          <div className="absolute -z-10 w-48 h-48 rounded-full bg-blue-500/10 blur-3xl left-40 top-40 animate-pulse-slow" 
              style={{animationDelay: '1.2s'}}></div>
          
          {/* Premium line accent */}
          <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mb-6 animate-slide-right"
               style={{animationDelay: '0.3s'}}></div>
          
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 relative">
            <div className="animate-fade-in" style={{animationDelay: '0.5s'}}>
              <span className="animate-gradient-text font-extrabold">Your Trusted</span>
            </div>
            <div className="animate-fade-in" style={{animationDelay: '0.8s'}}>
              <span className="text-white leading-tight mt-2 block">AI-Powered Recruitment Partner</span>
            </div>
          </h1>
          
          <p className="text-lg mb-8 max-w-lg text-white/80 leading-relaxed animate-slide-up"
             style={{animationDelay: '1s'}}>
            Helping startups and enterprises scale with top talent. Our specialized recruitment solutions deliver exceptional candidates for your growing needs.
          </p>
          
          <div className="animate-slide-up" style={{animationDelay: '1.2s'}}>
            <Button 
              variant="gradient" 
              size="xl" 
              className="rounded-full premium-card hover:scale-105 transform transition-all duration-300 group"
              onClick={openCalendly}
            >
              <span className="group-hover:animate-pulse-glow inline-block">Schedule a Free Consultation</span>
            </Button>
          </div>
          
          {/* Extra premium decorative element */}
          <div className="absolute -bottom-4 left-10 w-24 h-1 bg-gradient-to-r from-[#7B38FB]/0 via-[#7B38FB] to-[#7B38FB]/0 rounded-full animate-shine"></div>
        </div>
        
        <div className="md:w-1/2 flex justify-center relative">
          {/* Background glows */}
          <div className="absolute w-72 h-72 bg-blue-500/10 rounded-full blur-3xl animate-pulse-slow"></div>
          <div className="absolute w-48 h-48 bg-pink-500/10 rounded-full blur-3xl translate-x-20 -translate-y-10 animate-pulse-slow" 
               style={{animationDelay: '1s'}}></div>
          <div className="absolute w-36 h-36 bg-purple-500/10 rounded-full blur-xl translate-x-40 -translate-y-20 animate-pulse-slow"
               style={{animationDelay: '1.5s'}}></div>
          
          {/* Stars/particles around rocket */}
          <div className="absolute w-3 h-3 bg-white rounded-full top-10 left-1/4 animate-pulse-slow"></div>
          <div className="absolute w-2 h-2 bg-white rounded-full bottom-10 right-1/3 animate-pulse-slow" 
              style={{animationDelay: '0.5s'}}></div>
          <div className="absolute w-4 h-4 bg-yellow-200 rounded-full top-3/4 right-1/4 animate-pulse-slow"
              style={{animationDelay: '1s'}}></div>
              
          {/* Animated floating particles */}
          <div className="absolute w-2 h-2 bg-pink-300/60 rounded-full top-1/3 left-1/3 animate-float-path" 
              style={{animationDelay: '0.8s', animationDuration: '15s'}}></div>
          <div className="absolute w-3 h-3 bg-blue-300/60 rounded-full bottom-1/3 right-1/4 animate-float-path" 
              style={{animationDelay: '1.5s', animationDuration: '18s'}}></div>
          
          {/* 3D Rocket GIF with enhanced animation */}
          <div className="relative z-10 w-96 h-96 flex items-center justify-center animate-float-path animate-fade-in"
               style={{animationDelay: '0.4s'}}>
            <div className="absolute inset-0 bg-gradient-to-r from-[#2D81FF]/0 via-[#2D81FF]/20 to-[#2D81FF]/0 rounded-full blur-3xl animate-pulse-slow"></div>
            <img 
              src={rocketGif} 
              alt="3D Rocket" 
              className="w-80 h-80 object-contain drop-shadow-2xl"
            />
          </div>
          
          {/* Additional glow elements */}
          <div className="absolute h-20 w-20 rounded-full bg-orange-400/20 blur-xl bottom-10 -right-5 animate-pulse-slow"></div>
          <div className="absolute h-16 w-16 rounded-full bg-purple-400/20 blur-xl top-24 left-10 animate-pulse-slow"
               style={{animationDelay: '1.2s'}}></div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
