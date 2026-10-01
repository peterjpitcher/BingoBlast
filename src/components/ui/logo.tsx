import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface AnchorLogoProps {
  /** Height in pixels. The wordmark is twice as wide as it is tall. */
  height: number;
  priority?: boolean;
  className?: string;
}

/**
 * The white Anchor wordmark, for every dark surface. Never recoloured.
 * The TV sizes it with a class instead (`className="h-[6.3vh] w-auto"`); the
 * height prop then only sets the intrinsic size.
 */
export function AnchorLogo({ height, priority = false, className }: AnchorLogoProps): React.ReactElement {
  return (
    <Image
      src="/the-anchor-pub-logo-white-transparent.png"
      alt="The Anchor"
      width={height * 2}
      height={height}
      priority={priority}
      className={cn("block w-auto shrink-0", className)}
      style={className ? undefined : { height, width: "auto" }}
    />
  );
}

/** Film grain over a full-screen dark surface (TV, landing, admin). The parent must be positioned. */
export function Grain({ className }: { className?: string }): React.ReactElement {
  return <div aria-hidden="true" className={cn("grain-overlay", className)} />;
}
