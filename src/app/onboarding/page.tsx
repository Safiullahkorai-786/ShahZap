'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const ageBands = [['18_20', '18–20'], ['21_29', '21–29'], ['30_44', '30–44'], ['45_59', '45–59'], ['60_plus', '60+']]
const languages = [['en','English'],['ur','Urdu'],['hi','Hindi'],['ar','Arabic'],['es','Spanish'],['fr','French'],['de','German'],['tr','Turkish']]
const generations = [['gen_z','Gen Z'],['millennial','Millennial'],['gen_x','Gen X'],['boomer','Boomer']]
const genders = ['woman','man','non_binary','prefer_not_to_say']
const interests = ['music','movies','gaming','anime','sports','technology','books','travel','food','art','fitness','memes']

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
  const [onlineVisible, setOnlineVisible] = useState(false)
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
    if (step === 3 && selectedInterests.length < 3) return 'Choose at least 3 interests.'
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
    if (profileError) { setError(profileError.message); setBusy(false); return }
    const { error: preferenceError } = await supabase.from('match_preferences').upsert({ profile_id: user.id, preferred_languages: [chatLanguage] })
    if (preferenceError) { setError(preferenceError.message); setBusy(false); return }
    const { data: rows, error: interestError } = await supabase.from('interests').select('id,slug').in('slug', selectedInterests)
    if (interestError) { setError(interestError.message); setBusy(false); return }
    await supabase.from('profile_interests').delete().eq('profile_id', user.id)
    if (rows?.length) {
      const { error: insertError } = await supabase.from('profile_interests').insert(rows.map((row) => ({ profile_id: user.id, interest_id: row.id })))
      if (insertError) { setError(insertError.message); setBusy(false); return }
    }
    router.replace('/app')
  }

  function next() {
    const message = validate(); if (message) { setError(message); return }
    setError(''); setStep((value) => Math.min(4, value + 1))
  }

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6">
    <div className="mx-auto max-w-2xl">
      <div className="mb-8 flex items-center justify-between"><div><p className="text-sm font-semibold text-cyan-300">⚡ ShahZap</p><h1 className="mt-1 text-2xl font-bold">Set up your profile</h1></div><span className="text-sm text-slate-400">Step {step} of 4</span></div>
      <div className="mb-8 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-cyan-400 transition-all" style={{width:`${step*25}%`}} /></div>
      <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl sm:p-8">
        {step === 1 && <div><h2 className="text-xl font-semibold">How should people see you?</h2><p className="mt-2 text-sm text-slate-400">Use a nickname. Your exact age is never shown.</p><label className="mt-6 block text-sm font-medium">Display name<input value={name} onChange={e=>setName(e.target.value)} maxLength={32} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-cyan-400" placeholder="BlueSpark" /></label><label className="mt-5 block text-sm font-medium">Age band<select value={ageBand} onChange={e=>setAgeBand(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"><option value="">Select</option>{ageBands.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><p className="mt-4 rounded-xl bg-amber-950/40 p-3 text-xs text-amber-200">ShahZap uses age bands for privacy and safety. Exact birth dates are not collected here.</p></div>}
        {step === 2 && <div><h2 className="text-xl font-semibold">Tell us a little more</h2><p className="mt-2 text-sm text-slate-400">These settings help ShahZap make better matches.</p><label className="mt-6 block text-sm font-medium">Gender<select value={gender} onChange={e=>setGender(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"><option value="">Select</option>{genders.map(v=><option key={v} value={v}>{v.replaceAll('_',' ')}</option>)}</select></label><label className="mt-5 block text-sm font-medium">Orientation (optional)<input value={orientation} onChange={e=>setOrientation(e.target.value.slice(0,32))} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3" placeholder="Optional" /></label><label className="mt-5 block text-sm font-medium">Generation preference<select value={generation} onChange={e=>setGeneration(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3"><option value="">No preference</option>{generations.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div>}
        {step === 3 && <div><h2 className="text-xl font-semibold">What are you into?</h2><p className="mt-2 text-sm text-slate-400">Pick 3–8 interests. They help with discovery, not safety.</p><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">{interests.map(value=><button type="button" key={value} onClick={()=>toggleInterest(value)} className={`rounded-xl border px-4 py-3 text-sm capitalize transition ${selectedInterests.includes(value)?'border-cyan-400 bg-cyan-400/10 text-cyan-200':'border-slate-700 bg-slate-950 hover:border-slate-500'}`}>{value}</button>)}</div><p className="mt-4 text-xs text-slate-500">{selectedInterests.length}/8 selected</p></div>}
        {step === 4 && <div><h2 className="text-xl font-semibold">Language & privacy</h2><p className="mt-2 text-sm text-slate-400">Your app language and chat language can be different.</p><div className="mt-6 grid gap-5 sm:grid-cols-2"><label className="text-sm">Interface language<select value={interfaceLanguage} onChange={e=>setInterfaceLanguage(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3">{languages.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label className="text-sm">Chat language<select value={chatLanguage} onChange={e=>setChatLanguage(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3">{languages.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label></div><div className="mt-7 space-y-3"><label className="flex items-center justify-between rounded-xl border border-slate-800 p-4"><span><span className="block text-sm font-medium">Show me online</span><span className="text-xs text-slate-500">Optional online directory visibility.</span></span><input type="checkbox" checked={onlineVisible} onChange={e=>setOnlineVisible(e.target.checked)} /></label><label className="flex items-center justify-between rounded-xl border border-slate-800 p-4"><span><span className="block text-sm font-medium">Profile discoverable</span><span className="text-xs text-slate-500">Let compatible users see your profile.</span></span><input type="checkbox" checked={profileVisible} onChange={e=>setProfileVisible(e.target.checked)} /></label></div></div>}
        {error && <p className="mt-6 rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
        <div className="mt-8 flex gap-3"><button type="button" disabled={busy} onClick={()=>step===1?router.replace('/'):setStep(step-1)} className="rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold">Back</button>{step<4?<button type="button" onClick={next} className="ml-auto rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-slate-950">Continue</button>:<button type="button" disabled={busy} onClick={finish} className="ml-auto rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-slate-950 disabled:opacity-50">{busy?'Saving…':'Enter ShahZap'}</button>}</div>
      </section>
    </div>
  </main>
}
