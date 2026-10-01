import * as React from "react";
import Image from "next/image";
import { Grain } from "@/components/ui/logo";

/**
 * The front door's backdrop (landing, sign in, pending): the bar photo under
 * a deep green wash, with film grain on top. The parent must be positioned
 * and the content above it must be `relative`.
 */
export function BrandBackdrop(): React.ReactElement {
  return (
    <>
      <Image
        src="/the-anchor-bar.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(12,29,17,0.7)_0%,rgba(12,29,17,0.95)_40%,var(--anchor-green-deep)_100%)]"
      />
      <Grain />
    </>
  );
}
