import * as React from "react";
import { cn } from "@/lib/utils";

interface CardStyleOptions {
  /** The signature gold rule along the top edge. */
  accent?: boolean;
  /** Link cards: lift 3px on hover. */
  hover?: boolean;
  className?: string;
}

/**
 * The dark card's classes, for an element that is not a div (a link card).
 * Crisp 3px corners and a gold hairline on the card green.
 */
export function cardClass({ accent = false, hover = false, className }: CardStyleOptions = {}): string {
  return cn(
    "rounded-card border border-line-gold bg-anchor-green-card text-anchor-cream-text",
    accent && "border-t-[3px] border-t-anchor-gold-bright",
    hover &&
      "transition-[translate,box-shadow] duration-200 ease-anchor motion-safe:hover:-translate-y-[3px] hover:shadow-lift",
    className,
  );
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement>, Omit<CardStyleOptions, "className"> {}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, accent, hover, ...props }, ref) => (
    <div ref={ref} className={cardClass({ accent, hover, className })} {...props} />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1.5 p-5", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("font-display text-2xl leading-tight text-anchor-cream-text", className)}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-5 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardContent };
