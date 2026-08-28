'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Badge count = unread messages from friends + pending friend requests.
 *
 * Strategy:
 * - Server-side RPC for the source of truth
 * - Realtime INSERT on messages → optimistic +1
 * - Realtime UPDATE on messages (read_at set) → optimistic -1
 * - Realtime * on friend_requests → full re-query (relationship changed)
 * - Visibility change / focus → full re-query (catch anything we missed)
 * - 15s poll → full re-query (safety net for missed Realtime events)
 */
export function useUnreadConversations() {
  const [count, setCount] = useState(0)
  const userIdRef = useRef<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null)

  async function fetchCount(supabase: ReturnType<typeof createClient>) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    userIdRef.current = user.id
    const { data, error } = await supabase.rpc('unread_count_for_user', { uid: user.id })
    if (error) return
    setCount(data ?? 0)
  }

  useEffect(() => {
    const supabase = createClient()
    let destroyed = false

    // Initial fetch
    void fetchCount(supabase).then(() => {
      if (destroyed) return

      // Realtime subscriptions — only set up after initial fetch
      const channel = supabase
        .channel('unread-badge-v4')
        // New inbound message → optimistic +1
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            const row = payload.new as { sender_id: string }
            if (!userIdRef.current || row.sender_id === userIdRef.current) return
            setCount((prev) => prev + 1)
          },
        )
        // Message read → optimistic -1
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages' },
          (payload) => {
            const row = payload.new as { sender_id: string; read_at: string | null }
            if (!userIdRef.current || row.sender_id === userIdRef.current) return
            if (row.read_at) setCount((prev) => Math.max(0, prev - 1))
          },
        )
        // Friend request changed → full re-query (relationship or pending count changed)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'friend_requests' },
          () => { void fetchCount(supabase) },
        )
        .subscribe()

      channelRef.current = channel
    })

    // Re-fetch on visibility change or focus (catches anything Realtime missed)
    function handleVisible() {
      if (document.visibilityState === 'visible') void fetchCount(supabase)
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    // Safety-net poll every 15s
    const poll = window.setInterval(() => void fetchCount(supabase), 15_000)

    return () => {
      destroyed = true
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
      window.clearInterval(poll)
      if (channelRef.current) void supabase.removeChannel(channelRef.current)
    }
  }, [])

  return count
}
