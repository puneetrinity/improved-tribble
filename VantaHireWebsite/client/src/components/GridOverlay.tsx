const GridOverlay = () => (
  <div className="hr-page-grid-overlay">
    <div className="hr-page-grid-overlay-inner">
      <div className="grid-col line-both">
        <span className="hr-grid-diamond" style={{ left: '-4px', top: '56px' }}></span>
        <span className="hr-grid-diamond" style={{ right: '-4px', top: '56px' }}></span>
      </div>
      <div className="grid-col"></div>
      <div className="grid-col"></div>
      <div className="grid-col line-both">
        <span className="hr-grid-diamond" style={{ left: '-4px', top: '56px' }}></span>
        <span className="hr-grid-diamond" style={{ right: '-4px', top: '56px' }}></span>
      </div>
    </div>
  </div>
);

export default GridOverlay;
