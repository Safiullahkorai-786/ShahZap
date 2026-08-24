'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, MessageCircle, UserCheck, UserMinus, UserPlus } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/errors'
import { resolveIdentity } from '@/lib/identity'

export type OnlineMember = {
  id: string
  display_name: string | null
  level: number | null
  country_code: string | null
  country_visible: boolean
  chat_language: string | null
  interests_visible?: boolean
  profile_interests?: { interests: { name: string }[] }[] | null
}

type RequestState = 'none' | 'outgoing' | 'incoming' | 'friends'

export default function OnlineMembers({ members }: { members: OnlineMember[] }) {
  const router = useRouter()
  const [states, setStates] = useState<Record<string, RequestState>>({})
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmUnfriend, setConfirmUnfriend] = useState<{ id: string; name: string } | null>(null)
  const [blockedPairs, setBlockedPairs] = useState<Set<string>>(new Set())
  const [userId, setUserId] = useState<string | null>(null)

  async function friendAction(memberId: string, action: 'send' | 'cancel' | 'unfriend') {
    setError('')
    const supabase = createClient()
    if (action === 'send') {
      const { data, error: e } = await supabase.rpc('send_friend_request', { p_receiver: memberId })
      if (e) { setError(friendlyError(e, 'Could not send the friend request.')); return }
      const st = (data as { status?: string })?.status
      setStates((cur) => ({ ...cur, [memberId]: st === 'friends' || st === 'auto_accepted' ? 'friends' : 'outgoing' }))
      return
    }
    if (action === 'cancel') {
      await supabase.rpc('cancel_friend_request', { p_receiver: memberId })
    } else {
      await supabase.rpc('unfriend', { p_other: memberId })
    }
    setStates((cur) => { const n = { ...cur }; delete n[memberId]; return n })
  }

  useEffect(() => {
    let active = true
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !active) return
      setUserId(user.id)
      // Pairs where a block exists in either direction — friend options hide.
      const { data: blocks } = await supabase
        .from('blocks')
        .select('blocker_id,blocked_id')
        .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`)
      if (active && blocks) setBlockedPairs(new Set(blocks.flatMap((b) => [`${b.blocker_id}|${b.blocked_id}`, `${b.blocked_id}|${b.blocker_id}`])))
      const { data } = await supabase
        .from('friend_requests')
        .select('sender_id,receiver_id,status')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .in('status', ['pending', 'accepted'])
      if (!active || !data) return
      const next: Record<string, RequestState> = {}
      for (const row of data as { sender_id: string; receiver_id: string; status: string }[]) {
        const otherId = row.sender_id === user.id ? row.receiver_id : row.sender_id
        next[otherId] = row.status === 'accepted' ? 'friends' : row.sender_id === user.id ? 'outgoing' : 'incoming'
      }
      setStates(next)
    })()
    return () => { active = false }
  }, [])

  async function openChat(memberId: string) {
    if (openingId) return
    setOpeningId(memberId)
    setError('')
    const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc('start_direct_chat', { p_other_profile_id: memberId })
    setOpeningId(null)
    if (rpcError) {
      setError(friendlyError(rpcError, 'Could not open the chat. Please try again.'))
      return
    }
    router.push(`/chat/${data as string}`)
  }

  function sendRequest(memberId: string) {
    void friendAction(memberId, 'send')
  }

  return (
    <>
    <section className="mt-8 grid gap-3 sm:grid-cols-2">
      {error && <p className="sm:col-span-2 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
      {members.map((m) => {
        if (blockedPairs.has(`${userId}|${m.id}`) || blockedPairs.has(`${m.id}|${userId}`)) return null
        const state = states[m.id] ?? 'none'
        const busy = openingId === m.id
        return (
          <div
            key={m.id}
            role="button"
            tabIndex={0}
            onClick={() => openChat(m.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openChat(m.id) }}
            className="group flex cursor-pointer items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4 transition hover:border-cyan-900/60 hover:bg-slate-900/80"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold group-hover:text-cyan-200"><span className={resolveIdentity(m).colorClass}>{resolveIdentity(m).label}</span></p>
              <p className="mt-0.5 text-xs text-slate-500">
                Level {m.level ?? 1}
                {m.chat_language ? ` · ${m.chat_language.toUpperCase()} chat` : ''}
                {m.country_visible && m.country_code ? ` · ${m.country_code}` : ''}
                {busy ? ' · Opening chat…' : ''}
              </p>
              {m.interests_visible && !!m.profile_interests?.length && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.profile_interests.slice(0, 4).map((pi) => {
                    const name = pi.interests?.[0]?.name
                    return name ? (
                      <span key={name} className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                        {name}
                      </span>
                    ) : null
                  })}
                  {m.profile_interests.length > 4 && (
                    <span className="rounded-full px-1 py-0.5 text-[10px] text-slate-600">+{m.profile_interests.length - 4}</span>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {state === 'friends' ? (
                <button type="button" title="Friends — tap to unfriend"
                  onClick={(e) => { e.stopPropagation(); setConfirmUnfriend({ id: m.id, name: resolveIdentity(m).label }) }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300 transition hover:bg-red-500/20 hover:text-red-300">
                  <UserCheck size={18} />
                </button>
              ) : state === 'outgoing' ? (
                <button type="button" title="Pending — tap to cancel request"
                  onClick={(e) => { e.stopPropagation(); void friendAction(m.id, 'cancel') }}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300 transition hover:bg-amber-400/25">
                  <Clock size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  title={state === 'incoming' ? 'They sent you a request — accept it from Friends' : 'Send friend request'}
                  disabled={state === 'incoming'}
                  onClick={(e) => { e.stopPropagation(); if (state === 'none') void sendRequest(m.id) }}
                  className={`flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 transition ${state === 'incoming' ? 'cursor-not-allowed text-slate-600' : 'text-cyan-300 hover:border-cyan-400 hover:bg-cyan-400/10'}`}
                >
                  <UserPlus size={18} />
                </button>
              )}
              <button
                type="button"
                title="Open chat"
                onClick={(e) => { e.stopPropagation(); void openChat(m.id) }}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-300 transition hover:border-cyan-400 hover:bg-cyan-400/10 hover:text-cyan-200"
              >
                <MessageCircle size={18} />
              </button>
              <span className="flex items-center gap-1.5 pl-1 text-xs font-medium text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Online
              </span>
            </div>
          </div>
        )
      })}
      
    </section>
      <ConfirmDialog open={!!confirmUnfriend} title={`Unfriend ${confirmUnfriend?.name ?? ''}?`}
        message="You will no longer be friends. You can always send a new friend request later."
        confirmLabel="Unfriend" onCancel={() => setConfirmUnfriend(null)}
        onConfirm={() => { const c = confirmUnfriend; setConfirmUnfriend(null); if (c) void friendAction(c.id, 'unfriend') }} />
    </>
  )
}
