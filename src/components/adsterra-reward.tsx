'use client'

/*
 * Rewarded ad → 30-minute Chat Pass.
 *
 * Flow:
 *   1. Checks availability via /api/ads/config (ads configured?) and the
 *      grant endpoint's rate limit.
 *   2. "Watch Ad" opens a modal with a real Adsterra banner and a countdown.
 *   3. After the countdown, calls POST /api/rewards/adsterra/grant — the
 *      server verifies auth + cooldown and grants the pass. The client can
 *      never grant itself a pass.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AdsterraBanner, useRewardedAdsEnabled } from '@/components/adsterra-banner'
import { friendlyError } from '@/lib/errors'

const COUNTDOWN_SECONDS = 15

export function AdsterraReward() {
  const router = useRouter()
  const adsEnabled = useRewardedAdsEnabled()
  const [available, setAvailable] = useState(true)
  const [watching, setWatching] = useState(false)
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS)
  const [granting, setGranting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const grant = useCallback(async () => {
    setGranting(true)
    setError('')
    try {
      const res = await fetch('/api/rewards/adsterra/grant', { method: 'POST' })
      if (res.status === 401) {
        setError('Your session expired. Please sign in again.')
        return
      }
      const data = (await res.json()) as { granted?: boolean; reason?: string; error?: string }
      if (data.reason === 'rate_limited') {
        setAvailable(false)
        setMessage('You already earned a Chat Pass in the last 30 minutes.')
      } else if (data.granted) {
        setMessage('✅ Your 30-minute Chat Pass is ready!')
        setWatching(false)
        router.refresh()
      } else {
        setError(friendlyError(data.error, 'Unable to grant the Chat Pass.'))
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setGranting(false)
    }
  }, [router])

  useEffect(() => {
    if (!watching) return
    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          clearInterval(timer)
          void grant()
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [watching, grant])

  if (adsEnabled === null) return null

  if (!adsEnabled) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
        <p className="text-sm text-slate-500">
          Rewarded ads are not active yet. Once your Adsterra zone key is configured,
          you will be able to earn free Chat Passes here.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-center">
      <h3 className="text-xl font-semibold text-cyan-300">🎁 Watch an ad for a 30-minute Chat Pass</h3>
      <p className="mt-2 text-sm text-slate-400">Earn one free Chat Pass every 30 minutes.</p>

      {message && <p className="mt-4 rounded-xl bg-emerald-950/40 p-3 text-sm text-emerald-200">{message}</p>}
      {error && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}

      {!watching ? (
        <button
          onClick={() => {
            setMessage('')
            setError('')
            if (available) {
              setRemaining(COUNTDOWN_SECONDS)
              setWatching(true)
            }
          }}
          disabled={!available || granting}
          className="mt-5 rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {available ? 'Watch Ad' : 'Come back in 30 minutes'}
        </button>
      ) : (
        <div className="mt-5">
          <AdsterraBanner size="300x250" />
          <p className="mt-3 text-sm text-slate-400">
            {granting ? 'Granting your pass…' : `Your Chat Pass unlocks in ${remaining}s…`}
          </p>
          {!granting && remaining > 0 && (
            <button onClick={() => setWatching(false)} className="mt-2 text-xs text-slate-500 underline">
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  )
}
