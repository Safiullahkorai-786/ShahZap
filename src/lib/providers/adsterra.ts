/**
 * Adsterra rewarded-ad → Chat Pass grant (server-side only).
 *
 * Security model (Phase 13C-1):
 *   - The client can never decide an ad was "watched" or grant itself a
 *     pass. Only POST /api/rewards/adsterra/grant grants entitlements.
 *   - Auth is verified with the caller's cookies; writes use the
 *     service-role client because chat_passes intentionally has no INSERT
 *     policy for end users.
 *   - Rate limit: 1 Chat Pass per 30 minutes per user, enforced by
 *     checking recent rewarded_ad passes before inserting.
 *
 * Valid enum values (enforced by DB CHECK constraints):
 *   - chat_passes.source must be one of 'rewarded_ad'|'zap_points'|'reward'|'premium'
 *   - reward_ledger.currency must be one of 'xp'|'zap_points'|'region_credits'|'reward_tokens'
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const PASS_SECONDS = 1800 // 30 minutes
const COOLDOWN_MS = 30 * 60 * 1000

export function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type GrantResult =
  | { granted: true; passId: string }
  | { granted: false; reason: 'rate_limited' | 'not_configured' | 'error'; error?: string }

export async function grantRewardedPass(
  admin: SupabaseClient,
  userId: string
): Promise<GrantResult> {
  // 1. Rate limit: any rewarded_ad pass in the last 30 minutes blocks a new one.
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: recent, error: recentError } = await admin
    .from('chat_passes')
    .select('id')
    .eq('profile_id', userId)
    .eq('source', 'rewarded_ad')
    .gte('created_at', since)
    .limit(1);

  if (recentError) {
    return { granted: false, reason: 'error', error: recentError.message };
  }
  if (recent && recent.length > 0) {
    return { granted: false, reason: 'rate_limited' };
  }

  // 2. Idempotent-ish grant: create exactly one new pass.
  const { data: pass, error: insertError } = await admin
    .from('chat_passes')
    .insert({
      profile_id: userId,
      duration_seconds: PASS_SECONDS,
      remaining_seconds: PASS_SECONDS,
      source: 'rewarded_ad',
      status: 'available',
    })
    .select('id')
    .single();

  if (insertError || !pass) {
    return { granted: false, reason: 'error', error: insertError?.message };
  }

  return { granted: true, passId: pass.id };
}
