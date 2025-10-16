interface RocketProps {
  className?: string;
  color?: string;
  animated?: boolean;
}

const Rocket = ({ className = "", color = "#2D81FF", animated = true }: RocketProps) => {
  return (
    <svg 
      className={`${className} ${animated ? 'animate-rocket' : ''}`} 
      viewBox="0 0 200 200" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      <g filter="url(#filter0_d)">
        <path 
          d="M95.5 40C95.5 40 71 62.5 71 102.5C71 142.5 95.5 165 95.5 165C95.5 165 120 142.5 120 102.5C120 62.5 95.5 40 95.5 40Z" 
          fill={color}
        />
        <path 
          d="M95.5 165V40C95.5 40 120 62.5 120 102.5C120 142.5 95.5 165 95.5 165Z" 
          fill="url(#paint0_linear)"
        />
        <ellipse 
          cx="95.5" 
          cy="102.5" 
          rx="12.5" 
          ry="17.5" 
          fill="white"
        />
        <path 
          d="M83 145C83 145 77 167.5 95.5 167.5C114 167.5 108 145 108 145H83Z" 
          fill="#FF5BA8"
        />
        <path 
          d="M77 155C77 155 72.5 175 95.5 175C118.5 175 114 155 114 155H77Z" 
          fill="#FF9D4A"
        />
        <circle 
          cx="153.5" 
          cy="112.5" 
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
        <linearGradient 
          id="paint0_linear" 
          x1="107.75" 
          y1="40" 
          x2="107.75" 
          y2="165" 
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#4192FF"/>
          <stop offset="1" stopColor="#0066E8"/>
        </linearGradient>
      </defs>
    </svg>
  );
};

export default Rocket;
