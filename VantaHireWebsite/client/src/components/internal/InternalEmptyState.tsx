import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { INTERNAL_BODY, INTERNAL_TOUCH_ACTIONS } from "@/lib/internal-page-theme";
import { cn } from "@/lib/utils";

interface InternalEmptyStateProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Compact empty state (Wave 3.5B): same shell as loaded content, roughly half
 * the previous height, so an empty list does not push the page's actions down
 * or jump the layout when data arrives.
 */
export function InternalEmptyState({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: InternalEmptyStateProps) {
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center justify-center px-6 py-8 text-center", className)}
    >
      {Icon ? (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EEF5FF] text-[#4B8EF0]">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      ) : null}
      <h3 className="font-satoshi text-base font-bold tracking-[-0.02em] text-[#111827]">
        {title}
      </h3>
      {description ? <p className={cn(INTERNAL_BODY, "mt-1 max-w-md")}>{description}</p> : null}
      {actions ? (
        <div className={cn("mt-4 flex flex-wrap items-center justify-center gap-2", INTERNAL_TOUCH_ACTIONS)}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
