'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/errors'
import { useRouter } from 'next/navigation'
import { resolveIdentity } from '@/lib/identity'
import { AppHeader } from '@/components/app-header'
import { Shimmer } from '@/components/shimmer'
import { FriendContextMenu } from '@/components/friend-context-menu'

const ONLINE_WINDOW_MS = 20 * 1000
const TYPING_WINDOW_MS = 5000
const POLL_MS = 3000

type Request = { id: string; sender_id: string; receiver_id: string; status: string; created_at: string; updated_at: string }
type Profile = { id: string; display_name: string | null; avatar_path: string | null; age_band: string | null; generation: string | null; country_code: string | null; profile_visible: boolean; gender: string | null; gender_visible: boolean; last_active_at: string | null; online_visible: boolean | null }
type FriendWithMeta = Profile & {
  lastMessage: string | null
  lastMessageTime: string | null
  lastSenderId: string | null
  lastMessageId: string | null
  conversationId: string | null
  isOnline: boolean
  unreadCount: number
  isTyping: boolean
  partnerLastReadAt: string | null
  lastMessageDeliveredAt: string | null
  lastMessageReadAt: string | null
  friendSince: string | null
  isBlocked: boolean
}
type Tab = 'friends' | 'pending'
type FilterGender = 'all' | 'woman' | 'man' | 'non_binary'
type FilterRegion = 'all' | 'asia' | 'europe' | 'africa' | 'north_america' | 'south_america' | 'oceania'
type FilterActivity = 'all' | 'sent' | 'received'

const REGION_MAP: Record<string, string[]> = {
  africa: ['DZ','AO','BJ','BW','BF','BI','CV','CM','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW'],
  asia: ['AF','AM','AZ','BH','BD','BT','BN','KH','CN','CY','GE','IN','ID','IR','IQ','IL','JP','JO','KZ','KW','KG','LA','LB','MY','MV','MN','MM','NP','KP','OM','PK','PH','QA','SA','SG','KR','LK','SY','TW','TJ','TH','TL','TR','TM','AE','UZ','VN','YE'],
  europe: ['AL','AD','AT','BY','BE','BA','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','UA','GB'],
  north_america: ['AG','BS','BB','BZ','CA','CR','CU','DM','DO','SV','GD','GT','HT','HN','JM','MX','NI','PA','KN','LC','VC','TT','US'],
  south_america: ['AR','BO','BR','CL','CO','EC','GY','PY','PE','SR','UY','VE'],
  oceania: ['AU','FJ','KI','MH','FM','NR','NZ','PW','PG','WS','SB','TO','TV','VU'],
}
const REGION_LABELS: Record<string, string> = { africa: 'Africa', asia: 'Asia', europe: 'Europe', north_america: 'N. America', south_america: 'S. America', oceania: 'Oceania' }

function getRegionForCountry(code: string | null): string | null {
  if (!code) return null
  const upper = code.toUpperCase()
  for (const [region, countries] of Object.entries(REGION_MAP)) {
    if (countries.includes(upper)) return region
  }
  return null
}

const GENDER_FILTERS: readonly (readonly [FilterGender, string])[] = [['all', 'All'], ['woman', 'Women'], ['man', 'Men'], ['non_binary', 'Non-binary']]
const REGION_FILTERS: readonly (readonly [FilterRegion, string])[] = [['all', 'All regions'], ['asia', 'Asia'], ['europe', 'Europe'], ['africa', 'Africa'], ['north_america', 'N. America'], ['south_america', 'S. America'], ['oceania', 'Oceania']]

function FilterPill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-medium transition ${selected ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
      {children}
    </button>
  )
}

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
      <Shimmer className="h-10 w-full rounded-xl" />
      <div className="mt-3 flex gap-2">
        <Shimmer className="h-6 w-14 rounded-full" />
        <Shimmer className="h-6 w-16 rounded-full" />
        <Shimmer className="h-6 w-12 rounded-full" />
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

