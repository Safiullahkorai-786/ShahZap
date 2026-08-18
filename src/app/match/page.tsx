'use client'

import { useEffect, useState } from 'react'
import { findBestMatch, joinMatchQueue, leaveMatchQueue } from '@/lib/matching'
import { useRouter } from 'next/navigation'

export default function MatchPage() {
  const router = useRouter()
  const [waiting, setWaiting] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [matched, setMatched] = useState<{ conversationId: string } | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(async () => {
      setSeconds((value) => value + 1)
      const result = await findBestMatch()
      if ('conversationId' in result) {
        window.clearInterval(timer)
        setWaiting(false)
        setMatched({ conversationId: result.conversationId })
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [waiting])

  async function start() {
    setMessage('')
    const result = await joinMatchQueue()
    if ('error' in result) return setMessage(result.error)
    setSeconds(0); setMatched(null); setWaiting(true)
  }

  async function cancel() {
    await leaveMatchQueue()
    setWaiting(false)
    setMessage('')
  }

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-white"><div className="mx-auto max-w-xl"><button onClick={()=>router.push('/app')} className="text-sm text-slate-400">← Back</button><section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center"><p className="text-sm font-semibold text-cyan-300">⚡ ShahZap Match</p>{matched ? <><h1 className="mt-3 text-3xl font-bold">Match found!</h1><p className="mt-3 text-slate-400">A compatible person has been reserved for your conversation.</p><p className="mt-6 rounded-xl bg-slate-950 p-4 text-xs text-slate-500">Conversation ready: {matched.conversationId}</p><p className="mt-5 text-sm text-slate-500">Realtime chat is the next completed phase.</p></> : <><h1 className="mt-3 text-3xl font-bold">Find someone to chat with</h1><p className="mt-3 text-slate-400">Safety and age compatibility come first, followed by preferences, language, generation, interests and region targeting.</p>{waiting ? <><div className="mx-auto mt-10 h-24 w-24 animate-pulse rounded-full border-4 border-cyan-400/50"/><p className="mt-6 font-semibold">Looking for a compatible person…</p><p className="mt-2 text-sm text-slate-500">Waiting {seconds}s</p><button onClick={cancel} className="mt-8 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold">Cancel</button></> : <button onClick={start} className="mt-10 rounded-xl bg-cyan-400 px-8 py-4 font-bold text-slate-950">Start matching</button>}</>}{message && <p className="mt-5 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{message}</p>}</section></div></main>
}
