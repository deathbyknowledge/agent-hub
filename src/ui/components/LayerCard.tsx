import type { ReactNode } from "react";
import { cn } from "../lib/utils";

interface LayerCardProps {
  children: ReactNode;
  className?: string;
}

export function LayerCard({ children, className }: LayerCardProps) {
  return (
    <div
      className={cn(
        "bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-sm text-neutral-900 dark:text-neutral-100",
        className
      )}
    >
      {children}
    </div>
  );
}

interface LayerCardContentProps {
  children: ReactNode;
  className?: string;
}

export function LayerCardContent({
  children,
  className
}: LayerCardContentProps) {
  return <div className={cn("p-4", className)}>{children}</div>;
}

interface LayerCardFooterProps {
  children: ReactNode;
  className?: string;
}

// Note: In the original code this is used as header, keeping the name for compatibility
export function LayerCardFooter({ children, className }: LayerCardFooterProps) {
  return (
    <div
      className={cn(
        "px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100",
        className
      )}
    >
      {children}
    </div>
  );
}
