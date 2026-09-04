import { cn } from "@/lib/utils";

export interface SubNavItem {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface SubNavProps {
  items: SubNavItem[];
  activeId: string;
  onChange: (id: string) => void;
  className?: string;
}

/**
 * In-page sub-navigation (Wave 3.5B): shares the job navigation's geometry —
 * 44 px touch targets on mobile, horizontal scroll without clipping, visible
 * focus ring, `aria-current` on the active item.
 */
export function SubNav({ items, activeId, onChange, className }: SubNavProps) {
  return (
    <div className={cn("border-b border-border bg-white", className)}>
      <nav
        className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Sub navigation"
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors duration-200 sm:min-h-10 md:px-4",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
              activeId === item.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
            aria-current={activeId === item.id ? "page" : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
            {typeof item.count === "number" && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs tabular-nums",
                  activeId === item.id
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
