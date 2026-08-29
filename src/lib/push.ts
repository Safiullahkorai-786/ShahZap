/*
 * Client-side Web Push (PWA / Chrome) management.
 *
 * Enabling push: requests browser permission, gets (or creates) a push
 * subscription authorized with the app's VAPID public key, and stores it in
 * the `push_subscriptions` table via the `save_push_subscription` RPC.
 * Disabling removes the local flag, deletes the row, and unsubscribes.
 *
 * The actual delivery happens server-side (a DB trigger → the `notify-push`
 * Supabase Edge Function), so pushes arrive even when ShahZap is closed.
 */

import { createClient } from '@/lib/supabase/client'

// Public VAPID key — safe to ship to the browser. Must match the private key
// used by the notify-push Edge Function.
const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESAAMqqsQo0vJSbubVnpo-TLCeq3zNTtifd7KMH_pmObOPY52eO4Uh98O84gRXyAvOjIusinKovwJQ12wTzcljQ'

const PUSH_KEY = 'shahzap:push'

/** True when the browser can do push at all (secure context + SW + push). */
export function pushSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Whether push is actively enabled from the browser's real point of view. */
export function isPushGranted(): boolean {
  if (typeof window === 'undefined') return false
  return Notification.permission === 'granted'
}

export function isPushEnabled(): boolean {
  if (!pushSupported()) return false
  try { return window.localStorage.getItem(PUSH_KEY) === '1' } catch { return false }
}

function setPushEnabled(on: boolean) {
  try { window.localStorage.setItem(PUSH_KEY, on ? '1' : '0') } catch {}
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Turn web push on. Always (re-)requests permission so enabling again after a
 * revoke re-prompts; reuses an existing subscription if the browser already
 * has one. Returns true on success or a short error code on any failure.
 */
export async function enablePush(): Promise<true | ErrorCode> {
  if (!pushSupported()) return 'unsupported'
  try {
    // Always request so a revoked permission re-prompts (sticky 'granted' just
    // resolves instantly without a dialog).
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return 'denied'

    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }

    const endpoint = sub.endpoint
    const keys = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
    const p256dh = keys.keys?.p256dh ?? ''
    const auth = keys.keys?.auth ?? ''

    const supabase = createClient()
    const { error } = await supabase.rpc('save_push_subscription', {
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      p_user_agent: navigator.userAgent,
    })
    if (error) return 'db'

    setPushEnabled(true)
    return true
  } catch {
    return 'failed'
  }
}

/**
 * Turn web push off: remove the row and unsubscribe the browser. Returns true
 * on success or a short error code on failure.
 */
export async function disablePush(): Promise<true | ErrorCode> {
  if (!pushSupported()) return true
  try {
    const supabase = createClient()

    let endpoint: string | null = null
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        endpoint = sub.endpoint
        await sub.unsubscribe()
      }
    } catch {}

    if (endpoint) {
      const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint })
      if (error) return 'db'
    }

    setPushEnabled(false)
    return true
  } catch {
    return 'failed'
  }
}

export type ErrorCode = 'unsupported' | 'denied' | 'db' | 'failed'
