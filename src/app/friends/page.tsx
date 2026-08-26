'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/errors'
import { useRouter } from 'next/navigation'
import { resolveIdentity } from '@/lib/identity'
import { AppHeader } from '@/components/app-header'
import { Shimmer } from '@/components/shimmer'

const ONLINE_WINDOW_MS = 20 * 1000
const TYPING_WINDOW_MS = 5000
const POLL_MS = 3000

type Request = { id: string; sender_id: string; receiver_id: string; status: string; created_at: string }
type Profile = { id: string; display_name: string | null; avatar_path: string | null; age_band: string | null; generation: string | null; country_code: string | null; profile_visible: boolean; gender: string | null; gender_visible: boolean; last_active_at: string | null; online_visible: boolean | null }
type FriendWithMeta = Profile & {
  lastMessage: string | null
  lastMessageTime: string | null
  lastSenderId: string | null
  conversationId: string | null
  isOnline: boolean
  hasUnread: boolean
  isTyping: boolean
  partnerLastReadAt: string | null
}
type Tab = 'friends' | 'pending'

function TabButton({ label, active, count, onClick }: { label: string; active: boolean; count?: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`relative flex-1 py-2.5 text-center text-sm font-semibold transition ${active ? 'text-cyan-300' : 'text-slate-500 hover:text-slate-300'}`}>
      {label}
      {count != null && count > 0 && (
        <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-400 px-1.5 text-[10px] font-bold text-slate-950">{count}</span>
      )}
      {active && <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full bg-cyan-400" />}
    </button>
  )
}

