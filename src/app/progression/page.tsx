'use client'

import { useEffect, useState } from 'react'
import { getActiveQuests, getGamification } from '@/lib/gamification'
import { friendlyError } from '@/lib/errors'
import { AppHeader } from '@/components/app-header'
import { Zap } from 'lucide-react'

type Gamification = { zap_points: number; xp: number; level: number; current_streak: number; longest_streak: number }
type Quest = { id: string; code: string; title: string; description: string; xp_reward: number; zap_reward: number; cadence: string }

export default function ProgressionPage() {
  const [stats, setStats] = useState<Gamification | null>(null)
  const [quests, setQuests] = useState<Quest[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    async function load() {
      const [gamification, questResult] = await Promise.all([getGamification(), getActiveQuests()])
      if (!active) return
      if ('error' in gamification) setError(friendlyError(gamification.error, 'Unable to load your progression.'))
      else setStats(gamification.data)
      if ('error' in questResult) setError(friendlyError(questResult.error, 'Unable to load quests.'))
      else setQuests(questResult.data)
    }
    void load()
    return () => { active = false }
  }, [])

  return <main className="min-h-screen bg-slate-950 text-white"><AppHeader title="Progression" icon="zap" /><div className="mx-auto max-w-3xl w-full px-4 pb-10 pt-4 lg:max-w-5xl"><p className="text-xs leading-relaxed text-slate-500">Activity becomes progress: Zap Points, XP, levels and streaks.</p>{error && <p className="mt-5 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}<div className="mt-4 grid gap-3 sm:grid-cols-4">{[['Zap Points',stats?.zap_points ?? 0],['XP',stats?.xp ?? 0],['Level',stats?.level ?? 1],['Streak',stats?.current_streak ?? 0]].map(([label,value])=><div key={String(label)} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div><section className="mt-7"><div className="flex items-end justify-between"><div><h2 className="text-xl font-semibold">Missions</h2><p className="mt-1 text-sm text-slate-500">Complete useful activities to earn progression.</p></div></div><div className="mt-4 space-y-3">{quests.map((quest)=><div key={quest.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex items-start justify-between gap-4"><div><h3 className="font-semibold">{quest.title}</h3><p className="mt-1 text-sm text-slate-400">{quest.description}</p></div><span className="whitespace-nowrap text-xs font-semibold text-cyan-300">+{quest.zap_reward} ZP · +{quest.xp_reward} XP</span></div><p className="mt-3 text-xs uppercase tracking-wide text-slate-600">{quest.cadence}</p></div>)}</div></section></div></main>
}
