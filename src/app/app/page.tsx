import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PresenceHeartbeat } from '@/components/presence-heartbeat'
import { AppDashboard } from '@/components/app-dashboard'

export const dynamic = 'force-dynamic'

export default async function AppPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: profile } = await supabase.from('profiles').select('display_name, interface_language, chat_language, xp, zap_points, region_credits, level, streak_days').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/onboarding')
  await supabase.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', user.id)
  const { data: conversations } = await supabase
    .from('conversations')
    .select('id, started_at')
    .order('started_at', { ascending: false })
    .limit(8)

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppDashboard profile={profile} conversations={conversations ?? []} />
      <PresenceHeartbeat />
    </main>
  )
}
