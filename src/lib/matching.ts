import { createClient } from '@/lib/supabase/client'

export type MatchResult = { conversationId: string; matchedProfileId: string } | { error: string }

export async function joinMatchQueue() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }

  const { data: preferences } = await supabase.from('match_preferences').select('interest_wait_seconds').eq('profile_id', user.id).maybeSingle()
  const timeout = preferences?.interest_wait_seconds ?? 15
  const expires = new Date(Date.now() + timeout * 1000).toISOString()
  const { error } = await supabase.from('match_queue').upsert({ profile_id: user.id, status: 'waiting', expires_at: expires, queued_at: new Date().toISOString(), matched_conversation_id: null }, { onConflict: 'profile_id' })
  return error ? { error: error.message } : { expiresAt: expires }
}

export async function leaveMatchQueue() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }
  const { error } = await supabase.from('match_queue').update({ status: 'cancelled' }).eq('profile_id', user.id).eq('status', 'waiting')
  return error ? { error: error.message } : { ok: true }
}

export async function findBestMatch(): Promise<MatchResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }

  const { data, error } = await supabase.rpc('match_next', { p_profile_id: user.id })
  if (error) return { error: error.message }
  const match = data?.[0]
  if (!match) return { error: 'No compatible match yet.' }
  return { conversationId: match.conversation_id, matchedProfileId: match.matched_profile_id }
}
