/*
 * Client-side Web Push (PWA / Chrome) management.
 *
 * Enabling push: ensures browser permission, gets (or creates) a push
 * subscription authorized with the app's VAPID public key, and stores it in
 * the `push_subscriptions` table via the `save_push_subscription` RPC.
 * Disabling removes the row and unsubscribes the browser.
 *
 * Delivery happens server-side (DB trigger → `notify-push` Supabase Edge
 * Function), so pushes arrive even when ShahZap is closed.
 */

import { createClient } from '@/lib/supabase/client'

// Public VAPID key — safe to ship to the browser. Must match the private key
// used by the notify-push Edge Function.
const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESAAMqqsQo0vJSbubVnpo-TLCeq3zNTtifd7KMH_pmObOPY52eO4Uh98O84gRXyAvOjIusinKovwJQ12wTzcljQ'

const PUSH_KEY = 'shahzap:push'

export type PushResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'off' | 'error'; message: string }

/** True when the browser can do push at all (secure context + SW + push). */
export function pushSupported(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** True if low-level push machinery + permission are both in place. */
export function isPushGranted(): boolean {
  if (typeof window === 'undefined') return false
  return pushSupported() && Notification.permission === 'granted'
}

/** Local flag mirror (used to render a quick, synchronous toggle state). */
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
 * Ask the browser to show the native "Allow notifications?" prompt. Browsers
 * only show it when permission is not already decided (`default`); once a
 * user has granted or denied from site settings, no prompt appears — the
 * result just reflects the stored permission.
 */
function requestPermission(): Promise<NotificationPermission> {
  try {
    return Notification.requestPermission()
  } catch {
    return Promise.resolve(Notification.permission)
  }
}

/**
 * Turn web push on. Idempotent: if a subscription already exists it is reused
 * and its DB row is refreshed rather than erroring.
 */
export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) {
    return { ok: false, reason: 'unsupported', message: 'Push is not supported in this browser.' }
  }

  // Permission gates the whole feature. If the user has denied it (or removed
  // it from site settings), no prompt can appear — surface that clearly.
  if (Notification.permission === 'denied') {
    return {
      ok: false,
      reason: 'denied',
      message:
        'Notifications are turned off for this site in your browser. Enable them in your browser/site settings, then try again.',
    }
  }

  // Only ask if we haven't got permission yet (avoids dead prompts).
  if (Notification.permission !== 'granted') {
    const perm = await requestPermission()
    if (perm !== 'granted') {
      return {
        ok: false,
        reason: 'denied',
        message:
          'You declined notifications. Allow them to receive push notifications, then try again.',
      }
    }
  }

  try {
    const reg = await navigator.serviceWorker.ready

    // Get or create the subscription. Retry once on a transient failure
    // (e.g. racing the permission grant).
    let sub = await getOrSubscribe(reg)
    if (!sub) {
      try {
        sub = await getOrSubscribe(reg, true)
      } catch (e) {
        return { ok: false, reason: 'error', message: describe(e) }
      }
    }
    if (!sub) return { ok: false, reason: 'error', message: 'Could not create a push subscription.' }

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
    if (error) {
      console.error('save_push_subscription rpc failed:', error)
      return { ok: false, reason: 'error', message: `Push could not be saved (${describe(error)}).` }
    }

    setPushEnabled(true)
    return { ok: true }
  } catch (e) {
    console.error('enablePush failed:', e)
    return { ok: false, reason: 'error', message: describe(e) }
  }
}

async function getOrSubscribe(
  reg: ServiceWorkerRegistration,
  force = false,
): Promise<PushSubscription | null> {
  if (!force) {
    const existing = await reg.pushManager.getSubscription()
    if (existing) return existing
  }
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
}

/** Turn web push off: unsubscribe the browser and remove the DB row. */
export async function disablePush(): Promise<PushResult> {
  if (!pushSupported()) return { ok: true }
  try {
    const supabase = createClient()
    let endpoint: string | null = null

    let reg: ServiceWorkerRegistration | null = null
    try { reg = await navigator.serviceWorker.ready } catch {}
    try {
      const sub = reg ? await reg.pushManager.getSubscription() : null
      if (sub) {
        endpoint = sub.endpoint
        await sub.unsubscribe()
      }
    } catch (e) {
      console.error('unsubscribe failed:', e)
    }

    if (endpoint) {
      const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint })
      if (error) {
        console.error('delete_push_subscription rpc failed:', error)
        return { ok: false, reason: 'error', message: `Push could not be disabled (${describe(error)}).` }
      }
    }

    setPushEnabled(false)
    return { ok: true }
  } catch (e) {
    console.error('disablePush failed:', e)
    return { ok: false, reason: 'error', message: describe(e) }
  }
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try { return JSON.stringify(e) } catch { return 'Unknown error' }
}
