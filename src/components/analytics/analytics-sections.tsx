"use client"

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  Check,
  Eye,
  Megaphone,
  MessageSquare,
  Reply,
  Users,
  UsersRound,
  XCircle,
  Zap,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import {
  campaignRates,
  computeRates,
  ratePercent,
} from '@/lib/analytics/calculations'
import type { AnalyticsBundle } from '@/lib/analytics/queries'
import { RateCard, ProgressBar, formatPercent } from '@/components/dashboard/rate-card'
import { EmptyState } from '@/components/dashboard/empty-state'
import { SkeletonCard, Skeleton } from '@/components/dashboard/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { FunnelLineChart } from './funnel-line-chart'
import { bucketLabel, FUNNEL_COLORS } from './chart-utils'

const fmt = (n: number) => n.toLocaleString()

function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`flex flex-col rounded-xl border border-border bg-card ${className ?? ''}`}>
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </header>
      <div className="flex-1 p-5">{children}</div>
    </section>
  )
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonCard key={i} className="h-[150px]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <Skeleton className="h-[300px] w-full" />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <Skeleton className="h-[300px] w-full" />
        </div>
      </div>
    </div>
  )
}

// --- Overview -----------------------------------------------------------

export function OverviewSection({ data }: { data: AnalyticsBundle }) {
  const t = useTranslations('Analytics')
  const { totals } = data
  const rates = computeRates(totals)
  const total = totals.inbound + totals.outbound
  const ofOutbound = (part: number) =>
    t('ofOutbound', { part: fmt(part), total: fmt(totals.outbound) })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <RateCard
          title={t('kpi.totalMessages')}
          value={fmt(total)}
          percent={ratePercent(totals.outbound, total)}
          caption={t('inOut', { outbound: fmt(totals.outbound), inbound: fmt(totals.inbound) })}
          icon={MessageSquare}
          iconClassName="bg-blue-500/10 text-blue-500"
          barClassName="bg-gradient-to-r from-blue-500 to-sky-400"
        />
        <RateCard
          title={t('kpi.deliveryRate')}
          value={formatPercent(rates.deliveryRate)}
          percent={rates.deliveryRate}
          caption={ofOutbound(totals.delivered)}
          icon={Check}
          iconClassName="bg-emerald-500/10 text-emerald-500"
          barClassName="bg-gradient-to-r from-emerald-500 to-teal-400"
        />
        <RateCard
          title={t('kpi.readRate')}
          value={formatPercent(rates.readRate)}
          percent={rates.readRate}
          caption={ofOutbound(totals.read)}
          icon={Eye}
          iconClassName="bg-violet-500/10 text-violet-500"
          barClassName="bg-gradient-to-r from-purple-500 to-pink-500"
        />
        <RateCard
          title={t('kpi.replyRate')}
          value={formatPercent(rates.replyRate)}
          percent={rates.replyRate}
          caption={t('replies', { count: totals.inbound })}
          icon={Reply}
          iconClassName="bg-amber-500/10 text-amber-500"
          barClassName="bg-gradient-to-r from-amber-500 to-yellow-400"
        />
        <RateCard
          title={t('kpi.failureRate')}
          value={formatPercent(rates.failureRate)}
          percent={rates.failureRate}
          caption={ofOutbound(totals.failed)}
          icon={XCircle}
          iconClassName="bg-red-500/10 text-red-500"
          barClassName="bg-gradient-to-r from-red-500 to-rose-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title={t('performanceTitle')}
          description={t('performanceDesc')}
          className="lg:col-span-2"
        >
          {totals.outbound === 0 ? (
            <EmptyState icon={MessageSquare} title={t('noMessages')} hint={t('noMessagesHint')} />
          ) : (
            <FunnelLineChart
              ariaLabel={t('performanceTitle')}
              data={data.series.map((p) => ({ ...p, label: bucketLabel(p.key) }))}
              series={[
                { key: 'sent', label: t('series.sent'), color: FUNNEL_COLORS.sent },
                { key: 'delivered', label: t('series.delivered'), color: FUNNEL_COLORS.delivered },
                { key: 'read', label: t('series.read'), color: FUNNEL_COLORS.read },
              ]}
            />
          )}
        </Panel>

        <Panel title={t('summaryTitle')} description={t('summaryDesc')}>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <SummaryStat icon={Zap} tint="bg-emerald-500/10 text-emerald-500" label={t('summary.activeCampaigns')} value={data.activeCampaigns} />
            <SummaryStat icon={Megaphone} tint="bg-primary/10 text-primary" label={t('summary.totalCampaigns')} value={data.campaigns.length} />
            <SummaryStat icon={Users} tint="bg-blue-500/10 text-blue-500" label={t('summary.uniqueContacts')} value={data.uniqueContacts} />
            <SummaryStat icon={UsersRound} tint="bg-violet-500/10 text-violet-500" label={t('summary.totalRecipients')} value={data.totalRecipients} />
          </dl>
        </Panel>
      </div>
    </div>
  )
}

