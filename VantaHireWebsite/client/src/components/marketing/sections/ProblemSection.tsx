// @charset "utf-8"
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface Candidate {
  name: string;
  role: string;
  tag: string;
  tagColor: string;
}

interface NotificationItem {
  text: string;
  time: string;
  color: string;
}

type Phase = "idle" | "triggered" | "unlocked";

const CANDIDATES: Candidate[] = [
  { name: "Rahul Mehta", role: "Sr. Frontend Dev", tag: "NOT REVIEWED", tagColor: "#EF4444" },
  { name: "Priya Sharma", role: "Product Designer", tag: "DUPLICATE", tagColor: "#F5C842" },
  { name: "Arjun K.", role: "Backend Engineer", tag: "NOT REVIEWED", tagColor: "#EF4444" },
  { name: "Sneha Patel", role: "ML Engineer", tag: "MAYBE", tagColor: "#8891AA" },
  { name: "Vikram Nair", role: "DevOps Lead", tag: "NOT REVIEWED", tagColor: "#EF4444" },
  { name: "Divya Rao", role: "UX Researcher", tag: "CONTACTED", tagColor: "#34D17A" },
  { name: "Karthik M.", role: "Data Scientist", tag: "NOT REVIEWED", tagColor: "#EF4444" },
  { name: "Ananya Singh", role: "Growth Marketer", tag: "DUPLICATE", tagColor: "#F5C842" },
  { name: "Rohan Das", role: "Full Stack Dev", tag: "NOT REVIEWED", tagColor: "#EF4444" },
  { name: "Meera Iyer", role: "Product Manager", tag: "MAYBE", tagColor: "#8891AA" },
  { name: "Suresh Kumar", role: "iOS Developer", tag: "NOT REVIEWED", tagColor: "#EF4444" },
  { name: "Pooja Verma", role: "Content Strategist", tag: "NOT REVIEWED", tagColor: "#EF4444" },
];

const NOTIFICATIONS: NotificationItem[] = [
  { text: "Hiring manager left feedback on Slack", time: "2m ago", color: "#4B8EF0" },
  { text: "Spreadsheet v12_FINAL_v2 updated", time: "5m ago", color: "#F5C842" },
  { text: "47 new LinkedIn requests pending", time: "8m ago", color: "#EF4444" },
  { text: "Interview no-show: 3rd this week", time: "12m ago", color: "#EF4444" },
  { text: "ATS sync failed again", time: "15m ago", color: "#EF4444" },
];

const TABS = ["Search Tab 01 (84)", "ATS Backlog (23)", "Outreach.xlsx", "Naukri (127)", "LinkedIn", "WhatsApp", "Feedback Form"];

