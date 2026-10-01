import * as React from "react";
import { cn } from "@/lib/utils";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/**
 * The field surface shared by inputs, selects and textareas: sunk into the
 * page green, cream text, a gold hairline that brightens on focus. Set
 * `aria-invalid` for the error border.
 */
export const fieldClass =
  "w-full min-h-[52px] rounded-input border border-line-strong bg-anchor-green-deep px-4 py-3 font-sans text-[17px] leading-snug text-anchor-cream-text " +
  "placeholder:text-anchor-sage transition-[border-color,box-shadow] duration-200 " +
  "focus:border-anchor-gold-bright focus:shadow-[0_0_0_4px_rgba(201,160,32,0.15)] focus:outline-none focus-visible:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-45 aria-[invalid=true]:border-anchor-danger " +
  "file:border-0 file:bg-transparent file:text-base file:font-medium file:text-anchor-cream-text";

/** The label above a field: Outfit 600, 14px, cream. */
export const fieldLabelClass = "font-sans text-sm font-semibold text-anchor-cream-text";

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(fieldClass, className)}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
