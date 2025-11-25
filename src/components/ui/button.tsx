import * as React from "react";
import { cn } from "@/lib/utils";

// We need to install class-variance-authority for this pattern, or just write it manually. 
// For now, I'll write it manually to avoid extra deps if possible, but CVA is standard in shadcn/ui which is what I'm mimicking. 
// Actually, I'll just write a simple switch for now to save a dependency, or install it. 
// Installing class-variance-authority is better for long term.

// Let's stick to simple props for now to keep it light, but I'll structure it so it's easy to read.

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "xl";
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => {
    
    const baseStyles = "inline-flex items-center justify-center rounded-lg font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bingo-accent disabled:pointer-events-none disabled:opacity-50 active:scale-95 transition-transform";
    
    const variants = {
      primary: "bg-gradient-to-r from-bingo-primary to-pink-600 text-white hover:from-pink-600 hover:to-pink-700 shadow-lg shadow-pink-500/20",
      secondary: "bg-bingo-surface text-white hover:bg-slate-700 border border-slate-700",
      outline: "border-2 border-bingo-primary text-bingo-primary hover:bg-bingo-primary hover:text-white",
      ghost: "hover:bg-slate-800 text-slate-300 hover:text-white",
      danger: "bg-red-600 text-white hover:bg-red-700",
    };

    const sizes = {
      sm: "h-8 px-3 text-xs",
      md: "h-10 px-4 py-2",
      lg: "h-12 px-8 text-lg",
      xl: "h-16 px-8 text-xl w-full", // Great for Host main buttons
    };

    return (
      <button
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        ref={ref}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
