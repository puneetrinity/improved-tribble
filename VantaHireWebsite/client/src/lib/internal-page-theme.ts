// Internal recruiter-workspace design tokens.
//
// Wave 3.5B: the workspace is action-first. Headers are compact (≤176 CSS px
// for a title/subtitle/actions header, ≤120 px for a simple one at 1440×900),
// page `h1` is 22 px on mobile and 26 px on desktop, and the first work
// surface (filters, table header, primary action) must begin no lower than
// 360 px. Every internal page inherits these numbers from the tokens and the
// shared primitives — pages must not add local header spacing.
//
// Colours, typefaces and brand assets are unchanged.

export const INTERNAL_PAGE_BACKGROUND =
  "relative min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,_rgba(196,192,255,0.38),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(196,236,255,0.34),_transparent_28%),linear-gradient(180deg,#F6F7FB_0%,#EEF2F6_100%)]";

/** Content column: tighter vertical rhythm so work surfaces start above the fold. */
export const INTERNAL_PAGE_CONTAINER =
  "mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 md:px-8 md:py-5";

/** Compact header card (was a 30px-radius hero with a 60px shadow). */
export const INTERNAL_HERO =
  "overflow-hidden rounded-[18px] border border-[#E7E9F0] bg-white/92 shadow-[0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur";

/** Padding used by every compact header: 14/16/16 px vertical rhythm. */
export const INTERNAL_HEADER_PADDING = "px-4 py-3.5 sm:px-5 sm:py-4 md:px-6 md:py-4";

export const INTERNAL_PANEL =
  "overflow-hidden rounded-[18px] border border-[#E7E9F0] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]";

export const INTERNAL_PANEL_MUTED =
  "rounded-[14px] border border-[#EEF0F4] bg-[#F8F8FA]";

export const INTERNAL_EYEBROW =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#687182]";

/** Page title: 22 px mobile / 26 px desktop (lock §4.1: ≤24 / ≤28). */
export const INTERNAL_TITLE =
  "font-satoshi text-[22px] font-extrabold leading-[1.15] tracking-[-0.03em] text-[#0F172A] md:text-[26px]";

export const INTERNAL_SECTION_TITLE =
  "font-satoshi text-[18px] font-bold tracking-[-0.025em] text-[#0F172A]";

export const INTERNAL_BODY =
  "font-outfit text-sm leading-relaxed text-[#5F6675]";

export const INTERNAL_META =
  "font-dm text-sm text-[#687182]";

/** Inline stat chip (replaces the three-up stat cards below the old hero). */
export const INTERNAL_STAT_CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-[#E7E9F0] bg-white/85 px-3 py-1 sm:min-h-9";

/**
 * Minimum touch target for controls that are the only control in a row on
 * mobile (lock §4.4): 44 px on small screens, the design height on `sm+`.
 */
export const INTERNAL_TOUCH_ACTIONS =
  "[&>*]:min-h-11 sm:[&>*]:min-h-10";

/**
 * Accessible Discover-blue pair. The layer colour #4B8EF0 stays for icons,
 * rings, borders and underlines (non-text). Where blue carries TEXT or a
 * white label sits on blue, use these: #1E5BD8 on white/tint and white on
 * #2B6CD4 both clear WCAG AA (≥4.5:1). Hover deepens to the text shade.
 */
export const INTERNAL_ACCENT_TEXT = "text-[#1E5BD8]";
export const INTERNAL_PRIMARY_BUTTON = "bg-[#2B6CD4] text-white hover:bg-[#1E5BD8]";
