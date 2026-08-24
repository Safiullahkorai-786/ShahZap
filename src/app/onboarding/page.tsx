'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/errors'

const STEPS = ['You', 'About you', 'Interests', 'Language & privacy'] as const
const AGE_BANDS = [['18_20', '18–20'], ['21_29', '21–29'], ['30_44', '30–44'], ['45_59', '45–59'], ['60_plus', '60+']] as const
const LANGUAGES = [['en', 'English'], ['ur', 'Urdu'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['tr', 'Turkish']] as const
const GENERATIONS = [['gen_z', 'Gen Z'], ['millennial', 'Millennial'], ['gen_x', 'Gen X'], ['boomer', 'Boomer']] as const
const GENDERS = [['woman', 'Woman'], ['man', 'Man'], ['non_binary', 'Non-binary'], ['prefer_not_to_say', 'Prefer not to say']] as const
const INTERESTS = [
  ['music', 'Music'], ['movies', 'Movies'], ['gaming', 'Gaming'], ['anime', 'Anime'],
  ['sports', 'Sports'], ['technology', 'Technology'], ['books', 'Books'], ['travel', 'Travel'],
  ['food', 'Food'], ['art', 'Art'], ['fitness', 'Fitness'], ['memes', 'Memes'],
] as const

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

function Select({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: readonly (readonly [string, string])[] }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-white">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [ageBand, setAgeBand] = useState('')
  const [gender, setGender] = useState('')
  const [orientation, setOrientation] = useState('')
  const [generation, setGeneration] = useState('')
  const [interfaceLanguage, setInterfaceLanguage] = useState('en')
  const [chatLanguage, setChatLanguage] = useState('en')
  const [selectedInterests, setSelectedInterests] = useState<string[]>([])
  const [onlineVisible, setOnlineVisible] = useState(true)
  const [profileVisible, setProfileVisible] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/')
    })
  }, [router])

  function toggleInterest(value: string) {
    setSelectedInterests((current) => current.includes(value) ? current.filter((x) => x !== value) : current.length >= 8 ? current : [...current, value])
  }

  function validate() {
    if (step === 1 && !name.trim()) return 'Choose a display name.'
    if (step === 1 && !ageBand) return 'Select your age band.'
    if (step === 2 && !gender) return 'Select a gender option or choose prefer not to say.'
    return ''
  }

  async function finish() {
    setBusy(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Your session expired. Please start again.'); setBusy(false); return }
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: user.id, display_name: name.trim().slice(0, 32), age_band: ageBand, gender: gender || null,
      orientation: orientation || null, generation: generation || null, interface_language: interfaceLanguage,
      chat_language: chatLanguage, online_visible: onlineVisible, profile_visible: profileVisible, last_active_at: new Date().toISOString(),
    })
    if (profileError) { setError(friendlyError(profileError, 'Could not save your profile. Please try again.')); setBusy(false); return }
    const { error: preferenceError } = await supabase.from('match_preferences').upsert({ profile_id: user.id, preferred_languages: [chatLanguage] })
    if (preferenceError) { setError(friendlyError(preferenceError, 'Could not save your preferences. Please try again.')); setBusy(false); return }
    const { data: rows, error: interestError } = await supabase.from('interests').select('id,slug').in('slug', selectedInterests)
    if (interestError) { setError(friendlyError(interestError, 'Could not load interests. Please try again.')); setBusy(false); return }
    await supabase.from('profile_interests').delete().eq('profile_id', user.id)
    if (rows?.length) {
      const { error: insertError } = await supabase.from('profile_interests').insert(rows.map((row) => ({ profile_id: user.id, interest_id: row.id })))
      if (insertError) { setError(friendlyError(insertError, 'Could not save your interests. Please try again.')); setBusy(false); return }
    }
    try { localStorage.setItem('shahzap:onboarded', '1') } catch {}
    router.replace('/app')
  }

  function next() {
    const message = validate(); if (message) { setError(message); return }
    setError(''); setStep((value) => Math.min(4, value + 1))
  }

  const canContinue = step === 1 ? Boolean(name.trim() && ageBand) : step === 2 ? Boolean(gender) : true

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800/80 bg-slate-950/90 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <p className="text-sm font-bold tracking-tight text-cyan-300">⚡ ShahZap</p>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Step {step} of 4</p>
        </div>
        <div className="mx-auto mt-3 flex max-w-2xl gap-1.5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div className={`h-1 rounded-full transition-colors ${i < step ? 'bg-cyan-400' : 'bg-slate-800'}`} />
              <p className={`mt-1.5 hidden text-[11px] font-medium sm:block ${i < step ? 'text-cyan-300' : 'text-slate-600'}`}>{label}</p>
            </div>
          ))}
        </div>
      </header>

      {/* Card */}
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
        <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-black/40 sm:p-10">
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">How should people see you?</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">Pick a nickname — your real identity stays private.</p>
              <div className="mt-8 space-y-7">
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-sm font-semibold">Display name</span>
                    <span className="text-xs tabular-nums text-slate-500">{name.length}/32</span>
                  </div>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3.5 text-base outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                    placeholder="BlueSpark" />
                </div>
                <div>
                  <span className="mb-3 block text-sm font-semibold">Age band</span>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {AGE_BANDS.map(([v, l]) => <Pill key={v} selected={ageBand === v} onClick={() => setAgeBand(v)}>{l}</Pill>)}
                  </div>
                </div>
                <p className="rounded-xl border border-amber-900/50 bg-amber-950/30 p-3.5 text-xs leading-relaxed text-amber-200/90">
                  Age bands keep things safe and private. Your exact birth date is never collected.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Tell us a little more</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">These help ShahZap find people you&apos;ll actually click with.</p>
              <div className="mt-8 space-y-7">
                <div>
                  <span className="mb-3 block text-sm font-semibold">Gender</span>
                  <div className="grid grid-cols-2 gap-2">
                    {GENDERS.map(([v, l]) => <Pill key={v} selected={gender === v} onClick={() => setGender(v)}>{l}</Pill>)}
                  </div>
                </div>
                <div>
                  <span className="mb-3 block text-sm font-semibold">Generation preference <span className="font-normal text-slate-500">(optional)</span></span>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Pill selected={generation === ''} onClick={() => setGeneration('')}>Any</Pill>
                    {GENERATIONS.map(([v, l]) => <Pill key={v} selected={generation === v} onClick={() => setGeneration(v)}>{l}</Pill>)}
                  </div>
                </div>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold">Orientation <span className="font-normal text-slate-500">(optional)</span></span>
                  <input value={orientation} onChange={(e) => setOrientation(e.target.value.slice(0, 32))}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3.5 text-base outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                    placeholder="Share only if you want to" />
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">What are you into?</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">Optional — pick up to 8 so we can try to pair you with people who share your interests. Skip and you&apos;ll be connected instantly with anyone compatible.</p>
              <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                {INTERESTS.map(([v, l]) => (
                  <button type="button" key={v} onClick={() => toggleInterest(v)}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-medium transition ${selectedInterests.includes(v) ? 'border-cyan-400 bg-cyan-400/10 text-cyan-100 ring-1 ring-cyan-400/50' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500'}`}>
                    {l}
                    <span className={`ml-2 flex h-5 w-5 flex-none items-center justify-center rounded-full border text-[11px] font-bold ${selectedInterests.includes(v) ? 'border-cyan-400 bg-cyan-400 text-slate-950' : 'border-slate-600 text-transparent'}`}>✓</span>
                  </button>
                ))}
              </div>
              <p className="mt-5 text-xs font-medium text-slate-500"><span className="text-cyan-300">{selectedInterests.length}</span> of 8 selected · {selectedInterests.length === 0 ? 'skipping is fine' : 'nice picks!'}</p>
            </div>
          )}

          {step === 4 && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Language &amp; privacy</h1>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">Your app language and chat language can be different.</p>
              <div className="mt-8 space-y-7">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Select label="Interface language" value={interfaceLanguage} onChange={setInterfaceLanguage} options={LANGUAGES} />
                  <Select label="Chat language" value={chatLanguage} onChange={setChatLanguage} options={LANGUAGES} />
                </div>
                <div className="space-y-3">
                  <Toggle checked={onlineVisible} onChange={setOnlineVisible} label="Show me online" hint="Appear in the optional online directory." />
                  <Toggle checked={profileVisible} onChange={setProfileVisible} label="Profile discoverable" hint="Let compatible users see your profile." />
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-7 flex items-start gap-2.5 rounded-xl border border-red-900/60 bg-red-950/40 p-3.5 text-sm text-red-200">
              <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">!</span>
              {error}
            </p>
          )}
        </section>
      </div>

      {/* Footer nav */}
      <footer className="sticky bottom-0 border-t border-slate-800/80 bg-slate-950/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-2xl gap-3">
          <button type="button" disabled={busy} onClick={() => step === 1 ? router.replace('/') : setStep(step - 1)}
            className="rounded-xl border border-slate-700 px-6 py-3.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50">
            Back
          </button>
          {step < 4 ? (
            <button type="button" onClick={next} disabled={!canContinue}
              className="ml-auto flex-1 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-6 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-12">
              Continue
            </button>
          ) : (
            <button type="button" onClick={finish} disabled={busy}
              className="ml-auto flex-1 rounded-xl bg-gradient-to-r from-cyan-400 to-cyan-300 px-6 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-950/50 transition hover:brightness-110 disabled:opacity-50 sm:flex-none sm:px-12">
              {busy ? 'Saving…' : 'Enter ShahZap'}
            </button>
          )}
        </div>
      </footer>
    </main>
  )
}
