/**
 * Shared Tailwind class-string constants used across multiple pages/components.
 * Centralising them here avoids drift when the same visual pattern is tweaked.
 */

/* ── Buttons ── */
export const btnPrimary =
  "bg-hr-accent text-white border-none py-3 px-6 rounded-none font-dm text-[0.875rem] font-medium leading-normal cursor-pointer no-underline transition-colors duration-200 inline-block hover:bg-hr-accent-hover max-md:w-full max-md:text-center";

export const btnSecondary =
  "bg-transparent text-hr-text border border-[rgba(255,255,255,0.12)] py-3 px-6 rounded-none font-dm text-[0.875rem] font-medium leading-normal cursor-pointer no-underline transition-all duration-200 inline-block hover:border-[rgba(255,255,255,0.25)] max-md:w-full max-md:text-center";

/* ── Section label (mono, uppercase, tracking) ── */
export const sectionLabel =
  "font-mono text-[0.68rem] font-medium text-hr-accent-hover tracking-[0.12em] uppercase mb-3.5";

/* ── Legal page shared constants ── */
export const legalSubsectionCls = "mb-5 last:mb-0";

export const legalH4Cls =
  "font-satoshi text-sm font-semibold text-hr-text mb-2";

export const legalListCls =
  "list-none p-0 mt-2 [&>li]:relative [&>li]:pl-[18px] [&>li]:mb-[6px] [&>li]:text-[0.875rem] [&>li]:text-hr-text-secondary [&>li]:leading-[1.6] [&>li>strong]:text-hr-text [&>li>strong]:font-medium [&>li]:before:content-[''] [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-[10px] [&>li]:before:w-[5px] [&>li]:before:h-[5px] [&>li]:before:rounded-full [&>li]:before:bg-hr-accent [&>li]:before:opacity-50";

export const legalLinkCls =
  "text-hr-accent-hover no-underline transition-colors duration-200 border-b border-[rgba(167,139,250,0.3)] hover:text-hr-text hover:border-hr-text";

export const legalNoteCls = "text-[0.82rem] text-hr-text-muted italic";

export const legalContactCardCls =
  "bg-hr-bg-elevated border border-white/[0.06] rounded-lg p-5 mt-3";

export const legalContactOrgCls =
  "font-semibold mb-[10px] [&>a]:text-hr-text [&>a]:no-underline [&>a]:border-b [&>a]:border-white/[0.08] [&>a]:transition-colors [&>a]:duration-200 [&>a:hover]:text-hr-accent-hover";

export const legalContactRowCls =
  "flex items-center gap-2 text-hr-accent-hover text-[0.88rem] mb-[6px]";

export const legalContactSubjectCls = "text-[0.82rem] text-hr-text-muted";

export const legalInfoGridCls =
  "grid grid-cols-2 gap-px bg-white/[0.06] border border-white/[0.06] rounded-lg overflow-hidden my-4 max-md:grid-cols-1";

export const legalInfoItemCls = "flex flex-col gap-1 p-4 bg-hr-bg-elevated";

export const legalInfoLabelCls =
  "font-mono text-[0.72rem] font-medium tracking-[0.06em] text-hr-accent-hover";

export const legalInfoDescCls =
  "text-[0.8rem] text-hr-text-secondary leading-[1.4]";
