'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { MoreVertical, Send, UserPlus, ShieldAlert, Ban, Languages, UserCircle2, CornerUpLeft, Pencil, Trash2, X, Check, ArrowDown, SunMoon, Clock, UserCheck, UserMinus } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { playFriendRequestSound, playMessageSound, playUnfriendSound } from '@/lib/notification-sound'
import { friendlyError } from '@/lib/errors'
import { getBotPersona, isBotProfile } from '@/lib/bot'
import { AdsterraBanner } from '@/components/adsterra-banner'
import { resolveIdentity, type Identity } from '@/lib/identity'
import { ACCENTS, getSelection, applySelection, type Selection } from '@/lib/theme'

type Reactions = Record<string, string[]> | null
type Message = {
  id: string
  sender_id: string
  original_message: string
  translated_message: string | null
  created_at: string
  reactions?: Reactions
  edited_at?: string | null
  deleted_at?: string | null
  reply_to_message_id?: string | null
}
type OtherProfile = {
  id: string
  display_name: string | null
  gender?: string | null
  gender_visible?: boolean
  age_band: string | null
  age_band_visible: boolean
  last_active_at: string | null
}

const AGE_BAND_LABELS: Record<string, string> = {
  under_13: 'Under 13', '13_15': '13–15', '16_17': '16–17', '18_20': '18–20',
  '21_29': '21–29', '30_44': '30–44', '45_59': '45–59', '60_plus': '60+',
}
const REPORT_REASONS = ['harassment','spam','hate_speech','sexual_content','scam','impersonation','underage_concern','threatening_behavior','other']
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '😘', '💦', '🤡', '🌚', '🌝']
const ONLINE_WINDOW_MS = 5 * 60 * 1000
const EDIT_WINDOW_MS = 15 * 60 * 1000
const MESSAGE_COLUMNS = 'id,sender_id,original_message,translated_message,created_at,reactions,edited_at,deleted_at,reply_to_message_id'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function dayLabel(iso: string): string {
  const d = new Date(iso); const today = new Date(); const yesterday = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
function lastSeen(iso: string | null): string {
  if (!iso) return 'offline'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'last seen just now'
  if (mins < 60) return `last seen ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `last seen ${hours}h ago`
  return `last seen ${Math.floor(hours / 24)}d ago`
}
function Avatar({ name, online, large }: { name: string | null; online: boolean; large?: boolean }) {
  const initial = (name?.replace(/[^\p{L}\p{N}]/gu, '').charAt(0) || '?').toUpperCase()
  return (
    <span className="relative inline-flex flex-none">
      <span className={`flex items-center justify-center rounded-full bg-gradient-to-br from-indigo-500/40 to-violet-500/30 font-bold text-white ring-1 ring-white/10 ${large ? 'h-11 w-11 text-lg' : 'h-9 w-9 text-sm'}`}>{initial}</span>
      <span className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-slate-900 ${online ? 'bg-emerald-400' : 'bg-slate-600'} ${large ? 'h-3 w-3' : 'h-2.5 w-2.5'}`} />
    </span>
  )
}

