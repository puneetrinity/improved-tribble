import { sectionLabel } from "@/lib/shared-styles";

// Shared class strings for mini UI elements
const miniTag = "text-[0.45rem] px-[5px] py-px rounded-[3px] font-semibold inline-block";
const miniRow = "flex items-center gap-2 py-[5px] px-2 bg-[#f1f3f5] border border-[rgba(0,0,0,0.08)] rounded-[5px] mb-1";
const miniAvatar = "w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-[0.4rem] font-bold shrink-0";
const miniMsgBase = "py-1.5 px-2 rounded-[6px] text-[0.5rem] max-w-[80%] leading-[1.5] mb-1";
const miniMsgSent = `${miniMsgBase} bg-hr-accent text-white self-end ml-auto rounded-br-sm`;
const miniMsgRcvd = `${miniMsgBase} bg-[#f1f3f5] border border-[rgba(0,0,0,0.08)] text-[#4a5568] rounded-bl-sm`;
const fbItem = "flex gap-2 p-2 bg-[#f1f3f5] border border-[rgba(0,0,0,0.08)] rounded-[5px] mb-[5px] items-start";
const dashCell = "p-2 bg-[#f1f3f5] border border-[rgba(0,0,0,0.08)] rounded-[5px]";
const jobItem = "flex items-center gap-2 py-1.5 px-2 bg-[#f1f3f5] border border-[rgba(0,0,0,0.08)] rounded-[5px] mb-1 text-[0.52rem]";
const featScreenshot = "h-[220px] bg-[#1a1a2e] p-5 overflow-hidden flex items-center justify-center relative";
const featScreenshotInner = "bg-gradient-to-br from-[#ffffff] to-[#f8f9fc] border border-[rgba(0,0,0,0.1)] rounded-lg p-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)] m-2 max-md:m-1.5 overflow-hidden w-full h-full";
const featInfo = "py-6 px-7 pb-7";

// Repeated text-style constants for mini UI screenshot content
const miniSectionTitle = "text-[0.58rem] font-semibold text-[#4a5568] mb-1.5";
const miniLabel = "text-[0.45rem] text-[#9ca3af] mb-[5px] uppercase tracking-[0.04em]";
const miniName = "text-[0.5rem] font-semibold text-[#4a5568]";
const miniSubtext = "text-[0.4rem] text-[#9ca3af]";
const miniNote = "text-[0.4rem] text-[#9ca3af] mt-[3px]";
const miniPanel = "bg-[#f1f3f5] border border-[rgba(0,0,0,0.08)] rounded-[5px] p-2";
const miniProgressTrack = "h-[3px] bg-[rgba(0,0,0,0.08)] rounded-[2px] mt-1.5 overflow-hidden";
const miniProgressBar = "h-full rounded-[2px]";

// Tag color variants (background + text)
const tagPurple = "bg-[rgba(124,58,237,0.12)] text-hr-accent-hover";
const tagGreen = "bg-[rgba(16,185,129,0.12)] text-hr-green";
const tagViolet = "bg-[rgba(139,92,246,0.12)] text-hr-purple";
const tagAmber = "bg-[rgba(245,158,11,0.12)] text-hr-yellow";
const tagCyan = "bg-[rgba(6,182,212,0.12)] text-hr-cyan";
const tagRed = "bg-[rgba(239,68,68,0.12)] text-hr-red";

// Avatar color variants
const avatarPurple = "bg-[rgba(124,58,237,0.2)] text-hr-accent-hover";
const avatarViolet = "bg-[rgba(139,92,246,0.2)] text-hr-purple";
const avatarAmber = "bg-[rgba(245,158,11,0.2)] text-hr-yellow";
const avatarRed = "bg-[rgba(239,68,68,0.2)] text-hr-red";

// Larger avatar used in feedback items
const fbAvatar = `${miniAvatar} !w-5 !h-5 text-[0.38rem]`;

// Status tag used in job items
const jobStatusTag = "text-[0.42rem] py-[2px] px-[5px] rounded-[3px] font-semibold";

