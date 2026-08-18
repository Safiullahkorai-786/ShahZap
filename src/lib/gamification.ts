import { createClient } from '@/lib/supabase/client'

export async function getGamification() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }
  const { data, error } = await supabase.from('gamification_profiles').select('*').eq('profile_id', user.id).maybeSingle()
  if (error) return { error: error.message }
  return { data }
}

export async function getActiveQuests() {
  const supabase = createClient()
  const { data, error } = await supabase.from('quests').select('id,code,title,description,xp_reward,zap_reward,cadence').eq('active', true).order('cadence')
  return error ? { error: error.message } : { data: data ?? [] }
}

export async function applyGamificationEvent(source: string, zap: number, xp: number, metadata: Record<string, unknown> = {}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }
  const { data, error } = await supabase.rpc('gamification_apply_event', { p_profile_id: user.id, p_source: source, p_zap: zap, p_xp: xp, p_kind: zap < 0 ? 'spend' : 'earn', p_metadata: metadata })
  return error ? { error: error.message } : { data }
}
