import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPhoneNumberHealth, MetaApiError } from './meta-api'

const ARGS = { phoneNumberId: '123', accessToken: 'tok' }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('getPhoneNumberHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests the messaging tier alongside the basic fields', async () => {
    const fetchMock = vi.fn(async () =>
      json({ id: '123', display_phone_number: '+1 555', quality_rating: 'GREEN', messaging_limit_tier: 'TIER_1K' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const res = await getPhoneNumberHealth(ARGS)
    expect(res.messaging_limit_tier).toBe('TIER_1K')
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('messaging_limit_tier')
  })

  it('falls back to the basic fields when Meta rejects the field list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: 'bad field', code: 100 } }, 400))
      .mockResolvedValueOnce(json({ id: '123', display_phone_number: '+1 555', quality_rating: 'YELLOW' }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await getPhoneNumberHealth(ARGS)
    expect(res.quality_rating).toBe('YELLOW')
    expect(res.messaging_limit_tier).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws a MetaApiError on auth failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { message: 'expired', code: 190 } }, 401)),
    )
    await expect(getPhoneNumberHealth(ARGS)).rejects.toBeInstanceOf(MetaApiError)
  })
})
