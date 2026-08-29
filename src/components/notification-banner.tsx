'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { MessageCircle, UserPlus, UserMinus, Ban, Trash2, X, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { resolveIdentity, type Identity } from '@/lib/identity'
import { isBotProfile } from '@/lib/bot'
import { getNotifPrefs, type NotifCategory } from '@/lib/notification-prefs'
import { notify } from '@/lib/notification-sound'
import { getNotifDisplayPrefs, durationToMs, type BannerStackMode } from '@/lib/notification-display'
import { isTabVisible } from '@/lib/tab'

const SWIPE_THRESHOLD = 70
const LEAVE_MS = 240
// When stacking, cap how many banners are on screen at once so a long
// session never lets them cover the whole page; the rest stay queued.
const MAX_VISIBLE_STACK = 6

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

type CardProps = {
  item: BannerItem
  autoHideMs: number | null
  acting: boolean
  onOpen: (item: BannerItem) => void
  onAct: (item: BannerItem, status: 'accepted' | 'declined') => void
  onDismiss: (id: string) => void
  compact?: boolean
}

// A single banner card — manages its own slide, swipe-to-dismiss and
// auto-hide timer so multiple cards can live in a stacked column.
function BannerCard({ item, autoHideMs, acting, onOpen, onAct, onDismiss, compact }: CardProps) {
  const [leaving, setLeaving] = useState(false)
  const [dragX, setDragX] = useState(0)
  const dragState = useRef<{ startX: number; startY: number; dx: number; on: boolean }>({ startX: 0, startY: 0, dx: 0, on: false })

  const leave = useCallback(() => {
    setLeaving(true)
    window.setTimeout(() => onDismiss(item.id), LEAVE_MS)
  }, [item.id, onDismiss])

  // Auto-hide timer (none when the user chose "never disappear").
  useEffect(() => {
    if (autoHideMs == null) return
    const t = window.setTimeout(() => leave(), autoHideMs)
    return () => window.clearTimeout(t)
  }, [autoHideMs, leave])

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
      leave()
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

  const showActions = item.kind === 'friend_request'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={item.headline}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ transform: `translateX(${dragX}px)`, touchAction: 'pan-y' }}
      className={`pointer-events-auto relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 text-left shadow-lg shadow-black/40 backdrop-blur-xl ${leaving ? 'banner-out' : 'banner-in'} ${dragX !== 0 ? 'cursor-grabbing' : ''}`}
    >
      <div className={`flex items-center gap-3 pr-10 ${compact ? 'p-3' : 'p-3.5'}`}>
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-white/10 bg-white/5">
          <Icon icon={item.icon} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold text-white ${compact ? 'text-xs' : 'text-sm'}`}>{item.headline}</span>
          <span className={`block truncate text-xs ${compact ? 'mt-0.5' : ''}`}>
            <span className={item.identity.colorClass}>{item.identity.label}</span>
            {item.sub ? <span className="text-slate-400"> {item.sub}</span> : null}
          </span>
        </span>
      </div>

      {showActions ? (
        <div className="flex gap-2 px-3 pb-3"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            disabled={acting}
            onClick={(e) => { e.stopPropagation(); onAct(item, 'accepted') }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-400 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
          >
            <Check size={14} />
            {acting ? 'Accepting…' : 'Accept'}
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={(e) => { e.stopPropagation(); onAct(item, 'declined') }}
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
        onClick={(e) => { e.stopPropagation(); leave() }}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
      >
        <X size={15} />
      </span>
    </div>
  )
}

export function NotificationBanner() {
  const router = useRouter()
  const pathname = usePathname()
  const [queue, setQueue] = useState<BannerItem[]>([])
  const [prefs, setPrefs] = useState<BannerStackMode | null>(null)
  const [showBanner, setShowBanner] = useState<boolean>(true)
  const [actingOn, setActingOn] = useState<string | null>(null)
  const userIdRef = useRef<string | null>(null)
  const activeConversationRef = useRef<string | null>(null)
  const tabVisibleRef = useRef<boolean>(true)
  const [tabVisible, setTabVisible] = useState<boolean>(true)

  // Only surface in-app banner toasts while the user is actively on the tab.
  // When the tab is hidden/away, native OS pushes take over instead.
  useEffect(() => {
    const sync = () => {
      const v = isTabVisible()
      tabVisibleRef.current = v
      setTabVisible(v)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
      window.removeEventListener('blur', sync)
    }
  }, [])

  // Track which chat is currently open so the realtime listener can suppress
  // message banners for the conversation the user is already viewing.
  useEffect(() => {
    const m = /^\/chat\/([^/]+)/.exec(pathname)
    activeConversationRef.current = m ? decodeURIComponent(m[1]) : null
  }, [pathname])

  // Reflect display-preference changes (Settings) live.
  useEffect(() => {
    function sync() {
      const p = getNotifDisplayPrefs()
      setPrefs(p.stack)
      setShowBanner(p.showBanner)
    }
    sync()
    window.addEventListener('shahzap:notif-display-change', sync)
    return () => window.removeEventListener('shahzap:notif-display-change', sync)
  }, [])

  const removeItem = useCallback((id: string) => {
    setQueue((q) => q.filter((x) => x.id !== id))
  }, [])

  function handleOpen(item: BannerItem) {
    removeItem(item.id)
    if (item.kind === 'message') {
      router.push(item.href)
      return
    }
    if (FRIEND_LIFECYCLE.has(item.kind)) {
      window.dispatchEvent(new CustomEvent('shahzap:open-tab', { detail: 'pending' }))
      router.push('/friends?tab=pending')
      return
    }
    router.push('/friends')
  }

  // Accept or reject an incoming friend request directly from the banner.
  async function actOnFriendRequest(item: BannerItem, status: 'accepted' | 'declined') {
    if (item.kind !== 'friend_request') return
    const me = userIdRef.current
    const senderId = item.fromUserId
    if (!me || !senderId) return
    setActingOn(item.id)
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
      removeItem(item.id)
      return
    }
    const { error: updErr } = await supabase.from('friend_requests').update({ status }).eq('id', req.id)
    setActingOn(null)
    if (updErr) return
    notify('request')
    removeItem(item.id)
    if (status === 'accepted') {
      // Jump straight into the chat with the new friend.
      const { data: convId } = await supabase.rpc('start_direct_chat', { p_other_profile_id: senderId })
        if (convId) {
          router.push(`/chat/${convId}?from=notification`)
        }
    }
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
            // If the tab isn't visible, don't queue an in-app banner — a native
            // OS push is being delivered instead (presence-aware trigger).
            if (!tabVisibleRef.current) return

            // Don't interrupt the user with a banner for the chat they're
            // currently viewing — that message already shows inline there.
            if (
              row.kind === 'message' &&
              row.conversation_id &&
              row.conversation_id === activeConversationRef.current
            ) return

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
    }
  }, [])

  const display = getNotifDisplayPrefs()
  const autoHideMs = durationToMs(display.duration)
  const stack = prefs ?? display.stack

  // User turned off the toast banners entirely (sound + bell unaffected).
  if (!showBanner) return null
  // Only show in-app banner toasts while the user is actively on the tab;
  // when away, native OS pushes take over instead.
  if (!tabVisible) return null

  // Never show a message banner for the conversation the user is currently
  // viewing (it's already visible inline in that chat). pathname is reactive
  // so this stays up to date as the user navigates between chats.
  const chatMatch = /^\/chat\/([^/]+)/.exec(pathname)
  const activeConv = chatMatch ? decodeURIComponent(chatMatch[1]) : null
  const filtered = activeConv
    ? queue.filter((x) => !(x.kind === 'message' && x.href === `/chat/${activeConv}`))
    : queue

  if (filtered.length === 0) return null

  // Which banners are visible and their vertical order.
  let visible: BannerItem[] = []
  if (stack === 'single') {
    visible = [filtered[0]]
  } else if (stack === 'stack-new-top') {
    // Newest on top; cap how many pile up.
    visible = filtered.slice(-MAX_VISIBLE_STACK).reverse()
  } else {
    // stack-new-bottom: newest at the bottom, older ones stay on top.
    visible = filtered.slice(-MAX_VISIBLE_STACK)
  }

  // Compact look when more than one card is showing at once.
  const stacked = visible.length > 1

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-3">
      <div className={`flex w-full max-w-md flex-col ${stacked ? 'gap-2' : ''}`}>
        {visible.map((item) => (
          <BannerCard
            key={item.id}
            item={item}
            autoHideMs={autoHideMs}
            acting={actingOn === item.id}
            onOpen={handleOpen}
            onAct={actOnFriendRequest}
            onDismiss={removeItem}
            compact={stacked}
          />
        ))}
      </div>
    </div>
  )
}