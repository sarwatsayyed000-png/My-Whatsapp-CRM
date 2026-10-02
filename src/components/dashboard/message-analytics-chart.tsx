"use client"

import { MessageSquare } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { SeriesPoint } from '@/lib/analytics/calculations'
import type { MessageRange } from '@/lib/analytics/queries'
import { FunnelLineChart, RangeToggle } from '@/components/analytics/funnel-line-chart'
import { bucketLabel, FUNNEL_COLORS } from '@/components/analytics/chart-utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface Props {
  series: Record<MessageRange, SeriesPoint[] | null>
  loading: boolean
  range: MessageRange
  onRangeChange: (r: MessageRange) => void
}

export function MessageAnalyticsChart({ series, loading, range, onRangeChange }: Props) {
  const t = useTranslations('Dashboard.messageAnalytics')
  const data = series[range]

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <RangeToggle<MessageRange>
          value={range}
          onChange={onRangeChange}
          options={[
            { value: 1, label: t('today') },
            { value: 7, label: t('days7') },
            { value: 30, label: t('days30') },
          ]}
        />
      </header>
      <div className="flex-1 p-5">
        {loading || !data ? (
          <Skeleton className="h-[290px] w-full" />
        ) : data.every((p) => p.outbound === 0 && p.inbound === 0) ? (
          <EmptyState icon={MessageSquare} title={t('empty')} hint={t('emptyHint')} />
        ) : (
          <FunnelLineChart
            ariaLabel={t('ariaLabel')}
            data={data.map((p) => ({ ...p, label: bucketLabel(p.key) }))}
            series={[
              { key: 'sent', label: t('sent'), color: FUNNEL_COLORS.sent },
              { key: 'delivered', label: t('delivered'), color: FUNNEL_COLORS.delivered },
              { key: 'read', label: t('read'), color: FUNNEL_COLORS.read },
              { key: 'replied', label: t('replied'), color: FUNNEL_COLORS.replied },
            ]}
          />
        )}
      </div>
    </section>
  )
}
