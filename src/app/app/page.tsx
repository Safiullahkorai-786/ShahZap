import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PresenceHeartbeat } from '@/components/presence-heartbeat'
import { NotificationBell } from '@/components/notification-bell'

export const dynamic = 'force-dynamic'

const QUICK_LINKS = [
  ['/progression', 'Progression', 'Level, XP and streaks'],
  ['/friends', 'Friends', 'People you connected with'],
  ['/rewards', 'Rewards', 'Redeem your Zap Points'],
  ['/online', 'Online now', 'Members active right now'],
] as const

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

  const initial = profile.display_name?.charAt(0)?.toUpperCase() ?? '?'

  const stats = [
    ['XP', profile.xp],
    ['Zap Points', profile.zap_points],
    ['Region Credits', profile.region_credits],
    ['Streak', `${profile.streak_days ?? 0}d`],
  ] as const

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-800/60 bg-cyan-950/40 text-sm font-bold text-cyan-300">{initial}</span>
            <div>
              <p className="text-sm font-bold tracking-tight text-cyan-300">⚡ ShahZap</p>
              <p className="text-xs text-slate-400">Welcome back, <span className="font-semibold text-white">{profile.display_name}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="hidden rounded-full border border-slate-700 px-3 py-1 text-xs font-medium text-slate-300 sm:inline">Level {profile.level ?? 1}</span>
            <Link href="/private-session" className="rounded-full border border-cyan-900/60 bg-cyan-950/30 px-3 py-1 text-xs font-medium text-cyan-300 transition hover:border-cyan-400 hover:text-cyan-200">Private session ℹ️</Link>
            <NotificationBell />
            <Link href="/settings" aria-label="Settings" className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 text-sm transition hover:border-slate-500 hover:text-white">⚙️</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {/* Stats */}
        <section aria-label="Your progression" className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 transition hover:border-slate-600">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
            </div>
          ))}
        </section>

        {/* Matching hero */}
        <section className="relative mt-6 overflow-hidden rounded-3xl border border-cyan-900/60 bg-gradient-to-br from-cyan-950/40 via-slate-900 to-slate-900 p-8 sm:p-12">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
          <p className="text-sm font-semibold text-cyan-300">Matching is ready</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Find your next conversation.</h1>
          <p className="mt-3 max-w-xl leading-7 text-slate-300">
            ShahZap checks safety, age compatibility, preferences, language,
            generation, interests and region targeting before reserving a
            compatible match for you.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/match" className="rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-8 py-4 text-sm font-bold text-slate-950 shadow-xl shadow-cyan-950/50 transition hover:brightness-110">
              Start matching
            </Link>
          </div>
        </section>

        {/* Recent conversations */}
        {(conversations?.length ?? 0) > 0 && (
          <section aria-label="Your conversations" className="mt-6">
            <h2 className="text-lg font-semibold">Your conversations</h2>
            <p className="mt-1 text-xs text-slate-400">Jump back into a chat you already started.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {conversations!.map((conversation) => (
                <Link key={conversation.id} href={`/chat/${conversation.id}`} className="group flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-4 transition hover:border-cyan-900/60 hover:bg-slate-900">
                  <span>
                    <span className="block text-sm font-semibold">💬 Conversation</span>
                    <span className="mt-0.5 block text-xs text-slate-500">Started {new Date(conversation.started_at).toLocaleString()}</span>
                  </span>
                  <span className="text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-300">→</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Quick links */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map(([href, title, hint]) => (
            <Link key={href} href={href} className="group rounded-2xl border border-slate-800 bg-slate-900/70 p-5 transition hover:border-cyan-900/60 hover:bg-slate-900">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{title}</h2>
                <span className="text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-300">→</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">{hint}</p>
            </Link>
          ))}
        </section>
      </div>
      <PresenceHeartbeat />
    </main>
  )
}
