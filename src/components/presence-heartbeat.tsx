'use client'

/*
 * Keeps profiles.last_active_at fresh while the tab is visible so the
 * online directory can show who is actually online. Renders nothing.
 */

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export function PresenceHeartbeat({ intervalSeconds = 45 }: { intervalSeconds?: number }) {
  useEffect(() => {
    const supabase = createClient()
    let stopped = false
    async function ping() {
      if (document.visibilityState !== 'visible' || stopped) return
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('profiles')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', user.id)
    }
    void ping()
    const timer = setInterval(() => void ping(), intervalSeconds * 1000)
    const onVisible = () => void ping()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalSeconds])
  return null
}
