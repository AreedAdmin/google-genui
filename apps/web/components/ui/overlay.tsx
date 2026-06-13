"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { IconButton } from "./primitives";

/**
 * Lightweight, focus-trapped overlay primitives (Dialog + Sheet). Esc closes;
 * focus is trapped while open and restored on close (component-library.md §8).
 */

function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement>) {
  React.useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab" || !el) return;
      const focusables = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, ref]);
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);

  React.useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0" style={{ background: "var(--overlay)" }} onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md animate-fade-in rounded-xl border border-border bg-surface shadow-modal outline-none"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="px-4 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  children,
  width = 460,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  label: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);

  React.useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 z-40 transition-opacity",
        open ? "opacity-100" : "opacity-0",
      )}
      aria-hidden={!open}
    >
      <div
        className={cn("absolute inset-0 transition-opacity", open ? "pointer-events-auto opacity-100" : "opacity-0")}
        style={{ background: "var(--overlay)" }}
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn(
          "absolute right-0 top-0 h-full border-l border-border bg-surface shadow-modal outline-none transition-transform duration-200",
          open ? "pointer-events-auto translate-x-0" : "translate-x-full",
        )}
        style={{ width }}
      >
        {children}
      </div>
    </div>
  );
}
