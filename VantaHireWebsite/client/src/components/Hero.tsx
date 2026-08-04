import { trackEvent } from "@/lib/analytics";
import { btnPrimary, btnSecondary } from "@/lib/shared-styles";

/* â”€â”€ Reusable class-string constants â”€â”€ */
const structuralDiv = "max-md:hidden";
const navItem = "flex items-center gap-2.5 py-[7px] px-4 text-[0.75rem] text-[#9ca3af] cursor-default";
const navItemActive = "flex items-center gap-2.5 py-[7px] px-4 text-[0.75rem] text-[#1a1a2e] bg-[rgba(0,0,0,0.03)] cursor-default";
const navIcon = "text-[0.7rem] w-4 text-center";
const navSubItem = "text-[0.68rem] py-[5px] text-[#9ca3af] cursor-default";
const navSubItemActive = "text-[0.68rem] py-[5px] text-hr-accent-hover cursor-default relative before:content-[''] before:absolute before:-left-4 before:top-1/2 before:-translate-y-1/2 before:w-0.5 before:h-3.5 before:bg-hr-accent before:rounded-sm";
const timeTab = "text-[0.6rem] text-[#9ca3af] py-1 px-2 border border-[rgba(0,0,0,0.08)] -ml-px cursor-default first:rounded-l last:rounded-r";
const timeTabActive = "text-[0.6rem] text-[#9ca3af] py-1 px-2 border border-[rgba(0,0,0,0.08)] -ml-px cursor-default first:rounded-l last:rounded-r text-[#4a5568] bg-[rgba(0,0,0,0.03)]";
const filterBtn = "text-[0.6rem] text-[#9ca3af] py-1 px-2.5 border border-[rgba(0,0,0,0.08)] rounded flex items-center gap-[3px]";
const statCard = "bg-[#f4f5f7] border border-[rgba(0,0,0,0.08)] rounded-lg py-3 px-3.5";
const statLabel = "text-[0.6rem] text-[#9ca3af] flex items-center gap-1.5 mb-1.5";
const statDot = "w-1.5 h-1.5 rounded-full";
const statValue = "text-[1.35rem] font-bold text-[#1a1a2e]";
const stageBox = "text-left";
const stageLabel = "text-[0.58rem] text-[#9ca3af] mb-0.5";
const stageCount = "text-[1.1rem] font-bold text-[#1a1a2e]";
const statChange = "text-[0.55rem] font-semibold ml-1 text-hr-green";
const barCol = "flex-1 flex flex-col items-center h-full justify-end";
const barBase = "w-full rounded-t-sm relative";
const barPct = "absolute -top-3.5 left-1/2 -translate-x-1/2 font-mono text-[0.48rem] text-[#9ca3af]";
const pipelineActionSpan = "text-[0.6rem] text-[#9ca3af] py-[3px] px-2 border border-[rgba(0,0,0,0.08)] rounded cursor-default";
const tableActionSpan = "text-[0.58rem] text-[#9ca3af] py-[3px] px-2 border border-[rgba(0,0,0,0.08)] rounded";
const dataTableRow = "grid grid-cols-[1.5fr_1fr_1fr_1fr_0.7fr] py-2 border-b border-[rgba(0,0,0,0.08)] text-[#4a5568] items-center";
const recruiterName = "flex items-center gap-2";
const recruiterAvatar = "w-[22px] h-[22px] rounded-full flex items-center justify-center text-[0.45rem] font-bold shrink-0";
const metricsTab = "text-[0.62rem] text-[#9ca3af] py-1.5 px-2 cursor-default";
const metricsTabActive = "text-[0.62rem] text-[#4a5568] py-1.5 px-2 cursor-default border-b border-[#4a5568] -mb-px";
const metricGroup = "mb-4";
const metricGroupLabel = "text-[0.6rem] text-[#9ca3af] mb-2 flex items-center gap-1.5";
const metricGroupNum = "font-mono text-[0.52rem]";
const metricItem = "flex items-center gap-2 py-[5px] px-1.5 rounded mb-0.5 text-[0.62rem] text-[#4a5568] hover:bg-[rgba(0,0,0,0.02)]";
const metricLetter = "w-[18px] h-[18px] rounded flex items-center justify-center text-[0.5rem] font-bold font-mono";
const metricArrow = "ml-auto text-[#9ca3af] text-[0.55rem]";
const metricSubLabel = "text-[0.55rem] text-[#9ca3af] mb-1";

