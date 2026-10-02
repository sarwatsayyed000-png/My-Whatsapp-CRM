import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPhoneNumberHealth } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { maskPhone } from '@/lib/analytics/calculations'

/**
 * GET /api/whatsapp/status
 *
 * Lightweight, read-only health summary for the dashboard's
 * "WhatsApp API Status" card. Unlike GET /api/whatsapp/config it never
 * returns the raw phone number or any Meta error envelope — just a
 * masked number and the quality / tier signals. Every non-auth failure
 * is a 200 with the unknown fields set to null, so the card degrades
 * to "Unknown" instead of an error state.
 *
 * Response:
 *   { configured, connected, phone, verified_name,
 *     quality_rating, messaging_limit_tier, meta_reachable }
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const empty = {
    configured: false,
    connected: false,
    phone: null as string | null,
    verified_name: null as string | null,
    quality_rating: null as string | null,
    messaging_limit_tier: null as string | null,
    meta_reachable: false,
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!profile?.account_id) return NextResponse.json(empty)

  const { data: config } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token, status')
    .eq('account_id', profile.account_id)
    .maybeSingle()
  if (!config) return NextResponse.json(empty)

  const base = { ...empty, configured: true, connected: config.status === 'connected' }

  try {
    const accessToken = decrypt(config.access_token)
    const info = await getPhoneNumberHealth({
      phoneNumberId: config.phone_number_id,
      accessToken,
    })
    return NextResponse.json({
      ...base,
      phone: maskPhone(info.display_phone_number) || null,
      verified_name: info.verified_name ?? null,
      quality_rating: info.quality_rating ?? null,
      messaging_limit_tier: info.messaging_limit_tier ?? null,
      meta_reachable: true,
    })
  } catch (err) {
    console.error(
      '[whatsapp/status] Meta health check failed:',
      err instanceof Error ? err.message : err,
    )
    return NextResponse.json(base)
  }
}
