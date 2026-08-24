import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { grantRewardedPass, serviceClient } from '@/lib/providers/adsterra'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

// Grants one rewarded-ad Chat Pass per 30 minutes per user.
// Auth is verified with the user's cookies; writes use the service-role
// client because chat_passes has no INSERT policy for end users and the
// rate-limit check must not be tamperable from the client.
export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const admin = serviceClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'Rewards are not configured. Set SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 503, headers: NO_STORE }
    )
  }

  const result = await grantRewardedPass(admin, user.id)

  if (result.granted) {
    return NextResponse.json({ granted: true, passId: result.passId }, { headers: NO_STORE })
  }
  if (result.reason === 'rate_limited') {
    return NextResponse.json({ granted: false, reason: 'rate_limited' }, { headers: NO_STORE })
  }
  return NextResponse.json(
    { error: result.error ?? 'Unable to grant the Chat Pass.' },
    { status: result.reason === 'error' ? 500 : 503, headers: NO_STORE }
  )
}