function FriendsSkeleton() {
  return (
    <div aria-busy="true" className="space-y-6">
      <div className="flex gap-4 border-b border-slate-800">
        <Shimmer className="h-8 w-20 rounded" />
        <Shimmer className="h-8 w-16 rounded" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
            <div className="relative flex-none">
              <Shimmer className="h-12 w-12 rounded-full" />
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-slate-900 bg-slate-700" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Shimmer className="h-3.5 w-28 rounded sm:w-36" />
              <Shimmer className="h-3 w-40 rounded sm:w-52" />
            </div>
            <div className="flex flex-none flex-col items-end gap-1.5">
              <Shimmer className="h-3 w-8 rounded" />
              {i < 2 && <Shimmer className="h-5 w-5 rounded-full" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatTime(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${diffMins}m`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 7) return `${diffDays}d`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function TickIcon({ read }: { read: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`flex-none ${read ? 'text-cyan-400' : 'text-slate-500'}`}>
      <path d="M18 6 7 17l-5-5" /><path d="m22 10-9.5 9.5L10 17" />
    </svg>
  )
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="h-1 w-1 animate-bounce rounded-full bg-cyan-400" style={{ animationDelay: '0ms' }} />
      <span className="h-1 w-1 animate-bounce rounded-full bg-cyan-400" style={{ animationDelay: '150ms' }} />
      <span className="h-1 w-1 animate-bounce rounded-full bg-cyan-400" style={{ animationDelay: '300ms' }} />
    </span>
  )
}

function sortFriends(arr: FriendWithMeta[]) {
  arr.sort((a, b) => {
    if (a.isTyping && !b.isTyping) return -1
    if (!a.isTyping && b.isTyping) return 1
    if (a.hasUnread && !b.hasUnread) return -1
    if (!a.hasUnread && b.hasUnread) return 1
    const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0
    const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0
    return bTime - aTime
  })
}

export default function FriendsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string>()
  const [requests, setRequests] = useState<Request[]>([])
  const [friends, setFriends] = useState<FriendWithMeta[]>([])
  const [allProfiles, setAllProfiles] = useState<Record<string, Profile>>({})
  const [error, setError] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('friends')

  const friendsRef = useRef(friends)
  friendsRef.current = friends
  const convToFriendRef = useRef<Record<string, string>>({})
  const friendToConvRef = useRef<Record<string, string>>({})
  const userIdRef = useRef<string>('')
  const aliveRef = useRef(true)

  // ---- initial load ----
  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      if (mounted) { setUserId(user.id); userIdRef.current = user.id }

      const { data: reqs, error: reqError } = await supabase.from('friend_requests')
        .select('id,sender_id,receiver_id,status,created_at')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
      if (reqError) { if (mounted) { setError(friendlyError(reqError, 'Could not load friend data.')); setLoading(false) } return }

      const visible = (reqs ?? []) as Request[]
      const accepted = visible.filter((r) => r.status === 'accepted')
      const friendIds = accepted.map((r) => r.sender_id === user.id ? r.receiver_id : r.sender_id)

      const pendingIncoming = visible.filter((r) => r.status === 'pending' && r.receiver_id === user.id)
      const pendingOutgoing = visible.filter((r) => r.status === 'pending' && r.sender_id === user.id)
      const pendingIds = [...new Set([...pendingIncoming.map((r) => r.sender_id), ...pendingOutgoing.map((r) => r.receiver_id)])]
      const allIdsNeeded = [...new Set([...friendIds, ...pendingIds])]

      const profilesMap: Record<string, Profile> = {}
      if (allIdsNeeded.length) {
        const { data } = await supabase.from('profiles')
          .select('id,display_name,avatar_path,age_band,generation,country_code,profile_visible,gender,gender_visible,last_active_at,online_visible')
          .in('id', allIdsNeeded)
        for (const p of ((data ?? []) as Profile[])) profilesMap[p.id] = p
      }
      if (mounted) setAllProfiles(profilesMap)

      const now = Date.now()
      const friendMeta: Record<string, {
        lastMessage: string | null; lastMessageTime: string | null; lastSenderId: string | null;
        conversationId: string | null; hasUnread: boolean; partnerLastReadAt: string | null
      }> = {}

      if (friendIds.length) {
        const { data: myParts } = await supabase.from('conversation_participants')
          .select('conversation_id,last_read_at')
          .eq('profile_id', user.id)

        if (myParts?.length) {
          const convIds = myParts.map((p) => p.conversation_id)

          const { data: allParts } = await supabase.from('conversation_participants')
            .select('conversation_id,profile_id,last_read_at')
            .in('conversation_id', convIds)

          if (allParts) {
            const userLastRead: Record<string, string | null> = {}
            const partnerLastRead: Record<string, string | null> = {}
            const partsByConv: Record<string, string[]> = {}

            for (const p of myParts) userLastRead[p.conversation_id] = p.last_read_at

            for (const p of allParts) {
              if (!partsByConv[p.conversation_id]) partsByConv[p.conversation_id] = []
              partsByConv[p.conversation_id].push(p.profile_id)
              if (p.profile_id !== user.id) partnerLastRead[p.conversation_id] = p.last_read_at
            }

            for (const [convId, participants] of Object.entries(partsByConv)) {
              if (participants.length === 2) {
                const other = participants.find((id) => id !== user.id)
                if (other && friendIds.includes(other)) {
                  convToFriendRef.current[convId] = other
                  friendToConvRef.current[other] = convId
                  friendMeta[other] = {
                    lastMessage: null, lastMessageTime: null, lastSenderId: null,
                    conversationId: convId, hasUnread: false,
                    partnerLastReadAt: partnerLastRead[convId] ?? null,
                  }
                }
              }
            }

            const relevantConvIds = Object.keys(convToFriendRef.current)
            for (const convId of relevantConvIds) {
              const friendId = convToFriendRef.current[convId]
              const lastRead = userLastRead[convId]

              const { data: lastMsg } = await supabase.from('messages')
                .select('id,original_message,created_at,sender_id')
                .eq('conversation_id', convId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()

              if (lastMsg && friendMeta[friendId]) {
                friendMeta[friendId].lastMessage = (lastMsg as { original_message: string | null }).original_message
                friendMeta[friendId].lastMessageTime = (lastMsg as { created_at: string }).created_at
                friendMeta[friendId].lastSenderId = (lastMsg as { sender_id: string }).sender_id
              }

              // Check if there are unread messages from friend after last_read_at
              let hasUnread = false
              const { count } = await supabase.from('messages')
                .select('id', { count: 'exact', head: true })
                .eq('conversation_id', convId)
                .neq('sender_id', user.id)
                .gt('created_at', lastRead ?? '1970-01-01')
              hasUnread = (count ?? 0) > 0
              friendMeta[friendId].hasUnread = hasUnread
            }
          }
        }
      }

      if (!mounted) return

      const friendsWithMeta: FriendWithMeta[] = friendIds
        .map((id) => {
          const p = profilesMap[id]
          if (!p) return null
          const isOnline = p.online_visible !== false && !!p.last_active_at && (now - new Date(p.last_active_at).getTime()) < ONLINE_WINDOW_MS
          const meta = friendMeta[id]
          return {
            ...p,
            lastMessage: meta?.lastMessage ?? null,
            lastMessageTime: meta?.lastMessageTime ?? null,
            lastSenderId: meta?.lastSenderId ?? null,
            conversationId: meta?.conversationId ?? null,
            isOnline,
            hasUnread: meta?.hasUnread ?? false,
            isTyping: false,
            partnerLastReadAt: meta?.partnerLastReadAt ?? null,
          }
        })
        .filter(Boolean) as FriendWithMeta[]

      sortFriends(friendsWithMeta)
      setRequests(visible)
      setFriends(friendsWithMeta)
      setLoading(false)
    }
    void load()
    return () => { mounted = false }
  }, [router])

  // ---- Realtime: online + messages + typing + read receipts ----
  useEffect(() => {
    if (!friends.length || !userId) return
    const supabase = createClient()
    aliveRef.current = true
    const uid = userIdRef.current

    const channel = supabase.channel('friends-rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        if (!aliveRef.current) return
        const row = payload.new as { id: string; last_active_at: string | null; online_visible: boolean | null }
        setFriends((prev) => prev.map((f) => {
          if (f.id !== row.id) return f
          const isOnline = row.online_visible !== false && !!row.last_active_at && (Date.now() - new Date(row.last_active_at).getTime()) < ONLINE_WINDOW_MS
          return { ...f, isOnline, last_active_at: row.last_active_at }
        }))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (!aliveRef.current) return
        const msg = payload.new as { id: string; conversation_id: string; sender_id: string; original_message: string | null; created_at: string }
        const friendId = convToFriendRef.current[msg.conversation_id]
        if (!friendId) return
        setFriends((prev) => {
          const idx = prev.findIndex((f) => f.id === friendId)
          if (idx === -1) return prev
          const updated = [...prev]
          const f = { ...updated[idx] }
          f.lastMessage = msg.original_message
          f.lastMessageTime = msg.created_at
          f.lastSenderId = msg.sender_id
          if (msg.sender_id !== uid) {
            f.hasUnread = true
          }
          f.isTyping = false
          updated[idx] = f
          sortFriends(updated)
          return updated
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_participants' }, (payload) => {
        if (!aliveRef.current) return
        const row = payload.new as { conversation_id: string; profile_id: string; typing_at: string | null; last_read_at: string | null }
        const friendId = convToFriendRef.current[row.conversation_id]
        if (!friendId) return

        if (row.profile_id !== uid) {
          const isTyping = !!row.typing_at && (Date.now() - new Date(row.typing_at).getTime()) < TYPING_WINDOW_MS
          setFriends((prev) => {
            const idx = prev.findIndex((f) => f.id === friendId)
            if (idx === -1) return prev
            if (prev[idx].isTyping === isTyping) return prev
            const updated = [...prev]
            updated[idx] = { ...updated[idx], isTyping }
            sortFriends(updated)
            return updated
          })
        }

        if (row.profile_id !== uid && row.last_read_at) {
          setFriends((prev) => prev.map((f) =>
            f.id === friendId ? { ...f, partnerLastReadAt: row.last_read_at } : f
          ))
        }
      })
      .subscribe()

    return () => {
      aliveRef.current = false
      void supabase.removeChannel(channel)
    }
  }, [friends.length, userId])

  // ---- Polling: sync typing + online presence every 3s ----
  useEffect(() => {
    if (!userId || !friends.length) return
    const supabase = createClient()
    const uid = userIdRef.current

    async function poll() {
      if (!aliveRef.current) return

      // Poll online presence for each friend
      const friendIds = friendsRef.current.map((f) => f.id)
      if (friendIds.length) {
        const now = Date.now()
        const { data: profiles } = await supabase.from('profiles')
          .select('id,last_active_at,online_visible')
          .in('id', friendIds)
        if (profiles && aliveRef.current) {
          setFriends((prev) => {
            let changed = false
            const next = prev.map((f) => {
              const p = profiles.find((x) => x.id === f.id)
              if (!p) return f
              const isOnline = p.online_visible !== false && !!p.last_active_at && (now - new Date(p.last_active_at).getTime()) < ONLINE_WINDOW_MS
              if (f.isOnline !== isOnline) { changed = true; return { ...f, isOnline, last_active_at: p.last_active_at } }
              return f
            })
            return changed ? next : prev
          })
        }
      }

      // Poll typing + read receipts
      const convIds = Object.keys(convToFriendRef.current)
      if (!convIds.length) return

      const { data: parts } = await supabase.from('conversation_participants')
        .select('conversation_id,profile_id,typing_at,last_read_at')
        .in('conversation_id', convIds)

      if (!parts || !aliveRef.current) return

      const now = Date.now()
      const friendTyping: Record<string, boolean> = {}
      const partsByConv: Record<string, typeof parts> = {}
      for (const p of parts) {
        if (!partsByConv[p.conversation_id]) partsByConv[p.conversation_id] = []
        partsByConv[p.conversation_id].push(p)
        if (p.profile_id !== uid) {
          friendTyping[p.conversation_id] = !!p.typing_at && (now - new Date(p.typing_at).getTime()) < TYPING_WINDOW_MS
        }
      }

      const updates: { friendId: string; isTyping: boolean; partnerLastReadAt: string | null }[] = []

      for (const convId of convIds) {
        const friendId = convToFriendRef.current[convId]
        if (!friendId) continue
        const isTyping = friendTyping[convId] ?? false
        const friendParts = partsByConv[convId] ?? []
        const friendRow = friendParts.find((p) => p.profile_id !== uid)
        const partnerLastReadAt = friendRow?.last_read_at ?? null
        updates.push({ friendId, isTyping, partnerLastReadAt })
      }

      if (!aliveRef.current) return

      setFriends((prev) => {
        let changed = false
        const next = prev.map((f) => {
          const u = updates.find((x) => x.friendId === f.id)
          if (!u) return f
          if (f.isTyping !== u.isTyping || f.partnerLastReadAt !== u.partnerLastReadAt) {
            changed = true
            return { ...f, isTyping: u.isTyping, partnerLastReadAt: u.partnerLastReadAt }
          }
          return f
        })
        if (changed) sortFriends(next)
        return changed ? next : prev
      })
    }

    const interval = window.setInterval(poll, POLL_MS)
    void poll()
    return () => window.clearInterval(interval)
  }, [userId, friends.length])

  async function updateRequest(id: string, status: 'accepted' | 'declined' | 'cancelled') {
    const supabase = createClient()
    const { error: updateError } = await supabase.from('friend_requests').update({ status }).eq('id', id)
    if (updateError) setError(friendlyError(updateError, 'Could not update this request. Please try again.'))
    else window.location.reload()
  }

  const openChat = useCallback(async (profileId: string) => {
    if (openingId) return
    setOpeningId(profileId); setError('')
    const supabase = createClient()

    const { data, error: rpcError } = await supabase.rpc('start_direct_chat', { p_other_profile_id: profileId })
    if (rpcError) { setOpeningId(null); setError(friendlyError(rpcError, 'Could not open the chat. Please try again.')); return }

    const convId = data as string

    // Mark read on server
    void supabase.rpc('mark_conversation_read', { p_conversation_id: convId })

    // Clear optimistic unread
    setFriends((prev) => prev.map((f) => f.id === profileId ? { ...f, hasUnread: false, isTyping: false } : f))

    setOpeningId(null)
    router.push(`/chat/${convId}`)
  }, [openingId, router])

  const incoming = requests.filter((r) => r.status === 'pending' && r.receiver_id === userId)
  const outgoing = requests.filter((r) => r.status === 'pending' && r.sender_id === userId)
  const pendingCount = incoming.length + outgoing.length

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppHeader title="Friends" icon="users" />
      <div className="mx-auto max-w-2xl w-full px-4 pb-10 pt-4 lg:max-w-3xl">
        {error && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}

        {loading ? (
          <div className="mt-4"><FriendsSkeleton /></div>
        ) : (
          <>
            <div className="mt-2 flex border-b border-slate-800">
              <TabButton label="Friends" active={activeTab === 'friends'} onClick={() => setActiveTab('friends')} />
              <TabButton label="Pending" active={activeTab === 'pending'} count={pendingCount} onClick={() => setActiveTab('pending')} />
            </div>

            {activeTab === 'friends' && (
              <section className="mt-2">
                {friends.length === 0 ? (
                  <p className="mt-8 text-center text-sm text-slate-500">No friends yet. Start matching to connect!</p>
                ) : (
                  <div className="divide-y divide-slate-800/60">
                    {friends.map((p) => {
                      const identity = resolveIdentity(p)
                      const busy = openingId === p.id
                      const isLastFromMe = p.lastSenderId === userId
                      const isRead = isLastFromMe && !!p.partnerLastReadAt && !!p.lastMessageTime &&
                        new Date(p.partnerLastReadAt).getTime() >= new Date(p.lastMessageTime).getTime()

                      return (
                        <div key={p.id}
                          onClick={() => { if (!busy) void openChat(p.id) }}
                          className="flex cursor-pointer items-center gap-3 px-1 py-3 transition hover:bg-slate-900/40 sm:px-2">

                          <div className="relative flex-none">
                            <div className="h-12 w-12 overflow-hidden rounded-full bg-gradient-to-br from-cyan-600 to-cyan-400">
                              <span className="flex h-full w-full items-center justify-center text-lg font-bold text-white">
                                {(p.display_name ?? '?')[0]?.toUpperCase() ?? '?'}
                              </span>
                            </div>
                            <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-slate-950 ${p.isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`truncate text-sm font-semibold ${identity.colorClass}`}>{identity.label}</span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              {p.isTyping ? (
                                <div className="flex items-center gap-1.5">
                                  <TypingDots />
                                  <span className="text-xs text-cyan-400">typing...</span>
                                </div>
                              ) : p.lastMessage ? (
                                <>
                                  {isLastFromMe && <TickIcon read={!!isRead} />}
                                  <p className={`min-w-0 flex-1 truncate text-xs ${p.hasUnread ? 'font-semibold text-white' : 'text-slate-400'}`}>
                                    {isLastFromMe && <span className="text-slate-500">You: </span>}
                                    {p.lastMessage}
                                  </p>
                                </>
                              ) : (
                                <p className="min-w-0 flex-1 truncate text-xs text-slate-500">Start a conversation</p>
                              )}
                              {!p.isTyping && p.lastMessageTime && (
                                <span className={`flex-none text-[10px] ${p.hasUnread ? 'font-semibold text-cyan-400' : 'text-slate-600'}`}>
                                  {formatTime(p.lastMessageTime)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-none items-center">
                            <button onClick={(e) => { e.stopPropagation(); if (!busy) void openChat(p.id) }} disabled={busy}
                              className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 text-slate-300 transition hover:border-cyan-400 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:opacity-50">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )}

            {activeTab === 'pending' && (
              <section className="mt-4">
                {incoming.length === 0 && outgoing.length === 0 ? (
                  <p className="mt-8 text-center text-sm text-slate-500">No pending requests.</p>
                ) : (
                  <div className="space-y-3">
                    {incoming.map((r) => {
                      const sender = allProfiles[r.sender_id]
                      const identity = sender ? resolveIdentity(sender) : null
                      return (
                        <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                          <div className="h-10 w-10 flex-none overflow-hidden rounded-full bg-gradient-to-br from-cyan-600 to-cyan-400">
                            <span className="flex h-full w-full items-center justify-center text-sm font-bold text-white">{(sender?.display_name ?? '?')[0]?.toUpperCase()}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{identity ? <span className={identity.colorClass}>{identity.label}</span> : 'Unknown'}</p>
                            <p className="text-xs text-slate-500">Wants to connect with you.</p>
                          </div>
                          <div className="flex flex-none gap-2">
                            <button onClick={() => updateRequest(r.id, 'accepted')} className="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-bold text-slate-950">Accept</button>
                            <button onClick={() => updateRequest(r.id, 'declined')} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300">Decline</button>
                          </div>
                        </div>
                      )
                    })}
                    {outgoing.map((r) => {
                      const receiver = allProfiles[r.receiver_id]
                      const identity = receiver ? resolveIdentity(receiver) : null
                      return (
                        <div key={r.id} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                          <div className="h-10 w-10 flex-none overflow-hidden rounded-full bg-gradient-to-br from-cyan-600 to-cyan-400">
                            <span className="flex h-full w-full items-center justify-center text-sm font-bold text-white">{(receiver?.display_name ?? '?')[0]?.toUpperCase()}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">{identity ? <span className={identity.colorClass}>{identity.label}</span> : 'Unknown'}</p>
                            <p className="text-xs text-slate-500">Request pending.</p>
                          </div>
                          <button onClick={() => updateRequest(r.id, 'cancelled')} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300">Cancel</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