export default function ChatPage() {
  const params = useParams<{ conversationId: string }>()
  const router = useRouter()
  const conversationId = params.conversationId

  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [otherId, setOtherId] = useState<string | null>(null)
  const [other, setOther] = useState<OtherProfile | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [botTyping, setBotTyping] = useState(false)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const [blockedByMe, setBlockedByMe] = useState(false)
  const [blockedMe, setBlockedMe] = useState(false)
  const blockedAny = blockedByMe || blockedMe
  const [friendState, setFriendState] = useState<'none'|'outgoing'|'incoming'|'friends'>('none')
  const frRows = useRef<Map<string, { sender: string; receiver: string; status: string }>>(new Map())
  function trackFrRow(id: string, sender: string, receiver: string, status: string) {
    frRows.current.set(String(id), { sender, receiver, status })
  }
  const friendStateRef = useRef<typeof friendState>('none')
  function updateFriendState(next: typeof friendState) {
    friendStateRef.current = next
    setFriendState(next)
  }
  const [autoTranslate, setAutoTranslate] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reason, setReason] = useState('harassment')
  const [details, setDetails] = useState('')
  const [statusLine, setStatusLine] = useState('')
  const [unfriendArm, setUnfriendArm] = useState(false)
  const [blockChoiceOpen, setBlockChoiceOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [incomingReq, setIncomingReq] = useState<Identity | null>(null)
  const incomingTimer = useRef<number | undefined>(undefined)
  const lastLocalFriendChange = useRef<number>(0)
  const [otherOnline, setOtherOnline] = useState(false)
  const [presenceLabel, setPresenceLabel] = useState('')
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [reactorInfo, setReactorInfo] = useState<{ emoji: string; names: string[] } | null>(null)
  const [sel, setSel] = useState<Selection>({ base: 'dark', accent: 'none' })
  const [unreadCount, setUnreadCount] = useState(0)
  const prevMsgCount = useRef(0)

  const [actionsMsg, setActionsMsg] = useState<{ msg: Message; canEdit: boolean } | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastTypingSent = useRef(0)
  const typingStopTimer = useRef<number | undefined>(undefined)
  const partnerTypingExpiry = useRef<number | undefined>(undefined)
  const pressTimer = useRef<number | undefined>(undefined)
  const chipPressTimer = useRef<number | undefined>(undefined)
  const didInitialScroll = useRef(false)
  const userIdRef2 = useRef<string | null>(null)
  const gesture = useRef<{ id: string | null; startX: number; dx: number; moved: boolean; pressed: boolean; pointerType: string; mode: 'press' | 'rdrag' }>({ id: null, startX: 0, dx: 0, moved: false, pressed: false, pointerType: 'mouse', mode: 'press' })

  const persona = getBotPersona(otherId)
  const otherName = persona ? persona.name : other?.display_name || 'ShahZap user'

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | undefined
    let poll: number | undefined
    let active = true
    const otherRef: { current: OtherProfile | null } = { current: null }
    const otherIdRef: { current: string | null } = { current: null }

    function refreshPresence() {
      const p = getBotPersona(otherIdRef.current)
      if (p) { setOtherOnline(true); setPresenceLabel('always here'); return }
      const op = otherRef.current
      if (!op) return
      const online = !!op.last_active_at && Date.now() - new Date(op.last_active_at).getTime() < ONLINE_WINDOW_MS
      setOtherOnline(online)
      setPresenceLabel(online ? 'online' : lastSeen(op.last_active_at))
    }

    async function load() {
      didInitialScroll.current = false
      setAutoTranslate(localStorage.getItem('shahzap:autoTranslate') === '1')
      setSel(getSelection())
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      setUserId(user.id)
      userIdRef2.current = user.id

      const { data: participants } = await supabase.from('conversation_participants').select('profile_id').eq('conversation_id', conversationId)
      const otherProfileId = participants?.find((p) => p.profile_id !== user.id)?.profile_id ?? null
      otherIdRef.current = otherProfileId
      setOtherId(otherProfileId)

      if (otherProfileId && !isBotProfile(otherProfileId)) {
        const { data: op } = await supabase.from('profiles').select('id,display_name,gender,gender_visible,age_band,age_band_visible,last_active_at').eq('id', otherProfileId).maybeSingle()
        if (active && op) { setOther(op as OtherProfile); otherRef.current = op as OtherProfile; refreshPresence() }
        const [{ data: blockRow }, { data: blockRowIn }, { data: fr }] = await Promise.all([
          supabase.from('blocks').select('blocker_id').eq('blocker_id', user.id).eq('blocked_id', otherProfileId).maybeSingle(),
          supabase.from('blocks').select('blocker_id').eq('blocker_id', otherProfileId).eq('blocked_id', user.id).maybeSingle(),
          supabase.from('friend_requests').select('id,sender_id,receiver_id,status').or(`and(sender_id.eq.${user.id},receiver_id.eq.${otherProfileId}),and(sender_id.eq.${otherProfileId},receiver_id.eq.${user.id})`).in('status', ['pending','accepted']),
        ])
        for (const row of fr ?? []) {
          frRows.current.set(String(row.id), { sender: row.sender_id, receiver: row.receiver_id, status: row.status })
        }
        let derived: 'none'|'outgoing'|'incoming'|'friends' = 'none'
        for (const row of fr ?? []) {
          if (row.status === 'accepted') derived = 'friends'
          else if (row.status === 'pending' && derived !== 'friends') derived = row.receiver_id === user.id ? 'incoming' : 'outgoing'
        }
        if (active) {
          setBlockedByMe(!!blockRow)
          setBlockedMe(!!blockRowIn)
          updateFriendState(derived)
        }
      }

      const { data, error: readError } = await supabase.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId).order('created_at', { ascending: true })
      if (readError) setError(friendlyError(readError, 'Could not load the messages. Please refresh.'))
      if (active) { setMessages((data ?? []) as Message[]); setLoading(false) }

      channel = supabase.channel(`conversation:${conversationId}`, { config: { broadcast: { self: false } } })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
          const message = payload.new as Message
          setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]))
          if (isBotProfile(message.sender_id)) setBotTyping(false)
          if (message.sender_id !== user.id) playMessageSound()
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
          const updated = payload.new as Message
          setMessages((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)))
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          const p = payload as { typing: boolean; from: string }
          if (p.from === user.id) return
          if (p.typing) {
            setPartnerTyping(true)
            window.clearTimeout(partnerTypingExpiry.current)
            partnerTypingExpiry.current = window.setTimeout(() => setPartnerTyping(false), 3000)
          } else {
            setPartnerTyping(false)
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${user.id}` }, async (payload) => {
          const row = payload.new as { id: string; sender_id: string }
          trackFrRow(row.id, row.sender_id, user.id, 'pending')
          if (row.sender_id !== otherProfileId || isBotProfile(row.sender_id)) return
          updateFriendState('incoming')
          playFriendRequestSound()
          const op = otherRef.current
          setIncomingReq(resolveIdentity(op ? { display_name: op.display_name, gender: op.gender, gender_visible: op.gender_visible } : null))
          window.clearTimeout(incomingTimer.current)
          incomingTimer.current = window.setTimeout(() => setIncomingReq(null), 10_000)
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friend_requests', filter: `sender_id=eq.${user.id}` }, async (payload) => {
          const row = payload.new as { id: string; receiver_id: string; status: string }
          const entry = frRows.current.get(String(row.id))
          if (entry) entry.status = row.status
          if (row.status === 'declined' && row.receiver_id === otherIdRef.current && friendStateRef.current === 'outgoing') {
            playUnfriendSound()
            const supabase2 = createClient()
            const { data: op } = await supabase2.from('profiles').select('display_name,gender,gender_visible').eq('id', row.receiver_id).maybeSingle()
            const who = resolveIdentity(op as never)
            updateFriendState('none')
            setStatusLine(`${who.label} rejected your friend request.`)
          }
          if (row.receiver_id !== otherIdRef.current) return
          if (row.status === 'accepted') {
            playFriendRequestSound()
            updateFriendState('friends')
            setStatusLine('You are now friends! 🎉')
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${user.id}` }, (payload) => {
          const row = payload.new as { id: string; sender_id: string; status: string }
          const entry = frRows.current.get(String(row.id))
          if (entry) entry.status = row.status
          if (row.sender_id !== otherIdRef.current) return
          if (row.status === 'accepted') { updateFriendState('friends'); setIncomingReq(null) }
          if (row.status === 'declined') { updateFriendState('none'); setIncomingReq(null); setStatusLine('Friend request declined.') }
        })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks' }, (payload) => {
          // Live freeze / unfreeze while the chat is open.
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as { blocker_id?: string; blocked_id?: string } | null
          if (!row?.blocker_id || !row.blocked_id) return
          const me = userIdRef2.current
          const other = otherIdRef.current
          if (!me || !other) return
          const involvesUs = (row.blocker_id === me && row.blocked_id === other) || (row.blocker_id === other && row.blocked_id === me)
          if (!involvesUs) return
          if (payload.eventType === 'DELETE') {
            if (row.blocker_id === me) setBlockedByMe(false)
            else setBlockedMe(false)
          } else {
            if (row.blocker_id === me) setBlockedByMe(true)
            else setBlockedMe(true)
          }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friend_requests' }, async (payload) => {
          // Realtime strips deleted rows to their primary key — resolve via ledger.
          const old = payload.old as { id?: string | number }
          const key = old?.id != null ? String(old.id) : null
          const me = userIdRef2.current
          const other = otherIdRef.current
          if (!key || !me || !other) return
          const entry = frRows.current.get(key)
          if (!entry) return
          frRows.current.delete(key)
          const involvesUs = (entry.sender === me && entry.receiver === other) || (entry.sender === other && entry.receiver === me)
          if (!involvesUs) return
          const prev = friendStateRef.current
          // Any deletion involving this pair invalidates the accept banner.
          setIncomingReq(null)
          if (entry.status === 'accepted') {
            if (Date.now() - lastLocalFriendChange.current < 4000) { updateFriendState('none'); return }
            playUnfriendSound()
            const supabase2 = createClient()
            const { data: op } = await supabase2.from('profiles').select('display_name,gender,gender_visible').eq('id', other).maybeSingle()
            const who = resolveIdentity(op as never)
            updateFriendState('none')
            setUnfriendArm(false)
            setStatusLine(`${who.label} unfriended you.`)
          } else if (prev === 'incoming' || (entry.status === 'pending' && entry.receiver === me)) {
            updateFriendState('none')
            setStatusLine('Friend request was withdrawn.')
          } else if (prev === 'outgoing' || (entry.status === 'pending' && entry.sender === me)) {
            updateFriendState('none')
          }
        })
