// deno-lint-ignore-file no-explicit-any
import webpush from 'npm:web-push@3.6.7'
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// ── Configuration (set as Edge Function secrets) ──────────────────────────
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@shahzap.safiullahkorai.com'
const PUSH_HOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const HEADLINES: Record<string, string> = {
  message: 'New message',
  friend_request: 'Friend request',
  accept: 'Friend request accepted',
  reject: 'Friend request declined',
  unfriend: 'Unfriended',
  blocked: 'Blocked you',
  delete_chat: 'Chat deleted',
}

function urlFor(kind: string, conversationId?: string | null): string {
  if (kind === 'message' && conversationId) return `/chat/${conversationId}`
  if (kind === 'friend_request' || kind === 'accept') return '/friends?tab=pending'
  return '/friends'
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extra, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Only the DB webhook (or a client with the hook secret) may send pushes.
  const auth = req.headers.get('authorization') ?? ''
  if (!PUSH_HOOK_SECRET || auth !== `Bearer ${PUSH_HOOK_SECRET}`) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (!VAPID_PRIVATE_KEY || !VAPID_PUBLIC_KEY) {
    return json({ error: 'vapid not configured' }, 500)
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }

  const userId = payload?.user_id
  const kind = payload?.kind ?? ''
  if (!userId || !HEADLINES[kind]) {
    return json({ error: 'unprocessable' }, 422)
  }

  // Fetch the user's subscriptions with the service role.
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (error || !subs || subs.length === 0) {
    return json({ ok: true, sent: 0 })
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  const title = HEADLINES[kind]
  const clickPath = urlFor(kind, payload.conversation_id)
  const notificationPayload = JSON.stringify({
    title,
    kind,
    clickPath,
    conversationId: payload.conversation_id ?? null,
    fromUserId: payload.from_user_id ?? null,
    text: payload.text ?? '',
  })

  let sent = 0
  const failed: string[] = []

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        notificationPayload,
        { TTL: 172800 }, // 48h
      )
      sent += 1
    } catch (err: any) {
      const status = err?.statusCode
      // 404/410: endpoint is gone — clean it up.
      if (status === 404 || status === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id)
      } else if (status === 403) {
        // Suppressed / too many — drop without retrying immediately.
        failed.push(sub.id)
      } else if (status === 429) {
        // Rate limited — leave the subscription for a later attempt.
        failed.push(sub.id)
      }
    }
  }

  return json({ ok: true, sent, failed })
})
