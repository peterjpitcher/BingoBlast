import React, { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { DialogCloseButton } from "@/components/ui/modal";
import { useDialog } from "@/components/ui/use-dialog";

interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** The sheet's name. Shown as its heading unless `header` replaces it. */
  title: string;
  /** The gold label above the title. */
  kicker?: string;
  /** A sage line under the title. */
  description?: React.ReactNode;
  /**
   * Replaces the default heading block, for a sheet whose top changes with
   * state (the claim sheet's count, then its verdict). `title` still names the
   * dialog for screen readers.
   */
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Pinned under the scrolling body, above a gold hairline. */
  footer?: React.ReactNode;
  /**
   * 'tall' is a fixed 92 percent of the screen (the claim sheet, whose grid
   * should not jump as its header changes); 'auto' grows with its content to
   * 88 percent at most.
   */
  size?: "tall" | "auto";
  showCloseButton?: boolean;
  className?: string;
  bodyClassName?: string;
}

/**
 * A bottom sheet: it slides up over the scrim in 300ms and carries the gold
 * rule along its top edge. Same focus trap and Escape handling as Modal. It
 * does not close on a tap outside, so a stray touch cannot throw away a claim
 * the host is half way through.
 */
export function Sheet({
  isOpen,
  onClose,
  title,
  kicker,
  description,
  header,
  children,
  footer,
  size = "auto",
  showCloseButton = true,
  className,
  bodyClassName,
}: SheetProps): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useDialog(isOpen, containerRef);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-scrim backdrop-blur-[4px] animate-fade-in">
      <div
        ref={containerRef}
        className={cn(
          "mx-auto flex w-full max-w-2xl flex-col rounded-t-card border-t-[3px] border-anchor-gold-bright bg-anchor-green-card text-anchor-cream-text shadow-sheet animate-sheet-up",
          size === "tall" ? "h-[92dvh]" : "max-h-[88dvh]",
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={header ? undefined : titleId}
        aria-label={header ? title : undefined}
      >
        {header ? (
          <div className="shrink-0 px-4 pb-3 pt-4">{header}</div>
        ) : (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line-gold p-4">
            <div className="flex min-w-0 flex-col gap-1">
              {kicker ? <Kicker>{kicker}</Kicker> : null}
              <h2 id={titleId} className="text-[26px] leading-[1.05] text-anchor-cream-text">{title}</h2>
              {description ? <p className="text-sm text-anchor-sage">{description}</p> : null}
            </div>
            {showCloseButton ? <DialogCloseButton onClose={onClose} /> : null}
          </div>
        )}

        <div className={cn("min-h-0 flex-1 overflow-y-auto px-4", !footer && "pb-7", bodyClassName)}>
          {children}
        </div>

        {footer ? (
          <div className="flex shrink-0 flex-col gap-3 border-t border-line-gold bg-anchor-green-card px-4 pb-7 pt-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
