'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/errors'
import { AppHeader } from '@/components/app-header'
import { Shimmer } from '@/components/shimmer'
import { CONTINENTS, getCountriesForRegion, getRegionForCountry, getCountryName, REGION_LABELS } from '@/lib/regions'

const AGE_BANDS = [['18_20', '18–20'], ['21_29', '21–29'], ['30_44', '30–44'], ['45_59', '45–59'], ['60_plus', '60+']] as const
const LANGUAGES = [
  ['sq', 'Albanian'], ['ar', 'Arabic'], ['bn', 'Bengali'], ['bg', 'Bulgarian'],
  ['zh_cn', 'Chinese (Simplified)'], ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'],
  ['nl', 'Dutch'], ['en', 'English'], ['et', 'Estonian'], ['fi', 'Finnish'],
  ['fr', 'French'], ['de', 'German'], ['el', 'Greek'], ['gu', 'Gujarati'],
  ['he', 'Hebrew'], ['hi', 'Hindi'], ['hu', 'Hungarian'], ['ig', 'Igbo'],
  ['id', 'Indonesian'], ['it', 'Italian'], ['ja', 'Japanese'], ['kn', 'Kannada'],
  ['kk', 'Kazakh'], ['km', 'Khmer'], ['ko', 'Korean'], ['lv', 'Latvian'],
  ['lt', 'Lithuanian'], ['mk', 'Macedonian'], ['ms', 'Malay'], ['ml', 'Malayalam'],
  ['mr', 'Marathi'], ['mn', 'Mongolian'], ['ne', 'Nepali'], ['no', 'Norwegian'],
  ['ps', 'Pashto'], ['fa', 'Persian'], ['pl', 'Polish'], ['pt', 'Portuguese'],
  ['pa', 'Punjabi'], ['ro', 'Romanian'], ['ru', 'Russian'], ['sr', 'Serbian'],
  ['sd', 'Sindhi'], ['si', 'Sinhala'], ['sk', 'Slovak'], ['sl', 'Slovenian'],
  ['es', 'Spanish'], ['sw', 'Swahili'], ['sv', 'Swedish'], ['tl', 'Tagalog'],
  ['th', 'Thai'], ['tr', 'Turkish'], ['uk', 'Ukrainian'], ['ur', 'Urdu'],
  ['uz', 'Uzbek'], ['vi', 'Vietnamese'], ['yo', 'Yoruba'],
] as const
const LANG_MAP: Record<string, string> = Object.fromEntries(LANGUAGES)
const GENERATIONS = [['gen_z', 'Gen Z'], ['millennial', 'Millennial'], ['gen_x', 'Gen X'], ['boomer', 'Boomer']] as const
const GEN_MAP: Record<string, string> = Object.fromEntries(GENERATIONS)
const GENDERS = [['woman', 'Woman'], ['man', 'Man'], ['non_binary', 'Non-binary'], ['prefer_not_to_say', 'Prefer not to say']] as const
const GENDER_MAP: Record<string, string> = Object.fromEntries(GENDERS)
const INTERESTS = [
  ['music', 'Music'], ['movies', 'Movies'], ['gaming', 'Gaming'], ['anime', 'Anime'],
  ['sports', 'Sports'], ['technology', 'Technology'], ['books', 'Books'], ['travel', 'Travel'],
  ['food', 'Food'], ['art', 'Art'], ['fitness', 'Fitness'], ['memes', 'Memes'],
] as const
const LANGUAGES_I_KNOW = [...LANGUAGES] as const

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${selected ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/50' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}>
      {children}
    </button>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-3.5 text-left transition ${checked ? 'border-cyan-500/40 bg-cyan-950/20' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
      <span>
        <span className="block text-sm font-semibold text-white">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">{hint}</span>
      </span>
      <span className={`relative h-6 w-11 flex-none rounded-full transition ${checked ? 'bg-cyan-400' : 'bg-slate-700'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

export default function MyProfilePage() {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [ageBand, setAgeBand] = useState('21_29')
  const [gender, setGender] = useState('prefer_not_to_say')
  const [orientation, setOrientation] = useState('')
  const [generation, setGeneration] = useState('')
  const [bio, setBio] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [selectedRegion, setSelectedRegion] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [onlineVisible, setOnlineVisible] = useState(true)
  const [profileVisible, setProfileVisible] = useState(true)
  const [genderVisible, setGenderVisible] = useState(false)
  const [ageBandVisible, setAgeBandVisible] = useState(false)
  const [generationVisible, setGenerationVisible] = useState(false)
  const [countryVisible, setCountryVisible] = useState(false)
  const [regionVisible, setRegionVisible] = useState(false)
  const [languageVisible, setLanguageVisible] = useState(true)
  const [languagesKnownVisible, setLanguagesKnownVisible] = useState(false)
  const [interestsVisible, setInterestsVisible] = useState(false)
  const [languagesKnown, setLanguagesKnown] = useState<string[]>([])
  const [languageFilterEnabled, setLanguageFilterEnabled] = useState(false)

  function toggleInterest(v: string) {
    setInterests((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= 8 ? cur : [...cur, v]))
  }

  useEffect(() => {
    let active = true
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { window.location.href = '/'; return }
      const [{ data: profile }, { data: mine }, { data: catalog }, { data: mprefs }] = await Promise.all([
        supabase.from('profiles').select('display_name,age_band,gender,orientation,generation,bio,interface_language,chat_language,country_code,languages_known,online_visible,profile_visible,gender_visible,age_band_visible,generation_visible,country_visible,region_visible,language_visible,languages_known_visible,interests_visible').eq('id', user.id).maybeSingle(),
        supabase.from('profile_interests').select('interest_id').eq('profile_id', user.id),
        supabase.from('interests').select('id,slug').eq('active', true),
        supabase.from('match_preferences').select('preferred_languages,language_filter_enabled').eq('profile_id', user.id).maybeSingle(),
      ])
      if (!active) return
      if (profile) {
        setName(profile.display_name ?? '')
        setAgeBand(profile.age_band ?? '21_29')
        setGender(profile.gender ?? 'prefer_not_to_say')
        setOrientation(profile.orientation ?? '')
        setGeneration(profile.generation ?? '')
        setBio((profile as any).bio ?? '')
        const cc = (profile as { country_code?: string | null }).country_code
        setCountryCode(cc ?? '')
        setSelectedRegion(cc ? getRegionForCountry(cc) ?? '' : '')
        setOnlineVisible((profile as any).online_visible ?? true)
        setProfileVisible((profile as any).profile_visible ?? true)
        setGenderVisible((profile as any).gender_visible ?? false)
        setAgeBandVisible((profile as any).age_band_visible ?? false)
        setGenerationVisible((profile as any).generation_visible ?? false)
        setCountryVisible((profile as any).country_visible ?? false)
        setRegionVisible((profile as any).region_visible ?? false)
        setLanguageVisible((profile as any).language_visible ?? true)
        setLanguagesKnownVisible((profile as any).languages_known_visible ?? false)
        setInterestsVisible((profile as any).interests_visible ?? false)
        setLanguagesKnown((profile as any).languages_known ?? [])
      }
      if (mine && catalog) {
        const idToSlug = new Map(catalog.map((c) => [c.id, c.slug]))
        setInterests(mine.map((m) => idToSlug.get(m.interest_id)).filter((x): x is string => !!x))
      }
      if (mprefs) {
        setLanguageFilterEnabled((mprefs as any).language_filter_enabled ?? false)
      }
      if (active) setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [])

  async function save() {
    if (!name.trim()) { setError('Display name cannot be empty.'); return }
    setBusy(true); setError(''); setSaved(false)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Your session expired. Please sign in again.'); setBusy(false); return }
    const { error: e1 } = await supabase.from('profiles').update({
      display_name: name.trim().slice(0, 32),
      age_band: ageBand,
      gender: gender || null,
      orientation: orientation.trim().slice(0, 32) || null,
      generation: generation || null,
      bio: bio.trim().slice(0, 150) || null,
      country_code: countryCode || null,
      online_visible: onlineVisible,
      profile_visible: profileVisible,
      gender_visible: genderVisible,
      age_band_visible: ageBandVisible,
      generation_visible: generationVisible,
      country_visible: countryVisible,
      region_visible: regionVisible,
      language_visible: languageVisible,
      languages_known: languagesKnown,
      languages_known_visible: languagesKnownVisible,
      interests_visible: interestsVisible,
      interest_names: interests.map((v) => INTERESTS.find(([k]) => k === v)?.[1] ?? v),
    }).eq('id', user.id)
    if (e1) { setError(friendlyError(e1, 'Could not save your profile.')); setBusy(false); return }

    await supabase.from('match_preferences').upsert({
      profile_id: user.id,
      preferred_languages: languagesKnown,
      language_filter_enabled: languageFilterEnabled,
    }, { onConflict: 'profile_id' })

    await supabase.from('profile_interests').delete().eq('profile_id', user.id)
    if (interests.length) {
      const { data: rows } = await supabase.from('interests').select('id').in('slug', interests)
      if (rows?.length) {
        const { error: e2 } = await supabase.from('profile_interests').insert(rows.map((r) => ({ profile_id: user.id, interest_id: r.id })))
        if (e2) { setError(friendlyError(e2, 'Could not save your interests.')); setBusy(false); return }
      }
    }
    setSaved(true); setBusy(false)
  }

  const orientDisplay = gender === 'non_binary' ? orientation.trim() : ''

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppHeader title="My Profile" icon="user" />
      <div className="mx-auto max-w-2xl w-full px-4 pb-24 pt-4 md:pb-10 lg:max-w-4xl">
        <p className="text-xs leading-relaxed text-slate-500">Your identity details and how others see you.</p>

        {error && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
        {saved && <p className="mt-4 rounded-xl bg-emerald-950/40 p-3 text-sm text-emerald-200">Profile saved.</p>}

        {!loading && (
          <div className="mt-4 space-y-4">

            {/* 1. Preview card */}
            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
              <h2 className="text-[15px] font-semibold">Preview — how others see you</h2>
              <p className="mt-1 text-xs text-slate-500">This is your public profile card. Toggle visibility in Privacy below.</p>
              <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-cyan-300">⚡ ShahZap profile</p>
                    <h3 className="mt-1 text-2xl font-bold">{name || 'ShahZap user'}</h3>
                  </div>
                  {onlineVisible && <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">Online</span>}
                </div>
                {bio.trim() && <p className="mt-3 text-sm leading-relaxed text-slate-300">{bio.trim()}</p>}
                <div className="mt-4 grid gap-2">
                  {ageBandVisible && ageBand && <div className="rounded-xl bg-slate-900 p-2.5 text-sm">Age band: {ageBand.replace('_', '–')}</div>}
                  {generationVisible && generation && GEN_MAP[generation] && <div className="rounded-xl bg-slate-900 p-2.5 text-sm">Generation: {GEN_MAP[generation]}</div>}
                  {genderVisible && gender && GENDER_MAP[gender] && <div className="rounded-xl bg-slate-900 p-2.5 text-sm">Gender: {GENDER_MAP[gender]}</div>}
                  {regionVisible && countryCode && (() => {
                    const continent = getRegionForCountry(countryCode)
                    const country = getCountryName(countryCode)
                    const hasRegion = !!continent
                    const hasCountry = !!country && countryVisible
                    if (!hasRegion && !hasCountry) return null
                    const label = hasRegion && hasCountry
                      ? `Region: ${REGION_LABELS[continent!] ?? continent} · ${country}`
                      : hasRegion
                        ? `Region: ${REGION_LABELS[continent!] ?? continent}`
                        : `Country: ${country}`
                    return (
                      <div className="rounded-xl bg-slate-900 p-2.5 text-sm">{label}</div>
                    )
                  })()}
                  {!regionVisible && countryVisible && countryCode && (
                    <div className="rounded-xl bg-slate-900 p-2.5 text-sm">Country: {getCountryName(countryCode) ?? countryCode}</div>
                  )}
                  {orientDisplay && <div className="rounded-xl bg-slate-900 p-2.5 text-sm">Orientation: {orientDisplay}</div>}
                  {languagesKnownVisible && languagesKnown.length > 0 && (
                    <div className="rounded-xl bg-slate-900 p-2.5 text-sm">
                      <span className="font-semibold">Languages: </span>
                      <span className="text-slate-300">{languagesKnown.map((v) => LANG_MAP[v] ?? v).join(', ')}</span>
                    </div>
                  )}
                  {interestsVisible && interests.length > 0 && (
                    <div className="rounded-xl bg-slate-900 p-2.5 text-sm">
                      <span className="font-semibold">Interests: </span>
                      <span className="text-slate-300">{interests.map((v) => INTERESTS.find(([k]) => k === v)?.[1] ?? v).join(', ')}</span>
                    </div>
                  )}
                  {!ageBandVisible && !generationVisible && !genderVisible && !regionVisible && !interestsVisible && !orientDisplay && !languageVisible && !languagesKnownVisible && (
                    <p className="py-2 text-center text-sm text-slate-500">All fields hidden. Enable toggles in Privacy below to show them.</p>
                  )}
                </div>
              </div>
            </section>

            {/* 2. Identity */}
            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
              <h2 className="text-[15px] font-semibold">Identity</h2>
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold">Display name</span>
                  <input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="BlueSpark"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20" />
                </label>
                <div>
                  <span className="mb-2 block text-sm font-semibold">Age band</span>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {AGE_BANDS.map(([v, l]) => <Pill key={v} selected={ageBand === v} onClick={() => setAgeBand(v)}>{l}</Pill>)}
                  </div>
                </div>
                <div>
                  <span className="mb-2 block text-sm font-semibold">Gender</span>
                  <div className="grid grid-cols-2 gap-2">
                    {GENDERS.map(([v, l]) => <Pill key={v} selected={gender === v} onClick={() => setGender(v)}>{l}</Pill>)}
                  </div>
                </div>
                {gender === 'non_binary' && (
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold">Orientation <span className="font-normal text-slate-500">(optional)</span></span>
                    <input value={orientation} maxLength={32} onChange={(e) => setOrientation(e.target.value)} placeholder="Share only if you want to"
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20" />
                  </label>
                )}
                <div>
                  <span className="mb-2 block text-sm font-semibold">Bio <span className="font-normal text-slate-500">(optional · up to 30 words)</span></span>
                  <textarea value={bio} maxLength={150} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Tell people a little about yourself…"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 resize-none" />
                  <p className="mt-1 text-right text-xs text-slate-600">{bio.length}/150</p>
                </div>
                <div>
                  <span className="mb-2 block text-sm font-semibold">Generation <span className="font-normal text-slate-500">(optional)</span></span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Pill selected={generation === ''} onClick={() => setGeneration('')}>Any</Pill>
                    {GENERATIONS.map(([v, l]) => <Pill key={v} selected={generation === v} onClick={() => setGeneration(v)}>{l}</Pill>)}
                  </div>
                </div>
                <div>
                  <span className="mb-2 block text-sm font-semibold">Region <span className="font-normal text-slate-500">(optional)</span></span>
                  <p className="mb-3 text-xs text-slate-500">Your continent and country help people near you find you.</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {CONTINENTS.map(([v, l]) => (
                      <Pill key={v} selected={selectedRegion === v} onClick={() => { setSelectedRegion(v); setCountryCode('') }}>{l}</Pill>
                    ))}
                  </div>
                  {selectedRegion && (
                    <div className="mt-3">
                      <select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}
                        className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20">
                        <option value="">Select your country…</option>
                        {getCountriesForRegion(selectedRegion).map(([code, cName]) => (
                          <option key={code} value={code}>{cName}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {!selectedRegion && countryCode && (
                    <p className="mt-2 text-xs text-slate-500">Current: {getCountryName(countryCode)}</p>
                  )}
                </div>
              </div>
            </section>

            {/* 3. Languages & interests */}
            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
              <h2 className="text-[15px] font-semibold">Languages & interests</h2>
              <div className="mt-4 space-y-4">
                <div>
                  <span className="mb-2 block text-sm font-semibold">Languages I know</span>
                  <p className="mb-2 text-xs text-slate-500">All the languages you speak — used for matching.</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {LANGUAGES_I_KNOW.map(([v, l]) => (
                      <Pill key={v} selected={languagesKnown.includes(v)} onClick={() => setLanguagesKnown((cur) => cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])}>{l}</Pill>
                    ))}
                  </div>
                  {languagesKnown.length === 0 && <p className="mt-2 text-xs text-slate-500">Empty = open to all languages.</p>}
                </div>
                <Toggle checked={languageFilterEnabled} onChange={setLanguageFilterEnabled}
                  label="Only match people I can understand" hint="When ON, you'll only be paired with people whose chat language is one of the languages above." />
                <div>
                  <span className="mb-2 block text-sm font-semibold">Interests <span className="font-normal text-slate-500">(optional · up to 8)</span></span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {INTERESTS.map(([v, l]) => (
                      <button key={v} type="button" onClick={() => toggleInterest(v)}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm font-medium transition ${interests.includes(v) ? 'border-cyan-400 bg-cyan-400/10 text-cyan-100 ring-1 ring-cyan-400/50' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}>
                        {l}
                        <span className={`ml-2 flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[11px] font-bold ${interests.includes(v) ? 'border-cyan-400 bg-cyan-400 text-slate-950' : 'border-slate-600 text-transparent'}`}>✓</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* 4. Privacy & visibility — bottom */}
            <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
              <h2 className="text-[15px] font-semibold">Privacy & visibility</h2>
              <p className="mt-1 text-xs text-slate-500">Control what others see on your profile card above.</p>
              <div className="mt-4 space-y-2.5">
                <Toggle checked={onlineVisible} onChange={setOnlineVisible} label="Show me online" hint="Appear in the online directory." />
                <Toggle checked={profileVisible} onChange={setProfileVisible} label="Profile discoverable" hint="Let compatible users see your profile." />
                <Toggle checked={genderVisible} onChange={setGenderVisible} label="Show gender" hint="Display your gender on your profile." />
                <Toggle checked={ageBandVisible} onChange={setAgeBandVisible} label="Show age band" hint="Display your age band on your profile." />
                <Toggle checked={generationVisible} onChange={setGenerationVisible} label="Show generation" hint="Display your generation on your profile." />
                <Toggle checked={countryVisible} onChange={setCountryVisible} label="Show country" hint="Display your country on your profile." />
                <Toggle checked={regionVisible} onChange={setRegionVisible} label="Show region" hint="Display your continent and country on your profile." />
                <Toggle checked={languageVisible} onChange={setLanguageVisible} label="Show chat language" hint="Display your chat language on your profile." />
                <Toggle checked={languagesKnownVisible} onChange={setLanguagesKnownVisible} label="Show languages I know" hint="Display all languages you speak on your profile." />
                <Toggle checked={interestsVisible} onChange={setInterestsVisible} label="Show interests" hint="Display your interests on your profile." />
              </div>
            </section>

            <div className="sticky bottom-24 md:bottom-4">
              <button type="button" onClick={() => void save()} disabled={busy}
                className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-6 py-4 text-sm font-bold text-slate-950 shadow-xl shadow-cyan-950/50 transition hover:brightness-110 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </div>
        )}
        {loading && (
          <div aria-busy="true" className="mt-6 space-y-4">
            <Shimmer className="h-5 w-44 rounded" />
            <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
              <Shimmer className="h-5 w-36 rounded" />
              <div className="mt-4 space-y-2">
                <Shimmer className="h-10 w-full rounded-xl" />
                <Shimmer className="h-10 w-2/3 rounded-xl" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({length:6}).map((_,i)=><Shimmer key={i} className="h-11 rounded-xl" />)}
            </div>
            <Shimmer className="h-14 w-full rounded-3xl" />
          </div>
        )}
      </div>
    </main>
  )
}
