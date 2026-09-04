import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { INTERNAL_TOUCH_ACTIONS } from "@/lib/internal-page-theme";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  /** Page title */
  title: string;
  /** Optional description/subtitle */
  description?: string;
  /** Optional icon component */
  icon?: LucideIcon;
  /** Optional action buttons (rendered on the right) */
  actions?: React.ReactNode;
  /** Optional breadcrumb navigation */
  breadcrumbs?: BreadcrumbItem[];
  /** Additional className for the wrapper */
  className?: string;
}

/**
 * PageHeader - compact, action-first page header (Wave 3.5B).
 *
 * Breadcrumb trail, then one row with icon · title · description on the left
 * and the primary actions on the right (wrapping below on small screens).
 * `h1` is 22 px on mobile and 26 px on desktop; the whole header stays within
 * 120 px (simple) / 176 px (with description + actions) at 1440×900.
 *
 * Usage:
 * ```tsx
 * <PageHeader
 *   icon={Users}
 *   title="Applications"
 *   description="Manage job applications"
 *   breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Applications" }]}
 *   actions={<Button>Export</Button>}
 * />
 * ```
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  breadcrumbs,
  className
}: PageHeaderProps) {
  return (
    <div data-internal-header="page" className={cn("mb-4", className)}>
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
        >
          {breadcrumbs.map((item, index) => {
            const isCurrent = index === breadcrumbs.length - 1;
            return (
              <span key={index} className="flex min-w-0 items-center gap-1">
                {index > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
                {item.href ? (
                  <Link
                    href={item.href}
                    className="truncate rounded-sm transition-colors duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className="truncate font-medium text-foreground"
                    aria-current={isCurrent ? "page" : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {/* Title row */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-[18px] w-[18px] text-primary" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground md:text-[26px] [text-wrap:balance]">
              {title}
            </h1>
            {description && (
              <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        {actions && (
          <div
            className={cn(
              "flex shrink-0 flex-wrap items-center gap-2 md:justify-end",
              INTERNAL_TOUCH_ACTIONS,
            )}
          >
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
