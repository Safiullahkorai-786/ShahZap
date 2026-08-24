import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { friendlyError } from '@/lib/errors'
import OnlineMembers from '@/components/online-members'
import { ZapChatButton } from '@/components/zap-chat-button'
import { AppHeader } from '@/components/app-header'
import { Radio } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Online now' }

// Someone counts as online when they opted into the directory and were
// active in the last 5 minutes (kept fresh by PresenceHeartbeat).
const ONLINE_WINDOW_MS = 5 * 60 * 1000

export default async function OnlinePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/onboarding')

  // Server component render is fine here; the rule targets client purity.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString()
  const { data: members, error } = await supabase
    .from('profiles')
    .select('id,display_name,level,country_code,country_visible,chat_language,gender,gender_visible,interests_visible,profile_interests(interest_id,interests(name))')
    .eq('online_visible', true)
    .neq('id', user.id)
    .gt('last_active_at', since)
    .order('last_active_at', { ascending: false })
    .limit(100)

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppHeader title="Online now" icon="radio" />
      <div className="mx-auto max-w-3xl w-full px-4 pb-10 pt-4 lg:max-w-5xl">
        <p className="text-xs leading-relaxed text-slate-500">
          Opted-in members active in the last few minutes. Tap anyone to chat instantly.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-cyan-900/60 bg-gradient-to-r from-cyan-950/40 to-slate-900 p-5">
            <div>
              <p className="font-semibold">⚡ ZapBot</p>
              <p className="mt-0.5 text-xs text-slate-400">Always online · practice small talk</p>
            </div>
            <ZapChatButton />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-violet-900/60 bg-gradient-to-r from-violet-950/40 to-slate-900 p-5">
            <div>
              <p className="font-semibold">🧭 ZapGuide</p>
              <p className="mt-0.5 text-xs text-slate-400">Knows how everything works · ask anything</p>
            </div>
            <ZapChatButton guide />
          </div>
        </div>

        {error && <p className="mt-5 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{friendlyError(error, 'Could not load the online list. Please refresh.')}</p>}

        {!error && (members?.length ?? 0) === 0 && (
          <p className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-500">
            No one else is online right now. Check back soon, or start matching while you wait.
          </p>
        )}

        <OnlineMembers members={members ?? []} />
      </div>
    </main>
  )
}
