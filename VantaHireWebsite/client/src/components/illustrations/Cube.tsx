interface CubeProps {
  className?: string;
}

const Cube = ({ className = "" }: CubeProps) => {
  return (
    <svg 
      className={className} 
      viewBox="0 0 200 200" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <g filter="url(#filter0_d)">
        <path 
          d="M150 100L100 150L50 100L100 50L150 100Z" 
          fill="#2D81FF"
        />
        <path 
          d="M100 50V150L50 100L100 50Z" 
          fill="#1B5EBD"
        />
        <path 
          d="M150 100L100 150V50L150 100Z" 
          fill="#0F3D85"
        />
        <path 
          d="M115 85L130 100L115 115L100 100L115 85Z" 
          fill="#4B93FF"
        />
        <path 
          d="M85 85L100 100L85 115L70 100L85 85Z" 
          fill="#4B93FF"
        />
        <path 
          d="M100 70L115 85L100 100L85 85L100 70Z" 
          fill="#4B93FF"
        />
        <path 
          d="M100 100L115 115L100 130L85 115L100 100Z" 
          fill="#4B93FF"
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
      </defs>
    </svg>
  );
};

export default Cube;