const Hero = () => {
  const openCalendar = () => {
    trackEvent("cta_click", { location: "home_hero", action: "book_demo" });
    window.open('https://cal.com/puneet-kumar-2845nx/demo-ealana', '_blank');
  };

  return (
    <>
      {/* Hero Grid */}
      <div className="grid grid-cols-[28px_1fr_120px_auto_120px_1fr_28px] max-md:flex max-md:flex-col min-h-auto pt-[60px] pb-0">
        <div className={structuralDiv}></div>
        <div className={structuralDiv}></div>
        <div className={structuralDiv}></div>
        <div className="border-b-0 flex flex-col items-center justify-start text-center pt-[120px] px-10 pb-0 animate-hr-fade-up max-md:pt-[80px] max-md:px-5">
          <div className="inline-block relative font-mono text-xs font-normal text-hr-text-secondary tracking-[0.14em] uppercase mb-9 py-2.5 px-6 border border-dashed border-[rgba(255,255,255,0.18)] max-sm:text-[0.52rem] max-sm:tracking-[0.1em] max-sm:py-[7px] max-sm:px-3">
            <span className="absolute w-2.5 h-2.5 border-[rgba(255,255,255,0.35)] border-solid border-t-2 border-l-2 border-r-0 border-b-0 -top-1 -left-1"></span>
            <span className="absolute w-2.5 h-2.5 border-[rgba(255,255,255,0.35)] border-solid border-t-2 border-r-2 border-l-0 border-b-0 -top-1 -right-1"></span>
            <span className="absolute w-2.5 h-2.5 border-[rgba(255,255,255,0.35)] border-solid border-b-2 border-l-2 border-t-0 border-r-0 -bottom-1 -left-1"></span>
            <span className="absolute w-2.5 h-2.5 border-[rgba(255,255,255,0.35)] border-solid border-b-2 border-r-2 border-t-0 border-l-0 -bottom-1 -right-1"></span>
            THE NEURAL OS FOR TALENT
          </div>

          <h1 className="font-satoshi text-[clamp(2.8rem,5.5vw,4rem)] max-md:text-[clamp(2rem,8vw,2.8rem)] max-sm:text-[1.85rem] font-normal leading-[1.15] tracking-tight text-hr-text mb-7">Make better hires, faster.</h1>

          <p className="text-base leading-[1.7] text-hr-text-secondary max-w-[520px] mx-auto mb-9 font-normal max-md:text-[0.88rem]">
            ealana is the Neural OS for Talent — it understands who you're looking for, remembers every candidate, and runs your outreach.
          </p>

          <div className="flex items-center justify-center gap-3 mb-[18px] max-md:flex-col max-md:w-full">
            <a
              href="/recruiter-auth"
              className={btnPrimary}
              onClick={(e) => {
                e.preventDefault();
                trackEvent("cta_click", { location: "home_hero", action: "get_started" });
                window.location.href = '/recruiter-auth';
              }}
            >
              Get started
            </a>
            <button className={btnSecondary} onClick={openCalendar}>
              Book a demo
            </button>
          </div>
        </div>
        <div className={structuralDiv}></div>
        <div className={structuralDiv}></div>
        <div className={structuralDiv}></div>
      </div>

      {/* Product Screenshot */}
      <div className="grid grid-cols-[28px_1fr_28px] max-md:grid-cols-[0px_1fr_0px] relative z-[2] mt-[60px] max-sm:mt-7 max-h-[420px] max-sm:max-h-[220px] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_0%,#000_60%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_0%,#000_60%,transparent_100%)]">
        <div></div>
        <div className="bg-[linear-gradient(180deg,#0C0C10_0%,#1a1428_30%,#241a3a_50%,#1a1428_70%,#0C0C10_100%)] px-12 max-sm:px-2">
          <div className="max-w-[1040px] mx-auto rounded-[10px] overflow-hidden border border-[rgba(0,0,0,0.1)] shadow-[0_40px_100px_rgba(0,0,0,0.15)] bg-white animate-hr-fade-up-delayed">
            <div className="flex items-center py-2.5 px-4 bg-[#f1f3f5] border-b border-[rgba(0,0,0,0.08)] gap-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[rgba(0,0,0,0.1)]"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-[rgba(0,0,0,0.1)]"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-[rgba(0,0,0,0.1)]"></span>
              </div>
              <div className="flex-1 text-center font-mono text-[0.65rem] text-[#9ca3af]">app.ealana.com / Analytics / Pipeline Intelligence</div>
              <div className="flex gap-1.5 items-center">
                <span className="text-[0.6rem] text-[#9ca3af] py-[3px] px-2 border border-[rgba(0,0,0,0.08)] rounded-[3px] flex items-center gap-1">â†— Share</span>
                <span className="text-[0.6rem] text-[#9ca3af]">â˜†</span>
                <span className="text-[0.6rem] text-[#9ca3af]">âš¡</span>
                <span className="text-[0.6rem] text-[#9ca3af]">â›¶</span>
                <span className="text-[0.6rem] text-[#9ca3af]">â‹¯</span>
              </div>
            </div>
            <div className="flex min-h-[480px]">
              {/* Sidebar */}
              <div className="w-[190px] bg-[#f7f8fa] border-r border-[rgba(0,0,0,0.08)] py-3.5 shrink-0 max-md:hidden">
                <div className="px-4 pb-3.5 pt-0.5 font-bold text-[0.82rem] text-[#1a1a2e] flex items-center gap-2 border-b border-[rgba(0,0,0,0.08)] mb-1.5">
                  <span className="w-5 h-5 bg-hr-accent rounded-[5px] flex items-center justify-center text-[0.55rem] font-extrabold text-white">V</span>
                  ealana
                </div>
                <div className="mx-3 my-2 py-[5px] px-2.5 text-[0.65rem] text-[#4a5568] border border-[rgba(0,0,0,0.08)] rounded-[5px] bg-transparent flex items-center justify-between">
                  FlowHire [INT] <span className="text-[#9ca3af] text-[0.5rem]">â‡…</span>
                </div>
                <div className={navItem}><span className={navIcon}>âŒ‚</span> Home</div>
                <div className={navItem}><span className={navIcon}>ðŸ‘¤</span> Candidates</div>
                <div className={navItem}><span className={navIcon}>ðŸ”</span> Sourcing</div>
                <div className={navItem}><span className={navIcon}>ðŸ“¨</span> Outreach</div>
                <div className={navItem}><span className={navIcon}>ðŸŽ¤</span> Interviews</div>
                <div className={navItem}><span className={navIcon}>ðŸ“Š</span> Reports</div>
                <div className={navItemActive}><span className={navIcon}>ðŸ“ˆ</span> Analytics</div>
                <div className="pl-10">
                  <div className={navSubItemActive}>Pipeline Intelligence</div>
                  <div className={navSubItem}>Team Performance</div>
                </div>
                <div className="h-px bg-[rgba(0,0,0,0.08)] my-2"></div>
                <div className={navItem}><span className={navIcon}>âš™</span> Settings</div>
                <div className={navItem}><span className={navIcon}>ðŸ”—</span> Integrations</div>
                <div className={navItem}><span className={navIcon}>ðŸ”’</span> Permissions</div>
                <div className={navItem}><span className={navIcon}>âš¡</span> Automations</div>
              </div>

              {/* Main */}
              <div className="flex-1 py-4 px-5 overflow-hidden min-w-0 bg-white">
                <div className="flex items-center justify-between mb-3.5">
                  <div className="text-[0.72rem] text-[#9ca3af]">Analytics / <span className="text-[#4a5568]">Pipeline Intelligence</span></div>
                </div>

                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <div className="font-mono text-[0.62rem] text-[#4a5568] py-[5px] px-2.5 border border-[rgba(0,0,0,0.08)] rounded flex items-center gap-1.5">ðŸ“… Mar 1, 2026 - Mar 21, 2026 â‡…</div>
                  <div className="flex">
                    <div className={timeTab}>Today</div>
                    <div className={timeTab}>Yesterday</div>
                    <div className={timeTabActive}>7D</div>
                    <div className={timeTab}>1M</div>
                    <div className={timeTab}>3M</div>
                    <div className={timeTab}>6M</div>
                  </div>
                  <div className="ml-auto flex gap-1.5">
                    <div className={filterBtn}># Metric â–¾</div>
                    <div className={filterBtn}>Exclude â–¾</div>
                    <div className={filterBtn}>Compare â–¾</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 max-lg:grid-cols-2 gap-3 mb-[18px]">
                  <div className={statCard}>
                    <div className={statLabel}><span className={statDot} style={{ background: '#7C3AED' }}></span> Candidates Added</div>
                    <div className={statValue}>124</div>
                  </div>
                  <div className={statCard}>
                    <div className={statLabel}><span className={statDot} style={{ background: '#10B981' }}></span> Outreach open rate</div>
                    <div className={statValue}>62%</div>
                  </div>
                  <div className={statCard}>
                    <div className={statLabel}><span className={statDot} style={{ background: '#EF4444' }}></span> Time to 1st Response</div>
                    <div className={statValue}>1.8 days</div>
                  </div>
                  <div className={statCard}>
                    <div className={statLabel}><span className={statDot} style={{ background: '#06B6D4' }}></span> Offers Accepted</div>
                    <div className={statValue}>39</div>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-3.5">
                  <span className="text-[0.8rem] font-semibold text-[#1a1a2e]">Pipeline Overview</span>
                  <div className="flex gap-2">
                    <span className={pipelineActionSpan}>âœ¨ AI Insights</span>
                    <span className={pipelineActionSpan}>Export â†—</span>
                  </div>
                </div>

                <div className="grid grid-cols-5 gap-2 mb-3.5">
                  <div className={stageBox}>
                    <div className={stageLabel}>Sourced</div>
                    <div className={stageCount}>320 <span className={statChange}>+67%</span></div>
                  </div>
                  <div className={stageBox}>
                    <div className={stageLabel}>Contacted</div>
                    <div className={stageCount}>210</div>
                  </div>
                  <div className={stageBox}>
                    <div className={stageLabel}>Interviewed</div>
                    <div className={stageCount}>44</div>
                  </div>
                  <div className={stageBox}>
                    <div className={stageLabel}>Offer</div>
                    <div className={stageCount}>14 <span className={statChange}>+31%</span></div>
                  </div>
                  <div className={stageBox}>
                    <div className={stageLabel}>Hired</div>
                    <div className={stageCount}>9 <span className={statChange}>+12%</span></div>
                  </div>
                </div>

                <div className="flex items-end gap-2 h-20 mb-[18px]">
                  <div className={barCol}><div className={barBase} style={{ height: '85%', background: 'rgba(59,91,219,0.5)' }}><span className={barPct}>66%</span></div></div>
                  <div className={barCol}><div className={barBase} style={{ height: '40%', background: 'rgba(59,91,219,0.4)' }}><span className={barPct}>11%</span></div></div>
                  <div className={barCol}><div className={barBase} style={{ height: '38%', background: 'rgba(59,91,219,0.4)' }}><span className={barPct}>10%</span></div></div>
                  <div className={barCol}><div className={barBase} style={{ height: '52%', background: 'rgba(59,91,219,0.45)' }}><span className={barPct}>32%</span></div></div>
                  <div className={barCol}><div className={barBase} style={{ height: '75%', background: 'rgba(59,91,219,0.55)' }}><span className={barPct}>64%</span></div></div>
                </div>

                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[0.78rem] font-semibold text-[#1a1a2e]">Pipeline Impact</span>
                  <div className="flex gap-1.5">
                    <span className={tableActionSpan}>ðŸ” Search</span>
                    <span className={tableActionSpan}>âš¡ Filters â–¾</span>
                    <span className={tableActionSpan}>Export â†—</span>
                  </div>
                </div>

                <div className="w-full text-[0.65rem]">
                  <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_0.7fr] py-1.5 border-b border-[rgba(0,0,0,0.08)] text-[#9ca3af] font-medium">
                    <span>Recruiter</span>
                    <span>Candidates</span>
                    <span>Conversion Rate</span>
                    <span>Avg Stage Time</span>
                    <span>Hires</span>
                  </div>
                  <div className={dataTableRow}>
                    <span className={recruiterName}><span className={recruiterAvatar} style={{ background: 'rgba(124,58,237,0.2)', color: '#A78BFA' }}>SL</span> Sarah Lee</span>
                    <span>84</span>
                    <span>18%</span>
                    <span>2.1 days</span>
                    <span>6</span>
                  </div>
                  <div className={dataTableRow}>
                    <span className={recruiterName}><span className={recruiterAvatar} style={{ background: 'rgba(16,185,129,0.2)', color: '#10B981' }}>JS</span> James Smith</span>
                    <span>92</span>
                    <span>22%</span>
                    <span>1.5 days</span>
                    <span>5</span>
                  </div>
                  <div className={dataTableRow}>
                    <span className={recruiterName}><span className={recruiterAvatar} style={{ background: 'rgba(245,158,11,0.2)', color: '#F59E0B' }}>EJ</span> Emily Johnson</span>
                    <span>78</span>
                    <span>15%</span>
                    <span>3.2 days</span>
                    <span>8</span>
                  </div>
                </div>
              </div>

              {/* Metrics Panel */}
              <div className="w-[210px] bg-[#f7f8fa] border-l border-[rgba(0,0,0,0.08)] p-4 shrink-0 overflow-hidden max-lg:hidden">
                <div className="flex mb-3.5 border-b border-[rgba(0,0,0,0.08)]">
                  <div className={metricsTabActive}>Query</div>
                  <div className={metricsTab}>Chart</div>
                  <div className={metricsTab}>Annotations</div>
                </div>

                <div className="text-[0.72rem] font-semibold text-[#1a1a2e] mb-2.5 flex items-center justify-between">
                  Metrics <span className="text-[0.8rem] text-[#9ca3af] cursor-default">+</span>
                </div>

                <div className={metricGroup}>
                  <div className={metricGroupLabel}><span className={metricGroupNum}>1</span> Pipeline conversion</div>
                  <div className={metricItem}>
                    <span className={metricLetter} style={{ background: 'rgba(124,58,237,0.2)', color: '#A78BFA' }}>A</span>
                    Candidate Added
                    <span className={metricArrow}>â€º</span>
                  </div>
                  <div className={metricItem}>
                    <span className={metricLetter} style={{ background: 'rgba(16,185,129,0.2)', color: '#10B981' }}>B</span>
                    Outreach Sent
                    <span className={metricArrow}>â€º</span>
                  </div>
                  <div className={metricItem}>
                    <span className={metricLetter} style={{ background: 'rgba(245,158,11,0.2)', color: '#F59E0B' }}>C</span>
                    Reply Received
                    <span className={metricArrow}>â€º</span>
                  </div>
                  <div className={metricItem}>
                    <span className={metricLetter} style={{ background: 'rgba(6,182,212,0.2)', color: '#06B6D4' }}>D</span>
                    Interview Completed
                    <span className={metricArrow}>â€º</span>
                  </div>
                  <div className={metricItem}>
                    <span className={metricLetter} style={{ background: 'rgba(139,92,246,0.2)', color: '#8B5CF6' }}>E</span>
                    Offer Accepted
                    <span className={metricArrow}>â€º</span>
                  </div>
                  <div className="flex gap-2 mt-2 px-1.5">
                    <span className="text-[0.52rem] text-[#9ca3af] py-0.5 px-1.5 border border-[rgba(0,0,0,0.08)] rounded-[3px]"># User â–¾</span>
                    <span className="text-[0.52rem] text-[#9ca3af] py-0.5 px-1.5 border border-[rgba(0,0,0,0.08)] rounded-[3px]">Uniques â–¾</span>
                  </div>
                </div>

                <div className={metricGroup}>
                  <div className={metricGroupLabel}><span className={metricGroupNum}>2</span> Outreach engagement</div>
                  <div className={`${metricSubLabel} px-1.5`}>Event: <span className="text-[#4a5568]">Event Count</span></div>
                  <div className={metricItem}>
                    <span className={metricLetter} style={{ background: 'rgba(124,58,237,0.2)', color: '#A78BFA' }}>ðŸ“§</span>
                    Email Opened
                    <span className={metricArrow}>â€º</span>
                  </div>
                  <div className="p-1.5 text-[0.52rem] text-[#9ca3af] flex items-center gap-1">
                    âŠ• Add Event
                  </div>
                  <div className="flex gap-2 px-1.5">
                    <span className="text-[0.52rem] text-[#9ca3af] py-0.5 px-1.5 border border-[rgba(0,0,0,0.08)] rounded-[3px]">Breakdown â–¾</span>
                    <span className="text-[0.52rem] text-[#9ca3af] py-0.5 px-1.5 border border-[rgba(0,0,0,0.08)] rounded-[3px]">Recruiter â–¾</span>
                  </div>
                </div>

                <div className={metricGroup}>
                  <div className={metricGroupLabel}><span className={metricGroupNum}>3</span> Hiring Speed</div>
                  <div className="px-1.5">
                    <div className={metricSubLabel}>Time Between Events</div>
                    <div className="text-[0.52rem] text-[#4a5568] py-1 px-2 border border-[rgba(0,0,0,0.08)] rounded-[3px] mt-1">From: Outreach Sent</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div></div>
      </div>

      {/* Grid separator */}
      <div className="w-full h-0 border-t border-[rgba(255,255,255,0.07)]"></div>
    </>
  );
};

export default Hero;
