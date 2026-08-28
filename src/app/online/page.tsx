import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { friendlyError } from '@/lib/errors'
import OnlineTabs from '@/components/online-tabs'
import { AppHeader } from '@/components/app-header'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Online now' }

const ONLINE_WINDOW_MS = 90 * 1000

export default async function OnlinePage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/onboarding')

  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString()
  const { data: members, error } = await supabase
    .from('profiles')
    .select('id,display_name,level,country_code,country_visible,chat_language,gender,gender_visible,age_band,age_band_visible,generation,generation_visible,last_active_at,interests_visible,profile_interests(interest_id,interests(name))')
    .eq('online_visible', true)
    .neq('id', user.id)
    .gt('last_active_at', since)
    .order('last_active_at', { ascending: false })
    .limit(100)

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppHeader title="Online" icon="radio" />

      {error && <div className="mx-auto max-w-2xl w-full px-4"><p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{friendlyError(error, 'Could not load the online list.')}</p></div>}

      <OnlineTabs members={members ?? []} />
    </main>
  )
}