const FeaturesGrid = () => {
  return (
    <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
      <div></div>
      <div className="border-b border-[rgba(255,255,255,0.07)] py-[100px] px-12 max-md:py-[60px] max-md:px-5">
        <div className="text-center mb-[60px]">
          <div className={sectionLabel}>Core Features</div>
          <h2 className="font-satoshi text-[clamp(2rem,4vw,2.8rem)] max-sm:text-[1.6rem] font-normal leading-[1.2] tracking-tight mb-4 text-hr-text">Everything You Need to<br />Recruit at Scale</h2>
          <p className="text-base max-sm:text-[0.875rem] leading-[1.7] text-hr-text-secondary max-w-[520px] mx-auto">Six powerful modules that cover every aspect of the recruitment lifecycle, from sourcing to placement.</p>
        </div>

        <div className="grid grid-cols-3 lg:grid-cols-3 md:grid-cols-2 max-md:grid-cols-1 gap-px max-md:gap-0 max-w-[1200px] mx-auto bg-[rgba(255,255,255,0.1)] border border-[rgba(255,255,255,0.1)]">
          {/* Resume Intelligence */}
          <div className="p-0 overflow-hidden bg-hr-bg">
            <div className={featScreenshot}>
              <div className={featScreenshotInner}>
                <div className={miniSectionTitle}>Resume Analysis</div>
                <div className="flex gap-2">
                  <div className={`flex-1 ${miniPanel}`}>
                    <div className={miniLabel}>Extracted Skills</div>
                    <div className="flex flex-wrap gap-[3px]">
                      <span className={`${miniTag} ${tagPurple}`}>React</span>
                      <span className={`${miniTag} ${tagGreen}`}>Node.js</span>
                      <span className={`${miniTag} ${tagViolet}`}>Python</span>
                      <span className={`${miniTag} ${tagAmber}`}>AWS</span>
                      <span className={`${miniTag} ${tagCyan}`}>Docker</span>
                    </div>
                    <div className={`mt-1.5 ${miniSubtext}`}>EXPERIENCE</div>
                    <div className="text-[0.5rem] text-[#4a5568] mt-0.5">6 years · 3 companies</div>
                  </div>
                  <div className={`flex-1 ${miniPanel}`}>
                    <div className={miniLabel}>Match Score</div>
                    <div className="text-[1.6rem] font-bold text-hr-green leading-none">94%</div>
                    <div className={miniNote}>Based on 12 criteria</div>
                    <div className={miniProgressTrack}>
                      <div className={`${miniProgressBar} w-[94%] bg-hr-green`}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className={featInfo}>
              <h4 className="font-satoshi text-[1.05rem] font-medium mb-1.5 text-hr-text">Resume Intelligence</h4>
              <p className="text-[0.85rem] text-hr-text-secondary leading-[1.5]">AI-powered parsing and matching to find the perfect candidates instantly.</p>
            </div>
          </div>

          {/* AI Candidate Discovery */}
          <div className="p-0 overflow-hidden bg-hr-bg">
            <div className={featScreenshot}>
              <div className={featScreenshotInner}>
                <div className="flex items-center gap-1.5 py-1.5 px-2.5 bg-[#f1f3f5] border border-[rgba(0,0,0,0.08)] rounded-[5px] mb-2 text-[0.55rem] text-[#9ca3af]">🔍 Search: &quot;Senior React Developer, Bengaluru, 5+ yrs&quot;</div>
                <div className={`${miniSubtext} mb-[5px]`}>AI-DISCOVERED · 48 results</div>
                <div className={miniRow}>
                  <span className={`${miniAvatar} ${avatarPurple}`}>PK</span>
                  <div className="flex-1"><div className={miniName}>Priya Krishnan</div><div className={miniSubtext}>Lead Engineer · Flipkart</div></div>
                  <span className={`${miniTag} ${tagGreen}`}>97%</span>
                </div>
                <div className={miniRow}>
                  <span className={`${miniAvatar} ${avatarViolet}`}>AM</span>
                  <div className="flex-1"><div className={miniName}>Arjun Mehta</div><div className={miniSubtext}>Sr. Developer · Razorpay</div></div>
                  <span className={`${miniTag} ${tagGreen}`}>92%</span>
                </div>
                <div className={miniRow}>
                  <span className={`${miniAvatar} ${avatarAmber}`}>SG</span>
                  <div className="flex-1"><div className={miniName}>Sneha Gupta</div><div className={miniSubtext}>Full Stack · PhonePe</div></div>
                  <span className={`${miniTag} ${tagAmber}`}>85%</span>
                </div>
              </div>
            </div>
            <div className={featInfo}>
              <h4 className="font-satoshi text-[1.05rem] font-medium mb-1.5 text-hr-text">AI Candidate Discovery</h4>
              <p className="text-[0.85rem] text-hr-text-secondary leading-[1.5]">Discover top talent across multiple sources with intelligent search.</p>
            </div>
          </div>

          {/* WhatsApp + Email */}
          <div className="p-0 overflow-hidden bg-hr-bg">
            <div className={featScreenshot}>
              <div className={featScreenshotInner}>
                <div className="flex gap-2 h-full">
                  <div className="flex-1">
                    <div className={`${miniSubtext} mb-[5px] flex items-center gap-[3px]`}><span className="text-hr-green">●</span> WhatsApp</div>
                    <div className="flex flex-col">
                      <div className={miniMsgSent}>Hi Rahul! We have an exciting Sr. Frontend role. Interested?<div className="text-[0.4rem] text-[rgba(0,0,0,0.4)] mt-0.5">10:30 AM ✓✓</div></div>
                      <div className={miniMsgRcvd}>Hey! Yes, sounds interesting. Share more?<div className="text-[0.4rem] text-[#9ca3af] mt-0.5">10:45 AM</div></div>
                      <div className={miniMsgSent}>Great! JD sent to email. CTC: ₹28-35L 🙌<div className="text-[0.4rem] text-[rgba(0,0,0,0.4)] mt-0.5">10:47 AM ✓✓</div></div>
                    </div>
                  </div>
                  <div className="w-px bg-[rgba(0,0,0,0.08)]"></div>
                  <div className="flex-1">
                    <div className={`${miniSubtext} mb-[5px] flex items-center gap-[3px]`}><span className="text-hr-accent-hover">●</span> Email</div>
                    <div className="bg-[#f1f3f5] border border-[rgba(0,0,0,0.08)] rounded p-1.5">
                      <div className="text-[0.45rem] font-semibold text-[#4a5568] mb-[3px]">Sr. Frontend Dev — Opportunity</div>
                      <div className="text-[0.38rem] text-[#9ca3af] mb-1">To: rahul.patel@email.com</div>
                      <div className="text-[0.38rem] text-[#9ca3af] leading-[1.5]">Hi Rahul,<br /><br />Following up on our WhatsApp chat. Attached is the detailed JD...<br /><br />Best,<br />VantaHire Team</div>
                    </div>
                    <div className="text-[0.4rem] text-hr-green mt-1">✓ Opened · 2 min ago</div>
                  </div>
                </div>
              </div>
            </div>
            <div className={featInfo}>
              <h4 className="font-satoshi text-[1.05rem] font-medium mb-1.5 text-hr-text">WhatsApp + Email Outreach</h4>
              <p className="text-[0.85rem] text-hr-text-secondary leading-[1.5]">Engage candidates through their preferred channels with smart automation.</p>
            </div>
          </div>

          {/* Client Feedback Portal */}
          <div className="p-0 overflow-hidden bg-hr-bg">
            <div className={featScreenshot}>
              <div className={featScreenshotInner}>
                <div className={miniSectionTitle}>Client Review — TechCorp India</div>
                <div className={fbItem}>
                  <span className={`${fbAvatar} ${avatarPurple}`}>RP</span>
                  <div className="flex-1">
                    <div className={miniName}>Rahul Patel — Sr. Frontend</div>
                    <div className="text-[0.5rem] text-hr-yellow tracking-[1px]">★★★★★</div>
                    <div className={`${miniSubtext} mt-0.5`}>&quot;Excellent fit. Strong React skills.&quot;</div>
                  </div>
                  <span className={`${miniTag} ${tagGreen}`}>Shortlisted</span>
                </div>
                <div className={fbItem}>
                  <span className={`${fbAvatar} ${avatarAmber}`}>AS</span>
                  <div className="flex-1">
                    <div className={miniName}>Ananya Sharma — Lead Eng</div>
                    <div className="text-[0.5rem] text-hr-yellow tracking-[1px]">★★★★<span className="text-[#9ca3af]">★</span></div>
                    <div className={`${miniSubtext} mt-0.5`}>&quot;Good but overqualified for role.&quot;</div>
                  </div>
                  <span className={`${miniTag} ${tagAmber}`}>On Hold</span>
                </div>
                <div className={fbItem}>
                  <span className={`${fbAvatar} ${avatarRed}`}>VK</span>
                  <div className="flex-1">
                    <div className={miniName}>Vikram Kumar — Full Stack</div>
                    <div className="text-[0.5rem] text-hr-yellow tracking-[1px]">★★★<span className="text-[#9ca3af]">★★</span></div>
                    <div className={`${miniSubtext} mt-0.5`}>&quot;Needs more system design exp.&quot;</div>
                  </div>
                  <span className={`${miniTag} ${tagRed}`}>Rejected</span>
                </div>
              </div>
            </div>
            <div className={featInfo}>
              <h4 className="font-satoshi text-[1.05rem] font-medium mb-1.5 text-hr-text">Client Feedback Portal</h4>
              <p className="text-[0.85rem] text-hr-text-secondary leading-[1.5]">Give clients a seamless way to review and provide feedback on candidates.</p>
            </div>
          </div>

          {/* Recruiter Dashboard */}
          <div className="p-0 overflow-hidden bg-hr-bg">
            <div className={featScreenshot}>
              <div className={featScreenshotInner}>
                <div className={miniSectionTitle}>My Dashboard — Priya</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div className={dashCell}>
                    <div className="text-[0.45rem] text-[#9ca3af] uppercase tracking-[0.04em] mb-[3px]">Placements MTD</div>
                    <div className="text-sm font-bold text-[#1a1a2e]">7</div>
                    <div className="flex items-end gap-0.5 h-[18px] mt-1">
                      <div className="flex-1 bg-hr-accent rounded-[1px] opacity-45" style={{ height: '40%' }}></div><div className="flex-1 bg-hr-accent rounded-[1px] opacity-45" style={{ height: '60%' }}></div><div className="flex-1 bg-hr-accent rounded-[1px] opacity-45" style={{ height: '30%' }}></div><div className="flex-1 bg-hr-accent rounded-[1px] opacity-45" style={{ height: '80%' }}></div><div className="flex-1 bg-hr-accent rounded-[1px] opacity-45" style={{ height: '55%' }}></div><div className="flex-1 bg-hr-accent rounded-[1px] opacity-45" style={{ height: '90%' }}></div><div className="flex-1 bg-hr-accent rounded-[1px] opacity-70" style={{ height: '100%' }}></div>
                    </div>
                  </div>
                  <div className={dashCell}>
                    <div className="text-[0.45rem] text-[#9ca3af] uppercase tracking-[0.04em] mb-[3px]">Revenue</div>
                    <div className="text-sm font-bold text-[#1a1a2e]">₹4.2L</div>
                    <div className="text-[0.4rem] text-hr-green mt-[3px]">↑ 18% vs target</div>
                  </div>
                  <div className={dashCell}>
                    <div className="text-[0.45rem] text-[#9ca3af] uppercase tracking-[0.04em] mb-[3px]">Active Candidates</div>
                    <div className="text-sm font-bold text-[#1a1a2e]">42</div>
                    <div className={miniNote}>12 in interview stage</div>
                  </div>
                  <div className={dashCell}>
                    <div className="text-[0.45rem] text-[#9ca3af] uppercase tracking-[0.04em] mb-[3px]">Response Rate</div>
                    <div className="text-sm font-bold text-[#1a1a2e]">74%</div>
                    <div className={miniProgressTrack}>
                      <div className={`${miniProgressBar} w-[74%] bg-hr-accent`}></div>
                    </div>
                  </div>
                </div>
                <div className={`${miniPanel} mt-1.5 px-1.5 py-[5px] rounded`}>
                  <div className="text-[0.42rem] text-[#9ca3af] mb-[3px] uppercase">Today&apos;s Tasks</div>
                  <div className="text-[0.42rem] text-[#4a5568] mb-0.5 flex gap-1"><span className="text-hr-green">✓</span> Follow up with 3 candidates</div>
                  <div className="text-[0.42rem] text-[#4a5568] mb-0.5 flex gap-1"><span className="text-hr-yellow">○</span> Schedule 2 client interviews</div>
                  <div className="text-[0.42rem] text-[#4a5568] flex gap-1"><span className="text-hr-yellow">○</span> Send weekly report to TechCorp</div>
                </div>
              </div>
            </div>
            <div className={featInfo}>
              <h4 className="font-satoshi text-[1.05rem] font-medium mb-1.5 text-hr-text">Recruiter Dashboard</h4>
              <p className="text-[0.85rem] text-hr-text-secondary leading-[1.5]">Track performance, manage pipeline, and stay on top of every placement.</p>
            </div>
          </div>

          {/* Job Command Center */}
          <div className="p-0 overflow-hidden bg-hr-bg">
            <div className={featScreenshot}>
              <div className={featScreenshotInner}>
                <div className="flex justify-between items-center mb-1.5">
                  <div className="text-[0.58rem] font-semibold text-[#4a5568]">Job Command Center</div>
                  <span className={`${miniTag} ${tagPurple}`}>12 Active</span>
                </div>
                <div className={jobItem}><span className="w-[5px] h-[5px] rounded-full shrink-0 bg-hr-red"></span><span className="flex-1 text-[#4a5568] font-medium">Sr. Frontend Engineer</span><span className="text-[#9ca3af] font-mono text-[0.48rem]">👤 24</span><span className={`${jobStatusTag} ${tagPurple}`}>Sourcing</span></div>
                <div className={jobItem}><span className="w-[5px] h-[5px] rounded-full shrink-0 bg-hr-yellow"></span><span className="flex-1 text-[#4a5568] font-medium">Data Scientist</span><span className="text-[#9ca3af] font-mono text-[0.48rem]">👤 18</span><span className={`${jobStatusTag} ${tagGreen}`}>Interview</span></div>
                <div className={jobItem}><span className="w-[5px] h-[5px] rounded-full shrink-0 bg-hr-green"></span><span className="flex-1 text-[#4a5568] font-medium">Product Manager</span><span className="text-[#9ca3af] font-mono text-[0.48rem]">👤 31</span><span className={`${jobStatusTag} ${tagViolet}`}>Offer</span></div>
                <div className={jobItem}><span className="w-[5px] h-[5px] rounded-full shrink-0 bg-hr-red"></span><span className="flex-1 text-[#4a5568] font-medium">DevOps Engineer</span><span className="text-[#9ca3af] font-mono text-[0.48rem]">👤 9</span><span className={`${jobStatusTag} ${tagAmber}`}>Urgent</span></div>
                <div className={jobItem}><span className="w-[5px] h-[5px] rounded-full shrink-0 bg-hr-cyan"></span><span className="flex-1 text-[#4a5568] font-medium">UI/UX Designer</span><span className="text-[#9ca3af] font-mono text-[0.48rem]">👤 15</span><span className={`${jobStatusTag} ${tagPurple}`}>Sourcing</span></div>
              </div>
            </div>
            <div className={featInfo}>
              <h4 className="font-satoshi text-[1.05rem] font-medium mb-1.5 text-hr-text">Job Command Center</h4>
              <p className="text-[0.85rem] text-hr-text-secondary leading-[1.5]">Centralised hub to manage all job requirements, candidates, and workflows.</p>
            </div>
          </div>
        </div>
      </div>
      <div></div>
    </div>
  );
};

export default FeaturesGrid;
