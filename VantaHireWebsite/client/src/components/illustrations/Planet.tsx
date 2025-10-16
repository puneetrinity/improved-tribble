interface PlanetProps {
  className?: string;
}

const Planet = ({ className = "" }: PlanetProps) => {
  return (
    <svg 
      className={className} 
      viewBox="0 0 200 200" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <g filter="url(#filter0_d)">
        <circle 
          cx="100" 
          cy="98" 
          r="40" 
          fill="url(#paint0_radial)"
        />
        <ellipse 
          cx="100" 
          cy="98" 
          rx="60" 
          ry="15" 
          fill="url(#paint1_radial)"
          fillOpacity="0.3"
        />
        <circle 
          cx="80" 
          cy="78" 
          r="5" 
          fill="#D1E6FF"
        />
        <circle 
          cx="115" 
          cy="88" 
          r="8" 
          fill="#D1E6FF"
          fillOpacity="0.7"
        />
        <circle 
          cx="90" 
          cy="108" 
          r="3" 
          fill="#D1E6FF"
          fillOpacity="0.5"
        />
      </g>
      <defs>
        <filter 
          id="filter0_d" 
          x="20" 
          y="22" 
          width="160" 
          height="160" 
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
        <radialGradient 
          id="paint0_radial" 
          cx="0" 
          cy="0" 
          r="1" 
          gradientUnits="userSpaceOnUse" 
          gradientTransform="translate(85 83) rotate(45) scale(56.5685)"
        >
          <stop stopColor="#7B38FB"/>
          <stop offset="1" stopColor="#2D81FF"/>
        </radialGradient>
        <radialGradient 
          id="paint1_radial" 
          cx="0" 
          cy="0" 
          r="1" 
          gradientUnits="userSpaceOnUse" 
          gradientTransform="translate(100 98) rotate(90) scale(15 60)"
        >
          <stop stopColor="#4192FF"/>
          <stop offset="1" stopColor="#2D81FF" stopOpacity="0"/>
        </radialGradient>
      </defs>
    </svg>
  );
};

export default Planet;
