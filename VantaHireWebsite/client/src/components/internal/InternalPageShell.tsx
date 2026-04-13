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

export function InternalPageShell({
  children,
  className,
  containerClassName,
  noFooter,
}: InternalPageShellProps) {
  return (
    <Layout noFooter={noFooter ?? false}>
      <div className={cn(INTERNAL_PAGE_BACKGROUND, className)}>
        <div className={cn(INTERNAL_PAGE_CONTAINER, containerClassName)}>
          {children}
        </div>
      </div>
    </Layout>
  );
}