export function ProblemSection() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [paused, setPaused] = useState(false);
  const [, setScrollCount] = useState(0);
  const wheelHandlerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unlock = () => {
      document.body.style.overflow = "";
    };
    const removeListener = () => {
      if (wheelHandlerRef.current) {
        window.removeEventListener("wheel", wheelHandlerRef.current);
        wheelHandlerRef.current = null;
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && phase === "idle") {
          document.body.style.overflow = "hidden";
          let count = 0;
          const onWheel = () => {
            count += 1;
            setScrollCount(count);
            if (count >= 5) {
              setPaused(true);
              setPhase("triggered");
              removeListener();
              setTimeout(() => {
                unlock();
              }, 2500);
            }
          };
          wheelHandlerRef.current = onWheel;
          window.addEventListener("wheel", onWheel);
        }
      },
      { threshold: 1.0 },
    );
    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }
    return () => {
      observer.disconnect();
      removeListener();
      unlock();
    };
  }, [phase]);

  const triggered = phase === "triggered" || phase === "unlocked";

  return (
    <section
      style={{
        padding: "140px 0",
        paddingBottom: triggered ? "120px" : "140px",
        marginBottom: triggered ? "-200px" : "0",
        transition: "margin 1s ease, padding 1s ease",
      }}
    >
      <div style={{ maxWidth: 1300, margin: "0 auto", paddingLeft: "4rem", paddingRight: "4rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <span
            className="font-mono"
            style={{
              fontSize: "0.62rem",
              letterSpacing: "0.14em",
              color: "#4B8EF0",
              textTransform: "uppercase",
            }}
          >
            The Problem
          </span>
          <div style={{ height: 1, background: "#4B8EF0", opacity: 0.2, flex: 1 }} />
        </div>

        <motion.h2
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7 }}
          className="font-display"
          style={{
            fontSize: "clamp(2.4rem,5vw,3.8rem)",
            lineHeight: 1.15,
            color: "#F4F5FA",
            maxWidth: 680,
            marginBottom: 16,
          }}
        >
          This is what recruiting
          <br />
          <em>looks like today</em>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="font-body"
          style={{
            fontSize: "1rem",
            color: "#8891AA",
            fontWeight: 300,
            maxWidth: 500,
            lineHeight: 1.75,
            marginBottom: 48,
          }}
        >
          You already know this routine. Tools give you volume, not signal. Nothing remembers.
          Nothing connects.
        </motion.p>

        <motion.div
          ref={sectionRef}
          initial={{ opacity: 0, scale: 0.9, y: 60 }}
          whileInView={{ opacity: 1, scale: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: "relative", borderRadius: 20, overflow: "hidden" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 10,
              padding: "0 4px",
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#EF4444",
                boxShadow: "0 0 8px rgba(239,68,68,0.7)",
                animation: "badge-pulse 1.2s ease-in-out infinite",
                animationPlayState: paused ? "paused" : "running",
              }}
            />
            <span
              className="font-mono"
              style={{
                fontSize: "0.6rem",
                color: "#8891AA",
                letterSpacing: "0.1em",
              }}
            >
              RECRUITER DASHBOARD · Monday 9:14 AM
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {["🔴 47 unread", "📋 127 to review", "⚠️ 3 errors"].map((text) => (
                <span
                  key={text}
                  className="font-mono"
                  style={{
                    fontSize: "0.52rem",
                    color: "#EF4444",
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.15)",
                    borderRadius: 4,
                    padding: "2px 7px",
                  }}
                >
                  {text}
                </span>
              ))}
            </div>
          </div>

          <div
            style={{
              background: "#F8F9FC",
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 20,
              boxShadow: "0 40px 120px rgba(0,0,0,0.7)",
              overflow: "hidden",
              transition: "filter 1.2s ease, opacity 1.2s ease",
              filter: phase === "triggered" || phase === "unlocked" ? "blur(6px)" : "none",
              opacity: phase === "triggered" || phase === "unlocked" ? 0.1 : 1,
            }}
          >
            <div
              style={{
                height: 40,
                background: "#EDEEF2",
                borderBottom: "1px solid rgba(0,0,0,0.08)",
                display: "flex",
                alignItems: "center",
                padding: "0 14px",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", gap: 5 }}>
                {["#EF4444", "#F5C842", "#34D17A"].map((color) => (
                  <div key={color} style={{ width: 9, height: 9, borderRadius: "50%", background: color, opacity: 0.7 }} />
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 2,
                  marginLeft: 8,
                  flex: 1,
                  overflow: "hidden",
                  background: "#F1F2F6",
                  borderBottom: "1px solid rgba(0,0,0,0.08)",
                }}
              >
                {TABS.map((tab, index) => (
                  <div
                    key={tab}
                    style={{
                      background: "rgba(0,0,0,0.04)",
                      border: "1px solid rgba(0,0,0,0.08)",
                      borderBottom: index === 0 ? "1px solid #F1F2F6" : "1px solid rgba(0,0,0,0.08)",
                      borderRadius: "4px 4px 0 0",
                      padding: "4px 10px",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: "0.54rem",
                      color: "#6B7280",
                    }}
                  >
                    {tab}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 0.9fr", minHeight: 440 }}>
              <div style={{ borderRight: "1px solid rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                    background: "#F1F2F6",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span className="font-mono" style={{ fontSize: "0.58rem", color: "#EF4444" }}>
                    4,847 results
                  </span>
                  <span className="font-mono" style={{ fontSize: "0.52rem", color: "#3D4460" }}>
                    0 ranked
                  </span>
                </div>
                {CANDIDATES.map((candidate, index) => (
                  <div
                    key={candidate.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      borderBottom: "1px solid rgba(0,0,0,0.06)",
                      background: "#FFFFFF",
                      animation: `badge-pulse ${2 + index * 0.15}s ease-in-out infinite`,
                      animationPlayState: paused ? "paused" : "running",
                    }}
                  >
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        flexShrink: 0,
                        background: `rgba(${index % 2 === 0 ? "75,142,240" : "52,209,122"},0.15)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: "0.48rem",
                        color: index % 2 === 0 ? "#4B8EF0" : "#34D17A",
                      }}
                    >
                      {candidate.name
                        .split(" ")
                        .map((namePart) => namePart[0])
                        .join("")}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        className="font-body"
                        style={{
                          fontSize: "0.7rem",
                          color: "#374151",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {candidate.name}
                      </div>
                      <div className="font-mono" style={{ fontSize: "0.52rem", color: "#6B7280" }}>
                        {candidate.role}
                      </div>
                    </div>
                    <div
                      style={{
                        background: `${candidate.tagColor}18`,
                        color: candidate.tagColor,
                        borderRadius: 4,
                        padding: "2px 6px",
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: "0.44rem",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {candidate.tag}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ borderRight: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    padding: "8px 14px",
                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                    background: "#F1F2F6",
                    display: "flex",
                    gap: 6,
                  }}
                >
                  {["Sourced", "Contacted", "Interviewing", "Offer"].map((stage) => (
                    <div
                      key={stage}
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 5,
                        padding: "3px 8px",
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: "0.52rem",
                        color: "#6B7280",
                      }}
                    >
                      {stage}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "2rem",
                  }}
                >
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      marginBottom: 12,
                      background: "#FFFFFF",
                      border: "1px solid rgba(0,0,0,0.08)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.4rem",
                    }}
                  >
                    📭
                  </div>
                  <div className="font-mono" style={{ fontSize: "0.65rem", color: "#9CA3AF", marginBottom: 4 }}>
                    0 candidates
                  </div>
                  <div
                    className="font-mono"
                    style={{ fontSize: "0.52rem", color: "#9CA3AF", opacity: 0.6, textAlign: "center" }}
                  >
                    Recruiter left · Start new search
                  </div>
                  <div
                    style={{
                      marginTop: 20,
                      padding: "10px 16px",
                      background: "#FFFFFF",
                      border: "1px dashed rgba(0,0,0,0.1)",
                      borderRadius: 8,
                      textAlign: "center",
                    }}
                  >
                    <div className="font-mono" style={{ fontSize: "0.55rem", color: "#6B7280" }}>
                      outreach_tracker_v12_FINAL.xlsx
                    </div>
                    <div className="font-mono" style={{ fontSize: "0.5rem", color: "#EF4444", marginTop: 4 }}>
                      ⚠ Out of sync with ATS
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid rgba(0,0,0,0.08)",
                    background: "#F1F2F6",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span className="font-mono" style={{ fontSize: "0.58rem", color: "#374151" }}>
                    Notifications
                  </span>
                  <span
                    style={{
                      background: "#EF4444",
                      color: "white",
                      borderRadius: 100,
                      fontFamily: "'JetBrains Mono',monospace",
                      fontSize: "0.48rem",
                      padding: "1px 6px",
                      animation: "badge-pulse 1.2s ease-in-out infinite",
                      animationPlayState: paused ? "paused" : "running",
                    }}
                  >
                    47
                  </span>
                </div>
                {NOTIFICATIONS.map((notification, index) => (
                  <div
                    key={`${notification.text}-${index}`}
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid rgba(0,0,0,0.06)",
                      borderLeft: `2px solid ${notification.color}`,
                      animation: `badge-pulse ${1.5 + index * 0.4}s ease-in-out infinite`,
                      animationPlayState: paused ? "paused" : "running",
                    }}
                  >
                    <div className="font-body" style={{ fontSize: "0.65rem", color: "#4B5563", lineHeight: 1.4 }}>
                      {notification.text}
                    </div>
                    <div className="font-mono" style={{ fontSize: "0.5rem", color: "#9CA3AF", marginTop: 3 }}>
                      {notification.time}
                    </div>
                  </div>
                ))}
                <div
                  style={{
                    margin: 12,
                    padding: "10px 12px",
                    background: "rgba(239,68,68,0.06)",
                    border: "1px solid rgba(239,68,68,0.15)",
                    borderRadius: 8,
                  }}
                >
                  <div className="font-mono" style={{ fontSize: "0.55rem", color: "#EF4444", marginBottom: 4 }}>
                    ⚠ ATS Sync Failed
                  </div>
                  <div className="font-mono" style={{ fontSize: "0.5rem", color: "#3D4460" }}>
                    Last sync: 3 days ago
                  </div>
                </div>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {(phase === "triggered" || phase === "unlocked") && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.9 }}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "radial-gradient(ellipse at center, rgba(8,10,20,0.96) 0%, rgba(8,10,20,0.99) 100%)",
                  borderRadius: 0,
                  border: "none",
                  outline: "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 0,
                    position: "relative",
                    padding: "3rem 2rem",
                  }}
                >
                  <motion.div
                    initial={{ scaleX: 0, opacity: 0 }}
                    animate={{ scaleX: 1, opacity: 1 }}
                    transition={{ duration: 0.8, delay: 0.15 }}
                    style={{
                      height: 1,
                      width: 80,
                      background: "linear-gradient(90deg, transparent, rgba(75,142,240,0.6), transparent)",
                      marginBottom: "1.5rem",
                    }}
                  />

                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    style={{ position: "relative", marginBottom: "2rem" }}
                  >
                    <p
                      className="font-display"
                      style={{
                        fontStyle: "italic",
                        fontSize: "clamp(3rem,5.5vw,5rem)",
                        color: "#F4F5FA",
                        letterSpacing: "-0.025em",
                        textAlign: "center",
                        lineHeight: 1.1,
                      }}
                    >
                      There&apos;s a better way.
                    </p>

                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", borderRadius: 4 }}>
                      <motion.div
                        initial={{ x: "-100%" }}
                        animate={{ x: "250%" }}
                        transition={{ duration: 1, delay: 0.7, ease: "easeInOut" }}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "60%",
                          height: "100%",
                          background:
                            "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0.08) 60%, transparent 100%)",
                        }}
                      />
                    </div>

                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
                      {Array.from({ length: 16 }).map((_, index) => {
                        const rad = (index * 22.5 * Math.PI) / 180;
                        return (
                          <motion.div
                            key={index}
                            initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                            animate={{
                              x: Math.cos(rad) * (60 + index * 8),
                              y: Math.sin(rad) * (40 + index * 5),
                              opacity: [0, 1, 1, 0],
                              scale: [0, 1, 1, 0],
                            }}
                            transition={{ duration: 1.4, delay: 0.65 + index * 0.04, ease: "easeOut" }}
                            style={{
                              position: "absolute",
                              top: "50%",
                              left: "50%",
                              width: 3,
                              height: 3,
                              borderRadius: "50%",
                              background: index % 2 === 0 ? "#4B8EF0" : "#34D17A",
                            }}
                          />
                        );
                      })}
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.7, delay: 1.1, ease: [0.16, 1, 0.3, 1] }}
                    style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem", position: "relative" }}
                  >
                    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <motion.div
                        animate={{ opacity: [0.4, 0.8, 0.4] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                        style={{
                          position: "absolute",
                          width: 80,
                          height: 80,
                          borderRadius: "50%",
                          background:
                            "radial-gradient(circle, rgba(75,142,240,0.25) 0%, rgba(52,209,122,0.12) 50%, transparent 70%)",
                          filter: "blur(16px)",
                        }}
                      />
                      <svg width="56" height="62" viewBox="0 0 120 132" fill="none">
                        <path d="M60 52 C50 28,18 18,8 38 C0 54,18 72,60 70 Z" fill="#4B8EF0" opacity={0.95} />
                        <path d="M60 70 C38 76,16 85,20 98 C24 108,46 100,60 86 Z" fill="#4B8EF0" opacity={0.5} />
                        <path d="M60 52 C70 28,102 18,112 38 C120 54,102 72,60 70 Z" fill="#34D17A" opacity={0.95} />
                        <path d="M60 70 C82 76,104 85,100 98 C96 108,74 100,60 86 Z" fill="#34D17A" opacity={0.5} />
                        <ellipse cx="60" cy="68" rx="4" ry="20" fill="#0D0F1E" />
                        <circle cx="60" cy="60" r="4.5" fill="#F5C842" />
                        <circle cx="60" cy="60" r="2" fill="rgba(255,255,255,0.5)" />
                        <path d="M58 50 C55 38,46 30,40 22" stroke="#3D4460" strokeWidth="1" strokeLinecap="round" fill="none" />
                        <path d="M62 50 C65 38,74 30,80 22" stroke="#3D4460" strokeWidth="1" strokeLinecap="round" fill="none" />
                        <circle cx="40" cy="22" r="2" fill="#3D4460" />
                        <circle cx="80" cy="22" r="2" fill="#3D4460" />
                      </svg>
                    </div>
                  </motion.div>

                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.7, delay: 1.5 }}
                    className="font-display"
                    style={{
                      fontStyle: "italic",
                      fontSize: "1.3rem",
                      color: "rgba(255,255,255,0.65)",
                      textShadow: "0 0 30px rgba(75,142,240,0.35)",
                    }}
                  >
                    Meet ealana →
                  </motion.p>

                  <motion.div
                    initial={{ scaleX: 0, opacity: 0 }}
                    animate={{ scaleX: 1, opacity: 1 }}
                    transition={{ duration: 0.8, delay: 1.6 }}
                    style={{
                      height: 1,
                      width: 80,
                      background: "linear-gradient(90deg, transparent, rgba(52,209,122,0.6), transparent)",
                      marginTop: "1.5rem",
                    }}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </section>
  );
}

export default ProblemSection;
