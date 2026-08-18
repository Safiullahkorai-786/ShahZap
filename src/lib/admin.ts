import { createClient } from '@/lib/supabase/client'

export async function recordAdminAction(action: string, targetType?: string, targetId?: string, metadata: Record<string, unknown> = {}) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('admin_record_action', { p_action: action, p_target_type: targetType ?? null, p_target_id: targetId ?? null, p_metadata: metadata })
  return error ? { error: error.message } : { data }
}
