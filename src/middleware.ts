import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Uses the legacy `middleware.ts` filename + `middleware` export so the
// middleware runs on the Edge runtime — required for OpenNext Cloudflare
// deployments (`@opennextjs/cloudflare` does not support Node.js proxy).
export async function middleware(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
