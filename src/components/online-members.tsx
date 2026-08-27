'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, MessageCircle, Search, UserCheck, UserMinus, UserPlus, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/errors'
import { resolveIdentity } from '@/lib/identity'
import { Shimmer } from '@/components/shimmer'

const ONLINE_WINDOW_MS = 20 * 1000

export type OnlineMember = {
  id: string
  display_name: string | null
  level: number | null
  country_code: string | null
  country_visible: boolean
  chat_language: string | null
  gender: string | null
  gender_visible: boolean
  age_band: string | null
  age_band_visible: boolean
  generation: string | null
  generation_visible: boolean
  last_active_at: string | null
  interests_visible?: boolean
  interest_names?: string[] | null
}

type RequestState = 'none' | 'outgoing' | 'incoming' | 'friends'
type FilterGender = 'all' | 'woman' | 'man' | 'non_binary'
type FilterAge = 'all' | '18_20' | '21_29' | '30_44' | '45_59' | '60_plus'
type FilterGeneration = 'all' | 'gen_alpha' | 'gen_z' | 'millennial' | 'gen_x' | 'boomer'
type FilterRegion = 'all' | 'asia' | 'europe' | 'africa' | 'north_america' | 'south_america' | 'oceania'

const GENDER_FILTERS: readonly (readonly [FilterGender, string])[] = [['all', 'All'], ['woman', 'Women'], ['man', 'Men'], ['non_binary', 'Non-binary']]
const AGE_FILTERS: readonly (readonly [FilterAge, string])[] = [['all', 'All ages'], ['18_20', '18–20'], ['21_29', '21–29'], ['30_44', '30–44'], ['45_59', '45–59'], ['60_plus', '60+']]
const GEN_FILTERS: readonly (readonly [FilterGeneration, string])[] = [['all', 'All'], ['gen_z', 'Gen Z'], ['millennial', 'Millennial'], ['gen_x', 'Gen X'], ['boomer', 'Boomer']]
const REGION_FILTERS: readonly (readonly [FilterRegion, string])[] = [['all', 'All regions'], ['asia', 'Asia'], ['europe', 'Europe'], ['africa', 'Africa'], ['north_america', 'N. America'], ['south_america', 'S. America'], ['oceania', 'Oceania']]

const REGION_MAP: Record<string, string[]> = {
  africa: ['DZ','AO','BJ','BW','BF','BI','CV','CM','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW'],
  asia: ['AF','AM','AZ','BH','BD','BT','BN','KH','CN','CY','GE','IN','ID','IR','IQ','IL','JP','JO','KZ','KW','KG','LA','LB','MY','MV','MN','MM','NP','KP','OM','PK','PH','QA','SA','SG','KR','LK','SY','TW','TJ','TH','TL','TR','TM','AE','UZ','VN','YE'],
  europe: ['AL','AD','AT','BY','BE','BA','BG','HR','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','UA','GB'],
  north_america: ['AG','BS','BB','BZ','CA','CR','CU','DM','DO','SV','GD','GT','HT','HN','JM','MX','NI','PA','KN','LC','VC','TT','US'],
  south_america: ['AR','BO','BR','CL','CO','EC','GY','PY','PE','SR','UY','VE'],
  oceania: ['AU','FJ','KI','MH','FM','NR','NZ','PW','PG','WS','SB','TO','TV','VU'],
}

function getRegionForCountry(code: string | null): string | null {
  if (!code) return null
  const upper = code.toUpperCase()
  for (const [region, countries] of Object.entries(REGION_MAP)) {
    if (countries.includes(upper)) return region
  }
  return null
}

function FilterPill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-medium transition ${selected ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'}`}>
      {children}
    </button>
  )
}

