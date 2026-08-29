'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resolveIdentity } from '@/lib/identity'
import { Shimmer } from '@/components/shimmer'

// A non-friend DM is removed from this tab once the other person has been
// offline (last_active_at older than this) — and it stays gone unless you
// become friends (in which case they live on the Friends page instead).
const OFFLINE_REMOVE_MS = 5 * 60 * 1000
const ONLINE_WINDOW_MS = 5 * 60 * 1000

type MsgThread = {
  conversationId: string
  otherId: string
  displayName: string
  lastMessage: string | null
  lastMessageTime: string | null
  lastSenderId: string | null
  lastMessageDeliveredAt: string | null
  lastMessageReadAt: string | null
  unreadCount: number
  isOnline: boolean
  countryCode: string | null
  gender: string | null
  genderVisible: boolean
  ageBand: string | null
  lastActiveAt: string | null
}

type Profile = {
  id: string
  display_name: string | null
  country_code: string | null
  gender: string | null
  gender_visible: boolean
  age_band: string | null
  last_active_at: string | null
  online_visible: boolean
}

function formatTime(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return time
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function OnlineMessages({ onUnreadChange }: { onUnreadChange?: (count: number) => void }) {
  const router = useRouter()
  const [threads, setThreads] = useState<MsgThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const userIdRef = useRef<string | null>(null)
  const onUnreadRef = useRef(onUnreadChange)
  onUnreadRef.current = onUnreadChange
  // People permanently removed from this tab (they were offline >5 min and
  // never became friends). Persisted so a refresh doesn't bring them back.
  const hiddenRef = useRef<Set<string>>(new Set())
  const [hiddenReady, setHiddenReady] = useState(false)

  const saveHidden = () => {
    try { localStorage.setItem('shahzap:hidden-msg-users', JSON.stringify([...hiddenRef.current])) } catch {}
  }
  const loadHidden = () => {
    try {
      const raw = localStorage.getItem('shahzap:hidden-msg-users')
      if (raw) {
        const arr = JSON.parse(raw) as string[]
        hiddenRef.current = new Set(arr.filter(Boolean))
      }
    } catch {}
  }

  useEffect(() => {
    loadHidden()
    setHiddenReady(true)
  }, [])

  // Report the total number of conversations with unread messages to the parent
  // (used to render a live badge on the Messages tab even while it's not open).
  useEffect(() => {
    const unread = threads.reduce((sum, t) => sum + (t.unreadCount > 0 ? 1 : 0), 0)
    onUnreadRef.current?.(unread)
  }, [threads])

  useEffect(() => {
    if (!hiddenReady) return
    const supabase = createClient()
    let active = true

    async function isFriend(uid: string, otherId: string): Promise<boolean> {
      const { data } = await supabase.from('friend_requests')
        .select('id')
        .eq('status', 'accepted')
        .or(`and(sender_id.eq.${uid},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${uid})`)
        .maybeSingle()
      return !!data
    }

    async function fetchThreads() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !active) return
      const uid = user.id
      userIdRef.current = uid

      const { data: myParts } = await supabase.from('conversation_participants')
        .select('conversation_id,conversations!inner(status)')
        .eq('profile_id', uid)
        .eq('conversations.status', 'active')

      if (!myParts?.length) { if (active) { setThreads([]); setLoading(false) } return }
      const convIds = myParts.map((p) => p.conversation_id)

      const { data: allParts } = await supabase.from('conversation_participants')
        .select('conversation_id,profile_id')
        .in('conversation_id', convIds)

      if (!allParts) { if (active) { setThreads([]); setLoading(false) } return }

      // Only exactly-2-participant conversations
      const partsByConv: Record<string, string[]> = {}
      for (const p of allParts) {
        if (!partsByConv[p.conversation_id]) partsByConv[p.conversation_id] = []
        partsByConv[p.conversation_id].push(p.profile_id)
      }
      const twoPerson: { convId: string; other: string }[] = []
      for (const [convId, parts] of Object.entries(partsByConv)) {
        if (parts.length === 2 && parts.includes(uid)) {
          twoPerson.push({ convId, other: parts.find((id) => id !== uid)! })
        }
      }
      if (!twoPerson.length) { if (active) { setThreads([]); setLoading(false) } return }

      // Keep only NON-friends (skip friends + hidden)
      const kept: { convId: string; other: string }[] = []
      for (const t of twoPerson) {
        if (hiddenRef.current.has(t.other)) continue
        if (await isFriend(uid, t.other)) continue
        kept.push(t)
      }
      if (!kept.length) { if (active) { setThreads([]); setLoading(false) } return }

      const otherIds = [...new Set(kept.map((t) => t.other))]
      const { data: profiles } = await supabase.from('profiles')
        .select('id,display_name,country_code,gender,gender_visible,age_band,last_active_at,online_visible')
        .in('id', otherIds)

      const profileMap: Record<string, Profile> = {}
      for (const p of ((profiles ?? []) as Profile[])) profileMap[p.id] = p

      // Last message per conversation
      const { data: lastMsgs } = await supabase.from('messages')
        .select('id,original_message,created_at,sender_id,conversation_id,read_at,delivered_at')
        .in('conversation_id', kept.map((t) => t.convId))
        .order('created_at', { ascending: false })

      const latestByConv: Record<string, any> = {}
      if (lastMsgs) {
        for (const m of lastMsgs) {
          if (!latestByConv[m.conversation_id]) latestByConv[m.conversation_id] = m
        }
      }

      // Unread count per conversation
      const { data: unreadRows } = await supabase.from('messages')
        .select('conversation_id')
        .in('conversation_id', kept.map((t) => t.convId))
        .neq('sender_id', uid)
        .is('read_at', null)
      const unreadMap: Record<string, number> = {}
      if (unreadRows) {
        for (const row of unreadRows) unreadMap[row.conversation_id] = (unreadMap[row.conversation_id] ?? 0) + 1
      }

      const now = Date.now()
      const list: MsgThread[] = []
      for (const { convId, other } of kept) {
        const p = profileMap[other]
        if (!p) continue
        const lastActive = p.last_active_at ?? null
        const isOnline = p.online_visible !== false && !!lastActive && (now - new Date(lastActive).getTime()) < ONLINE_WINDOW_MS
        // Offline for > 5 min (not friends) → remove permanently
        if (p.online_visible !== false && !!lastActive && (now - new Date(lastActive).getTime()) > OFFLINE_REMOVE_MS) {
          hiddenRef.current.add(other)
          saveHidden()
          continue
        }
        const lastMsg = latestByConv[convId]
        list.push({
          conversationId: convId,
          otherId: other,
          displayName: p.display_name ?? 'Unknown',
          lastMessage: lastMsg ? (lastMsg.sender_id === uid ? `You: ${lastMsg.original_message}` : lastMsg.original_message) : null,
          lastMessageTime: lastMsg?.created_at ?? null,
          lastSenderId: lastMsg?.sender_id ?? null,
          lastMessageDeliveredAt: lastMsg?.delivered_at ?? null,
          lastMessageReadAt: lastMsg?.read_at ?? null,
          unreadCount: unreadMap[convId] ?? 0,
          isOnline,
          countryCode: p.country_code,
          gender: p.gender,
          genderVisible: p.gender_visible,
          ageBand: p.age_band,
          lastActiveAt: lastActive,
        })
      }
      const sorted = list.sort((a, b) => (b.lastMessageTime ?? '').localeCompare(a.lastMessageTime ?? ''))
      if (active) { setThreads(sorted); setLoading(false) }
    }

    void fetchThreads()

    // Fast incremental updates. New incoming messages update the matching
    // thread in-place straight from the realtime payload (like the Friends
    // page) so they appear immediately — no full re-query on every message.
    function applyMessageInserts(msg: {
      id: string; conversation_id: string; sender_id: string;
      original_message: string | null; created_at: string;
      read_at: string | null; delivered_at: string | null;
    }) {
      const uid = userIdRef.current
      if (!uid) return
      let found = false
      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.conversationId === msg.conversation_id)
        if (idx === -1) return prev
        found = true
        const updated = [...prev]
        const t = { ...updated[idx] }
        t.lastMessage = msg.sender_id === uid ? `You: ${msg.original_message}` : msg.original_message
        t.lastMessageTime = msg.created_at
        t.lastSenderId = msg.sender_id
        t.lastMessageDeliveredAt = msg.delivered_at
        t.lastMessageReadAt = msg.read_at
        if (msg.sender_id !== uid) t.unreadCount = (t.unreadCount || 0) + 1
        updated[idx] = t
        // Move to the top (most recent first).
        return [t, ...updated.filter((x) => x.conversationId !== t.conversationId)]
      })
      // A message arrived for a conversation we don't have loaded yet (a brand
      // new non-friend DM) — do one full fetch to surface the new thread.
      if (!found && active) void fetchThreads()
    }

    function applyMessageUpdates(msg: {
      id: string; conversation_id: string; sender_id: string;
      read_at: string | null; delivered_at: string | null;
    }) {
      const uid = userIdRef.current
      if (!uid) return
      setThreads((prev) => {
        const idx = prev.findIndex((t) => t.conversationId === msg.conversation_id)
        if (idx === -1) return prev
        const t = prev[idx]
        // Only react to ticks on the thread's current last message.
        if (t.lastSenderId !== msg.sender_id) return prev
        // The other person read the conversation → nothing left unread here
        // if it was their own last message that got read.
        const updated = [...prev]
        updated[idx] = {
          ...t,
          lastMessageDeliveredAt: msg.delivered_at ?? t.lastMessageDeliveredAt,
          lastMessageReadAt: msg.read_at ?? t.lastMessageReadAt,
          unreadCount: msg.sender_id !== uid && msg.read_at ? 0 : t.unreadCount,
        }
        return updated
      })
    }

    const channel = supabase.channel('online-msg-tab')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as { id: string; conversation_id: string; sender_id: string; original_message: string | null; created_at: string; read_at: string | null; delivered_at: string | null }
        applyMessageInserts(msg)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as { id: string; conversation_id: string; sender_id: string; read_at: string | null; delivered_at: string | null }
        applyMessageUpdates(msg)
      })
      // Structural changes (friend added, blocked, profile change, new
      // conversation) need the full re-query to keep the list consistent.
      // These are rare compared to incoming messages.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friend_requests' }, () => { void fetchThreads() })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_requests' }, () => { void fetchThreads() })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friend_requests' }, () => { void fetchThreads() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => { void fetchThreads() })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversation_participants' }, () => { void fetchThreads() })
      .subscribe()

    const poll = window.setInterval(() => void fetchThreads(), 30_000)

    return () => { active = false; window.clearInterval(poll); void supabase.removeChannel(channel) }
  }, [hiddenReady])

  if (loading) {
    return (
      <div aria-busy="true" className="mt-2 space-y-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 px-1 py-3 sm:px-2">
            <Shimmer className="h-12 w-12 flex-none rounded-full" />
            <div className="flex-1 space-y-2">
              <Shimmer className="h-3.5 w-28 rounded" />
              <Shimmer className="h-3 w-40 rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>
  }

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <MessageCircle size={28} className="text-slate-700" />
        <p className="max-w-xs text-sm text-slate-500">
          No messages yet. Chat with someone from the Online tab and their conversation will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-2 divide-y divide-slate-800/60">
      {threads.map((t) => {
        const identity = resolveIdentity({ display_name: t.displayName, gender: t.gender, gender_visible: t.genderVisible })
        return (
          <div key={t.conversationId}
            onClick={() => router.push(`/chat/${t.conversationId}`)}
            className="flex cursor-pointer items-center gap-3 px-1 py-3 transition hover:bg-slate-900/40 sm:px-2">
            <div className="relative flex-none">
              <div className="h-12 w-12 overflow-hidden rounded-full bg-gradient-to-br from-cyan-600 to-cyan-400 sm:h-14 sm:w-14">
                <span className="flex h-full w-full items-center justify-center text-lg font-bold text-white sm:text-xl">
                  {(t.displayName)[0]?.toUpperCase() ?? '?'}
                </span>
              </div>
              <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-slate-950 ${t.isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`truncate text-sm ${t.unreadCount > 0 ? 'font-bold text-white' : `font-semibold ${identity.colorClass}`}`}>{identity.label}</span>
                <span className="flex-none text-[10px] text-slate-500">
                  {t.isOnline ? 'online' : 'offline'}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                <span className={`truncate ${t.unreadCount > 0 ? 'font-semibold text-slate-200' : 'text-slate-500'}`}>
                  {t.lastMessage ?? 'Start a conversation'}
                </span>
                {t.lastSenderId && t.lastSenderId === userIdRef.current && (
                  <span className={`flex-none text-[11px] ${t.lastMessageReadAt ? 'text-cyan-300' : t.lastMessageDeliveredAt ? 'text-slate-400' : 'text-slate-600'}`}>
                    {t.lastMessageReadAt ? '✓✓' : t.lastMessageDeliveredAt ? '✓✓' : '✓'}
                  </span>
                )}
                {t.lastMessageTime && <span className="flex-none text-slate-500">· {formatTime(t.lastMessageTime)}</span>}
              </div>
            </div>
            {t.unreadCount > 0 && (
              <span className="flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-cyan-400 px-1.5 text-[10px] font-bold text-slate-950">
                {t.unreadCount > 9 ? '9+' : t.unreadCount}
              </span>
            )}
            <button aria-label="Open chat" onClick={(e) => { e.stopPropagation(); router.push(`/chat/${t.conversationId}`) }}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-slate-700 text-slate-300 transition hover:border-cyan-400 hover:bg-cyan-400/10 hover:text-cyan-200">
              <MessageCircle size={15} />
            </button>
          </div>
        )
      })}
      <p className="pt-3 text-center text-[11px] text-slate-600">
        Non-friend chats disappear after the other person is offline for 5 minutes. Adding them as a friend moves the chat to your Friends page.
      </p>
    </div>
  )
}
