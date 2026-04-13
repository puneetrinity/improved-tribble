import type { ReactNode } from "react";
import {
  INTERNAL_BODY,
  INTERNAL_SECTION_TITLE,
} from "@/lib/internal-page-theme";
import { cn } from "@/lib/utils";

interface InternalSectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function InternalSectionHeader({
  title,
  description,
  actions,
  className,
}: InternalSectionHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h2 className={INTERNAL_SECTION_TITLE}>{title}</h2>
        {description ? <p className={cn(INTERNAL_BODY, "mt-1")}>{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
