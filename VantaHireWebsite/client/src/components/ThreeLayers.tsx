const ThreeLayers = () => {
  return (
    <div className="hr-struct-section">
      <div className="struct-gutter"></div>
      <div className="struct-body">
        <section className="hr-layers-section" style={{ borderBottom: 'none' }}>
          <div className="hr-layers-intro">
            <div className="hr-section-label">Three Powerful Layers</div>
            <h2 className="hr-section-title">One Platform,<br />Three Dimensions of Power</h2>
            <p className="hr-section-desc" style={{ margin: '0 auto' }}>
              VantaHire combines intelligence, outreach, and operations into a unified system that handles every aspect of modern recruitment.
            </p>
          </div>

          {/* Intelligence Layer */}
          <div className="hr-layer-row">
            <div className="hr-layer-text">
              <div className="hr-layer-num">Layer 01 — Intelligence</div>
              <h3>Intelligence Layer</h3>
              <p>AI-powered resume parsing, candidate matching, and smart recommendations that learn from your hiring patterns.</p>
              <div className="hr-layer-tags">
                <span className="hr-layer-tag">Resume Parsing</span>
                <span className="hr-layer-tag">Smart Matching</span>
                <span className="hr-layer-tag">Skill Mapping</span>
                <span className="hr-layer-tag">Pattern Learning</span>
              </div>
            </div>
            <div className="hr-layer-mock">
              <div className="hr-mock-bar"><div className="dots"><span></span><span></span><span></span></div></div>
              <div className="hr-mock-body">
                <div className="hr-mock-heading">AI Candidate Matching</div>
                <div className="hr-mock-sub">Senior Frontend Engineer · Bengaluru · 3 matches</div>
                <div className="hr-cand-card">
                  <div className="hr-cand-avatar" style={{ background: 'rgba(124,58,237,0.2)', color: 'var(--hr-accent-hover)' }}>RP</div>
                  <div className="hr-cand-info"><div className="hr-cand-name">Rahul Patel</div><div className="hr-cand-role">Sr. Frontend Dev · 6 yrs · React, TypeScript</div></div>
                  <span className="hr-match-badge hr-match-high">96%</span>
                </div>
                <div className="hr-cand-card">
                  <div className="hr-cand-avatar" style={{ background: 'rgba(16,185,129,0.2)', color: 'var(--hr-green)' }}>AS</div>
                  <div className="hr-cand-info"><div className="hr-cand-name">Ananya Sharma</div><div className="hr-cand-role">Lead Engineer · 8 yrs · Vue, Node.js</div></div>
                  <span className="hr-match-badge hr-match-high">91%</span>
                </div>
                <div className="hr-cand-card">
                  <div className="hr-cand-avatar" style={{ background: 'rgba(245,158,11,0.2)', color: 'var(--hr-yellow)' }}>VK</div>
                  <div className="hr-cand-info"><div className="hr-cand-name">Vikram Kumar</div><div className="hr-cand-role">Full Stack Dev · 4 yrs · React, Python</div></div>
                  <span className="hr-match-badge hr-match-mid">78%</span>
                </div>
                <div className="hr-skill-section">
                  <div className="hr-skill-section-title">Skill match — Rahul Patel</div>
                  <div className="hr-skill-row"><span className="hr-skill-name">React</span><div className="hr-skill-track"><div className="hr-skill-fill" style={{ width: '95%', background: 'var(--hr-green)' }}></div></div></div>
                  <div className="hr-skill-row"><span className="hr-skill-name">TypeScript</span><div className="hr-skill-track"><div className="hr-skill-fill" style={{ width: '88%', background: 'var(--hr-accent)' }}></div></div></div>
                  <div className="hr-skill-row"><span className="hr-skill-name">System Design</span><div className="hr-skill-track"><div className="hr-skill-fill" style={{ width: '72%', background: 'var(--hr-yellow)' }}></div></div></div>
                </div>
              </div>
            </div>
          </div>

          {/* Outreach Layer */}
          <div className="hr-layer-row reverse">
            <div className="hr-layer-text">
              <div className="hr-layer-num">Layer 02 — Outreach</div>
              <h3>Outreach Layer</h3>
              <p>Multi-channel candidate engagement through WhatsApp and email with automated sequences and templates.</p>
              <div className="hr-layer-tags">
                <span className="hr-layer-tag">WhatsApp</span>
                <span className="hr-layer-tag">Email Sequences</span>
                <span className="hr-layer-tag">Templates</span>
                <span className="hr-layer-tag">Auto Follow-up</span>
              </div>
            </div>
            <div className="hr-layer-mock">
              <div className="hr-mock-bar"><div className="dots"><span></span><span></span><span></span></div></div>
              <div className="hr-mock-body">
                <div className="hr-mock-heading">Outreach Channels</div>
                <div className="hr-channels-grid">
                  <div className="hr-channel-card">
                    <div className="hr-channel-head">
                      <div className="hr-channel-icon" style={{ background: 'rgba(16,185,129,0.2)', color: 'var(--hr-green)' }}>W</div>
                      <span className="hr-channel-name">WhatsApp</span>
                    </div>
                    <div className="hr-channel-stat"><span>Delivered</span><span className="val">342</span></div>
                    <div className="hr-channel-stat"><span>Read Rate</span><span className="val">89%</span></div>
                    <div className="hr-channel-stat"><span>Replies</span><span className="val">156</span></div>
                  </div>
                  <div className="hr-channel-card">
                    <div className="hr-channel-head">
                      <div className="hr-channel-icon" style={{ background: 'rgba(124,58,237,0.2)', color: 'var(--hr-accent-hover)' }}>E</div>
                      <span className="hr-channel-name">Email</span>
                    </div>
                    <div className="hr-channel-stat"><span>Sent</span><span className="val">518</span></div>
                    <div className="hr-channel-stat"><span>Open Rate</span><span className="val">64%</span></div>
                    <div className="hr-channel-stat"><span>Replies</span><span className="val">98</span></div>
                  </div>
                </div>
                <div className="hr-sequence-label">Active Sequence: "Senior Dev Outreach"</div>
                <div className="hr-sequence-steps">
                  <div className="hr-step-node done">1</div>
                  <div className="hr-step-line done"></div>
                  <div className="hr-step-node done">2</div>
                  <div className="hr-step-line done"></div>
                  <div className="hr-step-node">3</div>
                  <div className="hr-step-line"></div>
                  <div className="hr-step-node">4</div>
                </div>
                <div className="hr-step-labels">
                  <span className="hr-step-lbl">WhatsApp Intro</span>
                  <span className="hr-step-lbl">Email Details</span>
                  <span className="hr-step-lbl">Follow-up D3</span>
                  <span className="hr-step-lbl">Final Nudge</span>
                </div>
              </div>
            </div>
          </div>

          {/* Operations Layer */}
          <div className="hr-layer-row">
            <div className="hr-layer-text">
              <div className="hr-layer-num">Layer 03 — Operations</div>
              <h3>Operations Layer</h3>
              <p>End-to-end recruitment workflow management with client portals, invoicing, and team collaboration.</p>
              <div className="hr-layer-tags">
                <span className="hr-layer-tag">Client Portal</span>
                <span className="hr-layer-tag">Invoicing</span>
                <span className="hr-layer-tag">Team Collab</span>
                <span className="hr-layer-tag">Workflows</span>
              </div>
            </div>
            <div className="hr-layer-mock">
              <div className="hr-mock-bar"><div className="dots"><span></span><span></span><span></span></div></div>
              <div className="hr-mock-body">
                <div className="hr-mock-heading">Operations Dashboard</div>
                <div className="hr-ops-grid">
                  <div className="hr-ops-widget">
                    <div className="hr-ops-label">Active Jobs</div>
                    <div className="hr-ops-value">34</div>
                    <div className="hr-ops-sub">8 closing this week</div>
                  </div>
                  <div className="hr-ops-widget">
                    <div className="hr-ops-label">Revenue MTD</div>
                    <div className="hr-ops-value">₹18.4L</div>
                    <div className="hr-ops-sub" style={{ color: 'var(--hr-green)' }}>↑ 23% vs last month</div>
                  </div>
                  <div className="hr-ops-widget" style={{ gridColumn: 'span 2' }}>
                    <div className="hr-ops-label">Recent Invoices</div>
                    <div className="hr-invoice-row"><span className="hr-inv-client">TechCorp India</span><span className="hr-inv-amount">₹2,40,000</span><span className="hr-status-pill hr-status-paid">Paid</span></div>
                    <div className="hr-invoice-row"><span className="hr-inv-client">Finova Solutions</span><span className="hr-inv-amount">₹1,85,000</span><span className="hr-status-pill hr-status-pending">Pending</span></div>
                    <div className="hr-invoice-row"><span className="hr-inv-client">DataBridge Labs</span><span className="hr-inv-amount">₹3,20,000</span><span className="hr-status-pill hr-status-paid">Paid</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="struct-gutter"></div>
    </div>
  );
};

export default ThreeLayers;
