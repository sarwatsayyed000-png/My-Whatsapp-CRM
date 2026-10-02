import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Growth } from '@/lib/analytics/calculations'

/** Horizontal 0–100% bar. `barClassName` sets the fill (solid or gradient). */
export function ProgressBar({
  percent,
  barClassName = 'bg-primary',
  label,
}: {
  percent: number
  barClassName?: string
  /** Accessible name; the bar is otherwise purely visual. */
  label?: string
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500', barClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export function formatPercent(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`
}

/**
 * Wide card: title + icon tile, big value, a progress bar and a muted
 * caption underneath ("32 of 35 messages").
 */
export function RateCard({
  title,
  value,
  percent,
  caption,
  icon: Icon,
  iconClassName = 'bg-muted text-muted-foreground',
  barClassName,
  extra,
}: {
  title: string
  value: string
  percent: number
  caption?: ReactNode
  icon: ComponentType<{ className?: string }>
  iconClassName?: string
  barClassName?: string
  /** Rendered next to the value, e.g. a growth badge. */
  extra?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            iconClassName,
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <p className="text-[28px] leading-none font-bold tabular-nums text-foreground">{value}</p>
        {extra}
      </div>
      <div className="mt-4">
        <ProgressBar percent={percent} barClassName={barClassName} label={title} />
      </div>
      {caption && <p className="mt-2 text-xs text-muted-foreground tabular-nums">{caption}</p>}
    </div>
  )
}

/** Arrow + percentage for a period-over-period comparison. */
export function GrowthBadge({ growth, newLabel }: { growth: Growth; newLabel: string }) {
  const tone =
    growth.direction === 'up'
      ? 'bg-emerald-500/10 text-emerald-500'
      : growth.direction === 'down'
        ? 'bg-red-500/10 text-red-500'
        : 'bg-muted text-muted-foreground'
  const Arrow =
    growth.direction === 'up' ? ArrowUp : growth.direction === 'down' ? ArrowDown : Minus
  const text =
    growth.percent === null
      ? newLabel
      : `${growth.percent > 0 ? '+' : ''}${formatPercent(growth.percent)}`
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        tone,
      )}
    >
      <Arrow className="h-3 w-3" aria-hidden />
      {text}
    </span>
  )
}
