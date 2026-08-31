'use client'

// Development-only diagnostics for the WebRTC lifecycle.
//
// Purpose: make the real transport observable during testing (Phase 4.4).
// Every path from the page's useBackgroundP2P hook and the chat page's
// WebRTC-first routing logs a single structured event so an engineer watching
// the console can answer "did WebRTC actually reconnect after refresh?".
//
// Gating: NO logging in production builds. Even in dev, logging is off unless
// explicitly enabled by setting localStorage `__P2P_DEBUG__` to '1' (or by
// setting the URL/hash override). This keeps normal development consoles and
// every production console free of permanent spam.
//
// Safety: we never log message contents, tokens, credentials, or private data.
// Only event names, ids, transport state, counts, and safe metadata.

const STORAGE_KEY = '__P2P_DEBUG__'

let enabled = false
if (typeof window !== 'undefined') {
  try { enabled = window.localStorage.getItem(STORAGE_KEY) === '1' } catch {}
}

export function p2pDebugEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  return enabled
}

export function setP2pDebug(on: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
    enabled = on && process.env.NODE_ENV !== 'production'
  } catch {}
}

type DebugArg = string | number | boolean | null | undefined

// Core transport/state event logger for the P2P hook.
export function logP2P(event: string, fields?: Record<string, DebugArg>): void {
  if (!p2pDebugEnabled()) return
  // Prefix makes all WebRTC lifecycle lines easy to find/filter in DevTools.
  // eslint-disable-next-line no-console
  console.info(`[P2P] ${event}`, fields ?? '')
}

// Message-level logger for the chat page routing.
export function logText(fields: { case: 'webrtc' | 'supabase-fallback' | 'race-cleanup'; messageId?: string; p2pOpen?: boolean; p2pSend?: boolean }): void {
  if (!p2pDebugEnabled()) return
  const tag = fields.case === 'webrtc' ? '[TEXT] transport=webrtc' : fields.case === 'supabase-fallback' ? '[TEXT] transport=supabase-fallback' : '[TEXT] race-cleanup'
  // eslint-disable-next-line no-console
  console.info(`${tag}`, { messageId: fields.messageId, p2pOpen: fields.p2pOpen, p2pSend: fields.p2pSend })
}

// Reconciliation logger for sync-request / sync-response.
export function logReconcile(event: 'sync-request' | 'sync-response', count?: number): void {
  if (!p2pDebugEnabled()) return
  // eslint-disable-next-line no-console
  console.info(`[P2P] ${event}${count !== undefined ? ` — messages reconciled: ${count}` : ''}`)
}
