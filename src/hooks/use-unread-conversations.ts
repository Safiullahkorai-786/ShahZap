'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Badge count = (conversations with unread messages from friends) + (pending friend requests).
 *
 * Strategy:
 * - Server-side RPC for the source of truth
 * - Realtime * on friend_requests → full re-query (relationship changed)
 * - Visibility change / focus → full re-query (catch anything missed)
 * - 15s poll → full re-query (safety net)
 */
export function useUnreadConversations() {
  const [count, setCount] = useState(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null)

  async function fetchCount(supabase: ReturnType<typeof createClient>) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.rpc('unread_count_for_user', { uid: user.id })
    if (error) return
    setCount(data ?? 0)
  }

  useEffect(() => {
    const supabase = createClient()

    void fetchCount(supabase)

    // Realtime: friend_requests changed → full re-query
    const channel = supabase
      .channel('unread-badge-v5')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests' },
        () => { void fetchCount(supabase) },
      )
      .subscribe()

    channelRef.current = channel

    // Re-fetch on visibility change or focus (catches messages being read, new messages, etc.)
    function handleVisible() {
      if (document.visibilityState === 'visible') void fetchCount(supabase)
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    // Safety-net poll every 15s
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
