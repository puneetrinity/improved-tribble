import { cn } from "@/lib/utils";
import Layout from "@/components/Layout";
import { Container } from "./Container";

interface PageShellProps {
  children: React.ReactNode;
  /**
   * Page variant determines styling context:
   * - "app": ATS/admin dashboards (light productivity theme)
   * - "public": Public-facing pages (dark marketing theme)
   * - "minimal": No container wrapping (for custom layouts)
   */
  variant?: "app" | "public" | "minimal";
  /**
   * Container max-width
   */
  containerSize?: "sm" | "md" | "lg" | "xl" | "full";
  /**
   * Additional className for the page wrapper
   */
  className?: string;
  /**
   * Disable the outer Layout wrapper (for special pages like auth)
   */
  noLayout?: boolean;
}

/**
 * PageShell - Unified page wrapper for all page types
 *
 * Wraps the existing Layout component and provides consistent:
 * - Container sizing and padding
 * - Theme context (app vs public)
 * - Spacing from fixed header (pt-8)
 *
 * Usage:
 * ```tsx
 * // ATS/Admin pages
 * <PageShell variant="app">
 *   <PageHeader title="Dashboard" icon={Shield} />
 *   <Section>Content here</Section>
 * </PageShell>
 *
 * // Public pages
 * <PageShell variant="public">
 *   <HeroSection />
 * </PageShell>
 *
 * // Custom layout pages
 * <PageShell variant="minimal">
 *   <FullWidthContent />
 * </PageShell>
 * ```
 */
export function PageShell({
  children,
  variant = "app",
  containerSize = "xl",
  className,
  noLayout = false
}: PageShellProps) {
  // App pages get container wrapping and consistent, compact padding
  // (Wave 3.5B: 20 px top so the page header and first action sit above the
  // fold; the global navigation already reserves its own height).
  const content = variant === "minimal" ? (
    <div className={cn("pt-5", className)}>
      {children}
    </div>
  ) : (
    <Container
      size={containerSize}
      className={cn(
        "pt-5 pb-10",
        // Add transition for loading states
        "transition-opacity duration-200",
        className
      )}
    >
      {children}
    </Container>
  );

  if (noLayout) {
    return content;
  }

  return <Layout>{content}</Layout>;
}

export default PageShell;
