'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  findBestMatch,
  getMatchedConversation,
  getQueueCount,
  getMatchPreferences,
  joinMatchQueue,
  leaveMatchQueue,
  renewMatchQueue,
  updateMatchPreferences,
  type MatchFilterOverrides,
} from '@/lib/matching'
import { friendlyError } from '@/lib/errors'
import { ZapChatButton } from '@/components/zap-chat-button'
import { AdsterraBanner } from '@/components/adsterra-banner'
import { useRouter } from 'next/navigation'
import { AppHeader } from '@/components/app-header'
import { createClient } from '@/lib/supabase/client'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'

const GENDERS = [
  ['woman', 'Women'], ['man', 'Men'], ['non_binary', 'Non-binary'],
] as const
const GENERATIONS = [
  ['gen_alpha', 'Gen Alpha'], ['gen_z', 'Gen Z'], ['millennial', 'Millennial'], ['gen_x', 'Gen X'], ['boomer', 'Boomer'],
] as const
const AGE_BANDS = [
  ['18_20', '18–20'], ['21_29', '21–29'], ['30_44', '30–44'], ['45_59', '45–59'], ['60_plus', '60+'],
] as const
const CONTINENTS = [
  ['africa', 'Africa'], ['asia', 'Asia'], ['europe', 'Europe'], ['north_america', 'N. America'], ['south_america', 'S. America'], ['oceania', 'Oceania'],
] as const
const LANGUAGES_CORE = [
  ['ar', 'Arabic (العربية)'], ['en', 'English'], ['fr', 'French (Français)'], ['de', 'German (Deutsch)'], ['gu', 'Gujarati (ગુજરાતી)'],
  ['hi', 'Hindi (हिन्दी)'], ['kn', 'Kannada (ಕನ್ನಡ)'], ['kk', 'Kazakh (Қазақ)'], ['km', 'Khmer (ខ្មែរ)'], ['ml', 'Malayalam (മലയാളം)'],
  ['mr', 'Marathi (मराठी)'], ['ne', 'Nepali (नेपाली)'], ['ps', 'Pashto (پښتو)'], ['fa', 'Persian (فارسی)'], ['pa', 'Punjabi (ਪੰਜਾਬੀ)'],
  ['sd', 'Sindhi (سنڌي)'], ['si', 'Sinhala (සිංහල)'], ['es', 'Spanish (Español)'], ['tr', 'Turkish (Türkçe)'], ['ur', 'Urdu (اردو)'], ['uz', 'Uzbek (O‘zbek)'],
] as const
const LANGUAGES_EXTRA = [
  ['sq', 'Albanian (Shqip)'], ['bn', 'Bengali (বাংলা)'], ['bg', 'Bulgarian (Български)'], ['zh_cn', 'Chinese (Simplified) (中文)'],
  ['hr', 'Croatian (Hrvatski)'], ['cs', 'Czech (Čeština)'], ['da', 'Danish (Dansk)'], ['nl', 'Dutch (Nederlands)'], ['et', 'Estonian (Eesti)'],
  ['fi', 'Finnish (Suomi)'], ['el', 'Greek (Ελληνικά)'], ['he', 'Hebrew (עברית)'], ['hu', 'Hungarian (Magyar)'], ['ig', 'Igbo'],
  ['id', 'Indonesian (Bahasa Indonesia)'], ['it', 'Italian (Italiano)'], ['ja', 'Japanese (日本語)'], ['ko', 'Korean (한국어)'], ['lv', 'Latvian (Latviešu)'],
  ['lt', 'Lithuanian (Lietuvių)'], ['mk', 'Macedonian (Македонски)'], ['ms', 'Malay (Bahasa Melayu)'], ['mn', 'Mongolian (Монгол)'], ['no', 'Norwegian (Norsk)'],
  ['pl', 'Polish (Polski)'], ['pt', 'Portuguese (Português)'], ['ro', 'Romanian (Română)'], ['ru', 'Russian (Русский)'], ['sr', 'Serbian (Српски)'],
  ['sk', 'Slovak (Slovenčina)'], ['sl', 'Slovenian (Slovenščina)'], ['sw', 'Swahili (Kiswahili)'], ['sv', 'Swedish (Svenska)'], ['tl', 'Tagalog'],
  ['th', 'Thai (ไทย)'], ['uk', 'Ukrainian (Українська)'], ['vi', 'Vietnamese (Tiếng Việt)'], ['yo', 'Yoruba (Yorùbá)'],
] as const

