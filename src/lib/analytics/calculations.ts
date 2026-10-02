// Pure calculation helpers shared by the dashboard and the /analytics
// page. Everything here is synchronous and side-effect free so it can
// be unit tested without a database — the query layer
// (`./queries.ts`) only fetches rows and hands them to these.

export type SenderType = 'customer' | 'agent' | 'bot'

/** Minimal message shape the aggregations need. */
export interface MessageStatRow {
  created_at: string
  sender_type: SenderType | string
  status: string
  content_type?: string | null
  conversation_id?: string | null
  error_code?: number | null
  error_title?: string | null
}

/** agent + bot messages are outbound; customer messages are inbound. */
export function isOutbound(senderType: string): boolean {
  return senderType === 'agent' || senderType === 'bot'
}

/**
 * `part ÷ whole` as a percentage rounded to one decimal, clamped to
 * 0–100. A zero (or negative) denominator yields 0 rather than NaN so
 * the UI can render an empty bar instead of "NaN%".
 */
export function ratePercent(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0
  const pct = (part / whole) * 100
  return Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10
}

export type GrowthDirection = 'up' | 'down' | 'flat'

export interface Growth {
  /**
   * Percentage change from `previous` to `current`, rounded to one
   * decimal. `null` when there is no baseline (previous = 0 and
   * current > 0) — "infinite" growth renders as "New" in the UI.
   */
  percent: number | null
  direction: GrowthDirection
}

export function growth(current: number, previous: number): Growth {
  const direction: GrowthDirection =
    current > previous ? 'up' : current < previous ? 'down' : 'flat'
  if (previous <= 0) {
    return { percent: current > 0 ? null : 0, direction }
  }
  const pct = ((current - previous) / previous) * 100
  return { percent: Math.round(pct * 10) / 10, direction }
}

export interface StatusTotals {
  inbound: number
  outbound: number
  /** Outbound that reached Meta: sent + delivered + read. */
  sent: number
  /** Outbound that reached the handset: delivered + read. */
  delivered: number
  read: number
  failed: number
}

export function emptyTotals(): StatusTotals {
  return { inbound: 0, outbound: 0, sent: 0, delivered: 0, read: 0, failed: 0 }
}

/**
 * Mutates `t` with one message. Status is the message's *current*
 * status, which is cumulative on the WhatsApp side (a read message was
 * also delivered and sent), so each successive state counts towards
 * the earlier buckets too.
 */
function addToTotals(t: StatusTotals, senderType: string, status: string) {
  if (!isOutbound(senderType)) {
    t.inbound += 1
    return
  }
  t.outbound += 1
  if (status === 'failed') {
    t.failed += 1
    return
  }
  if (status === 'sent' || status === 'delivered' || status === 'read') t.sent += 1
  if (status === 'delivered' || status === 'read') t.delivered += 1
  if (status === 'read') t.read += 1
}

export function tallyStatuses(
  rows: Pick<MessageStatRow, 'sender_type' | 'status'>[],
): StatusTotals {
  const t = emptyTotals()
  for (const r of rows) addToTotals(t, r.sender_type, r.status)
  return t
}

export interface Rates {
  deliveryRate: number
  readRate: number
  replyRate: number
  failureRate: number
}

/**
 * Headline rates. Every rate uses outbound messages as the
 * denominator so the bars are comparable side by side. Reply rate is
 * inbound ÷ outbound, capped at 100% (a chatty customer can send more
 * messages than they receive).
 */
export function computeRates(t: StatusTotals): Rates {
  return {
    deliveryRate: ratePercent(t.delivered, t.outbound),
    readRate: ratePercent(t.read, t.outbound),
    replyRate: ratePercent(Math.min(t.inbound, t.outbound), t.outbound),
    failureRate: ratePercent(t.failed, t.outbound),
  }
}

// --- Time series -------------------------------------------------------

export interface SeriesPoint {
  /** Bucket key — `YYYY-MM-DD` for daily series, `HH` for hourly. */
  key: string
  sent: number
  delivered: number
  read: number
  /** Inbound customer messages in the bucket. */
  replied: number
  failed: number
  inbound: number
  outbound: number
}

