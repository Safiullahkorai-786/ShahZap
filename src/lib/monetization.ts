import { createClient } from '@/lib/supabase/client'

export async function getPremiumPlans() {
  const supabase = createClient()
  const { data, error } = await supabase.from('premium_plans').select('id,code,title,description,duration_days,price_minor,currency').eq('active', true).order('duration_days')
  return error ? { error: error.message } : { data: data ?? [] }
}

export async function getPremiumStatus() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You need an active session.' }
  const { data, error } = await supabase.from('premium_subscriptions').select('id,status,starts_at,ends_at,plan_id').eq('profile_id', user.id).eq('status', 'active').gt('ends_at', new Date().toISOString()).order('ends_at', { ascending: false }).limit(1).maybeSingle()
  return error ? { error: error.message } : { data }
}

export async function redeemRewardedChatPass(provider = 'rewarded-web') {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('grant_rewarded_chat_pass', { p_provider: provider, p_provider_event_id: null })
  return error ? { error: error.message } : { data }
}
