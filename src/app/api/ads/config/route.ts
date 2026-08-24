import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Adsterra banner keys are public by design (they ship in page HTML),
// so exposing them here is safe. Reading from runtime env means you can
// rotate keys on the Cloudflare Worker without rebuilding.
// Account ID: 3436789 · Website ID: 6001372
export function GET() {
  const banners = {
    '728x90': process.env.NEXT_PUBLIC_ADSTERRA_728X90 ?? '',
    '300x250': process.env.NEXT_PUBLIC_ADSTERRA_300X250 ?? '',
    '160x600': process.env.NEXT_PUBLIC_ADSTERRA_160X600 ?? '',
  }
  return NextResponse.json(
    {
      enabled: Object.values(banners).some(Boolean),
      rewarded: Boolean(banners['300x250']),
      banners,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
