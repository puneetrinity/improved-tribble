// @charset "utf-8"
import { motion } from "framer-motion";
import ealanaMoth from "@/assets/ealana-moth (1).svg";
import { useIsMobile } from "@/hooks/use-mobile";

const mono = { fontFamily: "'JetBrains Mono',monospace" } as const;
const body = { fontFamily: "'DM Sans',sans-serif" } as const;

interface Pair {
  pain: string;
  fix: string;
  accent: string;
}

// Each pair maps a concrete recruiting pain to what ealana does instead.
// The first three intentionally foreshadow the Discover / Memory / Flow layers.
const PAIRS: Pair[] = [
  { pain: "4,847 results. 0 ranked. You read them all.", fix: "An AI-ranked shortlist, scored by real fit.", accent: "#4B8EF0" },
  { pain: "Knowledge walks out when someone quits.", fix: "Shared memory keeps every candidate and decision.", accent: "#34D17A" },
  { pain: "Seven tabs open. Nothing talks to anything.", fix: "One platform — sourcing, outreach, pipeline, feedback.", accent: "#F5C842" },
  { pain: "outreach_tracker_v12_FINAL.xlsx, out of sync.", fix: "A live pipeline that's always up to date.", accent: "#4B8EF0" },
];

// Compact "what's right" dashboard (laptop visual)
const RANKED = [
  { initials: "AK", name: "Arjun K.", role: "Sr. Backend · 7y", fit: "96%", state: "Shortlisted", stateColor: "#34D17A", bg: "rgba(75,142,240,0.15)", ic: "#4B8EF0" },
  { initials: "PV", name: "Priya V.", role: "Backend Dev · 5y", fit: "91%", state: "Contacted", stateColor: "#4B8EF0", bg: "rgba(52,209,122,0.15)", ic: "#34D17A" },
  { initials: "KR", name: "Karthik R.", role: "ML Engineer · 6y", fit: "88%", state: "In review", stateColor: "#C79A1E", bg: "rgba(245,200,66,0.18)", ic: "#C79A1E" },
  { initials: "SP", name: "Sneha P.", role: "Data Scientist · 4y", fit: "84%", state: "Sourced", stateColor: "#6B7280", bg: "rgba(0,0,0,0.06)", ic: "#6B7280" },
];

const SOLVED = [
  { icon: "🧠", label: "1,240 remembered" },
  { icon: "🔗", label: "One workspace" },
  { icon: "✓", label: "Synced just now" },
];

function PainCell({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.16)", borderRadius: 12, height: "100%", boxSizing: "border-box" }}>
      <span style={{ color: "#EF4444", fontSize: "0.8rem", lineHeight: 1.5, flexShrink: 0, marginTop: 1 }}>✕</span>
      <span className="font-body" style={{ fontSize: "0.9rem", color: "#8891AA", lineHeight: 1.55 }}>{text}</span>
    </div>
  );
}

function FixCell({ text, accent }: { text: string; accent: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px 16px", background: `linear-gradient(180deg, ${accent}1a 0%, ${accent}0d 100%)`, border: `1px solid ${accent}4D`, borderRadius: 12, boxShadow: `0 0 32px ${accent}12`, height: "100%", boxSizing: "border-box" }}>
      <span style={{ color: accent, fontSize: "0.8rem", lineHeight: 1.5, flexShrink: 0, marginTop: 1 }}>✓</span>
      <span className="font-body" style={{ fontSize: "0.9rem", color: "#F4F5FA", lineHeight: 1.55 }}>{text}</span>
    </div>
  );
}

