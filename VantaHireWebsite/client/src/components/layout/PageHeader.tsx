import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
 * PageHeader - Consistent page header with icon, title, description, actions, and breadcrumbs
 *
 * Replaces the 40+ variations of page header patterns across the codebase:
 * - `<div className="flex items-center gap-3 mb-8">...`
 * - `<div className="flex items-center gap-3 pt-8 mb-4">...`
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
    <div className={cn("mb-6", className)}>
      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground sm:text-sm">
          {breadcrumbs.map((item, index) => (
            <span key={index} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight className="h-3.5 w-3.5" />}
              {item.href ? (
                <Link
                  href={item.href}
                  className="truncate transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="truncate font-medium text-foreground">{item.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* Title row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div className="flex-shrink-0 rounded-lg bg-primary/10 p-2">
              <Icon className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground sm:text-2xl md:text-3xl">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground md:text-base">
                {description}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        {actions && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
