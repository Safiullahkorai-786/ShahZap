'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Request = { id: string; sender_id: string; receiver_id: string; status: string; created_at: string }
type Profile = { id: string; display_name: string | null; avatar_path: string | null; age_band: string | null; generation: string | null; country_code: string | null; profile_visible: boolean }

export default function FriendsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string>()
  const [requests, setRequests] = useState<Request[]>([])
  const [friends, setFriends] = useState<Profile[]>([])
  const [profiles, setProfiles] = useState<Record<string, Profile>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      if (active) setUserId(user.id)
      const { data: reqs, error: reqError } = await supabase.from('friend_requests').select('id,sender_id,receiver_id,status,created_at').or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).order('created_at', { ascending: false })
      if (reqError) { if (active) setError(reqError.message); return }
      const visible = (reqs ?? []) as Request[]
      const ids = [...new Set(visible.flatMap((r) => [r.sender_id, r.receiver_id]).filter((id) => id !== user.id))]
      let map: Record<string, Profile> = {}
      if (ids.length) {
        const { data } = await supabase.from('profiles').select('id,display_name,avatar_path,age_band,generation,country_code,profile_visible').in('id', ids)
        map = Object.fromEntries(((data ?? []) as Profile[]).map((p) => [p.id, p]))
      }
      if (!active) return
      setRequests(visible)
      setProfiles(map)
      setFriends(visible.filter((r) => r.status === 'accepted').map((r) => map[r.sender_id === user.id ? r.receiver_id : r.sender_id]).filter(Boolean))
    }
    void load()
    return () => { active = false }
  }, [router])

  async function updateRequest(id: string, status: 'accepted' | 'declined' | 'cancelled') {
    const supabase = createClient()
    const { error: updateError } = await supabase.from('friend_requests').update({ status }).eq('id', id)
    if (updateError) setError(updateError.message)
    else window.location.reload()
  }

  const incoming = requests.filter((r) => r.status === 'pending' && r.receiver_id === userId)
  const outgoing = requests.filter((r) => r.status === 'pending' && r.sender_id === userId)

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-white"><div className="mx-auto max-w-3xl"><button onClick={() => router.push('/app')} className="text-sm text-slate-400">← Back</button><h1 className="mt-6 text-3xl font-bold">Friends</h1><p className="mt-2 text-slate-400">Keep connections you choose. Your profile visibility still controls what strangers can discover.</p>{error && <p className="mt-5 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}<section className="mt-8"><h2 className="text-lg font-semibold">Friend requests</h2>{incoming.length === 0 && outgoing.length === 0 ? <p className="mt-3 text-sm text-slate-500">No pending requests.</p> : <div className="mt-3 space-y-3">{incoming.map((r) => <div key={r.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4"><div><p className="font-semibold">{profiles[r.sender_id]?.display_name ?? 'ShahZap user'}</p><p className="text-xs text-slate-500">Wants to connect with you.</p></div><div className="flex gap-2"><button onClick={() => updateRequest(r.id, 'accepted')} className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950">Accept</button><button onClick={() => updateRequest(r.id, 'declined')} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Decline</button></div></div>)}{outgoing.map((r) => <div key={r.id} className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4"><div><p className="font-semibold">{profiles[r.receiver_id]?.display_name ?? 'ShahZap user'}</p><p className="text-xs text-slate-500">Request pending.</p></div><button onClick={() => updateRequest(r.id, 'cancelled')} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Cancel</button></div>)}</div>}</section><section className="mt-10"><h2 className="text-lg font-semibold">Your friends</h2>{friends.length === 0 ? <p className="mt-3 text-sm text-slate-500">Your accepted connections will appear here.</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2">{friends.map((p) => <button key={p.id} onClick={() => router.push(`/profile/${p.id}`)} className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-left hover:border-slate-600"><p className="font-semibold">{p.display_name ?? 'ShahZap user'}</p>{p.age_band && <p className="mt-1 text-xs text-slate-500">{p.age_band}</p>}</button>)}</div>}</section></div></main>
}
