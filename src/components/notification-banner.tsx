'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { MessageCircle, UserPlus, UserMinus, Ban, Trash2, X, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resolveIdentity, type Identity } from '@/lib/identity'
import { isBotProfile } from '@/lib/bot'
import { getNotifPrefs, type NotifCategory } from '@/lib/notification-prefs'
import { notify } from '@/lib/notification-sound'

const AUTO_DISMISS_MS = 6000
const SWIPE_THRESHOLD = 70

type BannerItem = {
  id: string
  kind: string
  headline: string
  sub: string
  identity: Identity
  kindCategory: NotifCategory
  icon: 'message' | 'request' | 'unfriend' | 'block' | 'chat_deleted'
  href: string
  fromUserId: string | null
}

const KIND_HEADLINE: Record<string, string> = {
  message: 'New message',
  friend_request: 'Friend request',
  accept: 'Friend request accepted',
  reject: 'Friend request declined',
  withdraw: 'Friend request cancelled',
  unfriend: 'Unfriended',
  blocked: 'Blocked you',
  unblocked: 'Unblocked you',
  delete_chat: 'Chat deleted',
}

const KIND_SUB: Record<string, string> = {
  friend_request: 'sent you a friend request',
  accept: 'accepted your friend request',
  reject: 'rejected your friend request',
  withdraw: 'cancelled their friend request',
  unfriend: 'unfriended you',
  blocked: 'blocked you',
  unblocked: 'unblocked you',
  delete_chat: 'deleted your chat',
}

const FRIEND_LIFECYCLE = new Set(['friend_request', 'accept', 'reject', 'withdraw'])

function kindToCategory(kind: string): NotifCategory | null {
  const map: Record<string, NotifCategory> = {
    message: 'message',
    friend_request: 'friend_request',
    accept: 'friend_request',
    reject: 'friend_request',
    withdraw: 'friend_request',
    blocked: 'block',
    unblocked: 'block',
    unfriend: 'unfriend',
    delete_chat: 'delete_chat',
  }
  return map[kind] ?? null
}

function kindIcon(kind: string): BannerItem['icon'] {
  if (kind === 'message' || kind === 'unblocked') return 'message'
  if (FRIEND_LIFECYCLE.has(kind)) return 'request'
  if (kind === 'unfriend') return 'unfriend'
  if (kind === 'blocked') return 'block'
  if (kind === 'delete_chat') return 'chat_deleted'
  return 'request'
}

function Icon({ icon }: { icon: BannerItem['icon'] }) {
  const cls = 'h-5 w-5'
  switch (icon) {
    case 'message': return <MessageCircle className={`${cls} text-cyan-300`} />
    case 'request': return <UserPlus className={`${cls} text-cyan-300`} />
    case 'unfriend': return <UserMinus className={`${cls} text-red-300`} />
    case 'block': return <Ban className={`${cls} text-red-300`} />
    case 'chat_deleted': return <Trash2 className={`${cls} text-red-300`} />
  }
}

