"use client"

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface LineSeries<K extends string> {
  key: K
  label: string
  /** CSS colour — use the --series-* tokens so light/dark both hold. */
  color: string
}

interface FunnelLineChartProps<K extends string> {
  data: (Record<K, number> & { label: string })[]
  series: LineSeries<K>[]
  height?: number
  ariaLabel: string
}

/**
 * Thin multi-series line chart with a crosshair tooltip and a legend
 * row (identity is never colour-alone: the legend + tooltip name every
 * series). Axes and grid stay recessive so the lines carry the read.
 */
export function FunnelLineChart<K extends string>({
  data,
  series,
  height = 260,
  ariaLabel,
}: FunnelLineChartProps<K>) {
  return (
    <div>
      <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              minTickGap={16}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: 'var(--muted-foreground)', strokeOpacity: 0.4 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium text-foreground">{label}</p>
                    {series.map((s) => {
                      const item = payload.find((p) => p.dataKey === s.key)
                      return (
                        <div key={s.key} className="flex items-center gap-2 text-muted-foreground">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: s.color }}
                            aria-hidden
                          />
                          <span>{s.label}</span>
                          <span className="ml-auto pl-3 font-medium tabular-nums text-foreground">
                            {Number(item?.value ?? 0).toLocaleString()}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              }}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Segmented control matching the dashboard's existing range toggle. */
export function RangeToggle<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={
            value === o.value
              ? 'rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors'
              : 'rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground'
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
