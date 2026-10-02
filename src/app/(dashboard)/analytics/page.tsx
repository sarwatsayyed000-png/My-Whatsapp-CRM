"use client"

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Download } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toCsv } from '@/lib/analytics/calculations'
import {
  loadAnalytics,
  type AnalyticsBundle,
  type AnalyticsRange,
} from '@/lib/analytics/queries'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RangeToggle } from '@/components/analytics/funnel-line-chart'
import {
  AnalyticsSkeleton,
  CampaignsSection,
  MessagesSection,
  OverviewSection,
} from '@/components/analytics/analytics-sections'

const TAB_TRIGGER = 'data-active:bg-muted data-active:text-primary text-muted-foreground px-3'

export default function AnalyticsPage() {
  const t = useTranslations('Analytics')
  const [range, setRange] = useState<AnalyticsRange>(30)
  // Per-range cache, same pattern as the dashboard's conversations chart.
  const [cache, setCache] = useState<Partial<Record<AnalyticsRange, AnalyticsBundle>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // State updates only happen in promise callbacks so the initial
  // fetch can run from an effect (react-hooks/set-state-in-effect).
  const load = useCallback((r: AnalyticsRange) => {
    loadAnalytics(createClient(), r)
      .then((b) => setCache((prev) => ({ ...prev, [r]: b })))
      .catch((err) => {
        console.error('[analytics] load failed:', err)
        setError(true)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(30)
  }, [load])

  const fetchRange = (r: AnalyticsRange) => {
    setLoading(true)
    setError(false)
    load(r)
  }

  const handleRange = (r: AnalyticsRange) => {
    setRange(r)
    if (!cache[r]) fetchRange(r)
  }

  const data = cache[range]

  const handleExport = () => {
    if (!data) return
    const csv = toCsv(
      ['date', 'sent', 'delivered', 'read', 'replied', 'failed', 'inbound', 'outbound'],
      data.series.map((p) => [
        p.key,
        p.sent,
        p.delivered,
        p.read,
        p.replied,
        p.failed,
        p.inbound,
        p.outbound,
      ]),
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `message-analytics-${range}d-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangeToggle<AnalyticsRange>
            value={range}
            onChange={handleRange}
            options={[
              { value: 7, label: t('range.days7') },
              { value: 30, label: t('range.days30') },
              { value: 90, label: t('range.months3') },
            ]}
          />
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!data}>
            <Download className="h-4 w-4" />
            {t('export')}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="overview" className={TAB_TRIGGER}>
            {t('tabs.overview')}
          </TabsTrigger>
          <TabsTrigger value="messages" className={TAB_TRIGGER}>
            {t('tabs.messages')}
          </TabsTrigger>
          <TabsTrigger value="campaigns" className={TAB_TRIGGER}>
            {t('tabs.campaigns')}
          </TabsTrigger>
        </TabsList>

        {(loading && !data) || (!data && !error) ? (
          <AnalyticsSkeleton />
        ) : !data ? (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
            <p className="text-sm text-muted-foreground">{t('loadError')}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchRange(range)}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <>
            <TabsContent value="overview">
              <OverviewSection data={data} />
            </TabsContent>
            <TabsContent value="messages">
              <MessagesSection data={data} />
            </TabsContent>
            <TabsContent value="campaigns">
              <CampaignsSection data={data} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  )
}
