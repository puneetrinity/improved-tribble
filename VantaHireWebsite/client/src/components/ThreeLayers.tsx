import { sectionLabel } from "@/lib/shared-styles";

// Shared Tailwind class strings for mockup UI elements
const mock = {
  container: "bg-white border border-[rgba(0,0,0,0.1)] rounded-[10px] overflow-hidden shadow-[0_16px_48px_rgba(0,0,0,0.08)]",
  bar: "flex items-center gap-1.5 py-[9px] px-3.5 bg-[#f1f3f5] border-b border-[rgba(0,0,0,0.08)]",
  dot: "w-2 h-2 rounded-full bg-[rgba(0,0,0,0.12)]",
  body: "p-[18px] min-h-[280px]",
  heading: "text-[0.72rem] font-semibold text-[#1a1a2e] mb-1",
  sub: "text-[0.55rem] text-[#9ca3af] mb-3.5",
};

const ThreeLayers = () => {
  return (
    <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px]">
      <div></div>
      <div className="border-b border-[rgba(255,255,255,0.07)]">
        <section className="py-[100px] px-12 max-md:py-[60px] max-md:px-5 border-b-0">
          <div className="text-center mb-20">
            <div className={sectionLabel}>Three Powerful Layers</div>
            <h2 className="font-satoshi text-[clamp(2rem,4vw,2.8rem)] max-sm:text-[1.6rem] font-normal leading-[1.2] tracking-tight mb-4 text-hr-text">One Platform,<br />Three Dimensions of Power</h2>
            <p className="text-base max-sm:text-[0.875rem] leading-[1.7] text-hr-text-secondary max-w-[520px] mx-auto">
              VantaHire combines intelligence, outreach, and operations into a unified system that handles every aspect of modern recruitment.
            </p>
          </div>

          {/* Intelligence Layer */}
          <div className="grid grid-cols-[1fr_1.2fr] max-md:grid-cols-1 gap-[60px] max-md:gap-8 max-sm:gap-6 items-center max-w-[1100px] mx-auto mb-20">
            <div>
              <div className="font-mono text-[0.62rem] text-hr-text-muted tracking-[0.12em] uppercase mb-2.5">Layer 01 — Intelligence</div>
              <h3 className="font-satoshi text-[1.7rem] max-md:text-[1.4rem] font-normal mb-3.5 text-hr-text">Intelligence Layer</h3>
              <p className="text-sm text-hr-text-secondary leading-[1.7] mb-[18px]">AI-powered resume parsing, candidate matching, and smart recommendations that learn from your hiring patterns.</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Resume Parsing</span>
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Smart Matching</span>
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Skill Mapping</span>
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Pattern Learning</span>
              </div>
            </div>
            <div className={mock.container}>
              <div className={mock.bar}><div className="flex gap-[5px]"><span className={mock.dot}></span><span className={mock.dot}></span><span className={mock.dot}></span></div></div>
              <div className={mock.body}>
                <div className={mock.heading}>AI Candidate Matching</div>
                <div className={mock.sub}>Senior Frontend Engineer · Bengaluru · 3 matches</div>
                {/* Candidate cards */}
                <div className="flex items-center gap-2.5 p-2.5 bg-[#f4f5f7] border border-[rgba(0,0,0,0.08)] rounded-[7px] mb-1.5">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[0.6rem] font-bold shrink-0" style={{ background: 'rgba(124,58,237,0.2)', color: '#A78BFA' }}>RP</div>
                  <div className="flex-1"><div className="text-[0.7rem] font-semibold text-[#1a1a2e] mb-px">Rahul Patel</div><div className="text-[0.55rem] text-[#9ca3af]">Sr. Frontend Dev · 6 yrs · React, TypeScript</div></div>
                  <span className="font-mono text-[0.62rem] font-semibold py-[3px] px-2.5 rounded-full bg-[rgba(16,185,129,0.12)] text-hr-green">96%</span>
                </div>
                <div className="flex items-center gap-2.5 p-2.5 bg-[#f4f5f7] border border-[rgba(0,0,0,0.08)] rounded-[7px] mb-1.5">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[0.6rem] font-bold shrink-0" style={{ background: 'rgba(16,185,129,0.2)', color: '#10B981' }}>AS</div>
                  <div className="flex-1"><div className="text-[0.7rem] font-semibold text-[#1a1a2e] mb-px">Ananya Sharma</div><div className="text-[0.55rem] text-[#9ca3af]">Lead Engineer · 8 yrs · Vue, Node.js</div></div>
                  <span className="font-mono text-[0.62rem] font-semibold py-[3px] px-2.5 rounded-full bg-[rgba(16,185,129,0.12)] text-hr-green">91%</span>
                </div>
                <div className="flex items-center gap-2.5 p-2.5 bg-[#f4f5f7] border border-[rgba(0,0,0,0.08)] rounded-[7px] mb-1.5">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[0.6rem] font-bold shrink-0" style={{ background: 'rgba(245,158,11,0.2)', color: '#F59E0B' }}>VK</div>
                  <div className="flex-1"><div className="text-[0.7rem] font-semibold text-[#1a1a2e] mb-px">Vikram Kumar</div><div className="text-[0.55rem] text-[#9ca3af]">Full Stack Dev · 4 yrs · React, Python</div></div>
                  <span className="font-mono text-[0.62rem] font-semibold py-[3px] px-2.5 rounded-full bg-[rgba(245,158,11,0.12)] text-hr-yellow">78%</span>
                </div>
                {/* Skill bars */}
                <div className="mt-3">
                  <div className="text-[0.55rem] text-[#9ca3af] uppercase tracking-[0.04em] mb-2">Skill match — Rahul Patel</div>
                  <div className="flex items-center gap-2 mb-[5px]"><span className="text-[0.58rem] text-[#4a5568] w-[72px] shrink-0">React</span><div className="flex-1 h-[3px] bg-[rgba(0,0,0,0.08)] rounded-sm overflow-hidden"><div className="h-full rounded-sm" style={{ width: '95%', background: '#10B981' }}></div></div></div>
                  <div className="flex items-center gap-2 mb-[5px]"><span className="text-[0.58rem] text-[#4a5568] w-[72px] shrink-0">TypeScript</span><div className="flex-1 h-[3px] bg-[rgba(0,0,0,0.08)] rounded-sm overflow-hidden"><div className="h-full rounded-sm" style={{ width: '88%', background: '#7C3AED' }}></div></div></div>
                  <div className="flex items-center gap-2 mb-[5px]"><span className="text-[0.58rem] text-[#4a5568] w-[72px] shrink-0">System Design</span><div className="flex-1 h-[3px] bg-[rgba(0,0,0,0.08)] rounded-sm overflow-hidden"><div className="h-full rounded-sm" style={{ width: '72%', background: '#F59E0B' }}></div></div></div>
                </div>
              </div>
            </div>
          </div>

          {/* Outreach Layer */}
          <div className="grid grid-cols-[1.2fr_1fr] max-md:grid-cols-1 gap-[60px] max-md:gap-8 max-sm:gap-6 items-center max-w-[1100px] mx-auto mb-20">
            <div className={`${mock.container} max-md:order-1`}>
              <div className={mock.bar}><div className="flex gap-[5px]"><span className={mock.dot}></span><span className={mock.dot}></span><span className={mock.dot}></span></div></div>
              <div className={mock.body}>
                <div className={mock.heading}>Outreach Channels</div>
                {/* Channel cards */}
                <div className="grid grid-cols-2 gap-2 mb-3.5">
                  <div className="p-2.5 bg-[#f4f5f7] border border-[rgba(0,0,0,0.08)] rounded-[7px]">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-5 h-5 rounded flex items-center justify-center text-[0.55rem] font-bold" style={{ background: 'rgba(16,185,129,0.2)', color: '#10B981' }}>W</div>
                      <span className="text-[0.68rem] font-semibold text-[#1a1a2e]">WhatsApp</span>
                    </div>
                    <div className="flex justify-between text-[0.55rem] text-[#9ca3af] mb-[3px]"><span>Delivered</span><span className="text-[#4a5568] font-semibold">342</span></div>
                    <div className="flex justify-between text-[0.55rem] text-[#9ca3af] mb-[3px]"><span>Read Rate</span><span className="text-[#4a5568] font-semibold">89%</span></div>
                    <div className="flex justify-between text-[0.55rem] text-[#9ca3af] mb-[3px]"><span>Replies</span><span className="text-[#4a5568] font-semibold">156</span></div>
                  </div>
                  <div className="p-2.5 bg-[#f4f5f7] border border-[rgba(0,0,0,0.08)] rounded-[7px]">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className="w-5 h-5 rounded flex items-center justify-center text-[0.55rem] font-bold" style={{ background: 'rgba(124,58,237,0.2)', color: '#A78BFA' }}>E</div>
                      <span className="text-[0.68rem] font-semibold text-[#1a1a2e]">Email</span>
                    </div>
                    <div className="flex justify-between text-[0.55rem] text-[#9ca3af] mb-[3px]"><span>Sent</span><span className="text-[#4a5568] font-semibold">518</span></div>
                    <div className="flex justify-between text-[0.55rem] text-[#9ca3af] mb-[3px]"><span>Open Rate</span><span className="text-[#4a5568] font-semibold">64%</span></div>
                    <div className="flex justify-between text-[0.55rem] text-[#9ca3af] mb-[3px]"><span>Replies</span><span className="text-[#4a5568] font-semibold">98</span></div>
                  </div>
                </div>
                {/* Sequence steps */}
                <div className="text-[0.6rem] text-[#4a5568] font-medium mb-2.5">Active Sequence: &quot;Senior Dev Outreach&quot;</div>
                <div className="flex items-center">
                  <div className="w-[26px] h-[26px] rounded-full border-2 border-hr-accent flex items-center justify-center text-[0.5rem] font-bold shrink-0 bg-hr-accent text-white">1</div>
                  <div className="flex-1 h-0.5 bg-hr-accent"></div>
                  <div className="w-[26px] h-[26px] rounded-full border-2 border-hr-accent flex items-center justify-center text-[0.5rem] font-bold shrink-0 bg-hr-accent text-white">2</div>
                  <div className="flex-1 h-0.5 bg-hr-accent"></div>
                  <div className="w-[26px] h-[26px] rounded-full border-2 border-hr-accent flex items-center justify-center text-[0.5rem] font-bold text-hr-accent-hover shrink-0 bg-[#f4f5f7]">3</div>
                  <div className="flex-1 h-0.5 bg-[rgba(0,0,0,0.08)]"></div>
                  <div className="w-[26px] h-[26px] rounded-full border-2 border-hr-accent flex items-center justify-center text-[0.5rem] font-bold text-hr-accent-hover shrink-0 bg-[#f4f5f7]">4</div>
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-[0.45rem] text-[#9ca3af] text-center w-[50px]">WhatsApp Intro</span>
                  <span className="text-[0.45rem] text-[#9ca3af] text-center w-[50px]">Email Details</span>
                  <span className="text-[0.45rem] text-[#9ca3af] text-center w-[50px]">Follow-up D3</span>
                  <span className="text-[0.45rem] text-[#9ca3af] text-center w-[50px]">Final Nudge</span>
                </div>
              </div>
            </div>
            <div className="max-md:order-2">
              <div className="font-mono text-[0.62rem] text-hr-text-muted tracking-[0.12em] uppercase mb-2.5">Layer 02 — Outreach</div>
              <h3 className="font-satoshi text-[1.7rem] max-md:text-[1.4rem] font-normal mb-3.5 text-hr-text">Outreach Layer</h3>
              <p className="text-sm text-hr-text-secondary leading-[1.7] mb-[18px]">Multi-channel candidate engagement through WhatsApp and email with automated sequences and templates.</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">WhatsApp</span>
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Email Sequences</span>
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Templates</span>
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Auto Follow-up</span>
              </div>
            </div>
          </div>

          {/* Operations Layer */}
          <div className="grid grid-cols-[1fr_1.2fr] max-md:grid-cols-1 gap-[60px] max-md:gap-8 max-sm:gap-6 items-center max-w-[1100px] mx-auto mb-20">
            <div>
              <div className="font-mono text-[0.62rem] text-hr-text-muted tracking-[0.12em] uppercase mb-2.5">Layer 03 — Operations</div>
              <h3 className="font-satoshi text-[1.7rem] max-md:text-[1.4rem] font-normal mb-3.5 text-hr-text">Operations Layer</h3>
              <p className="text-sm text-hr-text-secondary leading-[1.7] mb-[18px]">End-to-end recruitment workflow management with client portals, invoicing, and team collaboration.</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Client Portal</span>
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Invoicing</span>
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Team Collab</span>
                <span className="text-[0.7rem] text-hr-text-muted py-1 px-3 border border-[rgba(255,255,255,0.08)] rounded-full">Workflows</span>
              </div>
            </div>
            <div className={mock.container}>
              <div className={mock.bar}><div className="flex gap-[5px]"><span className={mock.dot}></span><span className={mock.dot}></span><span className={mock.dot}></span></div></div>
              <div className={mock.body}>
                <div className={mock.heading}>Operations Dashboard</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 bg-[#f4f5f7] border border-[rgba(0,0,0,0.08)] rounded-[7px]">
                    <div className="text-[0.55rem] text-[#9ca3af] uppercase tracking-[0.04em] mb-1.5">Active Jobs</div>
                    <div className="text-[1.3rem] font-bold text-[#1a1a2e]">34</div>
                    <div className="text-[0.52rem] text-[#9ca3af] mt-0.5">8 closing this week</div>
                  </div>
                  <div className="p-3 bg-[#f4f5f7] border border-[rgba(0,0,0,0.08)] rounded-[7px]">
                    <div className="text-[0.55rem] text-[#9ca3af] uppercase tracking-[0.04em] mb-1.5">Revenue MTD</div>
                    <div className="text-[1.3rem] font-bold text-[#1a1a2e]">₹18.4L</div>
                    <div className="text-[0.52rem] mt-0.5 text-hr-green">↑ 23% vs last month</div>
                  </div>
                  <div className="col-span-2 p-3 bg-[#f4f5f7] border border-[rgba(0,0,0,0.08)] rounded-[7px]">
                    <div className="text-[0.55rem] text-[#9ca3af] uppercase tracking-[0.04em] mb-1.5">Recent Invoices</div>
                    <div className="flex items-center justify-between py-[5px] border-b border-[rgba(0,0,0,0.08)] text-[0.55rem]"><span className="text-[#4a5568]">TechCorp India</span><span className="font-mono text-[#1a1a2e] font-medium">₹2,40,000</span><span className="text-[0.45rem] py-[2px] px-1.5 rounded-full font-semibold bg-[rgba(16,185,129,0.12)] text-hr-green">Paid</span></div>
                    <div className="flex items-center justify-between py-[5px] border-b border-[rgba(0,0,0,0.08)] text-[0.55rem]"><span className="text-[#4a5568]">Finova Solutions</span><span className="font-mono text-[#1a1a2e] font-medium">₹1,85,000</span><span className="text-[0.45rem] py-[2px] px-1.5 rounded-full font-semibold bg-[rgba(245,158,11,0.12)] text-hr-yellow">Pending</span></div>
                    <div className="flex items-center justify-between py-[5px] text-[0.55rem]"><span className="text-[#4a5568]">DataBridge Labs</span><span className="font-mono text-[#1a1a2e] font-medium">₹3,20,000</span><span className="text-[0.45rem] py-[2px] px-1.5 rounded-full font-semibold bg-[rgba(16,185,129,0.12)] text-hr-green">Paid</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div></div>
    </div>
  );
};

export default ThreeLayers;
