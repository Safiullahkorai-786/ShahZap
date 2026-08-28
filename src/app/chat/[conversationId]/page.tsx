'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { MoreVertical, Send, UserPlus, ShieldAlert, Ban, Languages, UserCircle2, CornerUpLeft, Pencil, Trash2, X, Check, CheckCheck, ArrowDown, SunMoon, Clock, UserCheck, UserMinus, Smile, SmilePlus, BellRing, Vibrate, VolumeX, Type, ChevronDown, Plus, Minus, Cake, Sparkles, User, Globe, Copy, Image as ImageIcon, Heart } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { getSoundPrefs, setSoundBundle, setSoundMode, notify, playFriendRequestSound, playMessageSound, playSentSound, playUnfriendSound, type SoundPrefs } from '@/lib/notification-sound'
import { friendlyError } from '@/lib/errors'
import { getBotPersona, isBotProfile } from '@/lib/bot'
import { AdsterraBanner } from '@/components/adsterra-banner'
import { resolveIdentity, type Identity } from '@/lib/identity'
import { useSiteActive } from '@/hooks/use-site-active'
import { Shimmer } from '@/components/shimmer'
import { RichText } from '@/components/rich-text'
import { EmojiPicker } from '@/components/emoji-picker'
import { getRegionForCountry, REGION_LABELS, getCountryName } from '@/lib/regions'
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
  deleted_by_receiver_at?: string | null
  delivered_at?: string | null
  read_at?: string | null
}
type OtherProfile = {
  id: string
  display_name: string | null
  gender?: string | null
  gender_visible?: boolean
  age_band: string | null
  age_band_visible: boolean
  generation?: string | null
  generation_visible?: boolean
  bio?: string | null
  orientation?: string | null
  country_code?: string | null
  country_visible?: boolean
  region_visible?: boolean
  chat_language?: string | null
  language_visible?: boolean
  languages_known_visible?: boolean
  interests_visible?: boolean
  interest_names?: string[] | null
  languages_known?: string[] | null
  profile_visible?: boolean
  last_active_at: string | null
}

const AGE_BAND_LABELS: Record<string, string> = {
  under_13: 'Under 13', '13_15': '13–15', '16_17': '16–17', '18_20': '18–20',
  '21_29': '21–29', '30_44': '30–44', '45_59': '45–59', '60_plus': '60+',
}

const GEN_LABELS: Record<string, string> = {
  gen_z: 'Gen Z', gen_x: 'Gen X', millennial: 'Millennial', boomer: 'Boomer', gen_alpha: 'Gen Alpha',
}

const GENDER_LABELS: Record<string, string> = {
  woman: 'Woman', man: 'Man', non_binary: 'Non-binary', prefer_not_to_say: 'Prefer not to say',
}

const LANG_LABELS: Record<string, string> = {
  en: 'English', ur: 'Urdu', sd: 'Sindhi', hi: 'Hindi', pa: 'Punjabi', ar: 'Arabic',
  es: 'Spanish', fr: 'French', de: 'German', tr: 'Turkish', bn: 'Bengali', zh: 'Chinese',
  fa: 'Persian', ru: 'Russian', pt: 'Portuguese', id: 'Indonesian', ms: 'Malay', ja: 'Japanese',
  ko: 'Korean', it: 'Italian',
}
const REPORT_REASONS = ['harassment','spam','hate_speech','sexual_content','scam','impersonation','underage_concern','threatening_behavior','other']
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '😘', '💦', '🤡', '🌚', '🌝']
// Presence flips to offline 20s after the last heartbeat. The global
// PresenceHeartbeat beats every 10s while the tab/PWA is visible, and
// instantly on focus — so closing/backgrounding shows "last seen" within
// 20s, and returning goes green again in near real time.
const ONLINE_WINDOW_MS = 20 * 1000
const EDIT_WINDOW_MS = 15 * 60 * 1000
const MESSAGE_COLUMNS = 'id,sender_id,original_message,translated_message,created_at,reactions,edited_at,deleted_at,reply_to_message_id,deleted_by_receiver_at,delivered_at,read_at'

