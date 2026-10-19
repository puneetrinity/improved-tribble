import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { INTERNAL_EYEBROW, INTERNAL_PANEL } from "@/lib/internal-page-theme";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  /** Stable id used for aria wiring and tests. */
  id: string;
  eyebrow: string;
  title: string;
  /** Short status shown in the header so the section can be read while closed. */
  status?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

/**
 * A dashboard-style panel whose body can be collapsed. The body stays mounted
 * while closed (Radix `forceMount` + `hidden`), so unsaved form input and
 * in-progress work inside it are never lost by collapsing.
 */
export function CollapsibleSection({
  id,
  eyebrow,
  title,
  status,
  open,
  onOpenChange,
  children,
  className,
}: CollapsibleSectionProps) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className={cn(INTERNAL_PANEL, className)}
      data-section={id}
    >
      <CollapsibleTrigger
        id={`${id}-trigger`}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-[#F7F8FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4B8EF0] sm:px-5"
      >
        <span className="min-w-0">
          <span className={cn(INTERNAL_EYEBROW, "block")}>{eyebrow}</span>
          <span className="mt-0.5 block font-satoshi text-[16px] font-bold tracking-[-0.02em] text-[#0F172A]">
            {title}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {status}
          <ChevronDown
            className={cn("h-4 w-4 text-[#4B5563] transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
            aria-hidden="true"
          />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount aria-labelledby={`${id}-trigger`} className="border-t border-[#EEF0F4] data-[state=closed]:hidden">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
