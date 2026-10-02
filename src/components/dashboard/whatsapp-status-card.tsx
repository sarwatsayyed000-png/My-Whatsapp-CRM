"use client"

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Activity, Gauge, Phone, Send, ShieldCheck } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

export interface WhatsAppStatus {
  configured: boolean
  connected: boolean
  phone: string | null
  verified_name: string | null
  quality_rating: string | null
  messaging_limit_tier: string | null
  meta_reachable: boolean
}

const QUALITY_TONE: Record<string, string> = {
  GREEN: 'text-emerald-500',
  YELLOW: 'text-amber-500',
  RED: 'text-red-500',
}

/** "TIER_1K" → "1K / day", "TIER_UNLIMITED" → "Unlimited". */
function formatTier(tier: string | null, unlimited: string, perDay: (v: string) => string) {
  if (!tier) return null
  const v = tier.replace(/^TIER_/, '')
  if (v === 'UNLIMITED') return unlimited
  return perDay(v)
}

export function WhatsAppStatusCard({ sentToday }: { sentToday: number | null }) {
  const t = useTranslations('Dashboard.apiStatus')
  const [status, setStatus] = useState<WhatsAppStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/whatsapp/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: WhatsAppStatus | null) => {
        if (!cancelled) setStatus(s)
      })
      .catch((err) => console.error('[dashboard] whatsapp status failed:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const unknown = t('unknown')
  const connected = !!status?.connected && status.meta_reachable
  const stateLabel = !status?.configured
    ? t('notConfigured')
    : connected
      ? t('connected')
      : t('disconnected')
  const quality = status?.quality_rating?.toUpperCase() ?? null
  const qualityLabel =
    quality === 'GREEN'
      ? t('qualityHigh')
      : quality === 'YELLOW'
        ? t('qualityMedium')
        : quality === 'RED'
          ? t('qualityLow')
          : unknown

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        {!loading && (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
              connected ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                connected ? 'bg-emerald-500' : 'bg-muted-foreground',
              )}
              aria-hidden
            />
            {stateLabel}
          </span>
        )}
      </header>
      <div className="flex-1 p-5">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : (
          <dl className="space-y-3 text-sm">
            <Row icon={Phone} label={t('phone')}>
              <span className="tabular-nums">{status?.phone ?? unknown}</span>
            </Row>
            <Row icon={ShieldCheck} label={t('quality')}>
              <span className={cn(quality ? QUALITY_TONE[quality] : undefined)}>{qualityLabel}</span>
            </Row>
            <Row icon={Gauge} label={t('tier')}>
              {formatTier(
                status?.messaging_limit_tier ?? null,
                t('unlimited'),
                (v) => t('perDay', { value: v }),
              ) ?? unknown}
            </Row>
            <Row icon={Send} label={t('sentToday')}>
              <span className="tabular-nums">{sentToday === null ? '—' : sentToday.toLocaleString()}</span>
            </Row>
          </dl>
        )}
        {!loading && !connected && (
          <Link
            href="/settings?tab=whatsapp"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Activity className="h-3.5 w-3.5" />
            {t('configure')}
          </Link>
        )}
      </div>
    </section>
  )
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </div>
  )
}
