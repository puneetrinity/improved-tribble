import { trackEvent } from "@/lib/analytics";

const Hero = () => {
  const openCalendar = () => {
    trackEvent("cta_click", { location: "home_hero", action: "book_demo" });
    window.open('https://cal.com/vantahire/quick-connect', '_blank');
  };

  return (
    <>
      {/* Hero Grid */}
      <div className="hr-hero-grid">
        <div className="edge-left"></div>
        <div className="gutter-left"></div>
        <div className="content-left"></div>
        <div className="content-center">
          <div className="hr-hero-badge">
            <span className="hr-badge-corner tl"></span>
            <span className="hr-badge-corner tr"></span>
            <span className="hr-badge-corner bl"></span>
            <span className="hr-badge-corner br"></span>
            UNIFIED RECRUITMENT PLATFORM
          </div>

          <h1 className="hr-hero-h1">Make better hires, faster.</h1>

          <p className="hr-hero-subtitle">
            VantaHire is the ATS that understands who you're looking for. Level up your team with intelligent matching and seamless workflows.
          </p>

          <div className="hr-hero-actions">
            <a
              href="/recruiter-auth"
              className="hr-btn-demo"
              onClick={(e) => {
                e.preventDefault();
                trackEvent("cta_click", { location: "home_hero", action: "get_started" });
                window.location.href = '/recruiter-auth';
              }}
            >
              Get started
            </a>
            <button className="hr-btn-pricing" onClick={openCalendar}>
              Book a demo
            </button>
          </div>
        </div>
        <div className="content-right"></div>
        <div className="gutter-right"></div>
        <div className="edge-right"></div>
      </div>

      {/* Product Screenshot */}
      <div className="hr-struct-section hr-screenshot-section">
        <div className="struct-gutter"></div>
        <div className="struct-body hr-screenshot-band">
          <div className="hr-screenshot-wrapper">
            <div className="hr-browser-bar">
              <div className="hr-browser-dots"><span></span><span></span><span></span></div>
              <div className="hr-browser-url">app.vantahire.com / Analytics / Pipeline Intelligence</div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.6rem', color: 'var(--hr-text-muted)', padding: '3px 8px', border: '1px solid var(--hr-border)', borderRadius: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>↗ Share</span>
                <span style={{ fontSize: '0.6rem', color: 'var(--hr-text-muted)' }}>☆</span>
                <span style={{ fontSize: '0.6rem', color: 'var(--hr-text-muted)' }}>⚡</span>
                <span style={{ fontSize: '0.6rem', color: 'var(--hr-text-muted)' }}>⛶</span>
                <span style={{ fontSize: '0.6rem', color: 'var(--hr-text-muted)' }}>⋯</span>
              </div>
            </div>
            <div className="hr-app-layout">
              {/* Sidebar */}
              <div className="hr-app-sidebar">
                <div className="hr-app-sidebar-brand">
                  <span className="dot">V</span>
                  VantaHire
                </div>
                <div className="hr-sidebar-select">
                  FlowHire [INT] <span className="arrows">⇅</span>
                </div>
                <div className="hr-nav-item"><span className="icon">⌂</span> Home</div>
                <div className="hr-nav-item"><span className="icon">👤</span> Candidates</div>
                <div className="hr-nav-item"><span className="icon">🔍</span> Sourcing</div>
                <div className="hr-nav-item"><span className="icon">📨</span> Outreach</div>
                <div className="hr-nav-item"><span className="icon">🎤</span> Interviews</div>
                <div className="hr-nav-item"><span className="icon">📊</span> Reports</div>
                <div className="hr-nav-item active"><span className="icon">📈</span> Analytics</div>
                <div className="hr-nav-sub">
                  <div className="hr-nav-sub-item active">Pipeline Intelligence</div>
                  <div className="hr-nav-sub-item">Team Performance</div>
                </div>
                <div className="hr-sidebar-divider"></div>
                <div className="hr-nav-item"><span className="icon">⚙</span> Settings</div>
                <div className="hr-nav-item"><span className="icon">🔗</span> Integrations</div>
                <div className="hr-nav-item"><span className="icon">🔒</span> Permissions</div>
                <div className="hr-nav-item"><span className="icon">⚡</span> Automations</div>
              </div>

              {/* Main */}
              <div className="hr-app-main">
                <div className="hr-app-header">
                  <div className="hr-app-breadcrumb">Analytics / <span>Pipeline Intelligence</span></div>
                </div>

                <div className="hr-date-bar">
                  <div className="hr-date-range">📅 Mar 1, 2026 - Mar 21, 2026 ⇅</div>
                  <div className="hr-time-tabs">
                    <div className="hr-time-tab">Today</div>
                    <div className="hr-time-tab">Yesterday</div>
                    <div className="hr-time-tab active">7D</div>
                    <div className="hr-time-tab">1M</div>
                    <div className="hr-time-tab">3M</div>
                    <div className="hr-time-tab">6M</div>
                  </div>
                  <div className="hr-filter-btns">
                    <div className="hr-filter-btn"># Metric ▾</div>
                    <div className="hr-filter-btn">Exclude ▾</div>
                    <div className="hr-filter-btn">Compare ▾</div>
                  </div>
                </div>

                <div className="hr-stats-row">
                  <div className="hr-stat-card">
                    <div className="hr-stat-label"><span className="hr-stat-dot" style={{ background: 'var(--hr-accent)' }}></span> Candidates Added</div>
                    <div className="hr-stat-value">124</div>
                  </div>
                  <div className="hr-stat-card">
                    <div className="hr-stat-label"><span className="hr-stat-dot" style={{ background: 'var(--hr-green)' }}></span> Outreach open rate</div>
                    <div className="hr-stat-value">62%</div>
                  </div>
                  <div className="hr-stat-card">
                    <div className="hr-stat-label"><span className="hr-stat-dot" style={{ background: 'var(--hr-red)' }}></span> Time to 1st Response</div>
                    <div className="hr-stat-value">1.8 days</div>
                  </div>
                  <div className="hr-stat-card">
                    <div className="hr-stat-label"><span className="hr-stat-dot" style={{ background: 'var(--hr-cyan)' }}></span> Offers Accepted</div>
                    <div className="hr-stat-value">39</div>
                  </div>
                </div>

                <div className="hr-pipeline-header">
                  <span className="hr-pipeline-title">Pipeline Overview</span>
                  <div className="hr-pipeline-actions">
                    <span>✨ AI Insights</span>
                    <span>Export ↗</span>
                  </div>
                </div>

                <div className="hr-pipeline-stages">
                  <div className="hr-stage">
                    <div className="hr-stage-label">Sourced</div>
                    <div className="hr-stage-count">320 <span className="hr-stat-change hr-up">+67%</span></div>
                  </div>
                  <div className="hr-stage">
                    <div className="hr-stage-label">Contacted</div>
                    <div className="hr-stage-count">210</div>
                  </div>
                  <div className="hr-stage">
                    <div className="hr-stage-label">Interviewed</div>
                    <div className="hr-stage-count">44</div>
                  </div>
                  <div className="hr-stage">
                    <div className="hr-stage-label">Offer</div>
                    <div className="hr-stage-count">14 <span className="hr-stat-change hr-up">+31%</span></div>
                  </div>
                  <div className="hr-stage">
                    <div className="hr-stage-label">Hired</div>
                    <div className="hr-stage-count">9 <span className="hr-stat-change hr-up">+12%</span></div>
                  </div>
                </div>

                <div className="hr-bar-chart">
                  <div className="hr-bar-col"><div className="hr-bar" style={{ height: '85%', background: 'rgba(59,91,219,0.5)' }}><span className="hr-bar-pct">66%</span></div></div>
                  <div className="hr-bar-col"><div className="hr-bar" style={{ height: '40%', background: 'rgba(59,91,219,0.4)' }}><span className="hr-bar-pct">11%</span></div></div>
                  <div className="hr-bar-col"><div className="hr-bar" style={{ height: '38%', background: 'rgba(59,91,219,0.4)' }}><span className="hr-bar-pct">10%</span></div></div>
                  <div className="hr-bar-col"><div className="hr-bar" style={{ height: '52%', background: 'rgba(59,91,219,0.45)' }}><span className="hr-bar-pct">32%</span></div></div>
                  <div className="hr-bar-col"><div className="hr-bar" style={{ height: '75%', background: 'rgba(59,91,219,0.55)' }}><span className="hr-bar-pct">64%</span></div></div>
                </div>

                <div className="hr-table-header-row">
                  <span className="hr-table-title">Pipeline Impact</span>
                  <div className="hr-table-actions">
                    <span>🔍 Search</span>
                    <span>⚡ Filters ▾</span>
                    <span>Export ↗</span>
                  </div>
                </div>

                <div className="hr-data-table">
                  <div className="hr-data-table-head">
                    <span>Recruiter</span>
                    <span>Candidates</span>
                    <span>Conversion Rate</span>
                    <span>Avg Stage Time</span>
                    <span>Hires</span>
                  </div>
                  <div className="hr-data-table-row">
                    <span className="hr-recruiter-name"><span className="hr-recruiter-avatar" style={{ background: 'rgba(124,58,237,0.2)', color: 'var(--hr-accent-hover)' }}>SL</span> Sarah Lee</span>
                    <span>84</span>
                    <span>18%</span>
                    <span>2.1 days</span>
                    <span>6</span>
                  </div>
                  <div className="hr-data-table-row">
                    <span className="hr-recruiter-name"><span className="hr-recruiter-avatar" style={{ background: 'rgba(16,185,129,0.2)', color: 'var(--hr-green)' }}>JS</span> James Smith</span>
                    <span>92</span>
                    <span>22%</span>
                    <span>1.5 days</span>
                    <span>5</span>
                  </div>
                  <div className="hr-data-table-row">
                    <span className="hr-recruiter-name"><span className="hr-recruiter-avatar" style={{ background: 'rgba(245,158,11,0.2)', color: 'var(--hr-yellow)' }}>EJ</span> Emily Johnson</span>
                    <span>78</span>
                    <span>15%</span>
                    <span>3.2 days</span>
                    <span>8</span>
                  </div>
                </div>
              </div>

              {/* Metrics Panel */}
              <div className="hr-app-metrics">
                <div className="hr-metrics-tabs">
                  <div className="hr-metrics-tab active">Query</div>
                  <div className="hr-metrics-tab">Chart</div>
                  <div className="hr-metrics-tab">Annotations</div>
                </div>

                <div className="hr-metrics-heading">
                  Metrics <span className="plus">+</span>
                </div>

                <div className="hr-metric-group">
                  <div className="hr-metric-group-label"><span className="num">1</span> Pipeline conversion</div>
                  <div className="hr-metric-item">
                    <span className="hr-metric-letter" style={{ background: 'rgba(124,58,237,0.2)', color: 'var(--hr-accent-hover)' }}>A</span>
                    Candidate Added
                    <span className="hr-metric-arrow">›</span>
                  </div>
                  <div className="hr-metric-item">
                    <span className="hr-metric-letter" style={{ background: 'rgba(16,185,129,0.2)', color: 'var(--hr-green)' }}>B</span>
                    Outreach Sent
                    <span className="hr-metric-arrow">›</span>
                  </div>
                  <div className="hr-metric-item">
                    <span className="hr-metric-letter" style={{ background: 'rgba(245,158,11,0.2)', color: 'var(--hr-yellow)' }}>C</span>
                    Reply Received
                    <span className="hr-metric-arrow">›</span>
                  </div>
                  <div className="hr-metric-item">
                    <span className="hr-metric-letter" style={{ background: 'rgba(6,182,212,0.2)', color: 'var(--hr-cyan)' }}>D</span>
                    Interview Completed
                    <span className="hr-metric-arrow">›</span>
                  </div>
                  <div className="hr-metric-item">
                    <span className="hr-metric-letter" style={{ background: 'rgba(139,92,246,0.2)', color: 'var(--hr-purple)' }}>E</span>
                    Offer Accepted
                    <span className="hr-metric-arrow">›</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px', padding: '0 6px' }}>
                    <span style={{ fontSize: '0.52rem', color: 'var(--hr-text-muted)', padding: '2px 6px', border: '1px solid var(--hr-border)', borderRadius: '3px' }}># User ▾</span>
                    <span style={{ fontSize: '0.52rem', color: 'var(--hr-text-muted)', padding: '2px 6px', border: '1px solid var(--hr-border)', borderRadius: '3px' }}>Uniques ▾</span>
                  </div>
                </div>

                <div className="hr-metric-group">
                  <div className="hr-metric-group-label"><span className="num">2</span> Outreach engagement</div>
                  <div className="hr-metric-sub-label" style={{ padding: '0 6px' }}>Event: <span style={{ color: 'var(--hr-text-secondary)' }}>Event Count</span></div>
                  <div className="hr-metric-item">
                    <span className="hr-metric-letter" style={{ background: 'rgba(124,58,237,0.2)', color: 'var(--hr-accent-hover)' }}>📧</span>
                    Email Opened
                    <span className="hr-metric-arrow">›</span>
                  </div>
                  <div style={{ padding: '6px', fontSize: '0.52rem', color: 'var(--hr-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    ⊕ Add Event
                  </div>
                  <div style={{ display: 'flex', gap: '8px', padding: '0 6px' }}>
                    <span style={{ fontSize: '0.52rem', color: 'var(--hr-text-muted)', padding: '2px 6px', border: '1px solid var(--hr-border)', borderRadius: '3px' }}>Breakdown ▾</span>
                    <span style={{ fontSize: '0.52rem', color: 'var(--hr-text-muted)', padding: '2px 6px', border: '1px solid var(--hr-border)', borderRadius: '3px' }}>Recruiter ▾</span>
                  </div>
                </div>

                <div className="hr-metric-group">
                  <div className="hr-metric-group-label"><span className="num">3</span> Hiring Speed</div>
                  <div style={{ padding: '0 6px' }}>
                    <div className="hr-metric-sub-label">Time Between Events</div>
                    <div style={{ fontSize: '0.52rem', color: 'var(--hr-text-secondary)', padding: '4px 8px', border: '1px solid var(--hr-border)', borderRadius: '3px', marginTop: '4px' }}>From: Outreach Sent</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="struct-gutter"></div>
      </div>

      {/* Grid separator */}
      <div style={{ width: '100%', height: 0, borderTop: '1px solid var(--hr-grid-line)' }}></div>
    </>
  );
};

export default Hero;
