/**
 * Shared Tailwind class-string constants used across multiple pages/components.
 * Centralising them here avoids drift when the same visual pattern is tweaked.
 */

/* ── Buttons ── */
export const btnPrimary =
  "bg-e-blue text-white border-none py-3 px-6 rounded-xl font-ui text-[0.875rem] font-medium leading-normal cursor-pointer no-underline transition-all duration-200 inline-block hover:brightness-110 max-md:w-full max-md:text-center";

export const btnSecondary =
  "bg-transparent text-e-text border border-white/12 py-3 px-6 rounded-xl font-ui text-[0.875rem] font-medium leading-normal cursor-pointer no-underline transition-all duration-200 inline-block hover:border-white/25 hover:bg-white/[0.03] max-md:w-full max-md:text-center";

/* ── Section label (mono, uppercase, tracking) ── */
export const sectionLabel =
  "font-mono text-[0.68rem] font-medium text-e-blue tracking-[0.12em] uppercase mb-3.5";

/* ── Legal page shared constants ── */
export const legalSubsectionCls = "mb-5 last:mb-0";

export const legalH4Cls =
  "font-display text-sm font-semibold text-e-text mb-2";

export const legalListCls =
  "list-none p-0 mt-2 [&>li]:relative [&>li]:pl-[18px] [&>li]:mb-[6px] [&>li]:text-[0.875rem] [&>li]:text-e-text2 [&>li]:leading-[1.6] [&>li>strong]:text-e-text [&>li>strong]:font-medium [&>li]:before:content-[''] [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-[10px] [&>li]:before:w-[5px] [&>li]:before:h-[5px] [&>li]:before:rounded-full [&>li]:before:bg-e-blue [&>li]:before:opacity-70";

export const legalLinkCls =
  "text-e-blue no-underline transition-colors duration-200 border-b border-[rgba(75,142,240,0.28)] hover:text-e-text hover:border-e-text";

export const legalNoteCls = "text-[0.82rem] text-e-text3 italic";

export const legalContactCardCls =
  "bg-white/[0.04] border border-white/[0.08] rounded-[18px] p-5 mt-3 backdrop-blur-xl";

export const legalContactOrgCls =
  "font-semibold mb-[10px] [&>a]:text-e-text [&>a]:no-underline [&>a]:border-b [&>a]:border-white/[0.08] [&>a]:transition-colors [&>a]:duration-200 [&>a:hover]:text-e-blue";

export const legalContactRowCls =
  "flex items-center gap-2 text-e-blue text-[0.88rem] mb-[6px]";

export const legalContactSubjectCls = "text-[0.82rem] text-e-text3";

export const legalInfoGridCls =
  "grid grid-cols-2 gap-px bg-white/[0.06] border border-white/[0.06] rounded-lg overflow-hidden my-4 max-md:grid-cols-1";

export const legalInfoItemCls = "flex flex-col gap-1 p-4 bg-white/[0.04] backdrop-blur-xl";

export const legalInfoLabelCls =
  "font-mono text-[0.72rem] font-medium tracking-[0.06em] text-e-blue";

export const legalInfoDescCls =
  "text-[0.8rem] text-e-text2 leading-[1.4]";
