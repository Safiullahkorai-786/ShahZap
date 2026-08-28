'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Live count of how many people are currently looking for a match.
 *
 * Strategy:
 * - Server-side RPC (match_queue_count) for the source of truth
 * - Realtime * on match_queue → full re-query (someone joined/left/matched)
 * - Visibility change / focus → full re-query (catch anything missed)
 * - 15s poll → full re-query (safety net + expiry churn)
 */
export function useMatchQueueCount() {
  const [count, setCount] = useState<number | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null)

  async function fetchCount(supabase: ReturnType<typeof createClient>) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.rpc('match_queue_count')
    if (error || typeof data !== 'number') return
    setCount(data)
  }

  useEffect(() => {
    const supabase = createClient()

    void fetchCount(supabase)

    // Realtime: match_queue changed → full re-query
    const channel = supabase
      .channel('match-queue-count-v1')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_queue' },
        () => { void fetchCount(supabase) },
      )
      .subscribe()

    channelRef.current = channel

    // Re-fetch on visibility change or focus (catches anything missed)
    function handleVisible() {
      if (document.visibilityState === 'visible') void fetchCount(supabase)
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    // Safety-net poll every 15s (queue rows expire on a timer server-side)
    const poll = window.setInterval(() => void fetchCount(supabase), 15_000)

    return () => {
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
      window.clearInterval(poll)
      if (channelRef.current) void supabase.removeChannel(channelRef.current)
    }
  }, [])

  return count
}
