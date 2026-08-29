'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/*
 * Global presence heartbeat.
 *
 * While any ShahZap tab/PWA view is VISIBLE and the user is signed in,
 * this bumps profiles.last_active_at every 10s — plus immediately on
 * tab focus / returning from background. Close or background the app
 * and heartbeats stop, so partners see "last seen …" within 20s;
 * come back and the green dot returns in near real time (Realtime
 * broadcasts the profile update to anyone viewing the chat).
 *
 * Auth is resolved once on mount. Subsequent beats call touch_presence()
 * directly — no getUser() round-trip every 25s. On error the session
 * is re-resolved and the beat retries once.
 */

const HEARTBEAT_MS = 30_000

export function PresenceHeartbeat() {
  useEffect(() => {
    const supabase = createClient()
    let active = true
    let iv: number | null = null

    async function resolveAuth(): Promise<boolean> {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        return !!user
      } catch { return false }
    }

    async function reportPushPresence(active: boolean) {
      try {
        await supabase.rpc(active ? 'report_activity' : 'report_inactive')
      } catch {
        /* presence reporting is best-effort */
      }
    }

    async function beat() {
      if (!active || document.visibilityState !== 'visible') return
      try { if (window.localStorage.getItem('shahzap:onlineMode') === 'off') return } catch {}

      const { error } = await supabase.rpc('touch_presence')
      if (error) {
        // Session may have expired — re-resolve and retry once.
        const ok = await resolveAuth()
        if (ok && active) await supabase.rpc('touch_presence')
      }
      // Tell the push trigger the user is actively on the app tab so it does
      // NOT also send a native OS push (the in-app banner/sound cover it).
      await reportPushPresence(true)
      // Deliver any inbound messages sent while online so the sender's
      // double-tick appears (and stays) even if the DM is never opened.
      void supabase.rpc('sync_deliveries')
    }

    function onVisChange() {
      // When the user leaves the tab/PWA, immediately mark push-presence
      // inactive so native OS pushes resume (no 50s expiry wait).
      if (!active) return
      if (document.visibilityState === 'hidden') void reportPushPresence(false)
      void beat()
    }
    function onFocus() { void beat() }

    document.addEventListener('visibilitychange', onVisChange)
    window.addEventListener('focus', onFocus)

    // First beat immediately, then every 10s.
    void resolveAuth().then((ok) => {
      if (!active || !ok) return
      void beat()
      iv = window.setInterval(() => void beat(), HEARTBEAT_MS)
    })

    return () => {
      active = false
      if (iv) window.clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisChange)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return null
}
