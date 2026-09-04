import type { ReactNode } from "react";
import Layout from "@/components/Layout";
import {
  INTERNAL_PAGE_BACKGROUND,
  INTERNAL_PAGE_CONTAINER,
} from "@/lib/internal-page-theme";
import { cn } from "@/lib/utils";

interface InternalPageShellProps {
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  noFooter?: boolean;
}

/**
 * Internal workspace shell (Wave 3.5B).
 *
 * The content column inherits the compact rhythm from `INTERNAL_PAGE_CONTAINER`
 * so every page's first work surface starts at the same, early vertical origin
 * across loading, empty, error and loaded states. `data-workspace-content`
 * marks the column for the density contract tests.
 */
export function InternalPageShell({
  children,
  className,
  containerClassName,
  noFooter,
}: InternalPageShellProps) {
  return (
    <Layout noFooter={noFooter ?? false}>
      <div className={cn(INTERNAL_PAGE_BACKGROUND, className)}>
        <div
          data-workspace-content=""
          className={cn(INTERNAL_PAGE_CONTAINER, containerClassName)}
        >
          {children}
        </div>
      </div>
    </Layout>
  );
}
