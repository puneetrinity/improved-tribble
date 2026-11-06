// Candidate sign-up / sign-in layout: split screen like the recruiter sign-in (brand panel on the
// left, form on the right). The left panel is a slow-moving grain gradient in spark orange, adapted
// from the 21st.dev "Auth Section 1" (solaceui) grain-gradient panel but built in CSS, so it needs
// no WebGL/shader dependency. Motion stops under prefers-reduced-motion; the panel is hidden on
// small screens, where a short brand strip sits above the form instead.
import { useEffect, useState, type ReactNode } from "react";
import { Briefcase, Check, ClipboardCheck, Globe, ListChecks, Sparkles, UserRound } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import ealanaLogo from "@/assets/ealana_logo.svg";
import { OfflineBanner } from "./SparkStates";

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.9 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

export function SparkWordmark() {
  return (
    <span className="flex items-center">
      <img src={ealanaLogo} alt="ealana" className="h-7 w-auto" />
      <span className="ml-2.5 rounded-md bg-spark px-2.5 pb-1 pt-0.5 font-spark text-[17px] font-normal lowercase leading-tight text-white">spark</span>
    </span>
  );
}

/** The setup wizard's page frame, copied from the approved prototype journey (`Framed`). */
export function SparkFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <OfflineBanner />
      <header className="flex items-center border-b border-border bg-card px-4 py-3 md:px-8">
        <img src={ealanaLogo} alt="ealana" className="h-8 w-auto" />
        <span className="ml-2.5 rounded-md bg-spark px-2.5 pb-1 pt-0.5 font-spark text-[17px] font-normal lowercase leading-tight text-white">spark</span>
      </header>
      <main className="mx-auto max-w-6xl bg-muted/30 px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}

/** `matching` is the real switch: the page only promises recommendations once they exist. */
export function CandidateAuthShell({ children, matching = "not_ready" }: { children: ReactNode; matching?: "ready" | "not_ready" }) {
  return (
    <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
      <style>{`
        @keyframes spark-drift-a { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(6%, 4%) scale(1.08); } }
        @keyframes spark-drift-b { 0%,100% { transform: translate(0,0) scale(1.05); } 50% { transform: translate(-5%, -6%) scale(0.95); } }
        @media (prefers-reduced-motion: reduce) { .spark-drift { animation: none !important; } }
      `}</style>

      {/* Brand panel (desktop) */}
      <aside className="relative hidden overflow-hidden bg-[#0B0A0F] p-12 text-white lg:flex lg:flex-col lg:justify-between" aria-label="About ealana spark">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="spark-drift absolute -right-[30%] -top-[25%] h-[85%] w-[85%] rounded-full opacity-90 blur-3xl"
            style={{ background: "radial-gradient(circle at 40% 60%, #FF8A4C 0%, #F25C2E 35%, rgba(242,92,46,0) 70%)", animation: "spark-drift-a 18s ease-in-out infinite" }} />
          <div className="spark-drift absolute -bottom-[30%] -left-[25%] h-[80%] w-[80%] rounded-full opacity-80 blur-3xl"
            style={{ background: "radial-gradient(circle at 60% 40%, #FFB38A 0%, #F25C2E 40%, rgba(242,92,46,0) 72%)", animation: "spark-drift-b 22s ease-in-out infinite" }} />
          <div className="absolute inset-0 opacity-60 mix-blend-soft-light" style={{ backgroundImage: NOISE }} />
          <div className="absolute inset-0 opacity-25" style={{ backgroundImage: NOISE }} />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(11,10,15,0.55)_0%,rgba(11,10,15,0.1)_45%,rgba(11,10,15,0.6)_100%)]" />
        </div>
        <span aria-hidden />
        <div className="relative z-10 max-w-md space-y-6">
          <div className="space-y-4">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm text-white/90 backdrop-blur"><Sparkles className="h-3.5 w-3.5" aria-hidden />Your AI job scout</p>
            <h2 className="text-5xl font-semibold leading-[1.02] tracking-[-0.03em] xl:text-6xl">Your next job,<br />without the busywork.</h2>
            <p className="text-lg leading-relaxed text-white/80">{matching === "ready"
              ? "spark builds your profile for you, keeps checking new openings and brings you the jobs that fit, with the reasons why."
              : "spark builds your career profile for you in minutes. Then browse and save jobs in one place."}</p>
          </div>
          <ScoutActivity matching={matching} />
        </div>
        <span aria-hidden />
      </aside>

      {/* Form side */}
      <main className="flex flex-col">
        <OfflineBanner />
        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-10">
          {/* Logo sits with the form, aligned to it, not floating in the page corner. */}
          <div className="w-full max-w-md space-y-10"><SparkWordmark />{children}</div>
        </div>
      </main>
    </div>
  );
}