/**
 * Bucket rows into the given keys (in order). Rows whose key isn't in
 * `keys` are dropped, and keys with no rows still produce a zero point
 * so the chart shows an unbroken line.
 */
export function bucketSeries(
  rows: Pick<MessageStatRow, 'created_at' | 'sender_type' | 'status'>[],
  keys: string[],
  keyFor: (createdAt: string) => string,
): SeriesPoint[] {
  const buckets = new Map<string, StatusTotals>()
  for (const k of keys) buckets.set(k, emptyTotals())
  for (const r of rows) {
    const b = buckets.get(keyFor(r.created_at))
    if (b) addToTotals(b, r.sender_type, r.status)
  }
  return keys.map((key) => {
    const b = buckets.get(key) ?? emptyTotals()
    return {
      key,
      sent: b.sent,
      delivered: b.delivered,
      read: b.read,
      replied: b.inbound,
      failed: b.failed,
      inbound: b.inbound,
      outbound: b.outbound,
    }
  })
}

/** `00`…`23` — keys for an hourly "today" series. */
export const HOUR_KEYS: string[] = Array.from({ length: 24 }, (_, h) =>
  String(h).padStart(2, '0'),
)

export function localHourKey(iso: string): string {
  return String(new Date(iso).getHours()).padStart(2, '0')
}

// --- Breakdowns --------------------------------------------------------

export interface CountSlice {
  key: string
  count: number
}

export function contentTypeBreakdown(
  rows: Pick<MessageStatRow, 'content_type'>[],
): CountSlice[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    const k = r.content_type || 'text'
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

export interface FailureReason {
  code: number | null
  title: string
  count: number
}

/**
 * Group failed outbound messages by Meta error code (migration 042).
 * Messages that failed before 042 shipped (or failed synchronously)
 * have no code and fall into a single "unknown" bucket (title '').
 */
export function topFailureReasons(
  rows: Pick<MessageStatRow, 'sender_type' | 'status' | 'error_code' | 'error_title'>[],
  limit = 5,
): FailureReason[] {
  const map = new Map<string, FailureReason>()
  for (const r of rows) {
    if (r.status !== 'failed' || !isOutbound(r.sender_type)) continue
    const code = r.error_code ?? null
    const title = (r.error_title ?? '').trim()
    const key = code !== null ? `c:${code}` : `t:${title}`
    const existing = map.get(key)
    if (existing) {
      existing.count += 1
      if (!existing.title && title) existing.title = title
    } else {
      map.set(key, { code, title, count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

export function uniqueCount(values: (string | null | undefined)[]): number {
  const set = new Set<string>()
  for (const v of values) if (v) set.add(v)
  return set.size
}

// --- Campaigns ---------------------------------------------------------

export interface BroadcastCounts {
  total_recipients: number | null
  sent_count: number | null
  delivered_count: number | null
  read_count: number | null
  replied_count: number | null
  failed_count: number | null
}

/**
 * Broadcast counters are cumulative (migration 005: a `read` recipient
 * bumps sent, delivered and read), so delivered ÷ recipients and
 * read ÷ recipients are the honest funnel rates.
 */
export function campaignRates(b: BroadcastCounts): { deliveryRate: number; readRate: number } {
  const recipients = b.total_recipients ?? 0
  return {
    deliveryRate: ratePercent(b.delivered_count ?? 0, recipients),
    readRate: ratePercent(b.read_count ?? 0, recipients),
  }
}

// --- Formatting --------------------------------------------------------

/**
 * Mask a phone number for display, keeping the country-code-ish prefix
 * and the last two digits: "+1 555 123 4567" → "+1 5•• ••• ••67".
 * Separators are preserved so the masked value keeps its familiar shape.
 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digitCount = (phone.match(/\d/g) ?? []).length
  if (digitCount <= 4) return phone
  let seen = 0
  return phone.replace(/\d/g, (d) => {
    seen += 1
    return seen <= 2 || seen > digitCount - 2 ? d : '•'
  })
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
}
