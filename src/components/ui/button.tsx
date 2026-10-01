import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Anchor button: a pill in Outfit 600. Three variants make one emphasis
 * ladder, and a view has one `primary` at most; everything else is `outline`
 * or `ghost`.
 *
 * `tone="quiet"` is the sage ghost for destructive-but-quiet actions (Void,
 * Delete, Sign out). Disabled buttons stay on screen at 45 percent so the host
 * can see why an action is not available.
 */
export type ButtonVariant = "primary" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width. */
  block?: boolean;
  /** Ghost only: sage text for a quiet destructive action. */
  tone?: "default" | "quiet";
  className?: string;
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<ButtonStyleOptions, "className"> {
  isLoading?: boolean;
}

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-full border-2 border-transparent text-center font-sans font-semibold leading-tight " +
  "cursor-pointer transition-[translate,background-color,color,box-shadow,border-color] duration-150 ease-anchor " +
  "motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 " +
  "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-anchor-gold text-white hover:bg-anchor-gold-dark hover:shadow-gold",
  outline:
    "border-anchor-gold-bright text-anchor-gold-bright hover:bg-anchor-gold-bright hover:text-anchor-green-deep",
  ghost: "text-anchor-cream-text hover:bg-white/[0.06]",
};

// sm is 44px tall, the minimum touch target (spec 5.7). xl is the host's main
// action (Next number): a full-width block, 76px tall.
const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-11 px-6 text-sm",
  md: "min-h-12 px-8 text-base",
  lg: "min-h-14 px-12 text-lg",
  xl: "min-h-[76px] w-full px-6 text-[22px] font-bold uppercase tracking-[0.06em]",
};

/**
 * The button's classes, for a link that should look like a button
 * (`<Link className={buttonClass({ variant: 'outline', size: 'sm' })}>`).
 */
export function buttonClass({
  variant = "primary",
  size = "md",
  block = false,
  tone = "default",
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    BASE,
    VARIANTS[variant],
    SIZES[size],
    block && "w-full",
    variant === "ghost" && tone === "quiet" && "text-anchor-sage",
    className,
  );
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, tone, isLoading, children, disabled, ...props }, ref) => {
    return (
      <button
        className={buttonClass({ variant, size, block, tone, className })}
        ref={ref}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg className="h-5 w-5 shrink-0 animate-spin text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export { Button };