/** Illustrative loop of what spark does for the candidate: the setup wizard's stepper (21st.dev
 * shadcnspace "Animated Progress Stepper", stepper-03), same horizontal layout, so sign-up and setup
 * match: icon circles, a spring-filled line with a travelling dot, a pulse on the current step and the
 * icon morphing to a tick when done. Loops. No numbers or claims; under reduced motion it shows every
 * step done. Hidden from screen readers (the copy above says the same). */
function ScoutActivity({ matching }: { matching: "ready" | "not_ready" }) {
  const steps: { label: string; icon: typeof UserRound }[] = matching === "ready"
    ? [{ label: "Reading your profile", icon: UserRound }, { label: "Checking new openings", icon: Globe }, { label: "Picking jobs that fit", icon: Briefcase }]
    : [{ label: "Reading your profile", icon: UserRound }, { label: "Filling in your history", icon: ListChecks }, { label: "Ready to review", icon: ClipboardCheck }];
  const n = steps.length;
  const reduce = useReducedMotion();
  // -1 = not started, 0..n-1 = working on that step, n = all done (then it starts again)
  const [current, setCurrent] = useState(-1);
  useEffect(() => {
    if (reduce) { setCurrent(n); return; }
    const t = setTimeout(() => setCurrent(c => (c >= n ? -1 : c + 1)), current === -1 ? 700 : current >= n ? 3200 : 1900);
    return () => clearTimeout(t);
  }, [current, n, reduce]);
  const progress = current < 0 ? 0 : Math.min(1, current / (n - 1));
  const edge = 100 / (n * 2); // line runs from the first circle's centre to the last
  return (
    <div aria-hidden className="rounded-2xl border border-white/15 bg-black/35 px-4 pb-4 pt-5 backdrop-blur-md">
      <div className="relative">
        <div className="absolute top-5 h-0.5 bg-white/15" style={{ left: `${edge}%`, right: `${edge}%` }} />
        <motion.div className="absolute top-5 h-0.5 origin-left bg-spark" style={{ left: `${edge}%`, right: `${edge}%` }}
          initial={false} animate={{ scaleX: progress }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }} />
        <motion.span className="absolute h-2 w-2 rounded-full bg-spark" style={{ top: 21, x: "-50%", y: "-50%" }}
          initial={false} animate={{ left: `${edge + progress * (100 - 2 * edge)}%`, opacity: current < 0 ? 0 : 1 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 24 }} />
        <ol className="relative flex items-start justify-between">
          {steps.map((st, i) => {
            const done = i < current, active = i === current, Icon = st.icon;
            return (
              <li key={st.label} className="flex flex-1 flex-col items-center gap-2 text-center">
                <span className="relative flex h-10 w-10 items-center justify-center">
                  <span className={`absolute inset-0 rounded-full transition-colors duration-300 ${done || active ? "bg-spark" : "bg-[#2a2522]"}`} />
                  {active && !reduce && (
                    <motion.span className="absolute inset-0 rounded-full ring-2 ring-spark/60" initial={{ scale: 1, opacity: 1 }}
                      animate={{ scale: [1, 1.4, 1], opacity: [1, 0.2, 1] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} />
                  )}
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={done ? "done" : "icon"} className="relative flex"
                      initial={reduce ? false : { scale: 0, rotate: done ? -90 : 0, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }}
                      exit={reduce ? { opacity: 0 } : { scale: 0, opacity: 0 }} transition={{ type: "spring", stiffness: 400, damping: 22 }}>
                      {done ? <Check className="h-5 w-5 text-white" strokeWidth={3} /> : <Icon className={`h-5 w-5 ${active ? "text-white" : "text-white/50"}`} />}
                    </motion.span>
                  </AnimatePresence>
                </span>
                <span className={`px-1 text-xs font-medium leading-snug transition-colors duration-300 ${done || active ? "text-white" : "text-white/50"}`}>{st.label}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
