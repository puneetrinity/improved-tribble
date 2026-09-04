import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { INTERNAL_ACCENT_TEXT } from "@/lib/internal-page-theme";
import { FileText, Users, GitBranch, BarChart3, Search } from "lucide-react";

export interface JobSubNavProps {
  jobId: number;
  jobTitle?: string;
  className?: string;
  variant?: "default" | "inline";
}

type NavItem = {
  id: string;
  label: string;
  path: string;
  icon: React.ReactNode;
  badge?: string;
};

/**
 * The single job-workspace navigation (Wave 3.5B): Details · Applications ·
 * Discover · Pipeline · Analytics. Rendered identically on every job page,
 * marks the active page with `aria-current`, scrolls horizontally on narrow
 * screens without clipping, and keeps a 44 px touch target on mobile.
 */
export function JobSubNav({
  jobId,
  jobTitle,
  className,
  variant = "default",
}: JobSubNavProps) {
  const [location, setLocation] = useLocation();

  const navItems: NavItem[] = [
    {
      id: "details",
      label: "Details",
      path: `/jobs/${jobId}/edit`,
      icon: <FileText className="h-4 w-4" aria-hidden="true" />,
    },
    {
      id: "applications",
      label: "Applications",
      path: `/jobs/${jobId}/applications`,
      icon: <Users className="h-4 w-4" aria-hidden="true" />,
    },
    {
      id: "sourcing",
      label: "Discover",
      path: `/jobs/${jobId}/sourcing`,
      icon: <Search className="h-4 w-4" aria-hidden="true" />,
    },
    {
      id: "pipeline",
      label: "Pipeline",
      path: `/jobs/${jobId}/pipeline`,
      icon: <GitBranch className="h-4 w-4" aria-hidden="true" />,
    },
    {
      id: "analytics",
      label: "Analytics",
      path: `/jobs/${jobId}/analytics`,
      icon: <BarChart3 className="h-4 w-4" aria-hidden="true" />,
    },
  ];

  // Determine active tab based on current location
  const getActiveId = () => {
    if (location.includes("/applications")) return "applications";
    if (location.includes("/sourcing")) return "sourcing";
    if (location.includes("/pipeline")) return "pipeline";
    if (location.includes("/analytics")) return "analytics";
    if (location.includes("/edit")) return "details";
    return "applications"; // default
  };

  const activeId = getActiveId();

  return (
    <div
      data-job-subnav=""
      className={cn(
        variant === "inline"
          ? "border-b border-border/70 bg-transparent"
          : "rounded-[12px] border border-border bg-white",
        className,
      )}
    >
      {jobTitle && (
        <div className={cn(variant === "inline" ? "px-0 pb-1" : "px-4 pt-2.5")}>
          <h2 className="truncate text-sm font-semibold text-foreground">{jobTitle}</h2>
        </div>
      )}
      <nav
        className={cn(
          "flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          variant === "inline" ? "-mb-px px-0" : "px-2",
        )}
        aria-label="Job navigation"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setLocation(item.path)}
            className={cn(
              "flex min-h-11 items-center gap-2 whitespace-nowrap rounded-none border-b-2 px-3 text-sm font-medium transition-colors duration-200 sm:min-h-10 md:px-4",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset",
              activeId === item.id
                ? cn("border-primary", INTERNAL_ACCENT_TEXT)
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
            aria-current={activeId === item.id ? "page" : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge && (
              <span
                className={cn(
                  "rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                  activeId === item.id
                    ? cn("border-primary/40 bg-primary/10", INTERNAL_ACCENT_TEXT)
                    : "border-amber-300 bg-amber-50 text-amber-700",
                )}
              >
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
