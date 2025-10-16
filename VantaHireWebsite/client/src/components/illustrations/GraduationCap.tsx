interface GraduationCapProps {
  className?: string;
}

const GraduationCap = ({ className = "" }: GraduationCapProps) => {
  return (
    <svg 
      className={className} 
      viewBox="0 0 200 200" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <g filter="url(#filter0_d)">
        <path 
          d="M100 50L60 70L100 90L140 70L100 50Z" 
          fill="#FF5BA8"
        />
        <path 
          d="M80 77.5V105C80 105 90 115 100 115C110 115 120 105 120 105V77.5L100 87.5L80 77.5Z" 
          fill="#FF5BA8"
        />
        <path 
          d="M100 60L80 70L100 80L120 70L100 60Z" 
          fill="#FFB0D0"
        />
        <path 
          d="M100 90L80 80V100L100 110V90Z" 
          fill="#E0357D"
        />
        <path 
          d="M100 90L120 80V100L100 110V90Z" 
          fill="#CF206B"
        />
        <rect 
          x="65" 
          y="70" 
          width="5" 
          height="35" 
          fill="#FF5BA8"
        />
        <circle 
          cx="67.5" 
          cy="110" 
          r="7.5" 
          fill="#FF5BA8"
        />
      </g>
      <defs>
        <filter 
          id="filter0_d" 
          x="0" 
          y="0" 
          width="200" 
          height="200" 
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
            values="0 0 0 0 1 0 0 0 0 0.356863 0 0 0 0 0.658824 0 0 0 0.25 0"
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
      </defs>
    </svg>
  );
};

export default GraduationCap;
