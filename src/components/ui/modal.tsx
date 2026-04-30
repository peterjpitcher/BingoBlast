import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showCloseButton?: boolean;
}

/**
 * Trap keyboard focus inside the modal while open and return focus to the
 * previously-focused element when it closes. Forwards Escape to the modal's
 * close button so consumers don't have to wire it twice.
 */
function useFocusTrap(open: boolean, container: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open || !container.current) return;
    const root = container.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    // Move focus inside the dialog. Prefer the close button so screen readers
    // announce the dialog title without trapping users on a destructive action.
    const initial =
      root.querySelector<HTMLButtonElement>('[data-modal-close]') ?? focusable()[0];
    initial?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        root.querySelector<HTMLButtonElement>('[data-modal-close]')?.click();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      // Return focus to the element that opened the modal.
      previouslyFocused?.focus?.();
    };
  }, [open, container]);
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className,
  showCloseButton = true,
}: ModalProps & { className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  useFocusTrap(isOpen, containerRef);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        ref={containerRef}
        className={cn(
          "relative w-full max-w-lg bg-[#003f27] border border-[#1f7c58] rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col text-white",
          className
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#1f7c58] shrink-0">
          <h2 id={titleId} className="text-lg font-bold text-white">{title}</h2>
          {showCloseButton ? (
            <button
              type="button"
              data-modal-close
              aria-label="Close"
              onClick={onClose}
              className="p-2.5 rounded-md text-white/70 hover:text-white hover:bg-[#0f6846] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a57626]"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className="p-4 overflow-y-auto">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 p-4 border-t border-[#1f7c58] shrink-0 bg-[#003f27] rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
