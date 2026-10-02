import { describe, expect, it } from 'vitest'
import { detectOptKeyword, excludeOptedOut, normalizeKeywordText, optOutUpdate } from './opt-out'

describe('detectOptKeyword', () => {
  it('recognises opt-out keywords regardless of case, spacing and trailing punctuation', () => {
    for (const t of ['STOP', 'stop', ' Stop. ', 'Unsubscribe!', 'opt  out', 'OPT-OUT', 'stop all']) {
      expect(detectOptKeyword(t)).toBe('opt_out')
    }
  })

  it('recognises opt-in keywords', () => {
    for (const t of ['START', 'start', 'Subscribe', 'unstop', 'opt in']) {
      expect(detectOptKeyword(t)).toBe('opt_in')
    }
  })

  it('ignores keywords inside a longer message', () => {
    expect(detectOptKeyword("please don't stop my booking")).toBeNull()
    expect(detectOptKeyword('stop sending me promos please')).toBeNull()
    expect(detectOptKeyword('start date is Monday')).toBeNull()
  })

  it('does not treat CANCEL as an opt-out', () => {
    expect(detectOptKeyword('cancel')).toBeNull()
  })

  it('handles empty input', () => {
    expect(detectOptKeyword('')).toBeNull()
    expect(detectOptKeyword(null)).toBeNull()
    expect(detectOptKeyword(undefined)).toBeNull()
  })
})

describe('normalizeKeywordText', () => {
  it('collapses whitespace and strips trailing punctuation', () => {
    expect(normalizeKeywordText('  opt \n out!!  ')).toBe('OPT OUT')
  })
})

describe('optOutUpdate', () => {
  const now = new Date('2026-10-02T10:00:00Z')
  it('sets all three columns on opt-out', () => {
    expect(optOutUpdate('opt_out', 'keyword', now)).toEqual({
      opted_out: true,
      opted_out_at: '2026-10-02T10:00:00.000Z',
      opt_out_source: 'keyword',
    })
  })
  it('clears them on opt-in', () => {
    expect(optOutUpdate('opt_in', 'manual', now)).toEqual({
      opted_out: false,
      opted_out_at: null,
      opt_out_source: null,
    })
  })
})

describe('excludeOptedOut', () => {
  it('drops opted-out contacts and reports how many', () => {
    const res = excludeOptedOut([
      { id: 'a', opted_out: false },
      { id: 'b', opted_out: true },
      { id: 'c' },
      { id: 'd', opted_out: null },
    ])
    expect(res.kept.map((c) => c.id)).toEqual(['a', 'c', 'd'])
    expect(res.skipped).toBe(1)
  })
})
