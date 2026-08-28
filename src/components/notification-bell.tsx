'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { Bell, UserPlus, MessageCircle, UserMinus, UserCheck, X, Ban, Undo2, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { playFriendRequestSound, playMessageSound, playUnfriendSound } from '@/lib/notification-sound'
import { resolveIdentity, type Identity } from '@/lib/identity'
import { isBotProfile } from '@/lib/bot'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

type Notification = {
  id: string
  kind: 'friend_request' | 'message' | 'unfriend' | 'accept' | 'reject' | 'blocked' | 'unblocked' | 'withdraw' | 'delete_chat'
  identity: Identity
  text: string
  href: string
  at: number
  unreadCount: number
}

function ago(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function kindToHref(kind: string, conversationId?: string | null): string {
  if (kind === 'message' && conversationId) return `/chat/${conversationId}`
  return '/friends'
}

function kindToText(kind: string): string {
  switch (kind) {
    case 'friend_request': return 'sent you a friend request'
    case 'unfriend': return 'unfriended you'
    case 'accept': return 'accepted your friend request'
    case 'reject': return 'rejected your friend request'
    case 'blocked': return 'blocked you'
    case 'unblocked': return 'unblocked you'
    case 'withdraw': return 'cancelled friend request'
    case 'delete_chat': return 'deleted your chat'
    case 'message': return 'sent you a message'
    default: return ''
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [nowTick, setNowTick] = useState(0)
  const userIdRef = useRef<string | null>(null)
  // IDs whose dots have been visually cleared (on bell close)
  const dismissedIdsRef = useRef(new Set<string>())

  function calcBadge(list: Notification[]) {
    let c = 0
    for (const n of list) {
      if (!dismissedIdsRef.current.has(n.id)) c++
    }
    return c
  }

  const [badge, setBadge] = useState(0)

  const fetchNotifications = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    userIdRef.current = user.id

    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS).toISOString()

    const { data: rows } = await supabase
      .from('notifications')
      .select('id, kind, from_user_id, conversation_id, text, created_at, unread_count')
      .eq('user_id', user.id)
      .gt('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(50)

    if (!rows) return

    const fromIds = [...new Set(rows.map((r) => r.from_user_id).filter(Boolean))]
    const identityMap = new Map<string, Identity>()
    if (fromIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id,display_name,gender,gender_visible')
        .in('id', fromIds)
      if (profiles) {
        for (const p of profiles) {
          identityMap.set(p.id, resolveIdentity(p as never))
        }
      }
    }

    const notifs: Notification[] = rows.map((r) => {
      const identity = r.from_user_id ? (identityMap.get(r.from_user_id) ?? { label: 'Someone', colorClass: 'text-slate-300' }) : { label: 'Someone', colorClass: 'text-slate-300' }
      const unreadCount = r.unread_count ?? 1
      const text = r.kind === 'message' && unreadCount > 1
        ? `sent you a message (${unreadCount})`
        : kindToText(r.kind)
      return {
        id: r.id,
        kind: r.kind,
        identity,
        text,
        href: kindToHref(r.kind, r.conversation_id),
        at: new Date(r.created_at).getTime(),
        unreadCount,
      }
    })

    setItems(notifs)
    setBadge(calcBadge(notifs))
  }, [])

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | undefined

    async function init() {
      await fetchNotifications()

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      channel = supabase
        .channel(`notif-bell:${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
          async (payload) => {
            const row = payload.new as { id: string; kind: string; from_user_id: string | null; conversation_id: string | null; text: string; created_at: string; unread_count: number }
            if (isBotProfile(row.from_user_id)) return

            if (row.kind === 'message') playMessageSound()
            else if (row.kind === 'friend_request') playFriendRequestSound()
            else if (row.kind === 'unfriend' || row.kind === 'reject' || row.kind === 'blocked' || row.kind === 'delete_chat') playUnfriendSound()
            else playFriendRequestSound()

            let identity: Identity = { label: 'Someone', colorClass: 'text-slate-300' }
            if (row.from_user_id) {
              const { data: p } = await supabase
                .from('profiles')
                .select('display_name,gender,gender_visible')
                .eq('id', row.from_user_id)
                .maybeSingle()
              if (p) identity = resolveIdentity(p as never)
            }

            const unreadCount = row.unread_count ?? 1
            const text = row.kind === 'message' && unreadCount > 1
              ? `sent you a message (${unreadCount})`
              : kindToText(row.kind)

            const notif: Notification = {
              id: row.id,
              kind: row.kind as Notification['kind'],
              identity,
              text,
              href: kindToHref(row.kind, row.conversation_id),
              at: new Date(row.created_at).getTime(),
              unreadCount,
            }

            setItems((cur) => {
              const next = [notif, ...cur].slice(0, 50)
              setBadge(calcBadge(next))
              return next
            })
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
          (payload) => {
            const row = payload.new as { id: string; unread_count: number; kind: string; conversation_id: string | null }
            setItems((cur) => {
              const updated = cur.map((n) => {
                if (n.id !== row.id) return n
                const unreadCount = row.unread_count ?? 0
                const text = row.kind === 'message' && unreadCount > 1
                  ? `sent you a message (${unreadCount})`
                  : row.kind === 'message' && unreadCount <= 1
                    ? 'sent you a message'
                    : n.text
                return { ...n, unreadCount, text }
              })
              setBadge(calcBadge(updated))
              return updated
            })
          },
        )
        .subscribe()
    }

    void init()
    const ticker = window.setInterval(() => setNowTick(Date.now()), 30_000)

    return () => {
      window.clearInterval(ticker)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [fetchNotifications])

  function handleToggle() {
    if (open) {
      // Closing: dismiss all current dots and badge
      dismissedIdsRef.current = new Set(items.map((n) => n.id))
      setBadge(0)
    }
    setOpen((p) => !p)
  }

  return (
    <div className="relative">
      <button
        aria-label={`Notifications${badge ? `, ${badge} unread` : ''}`}
        onClick={handleToggle}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 transition hover:border-slate-500 hover:text-white"
      >
        <Bell size={17} />
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={handleToggle} />
          <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60">
            <p className="border-b border-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400">Notifications</p>
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">You&apos;re all caught up</p>
            ) : (
              <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
                {items.map((n) => {
                  const isFresh = !dismissedIdsRef.current.has(n.id)
                  return (
                    <li key={n.id}>
                      <Link href={n.href} onClick={handleToggle} className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-800">
                        <span className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-xl ${n.kind === 'friend_request' ? 'bg-cyan-400/10 text-cyan-300' : n.kind === 'blocked' ? 'bg-red-400/10 text-red-400' : n.kind === 'unblocked' ? 'bg-emerald-400/10 text-emerald-300' : n.kind === 'withdraw' ? 'bg-amber-400/10 text-amber-300' : n.kind === 'delete_chat' ? 'bg-red-400/10 text-red-300' : n.kind === 'unfriend' || n.kind === 'reject' ? 'bg-red-400/10 text-red-300' : n.kind === 'accept' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-violet-400/10 text-violet-300'}`}>
                          {n.kind === 'friend_request' ? <UserPlus size={15} /> : n.kind === 'blocked' ? <Ban size={15} /> : n.kind === 'unblocked' ? <UserCheck size={15} /> : n.kind === 'withdraw' ? <Undo2 size={15} /> : n.kind === 'delete_chat' ? <Trash2 size={15} /> : n.kind === 'unfriend' ? <UserMinus size={15} /> : n.kind === 'accept' ? <UserCheck size={15} /> : n.kind === 'reject' ? <X size={15} /> : <MessageCircle size={15} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            <span className={`font-semibold ${n.identity.colorClass}`}>{n.identity.label}</span>{' '}
                            <span className="text-slate-400">{n.text}</span>
                          </span>
                          <span className="mt-0.5 block text-[10px] text-slate-600">{ago((nowTick || Date.now()) - n.at)} ago</span>
                        </span>
                        {isFresh && <span className="mt-2 h-2 w-2 flex-none rounded-full bg-cyan-400" />}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
