const FeaturesGrid = () => {
  return (
    <div className="hr-struct-section">
      <div className="struct-gutter"></div>
      <div className="struct-body hr-features-section">
        <div className="hr-features-header">
          <div className="hr-section-label">Core Features</div>
          <h2 className="hr-section-title">Everything You Need to<br />Recruit at Scale</h2>
          <p className="hr-section-desc">Six powerful modules that cover every aspect of the recruitment lifecycle, from sourcing to placement.</p>
        </div>

        <div className="hr-features-struct-grid">
          {/* Resume Intelligence */}
          <div className="hr-feat-cell">
            <div className="hr-feat-screenshot">
              <div className="hr-feat-screenshot-inner">
                <div style={{ fontSize: '0.58rem', fontWeight: 600, color: 'var(--hr-text-secondary)', marginBottom: '6px' }}>Resume Analysis</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1, background: '#1a1a20', border: '1px solid var(--hr-border)', borderRadius: '5px', padding: '8px' }}>
                    <div style={{ fontSize: '0.45rem', color: 'var(--hr-text-muted)', marginBottom: '5px', textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>Extracted Skills</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '3px' }}>
                      <span className="hr-mini-tag" style={{ background: 'rgba(124,58,237,0.12)', color: 'var(--hr-accent-hover)' }}>React</span>
                      <span className="hr-mini-tag" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--hr-green)' }}>Node.js</span>
                      <span className="hr-mini-tag" style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--hr-purple)' }}>Python</span>
                      <span className="hr-mini-tag" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--hr-yellow)' }}>AWS</span>
                      <span className="hr-mini-tag" style={{ background: 'rgba(6,182,212,0.12)', color: 'var(--hr-cyan)' }}>Docker</span>
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '0.45rem', color: 'var(--hr-text-muted)' }}>EXPERIENCE</div>
                    <div style={{ fontSize: '0.5rem', color: 'var(--hr-text-secondary)', marginTop: '2px' }}>6 years · 3 companies</div>
                  </div>
                  <div style={{ flex: 1, background: '#1a1a20', border: '1px solid var(--hr-border)', borderRadius: '5px', padding: '8px' }}>
                    <div style={{ fontSize: '0.45rem', color: 'var(--hr-text-muted)', marginBottom: '5px', textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>Match Score</div>
                    <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--hr-green)', lineHeight: 1 }}>94%</div>
                    <div style={{ fontSize: '0.4rem', color: 'var(--hr-text-muted)', marginTop: '3px' }}>Based on 12 criteria</div>
                    <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: '94%', background: 'var(--hr-green)', borderRadius: '2px' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="hr-feat-info">
              <h4>Resume Intelligence</h4>
              <p>AI-powered parsing and matching to find the perfect candidates instantly.</p>
            </div>
          </div>

          {/* AI Candidate Discovery */}
          <div className="hr-feat-cell">
            <div className="hr-feat-screenshot">
              <div className="hr-feat-screenshot-inner">
                <div className="hr-mini-search-bar">🔍 Search: "Senior React Developer, Bengaluru, 5+ yrs"</div>
                <div style={{ fontSize: '0.45rem', color: 'var(--hr-text-muted)', marginBottom: '5px' }}>AI-DISCOVERED · 48 results</div>
                <div className="hr-mini-row">
                  <span className="hr-mini-avatar" style={{ background: 'rgba(124,58,237,0.2)', color: 'var(--hr-accent-hover)' }}>PK</span>
                  <div style={{ flex: 1 }}><div style={{ fontSize: '0.5rem', fontWeight: 600, color: 'var(--hr-text-secondary)' }}>Priya Krishnan</div><div style={{ fontSize: '0.4rem', color: 'var(--hr-text-muted)' }}>Lead Engineer · Flipkart</div></div>
                  <span className="hr-mini-tag" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--hr-green)' }}>97%</span>
                </div>
                <div className="hr-mini-row">
                  <span className="hr-mini-avatar" style={{ background: 'rgba(139,92,246,0.2)', color: 'var(--hr-purple)' }}>AM</span>
                  <div style={{ flex: 1 }}><div style={{ fontSize: '0.5rem', fontWeight: 600, color: 'var(--hr-text-secondary)' }}>Arjun Mehta</div><div style={{ fontSize: '0.4rem', color: 'var(--hr-text-muted)' }}>Sr. Developer · Razorpay</div></div>
                  <span className="hr-mini-tag" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--hr-green)' }}>92%</span>
                </div>
                <div className="hr-mini-row">
                  <span className="hr-mini-avatar" style={{ background: 'rgba(245,158,11,0.2)', color: 'var(--hr-yellow)' }}>SG</span>
                  <div style={{ flex: 1 }}><div style={{ fontSize: '0.5rem', fontWeight: 600, color: 'var(--hr-text-secondary)' }}>Sneha Gupta</div><div style={{ fontSize: '0.4rem', color: 'var(--hr-text-muted)' }}>Full Stack · PhonePe</div></div>
                  <span className="hr-mini-tag" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--hr-yellow)' }}>85%</span>
                </div>
              </div>
            </div>
            <div className="hr-feat-info">
              <h4>AI Candidate Discovery</h4>
              <p>Discover top talent across multiple sources with intelligent search.</p>
            </div>
          </div>

          {/* WhatsApp + Email */}
          <div className="hr-feat-cell">
            <div className="hr-feat-screenshot">
              <div className="hr-feat-screenshot-inner">
                <div style={{ display: 'flex', gap: '8px', height: '100%' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.45rem', color: 'var(--hr-text-muted)', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '3px' }}><span style={{ color: 'var(--hr-green)' }}>●</span> WhatsApp</div>
                    <div style={{ display: 'flex', flexDirection: 'column' as const }}>
                      <div className="hr-mini-msg sent">Hi Rahul! We have an exciting Sr. Frontend role. Interested?<div className="ts">10:30 AM ✓✓</div></div>
                      <div className="hr-mini-msg rcvd">Hey! Yes, sounds interesting. Share more?<div className="ts">10:45 AM</div></div>
                      <div className="hr-mini-msg sent">Great! JD sent to email. CTC: ₹28-35L 🙌<div className="ts">10:47 AM ✓✓</div></div>
                    </div>
                  </div>
                  <div style={{ width: '1px', background: 'var(--hr-border)' }}></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.45rem', color: 'var(--hr-text-muted)', marginBottom: '5px', display: 'flex', alignItems: 'center', gap: '3px' }}><span style={{ color: 'var(--hr-accent-hover)' }}>●</span> Email</div>
                    <div style={{ background: '#1a1a20', border: '1px solid var(--hr-border)', borderRadius: '4px', padding: '6px' }}>
                      <div style={{ fontSize: '0.45rem', fontWeight: 600, color: 'var(--hr-text-secondary)', marginBottom: '3px' }}>Sr. Frontend Dev — Opportunity</div>
                      <div style={{ fontSize: '0.38rem', color: 'var(--hr-text-muted)', marginBottom: '4px' }}>To: rahul.patel@email.com</div>
                      <div style={{ fontSize: '0.38rem', color: 'var(--hr-text-muted)', lineHeight: 1.5 }}>Hi Rahul,<br /><br />Following up on our WhatsApp chat. Attached is the detailed JD...<br /><br />Best,<br />VantaHire Team</div>
                    </div>
                    <div style={{ fontSize: '0.4rem', color: 'var(--hr-green)', marginTop: '4px' }}>✓ Opened · 2 min ago</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="hr-feat-info">
              <h4>WhatsApp + Email Outreach</h4>
              <p>Engage candidates through their preferred channels with smart automation.</p>
            </div>
          </div>

          {/* Client Feedback Portal */}
          <div className="hr-feat-cell">
            <div className="hr-feat-screenshot">
              <div className="hr-feat-screenshot-inner">
                <div style={{ fontSize: '0.58rem', fontWeight: 600, color: 'var(--hr-text-secondary)', marginBottom: '6px' }}>Client Review — TechCorp India</div>
                <div className="hr-fb-item">
                  <span className="hr-mini-avatar" style={{ background: 'rgba(124,58,237,0.2)', color: 'var(--hr-accent-hover)', width: '20px', height: '20px', fontSize: '0.38rem' }}>RP</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.5rem', fontWeight: 600, color: 'var(--hr-text-secondary)' }}>Rahul Patel — Sr. Frontend</div>
                    <div className="hr-fb-stars">★★★★★</div>
                    <div style={{ fontSize: '0.4rem', color: 'var(--hr-text-muted)', marginTop: '2px' }}>"Excellent fit. Strong React skills."</div>
                  </div>
                  <span className="hr-mini-tag" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--hr-green)' }}>Shortlisted</span>
                </div>
                <div className="hr-fb-item">
                  <span className="hr-mini-avatar" style={{ background: 'rgba(245,158,11,0.2)', color: 'var(--hr-yellow)', width: '20px', height: '20px', fontSize: '0.38rem' }}>AS</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.5rem', fontWeight: 600, color: 'var(--hr-text-secondary)' }}>Ananya Sharma — Lead Eng</div>
                    <div className="hr-fb-stars">★★★★<span className="empty">★</span></div>
                    <div style={{ fontSize: '0.4rem', color: 'var(--hr-text-muted)', marginTop: '2px' }}>"Good but overqualified for role."</div>
                  </div>
                  <span className="hr-mini-tag" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--hr-yellow)' }}>On Hold</span>
                </div>
                <div className="hr-fb-item">
                  <span className="hr-mini-avatar" style={{ background: 'rgba(239,68,68,0.2)', color: 'var(--hr-red)', width: '20px', height: '20px', fontSize: '0.38rem' }}>VK</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.5rem', fontWeight: 600, color: 'var(--hr-text-secondary)' }}>Vikram Kumar — Full Stack</div>
                    <div className="hr-fb-stars">★★★<span className="empty">★★</span></div>
                    <div style={{ fontSize: '0.4rem', color: 'var(--hr-text-muted)', marginTop: '2px' }}>"Needs more system design exp."</div>
                  </div>
                  <span className="hr-mini-tag" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--hr-red)' }}>Rejected</span>
                </div>
              </div>
            </div>
            <div className="hr-feat-info">
              <h4>Client Feedback Portal</h4>
              <p>Give clients a seamless way to review and provide feedback on candidates.</p>
            </div>
          </div>

          {/* Recruiter Dashboard */}
          <div className="hr-feat-cell">
            <div className="hr-feat-screenshot">
              <div className="hr-feat-screenshot-inner">
                <div style={{ fontSize: '0.58rem', fontWeight: 600, color: 'var(--hr-text-secondary)', marginBottom: '6px' }}>My Dashboard — Priya</div>
                <div className="hr-dash-grid">
                  <div className="hr-dash-cell">
                    <div className="hr-dash-cell-label">Placements MTD</div>
                    <div className="hr-dash-cell-value">7</div>
                    <div className="hr-spark">
                      <div style={{ height: '40%' }}></div><div style={{ height: '60%' }}></div><div style={{ height: '30%' }}></div><div style={{ height: '80%' }}></div><div style={{ height: '55%' }}></div><div style={{ height: '90%' }}></div><div style={{ height: '100%', opacity: 0.7 }}></div>
                    </div>
                  </div>
                  <div className="hr-dash-cell">
                    <div className="hr-dash-cell-label">Revenue</div>
                    <div className="hr-dash-cell-value">₹4.2L</div>
                    <div style={{ fontSize: '0.4rem', color: 'var(--hr-green)', marginTop: '3px' }}>↑ 18% vs target</div>
                  </div>
                  <div className="hr-dash-cell">
                    <div className="hr-dash-cell-label">Active Candidates</div>
                    <div className="hr-dash-cell-value">42</div>
                    <div style={{ fontSize: '0.4rem', color: 'var(--hr-text-muted)', marginTop: '3px' }}>12 in interview stage</div>
                  </div>
                  <div className="hr-dash-cell">
                    <div className="hr-dash-cell-label">Response Rate</div>
                    <div className="hr-dash-cell-value">74%</div>
                    <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginTop: '6px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: '74%', background: 'var(--hr-accent)', borderRadius: '2px' }}></div>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '6px', padding: '5px 6px', background: '#1a1a20', border: '1px solid var(--hr-border)', borderRadius: '4px' }}>
                  <div style={{ fontSize: '0.42rem', color: 'var(--hr-text-muted)', marginBottom: '3px', textTransform: 'uppercase' as const }}>Today's Tasks</div>
                  <div style={{ fontSize: '0.42rem', color: 'var(--hr-text-secondary)', marginBottom: '2px', display: 'flex', gap: '4px' }}><span style={{ color: 'var(--hr-green)' }}>✓</span> Follow up with 3 candidates</div>
                  <div style={{ fontSize: '0.42rem', color: 'var(--hr-text-secondary)', marginBottom: '2px', display: 'flex', gap: '4px' }}><span style={{ color: 'var(--hr-yellow)' }}>○</span> Schedule 2 client interviews</div>
                  <div style={{ fontSize: '0.42rem', color: 'var(--hr-text-secondary)', display: 'flex', gap: '4px' }}><span style={{ color: 'var(--hr-yellow)' }}>○</span> Send weekly report to TechCorp</div>
                </div>
              </div>
            </div>
            <div className="hr-feat-info">
              <h4>Recruiter Dashboard</h4>
              <p>Track performance, manage pipeline, and stay on top of every placement.</p>
            </div>
          </div>

          {/* Job Command Center */}
          <div className="hr-feat-cell">
            <div className="hr-feat-screenshot">
              <div className="hr-feat-screenshot-inner">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ fontSize: '0.58rem', fontWeight: 600, color: 'var(--hr-text-secondary)' }}>Job Command Center</div>
                  <span className="hr-mini-tag" style={{ background: 'rgba(124,58,237,0.12)', color: 'var(--hr-accent-hover)' }}>12 Active</span>
                </div>
                <div className="hr-job-item"><span className="hr-job-dot" style={{ background: 'var(--hr-red)' }}></span><span className="hr-job-name">Sr. Frontend Engineer</span><span className="hr-job-count">👤 24</span><span className="hr-job-pill" style={{ background: 'rgba(124,58,237,0.12)', color: 'var(--hr-accent-hover)' }}>Sourcing</span></div>
                <div className="hr-job-item"><span className="hr-job-dot" style={{ background: 'var(--hr-yellow)' }}></span><span className="hr-job-name">Data Scientist</span><span className="hr-job-count">👤 18</span><span className="hr-job-pill" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--hr-green)' }}>Interview</span></div>
                <div className="hr-job-item"><span className="hr-job-dot" style={{ background: 'var(--hr-green)' }}></span><span className="hr-job-name">Product Manager</span><span className="hr-job-count">👤 31</span><span className="hr-job-pill" style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--hr-purple)' }}>Offer</span></div>
                <div className="hr-job-item"><span className="hr-job-dot" style={{ background: 'var(--hr-red)' }}></span><span className="hr-job-name">DevOps Engineer</span><span className="hr-job-count">👤 9</span><span className="hr-job-pill" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--hr-yellow)' }}>Urgent</span></div>
                <div className="hr-job-item"><span className="hr-job-dot" style={{ background: 'var(--hr-cyan)' }}></span><span className="hr-job-name">UI/UX Designer</span><span className="hr-job-count">👤 15</span><span className="hr-job-pill" style={{ background: 'rgba(124,58,237,0.12)', color: 'var(--hr-accent-hover)' }}>Sourcing</span></div>
              </div>
            </div>
            <div className="hr-feat-info">
              <h4>Job Command Center</h4>
              <p>Centralised hub to manage all job requirements, candidates, and workflows.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="struct-gutter"></div>
    </div>
  );
};

export default FeaturesGrid;
