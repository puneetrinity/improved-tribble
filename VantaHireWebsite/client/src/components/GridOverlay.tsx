const GridOverlay = () => (
  <div className="fixed inset-0 z-[1001] pointer-events-none hidden md:block">
    <div className="absolute inset-0 grid grid-cols-[28px_1fr_1fr_28px]">
      <div className="relative border-x border-[rgba(255,255,255,0.07)]">
        <span className="w-2 h-2 bg-[rgba(255,255,255,0.12)] [clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)] absolute z-[3] pointer-events-none" style={{ left: '-4px', top: '56px' }}></span>
        <span className="w-2 h-2 bg-[rgba(255,255,255,0.12)] [clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)] absolute z-[3] pointer-events-none" style={{ right: '-4px', top: '56px' }}></span>
      </div>
      <div className="relative"></div>
      <div className="relative"></div>
      <div className="relative border-x border-[rgba(255,255,255,0.07)]">
        <span className="w-2 h-2 bg-[rgba(255,255,255,0.12)] [clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)] absolute z-[3] pointer-events-none" style={{ left: '-4px', top: '56px' }}></span>
        <span className="w-2 h-2 bg-[rgba(255,255,255,0.12)] [clip-path:polygon(50%_0%,100%_50%,50%_100%,0%_50%)] absolute z-[3] pointer-events-none" style={{ right: '-4px', top: '56px' }}></span>
      </div>
    </div>
  </div>
);

export default GridOverlay;
