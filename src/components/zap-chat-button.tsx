'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ZAP_BOT_PROFILE_ID, ZAP_GUIDE_PROFILE_ID } from '@/lib/bot'

export function ZapChatButton({
  label = '⚡ Chat with ZapBot now',
  guide = false,
  cancelQueue = false,
  className = '',
}: {
  label?: string
  guide?: boolean
  cancelQueue?: boolean
  className?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function start() {
    if (busy) return
    setBusy(true)
    const supabase = createClient()
    if (cancelQueue) {
      await supabase.from('match_queue').update({ status: 'cancelled' }).eq('status', 'waiting')
    }
    const target = guide ? ZAP_GUIDE_PROFILE_ID : ZAP_BOT_PROFILE_ID
    const { data, error } = await supabase.rpc('start_direct_chat', { p_other_profile_id: target })
    if (error || !data) {
      setBusy(false)
      return
    }
    router.push(`/chat/${data as string}?from=bot`)
  }

  return (
    <button type="button" onClick={start} disabled={busy}
      className={`rounded-xl border border-cyan-800/60 bg-cyan-950/40 px-5 py-3 text-sm font-semibold text-cyan-200 transition hover:border-cyan-400 hover:bg-cyan-900/40 disabled:opacity-50 ${className}`}>
      {busy ? 'Opening chat…' : label}
    </button>
  )
}
