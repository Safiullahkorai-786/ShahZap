'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const reasons = ['harassment','spam','hate_speech','sexual_content','scam','impersonation','underage_concern','threatening_behavior','other']

export default function SafetyActions({ conversationId, otherProfileId }: { conversationId: string; otherProfileId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('harassment')
  const [details, setDetails] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function report() {
    setBusy(true); setStatus('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setStatus('Your session expired.'); setBusy(false); return }
    const { error } = await supabase.from('reports').insert({ reporter_id: user.id, reported_id: otherProfileId, conversation_id: conversationId, reason, details: details.trim().slice(0, 1000) || null })
    setStatus(error ? error.message : 'Report submitted. Thank you for helping keep ShahZap safe.')
    if (!error) { setDetails(''); setOpen(false) }
    setBusy(false)
  }

  async function block() {
    setBusy(true); setStatus('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setStatus('Your session expired.'); setBusy(false); return }
    const { error } = await supabase.from('blocks').upsert({ blocker_id: user.id, blocked_id: otherProfileId }, { onConflict: 'blocker_id,blocked_id' })
    setStatus(error ? error.message : 'User blocked. They will not be matched with you again.')
    setBusy(false)
  }

  return <div className="relative"><div className="flex gap-2"><button type="button" onClick={()=>setOpen(!open)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs">🚩 Report</button><button type="button" disabled={busy} onClick={block} className="rounded-xl border border-slate-700 px-3 py-2 text-xs">Block</button></div>{open && <div className="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"><h2 className="font-semibold">Report this user</h2><select value={reason} onChange={e=>setReason(e.target.value)} className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{reasons.map(item=><option key={item} value={item}>{item.replaceAll('_',' ')}</option>)}</select><textarea value={details} onChange={e=>setDetails(e.target.value)} maxLength={1000} className="mt-3 h-24 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm" placeholder="Optional details"/><button type="button" disabled={busy} onClick={report} className="mt-3 w-full rounded-xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950">{busy?'Submitting…':'Submit report'}</button></div>}{status && <p className="mt-2 text-xs text-slate-400">{status}</p>}</div>
}