type WallpaperPrefs = { mode: 'wallpaper' | 'solid'; solid: string; dim: number }
const SOLID_COLORS = ['#020617', '#0f172a', '#1e293b', '#083344', '#134e4a', '#1e1b4b', '#450a0a', '#052e16']

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
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [otherId, setOtherId] = useState<string | null>(null)
  const [other, setOther] = useState<OtherProfile | null>(null)
  const [otherInterests, setOtherInterests] = useState<string[]>([])
  const [otherLanguages, setOtherLanguages] = useState<string[]>([])
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
  const [cardOpen, setCardOpen] = useState(false)
  const [reqBlocked, setReqBlocked] = useState(false)
  const [virtualKb, setVirtualKb] = useState(false)
  const kbTouchRef = useRef(false)
  const [fmtOpen, setFmtOpen] = useState(false)
  // Accent dots collapse to the first 6 until "+" is tapped.
  const [allAccents, setAllAccents] = useState(false)

  // Chat wallpaper: ShahZap image or a solid color, with an intensity
  // slider ("dim" = how much dark scrim sits over it). Default 0 so the
  // image shows fully/most vividly; users can dim it as they prefer.
  const [wallpaper, setWallpaperState] = useState<WallpaperPrefs>({ mode: 'wallpaper', solid: '#0f172a', dim: 0 })
  function setWallpaper(next: WallpaperPrefs) {
    setWallpaperState(next)
    try { localStorage.setItem('shahzap:wallpaper', JSON.stringify(next)) } catch {}
  }
  const [soundPrefs, setSoundPrefs] = useState<SoundPrefs>({ mode: 'sound', bundle: 'classic' })
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
  const [otherLastActiveAt, setOtherLastActiveAt] = useState<string | null>(null)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [reactorInfo, setReactorInfo] = useState<{ emoji: string; names: string[] } | null>(null)
  const [sel, setSel] = useState<Selection>({ base: 'dark', accent: 'none' })
  const [unreadCount, setUnreadCount] = useState(0)
  const prevMsgCount = useRef(0)

  const [actionsMsg, setActionsMsg] = useState<{ msg: Message; canEdit: boolean } | null>(null)
  const [reactFor, setReactFor] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const lastTypingSent = useRef(0)
  const typingStopTimer = useRef<number | undefined>(undefined)
  const partnerTypingExpiry = useRef<number | undefined>(undefined)
  const pressTimer = useRef<number | undefined>(undefined)
  const chipPressTimer = useRef<number | undefined>(undefined)
  const didInitialScroll = useRef(false)
  const userIdRef2 = useRef<string | null>(null)
  const gesture = useRef<{ id: string | null; startX: number; dx: number; moved: boolean; pressed: boolean; pointerType: string; mode: 'press' | 'rdrag'; startT: number }>({ id: null, startX: 0, dx: 0, moved: false, pressed: false, pointerType: 'mouse', mode: 'press', startT: 0 })
  // When the ⋮ menu is open and the user taps somewhere to close it, both
  // the document pointerdown (which closes the menu) AND the message bubble's
  // onPointerDown fire on the same event. This guard prevents the gesture
  // system from treating that closing-tap as a message interaction (which
  // would accidentally open the action sheet / emoji reaction picker).
  const menuCloseGuard = useRef(false)
  // Message IDs with an in-flight RPC toggle (reaction, edit, delete).
  // The 3-second poll skips these so stale server data doesn't overwrite
  // the optimistic update before the RPC completes.
  const togglingMessages = useRef(new Set<string>())

  const persona = getBotPersona(otherId)
  const otherName = persona ? persona.name : other?.display_name || 'ShahZap user'

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | undefined
    let active = true
    // Smart fallback: only poll when Realtime is down or silent.
    let lastRealtimeActivity = Date.now()
    let channelStatus = ''
    let smartPollTimer: number | undefined
    let staleCheckTimer: number | undefined
    let presenceCheckTimer: number | undefined
    const otherRef: { current: OtherProfile | null } = { current: null }
    const otherIdRef: { current: string | null } = { current: null }

    function refreshPresence(ts?: string | null) {
      const p = getBotPersona(otherIdRef.current)
      if (p) { setOtherOnline(true); setPresenceLabel('always here'); return }
      const op = otherRef.current
      if (!op) return
      // Prefer the freshest timestamp we were handed; fall back to the ref.
      const iso = ts !== undefined ? ts : op.last_active_at
      if (ts !== undefined) { op.last_active_at = ts; setOtherLastActiveAt(ts) }
      const online = !!iso && Date.now() - new Date(iso).getTime() < ONLINE_WINDOW_MS
      setOtherOnline(online)
      setPresenceLabel(online ? 'online' : lastSeen(iso))
    }

    // ── Smart fallback polling ───────────────────────────────────────────
    // Only run when Realtime is down or silent. Saves ~1 200 req/hr.
    const SMART_POLL_MS = 5_000
    const STALE_MS = 30_000

    async function pollMessages() {
      if (!active) return
      const { data: fresh } = await supabase.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId).order('created_at', { ascending: true })
      if (!fresh || !active) return
      const toggling = togglingMessages.current
      setMessages((prev) => {
        if (toggling.size > 0) {
          const next = prev.map((m) => toggling.has(m.id) ? m : (fresh.find((f) => f.id === m.id) as Message) ?? m)
          return next.length === prev.length && next.every((m, i) => m === prev[i]) ? prev : next
        }
        const changed = prev.length !== fresh.length || fresh[fresh.length - 1]?.id !== prev[prev.length - 1]?.id ||
          fresh.some((fm, i) => {
            const pm = prev[i]
            return !pm || pm.id !== fm.id || pm.edited_at !== fm.edited_at || pm.deleted_at !== fm.deleted_at || pm.deleted_by_receiver_at !== fm.deleted_by_receiver_at ||
              pm.delivered_at !== fm.delivered_at || pm.read_at !== fm.read_at ||
              JSON.stringify(pm.reactions ?? {}) !== JSON.stringify(fm.reactions ?? {})
          })
        return changed ? (fresh as Message[]) : prev
      })
      const latest = fresh[fresh.length - 1]
      if (latest && latest.sender_id !== userIdRef2.current) setBotTyping(false)
      if (otherIdRef.current && !isBotProfile(otherIdRef.current)) {
        const { data: op } = await supabase.from('profiles').select('last_active_at').eq('id', otherIdRef.current).maybeSingle()
        if (op && active) refreshPresence(op.last_active_at ?? null)
      }
      refreshPresence()
    }

    function startSmartPoll() {
      if (smartPollTimer) return
      smartPollTimer = window.setInterval(() => void pollMessages(), SMART_POLL_MS)
    }

    function stopSmartPoll() {
      if (smartPollTimer) { window.clearInterval(smartPollTimer); smartPollTimer = undefined }
    }

    function checkStaleness() {
      if (!active || !channelStatus) return
      if (channelStatus !== 'SUBSCRIBED') { startSmartPoll(); return }
      if (Date.now() - lastRealtimeActivity > STALE_MS) { startSmartPoll(); return }
      stopSmartPoll()
    }

    async function load() {
      didInitialScroll.current = false
      setAutoTranslate(localStorage.getItem('shahzap:autoTranslate') === '1')
      try {
        const raw = localStorage.getItem('shahzap:wallpaper')
        if (raw) {
          const parsed = JSON.parse(raw) as WallpaperPrefs
          if (parsed && (parsed.mode === 'wallpaper' || parsed.mode === 'solid') && typeof parsed.dim === 'number') setWallpaperState(parsed)
        }
      } catch {}
      const sel0 = getSelection()
      setSel(sel0)
      // If the chosen accent lives in the collapsed zone, start expanded.
      setAllAccents(ACCENTS.findIndex((a) => a.id === sel0.accent) >= 6)
      setSoundPrefs(getSoundPrefs())
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      setUserId(user.id)
      userIdRef2.current = user.id

      const { data: participants } = await supabase.from('conversation_participants').select('profile_id').eq('conversation_id', conversationId)
      const otherProfileId = participants?.find((p) => p.profile_id !== user.id)?.profile_id ?? null
      otherIdRef.current = otherProfileId
      setOtherId(otherProfileId)

      if (otherProfileId && !isBotProfile(otherProfileId)) {
        const { data: op } = await supabase.from('profiles').select('id,display_name,gender,gender_visible,age_band,age_band_visible,generation,generation_visible,bio,orientation,country_code,country_visible,chat_language,language_visible,languages_known_visible,languages_known,interests_visible,interest_names,profile_visible,last_active_at').eq('id', otherProfileId).maybeSingle()
        if (active && op) { setOther(op as OtherProfile); otherRef.current = op as OtherProfile; setOtherLastActiveAt(op.last_active_at ?? null); refreshPresence(op.last_active_at ?? null) }
        // Fetch interests if visible (from interest_names on profiles - always readable)
        if ((op as any)?.interests_visible) {
          if (active) setOtherInterests(((op as any).interest_names ?? []).filter(Boolean))
        }
        // Fetch languages known if visible
        if ((op as any)?.languages_known_visible) {
          if (active) setOtherLanguages((op as any).languages_known ?? [])
        }
        // Did they decline our friend request 3 times? Then requests are off.
        const { count: declinedCount } = await supabase.from('friend_requests').select('id', { count: 'exact', head: true }).eq('sender_id', user.id).eq('receiver_id', otherProfileId).eq('status', 'declined')
        if (active) setReqBlocked((declinedCount ?? 0) >= 3)
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

      // Immediately stamp read on inbound messages so the sender's blue ticks
      // appear. Direct client update fires the DB trigger; belt-and-suspenders
      // with the server RPC.
      void (async () => {
        await supabase
          .from('conversation_participants')
          .update({ last_read_at: new Date().toISOString() })
          .eq('conversation_id', conversationId)
          .eq('profile_id', user.id)
        await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }).then(() => {}, () => {})
        if (!active) return
        const { data: fresh } = await supabase.from('messages').select(MESSAGE_COLUMNS).eq('conversation_id', conversationId).order('created_at', { ascending: true })
        if (active && fresh) setMessages(fresh as Message[])
      })()

      channel = supabase.channel(`conversation:${conversationId}`, { config: { broadcast: { self: false } } })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
          lastRealtimeActivity = Date.now()
          const message = payload.new as Message
          setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]))
          if (isBotProfile(message.sender_id)) setBotTyping(false)
          if (message.sender_id !== user.id) playMessageSound()
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
          lastRealtimeActivity = Date.now()
          const updated = payload.new as Message
          setMessages((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)))
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${otherProfileId}` }, (payload) => {
          lastRealtimeActivity = Date.now()
          const row = payload.new as Record<string, any>
          refreshPresence(row.last_active_at ?? null)
          // Update other profile fields in real time
          setOther((prev) => prev ? { ...prev, ...row } as OtherProfile : prev)
          if (row.interests_visible) {
            setOtherInterests((row.interest_names ?? []).filter(Boolean))
          } else {
            setOtherInterests([])
          }
          if (row.languages_known_visible) {
            setOtherLanguages(row.languages_known ?? [])
          } else {
            setOtherLanguages([])
          }
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          lastRealtimeActivity = Date.now()
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
          lastRealtimeActivity = Date.now()
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
          lastRealtimeActivity = Date.now()
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
          lastRealtimeActivity = Date.now()
          const row = payload.new as { id: string; sender_id: string; status: string }
          const entry = frRows.current.get(String(row.id))
          if (entry) entry.status = row.status
          if (row.sender_id !== otherIdRef.current) return
          if (row.status === 'accepted') { updateFriendState('friends'); setIncomingReq(null) }
          if (row.status === 'declined') { updateFriendState('none'); setIncomingReq(null); setStatusLine('Friend request declined.') }
        })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks' }, (payload) => {
          lastRealtimeActivity = Date.now()
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
          lastRealtimeActivity = Date.now()
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
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'conversation_participants' }, (payload) => {
          const row = payload.old as { conversation_id?: string; profile_id?: string }
          if (row.conversation_id === conversationId && row.profile_id !== userId) {
            // The other person's participant row was deleted — conversation is gone for them too
            router.push('/friends')
          }
        })
.subscribe((status) => {
          channelStatus = status
          if (status === 'SUBSCRIBED') {
            lastRealtimeActivity = Date.now()
            stopSmartPoll()
            if (!staleCheckTimer) staleCheckTimer = window.setInterval(checkStaleness, SMART_POLL_MS)
          } else {
            startSmartPoll()
          }
        })
      channelRef.current = channel

      // ── Presence poll: check other person's last_active_at every 10s ──
      // Detects when they go offline (heartbeat stops → last_active_at goes stale).
      if (!isBotProfile(otherProfileId)) {
        presenceCheckTimer = window.setInterval(async () => {
          if (!active) return
          const { data: op } = await supabase.from('profiles').select('last_active_at').eq('id', otherIdRef.current).maybeSingle()
          if (op && active) refreshPresence(op.last_active_at ?? null)
        }, 30_000)
      }
    }

    void load()
    return () => {
      active = false
      channelRef.current = null
      if (channel) void supabase.removeChannel(channel)
      if (smartPollTimer) window.clearInterval(smartPollTimer)
      if (staleCheckTimer) window.clearInterval(staleCheckTimer)
      if (presenceCheckTimer) window.clearInterval(presenceCheckTimer)
      window.clearTimeout(typingStopTimer.current)
      window.clearTimeout(partnerTypingExpiry.current)
      window.clearTimeout(pressTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, router])

  // Read receipts: while THIS chat is open, stamp my read receipt AND mark
  // inbound messages read so my partner's ticks turn "seen". Re-stamps on an
  // interval so the sender's blue tick stays live for every message I read.
  useEffect(() => {
    if (!userId || !conversationId || loading) return

    async function mark() {
      const supabase = createClient()
      // 0. Deliver inbound messages FIRST so delivered_at is set before read_at.
      //    This ensures the client sees double-white tick before blue tick.
      await supabase.rpc('sync_deliveries').then(() => {}, () => {})

      // 1. Directly update our own last_read_at via client (RLS-safe).
      //    This fires the DB trigger that stamps read_at on inbound messages.
      await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('profile_id', userId)

      // 2. Also call the server RPC as a belt-and-suspenders safety net.
      //    Swallow errors — the direct update above is the primary path.
      await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId }).then(() => {}, () => {})

      // 3. Mark message notifications for this conversation as read
      await supabase.rpc('mark_message_notifications_read', { p_conversation_id: conversationId }).then(() => {}, () => {})

      // 3. Re-fetch messages to immediately pick up the server-stamped
      //    read_at values (don't wait for Realtime or the 3s poll).
      const { data } = await supabase
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
      if (data) setMessages(data as Message[])
    }

    function safeMark() {
      if (document.visibilityState === 'visible') void mark()
    }

    mark()
    const iv = window.setInterval(safeMark, 4000)
    document.addEventListener('visibilitychange', safeMark)
    window.addEventListener('focus', safeMark)
    return () => {
      window.clearInterval(iv)
      document.removeEventListener('visibilitychange', safeMark)
      window.removeEventListener('focus', safeMark)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, conversationId, loading])

  // Grow the composer with its content (up to ~5 lines), then scroll inside.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  // Laptop convenience: start typing anywhere on the page and the composer
  // wakes up and receives your keystrokes — no click into the field needed.
  useEffect(() => {
    if (blockedAny) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName))) return
      // Never steal Space/Enter from a focused button or link.
      if (ae && ['BUTTON', 'A', 'SUMMARY'].includes(ae.tagName) && (e.key === ' ' || e.key === 'Enter')) return
      if (e.key.length !== 1) return
      inputRef.current?.focus({ preventScroll: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [blockedAny])

  // Close the ⋮ menu the moment anything else on the page is pressed.
  useEffect(() => {
    if (!menuOpen) return
    function onDocPointer(e: PointerEvent) {
      const t = e.target as HTMLElement | null
      if (!t) return
      if (menuRef.current?.contains(t)) return // clicks inside the panel keep it open
      if (t.closest('button[aria-label="More options"]')) return // let the ⋮ button toggle itself
      // Flag prevents the message gesture system from treating this same
      // pointerdown (which closes the menu) as a tap/hold on the message.
      menuCloseGuard.current = true
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

  // Transient status lines ("You are now friends! 🎉", "Friend request was
  // withdrawn.", "Blocked." …) disappear on their own after 10 seconds.
  useEffect(() => {
    if (!statusLine) return
    const timer = window.setTimeout(() => setStatusLine(''), 10_000)
    return () => window.clearTimeout(timer)
  }, [statusLine])

  // Scroll of the message list: cancels pending gestures, drives the
  // jump-to-latest button visibility, and clears unread when reaching bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onScroll() {
      if (!el) return
      window.clearTimeout(pressTimer.current)
      window.clearTimeout(chipPressTimer.current)
      gesture.current = { id: null, startX: 0, dx: 0, moved: false, pressed: false, pointerType: 'mouse', mode: 'press', startT: 0 }
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
    if (ch) void ch.send({ type: 'broadcast', event: 'typing', payload: { typing, from: userId } })
    // Persist to DB so friends list can show typing indicator, independent of the
    // broadcast channel being ready.
    void createClient().rpc('set_typing', { p_conversation_id: conversationId, p_typing: typing })
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
    playSentSound()
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

  // Receiver-side delete: hides THEIR copy only. The sender keeps the message
  // and just sees a small "deleted by receiver" tag beside the timestamp.
  // Column-level DB grant makes every other field untouchable.
  async function deleteForMe(m: Message) {
    setActionsMsg(null)
    if (!userId || m.sender_id === userId) return
    const optimistic = { ...m, deleted_by_receiver_at: new Date().toISOString() }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? optimistic : x)))
    const supabase = createClient()
    const { error: e } = await supabase.from('messages').update({ deleted_by_receiver_at: optimistic.deleted_by_receiver_at }).eq('id', m.id).is('deleted_by_receiver_at', null)
    if (e) {
      setStatusLine(friendlyError(e, 'Could not delete this message from your side.'))
      setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)))
    }
  }

  async function toggleReaction(m: Message, emoji: string) {
    if (!userId || m.deleted_at || blockedAny) return
    setActionsMsg(null)
    setReactFor(null)
    const before = messages.find((x) => x.id === m.id)?.reactions ?? m.reactions
    // Optimistic: build what reactions should look like after the toggle.
    const cur: Record<string, string[]> = { ...(before ?? {}) }
    const alreadyMine = cur[emoji]?.includes(userId) ?? false
    const nextAll: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(cur)) {
      const kept = v.filter((u) => u !== userId)
      if (kept.length) nextAll[k] = kept
    }
    if (!alreadyMine) {
      nextAll[emoji] = [...(nextAll[emoji] ?? []), userId]
    }
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: nextAll } : x)))
    togglingMessages.current.add(m.id)
    try {
      const supabase = createClient()
      const { data, error: e } = await supabase.rpc('toggle_message_reaction', { p_message_id: m.id, p_emoji: emoji })
      if (e) {
        setStatusLine(friendlyError(e, 'Could not save the reaction.'))
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: before } : x)))
        return
      }
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: data as Record<string, string[]> } : x)))
    } finally {
      // Defer guard removal until AFTER React commits the setMessages update.
      // Removing immediately lets the 3s poll fire first and overwrite with stale data.
      requestAnimationFrame(() => togglingMessages.current.delete(m.id))
    }
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
    const { error: e } = await supabase.rpc('block_user', { p_other_id: otherId, p_unfriend: false })
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
      const { error: e } = await supabase.rpc('unblock_user', { p_other_id: otherId })
      if (e) setStatusLine(friendlyError(e, 'Could not unblock.'))
      else { setBlockedByMe(false); setStatusLine('Unblocked.') }
    } else {
      const { error: e } = await supabase.rpc('block_user', { p_other_id: otherId, p_unfriend: false })
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
    setDetails(''); setReportOpen(false); setMenuOpen(false); setCardOpen(false)
    setStatusLine('Report submitted. Thank you for helping keep ShahZap safe.')
  }

  function toggleAutoTranslate() {
    setAutoTranslate((v) => { localStorage.setItem('shahzap:autoTranslate', v ? '0' : '1'); return !v })
  }

  function copyMessage(m: Message) {
    void navigator.clipboard.writeText(m.original_message).then(() => {
      setActionsMsg(null)
      setStatusLine('Copied to clipboard.')
    }).catch(() => setStatusLine('Could not copy — long-press the message text to select it instead.'))
  }

  // ── Gesture handlers: tap → action sheet, horizontal drag → reply,
  //    HOLD → native OS text selection so any word can be copied ──
  function endPress() { window.clearTimeout(pressTimer.current) }
  function startPress(m: Message, e: React.PointerEvent) {
    if (m.deleted_at || blockedAny) return
    // If the ⋮ menu was just closed by this same pointerdown, skip gesture
    // tracking entirely — otherwise a quick tap accidentally opens the
    // action sheet or emoji reaction picker.
    if (menuCloseGuard.current) { menuCloseGuard.current = false; return }
    // DESKTOP: two-finger / right-button click starts a drag session instead of
    // the touch-style hold. Plain right-click (no drag) opens the sheet.
    if (e.pointerType === 'mouse' && e.button === 2) {
      gesture.current = { id: m.id, startX: e.clientX, dx: 0, moved: false, pressed: true, pointerType: e.pointerType, mode: 'rdrag', startT: Date.now() }
      endPress()
      return
    }
    // Touch / pen / mouse-left: track for swipe-to-reply AND the classic
    // HOLD → options sheet (450ms, like WhatsApp). Text stays non-selectable
    // so holding always opens the menu instead of selecting words.
    gesture.current = { id: m.id, startX: e.clientX, dx: 0, moved: false, pressed: false, pointerType: e.pointerType, mode: 'press', startT: Date.now() }
    endPress()
    pressTimer.current = window.setTimeout(() => {
      gesture.current.pressed = true
      if (navigator.vibrate) navigator.vibrate(25)
      setDrag(null)
      setReactFor(null)
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
  function finishPress(m: Message, now: number, cancelled = false) {
    const g = gesture.current
    endPress()
    setDrag(null)
    if (g.id !== m.id) return
    if (g.mode === 'rdrag') {
      if (!cancelled && g.moved && Math.abs(g.dx) >= 26) {
        // Dragged far enough → quote-reply, same as touch swipe.
        setReplyTo(m)
        setEditing(null)
        // Still inside the pointerup gesture → mobile keyboards allow this.
        inputRef.current?.focus({ preventScroll: true })
      } else if (!cancelled && !g.moved) {
        // Plain two-finger / right click → message options sheet.
        setActionsMsg({ msg: m, canEdit: m.sender_id === userId && now - new Date(m.created_at).getTime() < EDIT_WINDOW_MS })
      }
      } else if (!cancelled && !g.pressed && g.moved && Math.abs(g.dx) >= 26) {
        setReplyTo(m)
        setEditing(null)
        inputRef.current?.focus({ preventScroll: true })
      }
      // NOTE: A quick, non-held touch TAP intentionally does nothing now.
      // The options sheet / emoji picker only opens on a real HOLD (the
      // 450ms timer in startPress sets g.pressed=true and opens the sheet).
      // Previously a tap < 350ms opened the sheet, which on mobile caused
      // the popup + accidental emoji reactions on normal single taps.
      gesture.current = { id: null, startX: 0, dx: 0, moved: false, pressed: false, pointerType: 'mouse', mode: 'press', startT: 0 }
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
    inputRef.current?.focus({ preventScroll: true })
  }

  // WhatsApp-style ticks for my own messages:
  //   single tick        → message not yet delivered, or I'm not actively
  //                        on the site right now;
  //   white double tick  → message is delivered (delivered_at set, permanent)
  //                        and I'm online on the site (any page/tab);
  //   blue double tick   → receiver has read the message (permanent).
  const siteActive = useSiteActive()

  function isDelivered(m: Message): boolean {
    if (persona) return true
    return !!m.delivered_at && siteActive
  }

  function isSeen(m: Message): boolean {
    if (persona) return true
    return !!m.read_at
  }

  // Insert an emoji/emoticon at the cursor and keep the caret right after it.
  function insertNewline() {
    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    setText(text.slice(0, start) + '\n' + text.slice(end))
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true })
      const pos = start + 1
      el.setSelectionRange(pos, pos)
    })
  }

  function insertEmoji(item: string) {
    const el = inputRef.current
    if (!el) { setText((t) => t + item); return }
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    setText(text.slice(0, start) + item + text.slice(end))
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true })
      const pos = start + item.length
      el.setSelectionRange(pos, pos)
    })
  }

  const subtitle = useMemo(() => {
    if (persona) return partnerTyping || botTyping ? 'typing…' : persona.role
    if (partnerTyping) return 'typing…'
    if (!other) return ''
    return presenceLabel || 'offline'
  }, [persona, partnerTyping, botTyping, other, presenceLabel])

  const composerQuote = editing ?? replyTo
  const composerMode: 'edit' | 'reply' | null = editing ? 'edit' : replyTo ? 'reply' : null

  function labelFor(msg: Message): string {
    if (msg.sender_id === userId) return 'You'
    return getBotPersona(msg.sender_id)?.name ?? otherName
  }

  return (
    <main className="relative flex h-dvh max-h-dvh w-full flex-col overflow-hidden bg-slate-950 text-white">
      {/* ── Fixed wallpaper/solid background layer ──────────────
          Pinned to the layout viewport with a CONSTANT height (100vh,
          the full/large-viewport height) so the image does NOT move or
          rescale when the mobile keyboard opens or a status banner
          shifts the chat layout. Using 100vh (not 100dvh) keeps the
          height stable while the keyboard is up. Constrained to the
          centered chat column (max-w-3xl) so it only shows behind the
          message area, not the full screen. */}
      <div aria-hidden className="pointer-events-none fixed left-1/2 top-0 z-0 h-screen w-full max-w-3xl -translate-x-1/2"
        style={{
          backgroundColor: wallpaper.solid,
          backgroundImage: `linear-gradient(rgba(2,6,23,${wallpaper.dim}), rgba(2,6,23,${wallpaper.dim}))${wallpaper.mode === 'wallpaper' ? ', url(/ShahZap_Bg.png)' : ''}`,
          backgroundSize: wallpaper.mode === 'wallpaper' ? 'cover' : 'auto',
          backgroundPosition: 'center',
        }}
      />
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="relative z-20 flex-none border-b border-slate-800 bg-slate-900 px-2 py-2.5 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-1.5">
          <button aria-label="More options" onClick={() => setMenuOpen((v) => !v)}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-slate-300 transition hover:bg-slate-800 hover:text-white">
            <MoreVertical size={20} />
          </button>

          <button type="button" aria-label="View profile" onClick={() => persona ? undefined : setCardOpen(true)}
            className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left transition ${persona ? '' : 'hover:bg-slate-800/60'}`}>
            <span aria-hidden><Avatar name={otherName} online={otherOnline} large /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{otherName}</span>
              <span className={`block truncate text-xs ${subtitle === 'typing…' ? 'animate-pulse text-cyan-300' : 'text-slate-400'}`}>{subtitle}</span>
            </span>
          </button>

          <button onClick={() => router.push('/match')} className="mr-1 flex-none rounded-full bg-cyan-400/10 px-4 py-2 text-xs font-bold text-cyan-300 transition hover:bg-cyan-400/20">Next</button>
        </div>

        {menuOpen && (
          <>
            <div ref={menuRef} className="absolute left-2 top-full z-20 mt-1 max-h-[calc(100dvh-4.5rem)] w-72 overflow-y-auto overscroll-contain overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="px-3 pb-3 pt-2.5">
                <p className="mb-2 flex items-center gap-3 text-sm"><BellRing size={17} className="text-cyan-300" /> Sounds</p>
                <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-950 p-1">
                  {([['sound','On',BellRing],['buzz','Buzz',Vibrate],['mute','Mute',VolumeX]] as const).map(([m,label,Icon]) => (
                    <button key={m} onClick={() => setSoundPrefs(setSoundMode(m))}
                      className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${soundPrefs.mode === m ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
                <p className="mb-1.5 mt-2.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">Sound pack</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['classic','pop','zen'] as const).map((b) => (
                    <button key={b} onClick={() => { const n = setSoundBundle(b); setSoundPrefs(n); notify('message') }}
                      className={`rounded-lg px-2 py-1.5 text-xs font-semibold capitalize transition ${soundPrefs.bundle === b ? 'bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-400/50' : 'bg-slate-950 text-slate-400 hover:text-white ring-1 ring-slate-800'}`}>
                      {b === 'classic' ? '✨ Classic' : b === 'pop' ? '🎈 Pop' : '🍃 Zen'}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">{soundPrefs.mode === 'buzz' ? 'Vibration where supported, else a soft low buzz.' : soundPrefs.mode === 'mute' ? 'All chat sounds are off.' : 'Tap a pack to hear a preview.'}</p>
              </div>
              <div className="border-t border-slate-800" />
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
                  {(allAccents ? ACCENTS : ACCENTS.slice(0, 6)).map((a) => (
                    <button key={a.id} title={a.label} aria-label={a.label}
                      onClick={() => { const n = { ...sel, accent: a.id }; setSel(n); applySelection(n) }}
                      className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${sel.accent === a.id ? 'border-cyan-400 ring-2 ring-cyan-400/40' : 'border-slate-600'}`}
                      style={{ background: a.preview }} />
                  ))}
                  <button onClick={() => setAllAccents((v) => !v)}
                    title={allAccents ? 'Show fewer colors' : `Show ${ACCENTS.length - 6} more colors`}
                    aria-label={allAccents ? 'Show fewer colors' : `Show ${ACCENTS.length - 6} more colors`}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-500 text-slate-400 transition hover:border-cyan-400 hover:text-cyan-300">
                    {allAccents ? <Minus size={13} /> : <Plus size={13} />}
                  </button>
                </div>
              </div>
              <div className="border-t border-slate-800" />
              <div className="px-3 pb-3 pt-2.5">
                <p className="mb-2 flex items-center gap-3 text-sm"><ImageIcon size={17} className="text-cyan-300" /> Wallpaper</p>
                <div className="mb-1.5 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-950 p-1">
                  {(['wallpaper', 'solid'] as const).map((m) => (
                    <button key={m} onClick={() => setWallpaper({ ...wallpaper, mode: m })}
                      className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition ${wallpaper.mode === m ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
                      {m === 'wallpaper' ? '🖼 ShahZap' : '🎨 Solid'}
                    </button>
                  ))}
                </div>
                {wallpaper.mode === 'solid' && (
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {SOLID_COLORS.map((c) => (
                      <button key={c} title={c} aria-label={`Solid ${c}`}
                        onClick={() => setWallpaper({ ...wallpaper, solid: c })}
                        className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 ${wallpaper.solid.toLowerCase() === c.toLowerCase() ? 'border-cyan-400 ring-2 ring-cyan-400/40' : 'border-slate-600'}`}
                        style={{ background: c }} />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Intensity</span>
                  <input type="range" min={10} max={90} step={5} aria-label="Wallpaper intensity"
                    value={Math.round((1 - wallpaper.dim) * 100)}
                    onChange={(e) => setWallpaper({ ...wallpaper, dim: (100 - Number(e.target.value)) / 100 })}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-700 accent-cyan-400" />
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-500">{wallpaper.mode === 'wallpaper' ? 'Slide right for a more vivid wallpaper.' : 'Slide right to soften the solid color.'}</p>
              </div>
              <div className="border-t border-slate-800" />
              <div className="pb-3 pt-1.5">
                <button onClick={() => setFmtOpen((v) => !v)} aria-expanded={fmtOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-sm transition hover:bg-slate-800">
                  <span className="flex items-center gap-3"><Type size={17} className="text-cyan-300" /> Text formatting</span>
                  <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${fmtOpen ? 'rotate-180' : ''}`} />
                </button>
                <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${fmtOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="grid grid-cols-2 gap-1 px-4 pb-1 pt-0.5 text-[11px] leading-relaxed text-slate-400">
                      <span><code className="rounded bg-slate-950 px-1 font-mono">*hi*</code> <b className="text-slate-200">bold</b></span>
                      <span><code className="rounded bg-slate-950 px-1 font-mono">_hi_</code> <i className="text-slate-200">italic</i></span>
                      <span><code className="rounded bg-slate-950 px-1 font-mono">~hi~</code> <s className="text-slate-200">strike</s></span>
                      <span><code className="rounded bg-slate-950 px-1 font-mono">`hi`</code> <span className="font-mono text-slate-200">mono</span></span>
                      <span className="col-span-2"><code className="rounded bg-slate-950 px-1 font-mono">#</code> <b className="text-slate-200">Heading</b> · <code className="rounded bg-slate-950 px-1 font-mono">##</code> smaller · <code className="rounded bg-slate-950 px-1 font-mono">###</code> smallest</span>
                      <span className="col-span-2"><code className="rounded bg-slate-950 px-1 font-mono">-</code> or <code className="rounded bg-slate-950 px-1 font-mono">*</code> dot list · <code className="rounded bg-slate-950 px-1 font-mono">1.</code> numbered · <code className="rounded bg-slate-950 px-1 font-mono">&gt;</code> quote</span>
                    </div>
                    <p className="px-4 text-[10px] text-slate-500">New lines: Shift+Enter on desktop, the Enter key on phones. Separate list items with a line break.</p>
                  </div>
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
                  {!blockedAny && reqBlocked && friendState === 'none' && (
                    <div className="flex w-full cursor-not-allowed items-center gap-3 px-4 py-3 text-sm text-slate-500">
                      <UserPlus size={17} className="text-slate-600" /> Requests unavailable (declined 3×)
                    </div>
                  )}
                  {!blockedAny && !reqBlocked && friendState === 'none' && (
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

      {/* ── User card (tap partner name/avatar) ─────────────── */}
      {cardOpen && !persona && other && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setCardOpen(false)}>
          <div role="dialog" aria-label={`${otherName} profile`} onClick={(e) => e.stopPropagation()}
            className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto overscroll-contain overflow-x-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex items-center gap-4 border-b border-slate-800 bg-slate-950/60 p-5">
              <Avatar name={otherName} online={otherOnline} large />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{otherName}</p>
                <p className={`text-xs ${otherOnline ? 'text-emerald-300' : 'text-slate-500'}`}>{otherOnline ? 'Online' : presenceLabel || 'Offline'}</p>
              </div>
              <button aria-label="Close" onClick={() => setCardOpen(false)} className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-800 hover:text-white"><X size={17} /></button>
            </div>
            {other.profile_visible === false ? (
              <p className="p-5 text-sm text-slate-400">This profile is private.</p>
            ) : (
              <div className="grid gap-2 p-5">
                {!!other.bio && (
                  <p className="text-sm leading-relaxed text-slate-300">{other.bio}</p>
                )}
                {!!other.age_band_visible && !!other.age_band && (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm"><Cake size={16} className="flex-none text-cyan-300" /> Age band: {AGE_BAND_LABELS[other.age_band] ?? other.age_band}</div>
                )}
                {!!other.generation_visible && !!other.generation && (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm"><Sparkles size={16} className="flex-none text-cyan-300" /> Generation: {GEN_LABELS[other.generation] ?? other.generation}</div>
                )}
                {!!other.gender_visible && !!other.gender && (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm"><User size={16} className="flex-none text-cyan-300" /> Gender: {GENDER_LABELS[other.gender] ?? other.gender}</div>
                )}
                {(!!other.region_visible || !!other.country_visible) && !!other.country_code && (() => {
                  const continent = getRegionForCountry(other.country_code)
                  const country = getCountryName(other.country_code)
                  const hasRegion = !!continent && !!other.region_visible
                  const hasCountry = !!country && !!other.country_visible
                  if (!hasRegion && !hasCountry) return null
                  const label = hasRegion && hasCountry
                    ? `Region: ${REGION_LABELS[continent!] ?? continent} · ${country}`
                    : hasRegion
                      ? `Region: ${REGION_LABELS[continent!] ?? continent}`
                      : `Country: ${country}`
                  return (
                    <div className="flex items-center gap-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm"><Globe size={16} className="flex-none text-cyan-300" /> {label}</div>
                  )
                })()}
                {!!other.orientation && other.gender === 'non_binary' && (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm"><Heart size={16} className="flex-none text-cyan-300" /> Orientation: {other.orientation}</div>
                )}
                {!!other.language_visible && !!other.chat_language && (
                  <div className="flex items-center gap-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm"><Languages size={16} className="flex-none text-cyan-300" /> Chat language: {LANG_LABELS[other.chat_language] ?? other.chat_language}</div>
                )}
                {!!other.languages_known_visible && otherLanguages.length > 0 && (
                  <div className="flex items-start gap-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm"><Languages size={16} className="mt-0.5 flex-none text-cyan-300" /> <span><span className="font-semibold">Languages: </span>{otherLanguages.map((v) => LANG_LABELS[v] ?? v).join(', ')}</span></div>
                )}
                {!!other.interests_visible && otherInterests.length > 0 && (
                  <div className="flex items-start gap-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm"><Sparkles size={16} className="mt-0.5 flex-none text-cyan-300" /> <span><span className="font-semibold">Interests: </span>{otherInterests.join(', ')}</span></div>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t border-slate-800 p-5 pt-4">
              {!blockedAny && reqBlocked && friendState === 'none' && (
                <span className="flex cursor-not-allowed items-center gap-2 rounded-xl border border-slate-800 px-4 py-2.5 text-sm text-slate-500"><UserPlus size={15} className="text-slate-600" /> Requests off (3× declined)</span>
              )}
              {!blockedAny && !reqBlocked && friendState === 'none' && (
                <button onClick={() => void friendAction('send')} className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold transition hover:border-cyan-400 hover:text-cyan-200"><UserPlus size={15} /> Add friend</button>
              )}
              {!blockedAny && friendState === 'outgoing' && (
                <button onClick={() => void friendAction('cancel')} className="flex items-center gap-2 rounded-xl border border-amber-700/60 bg-amber-950/30 px-4 py-2.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-900/40"><Clock size={15} /> Cancel request</button>
              )}
              {!blockedAny && friendState === 'incoming' && (
                <button onClick={() => void friendAction('send')} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-400"><UserCheck size={15} /> Accept request</button>
              )}
              {!blockedAny && friendState === 'friends' && (
                <button onClick={() => void friendAction('unfriend')} className="flex items-center gap-2 rounded-xl border border-red-800/60 bg-red-950/30 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-900/40"><UserMinus size={15} /> Unfriend</button>
              )}
              <button onClick={() => { setCardOpen(false); inputRef.current?.focus() }} className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:brightness-110">💬 Chat</button>
              <button onClick={onBlockRowClick} className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${blockedByMe ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40' : 'border-red-800/60 bg-red-950/30 text-red-300 hover:bg-red-900/40'}`}>
                <Ban size={15} /> {blockedByMe ? 'Unblock' : 'Block'}
              </button>
              <button onClick={() => setReportOpen((v) => !v)} className="flex items-center gap-2 rounded-xl border border-red-800/60 bg-red-950/30 px-4 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-900/40">
                <ShieldAlert size={15} /> Report
              </button>
            </div>
            {reportOpen && (
              <div className="space-y-2 border-t border-slate-800 bg-slate-950/60 p-4">
                <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs">
                  {REPORT_REASONS.map((r) => <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>)}
                </select>
                <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} placeholder="Optional details" className="h-16 w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs" />
                <button onClick={() => void submitReport()} className="w-full rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-400">Submit report</button>
              </div>
            )}
            {blockChoiceOpen && (
              <div className="border-t border-slate-800 bg-slate-950/60 p-4">
                <p className="mb-2 text-xs text-slate-300">You are friends with {otherName}. Block and also remove them as a friend?</p>
                <div className="flex gap-2">
                  <button onClick={() => void doBlock(true)} className="flex-1 rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-400">Block & unfriend</button>
                  <button onClick={() => void doBlock(false)} className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800">Just block</button>
                  <button onClick={() => setBlockChoiceOpen(false)} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-400 hover:text-white">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {incomingReq && (
        <div className="relative z-10 mx-auto w-full max-w-3xl px-3 pt-3">
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
        <div className="relative z-10 mx-auto w-full max-w-3xl px-3">
          <p className={`pt-2 text-xs ${blockedByMe ? 'text-red-300' : 'text-emerald-300'}`}>
            {blockedByMe ? 'You blocked this user. Use the ⋮ menu to unblock.' : statusLine}
          </p>
        </div>
      )}

      {/* ── Messages ───────────────────────────────────────── */}
      <div ref={scrollRef} className="relative z-10 mx-auto min-h-0 w-full max-w-3xl flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4 text-left">
        {loading && (
            <div aria-busy="true" className="space-y-3 pt-2">
              {[['62%','justify-end'],['45%','justify-start'],['68%','justify-end'],['40%','justify-start'],['56%','justify-end']].map(([w,side],i)=>(
                <div key={i} className={`flex ${side}`}>
                  <Shimmer className={`h-11 rounded-2xl ${side==='justify-end'?'rounded-br-md':'rounded-bl-md'}`} style={{width:w}} />
                </div>
              ))}
            </div>
          )}
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
          // Receiver hid their own copy → tombstone on their side only.
          const hiddenForMe = !mine && !!m.deleted_by_receiver_at && !deleted
          const body = autoTranslate && m.translated_message ? m.translated_message : m.original_message
          const translatedShown = autoTranslate && !!m.translated_message
          const replied = m.reply_to_message_id ? messages.find((x) => x.id === m.reply_to_message_id) : null
          const rawDx = drag?.id === m.id ? drag.dx : 0
          const dragDx = Math.max(-36, Math.min(36, rawDx))
          const dragging = rawDx !== 0
          const reactions = Object.entries(m.reactions ?? {}).filter(([, users]) => users.length > 0)
          return (
            <div key={m.id} id={`msg-${m.id}`} className="w-full scroll-mt-20">
              {showDay && (
                <div className="py-2 text-center">
                  <span className="rounded-full bg-slate-800/80 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">{dayLabel(m.created_at)}</span>
                </div>
              )}
              <div className={`flex w-full px-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`group relative flex w-fit max-w-[86%] flex-col ${mine ? 'items-end' : 'items-start'} ${reactions.length > 0 ? 'min-w-[13rem]' : ''}`}>
                  <div
                    role={hiddenForMe ? undefined : 'button'} tabIndex={hiddenForMe ? -1 : 0} aria-label="Message options"
                    onPointerDown={(e) => { if (!hiddenForMe) startPress(m, e) }}
                    onPointerMove={(e) => { if (!hiddenForMe) movePress(m, e) }}
                    onPointerUp={() => finishPress(m, Date.now())}
                    onPointerCancel={() => finishPress(m, Date.now(), true)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !hiddenForMe) setActionsMsg({ msg: m, canEdit: m.sender_id === userId }) }}
                    onContextMenu={(e) => e.preventDefault()}
                    style={{ transform: `translateX(${dragDx}px)`, touchAction: 'pan-y' }}
                    className={`relative w-fit max-w-full select-none rounded-2xl px-3.5 py-2 shadow-sm ${mine ? 'rounded-br-md bg-gradient-to-br from-cyan-500 to-cyan-400 text-slate-950' : 'rounded-bl-md bg-slate-800 text-slate-100'} ${deleted || hiddenForMe ? 'italic opacity-70' : ''} ${dragging ? '' : 'transition-transform duration-150 ease-out'}`}
                  >
                    {replied && (
                      <div
                        role="button" tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); const el = document.getElementById(`msg-${replied.id}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight-msg'); setTimeout(() => el.classList.remove('highlight-msg'), 1500) } }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onPointerUp={(e) => e.stopPropagation()}
                        onPointerMove={(e) => e.stopPropagation()}
                        onPointerCancel={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.click() }}
                        className={`mb-1.5 cursor-pointer rounded-lg border-l-[3px] px-2 py-1 transition hover:brightness-110 ${mine ? 'border-slate-900/40 bg-black/10' : 'border-cyan-400/70 bg-black/20'}`}
                      >
                        <p className={`text-[11px] font-semibold ${mine ? 'text-slate-900/80' : 'text-cyan-300'}`}>{labelFor(replied)}</p>
                        <p className={`line-clamp-2 text-left text-xs ${mine ? 'text-slate-900/70' : 'text-slate-400'}`}>{replied.deleted_at ? 'This message was deleted' : replied.original_message}</p>
                      </div>
                    )}
                    {/* Laptop-only hover affordances (like WhatsApp Web): a
                        smile button that opens ONLY the reaction emojis, and
                        a chevron that opens the full options sheet. Touch
                        devices keep tap = sheet / hold = select text. */}
                    <div className={`absolute top-1/2 z-10 hidden -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:hover)]:flex ${mine ? '-left-[4.6rem]' : '-right-[4.6rem]'}`}>
                      {!deleted && !hiddenForMe && (
                        <button type="button" aria-label="React" onClick={(e) => { e.stopPropagation(); setReactFor(reactFor === m.id ? null : m.id); setActionsMsg(null) }}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-slate-300 shadow ring-1 ring-slate-700 transition hover:text-cyan-200 hover:ring-cyan-400/50">
                          <SmilePlus size={15} />
                        </button>
                      )}
                      <button type="button" aria-label="Message options" onClick={(e) => { e.stopPropagation(); setReactFor(null); setActionsMsg({ msg: m, canEdit: m.sender_id === userId && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS }) }}
                        className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-slate-300 shadow ring-1 ring-slate-700 transition hover:text-cyan-200 hover:ring-cyan-400/50">
                        <ChevronDown size={15} />
                      </button>
                    </div>
                    {/* Reaction-only picker for the smile hover button. */}
                    {reactFor === m.id && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setReactFor(null)} />
                        <div className={`absolute bottom-full z-30 mb-1 grid grid-cols-6 gap-0.5 rounded-2xl border border-slate-700 bg-slate-900 p-1.5 shadow-xl ${mine ? 'right-0' : 'left-0'}`}>
                          {QUICK_EMOJIS.map((emoji) => {
                            const mineAlready = m.reactions?.[emoji]?.includes(userId ?? '') ?? false
                            return (
                              <button key={emoji} type="button" onClick={(e) => { e.stopPropagation(); void toggleReaction(m, emoji) }}
                                title={mineAlready ? 'Remove your reaction' : 'React'}
                                className={`flex h-9 w-9 items-center justify-center rounded-full text-lg transition hover:scale-110 ${mineAlready ? 'bg-cyan-400/25 ring-2 ring-cyan-400' : ''}`}>
                                {emoji}
                              </button>
                            )
                          })}
                        </div>
                      </>
                    )}
                    {deleted || hiddenForMe ? (
                      <p className="flex items-center gap-1.5 text-[14px] text-slate-400">
                        <Ban size={14} /> {hiddenForMe ? 'You deleted this message' : 'This message was deleted'}
                      </p>
                    ) : (
                      <RichText text={body} className="text-[15px] leading-relaxed [overflow-wrap:anywhere]" />
                    )}
                    <p className={`mt-0.5 flex items-center justify-end gap-1 text-right text-[10px] ${mine ? 'text-slate-900/60' : 'text-slate-500'}`}>
                      {!deleted && !hiddenForMe && translatedShown && <span className="italic">translated ·</span>}
                      {!deleted && !hiddenForMe && m.edited_at && <span className="italic">edited ·</span>}
                      {mine && m.deleted_by_receiver_at && !deleted && <span className="italic">deleted by receiver ·</span>}
                      {!hiddenForMe && <span>{formatTime(m.created_at)}</span>}
                      {mine && !deleted && (
                        isSeen(m)
                          ? <CheckCheck size={13} strokeWidth={2.5} className="self-center text-sky-300 drop-shadow-[0_1px_1px_rgba(15,23,42,0.6)]" aria-label="Seen" />
                          : isDelivered(m)
                            ? <CheckCheck size={13} strokeWidth={2.5} className="self-center text-white drop-shadow-[0_1px_1px_rgba(15,23,42,0.6)]" aria-label="Delivered" />
                            : <Check size={13} strokeWidth={2.5} className="self-center opacity-50" aria-label="Sent" />
                      )}
                    </p>
                  </div>

                  {!hiddenForMe && reactions.length > 0 && (
                    <div className={`mt-1 flex flex-wrap items-center gap-1 ${mine ? 'justify-end pr-1' : 'justify-start pl-1'}`}>
                      {reactions.map(([emoji, users]) => (
                        <button key={emoji}
                          onClick={() => void toggleReaction(m, emoji)}
                          onPointerDown={(e) => { e.stopPropagation(); endPress(); chipPressTimer.current = window.setTimeout(() => void showReactors(m, emoji), 420) }}
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

      {error && <p className="mx-auto w-full max-w-3xl px-3 pb-2 text-xs text-red-300">{error}</p>}

      {/* ── Composer ───────────────────────────────────────── */}
      <form ref={formRef} onSubmit={send} className="relative z-10 flex-none border-t border-slate-800 bg-slate-900 px-3 pt-2"
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
          {emojiOpen && !blockedAny && <EmojiPicker onPick={insertEmoji} />}
          <div className="flex items-end gap-2">
            {blockedAny ? (
              <p className="w-full py-2 text-center text-sm text-slate-500">
                {blockedByMe ? 'You blocked this user — unblock from the ⋮ menu to chat again.' : 'You cannot message this user.'}
              </p>
            ) : (
              <>
                <button type="button" aria-label="Emoji" aria-expanded={emojiOpen}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setEmojiOpen((v) => !v)}
                  className={`flex h-11 w-11 flex-none items-center justify-center rounded-full transition active:scale-95 ${emojiOpen ? 'bg-cyan-400/20 text-cyan-300' : 'text-slate-400 hover:bg-cyan-400/10 hover:text-cyan-200'}`}>
                  <Smile size={22} />
                </button>
                <textarea ref={inputRef} value={text} onChange={(e) => onTextChange(e.target.value)} maxLength={2000} autoFocus rows={1}
                  onTouchStart={() => { kbTouchRef.current = true; setVirtualKb(true) }}
                  onKeyDown={(e) => {
                    // Enter sends on desktop · Shift+Enter adds a line.
                    // On touch devices the keyboard's Enter IS the newline
                    // key (virtual keyboards have no Shift+Enter) — sending
                    // happens via the Send button.
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      if (e.shiftKey || kbTouchRef.current) insertNewline()
                      else formRef.current?.requestSubmit()
                    }
                  }}
                  name="message" autoComplete="off" inputMode="text" enterKeyHint={virtualKb ? 'enter' : 'send'}
                  data-1p-ignore data-lpignore="true" data-bwignore data-form-fill-ignore
                  placeholder={composerMode === 'edit' ? 'Edit your message…' : 'Type a message…'}
                  className="min-w-0 flex-1 resize-none overflow-y-auto rounded-3xl border border-slate-700 bg-slate-950 px-5 py-3 text-[15px] leading-relaxed outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" />
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
      {showScrollDown && !composerQuote && !emojiOpen && (
        <button onClick={scrollToLatest} aria-label={`Scroll to latest${unreadCount ? `, ${unreadCount} new` : ''}`}
          className="absolute bottom-[86px] right-[max(16px,calc(50%-24rem+16px))] z-10 flex h-11 w-11 items-center justify-center rounded-full border border-slate-700 bg-slate-800/95 shadow-xl transition hover:bg-slate-700 active:scale-95">
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
              <button onClick={() => { setReplyTo(actionsMsg.msg); setEditing(null); setActionsMsg(null); inputRef.current?.focus({ preventScroll: true }) }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition hover:bg-slate-800">
                <CornerUpLeft size={17} className="text-cyan-300" /> Reply
              </button>
              {!actionsMsg.msg.deleted_at && (
                <button onClick={() => copyMessage(actionsMsg.msg)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition hover:bg-slate-800">
                  <Copy size={17} className="text-cyan-300" /> Copy text
                </button>
              )}
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
              {actionsMsg.msg.sender_id !== userId && !actionsMsg.msg.deleted_at && !actionsMsg.msg.deleted_by_receiver_at && (
                <button onClick={() => void deleteForMe(actionsMsg.msg)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-red-300 transition hover:bg-red-950/40">
                  <Trash2 size={17} /> Delete for me
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
