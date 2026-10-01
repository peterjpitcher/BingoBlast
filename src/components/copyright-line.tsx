import * as React from "react";
import { getTodayIsoDateInLondon } from "@/lib/dates";

/** The copyright notice, with the year as it is in London. */
export function copyrightText(): string {
  const year = getTodayIsoDateInLondon().slice(0, 4);
  return `© ${year} Orange Jelly Limited. All rights reserved.`;
}

/** The small sage copyright line under the landing and sign-in screens. */
export function CopyrightLine({ className }: { className?: string }): React.ReactElement {
  return (
    <p className={className ?? "text-center text-xs text-anchor-sage"} suppressHydrationWarning>
      {copyrightText()}
    </p>
  );
}
