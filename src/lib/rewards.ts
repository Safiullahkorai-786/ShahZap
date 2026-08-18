import { createClient } from '@/lib/supabase/client'

export async function getRewards() {
  const supabase = createClient()
  const { data, error } = await supabase.from('rewards_catalog').select('id,code,title,description,cost_zap_points,reward_type,reward_value').eq('active', true).order('cost_zap_points')
  return error ? { error: error.message } : { data: data ?? [] }
}

export async function getRewardWallet() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }
  const [credits, passes, shields] = await Promise.all([
    supabase.from('region_credits').select('balance').eq('profile_id', user.id).maybeSingle(),
    supabase.from('chat_passes').select('id,source,started_at,expires_at,remaining_seconds,status,created_at').eq('profile_id', user.id).in('status', ['available','active']).order('created_at', { ascending: false }),
    supabase.from('streak_shields').select('balance').eq('profile_id', user.id).maybeSingle(),
  ])
  const error = credits.error ?? passes.error ?? shields.error
  return error ? { error: error.message } : { data: { credits: credits.data?.balance ?? 0, passes: passes.data ?? [], shields: shields.data?.balance ?? 0 } }
}

export async function redeemReward(code: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('redeem_reward', { p_reward_code: code })
  return error ? { error: error.message } : { data }
}

export async function activateChatPass(id: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('activate_chat_pass', { p_pass_id: id })
  return error ? { error: error.message } : { data }
}
