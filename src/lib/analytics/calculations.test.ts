import { describe, expect, it } from 'vitest'
import {
  bucketSeries,
  campaignRates,
  computeRates,
  contentTypeBreakdown,
  growth,
  isOutbound,
  maskPhone,
  ratePercent,
  tallyStatuses,
  toCsv,
  topFailureReasons,
  uniqueCount,
} from './calculations'

describe('ratePercent', () => {
  it('returns a one-decimal percentage', () => {
    expect(ratePercent(32, 35)).toBe(91.4)
    expect(ratePercent(1, 3)).toBe(33.3)
    expect(ratePercent(5, 5)).toBe(100)
  })
  it('returns 0 for an empty or invalid denominator', () => {
    expect(ratePercent(3, 0)).toBe(0)
    expect(ratePercent(0, 0)).toBe(0)
    expect(ratePercent(3, -1)).toBe(0)
    expect(ratePercent(NaN, 10)).toBe(0)
  })
  it('clamps to 0–100', () => {
    expect(ratePercent(12, 10)).toBe(100)
    expect(ratePercent(-2, 10)).toBe(0)
  })
})

describe('growth', () => {
  it('computes percentage change with direction', () => {
    expect(growth(15, 10)).toEqual({ percent: 50, direction: 'up' })
    expect(growth(5, 10)).toEqual({ percent: -50, direction: 'down' })
    expect(growth(10, 10)).toEqual({ percent: 0, direction: 'flat' })
    expect(growth(2, 3)).toEqual({ percent: -33.3, direction: 'down' })
  })
  it('has no percentage when there is no baseline', () => {
    expect(growth(4, 0)).toEqual({ percent: null, direction: 'up' })
    expect(growth(0, 0)).toEqual({ percent: 0, direction: 'flat' })
  })
})

describe('tallyStatuses / computeRates', () => {
  const rows = [
    { sender_type: 'agent', status: 'sent' },
    { sender_type: 'agent', status: 'delivered' },
    { sender_type: 'bot', status: 'read' },
    { sender_type: 'agent', status: 'read' },
    { sender_type: 'agent', status: 'failed' },
    { sender_type: 'agent', status: 'sending' },
    { sender_type: 'customer', status: 'sent' },
    { sender_type: 'customer', status: 'read' },
  ]

  it('treats statuses as cumulative', () => {
    expect(tallyStatuses(rows)).toEqual({
      inbound: 2,
      outbound: 6,
      sent: 4,
      delivered: 3,
      read: 2,
      failed: 1,
    })
  })

  it('derives rates against outbound', () => {
    expect(computeRates(tallyStatuses(rows))).toEqual({
      deliveryRate: 50,
      readRate: 33.3,
      replyRate: 33.3,
      failureRate: 16.7,
    })
  })

  it('caps reply rate at 100%', () => {
    const t = tallyStatuses([
      { sender_type: 'agent', status: 'read' },
      { sender_type: 'customer', status: 'sent' },
      { sender_type: 'customer', status: 'sent' },
    ])
    expect(computeRates(t).replyRate).toBe(100)
  })

  it('is all zeros with no messages', () => {
    expect(computeRates(tallyStatuses([]))).toEqual({
      deliveryRate: 0,
      readRate: 0,
      replyRate: 0,
      failureRate: 0,
    })
  })

  it('classifies sender types', () => {
    expect(isOutbound('agent')).toBe(true)
    expect(isOutbound('bot')).toBe(true)
    expect(isOutbound('customer')).toBe(false)
  })
})

describe('bucketSeries', () => {
  it('zero-fills missing keys and drops out-of-range rows', () => {
    const rows = [
      { created_at: 'a', sender_type: 'agent', status: 'read' },
      { created_at: 'a', sender_type: 'customer', status: 'sent' },
      { created_at: 'c', sender_type: 'agent', status: 'failed' },
      { created_at: 'z', sender_type: 'agent', status: 'sent' },
    ]
    const series = bucketSeries(rows, ['a', 'b', 'c'], (x) => x)
    expect(series.map((p) => p.key)).toEqual(['a', 'b', 'c'])
    expect(series[0]).toMatchObject({ sent: 1, delivered: 1, read: 1, replied: 1, outbound: 1 })
    expect(series[1]).toMatchObject({ sent: 0, outbound: 0, inbound: 0 })
    expect(series[2]).toMatchObject({ failed: 1, sent: 0, outbound: 1 })
  })
})

describe('breakdowns', () => {
  it('counts content types, defaulting to text', () => {
    expect(
      contentTypeBreakdown([
        { content_type: 'image' },
        { content_type: null },
        { content_type: 'text' },
      ]),
    ).toEqual([
      { key: 'text', count: 2 },
      { key: 'image', count: 1 },
    ])
  })

  it('groups failures by code and ignores inbound / non-failed', () => {
    const reasons = topFailureReasons([
      { sender_type: 'agent', status: 'failed', error_code: 131049, error_title: null },
      { sender_type: 'agent', status: 'failed', error_code: 131049, error_title: 'Limit' },
      { sender_type: 'agent', status: 'failed', error_code: null, error_title: null },
      { sender_type: 'customer', status: 'failed', error_code: 1, error_title: 'x' },
      { sender_type: 'agent', status: 'read', error_code: 2, error_title: 'y' },
    ])
    expect(reasons).toEqual([
      { code: 131049, title: 'Limit', count: 2 },
      { code: null, title: '', count: 1 },
    ])
  })

  it('counts unique non-empty values', () => {
    expect(uniqueCount(['a', 'b', 'a', null, undefined, ''])).toBe(2)
  })
})

describe('campaignRates', () => {
  it('divides by total recipients', () => {
    expect(
      campaignRates({
        total_recipients: 40,
        sent_count: 38,
        delivered_count: 35,
        read_count: 20,
        replied_count: 4,
        failed_count: 2,
      }),
    ).toEqual({ deliveryRate: 87.5, readRate: 50 })
  })
  it('handles empty broadcasts', () => {
    expect(
      campaignRates({
        total_recipients: 0,
        sent_count: null,
        delivered_count: null,
        read_count: null,
        replied_count: null,
        failed_count: null,
      }),
    ).toEqual({ deliveryRate: 0, readRate: 0 })
  })
})

describe('maskPhone', () => {
  it('keeps the first and last two digits', () => {
    expect(maskPhone('+1 555 123 4567')).toBe('+1 5•• ••• ••67')
    expect(maskPhone('919876543210')).toBe('91••••••••10')
  })
  it('leaves short or empty values alone', () => {
    expect(maskPhone('1234')).toBe('1234')
    expect(maskPhone(null)).toBe('')
  })
})

describe('toCsv', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"'], [1, null]])).toBe(
      'a,b\r\n"x,y","say ""hi"""\r\n1,',
    )
  })
})
