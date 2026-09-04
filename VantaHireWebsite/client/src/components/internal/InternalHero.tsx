import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  INTERNAL_BODY,
  INTERNAL_EYEBROW,
  INTERNAL_HEADER_PADDING,
  INTERNAL_HERO,
  INTERNAL_META,
  INTERNAL_STAT_CHIP,
  INTERNAL_TITLE,
  INTERNAL_TOUCH_ACTIONS,
} from "@/lib/internal-page-theme";
import { cn } from "@/lib/utils";

export interface InternalHeroStat {
  label: string;
  value: ReactNode;
  helper?: ReactNode;
  accentClassName?: string | undefined;
}

interface InternalHeroProps {
  eyebrow: string;
  tone?: "blue" | "green" | "yellow";
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  badge?: ReactNode;
  actions?: ReactNode;
  stats?: InternalHeroStat[];
  className?: string;
}

/**
 * Compact, action-first internal page header (Wave 3.5B).
 *
 * One row: icon · eyebrow/badge · title/subtitle, with actions aligned right
 * on `md+` and wrapping below the title on small screens. Stats render as a
 * single wrapping chip row instead of three-up cards, so they never take the
 * only above-fold action space. Colours, typefaces and tones are unchanged.
 */
export function InternalHero({
  eyebrow,
  tone = "blue",
  title,
  subtitle,
  icon: Icon,
  badge,
  actions,
  stats = [],
  className,
}: InternalHeroProps) {
  // Badge text is darkened for ≥4.5:1 on its tint; icon chips keep the layer colours (aria-hidden graphics).
  const TONES = {
    blue: { chip: "bg-[#EEF5FF] text-[#4B8EF0]", badge: "border-[#D4E7FF] bg-[#EEF5FF] text-[#1E5BD8]" },
    green: { chip: "bg-[#EAF8F0] text-[#1FA45C]", badge: "border-[#C8EEDA] bg-[#EAF8F0] text-[#15803D]" },
    yellow: { chip: "bg-[#FCF6E3] text-[#B8860B]", badge: "border-[#F2E3B3] bg-[#FCF6E3] text-[#92400E]" },
  } as const;
  const toneCls = TONES[tone];

  return (
    <section
      data-internal-header="hero"
      className={cn(INTERNAL_HERO, INTERNAL_HEADER_PADDING, "relative", className)}
    >
      <div className="pointer-events-none absolute -right-20 -top-28 h-44 w-44 rounded-full bg-[rgba(75,142,240,0.14)] blur-3xl" />

      <div className="relative flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <div
              className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]",
                toneCls.chip,
              )}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </div>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className={INTERNAL_EYEBROW}>{eyebrow}</p>
              {badge ? (
                <div className={cn("inline-flex rounded-full border px-2.5 py-0.5 font-dm text-[11px] font-semibold", toneCls.badge)}>
                  {badge}
                </div>
              ) : null}
            </div>
            <h1 className={cn(INTERNAL_TITLE, "mt-0.5 [text-wrap:balance]")}>{title}</h1>
            {subtitle ? (
              <p className={cn(INTERNAL_BODY, "mt-1 line-clamp-2 max-w-2xl")}>{subtitle}</p>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div
            className={cn(
              "relative flex shrink-0 flex-wrap items-center gap-2 md:justify-end",
              INTERNAL_TOUCH_ACTIONS,
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>

      {stats.length > 0 ? (
        <dl className="relative mt-2.5 flex flex-wrap gap-1.5">
          {stats.map((stat) => (
            <div key={stat.label} className={INTERNAL_STAT_CHIP}>
              <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-[#687182]">
                {stat.label}
              </dt>
              <dd className={cn("font-satoshi text-[15px] font-bold leading-none text-[#111827]", stat.accentClassName)}>
                {stat.value}
              </dd>
              {stat.helper ? (
                <dd className={cn(INTERNAL_META, "hidden text-xs sm:block")}>{stat.helper}</dd>
              ) : null}
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