function SolvedDashboard() {
  return (
    <motion.div
      initial={{ scale: 0.96, y: 30 }}
      whileInView={{ scale: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      style={{
        background: "#F8F9FC",
        border: "1px solid rgba(75,142,240,0.2)",
        borderRadius: 18,
        boxShadow: "0 32px 90px rgba(0,0,0,0.5), 0 0 60px rgba(52,209,122,0.06)",
        overflow: "hidden",
      }}
    >
      {/* Chrome */}
      <div style={{ height: 38, background: "#EDEEF2", borderBottom: "1px solid rgba(0,0,0,0.07)", display: "flex", alignItems: "center", padding: "0 14px", gap: 8 }}>
        <div style={{ display: "flex", gap: 5 }}>
          {["#EF4444", "#F5C842", "#34D17A"].map((c) => (
            <div key={c} style={{ width: 8, height: 8, borderRadius: "50%", background: c, opacity: 0.7 }} />
          ))}
        </div>
        <span style={{ ...mono, fontSize: "0.58rem", color: "#9CA3AF", marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <img src={ealanaMoth} alt="" width="13" height="15" />
          ealana / dashboard
        </span>
        <span style={{ marginLeft: "auto", ...mono, fontSize: "0.55rem", color: "#34D17A", background: "rgba(52,209,122,0.1)", border: "1px solid rgba(52,209,122,0.25)", borderRadius: 100, padding: "2px 9px", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#34D17A", display: "inline-block" }} />
          All synced
        </span>
      </div>

      {/* Before → after transformation strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: "#F1F2F6", borderBottom: "1px solid rgba(0,0,0,0.07)", flexWrap: "wrap" }}>
        <span style={{ ...mono, fontSize: "0.56rem", color: "#9CA3AF", textDecoration: "line-through" }}>4,847 results · 0 ranked</span>
        <span style={{ color: "#34D17A", fontSize: "0.7rem" }}>→</span>
        <span style={{ ...mono, fontSize: "0.58rem", color: "#34D17A" }}>100 ranked · 4 shortlisted · 1 search</span>
      </div>

      {/* Ranked candidate list */}
      <div style={{ padding: "8px 10px" }}>
        {RANKED.map((r) => (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 8px", borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: r.bg, color: r.ic, display: "flex", alignItems: "center", justifyContent: "center", ...mono, fontSize: "0.55rem", fontWeight: 600 }}>{r.initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...body, fontSize: "0.76rem", fontWeight: 500, color: "#111827" }}>{r.name}</div>
              <div style={{ ...mono, fontSize: "0.56rem", color: "#6B7280", marginTop: 1 }}>{r.role}</div>
            </div>
            <span style={{ ...mono, fontSize: "0.62rem", fontWeight: 600, color: "#34D17A", background: "rgba(52,209,122,0.12)", borderRadius: 100, padding: "2px 8px", flexShrink: 0 }}>{r.fit}</span>
            <span style={{ ...mono, fontSize: "0.55rem", color: r.stateColor, background: `${r.stateColor}1f`, borderRadius: 4, padding: "2px 8px", flexShrink: 0, minWidth: 64, textAlign: "center" }}>{r.state}</span>
          </div>
        ))}
      </div>

      {/* Solved status footer */}
      <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid rgba(0,0,0,0.07)", background: "#F1F2F6", flexWrap: "wrap" }}>
        {SOLVED.map((s) => (
          <span key={s.label} style={{ ...mono, fontSize: "0.56rem", color: "#374151", background: "#FFFFFF", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 100, padding: "4px 10px", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: "0.7rem" }}>{s.icon}</span>
            {s.label}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

export function ProblemSection() {
  const isMobile = useIsMobile();
  const gridCols = "1fr 44px 1fr";

  // ── Mobile: keep the compact text-based Before → Fix split ──
  if (isMobile) {
    return (
      <section style={{ padding: "72px 0" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", paddingLeft: "1.25rem", paddingRight: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
            <span className="font-mono" style={{ fontSize: "0.62rem", letterSpacing: "0.14em", color: "#4B8EF0", textTransform: "uppercase" }}>The Problem → The Fix</span>
            <div style={{ height: 1, background: "#4B8EF0", opacity: 0.2, flex: 1 }} />
          </div>

          <h2 className="font-display" style={{ fontSize: "clamp(2.2rem,8vw,3rem)", lineHeight: 1.12, color: "#F4F5FA", marginBottom: 14, fontWeight: 400 }}>
            Recruiting today is chaos.
            <br />
            <em style={{ fontStyle: "italic", background: "linear-gradient(135deg, #4B8EF0 0%, #34D17A 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", display: "inline-block", paddingBottom: "0.08em" }}>
              ealana makes it calm.
            </em>
          </h2>

          <p className="font-body" style={{ fontSize: "1rem", color: "#8891AA", fontWeight: 300, lineHeight: 1.75, marginBottom: 32 }}>
            Same candidates, same roles — but one system that finds the signal, remembers every candidate, and acts on it.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {PAIRS.map((pair, index) => (
              <motion.div
                key={pair.pain}
                initial={{ y: 24 }}
                whileInView={{ y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.55, delay: index * 0.06 }}
              >
                <PainCell text={pair.pain} />
                <div style={{ display: "flex", justifyContent: "center", padding: "6px 0" }}>
                  <span style={{ color: pair.accent, fontSize: "1rem", lineHeight: 1 }}>↓</span>
                </div>
                <FixCell text={pair.fix} accent={pair.accent} />
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  // ── Desktop / laptop: text-left, "what's right" dashboard visual on the right ──
  return (
    <section style={{ padding: "120px 0" }}>
      <div style={{ maxWidth: 1140, margin: "0 auto", paddingLeft: "4rem", paddingRight: "4rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "0.92fr 1.08fr", gap: "4.5rem", alignItems: "center" }}>
          {/* Left — concise framing */}
          <motion.div initial={{ y: 28 }} whileInView={{ y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
              <span className="font-mono" style={{ fontSize: "0.62rem", letterSpacing: "0.14em", color: "#4B8EF0", textTransform: "uppercase" }}>The Problem → The Fix</span>
              <div style={{ height: 1, background: "#4B8EF0", opacity: 0.2, width: 48 }} />
            </div>

            <h2 className="font-display" style={{ fontSize: "clamp(2.4rem,4vw,3.4rem)", lineHeight: 1.12, color: "#F4F5FA", marginBottom: 18, fontWeight: 400 }}>
              Recruiting today is chaos.
              <br />
              <em style={{ fontStyle: "italic", background: "linear-gradient(135deg, #4B8EF0 0%, #34D17A 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", display: "inline-block", paddingBottom: "0.08em" }}>
                ealana makes it calm.
              </em>
            </h2>

            <p className="font-body" style={{ fontSize: "1rem", color: "#8891AA", fontWeight: 300, lineHeight: 1.75, maxWidth: 420, marginBottom: 28 }}>
              One system that finds the signal, remembers every candidate, and keeps your whole pipeline in sync.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { t: "AI-ranked shortlist, not 4,847 maybes", c: "#4B8EF0" },
                { t: "Memory that never forgets a candidate", c: "#34D17A" },
                { t: "One platform, always in sync", c: "#F5C842" },
              ].map((it) => (
                <div key={it.t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", flexShrink: 0, background: `${it.c}22`, color: it.c, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.62rem" }}>✓</span>
                  <span className="font-body" style={{ fontSize: "0.92rem", color: "#C8CCDA" }}>{it.t}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Right — the calm, solved dashboard */}
          <SolvedDashboard />
        </div>
      </div>
    </section>
  );
}

export default ProblemSection;
