'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function StartShahZap() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function start() {
    setBusy(true)
    setError('')
    const supabase = createClient()
    const { data, error: authError } = await supabase.auth.getSession()
    if (data.session) {
      window.location.href = '/onboarding'
      return
    }
    const { error: signInError } = await supabase.auth.signInAnonymously()
    if (signInError) {
      setError('We could not start your private session. Please try again.')
      setBusy(false)
      return
    }
    window.location.href = '/onboarding'
  }

  return <div className="flex flex-col items-center gap-3 sm:flex-row">
    <button onClick={start} disabled={busy} className="rounded-2xl bg-cyan-400 px-7 py-4 font-bold text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:bg-cyan-300 disabled:opacity-60">
      {busy ? 'Starting private session…' : '⚡ Start ShahZap'}
    </button>
    {error && <p className="max-w-xs text-center text-sm text-red-300">{error}</p>}
  </div>
}
