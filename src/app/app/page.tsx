import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AppPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')
  const { data: profile } = await supabase.from('profiles').select('display_name, interface_language, chat_language, xp, zap_points, region_credits').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/onboarding')

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6"><div className="mx-auto max-w-5xl"><header className="flex items-center justify-between border-b border-slate-800 pb-5"><div><p className="text-sm font-semibold text-cyan-300">⚡ ShahZap</p><h1 className="mt-1 text-2xl font-bold">Welcome, {profile.display_name}</h1></div><span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">Private session</span></header><section className="mt-8 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs text-slate-500">XP</p><p className="mt-2 text-2xl font-bold">{profile.xp}</p></div><div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs text-slate-500">Zap Points</p><p className="mt-2 text-2xl font-bold">{profile.zap_points}</p></div><div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs text-slate-500">Region Credits</p><p className="mt-2 text-2xl font-bold">{profile.region_credits}</p></div></section><section className="mt-6 rounded-3xl border border-cyan-900/60 bg-cyan-950/20 p-8"><p className="text-sm font-semibold text-cyan-300">Matching is ready</p><h2 className="mt-2 text-3xl font-bold">Find your next conversation.</h2><p className="mt-3 max-w-xl text-slate-400">ShahZap checks safety, age compatibility, preferences, language, generation, interests and region targeting before reserving a compatible match.</p><div className="mt-7 flex flex-wrap gap-3"><Link href="/match" className="rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-slate-950">Start matching</Link><Link href="/friends" className="rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold">Friends</Link><Link href={`/profile/${user.id}`} className="rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold">My profile</Link></div></section></div></main>
}
