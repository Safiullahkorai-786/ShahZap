'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { friendlyError } from '@/lib/errors'
import { Shimmer } from '@/components/shimmer'
import { AdsterraBanner } from '@/components/adsterra-banner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Ban, Clock, ShieldAlert, UserCheck, UserMinus, UserPlus } from 'lucide-react'
import { getRegionForCountry, REGION_LABELS, getCountryName } from '@/lib/regions'

const LANG_LABELS: Record<string, string> = {
  en: 'English', ur: 'Urdu', sd: 'Sindhi', hi: 'Hindi', pa: 'Punjabi', ar: 'Arabic',
  es: 'Spanish', fr: 'French', de: 'German', tr: 'Turkish',
}
const GEN_MAP: Record<string, string> = { gen_z: 'Gen Z', millennial: 'Millennial', gen_x: 'Gen X', boomer: 'Boomer' }
const GENDER_MAP: Record<string, string> = { woman: 'Woman', man: 'Man', non_binary: 'Non-binary', prefer_not_to_say: 'Prefer not to say' }

type Profile = {
  id: string; display_name: string | null; avatar_path: string | null
  age_band: string | null; generation: string | null; gender: string | null; orientation: string | null
  bio: string | null; country_code: string | null; interface_language: string | null; chat_language: string | null
  online_visible: boolean; profile_visible: boolean; generation_visible: boolean
  country_visible: boolean; region_visible: boolean; gender_visible: boolean; age_band_visible: boolean
  language_visible: boolean; languages_known_visible: boolean; interests_visible: boolean; languages_known: string[] | null; last_active_at: string | null
}

