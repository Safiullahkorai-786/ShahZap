'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function StartShahZap() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    setBusy(true)
    setError('')
    try {
      const supabase = createClient()
      const { data } = await supabase.auth.getSession()
      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInAnonymously()
        if (signInError) {
          setError('We could not start your private session. Please try again.')
          setBusy(false)
          return
        }
      }
      router.push('/onboarding')
    } catch {
      setError('We could not start your private session. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-stretch gap-3">
      <button onClick={start} disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-10 py-4 font-bold text-slate-950 shadow-xl shadow-cyan-950/50 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">
        {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-900/30 border-t-slate-900" />}
        {busy ? 'Starting private session…' : '⚡ Start ShahZap'}
      </button>
      {error && (
        <p className="flex items-start gap-2.5 rounded-xl border border-red-900/60 bg-red-950/40 p-3.5 text-sm text-red-200">
          <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">!</span>
          {error}
        </p>
      )}
    </div>
  )
}
