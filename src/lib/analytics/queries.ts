import type { SupabaseClient } from '@supabase/supabase-js'
import {
  daysAgoStart,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from '@/lib/dashboard/date-utils'
import {
  bucketSeries,
  contentTypeBreakdown,
  HOUR_KEYS,
  localHourKey,
  tallyStatuses,
  topFailureReasons,
  uniqueCount,
  type BroadcastCounts,
  type CountSlice,
  type FailureReason,
  type MessageStatRow,
  type SeriesPoint,
  type StatusTotals,
} from './calculations'

// ------------------------------------------------------------
// Like src/lib/dashboard/queries.ts, every query runs as the signed-in
// user and relies on RLS (account membership, migration 017) for
// scoping — no user_id / account_id filters here.
//
// Headline totals use `count: 'exact', head: true` so they are exact
// regardless of table size. Time series fetch rows and aggregate in
// JS; those fetches page through PostgREST's max-rows cap so a busy
// month isn't silently truncated at 1,000 rows.
// ------------------------------------------------------------

type DB = SupabaseClient

const OUTBOUND = ['agent', 'bot']
const PAGE_SIZE = 1000
/** Safety valve: 50k rows is far beyond the "low thousands" this
 *  client-side aggregation is designed for. */
const MAX_PAGES = 50

const MESSAGE_COLUMNS =
  'created_at, sender_type, status, content_type, conversation_id, error_code, error_title'

async function fetchMessagesSince(db: DB, sinceIso: string): Promise<MessageStatRow[]> {
  const out: MessageStatRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await db
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = (data ?? []) as MessageStatRow[]
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

function startOfLocalMonth(monthsBack = 0): Date {
  const d = startOfLocalDay()
  d.setDate(1)
  d.setMonth(d.getMonth() - monthsBack)
  return d
}

function count(res: { count: number | null }): number {
  return res.count ?? 0
}

// --- Dashboard overview -----------------------------------------------

export interface DashboardOverview {
  totalContacts: number
  totalMessages: number
  todaysMessages: number
  sentToday: number
  totalCampaigns: number
  approvedTemplates: number
  totals: StatusTotals
  contactsThisMonth: number
  contactsLastMonth: number
  contactsThisWeek: number
  contactsLastWeek: number
}

export async function loadDashboardOverview(db: DB): Promise<DashboardOverview> {
  const today = startOfLocalDay().toISOString()
  const thisMonth = startOfLocalMonth(0).toISOString()
  const lastMonth = startOfLocalMonth(1).toISOString()
  const mondayOffset = mondayIndex(new Date())
  const thisWeek = daysAgoStart(mondayOffset).toISOString()
  const lastWeek = daysAgoStart(mondayOffset + 7).toISOString()

  const headCount = { count: 'exact' as const, head: true }
  const outbound = () => db.from('messages').select('id', headCount).in('sender_type', OUTBOUND)

  const [
    contacts,
    messages,
    inbound,
    out,
    sent,
    delivered,
    read,
    failed,
    todays,
    sentToday,
    broadcasts,
    templates,
    cThisMonth,
    cLastMonth,
    cThisWeek,
    cLastWeek,
  ] = await Promise.all([
    db.from('contacts').select('id', headCount),
    db.from('messages').select('id', headCount),
    db.from('messages').select('id', headCount).eq('sender_type', 'customer'),
    outbound(),
    outbound().in('status', ['sent', 'delivered', 'read']),
    outbound().in('status', ['delivered', 'read']),
    outbound().eq('status', 'read'),
    outbound().eq('status', 'failed'),
    db.from('messages').select('id', headCount).gte('created_at', today),
    outbound().gte('created_at', today),
    db.from('broadcasts').select('id', headCount),
    db.from('message_templates').select('id', headCount).eq('status', 'APPROVED'),
    db.from('contacts').select('id', headCount).gte('created_at', thisMonth),
    db
      .from('contacts')
      .select('id', headCount)
      .gte('created_at', lastMonth)
      .lt('created_at', thisMonth),
    db.from('contacts').select('id', headCount).gte('created_at', thisWeek),
    db
      .from('contacts')
      .select('id', headCount)
      .gte('created_at', lastWeek)
      .lt('created_at', thisWeek),
  ])

  return {
    totalContacts: count(contacts),
    totalMessages: count(messages),
    todaysMessages: count(todays),
    sentToday: count(sentToday),
    totalCampaigns: count(broadcasts),
    approvedTemplates: count(templates),
    totals: {
      inbound: count(inbound),
      outbound: count(out),
      sent: count(sent),
      delivered: count(delivered),
      read: count(read),
      failed: count(failed),
    },
    contactsThisMonth: count(cThisMonth),
    contactsLastMonth: count(cLastMonth),
    contactsThisWeek: count(cThisWeek),
    contactsLastWeek: count(cLastWeek),
  }
}

// --- Message analytics chart -----------------------------------------

/** 1 = today (hourly buckets); otherwise the last N days, daily. */
export type MessageRange = 1 | 7 | 30

export async function loadMessageSeries(db: DB, range: MessageRange): Promise<SeriesPoint[]> {
  const since = daysAgoStart(range - 1).toISOString()
  const rows = await fetchMessagesSince(db, since)
  if (range === 1) return bucketSeries(rows, HOUR_KEYS, localHourKey)
  return bucketSeries(rows, lastNDayKeys(range), localDayKey)
}

// --- Analytics page ----------------------------------------------------

export type AnalyticsRange = 7 | 30 | 90

export interface CampaignRow extends BroadcastCounts {
  id: string
  name: string
  status: string
  created_at: string
}

export interface AnalyticsBundle {
  range: AnalyticsRange
  totals: StatusTotals
  series: SeriesPoint[]
  contentTypes: CountSlice[]
  failureReasons: FailureReason[]
  uniqueContacts: number
  campaigns: CampaignRow[]
  activeCampaigns: number
  totalRecipients: number
}

export async function loadAnalytics(db: DB, range: AnalyticsRange): Promise<AnalyticsBundle> {
  const since = daysAgoStart(range - 1).toISOString()

  const [rows, broadcastsRes, activeRes] = await Promise.all([
    fetchMessagesSince(db, since),
    db
      .from('broadcasts')
      .select(
        'id, name, status, created_at, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count',
      )
      .gte('created_at', since)
      .order('created_at', { ascending: false }),
    db
      .from('broadcasts')
      .select('id', { count: 'exact', head: true })
      .in('status', ['scheduled', 'sending']),
  ])
  if (broadcastsRes.error) throw broadcastsRes.error

  const campaigns = (broadcastsRes.data ?? []) as CampaignRow[]

  return {
    range,
    totals: tallyStatuses(rows),
    series: bucketSeries(rows, lastNDayKeys(range), localDayKey),
    contentTypes: contentTypeBreakdown(rows),
    failureReasons: topFailureReasons(rows),
    // One conversation per contact (migration 036 dedups them), so
    // distinct conversations ≈ distinct contacts engaged in the range.
    uniqueContacts: uniqueCount(rows.map((r) => r.conversation_id)),
    campaigns,
    activeCampaigns: activeRes.count ?? 0,
    totalRecipients: campaigns.reduce((s, c) => s + (c.total_recipients ?? 0), 0),
  }
}
