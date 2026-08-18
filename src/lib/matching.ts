import { createClient } from '@/lib/supabase/client'

export type MatchResult = { conversationId: string; matchedProfileId: string } | { error: string }

export async function joinMatchQueue() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }

  const { data: preferences } = await supabase.from('match_preferences').select('interest_timeout_seconds').eq('profile_id', user.id).maybeSingle()
  const timeout = preferences?.interest_timeout_seconds ?? 15
  const expires = new Date(Date.now() + timeout * 1000).toISOString()
  const { error } = await supabase.from('match_queue').upsert({ profile_id: user.id, status: 'waiting', expires_at: expires, queued_at: new Date().toISOString() }, { onConflict: 'profile_id' })
  return error ? { error: error.message } : { expiresAt: expires }
}

export async function leaveMatchQueue() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }
  const { error } = await supabase.from('match_queue').update({ status: 'cancelled' }).eq('profile_id', user.id).eq('status', 'waiting')
  return error ? { error: error.message } : { ok: true }
}

export async function findBestMatch() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }

  const { data: candidates, error } = await supabase.from('match_queue').select('profile_id, profiles!inner(profile_visible, age_band, chat_language, generation)').eq('status', 'waiting').neq('profile_id', user.id).limit(50)
  if (error) return { error: error.message }

  let best: { id: string; score: number } | null = null
  for (const candidate of candidates ?? []) {
    const { data: score } = await supabase.rpc('matching_score', { p_a: user.id, p_b: candidate.profile_id })
    if (typeof score === 'number' && score >= 0 && (!best || score > best.score)) best = { id: candidate.profile_id, score }
  }
  if (!best) return { error: 'No compatible match yet.' }

  const { data: conversation, error: conversationError } = await supabase.from('conversations').insert({ kind: 'random', status: 'active' }).select('id').single()
  if (conversationError) return { error: conversationError.message }
  const participants = [{ conversation_id: conversation.id, profile_id: user.id }, { conversation_id: conversation.id, profile_id: best.id }]
  const { error: participantError } = await supabase.from('conversation_participants').insert(participants)
  if (participantError) return { error: participantError.message }
  await supabase.from('match_queue').update({ status: 'matched', matched_conversation_id: conversation.id }).in('profile_id', [user.id, best.id]).eq('status', 'waiting')
  return { conversationId: conversation.id, matchedProfileId: best.id }
}
