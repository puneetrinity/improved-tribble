import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
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
      icon: <FileText className="h-4 w-4" />,
    },
    {
      id: "applications",
      label: "Applications",
      path: `/jobs/${jobId}/applications`,
      icon: <Users className="h-4 w-4" />,
    },
    {
      id: "sourcing",
      label: "Sourcing",
      path: `/jobs/${jobId}/sourcing`,
      icon: <Search className="h-4 w-4" />,
      badge: "Beta",
    },
    {
      id: "pipeline",
      label: "Pipeline",
      path: `/jobs/${jobId}/pipeline`,
      icon: <GitBranch className="h-4 w-4" />,
    },
    {
      id: "analytics",
      label: "Analytics",
      path: `/jobs/${jobId}/analytics`,
      icon: <BarChart3 className="h-4 w-4" />,
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
      className={cn(
        variant === "inline"
          ? "border-b border-border/70 bg-transparent"
          : "rounded-t-lg border-b border-border bg-white",
        className,
      )}
    >
      {jobTitle && (
        <div className={cn(variant === "inline" ? "px-0 pb-2" : "px-4 pt-3 pb-1")}>
          <h2 className="text-lg font-semibold text-foreground truncate">{jobTitle}</h2>
        </div>
      )}
      <nav
        className={cn(
          "flex gap-1 overflow-x-auto",
          variant === "inline" ? "-mb-px px-0" : "-mb-px px-2",
        )}
        aria-label="Job navigation"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setLocation(item.path)}
          className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 text-sm font-medium transition-colors rounded-none",
              variant === "inline" ? "px-3 py-3 md:px-4" : "px-4 py-2.5",
              activeId === item.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
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
                    ? "border-primary/40 bg-primary/10 text-primary"
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
