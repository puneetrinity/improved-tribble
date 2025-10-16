import { useState, useRef } from "react";
import { ArrowLeft, ArrowRight, Star } from "lucide-react";

interface TestimonialCardProps {
  quote: string;
  name: string;
  role: string;
  company: string;
  rating: number;
  dotColor: string;
  active: boolean;
}

const TestimonialCard = ({ 
  quote, 
  name,
  role, 
  company,
  rating,
  dotColor,
  active
}: TestimonialCardProps) => {
  // Extract color hex without the 'bg-' prefix for styling
  const colorHex = dotColor === 'bg-[#FF5BA8]' ? '#FF5BA8' : 
                 dotColor === 'bg-[#2D81FF]' ? '#2D81FF' : 
                 dotColor === 'bg-[#FF9D4A]' ? '#FF9D4A' : '#7B38FB';
  
  return (
    <div 
      className={`relative premium-card backdrop-blur-lg rounded-xl p-10 transition-all duration-500 group
        ${active 
          ? 'opacity-100 bg-gradient-to-br from-[hsl(var(--vanta-dark))]/90 to-[hsl(var(--vanta-dark))]/70 scale-100 z-10 border border-white/10 shadow-xl' 
          : 'opacity-40 bg-gradient-to-br from-[hsl(var(--vanta-dark))]/70 to-[hsl(var(--vanta-dark))]/50 scale-95 lg:scale-90 border border-white/5'
        }
      `}
      style={{ 
        boxShadow: active ? `0 10px 40px -10px rgba(${colorHex.replace('#', '').match(/../g)?.map(x => parseInt(x, 16)).join(', ') || '0,0,0'}, 0.15)` : 'none'
      }}
    >
      {/* Top gradient line accent */}
      <div 
        className={`absolute top-0 left-10 right-10 h-1 opacity-60 ${active ? 'opacity-100' : ''}`}
        style={{ 
          background: `linear-gradient(to right, transparent, ${colorHex}, transparent)`,
          transition: 'all 0.5s ease'
        }}
      ></div>
      
      <div className="relative z-10">
        {/* Enhanced star rating with animated hover effect */}
        <div className="flex mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="relative mr-2 transition-all duration-300 group-hover:scale-105" style={{ animationDelay: `${i * 0.1}s` }}>
              <Star 
                key={i} 
                className={`w-5 h-5 ${i < rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-400'}`} 
              />
              {i < rating && active && (
                <div className="absolute inset-0 blur-sm -z-10 opacity-70 animate-pulse-slow" style={{ backgroundColor: 'rgba(250, 204, 21, 0.4)' }}></div>
              )}
            </div>
          ))}
        </div>
        
        {/* Premium quotation marks */}
        <div className="relative">
          <p className="text-lg mb-8 leading-relaxed text-white/90 z-10 relative">{quote}</p>
          
          {/* Left quote mark with gradient */}
          <div className="absolute -top-6 -left-2 h-10 w-10 opacity-80">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path 
                d="M10.5,17.5h4c0.37,0,0.59,0.41,0.4,0.73L11,26c-0.2,0.29-0.55,0.39-0.85,0.39c-0.98,0-1.77-0.8-1.77-1.77v-4.84 C8.38,18.2,9.32,17.5,10.5,17.5z M18.5,17.5h4c0.37,0,0.59,0.41,0.4,0.73L19,26c-0.2,0.29-0.55,0.39-0.85,0.39 c-0.98,0-1.77-0.8-1.77-1.77v-4.84C16.38,18.2,17.32,17.5,18.5,17.5z"
                fill={`url(#grad-${colorHex.replace('#', '')})`}
                opacity="0.7"
              />
              <defs>
                <linearGradient id={`grad-${colorHex.replace('#', '')}`} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="white" />
                  <stop offset="100%" stopColor={colorHex} />
                </linearGradient>
              </defs>
            </svg>
          </div>
          
          {/* Right quote mark with gradient (flipped) */}
          <div className="absolute -bottom-2 right-0 h-10 w-10 opacity-80 transform rotate-180">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path 
                d="M10.5,17.5h4c0.37,0,0.59,0.41,0.4,0.73L11,26c-0.2,0.29-0.55,0.39-0.85,0.39c-0.98,0-1.77-0.8-1.77-1.77v-4.84 C8.38,18.2,9.32,17.5,10.5,17.5z M18.5,17.5h4c0.37,0,0.59,0.41,0.4,0.73L19,26c-0.2,0.29-0.55,0.39-0.85,0.39 c-0.98,0-1.77-0.8-1.77-1.77v-4.84C16.38,18.2,17.32,17.5,18.5,17.5z"
                fill={`url(#grad2-${colorHex.replace('#', '')})`}
                opacity="0.7"
              />
              <defs>
                <linearGradient id={`grad2-${colorHex.replace('#', '')}`} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="white" />
                  <stop offset="100%" stopColor={colorHex} />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
        
        {/* Enhanced author info with premium styling */}
        <div className="flex items-center">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-3`} 
               style={{ 
                 background: `linear-gradient(135deg, ${colorHex}, ${colorHex}80)`,
                 boxShadow: active ? `0 0 15px ${colorHex}40` : 'none'
               }}>
            <span className="text-white font-bold">{name.charAt(0)}</span>
          </div>
          <div>
            <p className="font-bold text-white">{name}</p>
            <div className="flex items-center mt-1">
              <div className={`h-2 w-2 rounded-full mr-2`} style={{ backgroundColor: colorHex }}></div>
              <p className="text-sm text-white/80">{role} at {company}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Subtle gradient background effect */}
      <div 
        className={`absolute inset-0 rounded-xl -z-10 opacity-30 ${active ? 'opacity-40' : ''}`}
        style={{ 
          background: `radial-gradient(circle at bottom right, ${colorHex}30, transparent 70%)`,
        }}
      />
      
      {/* Decorative corner accent */}
      <div 
        className={`absolute bottom-2 right-2 w-6 h-6 transition-all duration-500 opacity-0 ${active ? 'opacity-100' : ''}`}
      >
        <div className="absolute bottom-0 right-0 w-full h-[1px]" 
             style={{ background: `linear-gradient(to left, ${colorHex}, transparent)` }}></div>
        <div className="absolute bottom-0 right-0 h-full w-[1px]" 
             style={{ background: `linear-gradient(to top, ${colorHex}, transparent)` }}></div>
      </div>
    </div>
  );
};

const Testimonials = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const testimonials = [
    {
      quote: "VantaHire helped us close 10 niche engineering roles in record time! Their industry expertise and vast network gave us access to pre-qualified candidates that perfectly matched our technical requirements and company culture.",
      name: "Sarah Chen",
      role: "Senior Product Manager",
      company: "TechStream",
      rating: 5,
      dotColor: "bg-[#FF5BA8]"
    },
    {
      quote: "Their resume coaching was a game changer for my career! I went from barely getting callbacks to having multiple interviews lined up. Within 6 weeks, I received 3 competitive offers at top tech firms.",
      name: "Michael Rodriguez",
      role: "Senior Software Developer",
      company: "CloudScale",
      rating: 5,
      dotColor: "bg-[#2D81FF]"
    },
    {
      quote: "The campus recruitment program VantaHire organized connected our computer science students with cutting-edge startups. Thanks to this partnership, our placement rate increased by 30% this year!",
      name: "Dr. Emily Patel",
      role: "Department Chair",
      company: "Tech Institute",
      rating: 5,
      dotColor: "bg-[#FF9D4A]"
    }
  ];
  
  const nextTestimonial = () => {
    setActiveIndex((prev) => (prev + 1) % testimonials.length);
  };
  
  const prevTestimonial = () => {
    setActiveIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
  };

  return (
    <section className="bg-gradient-to-b from-[#1E0B40] to-[#2D1B69] relative overflow-hidden py-24">
      {/* Premium background decorations */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHZpZXdCb3g9IjAgMCAyMCAyMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxIiBjeT0iMSIgcj0iMSIgZmlsbD0id2hpdGUiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-10"></div>
      
      {/* Premium background glow effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#7B38FB]/10 rounded-full blur-[50px] animate-pulse-slow"></div>
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#FF5BA8]/10 rounded-full blur-[50px] animate-pulse-slow" style={{ animationDelay: '1.2s' }}></div>
      <div className="absolute top-1/2 left-1/3 w-72 h-72 bg-[#2D81FF]/10 rounded-full blur-[40px] animate-pulse-slow" style={{ animationDelay: '0.6s' }}></div>
      
      {/* Animated floating particles */}
      <div className="absolute w-2 h-2 bg-purple-300/40 rounded-full top-1/4 right-1/3 animate-float-path" 
           style={{animationDelay: "0.3s", animationDuration: "15s"}}></div>
      <div className="absolute w-3 h-3 bg-blue-300/40 rounded-full bottom-1/3 left-1/4 animate-float-path" 
           style={{animationDelay: "1.2s", animationDuration: "18s"}}></div>
      <div className="absolute w-2 h-2 bg-pink-300/40 rounded-full top-1/2 right-1/4 animate-float-path" 
           style={{animationDelay: "0.8s", animationDuration: "20s"}}></div>
      
      <div className="container mx-auto px-4 py-10 relative z-10">
        <div className="text-center mb-20 animate-fade-in">
          <div className="w-20 h-1.5 bg-gradient-to-r from-[#7B38FB] to-[#FF5BA8] rounded-full mx-auto mb-6 animate-slide-right" 
               style={{ animationDelay: '0.3s' }}></div>
               
          <h2 className="text-4xl md:text-5xl font-bold mb-6 animate-gradient-text inline-block">
            What Our Clients Say
          </h2>
          
          <p className="text-lg text-white/80 max-w-2xl mx-auto leading-relaxed animate-slide-up" 
             style={{ animationDelay: '0.5s' }}>
            Don't just take our word for it - hear from the businesses and individuals 
            who've transformed their hiring process with VantaHire.
          </p>
        </div>
        
        <div ref={containerRef} className="max-w-4xl mx-auto relative">
          {/* Desktop and tablet view - side by side */}
          <div className="hidden md:grid grid-cols-1 gap-8 relative animate-fade-in" style={{ animationDelay: '0.7s' }}>
            {testimonials.map((testimonial, index) => (
              <div 
                key={index}
                className={`transition-all duration-700 ${
                  Math.abs(index - activeIndex) <= 1 ? 'block' : 'hidden'
                }`}
                style={{
                  transform: `translateX(${(index - activeIndex) * 5}%)`,
                  zIndex: index === activeIndex ? 10 : 5
                }}
              >
                <TestimonialCard 
                  {...testimonial} 
                  active={index === activeIndex}
                />
              </div>
            ))}
          </div>
          
          {/* Mobile view - stacked */}
          <div className="md:hidden animate-fade-in" style={{ animationDelay: '0.7s' }}>
            <TestimonialCard 
              {...testimonials[activeIndex]} 
              active={true}
            />
          </div>
          
          {/* Premium navigation controls */}
          <div className="flex justify-center mt-12 gap-6 animate-fade-in" style={{ animationDelay: '1s' }}>
            <button 
              onClick={prevTestimonial}
              className="premium-card bg-gradient-to-br from-black/30 to-black/10 backdrop-blur-lg p-3 rounded-full 
                        transition-all duration-300 border border-white/5 hover:border-white/20 hover:scale-110 
                        group shadow-lg hover:shadow-[#7B38FB]/20"
              aria-label="Previous testimonial"
            >
              <ArrowLeft className="w-5 h-5 text-white/70 group-hover:text-white transition-colors duration-300" />
            </button>
            
            <div className="flex items-center space-x-3 px-4">
              {testimonials.map((testimonial, index) => {
                const colorHex = testimonial.dotColor === 'bg-[#FF5BA8]' ? '#FF5BA8' : 
                               testimonial.dotColor === 'bg-[#2D81FF]' ? '#2D81FF' : 
                               testimonial.dotColor === 'bg-[#FF9D4A]' ? '#FF9D4A' : '#7B38FB';
                return (
                  <button
                    key={index}
                    onClick={() => setActiveIndex(index)}
                    className={`rounded-full transition-all duration-500 relative overflow-hidden 
                               ${index === activeIndex ? 'w-12 h-3' : 'w-3 h-3'}`}
                    style={{ 
                      backgroundColor: index === activeIndex ? colorHex : 'rgba(255,255,255,0.2)',
                      boxShadow: index === activeIndex ? `0 0 10px ${colorHex}60` : 'none'
                    }}
                    aria-label={`Go to testimonial ${index + 1}`}
                  >
                    {index === activeIndex && (
                      <span 
                        className="absolute inset-0 animate-shine" 
                        style={{
                          background: `linear-gradient(90deg, ${colorHex}00, ${colorHex}60, ${colorHex}00)`,
                          backgroundSize: '200% 100%'
                        }}
                      ></span>
                    )}
                  </button>
                );
              })}
            </div>
            
            <button 
              onClick={nextTestimonial}
              className="premium-card bg-gradient-to-br from-black/30 to-black/10 backdrop-blur-lg p-3 rounded-full 
                        transition-all duration-300 border border-white/5 hover:border-white/20 hover:scale-110 
                        group shadow-lg hover:shadow-[#7B38FB]/20"
              aria-label="Next testimonial"
            >
              <ArrowRight className="w-5 h-5 text-white/70 group-hover:text-white transition-colors duration-300" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Bottom decorative accent */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-[#7B38FB]/30 to-transparent"></div>
    </section>
  );
};

export default Testimonials;
