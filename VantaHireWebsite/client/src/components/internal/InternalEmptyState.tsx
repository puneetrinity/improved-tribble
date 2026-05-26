import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { INTERNAL_BODY } from "@/lib/internal-page-theme";
import { cn } from "@/lib/utils";

interface InternalEmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function InternalEmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: InternalEmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {Icon ? (
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-[#EEF5FF] text-[#4B8EF0]">
          <Icon className="h-7 w-7" />
        </div>
      ) : null}
      <h3 className="font-satoshi text-lg font-bold tracking-[-0.02em] text-[#111827]">
        {title}
      </h3>
      {description ? <p className={cn(INTERNAL_BODY, "mt-2 max-w-md")}>{description}</p> : null}
      {actions ? <div className="mt-5 flex items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
