'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/errors'
import { ACCENTS, getSelection, applySelection, type Selection, type Base } from '@/lib/theme'
import { getSoundPrefs, setSoundBundle, setSoundMode, notify, getRingVolume, setRingVolume, playRing, stopRing, type SoundPrefs, type SoundMode, type SoundBundle, type RingKind } from '@/lib/notification-sound'
import { getNotifPrefs, setNotifPrefs, type NotifPrefs, type NotifCategory } from '@/lib/notification-prefs'
import { getNotifDisplayPrefs, setNotifDisplayPrefs, BANNER_DURATIONS, type NotifDisplayPrefs, type BannerDuration, type BannerStackMode } from '@/lib/notification-display'
import { pushSupported, isPushEnabled, enablePush, disablePush } from '@/lib/push'
import { AppHeader } from '@/components/app-header'
import { Shimmer } from '@/components/shimmer'
import { useI18n } from '@/lib/i18n/provider'

const LANGUAGES = [
  ['sq', 'Albanian (Shqip)'], ['ar', 'Arabic (العربية)'], ['bn', 'Bengali (বাংলা)'], ['bg', 'Bulgarian (Български)'],
  ['zh_cn', 'Chinese (Simplified) (中文)'], ['hr', 'Croatian (Hrvatski)'], ['cs', 'Czech (Čeština)'], ['da', 'Danish (Dansk)'],
  ['nl', 'Dutch (Nederlands)'], ['en', 'English'], ['et', 'Estonian (Eesti)'], ['fi', 'Finnish (Suomi)'],
  ['fr', 'French (Français)'], ['de', 'German (Deutsch)'], ['el', 'Greek (Ελληνικά)'], ['gu', 'Gujarati (ગુજરાતી)'],
  ['he', 'Hebrew (עברית)'], ['hi', 'Hindi (हिन्दी)'], ['hu', 'Hungarian (Magyar)'], ['ig', 'Igbo'],
  ['id', 'Indonesian (Bahasa Indonesia)'], ['it', 'Italian (Italiano)'], ['ja', 'Japanese (日本語)'], ['kn', 'Kannada (ಕನ್ನಡ)'],
  ['kk', 'Kazakh (Қазақ)'], ['km', 'Khmer (ខ្មែរ)'], ['ko', 'Korean (한국어)'], ['lv', 'Latvian (Latviešu)'],
  ['lt', 'Lithuanian (Lietuvių)'], ['mk', 'Macedonian (Македонски)'], ['ms', 'Malay (Bahasa Melayu)'], ['ml', 'Malayalam (മലയാളം)'],
  ['mr', 'Marathi (मराठी)'], ['mn', 'Mongolian (Монгол)'], ['ne', 'Nepali (नेपाली)'], ['no', 'Norwegian (Norsk)'],
  ['ps', 'Pashto (پښتو)'], ['fa', 'Persian (فارسی)'], ['pl', 'Polish (Polski)'], ['pt', 'Portuguese (Português)'],
  ['pa', 'Punjabi (ਪੰਜਾਬੀ)'], ['ro', 'Romanian (Română)'], ['ru', 'Russian (Русский)'], ['sr', 'Serbian (Српски)'],
  ['sd', 'Sindhi (سنڌي)'], ['si', 'Sinhala (සිංහල)'], ['sk', 'Slovak (Slovenčina)'], ['sl', 'Slovenian (Slovenščina)'],
  ['es', 'Spanish (Español)'], ['sw', 'Swahili (Kiswahili)'], ['sv', 'Swedish (Svenska)'], ['tl', 'Tagalog'],
  ['th', 'Thai (ไทย)'], ['tr', 'Turkish (Türkçe)'], ['uk', 'Ukrainian (Українська)'], ['ur', 'Urdu (اردو)'],
  ['uz', 'Uzbek (O‘zbek)'], ['vi', 'Vietnamese (Tiếng Việt)'], ['yo', 'Yoruba (Yorùbá)'],
] as const
const GENDER_CODES = ['woman', 'man', 'non_binary', 'prefer_not_to_say'] as const
const GENERATION_CODES = ['gen_alpha', 'gen_z', 'millennial', 'gen_x', 'boomer'] as const
const AGE_BAND_OPTIONS = [['18_20', '18–20'], ['21_29', '21–29'], ['30_44', '30–44'], ['45_59', '45–59'], ['60_plus', '60+']] as const
const CONTINENT_CODES = ['africa', 'asia', 'europe', 'north_america', 'south_america', 'oceania'] as const
const INTEREST_CODES = [
  'music', 'movies', 'gaming', 'anime', 'sports', 'technology', 'books', 'travel',
  'food', 'art', 'fitness', 'memes', 'photography', 'science', 'nature', 'coding',
] as const
const WAIT_TIMES = [[5, '5 seconds'], [10, '10 seconds'], [15, '15 seconds'], [30, '30 seconds'], [45, '45 seconds'], [60, '60 seconds']] as const

