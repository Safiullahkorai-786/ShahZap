import { createClient } from '@/lib/supabase/client'

export type MatchResult = { conversationId: string; matchedProfileId: string } | { error: string }

export type MatchFilterOverrides = {
  preferred_genders?: string[]
  preferred_generations?: string[]
  preferred_age_bands?: string[]
  preferred_continents?: string[]
  preferred_languages?: string[]
  preferred_orientations?: string[]
  preferred_interests?: string[]
}

export async function getMatchPreferences() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('match_preferences')
    .select('preferred_age_bands,preferred_genders,preferred_orientations,preferred_generations,preferred_languages,preferred_continents,preferred_interests,interest_wait_seconds,country_targeting_enabled')
    .eq('profile_id', user.id)
    .maybeSingle()
  return data as {
    preferred_age_bands?: string[]; preferred_genders?: string[]; preferred_orientations?: string[];
    preferred_generations?: string[]; preferred_languages?: string[]; preferred_continents?: string[];
    preferred_interests?: string[]; interest_wait_seconds?: number; country_targeting_enabled?: boolean;
  } | null
}

export async function updateMatchPreferences(overrides: MatchFilterOverrides) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('match_preferences').upsert({ profile_id: user.id, ...overrides }, { onConflict: 'profile_id' })
}

export async function joinMatchQueue() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }

  const { data: preferences } = await supabase.from('match_preferences').select('interest_wait_seconds').eq('profile_id', user.id).maybeSingle()
  const timeout = Math.max(preferences?.interest_wait_seconds ?? 5, 5)
  const expires = new Date(Date.now() + timeout * 1000).toISOString()
  const { error } = await supabase.from('match_queue').upsert({ profile_id: user.id, status: 'waiting', expires_at: expires, queued_at: new Date().toISOString(), matched_conversation_id: null }, { onConflict: 'profile_id' })
  return error ? { error: error.message } : { expiresAt: expires }
}

// Refreshes the expiry of your own waiting entry. Uses a conditional UPDATE
// (not upsert) so it can never resurrect a row that was already matched.
export async function renewMatchQueue() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return false
  const expires = new Date(Date.now() + 60 * 1000).toISOString()
  const { data } = await supabase
    .from('match_queue')
    .update({ expires_at: expires })
    .eq('profile_id', user.id)
    .eq('status', 'waiting')
    .select('id')
  return (data?.length ?? 0) > 0
}

export async function getQueueCount(): Promise<number | null> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('match_queue_count')
  if (error || typeof data !== 'number') return null
  return data
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

// The other side of the handshake: when the partner's poll paired the two of
// you, YOUR queue row is flipped to status='matched' with a conversation id.
// The match page polls this so both sides land in the chat automatically.
export async function getMatchedConversation(): Promise<string | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('match_queue')
    .select('matched_conversation_id')
    .eq('profile_id', user.id)
    .eq('status', 'matched')
    .maybeSingle()
  return data?.matched_conversation_id ?? null
}
