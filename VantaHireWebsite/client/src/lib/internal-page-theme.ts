// Internal recruiter-workspace design tokens.
//
// Wave 3.5B: the workspace is action-first. Headers are compact (≤176 CSS px
// for a title/subtitle/actions header, ≤120 px for a simple one at 1440×900),
// page `h1` matches the dashboard title (18 px), and the first work
// surface (filters, table header, primary action) must begin no lower than
// 360 px. Every internal page inherits these numbers from the tokens and the
// shared primitives — pages must not add local header spacing.
//
// Visual values match the recruiter dashboard (`dashboard-theme.ts`): white page,
// 12 px header panel, 10 px panels, 18 px page title. The dashboard itself is the
// reference and does not use these tokens except the accent/primary-button pair.

export const INTERNAL_PAGE_BACKGROUND =
  "relative min-h-screen overflow-x-hidden bg-white";

/** Content column: tighter vertical rhythm so work surfaces start above the fold. */
export const INTERNAL_PAGE_CONTAINER =
  "mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 pb-10 py-4 md:px-8 md:py-5";

/** Compact header card (was a 30px-radius hero with a 60px shadow). */
export const INTERNAL_HERO =
  "overflow-hidden rounded-[12px] border border-[#E3E6F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)]";

/** Padding used by every compact header: 14/16/16 px vertical rhythm. */
export const INTERNAL_HEADER_PADDING =
  "px-4 py-4 sm:px-5 sm:py-4 md:py-4";

export const INTERNAL_PANEL =
  "overflow-hidden rounded-[10px] border border-[#E3E6F0] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

export const INTERNAL_PANEL_MUTED =
  "rounded-[8px] border border-[#EEF0F4] bg-[#F8F8FA]";

export const INTERNAL_EYEBROW =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#687182]";

/** Page title: same as the recruiter dashboard title, 18 px (lock §4.1: ≤24 / ≤28). */
export const INTERNAL_TITLE =
  "font-satoshi text-[18px] font-bold leading-[1.2] tracking-[-0.02em] text-[#0F172A]";

export const INTERNAL_SECTION_TITLE =
  "font-satoshi text-[18px] font-bold tracking-[-0.025em] text-[#0F172A]";

export const INTERNAL_BODY =
  "font-outfit text-sm leading-relaxed text-[#5F6675]";

export const INTERNAL_META =
  "font-dm text-sm text-[#687182]";

/** Inline stat chip (replaces the three-up stat cards below the old hero). */
export const INTERNAL_STAT_CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-[8px] border border-[#E3E6F0] bg-[#F7F8FC] px-3 py-1 sm:min-h-9";

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
/**
 * Header action buttons take the dashboard's compact shape (36 px tall on
 * desktop, 9 px radius, 13 px semibold) while keeping each button's own colour.
 * Mobile keeps the 44 px touch target from INTERNAL_TOUCH_ACTIONS.
 */
export const INTERNAL_HEADER_ACTION_BUTTONS =
  "[&_button]:rounded-[9px] [&_button]:px-3.5 [&_button]:text-[13px] [&_button]:font-semibold sm:[&_button]:h-9 sm:[&_button]:min-h-9 [&_a]:rounded-[9px] [&_a]:text-[13px] [&_a]:font-semibold";

export const INTERNAL_ACCENT_TEXT = "text-[#1E5BD8]";
export const INTERNAL_PRIMARY_BUTTON = "bg-[#2B6CD4] text-white hover:bg-[#1E5BD8]";
