interface StarProps {
  className?: string;
}

const Star = ({ className = "" }: StarProps) => {
  return (
    <svg 
      className={className} 
      viewBox="0 0 120 120" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <g filter="url(#filter0_d)">
        <path 
          d="M60 20L67.5 45.5H95L72.5 60L80 85L60 70L40 85L47.5 60L25 45.5H52.5L60 20Z" 
          fill="#FFD875"
        />
        <circle 
          cx="60" 
          cy="52.5" 
          r="7.5" 
          fill="#FFECB3"
        />
        <circle 
          cx="73" 
          cy="69" 
          r="3" 
          fill="#FFECB3"
        />
        <circle 
          cx="47" 
          cy="69" 
          r="3" 
          fill="#FFECB3"
        />
      </g>
      <defs>
        <filter 
          id="filter0_d" 
          x="0" 
          y="0" 
          width="120" 
          height="120" 
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
            values="0 0 0 0 1 0 0 0 0 0.717647 0 0 0 0 0.258824 0 0 0 0.25 0"
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

export default Star;
