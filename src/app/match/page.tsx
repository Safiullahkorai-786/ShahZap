'use client'

import { useEffect, useState } from 'react'
import { findBestMatch, getMatchedConversation, getQueueCount, joinMatchQueue, leaveMatchQueue, renewMatchQueue } from '@/lib/matching'
import { friendlyError } from '@/lib/errors'
import { ZapChatButton } from '@/components/zap-chat-button'
import { AdsterraBanner } from '@/components/adsterra-banner'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { Radar } from 'lucide-react'

export default function MatchPage() {
  const router = useRouter()
  const [waiting, setWaiting] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [matched, setMatched] = useState<{ conversationId: string } | null>(null)
  const [message, setMessage] = useState('')
  const [queueCount, setQueueCount] = useState<number | null>(null)

  useEffect(() => {
    void getQueueCount().then(setQueueCount)
  }, [])

  useEffect(() => {
    if (!waiting) return
    let tick = 0
    const timer = window.setInterval(async () => {
      tick += 1
      setSeconds((value) => value + 1)
      const result = await findBestMatch()
      if ('conversationId' in result) {
        window.clearInterval(timer)
        setWaiting(false)
        setMatched({ conversationId: result.conversationId })
        return
      }
      // Partner-side detection: their poll may have paired us — check our row.
      const partnerMatch = await getMatchedConversation()
      if (partnerMatch) {
        window.clearInterval(timer)
        setWaiting(false)
        setMatched({ conversationId: partnerMatch })
        return
      }
      if (tick % 8 === 0) await renewMatchQueue()
      if (tick % 3 === 0) {
        const count = await getQueueCount()
        if (count !== null) setQueueCount(count)
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [waiting])

  // Auto-enter the chat on BOTH sides once a match exists.
  useEffect(() => {
    if (!matched) return
    const timer = window.setTimeout(() => router.replace(`/chat/${matched.conversationId}`), 900)
    return () => window.clearTimeout(timer)
  }, [matched, router])

  async function start() {
    setMessage('')
    const result = await joinMatchQueue()
    if ('error' in result) {
      setMessage(friendlyError(result.error, 'Unable to enter the matching queue.'))
      return
    }
    setSeconds(0)
    setMatched(null)
    setWaiting(true)
  }

  async function cancel() {
    const result = await leaveMatchQueue()
    if ('error' in result) setMessage(friendlyError(result.error, 'Unable to leave the matching queue.'))
    setWaiting(false)
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppHeader title="Match" icon="radar" />
      <div className="mx-auto max-w-xl w-full px-4 pb-12 pt-4">
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center">
          <p className="text-sm font-semibold text-cyan-300">⚡ ShahZap Match</p>
          {matched ? (
            <>
              <h1 className="mt-2 text-2xl font-bold">Match found! 🎉</h1>
              <p className="mt-3 text-slate-400">Opening your private chat…</p>
              <div className="mx-auto mt-8 h-16 w-16 animate-pulse rounded-full border-4 border-cyan-400/50" />
              <button onClick={() => router.replace(`/chat/${matched.conversationId}`)} className="mt-8 rounded-xl bg-cyan-400 px-8 py-4 font-bold text-slate-950">Enter chat now</button>
            </>
          ) : (
            <>
              <h1 className="mt-2 text-xl font-bold">Find someone to chat with</h1>
              <p className="mt-3 text-slate-400">Safety and age compatibility come first, followed by preferences, language, generation, interests and region targeting.</p>
              {queueCount !== null && queueCount > 0 && (
                <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-4 py-1.5 text-xs font-semibold text-emerald-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  {queueCount} {queueCount === 1 ? 'person is' : 'people are'} looking right now
                </p>
              )}
              {waiting ? (
                <>
                  <div className="mx-auto mt-10 h-24 w-24 animate-pulse rounded-full border-4 border-cyan-400/50" />
                  <p className="mt-6 font-semibold">Looking for a compatible person…</p>
                  <p className="mt-2 text-sm text-slate-500">Waiting {seconds}s — your spot stays active while this tab is open</p>
                  <button onClick={cancel} className="mt-8 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold">Cancel</button>
                  {seconds >= 15 && (
                    <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-5 text-left">
                      <p className="text-sm font-semibold">{queueCount === 0 ? 'Nobody else is looking right now.' : 'Still searching for the best match…'}</p>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{queueCount === 0 ? 'Matching pairs two people who are here at the same moment — invite a friend, or try a practice chat while you wait.' : 'We pair safety-first; a wider search may need another moment.'}</p>
                      <ZapChatButton cancelQueue label="⚡ Practice chat with ZapBot" className="mt-4 w-full" />
                    </div>
                  )}
                </>
              ) : (
                <button onClick={start} className="mt-10 rounded-xl bg-cyan-400 px-8 py-4 font-bold text-slate-950">Start matching</button>
              )}
            </>
          )}
          {message && <p className="mt-5 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{message}</p>}
        </section>

        <div className="mt-5 flex justify-center">
          <AdsterraBanner size="300x250" />
        </div>
      </div>
    </main>
  )
}
