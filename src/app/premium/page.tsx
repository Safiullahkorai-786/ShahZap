'use client'

import { useEffect, useState } from 'react'
import { getPremiumPlans, getPremiumStatus, redeemRewardedChatPass } from '@/lib/monetization'
import { AppHeader } from '@/components/app-header'
import { Crown } from 'lucide-react'

type Plan = { id: string; code: string; title: string; description: string; duration_days: number; price_minor: number; currency: string }
type Sub = { id: string; status: string; starts_at: string | null; ends_at: string | null; plan_id: string }

export default function PremiumPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [subscription, setSubscription] = useState<Sub | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    async function load() {
      const [plansResult, statusResult] = await Promise.all([getPremiumPlans(), getPremiumStatus()])
      if (!active) return
      if ('error' in plansResult) setMessage(plansResult.error ?? 'Unable to load plans.')
      else setPlans(plansResult.data)
      if ('error' in statusResult) setMessage(statusResult.error ?? 'Unable to load Premium status.')
      else setSubscription(statusResult.data)
    }
    void load()
    return () => { active = false }
  }, [])

  async function getPass() {
    setMessage('Rewarded-ad integration is provider-gated. The entitlement endpoint is ready; no ad is shown by this placeholder.')
    const result = await redeemRewardedChatPass()
    if ('error' in result) setMessage(result.error ?? 'Unable to grant the pass.')
    else setMessage('Your 30-minute Chat Pass is ready.')
  }

  return <main className="min-h-screen bg-slate-950 text-white"><AppHeader title="Premium" icon="crown" /><div className="mx-auto max-w-4xl w-full px-4 pb-10 pt-4 lg:max-w-6xl"><p className="text-xs leading-relaxed text-slate-500">Ad-free chatting plus country targeting — active conversations always stay free of interruptions.</p>{subscription && <div className="mt-6 rounded-2xl border border-cyan-800 bg-cyan-950/30 p-5"><p className="font-semibold">Premium is active</p><p className="mt-1 text-sm text-slate-400">Active until {subscription.ends_at ? new Date(subscription.ends_at).toLocaleDateString() : 'further notice'}.</p></div>}<section className="mt-5 grid gap-4 sm:grid-cols-2">{plans.map(plan => <article key={plan.id} className="rounded-3xl border border-slate-800 bg-slate-900 p-6"><p className="text-xs uppercase tracking-wider text-cyan-300">{plan.duration_days === 30 ? 'Monthly' : 'Yearly'}</p><h2 className="mt-2 text-xl font-bold">{plan.title}</h2><p className="mt-2 text-sm text-slate-400">{plan.description}</p><p className="mt-6 text-3xl font-bold">{(plan.price_minor / 100).toFixed(2)} <span className="text-sm text-slate-500">{plan.currency}</span></p><button disabled className="mt-5 w-full rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-500">Checkout provider — Step 9 integration</button></article>)}</section><section className="mt-5 rounded-3xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-xl font-semibold">Free Chat Pass</h2><p className="mt-2 text-sm text-slate-400">The final provider integration will use explicit rewarded-ad opt-in. Once granted, the server creates a 30-minute pass.</p><button onClick={getPass} className="mt-5 rounded-xl bg-cyan-400 px-5 py-3 text-sm font-bold text-slate-950">Test entitlement endpoint</button>{message && <p className="mt-4 text-sm text-slate-400">{message}</p>}</section></div></main>
}
