// Recruiter-dashboard density tokens — aligned with `internal-page-theme.ts`
// (Wave 3.5B). The dashboard shares the workspace's compact vertical rhythm so
// its first actionable panel lands above the fold at 1440×900.

export const DASHBOARD_PAGE_BACKGROUND = "relative bg-[#F4F6FA]";

/** Dashboard content column: same rhythm as the internal workspace container. */
export const DASHBOARD_PAGE_CONTAINER =
  "mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:px-8 md:py-5";

export const DASHBOARD_SHELL_PANEL =
  "overflow-hidden rounded-[12px] border border-[#E3E6F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)]";

export const DASHBOARD_PANEL =
  "overflow-hidden rounded-[10px] border border-[#E3E6F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

export const DASHBOARD_PANEL_SOFT =
  "rounded-[8px] border border-[#E3E6F0] bg-[#F7F8FC]";

export const DASHBOARD_PANEL_MUTED =
  "rounded-[8px] border border-[#EEF0F4] bg-[#F8F8FA]";

export const DASHBOARD_EYEBROW =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#687182]";

/** Panel title (secondary heading, not the page `h1`). */
export const DASHBOARD_TITLE =
  "font-satoshi text-[18px] font-bold tracking-[-0.02em] text-[#0F172A]";
