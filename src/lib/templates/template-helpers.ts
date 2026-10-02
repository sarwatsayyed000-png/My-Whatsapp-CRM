// Pure helpers for the /templates page: filtering, status grouping,
// duplicate naming, and splitting template text into literal / variable
// segments for the WhatsApp-style preview. No React, no I/O — unit
// tested in template-helpers.test.ts.

import type { MessageTemplate, MessageTemplateStatus } from '@/types'

/** The filter tabs shown above the template list. */
export type StatusFilter = 'all' | 'approved' | 'pending' | 'rejected' | 'draft' | 'inactive'

export const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'approved',
  'pending',
  'rejected',
  'draft',
  'inactive',
]

/**
 * Collapse Meta's eight raw statuses into the five tabs a user cares
 * about. IN_APPEAL is still "waiting on Meta", so it sits with pending;
 * PAUSED / DISABLED / PENDING_DELETION can't be sent, so "inactive".
 */
export function statusGroup(status: MessageTemplateStatus | undefined): Exclude<StatusFilter, 'all'> {
  switch (status) {
    case 'APPROVED':
      return 'approved'
    case 'PENDING':
    case 'IN_APPEAL':
      return 'pending'
    case 'REJECTED':
      return 'rejected'
    case 'PAUSED':
    case 'DISABLED':
    case 'PENDING_DELETION':
      return 'inactive'
    case 'DRAFT':
    case undefined:
    default:
      return 'draft'
  }
}

export function countByStatus(
  templates: Pick<MessageTemplate, 'status'>[],
): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: templates.length,
    approved: 0,
    pending: 0,
    rejected: 0,
    draft: 0,
    inactive: 0,
  }
  for (const t of templates) counts[statusGroup(t.status)] += 1
  return counts
}

export interface TemplateFilters {
  query: string
  status: StatusFilter
  /** 'all' or a template category. */
  category: 'all' | MessageTemplate['category']
}

/** Case-insensitive match on name, body, footer, header text and language. */
export function filterTemplates<T extends MessageTemplate>(templates: T[], f: TemplateFilters): T[] {
  const q = f.query.trim().toLowerCase()
  return templates.filter((t) => {
    if (f.status !== 'all' && statusGroup(t.status) !== f.status) return false
    if (f.category !== 'all' && t.category !== f.category) return false
    if (!q) return true
    return [t.name, t.body_text, t.footer_text, t.header_content, t.language]
      .filter(Boolean)
      .some((s) => (s as string).toLowerCase().includes(q))
  })
}

/**
 * Name for a duplicated template. Meta names must match
 * `^[a-z0-9_]{1,512}$` and be unique per language, so we append
 * `_copy`, then `_copy_2`, `_copy_3`, … until it doesn't collide.
 */
export function duplicateName(name: string, existing: Iterable<string>): string {
  const taken = new Set(existing)
  const base = name.replace(/_copy(_\d+)?$/, '')
  const max = 512 // TEMPLATE_LIMITS.nameRegex upper bound
  const fit = (suffix: string) => `${base.slice(0, max - suffix.length)}${suffix}`
  let candidate = fit('_copy')
  for (let n = 2; taken.has(candidate); n++) candidate = fit(`_copy_${n}`)
  return candidate
}

export type TextSegment =
  | { kind: 'text'; value: string }
  /** `value` is the sample when one was given, otherwise `{{n}}`. */
  | { kind: 'var'; index: number; value: string; filled: boolean }

/**
 * Split template text on `{{n}}` placeholders so the preview can render
 * variables distinctly. A placeholder whose sample is blank stays as the
 * literal `{{n}}` (rendered highlighted) instead of disappearing.
 */
export function splitVariables(text: string, samples: string[] = []): TextSegment[] {
  const out: TextSegment[] = []
  const re = /\{\{\s*(\d+)\s*\}\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) })
    const index = Number(m[1])
    const sample = samples[index - 1]?.trim()
    out.push(
      sample
        ? { kind: 'var', index, value: sample, filled: true }
        : { kind: 'var', index, value: `{{${index}}}`, filled: false },
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) })
  return out
}
