import React, { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { useDialog } from "@/components/ui/use-dialog";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  /** The gold label above the title ("Game 2 · Early Doors"). */
  kicker?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showCloseButton?: boolean;
  /** The gold rule along the top edge, for a dialog that announces something. */
  accent?: boolean;
  className?: string;
}

/** The round 44px close button shared by dialogs and sheets. */
export function DialogCloseButton({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      data-modal-close
      aria-label="Close"
      onClick={onClose}
      className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-anchor-cream-text transition-colors duration-150 hover:bg-white/[0.06]"
    >
      <X aria-hidden="true" size={20} strokeWidth={2} />
    </button>
  );
}

/**
 * A centred dialog card over the scrim. It fades up over 400ms. Keyboard focus
 * is trapped while it is open and Escape presses the close button; a dialog
 * with `showCloseButton={false}` must be answered with one of its own buttons.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  kicker,
  children,
  footer,
  className,
  accent = false,
  showCloseButton = true,
}: ModalProps): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useDialog(isOpen, containerRef);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-5 backdrop-blur-[4px] animate-fade-in">
      <div
        ref={containerRef}
        className={cn(
          "relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-card border border-line-strong bg-anchor-green-card text-anchor-cream-text shadow-sheet animate-fade-up",
          accent && "border-t-[3px] border-t-anchor-gold-bright",
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            {kicker ? <Kicker>{kicker}</Kicker> : null}
            <h2 id={titleId} className="text-[28px] leading-[1.05] text-anchor-cream-text">{title}</h2>
          </div>
          {showCloseButton ? <DialogCloseButton onClose={onClose} /> : null}
        </div>

        <div className="overflow-y-auto px-5 pb-5 text-[15px] leading-normal">
          {children}
        </div>

        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-5 pb-5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
