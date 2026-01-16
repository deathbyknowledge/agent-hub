import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "../lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-white text-black border-white hover:bg-black hover:text-white hover:border-white",
  secondary:
    "bg-transparent text-white border-white/50 hover:border-white hover:bg-white/10",
  ghost:
    "bg-transparent text-white/70 border-transparent hover:text-white hover:bg-white/10",
  danger:
    "bg-transparent text-[#ff0000] border-[#ff0000] hover:bg-[#ff0000] hover:text-black"
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-[11px] gap-1.5 uppercase tracking-wider",
  md: "px-3 py-1.5 text-xs gap-2 uppercase tracking-wider",
  lg: "px-4 py-2 text-sm gap-2 uppercase tracking-wider"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "primary",
  size = "md",
  icon,
  className,
  children,
  disabled,
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-medium border transition-all duration-100",
        "focus:outline-none focus:ring-1 focus:ring-white",
        "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-current",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});
