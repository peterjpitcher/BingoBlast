import * as React from "react";
import { cn } from "@/lib/utils";

interface KickerProps extends React.HTMLAttributes<HTMLElement> {
  /** The element to render: a span by default, a p or div where it stands alone. */
  as?: "span" | "p" | "div";
}

/**
 * The section label used everywhere: Outfit 600, 12px, tracked, gold. It is
 * the only ALL-CAPS text in the app, and the capitals come from CSS, so write
 * the label in sentence case. Tight cards pass `className="text-[11px]"`.
 */
export function Kicker({ as: Tag = "span", className, ...props }: KickerProps): React.ReactElement {
  return <Tag className={cn("kicker", className)} {...props} />;
}
