// @charset "utf-8"
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";

const TABS = ["Outreach", "Pipeline", "Schedule", "Feedback"] as const;
type TabName = (typeof TABS)[number];
type StageCardStyle = {
  borderColor?: string;
  background?: string;
};

const bullets = [
  "Email outreach with delivery tracking",
  "WhatsApp status updates to staged candidates",
  "Recruiter dashboard — every job, every candidate, every stage",
  "Client feedback portal for hiring manager input",
  "Self-serve interview scheduling with calendar links",
];

const tabAnim = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.25 },
};

function OutreachTab() {
  const rows = [
    { icon: "💬", name: "Arjun Krishnamurthy", detail: "WhatsApp · Interview invite · Read ✓✓", badge: "Delivered", badgeBg: "rgba(52,209,122,0.12)", badgeColor: "#34D17A" },
    { icon: "📧", name: "Priya Venkatesh", detail: "Email · Role details + calendar link · Opened", badge: "Opened", badgeBg: "rgba(75,142,240,0.12)", badgeColor: "#4B8EF0" },
    { icon: "📅", name: "Rohit Sharma", detail: "Interview · Tomorrow 3:00 PM · Google Meet", badge: "Scheduled", badgeBg: "rgba(245,200,66,0.12)", badgeColor: "#F5C842" },
  ];
  return (
    <div>
      {rows.map((row) => (
        <div
          key={row.name}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(0,0,0,0.05)", cursor: "pointer", transition: "background 0.2s" }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "#FFFFFF";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "transparent";
          }}
        >
          <span style={{ fontSize: "1rem", flexShrink: 0 }}>{row.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: "0.78rem", fontWeight: 500, color: "#111827" }}>{row.name}</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#4B5563", marginTop: 2 }}>{row.detail}</div>
          </div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.58rem", background: row.badgeBg, color: row.badgeColor, borderRadius: 100, padding: "3px 9px", flexShrink: 0 }}>
            {row.badge}
          </div>
        </div>
      ))}
      <div style={{ margin: "12px 14px", background: "rgba(245,200,66,0.04)", border: "1px solid rgba(245,200,66,0.15)", borderRadius: 10, padding: "12px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", color: "#F5C842", letterSpacing: "0.1em" }}>COMPOSE</span>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", background: "rgba(245,200,66,0.1)", border: "1px solid rgba(245,200,66,0.3)", color: "#F5C842", borderRadius: 4, padding: "2px 8px" }}>WhatsApp</span>
            <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.07)", color: "#9CA3AF", borderRadius: 4, padding: "2px 8px" }}>Email</span>
          </div>
        </div>
        <textarea
          readOnly
          rows={3}
          defaultValue={"Hi Karthik, we have a Senior ML opening that looks like a strong fit for your background in PyTorch..."}
          style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.68rem", color: "#4B5563", lineHeight: 1.6, background: "none", border: "none", outline: "none", width: "100%", resize: "none" }}
        />
      </div>
    </div>
  );
}

function PipelineTab() {
  const stages = [
    { label: "SOURCED", cards: [{ name: "Karthik R.", role: "ML Engineer", style: {} as StageCardStyle }, { name: "Meera I.", role: "Product Manager", style: {} as StageCardStyle }] },
    { label: "CONTACTED", cards: [{ name: "Sneha P.", role: "Growth Marketer", style: { borderColor: "rgba(75,142,240,0.2)" } }] },
    { label: "INTERVIEWING", cards: [{ name: "Arjun K.", role: "Sr. Backend", style: { borderColor: "rgba(245,200,66,0.2)" } }] },
    { label: "OFFER", cards: [{ name: "Priya V.", role: "Backend Dev", style: { borderColor: "rgba(52,209,122,0.3)", background: "rgba(52,209,122,0.04)" } }] },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, padding: "12px 14px" }}>
      {stages.map((stage) => (
        <div key={stage.label} style={{ background: "#F8F9FC", borderRadius: 7, padding: 6 }}>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", color: "#9CA3AF", letterSpacing: "0.1em", marginBottom: 8, textAlign: "center" }}>{stage.label}</div>
          {stage.cards.map((card) => (
            <div key={card.name} style={{ background: card.style.background || "#FFFFFF", border: `1px solid ${card.style.borderColor || "rgba(0,0,0,0.07)"}`, borderRadius: 7, padding: "8px 10px", marginBottom: 6 }}>
              <div style={{ fontFamily: "var(--font-body)", fontSize: "0.68rem", color: "#111827" }}>{card.name}</div>
              <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.52rem", color: "#9CA3AF", marginTop: 2 }}>{card.role}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ScheduleTab() {
  const rows = [
    { icon: "📅", title: "Arjun K. · Technical Round", detail: "Tomorrow · 3:00 PM · Google Meet", badge: "Confirmed", badgeBg: "rgba(52,209,122,0.12)", badgeColor: "#34D17A" },
    { icon: "📅", title: "Priya V. · Culture Fit", detail: "Thu 15 May · 11:00 AM · Zoom", badge: "Pending", badgeBg: "rgba(245,200,66,0.12)", badgeColor: "#F5C842" },
    { icon: "📅", title: "Rohit S. · Final Round", detail: "Fri 16 May · 4:00 PM · Office", badge: "Scheduled", badgeBg: "rgba(75,142,240,0.12)", badgeColor: "#4B8EF0" },
  ];
  return (
    <div style={{ padding: "12px 14px" }}>
      {rows.map((row) => (
        <div key={row.title} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, borderRadius: 8, background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.07)", marginBottom: 6 }}>
          <span style={{ fontSize: "1rem", flexShrink: 0 }}>{row.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: "0.78rem", fontWeight: 500, color: "#111827" }}>{row.title}</div>
            <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#4B5563", marginTop: 2 }}>{row.detail}</div>
          </div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.58rem", background: row.badgeBg, color: row.badgeColor, borderRadius: 100, padding: "3px 9px", flexShrink: 0 }}>{row.badge}</div>
        </div>
      ))}
    </div>
  );
}

function StarRating({ filled }: { filled: number }) {
  return (
    <div style={{ display: "flex", gap: 2, marginTop: 6 }}>
      {[1, 2, 3, 4, 5].map((index) => (
        <span key={index} style={{ fontSize: "0.7rem", color: index <= filled ? "#F5C842" : "#9CA3AF" }}>★</span>
      ))}
    </div>
  );
}

function FeedbackTab() {
  const cards = [
    { title: "Arjun K. · Technical Round", reviewer: "Reviewed by Rahul (CTO)", stars: 4, comment: "Strong system design. Comfortable with our stack. Move to final round.", badge: "Strong Yes", badgeBg: "rgba(52,209,122,0.1)", badgeColor: "#34D17A", badgeBorder: "rgba(52,209,122,0.2)" },
    { title: "Priya V. · Culture Fit", reviewer: "Reviewed by Anjali (HR)", stars: 3, comment: "Good communication. Needs more async experience.", badge: "Maybe", badgeBg: "rgba(245,200,66,0.1)", badgeColor: "#F5C842", badgeBorder: "rgba(245,200,66,0.2)" },
  ];
  return (
    <div style={{ padding: "12px 14px" }}>
      {cards.map((card) => (
        <div key={card.title} style={{ background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 10, padding: 12, marginBottom: 8 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: "0.75rem", color: "#111827" }}>{card.title}</div>
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.55rem", color: "#9CA3AF", marginTop: 2 }}>{card.reviewer}</div>
          <StarRating filled={card.stars} />
          <div style={{ fontFamily: "var(--font-body)", fontSize: "0.72rem", color: "#4B5563", marginTop: 6 }}>{card.comment}</div>
          <div style={{ display: "inline-block", marginTop: 8, fontFamily: "var(--font-mono, monospace)", fontSize: "0.58rem", background: card.badgeBg, color: card.badgeColor, border: `1px solid ${card.badgeBorder}`, borderRadius: 100, padding: "3px 10px" }}>{card.badge}</div>
        </div>
      ))}
    </div>
  );
}

const TAB_CONTENT: Record<TabName, () => JSX.Element> = {
  Outreach: OutreachTab,
  Pipeline: PipelineTab,
  Schedule: ScheduleTab,
  Feedback: FeedbackTab,
};

export function FlowPanel() {
  const [activeTab, setActiveTab] = useState<TabName>("Outreach");
  const [hintTab, setHintTab] = useState<TabName | null>(null);
  const Content = TAB_CONTENT[activeTab];

  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.4 });
  const interactedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  function selectTab(tab: TabName) {
    interactedRef.current = true;
    setHintTab(null);
    setActiveTab(tab);
  }

  // Auto-demo: Outreach is shown by default, then pulse the next tab (Pipeline)
  // to show the tabs are interactive. Cancelled on any user interaction.
  useEffect(() => {
    if (!inView) return;
    const t = window.setTimeout(() => {
      if (interactedRef.current) return;
      setHintTab("Pipeline");
    }, 1400);
    timersRef.current.push(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  useEffect(() => () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  return (
    <motion.div
      ref={rootRef}
      initial={{ y: 30 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.7, delay: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      style={{ background: "#F8F9FC", border: "1px solid rgba(245,200,66,0.2)", borderRadius: 18, boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 60px rgba(245,200,66,0.04)", overflow: "hidden" }}
    >
      <div style={{ height: 38, background: "#EDEEF2", borderBottom: "1px solid rgba(0,0,0,0.07)", display: "flex", alignItems: "center", padding: "0 14px", gap: 6 }}>
        {["#EF4444", "#F5C842", "#34D17A"].map((color) => (
          <div key={color} style={{ width: 8, height: 8, borderRadius: "50%", background: color, opacity: 0.7 }} />
        ))}
        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.58rem", color: "#9CA3AF", marginLeft: 8 }}>ealana / flow</span>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid rgba(0,0,0,0.07)", background: "#EDEEF2" }}>
        {TABS.map((tab, index) => {
          const isActive = activeTab === tab;
          const isHint = hintTab === tab;
          return (
            <motion.button
              key={tab}
              onClick={() => selectTab(tab)}
              animate={isHint
                ? { boxShadow: ["inset 0 0 0 0 rgba(245,200,66,0.5)", "inset 0 0 0 2px rgba(245,200,66,0.5)", "inset 0 0 0 0 rgba(245,200,66,0.5)"] }
                : { boxShadow: "inset 0 0 0 0 rgba(245,200,66,0)" }}
              transition={isHint ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "10px 6px",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "0.6rem",
                color: isActive ? "#F5C842" : isHint ? "#C79A1E" : "#9CA3AF",
                background: isActive ? "rgba(245,200,66,0.06)" : isHint ? "rgba(245,200,66,0.04)" : "transparent",
                borderBottom: isActive ? "2px solid #F5C842" : "2px solid transparent",
                borderRight: index < TABS.length - 1 ? "1px solid rgba(0,0,0,0.07)" : "none",
                cursor: "pointer",
                transition: "color 0.2s, background 0.2s",
              }}
            >
              {tab}
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={activeTab} {...tabAnim}>
          <Content />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

export default function FlowFeature() {
  const isMobile = useIsMobile();
  return (
    <section style={{ padding: isMobile ? "72px 1.25rem" : "120px 4rem" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? "1.5rem" : "5rem", alignItems: "center" }}>
        <motion.div
          initial={{ y: 30 }}
          whileInView={{ y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "0.6rem", color: "#3D4460", letterSpacing: "0.12em", marginBottom: "0.5rem" }}>Layer 03</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: "3rem", color: "#F5C842", marginBottom: "0.25rem", lineHeight: 1.1 }}>Flow</div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: "0.9rem", fontStyle: "italic", color: "#F5C842", opacity: 0.7, marginBottom: "1.5rem" }}>Act on the signal</div>
          <p style={{ fontFamily: "var(--font-body)", fontSize: "0.97rem", color: "#8891AA", lineHeight: 1.8, marginBottom: "2rem" }}>
            Shortlist ready? Send an email sequence, keep candidates posted on WhatsApp, schedule an interview — all from the same screen. No tab-switching. No copy-pasting. Just one place to move candidates through your pipeline.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {bullets.map((bullet) => (
              <div key={bullet} style={{ display: "flex", gap: 10 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#F5C842", flexShrink: 0, marginTop: 7 }} />
                <span style={{ fontFamily: "var(--font-body)", fontSize: "0.875rem", color: "#8891AA", lineHeight: 1.6 }}>{bullet}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <FlowPanel />
      </div>
    </section>
  );
}
