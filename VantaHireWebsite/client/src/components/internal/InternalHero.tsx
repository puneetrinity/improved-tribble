import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  INTERNAL_BODY,
  INTERNAL_EYEBROW,
  INTERNAL_HERO,
  INTERNAL_META,
  INTERNAL_TITLE,
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
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  badge?: ReactNode;
  actions?: ReactNode;
  stats?: InternalHeroStat[];
  className?: string;
}

export function InternalHero({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  badge,
  actions,
  stats = [],
  className,
}: InternalHeroProps) {
  return (
    <section className={cn(INTERNAL_HERO, "relative px-4 py-5 sm:px-6 sm:py-6 md:px-8 md:py-8", className)}>
      <div className="pointer-events-none absolute -right-16 -top-24 h-52 w-52 rounded-full bg-[#C4C0FF]/45 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 left-1/3 h-48 w-48 rounded-full bg-[#C4ECFF]/45 blur-3xl" />

      <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-3xl space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {Icon ? (
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EEF0FF] text-[#4D41DF] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                <Icon className="h-5 w-5" />
              </div>
            ) : null}
            <div>
              <p className={INTERNAL_EYEBROW}>{eyebrow}</p>
              {badge ? (
                <div className="mt-2 inline-flex rounded-full border border-[#DDDFFF] bg-[#F4F5FF] px-3 py-1 font-dm text-xs font-semibold text-[#5B4FF7]">
                  {badge}
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <h1 className={INTERNAL_TITLE}>{title}</h1>
            {subtitle ? <p className={cn(INTERNAL_BODY, "max-w-2xl")}>{subtitle}</p> : null}
          </div>
        </div>

        {actions ? <div className="relative flex flex-col gap-3 sm:flex-row xl:justify-end">{actions}</div> : null}
      </div>

      {stats.length > 0 ? (
        <div className="relative mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-[18px] border border-[#E7E9F0] bg-white/78 px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7B8191]">
                {stat.label}
              </p>
              <div className={cn("mt-2 font-satoshi text-2xl font-bold leading-none text-[#111827]", stat.accentClassName)}>
                {stat.value}
              </div>
              {stat.helper ? <p className={cn(INTERNAL_META, "mt-2 text-xs")}>{stat.helper}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