function SummaryStat({
  icon: Icon,
  tint,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>
  tint: string
  label: string
  value: number
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/40 p-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <dt className="truncate text-xs text-muted-foreground">{label}</dt>
        <dd className="text-lg font-bold tabular-nums text-foreground">{fmt(value)}</dd>
      </div>
    </div>
  )
}

// --- Messages -----------------------------------------------------------

export function MessagesSection({ data }: { data: AnalyticsBundle }) {
  const t = useTranslations('Analytics')
  const totalByType = data.contentTypes.reduce((s, c) => s + c.count, 0)
  const hasMessages = data.totals.inbound + data.totals.outbound > 0

  return (
    <div className="space-y-4">
      <Panel title={t('directionTitle')} description={t('directionDesc')}>
        {!hasMessages ? (
          <EmptyState icon={MessageSquare} title={t('noMessages')} hint={t('noMessagesHint')} />
        ) : (
          <FunnelLineChart
            ariaLabel={t('directionTitle')}
            data={data.series.map((p) => ({ ...p, label: bucketLabel(p.key) }))}
            series={[
              { key: 'outbound', label: t('series.outbound'), color: FUNNEL_COLORS.sent },
              { key: 'inbound', label: t('series.inbound'), color: FUNNEL_COLORS.replied },
            ]}
          />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={t('contentTypesTitle')} description={t('contentTypesDesc')}>
          {data.contentTypes.length === 0 ? (
            <EmptyState title={t('noMessages')} />
          ) : (
            <ul className="space-y-3">
              {data.contentTypes.map((c) => {
                const pct = ratePercent(c.count, totalByType)
                return (
                  <li key={c.key}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-foreground">{contentTypeLabel(t, c.key)}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {fmt(c.count)} · {formatPercent(pct)}
                      </span>
                    </div>
                    <ProgressBar percent={pct} label={contentTypeLabel(t, c.key)} />
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>

        <Panel title={t('failuresTitle')} description={t('failuresDesc')}>
          {data.failureReasons.length === 0 ? (
            <EmptyState icon={Check} title={t('noFailures')} hint={t('noFailuresHint')} />
          ) : (
            <ul className="divide-y divide-border">
              {data.failureReasons.map((r) => (
                <li key={`${r.code}-${r.title}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {r.title || t('unknownReason')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.code !== null ? t('errorCode', { code: String(r.code) }) : t('noCode')}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{fmt(r.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

const KNOWN_CONTENT_TYPES = [
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
] as const

function contentTypeLabel(t: ReturnType<typeof useTranslations>, key: string): string {
  return (KNOWN_CONTENT_TYPES as readonly string[]).includes(key)
    ? t(`contentType.${key}`)
    : key
}

// --- Campaigns ----------------------------------------------------------

export function CampaignsSection({ data }: { data: AnalyticsBundle }) {
  const t = useTranslations('Analytics')

  if (data.campaigns.length === 0) {
    return (
      <EmptyState
        icon={Megaphone}
        title={t('noCampaigns')}
        hint={t('noCampaignsHint')}
        className="min-h-60"
      />
    )
  }

  return (
    <section className="rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">{t('table.campaign')}</TableHead>
            <TableHead className="text-right">{t('table.recipients')}</TableHead>
            <TableHead className="text-right">{t('table.sent')}</TableHead>
            <TableHead className="text-right">{t('table.delivered')}</TableHead>
            <TableHead className="text-right">{t('table.read')}</TableHead>
            <TableHead className="text-right">{t('table.replied')}</TableHead>
            <TableHead className="text-right">{t('table.failed')}</TableHead>
            <TableHead className="text-right">{t('table.deliveryPct')}</TableHead>
            <TableHead className="text-right">{t('table.readPct')}</TableHead>
            <TableHead className="pr-5 text-right">{t('table.created')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.campaigns.map((c) => {
            const r = campaignRates(c)
            return (
              <TableRow key={c.id}>
                <TableCell className="pl-5">
                  <Link href={`/broadcasts/${c.id}`} className="font-medium text-foreground hover:text-primary">
                    {c.name}
                  </Link>
                  <p className="text-xs capitalize text-muted-foreground">{c.status}</p>
                </TableCell>
                <NumCell value={c.total_recipients} />
                <NumCell value={c.sent_count} />
                <NumCell value={c.delivered_count} />
                <NumCell value={c.read_count} />
                <NumCell value={c.replied_count} />
                <NumCell value={c.failed_count} />
                <TableCell className="text-right tabular-nums">{formatPercent(r.deliveryRate)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(r.readRate)}</TableCell>
                <TableCell className="pr-5 text-right whitespace-nowrap text-muted-foreground">
                  {new Date(c.created_at).toLocaleDateString()}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}

function NumCell({ value }: { value: number | null }) {
  return <TableCell className="text-right tabular-nums">{fmt(value ?? 0)}</TableCell>
}
