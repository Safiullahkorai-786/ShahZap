'use client'

import { useEffect, useState } from 'react'
import { findBestMatch, joinMatchQueue, leaveMatchQueue } from '@/lib/matching'
import { useRouter } from 'next/navigation'

export default function MatchPage() {
  const router = useRouter()
  const [waiting, setWaiting] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(async () => {
      setSeconds((value) => value + 1)
      const result = await findBestMatch()
      if ('conversationId' in result) {
        window.clearInterval(timer)
        router.push(`/chat/${result.conversationId}`)
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [waiting, router])

  async function start() {
    setMessage('')
    const result = await joinMatchQueue()
    if ('error' in result) return setMessage(result.error)
    setSeconds(0)
    setWaiting(true)
  }

  async function cancel() {
    await leaveMatchQueue()
    setWaiting(false)
    setMessage('')
  }

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-white"><div className="mx-auto max-w-xl"><button onClick={()=>router.push('/app')} className="text-sm text-slate-400">← Back</button><section className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center"><p className="text-sm font-semibold text-cyan-300">⚡ ShahZap Match</p><h1 className="mt-3 text-3xl font-bold">Find someone to chat with</h1><p className="mt-3 text-slate-400">We check safety compatibility first, then your preferences and shared interests.</p>{waiting ? <><div className="mx-auto mt-10 h-24 w-24 animate-pulse rounded-full border-4 border-cyan-400/50"/><p className="mt-6 font-semibold">Looking for a compatible person…</p><p className="mt-2 text-sm text-slate-500">Waiting {seconds}s</p><button onClick={cancel} className="mt-8 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold">Cancel</button></> : <button onClick={start} className="mt-10 rounded-xl bg-cyan-400 px-8 py-4 font-bold text-slate-950">Start matching</button>}{message && <p className="mt-5 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{message}</p>}</section></div></main>
}
