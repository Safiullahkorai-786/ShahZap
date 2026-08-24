'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/errors'
import { ACCENTS, getSelection, applySelection, type Selection } from '@/lib/theme'
import { AppHeader } from '@/components/app-header'

const LANGUAGES = [
  ['en', 'English'], ['ur', 'Urdu'], ['sd', 'Sindhi'], ['hi', 'Hindi'], ['pa', 'Punjabi'],
  ['ar', 'Arabic'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['tr', 'Turkish'],
  ['bn', 'Bengali'], ['zh', 'Chinese'], ['fa', 'Persian'], ['ru', 'Russian'], ['pt', 'Portuguese'],
  ['id', 'Indonesian'], ['ms', 'Malay'], ['ja', 'Japanese'], ['ko', 'Korean'], ['it', 'Italian'],
] as const
const GENDER_OPTIONS = [['woman', 'Women'], ['man', 'Men'], ['non_binary', 'Non-binary'], ['prefer_not_to_say', 'Prefer not to say']] as const
const GENERATION_OPTIONS = [['gen_alpha', 'Gen Alpha'], ['gen_z', 'Gen Z'], ['millennial', 'Millennial'], ['gen_x', 'Gen X'], ['boomer', 'Boomer']] as const
const AGE_BAND_OPTIONS = [['18_20', '18–20'], ['21_29', '21–29'], ['30_44', '30–44'], ['45_59', '45–59'], ['60_plus', '60+']] as const
const WAIT_TIMES = [[5, '5 seconds'], [10, '10 seconds'], [15, '15 seconds'], [30, '30 seconds'], [45, '45 seconds'], [60, '60 seconds']] as const

type Visibility = {
  online_visible: boolean
  profile_visible: boolean
  generation_visible: boolean
  country_visible: boolean
  gender_visible: boolean
  age_band_visible: boolean
  interests_visible: boolean
}

type Prefs = {
  preferred_age_bands: string[]
  preferred_genders: string[]
  preferred_orientations: string[]
  preferred_generations: string[]
  preferred_languages: string[]
  language_filter_enabled: boolean
  interest_wait_seconds: number
  country_targeting_enabled: boolean
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition ${checked ? 'border-cyan-500/40 bg-cyan-950/20' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
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

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-slate-400">{description}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [vis, setVis] = useState<Visibility | null>(null)
  const [prefs, setPrefs] = useState<Prefs>({
    preferred_age_bands: [],
    preferred_genders: [],
    preferred_orientations: [],
    preferred_generations: [],
    preferred_languages: [],
    language_filter_enabled: false,
    interest_wait_seconds: 5,
    country_targeting_enabled: false,
  })
  const [sel, setSel] = useState<Selection>({ base: 'dark', accent: 'none' })

  useEffect(() => {
    let active = true
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      setSel(getSelection())
      const [{ data: v }, { data: p }] = await Promise.all([
        supabase.from('profiles').select('online_visible,profile_visible,generation_visible,country_visible,gender_visible,age_band_visible,interests_visible').eq('id', user.id).maybeSingle(),
        supabase.from('match_preferences').select('preferred_age_bands,preferred_genders,preferred_orientations,preferred_generations,preferred_languages,language_filter_enabled,interest_wait_seconds,country_targeting_enabled').eq('profile_id', user.id).maybeSingle(),
      ])
      if (!active) return
      if (v) setVis(v as Visibility)
      if (p) setPrefs((cur) => ({ ...cur, ...(p as Partial<Prefs>) }))
      setLoading(false)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleIn(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
  }

  async function save() {
    if (!vis) return
    setBusy(true); setError(''); setSaved(false)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Your session expired. Please sign in again.'); setBusy(false); return }
    const { error: e1 } = await supabase.from('profiles').update({
      online_visible: vis.online_visible,
      profile_visible: vis.profile_visible,
      generation_visible: vis.generation_visible,
      country_visible: vis.country_visible,
      gender_visible: vis.gender_visible,
      age_band_visible: vis.age_band_visible,
      interests_visible: vis.interests_visible,
    }).eq('id', user.id)
    if (e1) { setError(friendlyError(e1, 'Could not save your settings.')); setBusy(false); return }
    const { error: e2 } = await supabase.from('match_preferences').upsert({
      profile_id: user.id,
      preferred_age_bands: prefs.preferred_age_bands,
      preferred_genders: prefs.preferred_genders,
      preferred_orientations: prefs.preferred_orientations,
      preferred_generations: prefs.preferred_generations,
      preferred_languages: prefs.preferred_languages,
      language_filter_enabled: prefs.language_filter_enabled,
      interest_wait_seconds: prefs.interest_wait_seconds,
      country_targeting_enabled: prefs.country_targeting_enabled,
    })
    if (e2) { setError(friendlyError(e2, 'Could not save your matching preferences.')); setBusy(false); return }
    setSaved(true); setBusy(false)
  }

  if (loading || !vis) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <AppHeader title="Settings" icon="settings" />
        <div className="w-full px-4 pt-6"><p className="text-sm text-slate-500">Loading your settings…</p></div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <AppHeader title="Settings" icon="settings" />
      <div className="mx-auto max-w-2xl w-full px-4 pb-24 pt-4 md:pb-10 lg:max-w-4xl">
        <p className="text-xs leading-relaxed text-slate-500">
          Privacy, matching and appearance. Your name, photo details and languages are edited under <b>Profile</b>.
        </p>

        {error && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
        {saved && <p className="mt-4 rounded-xl bg-emerald-950/40 p-3 text-sm text-emerald-200">Settings saved.</p>}

        <div className="mt-4 space-y-4">
          <Section title="Appearance" description="Choose a base mode, then an accent — applies across the whole app instantly.">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Mode</p>
              <div className="grid grid-cols-2 gap-3">
                {([['dark','🌙 Dark night'],['white','☀️ Bright white']] as const).map(([b,label]) => (
                  <button key={b} onClick={() => { const n = { ...sel, base: b }; setSel(n); applySelection(n) }}
                    className={`rounded-2xl border p-4 text-sm font-bold transition ${sel.base === b ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/40' : 'border-slate-800 bg-slate-950 hover:border-slate-600'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Accent</p>
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

          <Section title="Privacy & visibility" description="You decide what others can discover about you. Names follow these rules everywhere — notifications, lists and profiles.">
            <Toggle checked={vis.profile_visible} onChange={(v2) => setVis({ ...vis, profile_visible: v2 })}
              label="Profile discoverable" hint="Let compatible users see your profile at all." />
            <Toggle checked={vis.online_visible} onChange={(v2) => setVis({ ...vis, online_visible: v2 })}
              label="Show me online" hint="Appear in the online directory." />
            <Toggle checked={vis.age_band_visible} onChange={(v2) => setVis({ ...vis, age_band_visible: v2 })}
              label="Show age band" hint="Display your age band on your profile." />
            <Toggle checked={vis.gender_visible} onChange={(v2) => setVis({ ...vis, gender_visible: v2 })}
              label="Show gender" hint="Display your gender — your name appears pink, blue or rainbow to others." />
            <Toggle checked={vis.generation_visible} onChange={(v2) => setVis({ ...vis, generation_visible: v2 })}
              label="Show generation" hint="Display your generation on your profile." />
            <Toggle checked={vis.country_visible} onChange={(v2) => setVis({ ...vis, country_visible: v2 })}
              label="Show country" hint="Display your country code on your profile." />
            <Toggle checked={vis.interests_visible} onChange={(v2) => setVis({ ...vis, interests_visible: v2 })}
              label="Show interests" hint="Display your interests in lists and on your profile." />
          </Section>

          <Section title="Who I want to meet" description="Leave any group empty to stay open to everyone in it.">
            <MultiSelect label="Genders" options={GENDER_OPTIONS} values={prefs.preferred_genders}
              onToggle={(v) => setPrefs((c) => ({ ...c, preferred_genders: toggleIn(c.preferred_genders, v) }))} />
            <MultiSelect label="Generations" options={GENERATION_OPTIONS} values={prefs.preferred_generations}
              onToggle={(v) => setPrefs((c) => ({ ...c, preferred_generations: toggleIn(c.preferred_generations, v) }))} />
            <MultiSelect label="Age bands" options={AGE_BAND_OPTIONS} values={prefs.preferred_age_bands}
              onToggle={(v) => setPrefs((c) => ({ ...c, preferred_age_bands: toggleIn(c.preferred_age_bands, v) }))} />
          </Section>

          <Section title="Languages" description="Pick every language you know, then decide whether matching should use them.">
            <MultiSelect label="Languages I know" hint="Example: Urdu, Sindhi, English, Hindi, Punjabi…" options={LANGUAGES} values={prefs.preferred_languages}
              onToggle={(v) => setPrefs((c) => ({ ...c, preferred_languages: toggleIn(c.preferred_languages, v) }))} />
            <Toggle checked={prefs.language_filter_enabled} onChange={(v2) => setPrefs((c) => ({ ...c, language_filter_enabled: v2 }))}
              label="Only match people I can understand" hint="When ON, you'll only be paired with people whose chat language is one of the languages above. When OFF, languages are just listed — everyone is fair game." />
          </Section>

          <Section title="Matching timing & region" description="Fine-tune how the queue pairs you.">
            <Select label="Interest priority window" value={prefs.interest_wait_seconds} onChange={(v) => setPrefs((c) => ({ ...c, interest_wait_seconds: Number(v) }))} options={WAIT_TIMES} />
            <Toggle checked={prefs.country_targeting_enabled} onChange={(v2) => setPrefs((c) => ({ ...c, country_targeting_enabled: v2 }))}
              label="Country targeting" hint="Prefer matches from your chosen regions when available." />
          </Section>

          <div className="sticky bottom-24 md:bottom-4">
            <button type="button" onClick={() => void save()} disabled={busy}
              className="w-full rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-6 py-4 text-sm font-bold text-slate-950 shadow-xl shadow-cyan-950/50 transition hover:brightness-110 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
