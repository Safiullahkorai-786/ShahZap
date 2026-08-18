'use client'

import { useEffect, useState } from 'react'
import { getActiveQuests, getGamification } from '@/lib/gamification'
import { useRouter } from 'next/navigation'

type Gamification = { zap_points: number; xp: number; level: number; current_streak: number; longest_streak: number }
type Quest = { id: string; code: string; title: string; description: string; xp_reward: number; zap_reward: number; cadence: string }

export default function ProgressionPage() {
  const router = useRouter()
  const [stats, setStats] = useState<Gamification | null>(null)
  const [quests, setQuests] = useState<Quest[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function load() {
      const [gamification, questResult] = await Promise.all([getGamification(), getActiveQuests()])
      if (!active) return
      if ('error' in gamification) setError(gamification.error ?? 'Unable to load progression.')
      else setStats(gamification.data)
      if ('error' in questResult) setError(questResult.error ?? 'Unable to load quests.')
      else setQuests(questResult.data)
    }
    void load()
    return () => { active = false }
  }, [])

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-white"><div className="mx-auto max-w-3xl"><button onClick={() => router.push('/app')} className="text-sm text-slate-400">← Back</button><h1 className="mt-6 text-3xl font-bold">⚡ Progression</h1><p className="mt-2 text-slate-400">Your activity becomes useful progress: Zap Points, XP, levels and streaks.</p>{error && <p className="mt-5 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}<div className="mt-8 grid gap-3 sm:grid-cols-4">{[['Zap Points',stats?.zap_points ?? 0],['XP',stats?.xp ?? 0],['Level',stats?.level ?? 1],['Streak',stats?.current_streak ?? 0]].map(([label,value])=><div key={String(label)} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div><section className="mt-10"><div className="flex items-end justify-between"><div><h2 className="text-xl font-semibold">Missions</h2><p className="mt-1 text-sm text-slate-500">Complete useful activities to earn progression.</p></div></div><div className="mt-4 space-y-3">{quests.map((quest)=><div key={quest.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">{quest.title}</h3><p className="mt-1 text-sm text-slate-400">{quest.description}</p></div><span className="whitespace-nowrap text-xs font-semibold text-cyan-300">+{quest.zap_reward} ZP · +{quest.xp_reward} XP</span></div><p className="mt-3 text-xs uppercase tracking-wide text-slate-600">{quest.cadence}</p></div>)}</div></section></div></main>
}
