import { format } from 'date-fns'

/** Series colours — CSS tokens defined per mode in globals.css. */
export const FUNNEL_COLORS = {
  sent: 'var(--series-sent)',
  delivered: 'var(--series-delivered)',
  read: 'var(--series-read)',
  replied: 'var(--series-replied)',
} as const

/**
 * Axis label for a series bucket key: `YYYY-MM-DD` → "Oct 2",
 * `HH` → "14:00".
 */
export function bucketLabel(key: string): string {
  if (/^\d{2}$/.test(key)) return `${key}:00`
  const [y, m, d] = key.split('-').map(Number)
  if (!y || !m || !d) return key
  return format(new Date(y, m - 1, d), 'MMM d')
}