function formatTimeAgo(ts: string | null): string {
  if (!ts) return ''
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (secs < 10) return 'just now'
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function OnlineSkeleton() {
  return (
    <div aria-busy="true" className="space-y-1">
      {/* Search bar shimmer */}
      <Shimmer className="h-10 w-full rounded-xl" />
      {/* Filter bar shimmer */}
      <div className="mt-3 flex gap-2">
        <Shimmer className="h-6 w-16 rounded-full" />
        <Shimmer className="h-6 w-14 rounded-full" />
        <Shimmer className="h-6 w-16 rounded-full" />
      </div>
      {/* Member rows shimmer */}
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-1 py-3 sm:px-2">
          <Shimmer className="h-12 w-12 flex-none rounded-full sm:h-14 sm:w-14" />
          <div className="flex-1 space-y-2">
            <Shimmer className="h-3.5 w-28 rounded sm:w-36" />
            <Shimmer className="h-3 w-20 rounded sm:w-24" />
          </div>
          <div className="flex flex-none gap-1.5">
            <Shimmer className="h-8 w-8 rounded-full" />
            <Shimmer className="h-8 w-8 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function OnlineMembers({ members: initialMembers, loading: serverLoading }: { members: OnlineMember[]; loading?: boolean }) {
  const router = useRouter()
  const [members, setMembers] = useState<OnlineMember[]>(initialMembers)
  const [states, setStates] = useState<Record<string, RequestState>>({})
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [confirmUnfriend, setConfirmUnfriend] = useState<{ id: string; name: string } | null>(null)
  const [blockedPairs, setBlockedPairs] = useState<Set<string>>(new Set())
  const [reqBlockedIds, setReqBlockedIds] = useState<Set<string>>(new Set())
  const [userId, setUserId] = useState<string | null>(null)
  const userIdRef = useRef<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterGender, setFilterGender] = useState<FilterGender>('all')
  const [filterAge, setFilterAge] = useState<FilterAge>('all')
  const [filterGen, setFilterGen] = useState<FilterGeneration>('all')
  const [filterRegion, setFilterRegion] = useState<FilterRegion>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [clientReady, setClientReady] = useState(false)

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
      userIdRef.current = user.id
      const { data: blocks } = await supabase.from('blocks').select('blocker_id,blocked_id').or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`)
      if (active && blocks) setBlockedPairs(new Set(blocks.flatMap((b) => [`${b.blocker_id}|${b.blocked_id}`, `${b.blocked_id}|${b.blocker_id}`])))
      const { data: declined } = await supabase.from('friend_requests').select('receiver_id').eq('sender_id', user.id).eq('status', 'declined')
      if (active && declined) {
        const counts: Record<string, number> = {}
        for (const row of declined as { receiver_id: string }[]) counts[row.receiver_id] = (counts[row.receiver_id] ?? 0) + 1
        setReqBlockedIds(new Set(Object.keys(counts).filter((k) => counts[k] >= 3)))
      }
      const { data } = await supabase.from('friend_requests').select('sender_id,receiver_id,status').or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).in('status', ['pending', 'accepted'])
      if (!active || !data) return
      const next: Record<string, RequestState> = {}
      for (const row of data as { sender_id: string; receiver_id: string; status: string }[]) {
        const otherId = row.sender_id === user.id ? row.receiver_id : row.sender_id
        next[otherId] = row.status === 'accepted' ? 'friends' : row.sender_id === user.id ? 'outgoing' : 'incoming'
      }
      setStates(next)
      setClientReady(true)
    })()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    let active = true

    const MEMBER_COLS = 'id,display_name,level,country_code,country_visible,chat_language,gender,gender_visible,age_band,age_band_visible,generation,generation_visible,last_active_at,interests_visible,interest_names'

    async function fetchOnlineMembers(): Promise<OnlineMember[]> {
      const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString()
      const { data } = await supabase.from('profiles')
        .select(MEMBER_COLS)
        .eq('online_visible', true)
        .neq('id', userIdRef.current ?? '')
        .gt('last_active_at', since)
        .order('last_active_at', { ascending: false })
        .limit(100)
      return (data ?? []) as OnlineMember[]
    }

    // Realtime: instant add/remove when payload has full row data
    const channel = supabase.channel('online-directory')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        if (!active) return
        const row = payload.new as Record<string, any>
        const now = Date.now()
        const ts = row.last_active_at ?? null
        const isOnline = row.online_visible !== false && !!ts && (now - new Date(ts).getTime()) < ONLINE_WINDOW_MS
        setMembers((prev) => {
          const exists = prev.some((m) => m.id === row.id)
          if (!isOnline && exists) return prev.filter((m) => m.id !== row.id)
          if (isOnline && !exists && ts) {
            void supabase.from('profiles').select(MEMBER_COLS).eq('id', row.id).maybeSingle().then(({ data }) => {
              if (active && data) setMembers((cur) => [...cur, data as OnlineMember])
            })
            return prev
          }
          if (isOnline && exists && ts) return prev.map((m) => m.id === row.id ? { ...m, ...row, last_active_at: ts } : m)
          return prev
        })
      }).subscribe()

    // Polling fallback: every 5 seconds, sync the full online list
    // This ensures presence works even if Realtime delivery is broken.
    async function poll() {
      if (!active) return
      const fresh = await fetchOnlineMembers()
      if (!active) return
      setMembers((prev) => {
        const prevMap = new Map(prev.map((m) => [m.id, m]))
        const freshMap = new Map(fresh.map((m) => [m.id, m]))
        const prevIds = new Set(prev.map((m) => m.id))
        const freshIds = new Set(fresh.map((m) => m.id))
        let changed = false
        const next: OnlineMember[] = []
        for (const m of fresh) {
          const old = prevMap.get(m.id)
          if (!old || old.last_active_at !== m.last_active_at) changed = true
          next.push(old && old.last_active_at === m.last_active_at ? old : m)
        }
        if (prevIds.size !== freshIds.size) changed = true
        else for (const id of prevIds) if (!freshIds.has(id)) { changed = true; break }
        return changed ? next : prev
      })
    }

    const pollIv = window.setInterval(poll, 5_000)
    void poll()

    return () => { active = false; window.clearInterval(pollIv); void supabase.removeChannel(channel) }
  }, [])

  async function openChat(memberId: string) {
    if (openingId) return
    setOpeningId(memberId); setError('')
    const supabase = createClient()
    const { data, error: rpcError } = await supabase.rpc('start_direct_chat', { p_other_profile_id: memberId })
    setOpeningId(null)
    if (rpcError) { setError(friendlyError(rpcError, 'Could not open the chat. Please try again.')); return }
    router.push(`/chat/${data as string}`)
  }

  const filtered = members.filter((m) => {
    if (blockedPairs.has(`${userId}|${m.id}`) || blockedPairs.has(`${m.id}|${userId}`)) return false
    if (search) {
      const q = search.toLowerCase()
      const name = (m.display_name ?? '').toLowerCase()
      const country = (m.country_code ?? '').toLowerCase()
      if (!name.includes(q) && !country.includes(q)) return false
    }
    if (filterGender !== 'all' && m.gender !== filterGender) return false
    if (filterAge !== 'all' && m.age_band !== filterAge) return false
    if (filterGen !== 'all' && m.generation !== filterGen) return false
    if (filterRegion !== 'all' && getRegionForCountry(m.country_code) !== filterRegion) return false
    return true
  })

  const hasActiveFilters = filterGender !== 'all' || filterAge !== 'all' || filterGen !== 'all' || filterRegion !== 'all'

  if (serverLoading || (!clientReady && initialMembers.length === 0)) {
    return <OnlineSkeleton />
  }

  return (
    <>
      {/* Search bar */}
      <div className="relative mt-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or country…"
          className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2.5 pl-9 pr-9 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/60" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Filter toggle + active count */}
      <div className="mt-3 flex items-center gap-2">
        <button onClick={() => setShowFilters(!showFilters)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition ${showFilters || hasActiveFilters ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" /></svg>
          Filters
          {hasActiveFilters && <span className="ml-0.5 h-4 w-4 rounded-full bg-cyan-400 text-[9px] font-bold text-slate-950 flex items-center justify-center">{[filterGender !== 'all', filterAge !== 'all', filterGen !== 'all', filterRegion !== 'all'].filter(Boolean).length}</span>}
        </button>
        {hasActiveFilters && (
          <button onClick={() => { setFilterGender('all'); setFilterAge('all'); setFilterGen('all'); setFilterRegion('all') }}
            className="text-[11px] text-slate-500 hover:text-white">Clear all</button>
        )}
        <span className="ml-auto text-[11px] text-slate-500">{filtered.length} online</span>
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
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Age</span>
            <div className="flex flex-wrap gap-1.5">
              {AGE_FILTERS.map(([v, l]) => <FilterPill key={v} selected={filterAge === v} onClick={() => setFilterAge(v)}>{l}</FilterPill>)}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Generation</span>
            <div className="flex flex-wrap gap-1.5">
              {GEN_FILTERS.map(([v, l]) => <FilterPill key={v} selected={filterGen === v} onClick={() => setFilterGen(v)}>{l}</FilterPill>)}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Region</span>
            <div className="flex flex-wrap gap-1.5">
              {REGION_FILTERS.map(([v, l]) => <FilterPill key={v} selected={filterRegion === v} onClick={() => setFilterRegion(v)}>{l}</FilterPill>)}
            </div>
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}

      {/* Member list — WhatsApp style */}
      <div className="mt-2 divide-y divide-slate-800/60">
        {filtered.map((m) => {
          const state = states[m.id] ?? 'none'
          const busy = openingId === m.id
          const identity = resolveIdentity(m)
          return (
            <div key={m.id}
              onClick={() => openChat(m.id)}
              className="flex cursor-pointer items-center gap-3 px-1 py-3 transition hover:bg-slate-900/40 sm:px-2">
              {/* Avatar */}
              <div className="relative h-12 w-12 flex-none overflow-hidden rounded-full bg-gradient-to-br from-cyan-600 to-cyan-400 sm:h-14 sm:w-14">
                <span className="flex h-full w-full items-center justify-center text-lg font-bold text-white sm:text-xl">
                  {(m.display_name ?? '?')[0]?.toUpperCase() ?? '?'}
                </span>
                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-slate-950 bg-emerald-400" />
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`truncate text-sm font-semibold ${identity.colorClass}`}>{identity.label}</span>
                  {m.level != null && m.level > 1 && (
                    <span className="flex-none rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">L{m.level}</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                  {m.chat_language && <span>{m.chat_language.toUpperCase()}</span>}
                  {m.chat_language && m.country_visible && m.country_code && <span>·</span>}
                  {m.country_visible && m.country_code && <span>{m.country_code}</span>}
                  {(m.chat_language || (m.country_visible && m.country_code)) && <span>·</span>}
                  <span>{formatTimeAgo(m.last_active_at)}</span>
                </div>
                {m.interests_visible && !!m.interest_names?.length && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.interest_names.slice(0, 3).map((name) => (
                      name ? <span key={name} className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[10px] text-slate-400">{name}</span> : null
                    ))}
                    {m.interest_names.length > 3 && <span className="text-[10px] text-slate-600">+{m.interest_names.length - 3}</span>}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-none items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                {state === 'friends' ? (
                  <button title="Friends" onClick={() => setConfirmUnfriend({ id: m.id, name: identity.label })}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300 transition hover:bg-red-500/20 hover:text-red-300">
                    <UserCheck size={15} />
                  </button>
                ) : state === 'outgoing' ? (
                  <button title="Pending" onClick={() => void friendAction(m.id, 'cancel')}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400/10 text-amber-300">
                    <Clock size={15} />
                  </button>
                ) : reqBlockedIds.has(m.id) ? (
                  <button disabled className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full border border-slate-800 text-slate-600">
                    <UserPlus size={15} />
                  </button>
                ) : (
                  <button title={state === 'incoming' ? 'Accept from Friends' : 'Add friend'} disabled={state === 'incoming'}
                    onClick={() => { if (state === 'none') void friendAction(m.id, 'send') }}
                    className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${state === 'incoming' ? 'cursor-not-allowed border-slate-800 text-slate-600' : 'border-slate-700 text-cyan-300 hover:border-cyan-400 hover:bg-cyan-400/10'}`}>
                    <UserPlus size={15} />
                  </button>
                )}
                <button title="Chat" onClick={() => void openChat(m.id)} disabled={busy}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 text-slate-300 transition hover:border-cyan-400 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:opacity-50">
                  <MessageCircle size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {filtered.length === 0 && !error && (
        <p className="mt-8 text-center text-sm text-slate-500">
          {hasActiveFilters || search ? 'No one matches your filters.' : 'No one else is online right now.'}
        </p>
      )}

      <ConfirmDialog open={!!confirmUnfriend} title={`Unfriend ${confirmUnfriend?.name ?? ''}?`}
        message="You will no longer be friends. You can always send a new friend request later."
        confirmLabel="Unfriend" onCancel={() => setConfirmUnfriend(null)}
        onConfirm={() => { const c = confirmUnfriend; setConfirmUnfriend(null); if (c) void friendAction(c.id, 'unfriend') }} />
    </>
  )
}
