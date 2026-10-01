import { useEffect } from "react";
import type { RefObject } from "react";

// How many dialogs and sheets are open. The page scroll is locked while any
// is, and released only when the last one closes, so closing a dialog that
// sits over a sheet does not unlock the page under the sheet.
let openCount = 0;

/**
 * Shared behaviour for Modal and Sheet while open: lock the page scroll, trap
 * keyboard focus inside the dialog, and return focus to the element that
 * opened it when it closes. Escape is forwarded to the dialog's close button
 * (`data-modal-close`), so a dialog without one cannot be dismissed by key.
 */
export function useDialog(open: boolean, container: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    if (!open) return;
    openCount += 1;
    document.body.style.overflow = "hidden";
    return () => {
      openCount -= 1;
      if (openCount === 0) document.body.style.overflow = "unset";
    };
  }, [open]);

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
      // Return focus to the element that opened the dialog.
      previouslyFocused?.focus?.();
    };
  }, [open, container]);
}