function TickIcon({ delivered, read }: { delivered: boolean; read: boolean }) {
  if (read) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-cyan-400">
        <path d="M18 6 7 17l-5-5" /><path d="m22 10-9.5 9.5L10 17" />
      </svg>
    )
  }
  if (delivered) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-white">
        <path d="M18 6 7 17l-5-5" /><path d="m22 10-9.5 9.5L10 17" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-slate-500">
      <path d="M20 6 9 17l-5-5" />
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
    const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : (a.friendSince ? new Date(a.friendSince).getTime() : 0)
    const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : (b.friendSince ? new Date(b.friendSince).getTime() : 0)
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

  const [search, setSearch] = useState('')
  const [filterGender, setFilterGender] = useState<FilterGender>('all')
  const [filterRegion, setFilterRegion] = useState<FilterRegion>('all')
  const [filterActivity, setFilterActivity] = useState<FilterActivity>('all')
  const [filterUnread, setFilterUnread] = useState(false)
  const [filterOnline, setFilterOnline] = useState(false)
  const [showFilters, setShowFilters] = useState(false)

  const friendsRef = useRef(friends)
  friendsRef.current = friends
  const convToFriendRef = useRef<Record<string, string>>({})
  const friendToConvRef = useRef<Record<string, string>>({})
  const userIdRef = useRef<string>('')
  const aliveRef = useRef(true)

  const hasActiveFilters = filterGender !== 'all' || filterRegion !== 'all' || filterActivity !== 'all' || filterUnread || filterOnline

  // ---- initial load ----
  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      if (mounted) { setUserId(user.id); userIdRef.current = user.id }

      const { data: reqs, error: reqError } = await supabase.from('friend_requests')
        .select('id,sender_id,receiver_id,status,created_at,updated_at')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
      if (reqError) { if (mounted) { setError(friendlyError(reqError, 'Could not load friend data.')); setLoading(false) } return }

      const visible = (reqs ?? []) as Request[]
      const accepted = visible.filter((r) => r.status === 'accepted')
      const friendIds = accepted.map((r) => r.sender_id === user.id ? r.receiver_id : r.sender_id)
      const friendSinceMap: Record<string, string> = {}
      for (const r of accepted) {
        const friendId = r.sender_id === user.id ? r.receiver_id : r.sender_id
        friendSinceMap[friendId] = r.updated_at
      }

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
        lastMessageId: string | null; conversationId: string | null; unreadCount: number; partnerLastReadAt: string | null;
        lastMessageDeliveredAt: string | null; lastMessageReadAt: string | null; friendSince: string | null
      }> = {}

      convToFriendRef.current = {}
      friendToConvRef.current = {}

      // Fetch blocks involving me
      const blockedIds = new Set<string>()
      if (friendIds.length) {
        const { data: blocks } = await supabase.from('blocks')
          .select('blocker_id,blocked_id')
          .or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`)
        if (blocks) {
          for (const b of blocks) {
            blockedIds.add(b.blocker_id === user.id ? b.blocked_id : b.blocker_id)
          }
        }
      }

      if (friendIds.length) {
        const { data: myParts } = await supabase.from('conversation_participants')
          .select('conversation_id,last_read_at,conversations!inner(status)')
          .eq('profile_id', user.id)
          .eq('conversations.status', 'active')

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

            const candidateConvs: { convId: string; other: string }[] = []
            for (const [convId, participants] of Object.entries(partsByConv)) {
              if (participants.length === 2) {
                const other = participants.find((id) => id !== user.id)
                if (other && friendIds.includes(other)) {
                  candidateConvs.push({ convId, other })
                }
              }
            }

            const deduped: Record<string, { convId: string; other: string }> = {}
            for (const c of candidateConvs) {
              if (!deduped[c.other]) deduped[c.other] = c
            }

            for (const { convId, other } of Object.values(deduped)) {
              convToFriendRef.current[convId] = other
              friendToConvRef.current[other] = convId
              friendMeta[other] = {
                lastMessage: null, lastMessageTime: null, lastSenderId: null,
                lastMessageId: null, conversationId: convId, unreadCount: 0,
                partnerLastReadAt: partnerLastRead[convId] ?? null,
                lastMessageDeliveredAt: null, lastMessageReadAt: null,
                friendSince: friendSinceMap[other] ?? null,
              }
            }

            const activeConvIds = Object.keys(convToFriendRef.current)
            if (activeConvIds.length) {
              const { data: lastMsgs } = await supabase.from('messages')
                .select('id,original_message,created_at,sender_id,delivered_at,read_at,conversation_id')
                .in('conversation_id', activeConvIds)
                .order('created_at', { ascending: false })

              const latestByConv: Record<string, typeof lastMsgs extends (infer T)[] | null ? T : never> = {}
              if (lastMsgs) {
                for (const m of lastMsgs) {
                  if (!latestByConv[m.conversation_id]) latestByConv[m.conversation_id] = m
                }
              }

              for (const convId of activeConvIds) {
                const friendId = convToFriendRef.current[convId]
                if (!friendMeta[friendId]) continue
                const lastMsg = latestByConv[convId]
                if (lastMsg) {
                  friendMeta[friendId].lastMessage = lastMsg.original_message
                  friendMeta[friendId].lastMessageTime = lastMsg.created_at
                  friendMeta[friendId].lastSenderId = lastMsg.sender_id
                  friendMeta[friendId].lastMessageId = lastMsg.id
                  friendMeta[friendId].lastMessageDeliveredAt = lastMsg.delivered_at ?? null
                  friendMeta[friendId].lastMessageReadAt = lastMsg.read_at ?? null
                }
              }

              const { data: unreadRows } = await supabase.from('messages')
                .select('conversation_id')
                .in('conversation_id', activeConvIds)
                .neq('sender_id', user.id)
                .is('read_at', null)

              const unreadMap: Record<string, number> = {}
              if (unreadRows) {
                for (const row of unreadRows) {
                  unreadMap[row.conversation_id] = (unreadMap[row.conversation_id] ?? 0) + 1
                }
              }
              for (const convId of activeConvIds) {
                const friendId = convToFriendRef.current[convId]
                if (friendMeta[friendId]) {
                  friendMeta[friendId].unreadCount = unreadMap[convId] ?? 0
                }
              }
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
            lastMessageId: meta?.lastMessageId ?? null,
            conversationId: meta?.conversationId ?? null,
            isOnline,
            unreadCount: meta?.unreadCount ?? 0,
            isTyping: false,
            partnerLastReadAt: meta?.partnerLastReadAt ?? null,
            lastMessageDeliveredAt: meta?.lastMessageDeliveredAt ?? null,
            lastMessageReadAt: meta?.lastMessageReadAt ?? null,
            friendSince: meta?.friendSince ?? null,
            isBlocked: blockedIds.has(id),
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
        const msg = payload.new as { id: string; conversation_id: string; sender_id: string; original_message: string | null; created_at: string; delivered_at: string | null; read_at: string | null }
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
          f.lastMessageId = msg.id
          f.lastMessageDeliveredAt = msg.delivered_at
          f.lastMessageReadAt = msg.read_at
          if (msg.sender_id !== uid) {
            f.unreadCount = (f.unreadCount || 0) + 1
          }
          f.isTyping = false
          updated[idx] = f
          sortFriends(updated)
          return updated
        })
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, (payload) => {
        if (!aliveRef.current) return
        const msg = payload.new as { id: string; conversation_id: string; sender_id: string; delivered_at: string | null; read_at: string | null }
        const friendId = convToFriendRef.current[msg.conversation_id]
        if (!friendId) return
        setFriends((prev) => {
          const idx = prev.findIndex((f) => f.id === friendId)
          if (idx === -1) return prev
          const f = prev[idx]
          if (msg.id !== f.lastMessageId) return prev
          const updated = [...prev]
          updated[idx] = {
            ...f,
            lastMessageDeliveredAt: msg.delivered_at ?? f.lastMessageDeliveredAt,
            lastMessageReadAt: msg.read_at ?? f.lastMessageReadAt,
            unreadCount: msg.sender_id !== uid && msg.read_at ? 0 : f.unreadCount,
          }
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

  // ---- Realtime: friend_requests (instant pending tab updates) ----
  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    const uid = userIdRef.current

    const channel = supabase.channel('friends-requests-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friend_requests' }, async (payload) => {
        const row = payload.new as Request
        if (row.sender_id !== uid && row.receiver_id !== uid) return
        // Fetch profile for the other person
        const otherId = row.sender_id === uid ? row.receiver_id : row.sender_id
        const { data: p } = await supabase.from('profiles')
          .select('id,display_name,avatar_path,age_band,generation,country_code,profile_visible,gender,gender_visible,last_active_at,online_visible')
          .eq('id', otherId)
          .maybeSingle()
        if (p) setAllProfiles((prev) => ({ ...prev, [p.id]: p as Profile }))
        setRequests((prev) => [row, ...prev])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friend_requests' }, (payload) => {
        const row = payload.new as Request
        if (row.sender_id !== uid && row.receiver_id !== uid) return
        setRequests((prev) => prev.map((r) => r.id === row.id ? { ...r, status: row.status } : r))
        // If a previously accepted request changed to something else, unfriend
        if (row.status !== 'accepted') {
          const otherId = row.sender_id === uid ? row.receiver_id : row.sender_id
          setFriends((prev) => prev.filter((f) => f.id !== otherId))
          delete convToFriendRef.current[Object.keys(convToFriendRef.current).find((k) => convToFriendRef.current[k] === otherId) ?? '']
          delete friendToConvRef.current[otherId]
        }
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'friend_requests' }, (payload) => {
        const old = payload.old as { id: string }
        setRequests((prev) => {
          const deleted = prev.find((r) => r.id === old.id)
          if (deleted && deleted.status === 'accepted') {
            const otherId = deleted.sender_id === uid ? deleted.receiver_id : deleted.sender_id
            setFriends((prev) => prev.filter((f) => f.id !== otherId))
            delete convToFriendRef.current[Object.keys(convToFriendRef.current).find((k) => convToFriendRef.current[k] === otherId) ?? '']
            delete friendToConvRef.current[otherId]
          }
          return prev.filter((r) => r.id !== old.id)
        })
      })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [userId])

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

  // ---- Re-fetch last messages on visibility change / online ----
  useEffect(() => {
    if (!userId || !friends.length) return

    async function refreshLastMessages() {
      if (!aliveRef.current) return
      const supabase = createClient()
      const convIds = Object.keys(convToFriendRef.current)
      if (!convIds.length) return

      const { data: lastMsgs } = await supabase.from('messages')
        .select('id,original_message,created_at,sender_id,delivered_at,read_at,conversation_id')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })

      const { data: unreadRows } = await supabase.from('messages')
        .select('conversation_id')
        .in('conversation_id', convIds)
        .neq('sender_id', userId)
        .is('read_at', null)

      if (!aliveRef.current) return

      const latestByConv: Record<string, typeof lastMsgs extends (infer T)[] | null ? T : never> = {}
      if (lastMsgs) {
        for (const m of lastMsgs) {
          if (!latestByConv[m.conversation_id]) latestByConv[m.conversation_id] = m
        }
      }

      const unreadMap: Record<string, number> = {}
      if (unreadRows) {
        for (const row of unreadRows) {
          unreadMap[row.conversation_id] = (unreadMap[row.conversation_id] ?? 0) + 1
        }
      }

      setFriends((prev) => {
        let changed = false
        const next = prev.map((f) => {
          const convId = friendToConvRef.current[f.id]
          if (!convId) return f
          const lastMsg = latestByConv[convId]
          const newUnread = unreadMap[convId] ?? 0
          if (!lastMsg) return f
          const updates: Partial<typeof f> = {}
          if (lastMsg.id !== f.lastMessageId) {
            updates.lastMessage = lastMsg.original_message
            updates.lastMessageTime = lastMsg.created_at
            updates.lastSenderId = lastMsg.sender_id
            updates.lastMessageId = lastMsg.id
            updates.lastMessageDeliveredAt = lastMsg.delivered_at ?? null
            updates.lastMessageReadAt = lastMsg.read_at ?? null
            changed = true
          } else {
            if (lastMsg.delivered_at !== f.lastMessageDeliveredAt) { updates.lastMessageDeliveredAt = lastMsg.delivered_at ?? null; changed = true }
            if (lastMsg.read_at !== f.lastMessageReadAt) { updates.lastMessageReadAt = lastMsg.read_at ?? null; changed = true }
          }
          if (newUnread !== f.unreadCount) { updates.unreadCount = newUnread; changed = true }
          return Object.keys(updates).length ? { ...f, ...updates } : f
        })
        if (changed) sortFriends(next)
        return changed ? next : prev
      })
    }

    function onVisible() {
      if (document.visibilityState === 'visible') void refreshLastMessages()
    }
    function onOnline() { void refreshLastMessages() }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [userId, friends.length])

  async function updateRequest(id: string, status: 'accepted' | 'declined' | 'cancelled') {
    const supabase = createClient()
    const { error: updateError } = await supabase.from('friend_requests').update({ status }).eq('id', id)
    if (updateError) { setError(friendlyError(updateError, 'Could not update this request. Please try again.')); return }
    // Update local state instantly (Realtime will also fire but this is instant)
    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status } : r))
    // If accepted, refresh the friends list
    if (status === 'accepted') {
      const req = requests.find((r) => r.id === id)
      if (req) {
        const otherId = req.sender_id === userId ? req.receiver_id : req.sender_id
        const { data: p } = await supabase.from('profiles')
          .select('id,display_name,avatar_path,age_band,generation,country_code,profile_visible,gender,gender_visible,last_active_at,online_visible')
          .eq('id', otherId)
          .maybeSingle()
        if (p) setAllProfiles((prev) => ({ ...prev, [p.id]: p as Profile }))
        setFriends((prev) => {
          if (prev.some((f) => f.id === otherId)) return prev
          const profile = p as Profile | null
          if (!profile) return prev
          return [...prev, { ...profile, lastMessage: null, lastMessageTime: null, lastSenderId: null, lastMessageId: null, conversationId: null, isOnline: false, unreadCount: 0, isTyping: false, partnerLastReadAt: null, lastMessageDeliveredAt: null, lastMessageReadAt: null, friendSince: new Date().toISOString(), isBlocked: false }]
        })
      }
    }
  }

  const openChat = useCallback(async (profileId: string) => {
    if (openingId) return
    setOpeningId(profileId); setError('')
    const supabase = createClient()

    const { data, error: rpcError } = await supabase.rpc('start_direct_chat', { p_other_profile_id: profileId })
    if (rpcError) { setOpeningId(null); setError(friendlyError(rpcError, 'Could not open the chat. Please try again.')); return }

    const convId = data as string
    await supabase.rpc('mark_conversation_read', { p_conversation_id: convId })
    setFriends((prev) => prev.map((f) => f.id === profileId ? { ...f, unreadCount: 0, isTyping: false } : f))

    setOpeningId(null)
    router.push(`/chat/${convId}`)
  }, [openingId, router])

  const incoming = requests.filter((r) => r.status === 'pending' && r.receiver_id === userId)
  const outgoing = requests.filter((r) => r.status === 'pending' && r.sender_id === userId)
  const pendingCount = incoming.length + outgoing.length

  const filteredFriends = friends.filter((f) => {
    if (search) {
      const q = search.toLowerCase()
      const name = (f.display_name ?? '').toLowerCase()
      const gender = (f.gender ?? '').toLowerCase()
      const region = getRegionForCountry(f.country_code)
      if (!name.includes(q) && !gender.includes(q) && !(region && REGION_LABELS[region]?.toLowerCase().includes(q))) return false
    }
    if (filterGender !== 'all' && f.gender !== filterGender) return false
    if (filterRegion !== 'all' && getRegionForCountry(f.country_code) !== filterRegion) return false
    if (filterActivity === 'sent' && f.lastSenderId !== userId) return false
    if (filterActivity === 'received' && (f.lastSenderId === userId || !f.lastSenderId)) return false
    if (filterUnread && f.unreadCount === 0) return false
    if (filterOnline && !f.isOnline) return false
    return true
  })

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
                  <>
                    {/* Search bar */}
                    <div className="relative mt-3">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                      </svg>
                      <input
                        value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, gender, or region…"
                        className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 pl-9 pr-9 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/60" />
                      {search && (
                        <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                        </button>
                      )}
                    </div>

                    {/* Filter toggle + count */}
                    <div className="mt-3 flex items-center gap-2">
                      <button onClick={() => setShowFilters(!showFilters)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition ${showFilters || hasActiveFilters ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
                        Filters
                        {hasActiveFilters && <span className="ml-0.5 h-4 w-4 rounded-full bg-cyan-400 text-[9px] font-bold text-slate-950 flex items-center justify-center">{[filterGender !== 'all', filterRegion !== 'all', filterActivity !== 'all', filterUnread, filterOnline].filter(Boolean).length}</span>}
                      </button>
                      {hasActiveFilters && (
                        <button onClick={() => { setFilterGender('all'); setFilterRegion('all'); setFilterActivity('all'); setFilterUnread(false); setFilterOnline(false) }}
                          className="text-[11px] text-slate-500 hover:text-white">Clear all</button>
                      )}
                      <span className="ml-auto text-[11px] text-slate-500">{filteredFriends.length} friend{filteredFriends.length !== 1 ? 's' : ''}</span>
                    </div>

                    {/* Filter chips */}
                    {showFilters && (
                      <div className="mt-3 space-y-2.5 rounded-2xl border border-slate-800 bg-slate-900/50 p-3">
                        <div>
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Gender</span>
                          <div className="flex flex-wrap gap-1.5">
                            {GENDER_FILTERS.map(([v, l]) => <FilterPill key={v} selected={filterGender === v} onClick={() => setFilterGender(v)}>{l}</FilterPill>)}
                          </div>
                        </div>
                        <div>
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Region</span>
                          <div className="flex flex-wrap gap-1.5">
                            {REGION_FILTERS.map(([v, l]) => <FilterPill key={v} selected={filterRegion === v} onClick={() => setFilterRegion(v)}>{l}</FilterPill>)}
                          </div>
                        </div>
                        <div>
                          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Last Activity</span>
                          <div className="flex flex-wrap gap-1.5">
                            <FilterPill selected={filterActivity === 'all'} onClick={() => setFilterActivity('all')}>All</FilterPill>
                            <FilterPill selected={filterActivity === 'sent'} onClick={() => setFilterActivity('sent')}>Sent</FilterPill>
                            <FilterPill selected={filterActivity === 'received'} onClick={() => setFilterActivity('received')}>Received</FilterPill>
                          </div>
                        </div>
                        <div className="flex gap-3">
                          <FilterPill selected={filterUnread} onClick={() => setFilterUnread(!filterUnread)}>Unread</FilterPill>
                          <FilterPill selected={filterOnline} onClick={() => setFilterOnline(!filterOnline)}>Online</FilterPill>
                        </div>
                      </div>
                    )}

                    <div className="mt-1 divide-y divide-slate-800/60">
                      {filteredFriends.map((p) => {
                        const identity = resolveIdentity(p)
                        const busy = openingId === p.id
                        const isLastFromMe = p.lastSenderId === userId
                        const isRead = isLastFromMe && !!p.lastMessageReadAt
                        const isDelivered = isLastFromMe && !isRead && !!p.lastMessageDeliveredAt

                        return (
                          <FriendContextMenu key={p.id} friendId={p.id} friendName={p.display_name ?? 'Unknown'} isFriend={true} onAction={() => {}}>
                          <div
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
                                {p.isBlocked && <span className="text-[10px] font-medium text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded-full">Blocked</span>}
                              </div>
                              <div className="mt-0.5 flex items-center gap-1.5">
                                {p.isTyping ? (
                                  <div className="flex items-center gap-1.5">
                                    <TypingDots />
                                    <span className="text-xs text-cyan-400">typing...</span>
                                  </div>
                                ) : p.lastMessage ? (
                                  <>
                                    {isLastFromMe && <TickIcon delivered={!!isDelivered} read={!!isRead} />}
                                    <p className={`min-w-0 flex-1 truncate text-xs ${p.unreadCount > 0 ? 'font-semibold text-white' : 'text-slate-400'}`}>
                                      {isLastFromMe && <span className="text-slate-500">You: </span>}
                                      {p.lastMessage}
                                    </p>
                                  </>
                                ) : (
                                  <p className="min-w-0 flex-1 truncate text-xs text-slate-500">Start a conversation</p>
                                )}
                                {!p.isTyping && p.lastMessageTime && (
                                  <span className={`flex-none text-[10px] ${p.unreadCount > 0 ? 'font-semibold text-cyan-400' : 'text-slate-600'}`}>
                                    {formatTime(p.lastMessageTime)}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-none items-center gap-2">
                              {p.unreadCount > 0 && (
                                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-400 px-1.5 text-[10px] font-bold text-slate-950">
                                  {p.unreadCount}
                                </span>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); if (!busy) void openChat(p.id) }} disabled={busy}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 text-slate-300 transition hover:border-cyan-400 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:opacity-50">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                              </button>
                            </div>
                          </div>
                          </FriendContextMenu>
                        )
                      })}
                    </div>

                    {filteredFriends.length === 0 && (
                      <p className="mt-8 text-center text-sm text-slate-500">
                        {hasActiveFilters || search ? 'No friends match your filters.' : 'No friends yet.'}
                      </p>
                    )}
                  </>
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
