import type { HTMLAttributes, ReactNode } from "react";
import {
  INTERNAL_PANEL,
  INTERNAL_PANEL_MUTED,
} from "@/lib/internal-page-theme";
import { cn } from "@/lib/utils";

interface InternalPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: "default" | "muted";
}

export function InternalPanel({
  children,
  className,
  variant = "default",
  ...props
}: InternalPanelProps) {
  return (
    <div
      className={cn(variant === "muted" ? INTERNAL_PANEL_MUTED : INTERNAL_PANEL, className)}
      {...props}
    >
      {children}
    </div>
  );
}