type Prefs = {
  preferred_age_bands: string[]
  preferred_genders: string[]
  preferred_orientations: string[]
  preferred_generations: string[]
  preferred_languages: string[]
  preferred_continents: string[]
  preferred_interests: string[]
  language_filter_enabled: boolean
  interest_wait_seconds: number
  country_targeting_enabled: boolean
}

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${checked ? 'border-cyan-500/40 bg-cyan-950/20' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
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

function Pill({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-xl border px-4 py-2.5 text-sm font-medium transition ${selected ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/50' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}>
      {children}
    </button>
  )
}

function MultiSelect({ label, hint, options, values, onToggle }: {
  label: string
  hint?: string
  options: readonly (readonly [string, string])[]
  values: string[]
  onToggle: (v: string) => void
}) {
  return (
    <div>
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {hint && <p className="mb-2 -mt-1 text-xs text-slate-500">{hint}</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {options.map(([v, l]) => <Pill key={v} selected={values.includes(v)} onClick={() => onToggle(v)}>{l}</Pill>)}
      </div>
      {values.length === 0 && <p className="mt-2 text-xs text-slate-500">Empty = open to everyone.</p>}
    </div>
  )
}

function Select({ value, onChange, label, options }: { value: number; onChange: (v: string) => void; label: string; options: readonly (readonly [number, string])[] }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function SelectStr({ value, onChange, label, hint, options }: { value: string; onChange: (v: string) => void; label: string; hint?: string; options: readonly (readonly [string, string])[] }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold">{label}</span>
      {hint && <p className="mb-2 -mt-1 text-xs text-slate-500">{hint}</p>}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-slate-400">{description}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function SettingsSkeleton() {
  return (
    <div aria-busy="true" className="mt-4 space-y-4">
      {[0,1,2].map((i) => (
        <div key={i} className="rounded-3xl border border-slate-800 bg-slate-900/70 p-4 sm:p-6">
          <Shimmer className="h-4 w-40 rounded sm:w-48" />
          <div className="mt-4 space-y-3">
            <Shimmer className="h-11 w-full rounded-xl" />
            <Shimmer className="h-11 w-3/4 rounded-xl" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Shimmer className="h-9 rounded-lg" />
              <Shimmer className="h-9 rounded-lg" />
              <Shimmer className="hidden sm:block h-9 rounded-lg" />
            </div>
            <div className="hidden md:grid md:grid-cols-4 md:gap-2">
              <Shimmer className="h-8 rounded-lg" />
              <Shimmer className="h-8 rounded-lg" />
              <Shimmer className="h-8 rounded-lg" />
              <Shimmer className="h-8 rounded-lg" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const { t, setLang } = useI18n()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [prefs, setPrefs] = useState<Prefs>({
    preferred_age_bands: [],
    preferred_genders: [],
    preferred_orientations: [],
    preferred_generations: [],
    preferred_languages: [],
    preferred_continents: [],
    preferred_interests: [],
    language_filter_enabled: false,
    interest_wait_seconds: 5,
    country_targeting_enabled: false,
  })
  const [sel, setSel] = useState<Selection>({ base: 'dark', accent: 'none' })
  const [sound, setSound] = useState<SoundPrefs>({ mode: 'sound', bundle: 'classic' })
  const [ringVol, setRingVol] = useState<number>(() => getRingVolume())
  const [notifPrefs, setNotifPrefsState] = useState<NotifPrefs>(getNotifPrefs())
  const [notifDisplay, setNotifDisplay] = useState<NotifDisplayPrefs>(getNotifDisplayPrefs())
  const [pushOn, setPushOn] = useState<boolean>(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushPerm, setPushPerm] = useState<NotificationPermission>('default')
  const [interfaceLanguage, setInterfaceLanguage] = useState('en')
  const [chatLanguage, setChatLanguage] = useState('en')

  const genderOptions: [string, string][] = [
    ['woman', t('settings.options.woman')],
    ['man', t('settings.options.man')],
    ['non_binary', t('settings.options.nonBinary')],
    ['prefer_not_to_say', t('settings.options.preferNotToSay')],
  ]
  const generationOptions: [string, string][] = [
    ['gen_alpha', t('settings.options.genAlpha')],
    ['gen_z', t('settings.options.genZ')],
    ['millennial', t('settings.options.millennial')],
    ['gen_x', t('settings.options.genX')],
    ['boomer', t('settings.options.boomer')],
  ]
  const continentOptions: [string, string][] = [
    ['africa', t('settings.options.africa')],
    ['asia', t('settings.options.asia')],
    ['europe', t('settings.options.europe')],
    ['north_america', t('settings.options.northAmerica')],
    ['south_america', t('settings.options.southAmerica')],
    ['oceania', t('settings.options.oceania')],
  ]
  const interestOptions: [string, string][] = INTEREST_CODES.map((c) => [c, t(`settings.options.${c}`)])

  const modeOptions: [Base, string][] = [
    ['dark', t('settings.appearance.dark')],
    ['white', t('settings.appearance.light')],
  ]
  const alertOptions: [SoundMode, string][] = [
    ['sound', t('settings.sounds.sound')],
    ['buzz', t('settings.sounds.buzz')],
    ['mute', t('settings.sounds.mute')],
  ]
  const packOptions: { id: SoundBundle; label: string; hint: string }[] = [
    { id: 'classic', label: t('settings.sounds.pack.classic'), hint: t('settings.sounds.pack.classicHint') },
    { id: 'pop', label: t('settings.sounds.pack.pop'), hint: t('settings.sounds.pack.popHint') },
    { id: 'zen', label: t('settings.sounds.pack.zen'), hint: t('settings.sounds.pack.zenHint') },
  ]

  const notifOptions: { id: NotifCategory; label: string; hint: string }[] = [
    { id: 'message', label: t('settings.notifications.message'), hint: t('settings.notifications.messageHint') },
    { id: 'friend_request', label: t('settings.notifications.friendRequest'), hint: t('settings.notifications.friendRequestHint') },
    { id: 'block', label: t('settings.notifications.block'), hint: t('settings.notifications.blockHint') },
    { id: 'unfriend', label: t('settings.notifications.unfriend'), hint: t('settings.notifications.unfriendHint') },
    { id: 'delete_chat', label: t('settings.notifications.deleteChat'), hint: t('settings.notifications.deleteChatHint') },
  ]

  const durationOptions: { id: BannerDuration; label: string }[] = BANNER_DURATIONS.map((d) => ({
    id: d,
    label: d === 'never' ? t('settings.notifications.never') : `${d}s`,
  }))

  const stackOptions: { id: BannerStackMode; label: string; hint: string }[] = [
    { id: 'single', label: t('settings.notifications.stackSingle'), hint: t('settings.notifications.stackSingleHint') },
    { id: 'stack-new-top', label: t('settings.notifications.stackNewTop'), hint: t('settings.notifications.stackNewTopHint') },
    { id: 'stack-new-bottom', label: t('settings.notifications.stackNewBottom'), hint: t('settings.notifications.stackNewBottomHint') },
  ]

  useEffect(() => {
    let active = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      setSel(getSelection())
      setSound(getSoundPrefs())
      setPushOn(await reflectPushState())
      const { data: p } = await supabase.from('match_preferences').select('preferred_age_bands,preferred_genders,preferred_orientations,preferred_generations,preferred_languages,preferred_continents,preferred_interests,language_filter_enabled,interest_wait_seconds,country_targeting_enabled').eq('profile_id', user.id).maybeSingle()
      const { data: profile } = await supabase.from('profiles').select('interface_language,chat_language').eq('id', user.id).maybeSingle()
      if (!active) return
      if (p) setPrefs((cur) => ({ ...cur, ...(p as Partial<Prefs>) }))
      if (profile) {
        setInterfaceLanguage(profile.interface_language ?? 'en')
        setChatLanguage(profile.chat_language ?? 'en')
      }
      setLoading(false)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Watch the browser's notification permission in real time so the toggle and
  // hint stay true even if the user changes it in the browser's own settings
  // while this page is open (Chrome/Android support this API; others are no-op).
  useEffect(() => {
    if (!pushSupported()) return
    if (!('permissions' in navigator)) return
    let active = true
    let unregister: (() => void) | null = null
    void navigator.permissions.query({ name: 'notifications' as PermissionName })
      .then((status) => {
        if (!active) return
        setPushPerm(status.state === 'prompt' ? 'default' : status.state)
        const onChange = () => {
          if (!active) return
          const perm = Notification.permission
          setPushPerm(perm)
          setPushOn(perm === 'granted' && isPushEnabled())
        }
        status.addEventListener('change', onChange)
        unregister = () => status.removeEventListener('change', onChange)
      })
      .catch(() => {})
    return () => { active = false; unregister?.() }
  }, [])

  function toggleIn(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
  }

  // True only when the browser genuinely has push on: permission granted AND
  // an active push subscription. This is what the toggle should reflect.
  async function reflectPushState(): Promise<boolean> {
    setPushPerm(pushSupported() ? Notification.permission : 'default')
    if (!pushSupported()) return false
    if (Notification.permission !== 'granted') return false
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      return !!sub && isPushEnabled()
    } catch {
      return isPushEnabled()
    }
  }

  async function togglePush(next: boolean) {
    setPushBusy(true); setPushError(null)
    try {
      const res = next ? await enablePush() : await disablePush()
      if (!res.ok) {
        setPushError(res.message)
      }
      // Refresh from the real browser state so the toggle always matches
      // whether a subscription actually exists.
      setPushOn(await reflectPushState())
    } catch (e) {
      setPushError(e instanceof Error ? e.message : t('settings.notifications.pushError'))
    } finally {
      setPushBusy(false)
    }
  }

  async function save() {
    setBusy(true); setError(''); setSaved(false)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError(t('settings.sessionExpired')); setBusy(false); return }
    const { error: e1 } = await supabase.from('match_preferences').upsert({
      profile_id: user.id,
      preferred_age_bands: prefs.preferred_age_bands,
      preferred_genders: prefs.preferred_genders,
      preferred_orientations: prefs.preferred_orientations,
      preferred_generations: prefs.preferred_generations,
      preferred_continents: prefs.preferred_continents,
      preferred_interests: prefs.preferred_interests,
      interest_wait_seconds: prefs.interest_wait_seconds,
      country_targeting_enabled: prefs.country_targeting_enabled,
    })
    if (e1) { setError(friendlyError(e1, t('settings.saveMatchingFailed'))); setBusy(false); return }
    const { error: e2 } = await supabase.from('profiles').update({
      interface_language: interfaceLanguage,
      chat_language: chatLanguage,
    }).eq('id', user.id)
    if (e2) { setError(friendlyError(e2, t('settings.saveLanguagesFailed'))); setBusy(false); return }
    setSaved(true); setBusy(false)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <AppHeader title={t('settings.title')} icon="settings" />
        <div className="w-full px-4 pt-6"><p className="text-sm text-slate-500">{t('settings.loading')}</p></div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppHeader title={t('settings.title')} icon="settings" />
      <div className="mx-auto max-w-2xl w-full px-4 pb-24 pt-4 md:pb-10 lg:max-w-4xl">
        <p className="text-xs leading-relaxed text-slate-500">{t('settings.intro')}</p>

        {error && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
        {saved && <p className="mt-4 rounded-xl bg-emerald-950/40 p-3 text-sm text-emerald-200">{t('settings.saved')}</p>}

        <div className="mt-4 space-y-4">
          <Section title={t('settings.appearance.title')} description={t('settings.appearance.desc')}>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t('settings.appearance.mode')}</p>
              <div className="grid grid-cols-2 gap-3">
                {modeOptions.map(([b, label]) => (
                  <button key={b} onClick={() => { const n = { ...sel, base: b }; setSel(n); applySelection(n) }}
                    className={`rounded-2xl border p-4 text-sm font-bold transition ${sel.base === b ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/40' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t('settings.appearance.accent')}</p>
              <div className="grid grid-cols-4 gap-3">
                {ACCENTS.map((a) => (
                  <button key={a.id} onClick={() => { const n = { ...sel, accent: a.id }; setSel(n); applySelection(n) }}
                    className={`flex flex-col items-center gap-2 rounded-2xl border p-3 transition ${sel.accent === a.id ? 'border-cyan-400 bg-cyan-400/10 ring-1 ring-cyan-400/40' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
                    <span className="h-8 w-8 rounded-full border border-slate-600" style={{ background: a.preview }} />
                    <span className="text-[11px] font-medium">{a.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title={t('settings.sounds.title')} description={t('settings.sounds.desc')}>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t('settings.sounds.alertMode')}</p>
              <div className="grid grid-cols-3 gap-2">
                {alertOptions.map(([m, label]) => (
                  <button key={m} onClick={() => setSound(setSoundMode(m))}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${sound.mode === m ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/50' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {sound.mode === 'buzz' && <p className="mt-2 text-xs text-slate-500">{t('settings.sounds.buzzHint')}</p>}
              {sound.mode === 'mute' && <p className="mt-2 text-xs text-slate-500">{t('settings.sounds.muteHint')}</p>}
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t('settings.sounds.soundPacks')}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {packOptions.map(({ id, label, hint }) => (
                  <button key={id} onClick={() => { const n = setSoundBundle(id); setSound(n); if (n.mode === 'sound') notify('message') }}
                    className={`rounded-2xl border p-4 text-left transition ${sound.bundle === id ? 'border-cyan-400 bg-cyan-400/10 ring-1 ring-cyan-400/40' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
                    <span className="block text-sm font-bold">{label}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-400">{hint}</span>
                    <span className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-cyan-300/80">{sound.bundle === id ? t('settings.sounds.pack.selected') : t('settings.sounds.pack.tapPreview')}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Call ring &amp; volume</p>
              <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-200">Ring volume</span>
                  <span className="text-sm font-bold text-cyan-300">{Math.round(ringVol * 100)}%</span>
                </div>
                <input
                  type="range" min={0} max={100} step={5} value={Math.round(ringVol * 100)}
                  onChange={(e) => setRingVol(setRingVolume(Number(e.target.value) / 100))}
                  className="mt-3 w-full accent-cyan-400"
                  aria-label="Ring volume"
                />
                <div className="mt-3 flex gap-2">
                  {([['incoming', 'Incoming'], ['outgoing', 'Outgoing']] as [RingKind, string][]).map(([kind, label]) => (
                    <button key={kind} type="button"
                      onMouseDown={() => playRing(kind)}
                      onMouseUp={() => stopRing()}
                      onMouseLeave={() => stopRing()}
                      onTouchStart={() => playRing(kind)}
                      onTouchEnd={() => stopRing()}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playRing(kind) } }}
                      onKeyUp={() => stopRing()}
                      className="flex-1 rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200">
                      {label} ring
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Press and hold to preview the ring for the selected sound pack.</p>
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t('settings.sounds.languages')}</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectStr label={t('settings.sounds.interfaceLang')} hint={t('settings.sounds.interfaceLangHint')} value={interfaceLanguage} onChange={(v) => { setLang(v); setInterfaceLanguage(v) }} options={LANGUAGES} />
                <SelectStr label={t('settings.sounds.chatLang')} hint={t('settings.sounds.chatLangHint')} value={chatLanguage} onChange={setChatLanguage} options={LANGUAGES} />
              </div>
            </div>
          </Section>

          <Section title={t('settings.notifications.title')} description={t('settings.notifications.desc')}>
            {notifOptions.map(({ id, label, hint }) => (
              <Toggle key={id} checked={notifPrefs[id]} label={label} hint={hint}
                onChange={(v) => setNotifPrefsState((c) => {
                  const next = { ...c, [id]: v }
                  setNotifPrefs(next)
                  return next
                })} />
            ))}

            <Toggle checked={notifDisplay.showBanner} label={t('settings.notifications.showBanner')} hint={t('settings.notifications.showBannerHint')}
              onChange={(v) => setNotifDisplay(setNotifDisplayPrefs({ ...notifDisplay, showBanner: v }))} />

            <Toggle checked={pushOn} disabled={!pushSupported() || pushBusy} label={t('settings.notifications.pushEnabled')} hint={t('settings.notifications.pushEnabledHint')}
              onChange={(v) => void togglePush(v)} />
            {pushPerm === 'denied' ? (
              <p className="text-xs font-semibold text-amber-400">{t('settings.notifications.pushDenied')}</p>
            ) : null}
            {pushError ? <p className="text-xs font-semibold text-red-400">{pushError}</p> : null}

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t('settings.notifications.duration')}</p>
              <p className="mb-2 text-xs leading-relaxed text-slate-400">{t('settings.notifications.durationHint')}</p>
              <div className="grid grid-cols-6 gap-2">
                {durationOptions.map(({ id, label }) => (
                  <button key={String(id)} onClick={() => setNotifDisplay(setNotifDisplayPrefs({ ...notifDisplay, duration: id }))}
                    className={`whitespace-nowrap rounded-xl border px-2 py-2.5 text-xs font-semibold transition ${id === 'never' ? 'col-span-2' : ''} ${notifDisplay.duration === id ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/50' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t('settings.notifications.arrangement')}</p>
              <p className="mb-2 text-xs leading-relaxed text-slate-400">{t('settings.notifications.arrangementHint')}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {stackOptions.map(({ id, label, hint }) => (
                  <button key={id} onClick={() => setNotifDisplay(setNotifDisplayPrefs({ ...notifDisplay, stack: id }))}
                    className={`rounded-2xl border p-4 text-left transition ${notifDisplay.stack === id ? 'border-cyan-400 bg-cyan-400/10 ring-1 ring-cyan-400/40' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-400">{hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title={t('settings.meet.title')} description={t('settings.meet.desc')}>
            <MultiSelect label={t('settings.meet.genders')} options={genderOptions} values={prefs.preferred_genders}
              onToggle={(v) => setPrefs((c) => ({ ...c, preferred_genders: toggleIn(c.preferred_genders, v) }))} />
            <MultiSelect label={t('settings.meet.generations')} options={generationOptions} values={prefs.preferred_generations}
              onToggle={(v) => setPrefs((c) => ({ ...c, preferred_generations: toggleIn(c.preferred_generations, v) }))} />
            <MultiSelect label={t('settings.meet.ageBands')} options={AGE_BAND_OPTIONS} values={prefs.preferred_age_bands}
              onToggle={(v) => setPrefs((c) => ({ ...c, preferred_age_bands: toggleIn(c.preferred_age_bands, v) }))} />
            <MultiSelect label={t('settings.meet.continents')} hint={t('settings.meet.continentsHint')} options={continentOptions} values={prefs.preferred_continents}
              onToggle={(v) => setPrefs((c) => ({ ...c, preferred_continents: toggleIn(c.preferred_continents, v) }))} />
            <MultiSelect label={t('settings.meet.interests')} hint={t('settings.meet.interestsHint')} options={interestOptions} values={prefs.preferred_interests}
              onToggle={(v) => setPrefs((c) => ({ ...c, preferred_interests: toggleIn(c.preferred_interests, v) }))} />
          </Section>

          <Section title={t('settings.timing.title')} description={t('settings.timing.desc')}>
            <Select label={t('settings.timing.interestWindow')} value={prefs.interest_wait_seconds} onChange={(v) => setPrefs((c) => ({ ...c, interest_wait_seconds: Number(v) }))} options={WAIT_TIMES} />
            <Toggle checked={prefs.country_targeting_enabled} onChange={(v2) => setPrefs((c) => ({ ...c, country_targeting_enabled: v2 }))}
              label={t('settings.timing.countryTargeting')} hint={t('settings.timing.countryTargetingHint')} />
          </Section>

          <div className="sticky bottom-24 md:bottom-4">
            <button type="button" onClick={() => void save()} disabled={busy}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-6 py-4 text-sm font-bold text-slate-950 shadow-xl shadow-cyan-950/50 transition hover:brightness-110 disabled:opacity-50">
              {busy ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
