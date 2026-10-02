// Marketing opt-out helpers (migration 043). Pure functions so the
// webhook and the broadcast sender share one definition of "the
// customer asked to stop", and so both are unit tested.

export type OptKeywordAction = 'opt_out' | 'opt_in'

// Whole-message keywords only. A word inside a longer sentence ("please
// don't stop my booking") must never unsubscribe someone, so we match
// the entire normalised message, not a substring. "CANCEL" is
// deliberately absent: for a travel business it usually means a booking.
const OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'STOP ALL',
  'STOPALL',
  'UNSUBSCRIBE',
  'OPT OUT',
  'OPTOUT',
  'OPT-OUT',
])

const OPT_IN_KEYWORDS = new Set([
  'START',
  'UNSTOP',
  'SUBSCRIBE',
  'OPT IN',
  'OPTIN',
  'OPT-IN',
])

/** Upper-case, trim, collapse whitespace, drop trailing punctuation. */
export function normalizeKeywordText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?。]+$/u, '')
    .trim()
    .toUpperCase()
}

/**
 * Classify an inbound message. Returns null for anything that isn't an
 * exact opt-out / opt-in keyword (the overwhelmingly common case).
 */
export function detectOptKeyword(text: string | null | undefined): OptKeywordAction | null {
  if (!text) return null
  const normalized = normalizeKeywordText(text)
  if (!normalized || normalized.length > 20) return null
  if (OPT_OUT_KEYWORDS.has(normalized)) return 'opt_out'
  if (OPT_IN_KEYWORDS.has(normalized)) return 'opt_in'
  return null
}

/** Column values to write for an opt-out / opt-in. */
export function optOutUpdate(
  action: OptKeywordAction,
  source: 'keyword' | 'manual',
  now: Date = new Date(),
): { opted_out: boolean; opted_out_at: string | null; opt_out_source: string | null } {
  return action === 'opt_out'
    ? { opted_out: true, opted_out_at: now.toISOString(), opt_out_source: source }
    : { opted_out: false, opted_out_at: null, opt_out_source: null }
}

/**
 * Drop opted-out contacts from a broadcast audience. Rows without the
 * column (database not yet migrated) count as subscribed, so sending
 * keeps working before 043 is applied.
 */
export function excludeOptedOut<T extends { opted_out?: boolean | null }>(
  contacts: T[],
): { kept: T[]; skipped: number } {
  const kept = contacts.filter((c) => c.opted_out !== true)
  return { kept, skipped: contacts.length - kept.length }
}