.subscribe().subscribe()
      channelRef.current = channel

      // Safety net if Realtime drops.
      poll = window.setInterval(async () => {
        const { data: fresh } = await supabase.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId).order('created_at', { ascending: true })
        if (!fresh || !active) return
        setMessages((prev) => (prev.length !== fresh.length || fresh[fresh.length - 1]?.id !== prev[prev.length - 1]?.id ? (fresh as Message[]) : prev))
        const latest = fresh[fresh.length - 1]
        if (latest && latest.sender_id !== user.id) setBotTyping(false)
        refreshPresence()
      }, 3000)
    }

    void load()
    return () => {
      active = false
      channelRef.current = null
      if (channel) void supabase.removeChannel(channel)
      if (poll) window.clearInterval(poll)
      window.clearTimeout(typingStopTimer.current)
      window.clearTimeout(partnerTypingExpiry.current)
      window.clearTimeout(pressTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, router])

  // Close the ⋮ menu the moment anything else on the page is pressed.
  useEffect(() => {
    if (!menuOpen) return
    function onDocPointer(e: PointerEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (menuRef.current?.contains(t)) return // clicks inside the panel keep it open
      if (t.closest('button[aria-label="More options"]')) return // let the ⋮ button toggle itself
      setMenuOpen(false)
      setReportOpen(false)
      setUnfriendArm(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setMenuOpen(false); setReportOpen(false); setUnfriendArm(false) } }
    document.addEventListener('pointerdown', onDocPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!botTyping) return
    const timer = window.setTimeout(() => setBotTyping(false), 8000)
    return () => window.clearTimeout(timer)
  }, [botTyping])

  // Scroll of the message list: cancels pending gestures, drives the
  // jump-to-latest button visibility, and clears unread when reaching bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onScroll() {
      if (!el) return
      window.clearTimeout(pressTimer.current)
      window.clearTimeout(chipPressTimer.current)
      gesture.current = { id: null, startX: 0, dx: 0, moved: false, pressed: false, pointerType: 'mouse', mode: 'press' }
      setDrag((cur) => (cur ? null : cur))
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollDown(distance > 240)
      if (distance < 40) setUnreadCount(0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [loading])

  function scrollToLatest() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setUnreadCount(0)
  }

  // Count incoming messages that arrive while the reader is scrolled away.
  useEffect(() => {
    const el = scrollRef.current
    const prev = prevMsgCount.current
    prevMsgCount.current = messages.length
    if (!el || messages.length <= prev) return
    const latest = messages[messages.length - 1]
    if (!latest || latest.sender_id === userId) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance >= 160) setUnreadCount((c) => Math.min(c + 1, 99))
  }, [messages, userId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || loading) return

    // First paint after a conversation opens/refreshes: jump straight to the
    // latest message, like WhatsApp. No smooth glide, no near-bottom guard.
    if (!didInitialScroll.current) {
      if (messages.length === 0) return
      didInitialScroll.current = true
      requestAnimationFrame(() => requestAnimationFrame(() => { el.scrollTop = el.scrollHeight }))
      return
    }

    // Afterwards: follow new messages only while the reader is at the bottom,
    // so scrolling up through history is never hijacked.
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distance < 160) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, partnerTyping, botTyping, loading])

  function broadcastTyping(typing: boolean) {
    const ch = channelRef.current
    if (!ch) return
    void ch.send({ type: 'broadcast', event: 'typing', payload: { typing, from: userId } })
  }

  function onTextChange(value: string) {
    setText(value)
    if (!persona && userId) {
      const now = Date.now()
      if (value && now - lastTypingSent.current > 1400) {
        lastTypingSent.current = now
        broadcastTyping(true)
      }
      window.clearTimeout(typingStopTimer.current)
      typingStopTimer.current = window.setTimeout(() => broadcastTyping(false), value ? 2200 : 0)
      if (!value) broadcastTyping(false)
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    if (editing) { void saveEdit(); return }
    const value = text.trim()
    if (!value || !userId || blockedAny) return
    setText('')
    if (!persona) broadcastTyping(false)
    const supabase = createClient()
    const { data: inserted, error: sendError } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: userId, original_message: value, reply_to_message_id: replyTo?.id ?? null })
      .select(MESSAGE_COLUMNS)
      .single()
    if (sendError || !inserted) {
      setError(friendlyError(sendError, 'Your message could not be sent. Please try again.'))
      setText(value)
      return
    }
    setMessages((current) => (current.some((item) => item.id === inserted.id) ? current : [...current, inserted as Message]))
    setReplyTo(null)
    inputRef.current?.focus()
    setUnreadCount(0)
    requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }) })
    if (persona) setBotTyping(true)
  }

  async function saveEdit() {
    if (!editing || !userId) return
    const value = text.trim()
    if (!value) { setStatusLine('Edited message cannot be empty.'); return }
    const supabase = createClient()
    const { data, error: e } = await supabase
      .from('messages')
      .update({ original_message: value, edited_at: new Date().toISOString() })
      .eq('id', editing.id)
      .select(MESSAGE_COLUMNS)
      .single()
    if (e || !data) { setStatusLine(friendlyError(e, 'Could not save your edit.')); return }
    setMessages((prev) => prev.map((m) => (m.id === data.id ? (data as Message) : m)))
    setEditing(null); setText('')
    inputRef.current?.focus()
  }

  async function deleteMessage(m: Message) {
    setActionsMsg(null)
    const optimistic = { ...m, deleted_at: new Date().toISOString() }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? optimistic : x)))
    const supabase = createClient()
    const { error: e } = await supabase.from('messages').update({ deleted_at: optimistic.deleted_at }).eq('id', m.id)
    if (e) { setStatusLine(friendlyError(e, 'Could not delete the message.')); setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x))) }
  }

  async function toggleReaction(m: Message, emoji: string) {
    if (!userId || m.deleted_at || blockedAny) return
    setActionsMsg(null)
    const before = m.reactions
    // Optimistic toggle with WhatsApp's one-reaction-per-person rule:
    // reacting with a new emoji replaces your previous one.
    const cur: Record<string, string[]> = { ...(m.reactions ?? {}) }
    const alreadyMine = cur[emoji]?.includes(userId) ?? false
    const nextAll: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(cur)) {
      const kept = v.filter((u) => u !== userId)
      if (kept.length) nextAll[k] = kept
    }
    if (!alreadyMine) {
      nextAll[emoji] = [...(nextAll[emoji] ?? []), userId]
    }
    const optimistic = nextAll
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: optimistic } : x)))
    const supabase = createClient()
    const { data, error: e } = await supabase.rpc('toggle_message_reaction', { p_message_id: m.id, p_emoji: emoji })
    if (e || typeof data !== 'object' || data === null) {
      setStatusLine(friendlyError(e, 'Could not save the reaction.'))
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: before } : x)))
      return
    }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: data as Record<string, string[]> } : x)))
  }

  async function friendAction(action: 'send' | 'cancel' | 'unfriend') {
    if (!userId || !otherId) return
    setStatusLine('')
    const supabase = createClient()
    if (action === 'send') {
      // Also handles auto-accept when the other person already asked me.
      const { data, error: e } = await supabase.rpc('send_friend_request', { p_receiver: otherId })
      if (e) { setStatusLine(friendlyError(e, 'Could not send the friend request.')); return }
      const st = (data as { status?: string })?.status
      if (st === 'friends' || st === 'auto_accepted') { updateFriendState('friends'); setStatusLine('You are now friends! 🎉') }
      else { updateFriendState('outgoing'); setStatusLine('Friend request sent.') }
      return
    }
    if (action === 'cancel') {
      lastLocalFriendChange.current = Date.now()
      await supabase.rpc('cancel_friend_request', { p_receiver: otherId })
      updateFriendState('none'); setStatusLine('Friend request cancelled.')
      return
    }
    lastLocalFriendChange.current = Date.now()
    await supabase.rpc('unfriend', { p_other: otherId })
    updateFriendState('none'); setUnfriendArm(false); setStatusLine('Unfriended.')
  }

  function onBlockRowClick() {
    if (!userId || !otherId) return
    if (blockedByMe) { void toggleBlock(); return } // simple unblock
    if (friendStateRef.current === 'friends') { setBlockChoiceOpen(true); return }
    void toggleBlock()
  }

  async function doBlock(alsoUnfriend: boolean) {
    setBlockChoiceOpen(false)
    setStatusLine('')
    const supabase = createClient()
    const { error: e } = await supabase.from('blocks').upsert({ blocker_id: userId!, blocked_id: otherId! })
    if (e) { setStatusLine(friendlyError(e, 'Could not block.')); return }
    setBlockedByMe(true)
    setStatusLine('Blocked.')
    if (alsoUnfriend && friendStateRef.current === 'friends') {
      lastLocalFriendChange.current = Date.now()
      await supabase.rpc('unfriend', { p_other: otherId })
      updateFriendState('none')
      setUnfriendArm(false)
      setStatusLine('Blocked and unfriended.')
    }
  }

  async function toggleBlock() {
    if (!userId || !otherId) return
    setStatusLine('')
    const supabase = createClient()
    if (blockedByMe) {
      const { error: e } = await supabase.from('blocks').delete().eq('blocker_id', userId).eq('blocked_id', otherId)
      if (e) setStatusLine(friendlyError(e, 'Could not unblock.'))
      else { setBlockedByMe(false); setStatusLine('Unblocked.') }
    } else {
      const { error: e } = await supabase.from('blocks').upsert({ blocker_id: userId, blocked_id: otherId }, { onConflict: 'blocker_id,blocked_id' })
      if (e) setStatusLine(friendlyError(e, 'Could not block.'))
      else { setBlockedByMe(true); setStatusLine('Blocked. They can no longer match with you.') }
    }
  }

  async function submitReport() {
    if (!userId || !otherId) return
    setStatusLine('')
    const supabase = createClient()
    const { error: e } = await supabase.from('reports').insert({
      reporter_id: userId, reported_profile_id: otherId, conversation_id: conversationId,
      reason, details: details.trim().slice(0, 1000) || null,
    })
    if (e) { setStatusLine(friendlyError(e, 'Could not submit the report.')); return }
    setDetails(''); setReportOpen(false); setMenuOpen(false)
    setStatusLine('Report submitted. Thank you for helping keep ShahZap safe.')
  }

  function toggleAutoTranslate() {
    setAutoTranslate((v) => { localStorage.setItem('shahzap:autoTranslate', v ? '0' : '1'); return !v })
  }

  // ── Gesture handlers: long-press → action sheet, horizontal drag → reply ──
  function endPress() { window.clearTimeout(pressTimer.current) }
  function startPress(m: Message, e: React.PointerEvent) {
    if (m.deleted_at || blockedAny) return
    // DESKTOP: two-finger / right-button click starts a drag session instead of
    // the touch-style hold. Plain right-click (no drag) opens the sheet.
    if (e.pointerType === 'mouse' && e.button === 2) {
      gesture.current = { id: m.id, startX: e.clientX, dx: 0, moved: false, pressed: true, pointerType: e.pointerType, mode: 'rdrag' }
      endPress()
      return
    }
    gesture.current = { id: m.id, startX: e.clientX, dx: 0, moved: false, pressed: false, pointerType: e.pointerType, mode: 'press' }
    endPress()
    pressTimer.current = window.setTimeout(() => {
      gesture.current.pressed = true
      if (navigator.vibrate) navigator.vibrate(25)
      setDrag(null)
      setActionsMsg({ msg: m, canEdit: m.sender_id === userId && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS })
    }, 450)
  }
  function movePress(m: Message, e: React.PointerEvent) {
    const g = gesture.current
    if (g.id !== m.id || (g.pressed && g.mode === 'press')) return
    if (g.mode === 'rdrag') {
      const dx = e.clientX - g.startX
      g.dx = dx
      if (Math.abs(dx) > 6) g.moved = true
      if (Math.abs(dx) > 10) setDrag({ id: m.id, dx: Math.max(-40, Math.min(40, dx)) })
      else if (drag) setDrag(null)
      return
    }
    const dx = e.clientX - g.startX
    g.dx = dx
    if (Math.abs(dx) > 6 && !g.moved) { g.moved = true; endPress() }
    // Swipe-to-reply is a TOUCH gesture only — a wandering mouse must never fling bubbles around.
    if (g.pointerType !== 'touch' && g.pointerType !== 'pen') return
    if (Math.abs(dx) > 10) setDrag({ id: m.id, dx: Math.max(-40, Math.min(40, dx)) })
    else if (drag) setDrag(null)
  }
  function finishPress(m: Message, now: number) {
    const g = gesture.current
    endPress()
    setDrag(null)
    if (g.id !== m.id) return
    if (g.mode === 'rdrag') {
      if (g.moved && Math.abs(g.dx) >= 26) {
        // Dragged far enough → quote-reply, same as touch swipe.
        setReplyTo(m)
        setEditing(null)
      } else if (!g.moved) {
        // Plain two-finger / right click → message options sheet.
        setActionsMsg({ msg: m, canEdit: m.sender_id === userId && now - new Date(m.created_at).getTime() < EDIT_WINDOW_MS })
      }
    } else if (!g.pressed && g.moved && Math.abs(g.dx) >= 26) {
      setReplyTo(m)
      setEditing(null)
    }
    gesture.current = { id: null, startX: 0, dx: 0, moved: false, pressed: false, pointerType: 'mouse', mode: 'press' }
  }

  async function showReactors(m: Message, emoji: string) {
    const supabase = createClient()
    const { data } = await supabase.rpc('message_reactors', { p_message_id: m.id })
    const rows = (Array.isArray(data) ? data : []) as { emoji: string; name: string; is_you: boolean }[]
    const names = rows.filter((r) => r.emoji === emoji).map((r) => (r.is_you ? 'You' : r.name))
    setReactorInfo({ emoji, names })
  }

  function clearIncomingSoon(ms = 1200) {
    window.clearTimeout(incomingTimer.current)
    incomingTimer.current = window.setTimeout(() => setIncomingReq(null), ms)
  }

  async function acceptIncoming() {
    if (!userId || !otherId) return
    const supabase = createClient()
    // Our send RPC auto-accepts their pending request to us.
    const { error: e } = await supabase.rpc('send_friend_request', { p_receiver: otherId })
    if (e) { setStatusLine(friendlyError(e, 'Could not accept.')); return }
    updateFriendState('friends')
    setStatusLine('You are now friends! 🎉')
    clearIncomingSoon()
  }

  async function rejectIncoming() {
    if (!userId || !otherId) return
    const supabase = createClient()
    await supabase.from('friend_requests')
      .update({ status: 'declined' })
      .match({ sender_id: otherId, receiver_id: userId, status: 'pending' })
    updateFriendState('none')
    setStatusLine('Friend request declined.')
    setIncomingReq(null)
  }

  function beginEdit(m: Message) {
    setActionsMsg(null)
    setReplyTo(null)
    setEditing(m)
    setText(m.original_message)
  }

  const subtitle = useMemo(() => {
    if (persona) return partnerTyping || botTyping ? 'typing…' : persona.role
    if (partnerTyping) return 'typing…'
    if (!other) return ''
    const parts: string[] = []
    if (other.age_band_visible && other.age_band) parts.push(AGE_BAND_LABELS[other.age_band] ?? other.age_band)
    parts.push(presenceLabel || 'offline')
    return parts.join(' · ')
  }, [persona, partnerTyping, botTyping, other, presenceLabel])

  const composerQuote = editing ?? replyTo
  const composerMode: 'edit' | 'reply' | null = editing ? 'edit' : replyTo ? 'reply' : null

  function labelFor(msg: Message): string {
    if (msg.sender_id === userId) return 'You'
    return getBotPersona(msg.sender_id)?.name ?? otherName
  }

  return (
    <main className="relative flex h-dvh max-h-dvh w-full flex-col overflow-hidden bg-slate-950 text-white">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="relative z-20 flex-none border-b border-slate-800 bg-slate-900 px-2 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-1.5">
          <button aria-label="More options" onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-800 hover:text-white">
            <MoreVertical size={20} />
          </button>

          <Link href={otherId && !persona ? `/profile/${otherId}` : '#'} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 transition hover:bg-slate-800/60">
            <span aria-hidden><Avatar name={otherName} online={otherOnline} large /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{otherName}</span>
              <span className={`block truncate text-xs ${subtitle === 'typing…' ? 'animate-pulse text-cyan-300' : 'text-slate-400'}`}>{subtitle}</span>
            </span>
          </Link>

          <button onClick={() => router.push('/match')} className="mr-1 flex-none rounded-full bg-cyan-400/10 px-4 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-400/20">Next</button>
        </div>

        {menuOpen && (
          <>
            <div ref={menuRef} className="absolute left-2 top-full z-20 mt-1 w-72 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60">
              <div className="px-3 pb-3 pt-2.5">
                <p className="mb-2 flex items-center gap-3 text-sm"><SunMoon size={17} className="text-cyan-300" /> Theme</p>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Base</p>
                <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-950 p-1">
                  {(['dark','white'] as const).map((b) => (
                    <button key={b} onClick={() => { const n = { ...sel, base: b }; setSel(n); applySelection(n) }}
                      className={`rounded-lg px-2 py-1.5 text-xs font-semibold capitalize transition ${sel.base === b ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
                      {b === 'dark' ? '🌙 Dark' : '☀️ White'}
                    </button>
                  ))}
                </div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Accent</p>
                <div className="flex flex-wrap items-center gap-2">
                  {ACCENTS.map((a) => (
                    <button key={a.id} title={a.label} aria-label={a.label}
                      onClick={() => { const n = { ...sel, accent: a.id }; setSel(n); applySelection(n) }}
                      className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${sel.accent === a.id ? 'border-cyan-400 ring-2 ring-cyan-400/40' : 'border-slate-600'}`}
                      style={{ background: a.preview }} />
                  ))}
                </div>
              </div>
              <button onClick={toggleAutoTranslate} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-sm transition hover:bg-slate-800">
                <span className="flex items-center gap-3"><Languages size={17} className="text-cyan-300" /> Auto-translate</span>
                <span className={`relative h-5 w-9 flex-none rounded-full transition ${autoTranslate ? 'bg-cyan-400' : 'bg-slate-700'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${autoTranslate ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
              </button>
              <p className="px-4 pb-2 text-[10px] leading-relaxed text-slate-500">{autoTranslate ? 'Showing translated text when available.' : 'Showing original messages.'}</p>

              {!persona && (
                <>
                  <div className="border-t border-slate-800" />
                  {!blockedAny && friendState === 'none' && (
                    <button onClick={() => void friendAction('send')} className="flex w-full items-center gap-3 px-4 py-3 text-sm transition hover:bg-slate-800">
                      <UserPlus size={17} className="text-cyan-300" /> Add friend
                    </button>
                  )}
                  {!blockedAny && friendState === 'outgoing' && (
                    <button onClick={() => void friendAction('cancel')} className="flex w-full items-center gap-3 px-4 py-3 text-sm transition hover:bg-slate-800">
                      <Clock size={17} className="text-amber-300" /> Cancel friend request
                    </button>
                  )}
                  {!blockedAny && friendState === 'incoming' && (
                    <>
                      <button onClick={() => void friendAction('send')} className="flex w-full items-center gap-3 px-4 py-3 text-sm transition hover:bg-slate-800">
                        <UserCheck size={17} className="text-emerald-300" /> Accept friend request
                      </button>
                      <button onClick={() => void rejectIncoming()} className="flex w-full items-center gap-3 px-4 py-3 text-sm transition hover:bg-slate-800">
                        <X size={17} className="text-red-300" /> Reject request
                      </button>
                    </>
                  )}
                  {!blockedAny && friendState === 'friends' && !unfriendArm && (
                    <button onClick={() => setUnfriendArm(true)} className="flex w-full items-center gap-3 px-4 py-3 text-sm transition hover:bg-slate-800">
                      <UserMinus size={17} className="text-red-300" /> Unfriend
                    </button>
                  )}
                  {!blockedAny && friendState === 'friends' && unfriendArm && (
                    <div className="flex items-center justify-between gap-2 bg-red-950/40 px-4 py-2.5 text-xs">
                      <span className="text-red-200">Really unfriend?</span>
                      <span className="flex gap-2">
                        <button onClick={() => setUnfriendArm(false)} className="rounded-lg border border-slate-600 px-2.5 py-1 font-semibold text-slate-300 hover:bg-slate-800">No</button>
                        <button onClick={() => void friendAction('unfriend')} className="rounded-lg bg-red-500 px-2.5 py-1 font-bold text-white hover:bg-red-400">Yes</button>
                      </span>
                    </div>
                  )}
                </>
              )}

              {!persona && (
                <>
                  <div className="border-t border-slate-800" />
                  <button onClick={onBlockRowClick} className="flex w-full items-center gap-3 px-4 py-3 text-sm transition hover:bg-slate-800">
                    <Ban size={17} className={blockedByMe ? 'text-emerald-300' : 'text-red-300'} />
                    {blockedByMe ? 'Unblock user' : 'Block user'}
                  </button>
                  <button onClick={() => setReportOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-3 text-sm transition hover:bg-slate-800">
                    <ShieldAlert size={17} className="text-red-300" /> Report user
                  </button>
                  {reportOpen && (
                    <div className="space-y-2 border-t border-slate-800 bg-slate-950/60 p-3">
                      <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs">
                        {REPORT_REASONS.map((r) => <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>)}
                      </select>
                      <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} placeholder="Optional details" className="h-16 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs" />
                      <button onClick={() => void submitReport()} className="w-full rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-400">Submit report</button>
                    </div>
                  )}
                </>
              )}

              <div className="border-t border-slate-800" />
              <button onClick={() => { setMenuOpen(false); router.push('/match') }} className="flex w-full items-center gap-3 px-4 py-3 text-sm transition hover:bg-slate-800">
                <UserCircle2 size={17} className="text-cyan-300" /> Next match
              </button>
            </div>
          </>
        )}
      </header>

      {incomingReq && (
        <div className="relative z-10 w-full px-4 pt-3">
          <div className="flex items-center gap-3 rounded-2xl border border-cyan-500/40 bg-cyan-950/40 p-3.5 shadow-lg">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-cyan-400/15 text-cyan-300"><UserPlus size={18} /></span>
            <span className="min-w-0 flex-1 text-sm">
              <span className={`font-bold ${incomingReq.colorClass}`}>{incomingReq.label}</span>{' '}
              <span className="text-slate-300">wants to add you as a friend</span>
            </span>
            <span className="flex flex-none items-center gap-2">
              <button onClick={() => void acceptIncoming()} className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-400">Accept</button>
              <button onClick={() => void rejectIncoming()} className="rounded-xl border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800">Reject</button>
            </span>
          </div>
        </div>
      )}

      {/* Desktop-only side skyscraper ads — never rendered on mobile/tablet */}
      <div className="fixed left-6 top-1/2 z-0 hidden -translate-y-1/2 xl:block">
        <AdsterraBanner size="160x600" />
      </div>
      <div className="fixed right-6 top-1/2 z-0 hidden -translate-y-1/2 xl:block">
        <AdsterraBanner size="160x600" />
      </div>

      {(statusLine || blockedByMe) && (
        <p className={`w-full px-4 pt-2 text-xs ${blockedByMe ? 'text-red-300' : 'text-emerald-300'}`}>
          {blockedByMe ? 'You blocked this user. Use the ⋮ menu to unblock.' : statusLine}
        </p>
      )}

      {/* ── Messages ───────────────────────────────────────── */}
      <div ref={scrollRef} className="relative mx-auto min-h-0 mx-auto max-w-3xl flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4"
        style={{ backgroundImage: 'radial-gradient(rgba(148,163,184,0.05) 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
        {loading && <p className="pt-10 text-center text-sm text-slate-500">Loading conversation…</p>}
        {!loading && messages.length === 0 && (
          <div className="pt-10 text-center">
            <p className="text-sm text-slate-500">Say hello 👋</p>
            {persona && <p className="mt-1 text-xs text-slate-600">{persona.name} replies instantly.</p>}
          </div>
        )}
        {messages.map((m, i) => {
          const mine = m.sender_id === userId
          const prev = messages[i - 1]
          const showDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)
          const deleted = !!m.deleted_at
          const body = autoTranslate && m.translated_message ? m.translated_message : m.original_message
          const translatedShown = autoTranslate && !!m.translated_message
          const replied = m.reply_to_message_id ? messages.find((x) => x.id === m.reply_to_message_id) : null
          const rawDx = drag?.id === m.id ? drag.dx : 0
          const dragDx = Math.max(-36, Math.min(36, rawDx))
          const dragging = rawDx !== 0
          const reactions = Object.entries(m.reactions ?? {}).filter(([, users]) => users.length > 0)
          return (
            <div key={m.id} className="w-full">
              {showDay && (
                <div className="py-2 text-center">
                  <span className="rounded-full bg-slate-800/80 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{dayLabel(m.created_at)}</span>
                </div>
              )}
              <div className={`flex w-full px-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex w-fit max-w-[86%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div
                    role="button" tabIndex={0} aria-label="Message options"
                    onPointerDown={(e) => startPress(m, e)}
                    onPointerMove={(e) => movePress(m, e)}
                    onPointerUp={() => finishPress(m, Date.now())}
                    onPointerCancel={() => finishPress(m, Date.now())}
                    onKeyDown={(e) => { if (e.key === 'Enter') setActionsMsg({ msg: m, canEdit: m.sender_id === userId }) }}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ transform: `translateX(${dragDx}px)`, touchAction: 'pan-y' }}
                    className={`relative w-fit max-w-full select-none rounded-2xl px-3.5 py-2 shadow-sm ${mine ? 'rounded-br-md bg-gradient-to-br from-cyan-500 to-cyan-400 text-slate-950' : 'rounded-bl-md bg-slate-800 text-slate-100'} ${deleted ? 'italic opacity-70' : ''} ${dragging ? '' : 'transition-transform duration-150 ease-out'}`}
                  >
                    {replied && (
                      <div className={`mb-1.5 rounded-lg border-l-[3px] px-2 py-1 ${mine ? 'border-slate-900/40 bg-black/10' : 'border-cyan-400/70 bg-black/20'}`}>
                        <p className={`text-[11px] font-semibold ${mine ? 'text-slate-900/80' : 'text-cyan-300'}`}>{labelFor(replied)}</p>
                        <p className={`line-clamp-2 text-xs ${mine ? 'text-slate-900/70' : 'text-slate-400'}`}>{replied.deleted_at ? 'This message was deleted' : replied.original_message}</p>
                      </div>
                    )}
                    {deleted ? (
                      <p className="flex items-center gap-1.5 text-[14px] text-slate-400">
                        <Ban size={14} /> This message was deleted
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">{body}</p>
                    )}
                    <p className={`mt-0.5 flex items-center justify-end gap-1 text-right text-[10px] ${mine ? 'text-slate-900/60' : 'text-slate-500'}`}>
                      {!deleted && translatedShown && <span className="italic">translated ·</span>}
                      {!deleted && m.edited_at && <span className="italic">edited ·</span>}
                      <span>{formatTime(m.created_at)}</span>
                    </p>
                  </div>

                  {reactions.length > 0 && (
                    <div className={`mt-1 flex flex-wrap items-center gap-1 ${mine ? 'justify-end pr-1' : 'justify-start pl-1'}`}>
                      {reactions.map(([emoji, users]) => (
                        <button key={emoji}
                          onClick={() => void toggleReaction(m, emoji)}
                          onPointerDown={() => { endPress(); chipPressTimer.current = window.setTimeout(() => void showReactors(m, emoji), 420) }}
                          onPointerUp={() => window.clearTimeout(chipPressTimer.current)}
                          onPointerLeave={() => window.clearTimeout(chipPressTimer.current)}
                          onPointerCancel={() => window.clearTimeout(chipPressTimer.current)}
                          onContextMenu={(e) => e.preventDefault()}
                          title={`${users.length} reacted — hold to see who`}
                          className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[11px] shadow-md transition hover:scale-105 ${users.includes(userId ?? '') ? 'border-cyan-400 bg-slate-900 ring-1 ring-cyan-400/60' : 'border-slate-700 bg-slate-900'}`}>
                          <span>{emoji}</span>
                          {users.length > 1 && <span className="font-semibold text-slate-300">{users.length}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {(partnerTyping || botTyping) && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-slate-800 px-4 py-3">
              <span className="inline-flex gap-1">
                {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400" style={{ animationDelay: `${i * 150}ms` }} />)}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && <p className="w-full px-4 pb-2 text-xs text-red-300">{error}</p>}

      {/* ── Composer ───────────────────────────────────────── */}
      <form onSubmit={send} className="flex-none border-t border-slate-800 bg-slate-900 px-3 pt-2"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto max-w-3xl">
          {composerQuote && (
            <div className={`mb-2 flex items-center gap-2 rounded-xl border-l-4 p-2.5 ${composerMode === 'edit' ? 'border-amber-400 bg-amber-950/20' : 'border-cyan-400 bg-cyan-950/20'}`}>
              {composerMode === 'edit'
                ? <Pencil size={15} className="flex-none text-amber-300" />
                : <CornerUpLeft size={15} className="flex-none text-cyan-300" />}
              <div className="min-w-0 flex-1">
                <p className={`text-[11px] font-bold ${composerMode === 'edit' ? 'text-amber-300' : 'text-cyan-300'}`}>
                  {composerMode === 'edit' ? 'Editing message' : `Replying to ${labelFor(replyTo!)}`}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {composerMode === 'edit' ? editing!.original_message : (replyTo!.deleted_at ? 'This message was deleted' : replyTo!.original_message)}
                </p>
              </div>
              <button type="button" aria-label="Cancel" onClick={() => { setReplyTo(null); setEditing(null); setText(editing ? '' : text) }}
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-800 hover:text-white">
                <X size={15} />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            {blockedAny ? (
              <p className="w-full py-2 text-center text-sm text-slate-500">
                {blockedByMe ? 'You blocked this user — unblock from the ⋮ menu to chat again.' : 'You cannot message this user.'}
              </p>
            ) : (
              <>
                <input ref={inputRef} value={text} onChange={(e) => onTextChange(e.target.value)} maxLength={2000} autoFocus
                  placeholder={composerMode === 'edit' ? 'Edit your message…' : 'Type a message…'}
                  className="min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-950 px-5 py-3 text-[15px] outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20" />
                <button type="submit" aria-label={composerMode === 'edit' ? 'Save edit' : 'Send'} disabled={!text.trim()}
                  onPointerDown={(e) => e.preventDefault()}
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-950/40 transition hover:brightness-110 active:scale-95 disabled:opacity-40">
                  {composerMode === 'edit' ? <Check size={19} /> : <Send size={18} />}
                </button>
              </>
            )}
          </div>
        </div>
      </form>

      {/* ── Jump to latest ─────────────────────────────────── */}
      {showScrollDown && !composerQuote && (
        <button onClick={scrollToLatest} aria-label={`Scroll to latest${unreadCount ? `, ${unreadCount} new` : ''}`}
          className="absolute bottom-[86px] right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-800/95 shadow-xl transition hover:bg-slate-700 active:scale-95">
          <ArrowDown size={19} className="text-cyan-300" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-400 px-1 text-[11px] font-bold text-slate-950 shadow">
              {unreadCount}
            </span>
          )}
        </button>
      )}

      {/* ── Who reacted popup ──────────────────────────────── */}
      {reactorInfo && (
        <div className="fixed inset-0 z-40" onClick={() => setReactorInfo(null)}>
          <div className="absolute inset-x-0 bottom-28 mx-auto w-fit max-w-[90%] rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold">{reactorInfo.emoji} {reactorInfo.names.length > 1 ? `${reactorInfo.names.length} people reacted` : 'Reacted'}</p>
            <p className="mt-1 max-w-xs break-words text-xs leading-relaxed text-slate-300">{reactorInfo.names.join(', ')}</p>
          </div>
        </div>
      )}

      {/* ── Block choice dialog ────────────────────────────── */}
      {blockChoiceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setBlockChoiceOpen(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="flex items-center gap-2 text-lg font-bold"><Ban size={18} className="text-red-400" /> Block this person?</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              You are currently friends. Blocking freezes all chatting between you. Keep the friendship, or end it too?
            </p>
            <div className="mt-6 space-y-2.5">
              <button onClick={() => void doBlock(false)} className="w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:brightness-110">
                ⛔ Block — stay friends
              </button>
              <button onClick={() => void doBlock(true)} className="w-full rounded-xl bg-red-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-400">
                ⛔ Block &amp; unfriend
              </button>
              <button onClick={() => setBlockChoiceOpen(false)} className="w-full rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Long-press action sheet ────────────────────────── */}
      {actionsMsg && (
        <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px]" onClick={() => setActionsMsg(null)}>
          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-3xl rounded-t-3xl border-t border-slate-700 bg-slate-900 p-4 pb-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-700" />
            <p className="mb-3 truncate rounded-lg bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
              {actionsMsg.msg.deleted_at ? 'This message was deleted' : actionsMsg.msg.original_message}
            </p>
            <div className="mb-4 grid grid-cols-6 gap-1">
              {QUICK_EMOJIS.map((emoji) => {
                const mineAlready = actionsMsg.msg.reactions?.[emoji]?.includes(userId ?? '') ?? false
                return (
                  <button key={emoji} onClick={() => void toggleReaction(actionsMsg.msg, emoji)}
                    className={`flex h-12 items-center justify-center rounded-xl text-2xl transition hover:scale-110 hover:bg-slate-800 active:scale-95 ${mineAlready ? 'bg-cyan-400/20 ring-2 ring-cyan-400' : ''}`}
                    title={mineAlready ? 'Remove your reaction' : 'React'}>
                    {emoji}
                  </button>
                )
              })}
            </div>
            <div className="space-y-1">
              <button onClick={() => { setReplyTo(actionsMsg.msg); setEditing(null); setActionsMsg(null) }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition hover:bg-slate-800">
                <CornerUpLeft size={17} className="text-cyan-300" /> Reply
              </button>
              {actionsMsg.canEdit && (
                <button onClick={() => beginEdit(actionsMsg.msg)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition hover:bg-slate-800">
                  <Pencil size={17} className="text-amber-300" /> Edit
                </button>
              )}
              {actionsMsg.msg.sender_id === userId && !actionsMsg.msg.deleted_at && (
                <button onClick={() => void deleteMessage(actionsMsg.msg)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-red-300 transition hover:bg-red-950/40">
                  <Trash2 size={17} /> Delete for everyone
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
