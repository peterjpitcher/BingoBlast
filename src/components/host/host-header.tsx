import * as React from "react";
import Link from "next/link";
import { ChevronLeft, LogOut } from "lucide-react";
import { signout } from "@/app/login/actions";
import { AnchorLogo } from "@/components/ui/logo";

interface HostHeaderProps {
  /** The first line: "Host console", or the session name on the live game. */
  title: string;
  /** The second line: the signed-in email, or the game's status line. */
  children?: React.ReactNode;
  /** Shows the back button when set. */
  backHref?: string;
  backLabel?: string;
}

const ICON_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors duration-150 hover:bg-white/[0.06]";

/**
 * The sticky phone header shared by the host console and the live game: an
 * optional back button, the wordmark, a two-line title block and sign out.
 * The top padding clears the phone's status bar.
 */
export function HostHeader({ title, children, backHref, backLabel = "Back to host console" }: HostHeaderProps): React.ReactElement {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-line-gold bg-anchor-green-deep/[0.92] px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] backdrop-blur-md">
      {backHref ? (
        <Link href={backHref} aria-label={backLabel} className={`${ICON_BUTTON} text-anchor-cream-text`}>
          <ChevronLeft aria-hidden="true" size={22} strokeWidth={2} />
        </Link>
      ) : null}
      <AnchorLogo height={backHref ? 34 : 36} priority />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pl-1">
        <h1 className="truncate font-sans text-[15px] font-semibold leading-tight tracking-normal text-anchor-cream-text">{title}</h1>
        {children}
      </div>
      <form action={signout}>
        <button type="submit" aria-label="Sign out" className={`${ICON_BUTTON} text-anchor-sage`}>
          <LogOut aria-hidden="true" size={20} strokeWidth={2} />
        </button>
      </form>
    </header>
  );
}

/**
 * The live game's status line under the session name: a dot in the book
 * colour, then "Game 2 · Blue book" set as a small kicker.
 */
export function HostHeaderGameStatus({ bookColour, children }: { bookColour: string; children: React.ReactNode }): React.ReactElement {
  return (
    // The colour word is how a colour-blind host knows which book is in play,
    // so on a narrow phone the line wraps rather than being cut short.
    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase leading-snug tracking-[0.14em] text-anchor-gold-bright">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-anchor-cream-text"
        style={{ backgroundColor: bookColour }}
      />
      <span>{children}</span>
    </span>
  );
}