export default function ProfilePage() {
  const params = useParams<{ profileId: string }>()
  const router = useRouter()
  const id = params.profileId
  const [profile, setProfile] = useState<Profile | null>(null)
  const [own, setOwn] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [openingChat, setOpeningChat] = useState(false)
  const [friendState, setFriendState] = useState<'unknown' | 'none' | 'outgoing' | 'incoming' | 'friends'>('unknown')
  const [confirmUnfriend, setConfirmUnfriend] = useState(false)
  const [blockedAny, setBlockedAny] = useState(false)
  const [blockedByMe, setBlockedByMe] = useState(false)
  const [reqBlocked, setReqBlocked] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reason, setReason] = useState('harassment')
  const [details, setDetails] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [languagesKnown, setLanguagesKnown] = useState<string[]>([])

  useEffect(() => {
    const supabase = createClient()
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      setOwn(user.id === id)
      setMe(user.id)

      const bl = await supabase.from('blocks').select('blocker_id,blocked_id').or(`blocker_id.eq.${user.id},blocked_id.eq.${user.id}`)
      setBlockedAny((bl.data ?? []).some(b => (b.blocker_id === id && b.blocked_id === user.id) || (b.blocked_id === id && b.blocker_id === user.id)))
      setBlockedByMe((bl.data ?? []).some(b => b.blocker_id === user.id && b.blocked_id === id))

      const fr = await supabase.from('friend_requests').select('sender_id,status').or(`and(sender_id.eq.${user.id},receiver_id.eq.${id}),and(sender_id.eq.${id},receiver_id.eq.${user.id})`).in('status', ['pending', 'accepted']).maybeSingle()
      const { count: declinedCount } = await supabase.from('friend_requests').select('id', { count: 'exact', head: true }).eq('sender_id', user.id).eq('receiver_id', id).eq('status', 'declined')
      setReqBlocked((declinedCount ?? 0) >= 3)
      setFriendState(!fr.data ? 'none' : fr.data.status === 'accepted' ? 'friends' : (fr.data as { sender_id: string }).sender_id === user.id ? 'outgoing' : 'incoming')

      const { data, error: e } = await supabase.from('profiles').select('id,display_name,avatar_path,age_band,generation,gender,orientation,bio,country_code,interface_language,chat_language,languages_known,online_visible,profile_visible,generation_visible,country_visible,region_visible,gender_visible,age_band_visible,language_visible,languages_known_visible,interests_visible,last_active_at').eq('id', id).maybeSingle()
      if (e) setError(friendlyError(e, 'Could not load this profile.'))
      else {
        setProfile(data as Profile | null)
        // Load interests if visible
        if (data?.interests_visible && !own) {
          const { data: intRows } = await supabase
            .from('profile_interests')
            .select('interests(name)')
            .eq('profile_id', id)
          if (intRows) {
            setInterests(intRows.map((r: any) => r.interests?.name).filter(Boolean))
          }
        }
        // Load languages known from profile
        if (data?.languages_known_visible && !own) {
          setLanguagesKnown((data as any).languages_known ?? [])
        }
      }
    })()
  }, [id, router, own])

  useEffect(() => { if (!status) return; const t = window.setTimeout(() => setStatus(''), 10_000); return () => window.clearTimeout(t) }, [status])

  useEffect(() => {
    if (!id) return
    const supabase = createClient()
    const ch = supabase.channel(`profile:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${id}` }, (payload) => {
        const r = payload.new as { last_active_at?: string | null }
        setProfile((p) => p ? { ...p, last_active_at: r.last_active_at ?? p.last_active_at } : p)
      }).subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [id])

  async function friendAction(action: 'send' | 'cancel' | 'unfriend') {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setStatus('')
    if (action === 'send') {
      setStatus('Connecting…')
      const { data, error: e } = await supabase.rpc('send_friend_request', { p_receiver: id })
      if (e) { setStatus(friendlyError(e, 'Could not send the friend request. Please try again.')); return }
      const st = (data as { status?: string })?.status
      if (st === 'friends' || st === 'auto_accepted') { setFriendState('friends'); setStatus('You are now friends! 🎉') }
      else { setFriendState('outgoing'); setStatus('Friend request sent.') }
      return
    }
    if (action === 'cancel') { await supabase.rpc('cancel_friend_request', { p_receiver: id }); setFriendState('none'); setStatus('Friend request cancelled.'); return }
    await supabase.rpc('unfriend', { p_other: id }); setFriendState('none'); setConfirmUnfriend(false); setStatus('Unfriended.')
  }

  async function openChat() {
    if (openingChat) return
    setOpeningChat(true); setError('')
    const supabase = createClient()
    const { data, error: e } = await supabase.rpc('start_direct_chat', { p_other_profile_id: id })
    setOpeningChat(false)
    if (e) { setError(friendlyError(e, 'Could not open the chat. Please try again.')); return }
    router.push(`/chat/${data as string}`)
  }

  const REPORT_REASONS = ['harassment', 'spam', 'hate_speech', 'sexual_content', 'scam', 'impersonation', 'underage_concern', 'threatening_behavior', 'other']

  async function toggleBlock() {
    if (!me) return
    const supabase = createClient()
    setStatus('')
    if (blockedByMe) {
      const { error: e } = await supabase.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', id)
      if (e) { setStatus(friendlyError(e, 'Could not unblock.')); return }
      setBlockedByMe(false); setBlockedAny(false); setStatus('Unblocked.')
    } else {
      const { error: e } = await supabase.from('blocks').upsert({ blocker_id: me, blocked_id: id }, { onConflict: 'blocker_id,blocked_id' })
      if (e) { setStatus(friendlyError(e, 'Could not block.')); return }
      setBlockedByMe(true); setBlockedAny(true); setStatus('Blocked. They can no longer match with you.')
    }
  }

  async function submitReport() {
    if (!me) return
    setStatus('')
    const supabase = createClient()
    const { error: e } = await supabase.from('reports').insert({ reporter_id: me, reported_profile_id: id, reason, details: details.trim().slice(0, 1000) || null })
    if (e) { setStatus(friendlyError(e, 'Could not submit the report.')); return }
    setDetails(''); setReportOpen(false); setStatus('Report submitted. Thank you for helping keep ShahZap safe.')
  }

  if (error) return <main className="min-h-screen bg-slate-950 p-8 text-red-200">{error}</main>

  if (!profile) return (
    <main className="min-h-screen bg-slate-950 p-8">
      <div aria-busy="true" className="mx-auto max-w-xl px-4 pt-10">
        <div className="rounded-3xl border border-slate-800 bg-slate-900 p-7">
          <div className="flex items-center gap-4"><Shimmer className="h-16 w-16 rounded-full" /><div className="flex-1 space-y-2"><Shimmer className="h-5 w-40 rounded" /><Shimmer className="h-3 w-24 rounded" /></div></div>
          <div className="mt-6 space-y-3"><Shimmer className="h-10 w-full rounded-xl" /><Shimmer className="h-10 w-full rounded-xl" /><Shimmer className="h-10 w-2/3 rounded-xl" /></div>
        </div>
      </div>
    </main>
  )

  const isOnline = profile.online_visible && profile.last_active_at && (Date.now() - new Date(profile.last_active_at).getTime()) < 20_000

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white">
      <div className="mx-auto max-w-xl px-4">
        <button onClick={() => router.back()} className="text-sm text-slate-400">← Back</button>
        <section className="mt-6 rounded-3xl border border-slate-800 bg-slate-900 p-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-cyan-300">⚡ ShahZap profile</p>
              <h1 className="mt-2 text-3xl font-bold">{profile.display_name ?? 'ShahZap user'}</h1>
            </div>
            {isOnline && <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">Online</span>}
          </div>

          {own ? (
            <p className="mt-4 text-sm text-slate-400">This is your profile. Use your settings to control discovery and field visibility.</p>
          ) : !profile.profile_visible ? (
            <p className="mt-4 text-sm text-slate-400">This profile is private.</p>
          ) : (
            <div className="mt-6 grid gap-3">
              {profile.bio && <p className="text-sm leading-relaxed text-slate-300">{profile.bio}</p>}
              {profile.age_band_visible && profile.age_band && <div className="rounded-xl bg-slate-950 p-3 text-sm">Age band: {profile.age_band.replace('_', '–')}</div>}
              {profile.generation_visible && profile.generation && <div className="rounded-xl bg-slate-950 p-3 text-sm">Generation: {GEN_MAP[profile.generation] ?? profile.generation}</div>}
              {profile.gender_visible && profile.gender && <div className="rounded-xl bg-slate-950 p-3 text-sm">Gender: {GENDER_MAP[profile.gender] ?? profile.gender}</div>}
              {profile.country_visible && profile.country_code && <div className="rounded-xl bg-slate-950 p-3 text-sm">Country: {getCountryName(profile.country_code) ?? profile.country_code}</div>}
              {profile.region_visible && profile.country_code && (() => {
                const continent = getRegionForCountry(profile.country_code)
                return continent ? <div className="rounded-xl bg-slate-950 p-3 text-sm">Region: {REGION_LABELS[continent] ?? continent}</div> : null
              })()}
              {profile.orientation && <div className="rounded-xl bg-slate-950 p-3 text-sm">Orientation: {profile.orientation}</div>}
              {profile.language_visible && profile.chat_language && <div className="rounded-xl bg-slate-950 p-3 text-sm">Chat language: {LANG_LABELS[profile.chat_language] ?? profile.chat_language}</div>}
              {profile.languages_known_visible && languagesKnown.length > 0 && (
                <div className="rounded-xl bg-slate-950 p-3 text-sm">
                  <span className="font-semibold">Languages: </span>
                  <span className="text-slate-300">{languagesKnown.map((v) => LANG_LABELS[v] ?? v).join(', ')}</span>
                </div>
              )}
              {profile.interests_visible && interests.length > 0 && (
                <div className="rounded-xl bg-slate-950 p-3 text-sm">
                  <span className="font-semibold">Interests: </span>
                  <span className="text-slate-300">{interests.join(', ')}</span>
                </div>
              )}

              {!blockedAny && (
                <div className="mt-6 flex flex-wrap gap-3">
                  {friendState === 'none' && (
                    reqBlocked ? (
                      <span className="flex cursor-not-allowed items-center gap-2 rounded-xl border border-slate-800 px-5 py-3 font-semibold text-slate-500">
                        <UserPlus size={16} className="text-slate-600" /> Requests off (3× declined)
                      </span>
                    ) : (
                      <button onClick={() => void friendAction('send')} className="flex items-center gap-2 rounded-xl border border-cyan-800 bg-cyan-950/30 px-5 py-3 font-semibold text-cyan-300 transition hover:bg-cyan-900/30">
                        <UserPlus size={16} /> Add friend
                      </button>
                    )
                  )}
                  {friendState === 'outgoing' && (
                    <button onClick={() => void friendAction('cancel')} className="flex items-center gap-2 rounded-xl border border-slate-700 px-5 py-3 font-semibold text-slate-300">
                      <Clock size={16} /> Cancel request
                    </button>
                  )}
                  {friendState === 'incoming' && (
                    <button onClick={() => void friendAction('send')} className="flex items-center gap-2 rounded-xl border border-emerald-800 bg-emerald-950/30 px-5 py-3 font-semibold text-emerald-300">
                      <UserCheck size={16} /> Accept friend
                    </button>
                  )}
                  {friendState === 'friends' && (
                    <button onClick={() => setConfirmUnfriend(true)} className="flex items-center gap-2 rounded-xl border border-slate-700 px-5 py-3 font-semibold text-slate-300">
                      <UserMinus size={16} /> Unfriend
                    </button>
                  )}
                  {!blockedByMe && (
                    <button onClick={() => void openChat()} disabled={openingChat} className="flex items-center gap-2 rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 transition hover:brightness-110 disabled:opacity-50">
                      💬 Chat
                    </button>
                  )}
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                {blockedByMe ? (
                  <button onClick={() => void toggleBlock()} className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:text-white">
                    <Ban size={14} /> Unblock
                  </button>
                ) : (
                  <button onClick={() => void toggleBlock()} className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:text-white">
                    <Ban size={14} /> Block
                  </button>
                )}
                <button onClick={() => setReportOpen(true)} className="flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:text-white">
                  <ShieldAlert size={14} /> Report
                </button>
              </div>
            </div>
          )}

          {status && <p className="mt-4 rounded-xl bg-cyan-950/30 p-3 text-sm text-cyan-200">{status}</p>}
        </section>

        <div className="mt-5 flex justify-center">
          <AdsterraBanner size="300x250" />
        </div>
      </div>

      {confirmUnfriend && (
        <ConfirmDialog open={confirmUnfriend} title="Unfriend?" confirmLabel="Unfriend" onConfirm={() => void friendAction('unfriend')} onCancel={() => setConfirmUnfriend(false)}
          message="Remove this person from your friends list?" />
      )}

      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setReportOpen(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Report profile</h2>
            <div className="mt-4 space-y-3">
              <p className="text-sm text-slate-400">Why are you reporting this profile?</p>
              <div className="flex flex-wrap gap-2">
                {REPORT_REASONS.map((r) => (
                  <button key={r} onClick={() => setReason(r)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${reason === r ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200' : 'border-slate-700 text-slate-400'}`}>
                    {r.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Optional details…" maxLength={1000}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400" />
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setReportOpen(false)} className="flex-1 rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white">Cancel</button>
              <button onClick={() => void submitReport()} className="flex-1 rounded-xl bg-red-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-400">Submit report</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
