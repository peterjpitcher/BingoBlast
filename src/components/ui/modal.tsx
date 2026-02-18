import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children, footer, className }: ModalProps & { className?: string }) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className={cn(
          "relative w-full max-w-lg bg-[#003f27] border border-[#1f7c58] rounded-xl shadow-2xl animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col text-white", 
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between p-4 border-b border-[#1f7c58] shrink-0">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button 
            onClick={onClose}
            className="p-1 rounded-md text-white/70 hover:text-white hover:bg-[#0f6846] transition-colors"
          >
            ✕
          </button>
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
