"use client";

// Small presentational pieces shared by the CRM & Deals views.

import type { ComponentType, ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export function initials(name?: string | null, fallback?: string | null) {
  const source = (name || fallback || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.charAt(0).toUpperCase() || "?";
}

/** Native select styled like the rest of the app's form controls. */
export function NativeSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select
        {...props}
        className="h-9 w-full appearance-none rounded-lg border border-border bg-card pl-3 pr-8 text-sm text-foreground outline-none transition-colors hover:bg-muted focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function AgentChip({
  name,
  unassignedLabel,
  className,
}: {
  name?: string | null;
  unassignedLabel: string;
  className?: string;
}) {
  if (!name) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground",
          className,
        )}
      >
        {unassignedLabel}
      </span>
    );
  }
  return (
    <span
      title={name}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-primary",
        className,
      )}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
        {initials(name)}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function StagePill({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ borderColor: `${color}55`, backgroundColor: `${color}1a`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}

const TONES = {
  red: "border-red-500/25 bg-red-500/5 text-red-600 dark:text-red-400",
  green: "border-emerald-500/25 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400",
  amber: "border-amber-500/25 bg-amber-500/5 text-amber-600 dark:text-amber-400",
  indigo: "border-indigo-500/25 bg-indigo-500/5 text-indigo-600 dark:text-indigo-400",
  primary: "border-primary/25 bg-primary/5 text-primary",
  neutral: "border-border bg-card text-foreground",
} as const;

export type Tone = keyof typeof TONES;

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: ComponentType<{ className?: string }>;
  tone?: Tone;
}) {
  return (
    <div className={cn("rounded-xl border p-4", TONES[tone])}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider opacity-90">{label}</p>
        <Icon className="h-4 w-4 shrink-0 opacity-80" />
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EmptyPanel({
  icon: Icon,
  title,
  hint,
  tone = "neutral",
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  tone?: "neutral" | "success";
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-4 py-10 text-center">
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full",
          tone === "success"
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

export function ProgressBar({ percent, met }: { percent: number; met?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", met ? "bg-emerald-500" : "bg-primary")}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

/** Small switch row used in the settings dialogs. */
export function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  );
}