const RELAX_ORDER: (keyof MatchFilterOverrides)[] = [
  'preferred_continents', 'preferred_languages', 'preferred_orientations',
  'preferred_generations', 'preferred_age_bands', 'preferred_genders', 'preferred_interests',
]

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${selected ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/50' : 'border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-500'}`}>
      {children}
    </button>
  )
}

function FilterSection({ label, hint, options, values, onToggle }: {
  label: string; hint?: string; options: readonly (readonly [string, string])[]; values: string[]; onToggle: (v: string) => void
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-slate-300">{label}</span>
      {hint && <p className="mb-1.5 text-[10px] text-slate-500">{hint}</p>}
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => (
          <Pill key={v} selected={values.includes(v)} onClick={() => onToggle(v)}>{l}</Pill>
        ))}
      </div>
    </div>
  )
}

function toggleIn(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

function filtersActiveCount(f: MatchFilterOverrides) {
  let n = 0
  if (f.preferred_genders?.length) n++
  if (f.preferred_generations?.length) n++
  if (f.preferred_age_bands?.length) n++
  if (f.preferred_continents?.length) n++
  if (f.preferred_languages?.length) n++
  if (f.preferred_orientations?.length) n++
  if (f.preferred_interests?.length) n++
  return n
}

export default function MatchPage() {
  const router = useRouter()
  const [waiting, setWaiting] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [matched, setMatched] = useState<{ conversationId: string } | null>(null)
  const [message, setMessage] = useState('')
  const [queueCount, setQueueCount] = useState<number | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<MatchFilterOverrides>({
    preferred_genders: [], preferred_generations: [], preferred_age_bands: [],
    preferred_continents: [], preferred_languages: [], preferred_orientations: [],
    preferred_interests: [],
  })
  const [filtersLoading, setFiltersLoading] = useState(true)
  const [relaxStep, setRelaxStep] = useState(0)
  const [waitMode, setWaitMode] = useState<5 | 10 | 15 | 30 | 45 | 60>(5)
  const [relaxing, setRelaxing] = useState(false)
  const [showAllLangs, setShowAllLangs] = useState(false)
  const [interestCatalog, setInterestCatalog] = useState<readonly (readonly [string, string])[]>([])
  const relaxStepRef = useRef(0)
  const waitModeRef = useRef(waitMode)
  waitModeRef.current = waitMode
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const originalFiltersRef = useRef<MatchFilterOverrides>({})

  // Load saved preferences + interest catalog on mount
  useEffect(() => {
    let active = true
    void (async () => {
      const [data, catalogData] = await Promise.all([
        getMatchPreferences(),
        createClient().from('interests').select('slug,name').eq('active', true),
      ])
      if (!active) return
      if (data) {
        setFilters({
          preferred_genders: (data.preferred_genders as string[]) ?? [],
          preferred_generations: (data.preferred_generations as string[]) ?? [],
          preferred_age_bands: (data.preferred_age_bands as string[]) ?? [],
          preferred_continents: (data.preferred_continents as string[]) ?? [],
          preferred_languages: (data.preferred_languages as string[]) ?? [],
          preferred_orientations: (data.preferred_orientations as string[]) ?? [],
          preferred_interests: (data.preferred_interests as string[]) ?? [],
        })
        setWaitMode(([5, 10, 15, 30, 45, 60].includes(data.interest_wait_seconds as number) ? data.interest_wait_seconds as number : 5) as 5 | 10 | 15 | 30 | 45 | 60)
      }
      if (catalogData.data) {
        setInterestCatalog(catalogData.data.map((r) => [r.slug, r.name] as const))
      }
      setFiltersLoading(false)
    })()
    return () => { active = false }
  }, [])

  // Live realtime queue count
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel('match-queue-live')
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'match_queue' }, () => {
      void getQueueCount().then((c) => { if (c !== null) setQueueCount(c) })
    }).subscribe()
    void getQueueCount().then((c) => { if (c !== null) setQueueCount(c) })
    const sweep = window.setInterval(() => {
      void getQueueCount().then((c) => { if (c !== null) setQueueCount(c) })
    }, 8000)
    return () => { window.clearInterval(sweep); supabase.removeChannel(channel) }
  }, [])

  // Progressive relaxation: drop one filter category at a time
  const applyRelaxStep = useCallback(async (step: number) => {
    if (step >= RELAX_ORDER.length) return
    const key = RELAX_ORDER[step]
    const updated = { ...filtersRef.current, [key]: [] as string[] }
    filtersRef.current = updated
    setFilters(updated)
    await updateMatchPreferences({ [key]: [] })
  }, [])

  // Put the user's saved filters back after a match/cancel so relaxing one
  // session never permanently wipes their preferences in the DB or the UI.
  const restoreOriginalFilters = useCallback(() => {
    const original = originalFiltersRef.current
    const restored = {
      preferred_genders: original.preferred_genders ?? [],
      preferred_generations: original.preferred_generations ?? [],
      preferred_age_bands: original.preferred_age_bands ?? [],
      preferred_continents: original.preferred_continents ?? [],
      preferred_languages: original.preferred_languages ?? [],
      preferred_orientations: original.preferred_orientations ?? [],
      preferred_interests: original.preferred_interests ?? [],
    }
    filtersRef.current = restored
    setFilters(restored)
    void updateMatchPreferences(restored)
  }, [])

  // Main polling + relaxation timer
  useEffect(() => {
    if (!waiting) return
    relaxStepRef.current = 0
    let tick = 0
    const timer = window.setInterval(async () => {
      tick += 1
      setSeconds((v) => v + 1)

      const result = await findBestMatch()
      if ('conversationId' in result) {
        window.clearInterval(timer)
        setWaiting(false); setRelaxing(false)
        restoreOriginalFilters()
        setMatched({ conversationId: result.conversationId })
        return
      }
      const partnerMatch = await getMatchedConversation()
      if (partnerMatch) {
        window.clearInterval(timer)
        setWaiting(false); setRelaxing(false)
        restoreOriginalFilters()
        setMatched({ conversationId: partnerMatch })
        return
      }
      if (tick % 8 === 0) await renewMatchQueue()
      if (tick % 4 === 0) {
        const count = await getQueueCount()
        if (count !== null) setQueueCount(count)
      }

      // Progressive relaxation
      const wm = waitModeRef.current
      if (tick === wm) setRelaxing(true)
      if (tick > wm) {
        const relaxTick = tick - wm
        const interval = Math.max(1, Math.round(wm / 5))
        if (relaxTick % interval === 0) {
          const step = Math.floor((relaxTick - 1) / interval) + 1
          if (step <= RELAX_ORDER.length && step > relaxStepRef.current) {
            relaxStepRef.current = step
            setRelaxStep(step)
            await applyRelaxStep(step - 1)
          }
        }
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [waiting, applyRelaxStep, restoreOriginalFilters])

  // Auto-enter chat on match
  useEffect(() => {
    if (!matched) return
    const t = window.setTimeout(() => router.replace(`/chat/${matched.conversationId}`), 900)
    return () => window.clearTimeout(t)
  }, [matched, router])

  async function start() {
    setMessage('')
    originalFiltersRef.current = { ...filtersRef.current }
    setRelaxStep(0); setRelaxing(false)
    await updateMatchPreferences(filtersRef.current)
    const result = await joinMatchQueue()
    if ('error' in result) {
      setMessage(friendlyError(result.error, 'Unable to enter the matching queue.'))
      return
    }
    setSeconds(0)
    setMatched(null)
    setWaiting(true)
  }

  async function cancel() {
    const result = await leaveMatchQueue()
    if ('error' in result) setMessage(friendlyError(result.error, 'Unable to leave the matching queue.'))
    setWaiting(false); setRelaxing(false); setRelaxStep(0)
    relaxStepRef.current = 0
    restoreOriginalFilters()
  }

  const activeFilters = filtersActiveCount(filters)
  const totalRelaxSteps = RELAX_ORDER.length
  const langs = showAllLangs ? [...LANGUAGES_CORE, ...LANGUAGES_EXTRA] : LANGUAGES_CORE

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppHeader title="Match" icon="radar" />
      <div className="mx-auto max-w-xl w-full px-4 pb-12 pt-4">
        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center">
          <p className="text-sm font-semibold text-cyan-300">⚡ ShahZap Match</p>
          {matched ? (
            <>
              <h1 className="mt-2 text-2xl font-bold">Match found! 🎉</h1>
              <p className="mt-3 text-slate-400">Opening your private chat…</p>
              <div className="mx-auto mt-8 h-16 w-16 animate-pulse rounded-full border-4 border-cyan-400/50" />
              <button onClick={() => router.replace(`/chat/${matched.conversationId}`)} className="mt-8 rounded-xl bg-cyan-400 px-8 py-4 font-bold text-slate-950">Enter chat now</button>
            </>
          ) : (
            <>
              <h1 className="mt-2 text-xl font-bold">Find someone to chat with</h1>
              <p className="mt-3 text-slate-400 text-sm">Safety and compatibility first, then preferences, interests, language and region.</p>

              {/* Live searchers indicator */}
              {queueCount !== null && queueCount > 0 ? (
                <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-800/60 bg-emerald-950/40 px-4 py-1.5 text-xs font-semibold text-emerald-300">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                  {queueCount} {queueCount === 1 ? 'person is' : 'people are'} looking right now
                </p>
              ) : queueCount === 0 ? (
                <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-800/40 px-4 py-1.5 text-xs font-semibold text-slate-400">
                  <span className="h-2 w-2 rounded-full bg-slate-500" />
                  No one else is looking right now
                </p>
              ) : null}

              {waiting ? (
                <>
                  <div className="mx-auto mt-8 h-24 w-24 animate-pulse rounded-full border-4 border-cyan-400/50" />

                  {/* Relaxation progress bar */}
                  {relaxing && totalRelaxSteps > 0 && (
                    <div className="mx-auto mt-4 max-w-xs">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full bg-cyan-400 transition-all duration-500"
                          style={{ width: `${Math.min((relaxStep / totalRelaxSteps) * 100, 100)}%` }} />
                      </div>
                      <p className="mt-1.5 text-[10px] text-slate-500">Relaxing filters ({relaxStep}/{totalRelaxSteps})</p>
                    </div>
                  )}

                  <p className="mt-4 font-semibold">Looking for a compatible person…</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {relaxing ? `Relaxing filters — ${seconds}s` : `Waiting ${seconds}s — strict matching`}
                  </p>

                  {/* Active filter chips during search */}
                  {activeFilters > 0 && (
                    <p className="mt-2 text-[10px] text-slate-500">
                      {activeFilters} filter{activeFilters > 1 ? 's' : ''} active{relaxing ? ` · dropping every ${Math.max(1, Math.round(waitMode / 5))}s` : ''}
                    </p>
                  )}

                  <button onClick={cancel} className="mt-6 rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold">Cancel</button>
                  {seconds >= 15 && (
                    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950 p-5 text-left">
                      <p className="text-sm font-semibold">{queueCount === 0 ? 'Nobody else is looking right now.' : 'Still searching for the best match…'}</p>
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{queueCount === 0 ? 'Matching pairs two people who are here at the same moment — invite a friend, or try a practice chat while you wait.' : 'We pair safety-first; a wider search may need another moment.'}</p>
                      <ZapChatButton cancelQueue label="⚡ Practice chat with ZapBot" className="mt-4 w-full" />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Filter panel toggle */}
                  <button onClick={() => setShowFilters(!showFilters)}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white">
                    <SlidersHorizontal size={16} />
                    Filters
                    {activeFilters > 0 && (
                      <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">{activeFilters}</span>
                    )}
                    <ChevronDown size={14} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Collapsible filter panel */}
                  {showFilters && !filtersLoading && (
                    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-left space-y-4">
                      <FilterSection label="Gender" options={GENDERS} values={filters.preferred_genders ?? []}
                        onToggle={(v) => setFilters((c) => ({ ...c, preferred_genders: toggleIn(c.preferred_genders ?? [], v) }))} />
                      <FilterSection label="Generation" options={GENERATIONS} values={filters.preferred_generations ?? []}
                        onToggle={(v) => setFilters((c) => ({ ...c, preferred_generations: toggleIn(c.preferred_generations ?? [], v) }))} />
                      <FilterSection label="Age band" options={AGE_BANDS} values={filters.preferred_age_bands ?? []}
                        onToggle={(v) => setFilters((c) => ({ ...c, preferred_age_bands: toggleIn(c.preferred_age_bands ?? [], v) }))} />
                      <FilterSection label="Continent" options={CONTINENTS} values={filters.preferred_continents ?? []}
                        onToggle={(v) => setFilters((c) => ({ ...c, preferred_continents: toggleIn(c.preferred_continents ?? [], v) }))} />

                      {/* Language filter with expand */}
                      <div>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-300">Language</span>
                        <div className="flex flex-wrap gap-1.5">
                          {langs.map(([v, l]) => (
                            <Pill key={v} selected={(filters.preferred_languages ?? []).includes(v)}
                              onClick={() => setFilters((c) => ({ ...c, preferred_languages: toggleIn(c.preferred_languages ?? [], v) }))}>
                              {l}
                            </Pill>
                          ))}
                        </div>
                        <button onClick={() => setShowAllLangs(!showAllLangs)} className="mt-2 text-[10px] text-cyan-400 hover:underline">
                          {showAllLangs ? 'Show less' : `Show all ${LANGUAGES_CORE.length + LANGUAGES_EXTRA.length} languages`}
                        </button>
                      </div>

                      {/* Interests filter */}
                      {interestCatalog.length > 0 && (
                        <FilterSection
                          label="Interests"
                          hint="Match people who share these interests — makes conversations better!"
                          options={interestCatalog}
                          values={filters.preferred_interests ?? []}
                          onToggle={(v) => setFilters((c) => ({ ...c, preferred_interests: toggleIn(c.preferred_interests ?? [], v) }))} />
                      )}

                      <p className="text-[10px] text-slate-500">Leave all empty = open to everyone instantly.</p>

                      {/* Wait time selector */}
                      <div>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-300">Wait before relaxing</span>
                        <div className="flex flex-wrap gap-2">
                          <Pill selected={waitMode === 5} onClick={() => setWaitMode(5)}>5s</Pill>
                          <Pill selected={waitMode === 10} onClick={() => setWaitMode(10)}>10s</Pill>
                          <Pill selected={waitMode === 15} onClick={() => setWaitMode(15)}>15s</Pill>
                          <Pill selected={waitMode === 30} onClick={() => setWaitMode(30)}>30s</Pill>
                          <Pill selected={waitMode === 45} onClick={() => setWaitMode(45)}>45s</Pill>
                          <Pill selected={waitMode === 60} onClick={() => setWaitMode(60)}>60s</Pill>
                        </div>
                        <p className="mt-1 text-[10px] text-slate-500">
                          Strict match for {waitMode}s, then drop one filter every {Math.max(1, Math.round(waitMode / 5))}s.
                        </p>
                      </div>
                    </div>
                  )}

                  <button onClick={start} className="mt-6 rounded-xl bg-cyan-400 px-8 py-4 font-bold text-slate-950">Start matching</button>
                </>
              )}
            </>
          )}
          {message && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{message}</p>}
        </section>

        <div className="mt-5 flex justify-center">
          <AdsterraBanner size="300x250" />
        </div>
      </div>
    </main>
  )
}
