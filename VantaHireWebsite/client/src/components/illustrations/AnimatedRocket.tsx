import { useEffect, useRef, useState } from "react";

interface AnimatedRocketProps {
  className?: string;
}

const AnimatedRocket = ({ className = "" }: AnimatedRocketProps) => {
  const rocketRef = useRef<HTMLDivElement>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);

  // Handle mouse movement for 3D effect
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (rocketRef.current) {
        const rect = rocketRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        // Calculate relative position from center (-1 to 1)
        const relativeX = (e.clientX - centerX) / (rect.width / 2);
        const relativeY = (e.clientY - centerY) / (rect.height / 2);
        
        // Limit the tilt effect
        const limitedX = Math.max(-1, Math.min(1, relativeX * 0.5));
        const limitedY = Math.max(-1, Math.min(1, relativeY * 0.5));
        
        setMousePosition({ x: limitedX, y: limitedY });
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Calculate 3D transform style based on mouse position
  const calculateTransform = () => {
    if (!isHovering) return '';
    
    const rotateY = mousePosition.x * 10; // Rotate around Y axis based on X position
    const rotateX = -mousePosition.y * 10; // Rotate around X axis based on Y position (inverted)
    
    return `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  };

  // Create flame particles
  const renderFlameParticles = () => {
    const particles = [];
    const count = 6;
    
    for (let i = 0; i < count; i++) {
      const delay = i * 0.2;
      const duration = 1 + Math.random() * 0.5;
      const size = 3 + Math.random() * 4;
      const left = 45 + Math.random() * 10;
      
      particles.push(
        <div 
          key={`flame-particle-${i}`}
          className="absolute bg-orange-400 rounded-full z-0 opacity-0"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            bottom: "155px",
            left: `${left}%`,
            animation: `flame-particle ${duration}s infinite ${delay}s`,
            boxShadow: "0 0 10px 2px rgba(255, 157, 74, 0.6)"
          }}
        />
      );
    }
    
    return particles;
  };
  
  return (
    <div 
      ref={rocketRef}
      className={`${className} relative`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div 
        className="animate-float-path perspective-1000"
        style={{
          transform: calculateTransform(),
          transition: "transform 0.1s ease-out",
          transformStyle: "preserve-3d"
        }}
      >
        {/* Main rocket body */}
        <svg 
          width="200" 
          height="200" 
          viewBox="0 0 200 200" 
          fill="none" 
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full relative z-20"
          style={{ filter: "drop-shadow(0px 10px 15px rgba(0, 0, 0, 0.3))" }}
        >
          {/* Rocket main body - with 3D effect */}
          <g filter="url(#filter0_d)" style={{ transform: "translateZ(10px)" }}>
            {/* Left side (darker for 3D effect) */}
            <path 
              d="M95.5 40C95.5 40 71 62.5 71 102.5C71 142.5 95.5 165 95.5 165Z" 
              fill="#1A5BB9"
            />
            
            {/* Right side (brighter for 3D effect) */}
            <path 
              d="M95.5 40C95.5 40 120 62.5 120 102.5C120 142.5 95.5 165 95.5 165Z" 
              fill="#3D93FF"
            />
            
            {/* Rocket window - with 3D glass effect */}
            <ellipse 
              cx="95.5" 
              cy="102.5" 
              rx="12.5" 
              ry="17.5" 
              fill="url(#window_gradient)"
              style={{ filter: "drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.2))" }}
            />
            
            {/* Highlight on window for 3D effect */}
            <ellipse 
              cx="91.5" 
              cy="98" 
              rx="5" 
              ry="7" 
              fill="white"
              fillOpacity="0.3"
            />
          </g>
          
          {/* 3D fins */}
          <g style={{ transform: "translateZ(15px)" }}>
            {/* Left fin */}
            <path 
              d="M71 90C71 90 60 95 60 102.5C60 110 71 115 71 115"
              fill="#FF5BA8"
              strokeWidth="0"
            />
            <path 
              d="M71 90C71 90 60 95 60 102.5C60 110 71 115 71 115"
              stroke="#FF5BA8"
              strokeWidth="4"
              strokeLinecap="round"
              filter="url(#filter_shadow)"
            />
            
            {/* Right fin */}
            <path 
              d="M120 90C120 90 131 95 131 102.5C131 110 120 115 120 115"
              fill="#FF5BA8"
              strokeWidth="0"
            />
            <path 
              d="M120 90C120 90 131 95 131 102.5C131 110 120 115 120 115"
              stroke="#FF5BA8"
              strokeWidth="4"
              strokeLinecap="round"
              filter="url(#filter_shadow)"
            />
          </g>
          
          {/* Rocket nose with shine */}
          <path 
            d="M95.5 40C95.5 40 83 50 83 65C83 80 95.5 85 95.5 85C95.5 85 108 80 108 65C108 50 95.5 40 95.5 40Z" 
            fill="#3D93FF"
            style={{ transform: "translateZ(12px)" }}
          />
          
          <path 
            d="M90 45C90 45 88 55 95.5 55C103 55 101 45 101 45L90 45Z" 
            fill="white"
            fillOpacity="0.3"
            style={{ transform: "translateZ(14px)" }}
          />
          
          {/* 3D Flames with layered effect */}
          <g className="animate-rocket-flames" style={{ transform: "translateZ(5px)" }}>
            <path 
              d="M83 145C83 145 77 167.5 95.5 167.5C114 167.5 108 145 108 145H83Z" 
              fill="#FF5BA8"
              stroke="#FF5BA8"
              strokeWidth="1"
              filter="url(#flame_glow)"
            />
            <path 
              d="M77 155C77 155 72.5 175 95.5 175C118.5 175 114 155 114 155H77Z" 
              fill="#FF9D4A"
              stroke="#FF9D4A"
              strokeWidth="1"
              filter="url(#flame_glow_orange)"
            />
          </g>
          
          {/* Rocket trails/bubbles with 3D floating effect */}
          <g className="animate-rocket-trail">
            <circle cx="153.5" cy="122.5" r="7.5" fill="#FF5BA8" opacity="0.7" filter="url(#bubble_glow)" />
            <circle cx="143.5" cy="142.5" r="5.5" fill="#50E3C2" opacity="0.5" filter="url(#bubble_glow)" />
            <circle cx="163.5" cy="142.5" r="4.5" fill="#7B38FB" opacity="0.6" filter="url(#bubble_glow)" />
          </g>
          
          {/* Additional detail elements to enhance 3D */}
          <path 
            d="M87 132C87 132 89 135 95.5 135C102 135 104 132 104 132"
            stroke="#1A5BB9"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ transform: "translateZ(11px)" }}
          />
          
          {/* Definitions for gradients and filters */}
          <defs>
            <filter 
              id="filter0_d" 
              x="40" 
              y="20" 
              width="110" 
              height="165" 
              filterUnits="userSpaceOnUse" 
              colorInterpolationFilters="sRGB"
            >
              <feFlood floodOpacity="0" result="BackgroundImageFix"/>
              <feColorMatrix 
                in="SourceAlpha" 
                type="matrix" 
                values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
              />
              <feOffset dy="4"/>
              <feGaussianBlur stdDeviation="10"/>
              <feColorMatrix 
                type="matrix" 
                values="0 0 0 0 0.176471 0 0 0 0 0.505882 0 0 0 0 1 0 0 0 0.25 0"
              />
              <feBlend 
                mode="normal" 
                in2="BackgroundImageFix" 
                result="effect1_dropShadow"
              />
              <feBlend 
                mode="normal" 
                in="SourceGraphic" 
                in2="effect1_dropShadow" 
                result="shape"
              />
            </filter>
            
            <filter id="filter_shadow" x="-10" y="-10" width="220" height="220">
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000000" floodOpacity="0.3" />
            </filter>
            
            <filter id="flame_glow" x="-20" y="-20" width="240" height="240">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feFlood floodColor="#FF5BA8" floodOpacity="0.5" result="color" />
              <feComposite operator="in" in="color" in2="blur" result="glow" />
              <feComposite operator="over" in="SourceGraphic" in2="glow" />
            </filter>
            
            <filter id="flame_glow_orange" x="-20" y="-20" width="240" height="240">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feFlood floodColor="#FF9D4A" floodOpacity="0.5" result="color" />
              <feComposite operator="in" in="color" in2="blur" result="glow" />
              <feComposite operator="over" in="SourceGraphic" in2="glow" />
            </filter>
            
            <filter id="bubble_glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feFlood floodOpacity="0.5" result="color" />
              <feComposite operator="in" in="color" in2="blur" result="glow" />
              <feComposite operator="over" in="SourceGraphic" in2="glow" />
            </filter>
            
            <linearGradient 
              id="window_gradient" 
              x1="85" 
              y1="85" 
              x2="106" 
              y2="120" 
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#E0F7FF" />
              <stop offset="0.5" stopColor="#C7EEFF" />
              <stop offset="1" stopColor="#A8DFFF" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      
      {/* Dynamic flame particles */}
      {renderFlameParticles()}
      
      {/* Glowing effect behind rocket */}
      <div className="absolute inset-0 -z-10 bg-blue-500/30 blur-xl rounded-full animate-pulse-slow"></div>
      
      {/* Stronger glow effect under flames */}
      <div 
        className="absolute w-28 h-16 -z-10 bg-orange-500/30 blur-lg rounded-full animate-pulse-slow"
        style={{ 
          bottom: "-10px", 
          left: "50%", 
          transform: "translateX(-50%)",
          filter: "blur(12px)",
          animation: "pulse 1.5s ease-in-out infinite" 
        }}
      ></div>
    </div>
  );
};

export default AnimatedRocket;