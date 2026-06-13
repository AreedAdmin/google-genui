"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { NodeStatus, ChangeType } from "@trellis/shared";
import { statusVisual, changeTypeVisual, SEVERITY } from "@/lib/design";
import { Loader2 } from "lucide-react";

/**
 * Shared design-system primitives (component-library.md §5). Every status /
 * confidence / severity indicator pairs color with an icon AND text — color is
 * never the only signal (a11y §8).
 */

// ---- Button ----

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg hover:opacity-90 border border-transparent",
  secondary: "bg-surface text-fg border border-border-strong hover:bg-surface-2",
  ghost: "bg-transparent text-fg-muted hover:text-fg hover:bg-surface-2 border border-transparent",
  danger: "bg-[var(--st-failed)] text-white hover:opacity-90 border border-transparent",
  subtle: "bg-surface-2 text-fg hover:bg-border border border-transparent",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        buttonVariants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ---- IconButton ----

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted",
        "hover:bg-surface-2 hover:text-fg transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

// ---- Badge / Chip ----

export function Badge({
  children,
  className,
  tone,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[11px] font-medium leading-none",
        className,
      )}
      style={tone ? { color: `var(--${tone})`, borderColor: `color-mix(in srgb, var(--${tone}) 40%, var(--border))` } : undefined}
    >
      {children}
    </span>
  );
}

// ---- StatusPill ----

export function StatusPill({ status, size = "md" }: { status: NodeStatus; size?: "sm" | "md" }) {
  const v = statusVisual(status);
  const Icon = v.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium leading-none",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
      )}
      style={{
        color: `var(--${v.token})`,
        background: `color-mix(in srgb, var(--${v.token}) 12%, transparent)`,
      }}
    >
      <Icon size={11} className={status === "running" ? "animate-spin" : ""} aria-hidden />
      <span>{v.label}</span>
    </span>
  );
}

// ---- ChangeTypeBadge ----

export function ChangeTypeBadge({ changeType, withLabel = true }: { changeType: ChangeType; withLabel?: boolean }) {
  const v = changeTypeVisual(changeType);
  const Icon = v.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: `var(--${v.token})` }}>
      <Icon size={13} aria-hidden />
      {withLabel && <span>{v.label}</span>}
    </span>
  );
}

// ---- ConfidenceMeter (4-dot scale) ----

export function ConfidenceMeter({ value, showNumber = false }: { value: number; showNumber?: boolean }) {
  const filled = Math.round(value * 4);
  const low = value < 0.5;
  return (
    <span
      className="inline-flex items-center gap-1"
      title={`confidence ${(value * 100).toFixed(0)}%${low ? " — low confidence" : ""}`}
      aria-label={`confidence ${(value * 100).toFixed(0)} percent${low ? ", low confidence" : ""}`}
    >
      <span className="inline-flex gap-0.5" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: i < filled ? (low ? "var(--st-blocked)" : "var(--accent)") : "var(--border-strong)",
            }}
          />
        ))}
      </span>
      {showNumber && <span className={cn("text-[11px] tabular-nums", low ? "text-[var(--st-blocked)]" : "text-fg-muted")}>{value.toFixed(2)}</span>}
      {low && <span className="text-[10px] font-medium text-[var(--st-blocked)]">low</span>}
    </span>
  );
}

// ---- SeverityTag ----

export function SeverityTag({ severity }: { severity: "low" | "medium" | "high" }) {
  const s = SEVERITY[severity];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: `var(--${s.token})`, background: `color-mix(in srgb, var(--${s.token}) 14%, transparent)` }}
    >
      {s.label}
    </span>
  );
}

// ---- Panel / Section ----

export function Panel({
  title,
  actions,
  children,
  className,
  defaultOpen = true,
  collapsible = false,
  count,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  count?: number;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className={cn("rounded-lg border border-border bg-surface", className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 px-3.5 py-2.5">
          {collapsible ? (
            <button
              onClick={() => setOpen((o) => !o)}
              className="flex items-center gap-1.5 text-sm font-semibold text-fg hover:text-accent"
              aria-expanded={open}
            >
              <span className={cn("text-fg-muted transition-transform", open ? "rotate-90" : "")}>▸</span>
              {title}
              {typeof count === "number" && <span className="text-fg-muted">({count})</span>}
            </button>
          ) : (
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              {title}
              {typeof count === "number" && <span className="text-fg-muted">({count})</span>}
            </h3>
          )}
          {actions}
        </header>
      )}
      {(!collapsible || open) && <div className="px-3.5 pb-3.5">{children}</div>}
    </section>
  );
}

// ---- Skeleton ----

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} />;
}

// ---- EmptyState ----

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
      {icon && <div className="text-fg-muted">{icon}</div>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {hint && <p className="max-w-sm text-xs text-fg-muted">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// ---- DataTable (dense, change-tinted rows) ----

export function DataTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-border", className)}>
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  );
}

export function changeRowTint(change?: string): React.CSSProperties | undefined {
  switch (change) {
    case "added":
      return { background: "color-mix(in srgb, var(--st-built) 9%, transparent)" };
    case "removed":
      return { background: "color-mix(in srgb, var(--st-failed) 9%, transparent)" };
    case "changed":
      return { background: "color-mix(in srgb, var(--st-blocked) 9%, transparent)" };
    default:
      return undefined;
  }
}