export function NotificationBanner() {
  const router = useRouter()
  const [queue, setQueue] = useState<BannerItem[]>([])
  const [leaving, setLeaving] = useState(false)
  const [dragX, setDragX] = useState(0)
  const [actingOn, setActingOn] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const userIdRef = useRef<string | null>(null)
  const current = queue[0] ?? null

  const removeCurrent = useCallback((animate = true) => {
    if (!current) return
    if (!animate) {
      setLeaving(false)
      setDragX(0)
      setQueue((q) => q.slice(1))
      return
    }
    setLeaving(true)
    window.setTimeout(() => {
      setLeaving(false)
      setDragX(0)
      setQueue((q) => q.slice(1))
    }, 240)
  }, [current])

  // Auto-dismiss the active banner after a few seconds.
  useEffect(() => {
    if (!current) return
    timerRef.current = window.setTimeout(() => removeCurrent(true), AUTO_DISMISS_MS)
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current) }
  }, [current, removeCurrent])

  // Cancel any pending auto-dismiss timer on unmount.
  useEffect(() => {
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current) }
  }, [])

  function handleOpen() {
    if (!current) return
    const href = current.href
    removeCurrent(false)
    if (current.kind === 'message') {
      router.push(href)
      return
    }
    if (FRIEND_LIFECYCLE.has(current.kind)) {
      window.dispatchEvent(new CustomEvent('shahzap:open-tab', { detail: 'pending' }))
      router.push('/friends?tab=pending')
      return
    }
    router.push('/friends')
  }

  // Accept or reject an incoming friend request directly from the banner.
  async function actOnFriendRequest(status: 'accepted' | 'declined') {
    if (!current || current.kind !== 'friend_request') return
    const me = userIdRef.current
    const senderId = current.fromUserId
    if (!me || !senderId) return
    setActingOn(current.id)
    const supabase = createClient()
    const { data: req, error: findErr } = await supabase
      .from('friend_requests')
      .select('id')
      .eq('sender_id', senderId)
      .eq('receiver_id', me)
      .eq('status', 'pending')
      .maybeSingle()
    if (findErr || !req) {
      setActingOn(null)
      removeCurrent(true)
      return
    }
    const { error: updErr } = await supabase.from('friend_requests').update({ status }).eq('id', req.id)
    setActingOn(null)
    if (updErr) return
    notify('request')
    removeCurrent(false)
    if (status === 'accepted') {
      // Jump straight into the chat with the new friend.
      const { data: convId } = await supabase.rpc('start_direct_chat', { p_other_profile_id: senderId })
      if (convId) {
        window.dispatchEvent(new CustomEvent('shahzap:opened-chat', { detail: `/chat/${convId}` }))
        router.push(`/chat/${convId}`)
      }
    }
  }

  // Pointer handlers for horizontal swipe-to-dismiss
  const dragState = useRef<{ startX: number; startY: number; dx: number; on: boolean }>({ startX: 0, startY: 0, dx: 0, on: false })
  function onPointerDown(e: React.PointerEvent) {
    dragState.current = { startX: e.clientX, startY: e.clientY, dx: 0, on: true }
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragState.current
    if (!d.on) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.abs(dx) > Math.abs(dy) || d.dx !== 0) {
      d.dx = dx
      setDragX(dx)
    }
  }
  function onPointerUp() {
    const d = dragState.current
    if (!d.on) return
    d.on = false
    if (Math.abs(d.dx) > SWIPE_THRESHOLD) {
      removeCurrent(true)
    } else {
      setDragX(0)
    }
    d.dx = 0
  }
  function onPointerCancel() {
    dragState.current.on = false
    dragState.current.dx = 0
    setDragX(0)
  }

  // Realtime listener: enqueue incoming notification banners.
  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | undefined

    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      userIdRef.current = user.id

      channel = supabase
        .channel(`notif-banner:${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
          async (payload) => {
            const row = payload.new as { id: string; kind: string; from_user_id: string | null; conversation_id: string | null; text: string; created_at: string }
            if (isBotProfile(row.from_user_id)) return
            const cat = kindToCategory(row.kind)
            if (!cat) return
            if (!getNotifPrefs()[cat]) return

            let identity: Identity = { label: 'Someone', colorClass: 'text-slate-300' }
            if (row.from_user_id) {
              const { data: p } = await supabase.from('profiles')
                .select('display_name,gender,gender_visible')
                .eq('id', row.from_user_id)
                .maybeSingle()
              if (p) identity = resolveIdentity(p as never)
            }

            const item: BannerItem = {
              id: row.id,
              kind: row.kind,
              headline: KIND_HEADLINE[row.kind] ?? 'Notification',
              sub: row.kind === 'message' ? (row.text || 'sent you a message') : (KIND_SUB[row.kind] ?? ''),
              identity,
              kindCategory: cat,
              icon: kindIcon(row.kind),
              fromUserId: row.from_user_id,
              href: row.kind === 'message' && row.conversation_id
                ? `/chat/${row.conversation_id}`
                : '/friends',
            }

            setQueue((q) => [...q, item])
          },
        )
        .subscribe()
    }

    void init()

    return () => {
      if (channel) void supabase.removeChannel(channel)
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  if (!current) return null

  const identityLabel = current.identity.label
  const showActions = current.kind === 'friend_request'
  const acting = actingOn === current.id

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-3">
      <div
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen() } }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{ transform: `translateX(${dragX}px)`, touchAction: 'pan-y' }}
        className={`pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 text-left shadow-2xl shadow-black/50 backdrop-blur-xl ${leaving ? 'banner-out' : 'banner-in'} ${dragX !== 0 ? 'cursor-grabbing' : ''}`}
      >
        <div className="flex items-center gap-3 p-3.5 pr-10">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-white/10 bg-white/5">
            <Icon icon={current.icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-white">{current.headline}</span>
            <span className="block truncate text-xs">
              <span className={current.identity.colorClass}>{identityLabel}</span>
              {current.sub ? <span className="text-slate-400"> {current.sub}</span> : null}
            </span>
          </span>
        </div>

        {showActions ? (
          <div className="flex gap-2 px-3.5 pb-3.5"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={!!acting}
              onClick={(e) => { e.stopPropagation(); actOnFriendRequest('accepted') }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
            >
              <Check size={14} />
              {acting ? 'Accepting…' : 'Accept'}
            </button>
            <button
              type="button"
              disabled={!!acting}
              onClick={(e) => { e.stopPropagation(); actOnFriendRequest('declined') }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
            >
              <X size={14} />
              Decline
            </button>
          </div>
        ) : null}

        <span
          role="button"
          aria-label="Dismiss"
          onPointerDown={(e) => { e.stopPropagation() }}
          onClick={(e) => { e.stopPropagation(); removeCurrent(true) }}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X size={15} />
        </span>
      </div>
    </div>
  )
}
