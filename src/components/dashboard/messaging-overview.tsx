"use client"

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  CalendarClock,
  CheckCheck,
  Check,
  Eye,
  FileCheck2,
  Megaphone,
  MessageSquare,
  Send,
  TrendingDown,
  TrendingUp,
  Users,
  UserPlus,
  XCircle,
} from 'lucide-react'
import { growth, ratePercent } from '@/lib/analytics/calculations'
import type { DashboardOverview } from '@/lib/analytics/queries'
import { MetricCard } from './metric-card'
import { GrowthBadge, RateCard, formatPercent } from './rate-card'
import { SkeletonCard } from './skeleton'

/** Stat cards + rate cards row shown at the top of the dashboard. */
export function MessagingStats({
  data,
  loading,
}: {
  data: DashboardOverview | null
  loading: boolean
}) {
  const t = useTranslations('Dashboard.overview')

  if (loading || !data) {
    return (
      <>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} className="h-[150px]" />
          ))}
        </div>
      </>
    )
  }

  const { totals } = data
  const fmt = (n: number) => n.toLocaleString()
  const deliveryRate = ratePercent(totals.delivered, totals.outbound)
  const readRate = ratePercent(totals.read, totals.outbound)
  const monthly = growth(data.contactsThisMonth, data.contactsLastMonth)
  // Bar for monthly growth: how this month compares with last month,
  // capped at 100% when we've already matched / beaten it.
  const monthlyBar =
    data.contactsLastMonth > 0
      ? ratePercent(data.contactsThisMonth, data.contactsLastMonth)
      : data.contactsThisMonth > 0
        ? 100
        : 0

  const outboundCaption = (part: number) =>
    t('ofMessages', { part: fmt(part), total: fmt(totals.outbound) })

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          title={t('totalContacts')}
          value={fmt(data.totalContacts)}
          icon={Users}
          iconClassName="bg-blue-500/10 text-blue-500"
        />
        <MetricCard
          title={t('totalMessages')}
          value={fmt(data.totalMessages)}
          icon={MessageSquare}
          iconClassName="bg-indigo-500/10 text-indigo-500"
        />
        <MetricCard
          title={t('messagesSent')}
          value={fmt(totals.sent)}
          icon={Send}
          iconClassName="bg-sky-500/10 text-sky-500"
        />
        <MetricCard
          title={t('messagesDelivered')}
          value={fmt(totals.delivered)}
          icon={Check}
          iconClassName="bg-emerald-500/10 text-emerald-500"
        />
        <MetricCard
          title={t('messagesRead')}
          value={fmt(totals.read)}
          icon={CheckCheck}
          iconClassName="bg-violet-500/10 text-violet-500"
        />
        <MetricCard
          title={t('messagesFailed')}
          value={fmt(totals.failed)}
          icon={XCircle}
          iconClassName="bg-red-500/10 text-red-500"
        />
        <MetricCard
          title={t('todaysMessages')}
          value={fmt(data.todaysMessages)}
          icon={CalendarClock}
          iconClassName="bg-amber-500/10 text-amber-500"
        />
        <MetricCard
          title={t('totalCampaigns')}
          value={fmt(data.totalCampaigns)}
          icon={Megaphone}
          iconClassName="bg-primary/10 text-primary"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <RateCard
          title={t('deliveryRate')}
          value={formatPercent(deliveryRate)}
          percent={deliveryRate}
          caption={outboundCaption(totals.delivered)}
          icon={Check}
          iconClassName="bg-emerald-500/10 text-emerald-500"
          barClassName="bg-gradient-to-r from-emerald-500 to-teal-400"
        />
        <RateCard
          title={t('readRate')}
          value={formatPercent(readRate)}
          percent={readRate}
          caption={outboundCaption(totals.read)}
          icon={Eye}
          iconClassName="bg-violet-500/10 text-violet-500"
          barClassName="bg-gradient-to-r from-purple-500 to-pink-500"
        />
        <RateCard
          title={t('monthlyGrowth')}
          value={
            monthly.percent === null
              ? t('new')
              : `${monthly.percent > 0 ? '+' : ''}${formatPercent(monthly.percent)}`
          }
          percent={monthlyBar}
          caption={t('monthCompare', {
            current: fmt(data.contactsThisMonth),
            previous: fmt(data.contactsLastMonth),
          })}
          icon={monthly.direction === 'down' ? TrendingDown : TrendingUp}
          iconClassName={
            monthly.direction === 'down'
              ? 'bg-red-500/10 text-red-500'
              : monthly.direction === 'up'
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-muted text-muted-foreground'
          }
          barClassName="bg-primary"
        />
      </div>
    </>
  )
}

/** "Contact Growth" + "Campaign Overview" stacked cards. */
export function GrowthAndCampaigns({
  data,
  loading,
}: {
  data: DashboardOverview | null
  loading: boolean
}) {
  const t = useTranslations('Dashboard.overview')

  if (loading || !data) {
    return (
      <div className="grid h-full grid-cols-1 gap-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    )
  }

  const weekly = growth(data.contactsThisWeek, data.contactsLastWeek)
  const fmt = (n: number) => n.toLocaleString()

  return (
    <div className="grid h-full grid-cols-1 gap-4">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('contactGrowth')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('contactGrowthDesc')}</p>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
            <UserPlus className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-4 flex items-baseline gap-2">
          <p className="text-[28px] leading-none font-bold tabular-nums text-foreground">
            {fmt(data.contactsThisWeek)}
          </p>
          <GrowthBadge growth={weekly} newLabel={t('new')} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
          {t('weekCompare', { previous: fmt(data.contactsLastWeek) })}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('campaignOverview')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('campaignOverviewDesc')}</p>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Megaphone className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Link
            href="/broadcasts"
            className="rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted"
          >
            <p className="text-xl font-bold tabular-nums text-foreground">{fmt(data.totalCampaigns)}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Megaphone className="h-3 w-3" /> {t('campaigns')}
            </p>
          </Link>
          <Link
            href="/templates"
            className="rounded-lg bg-muted/50 p-3 transition-colors hover:bg-muted"
          >
            <p className="text-xl font-bold tabular-nums text-foreground">{fmt(data.approvedTemplates)}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <FileCheck2 className="h-3 w-3" /> {t('approvedTemplates')}
            </p>
          </Link>
        </div>
      </section>
    </div>
  )
}
