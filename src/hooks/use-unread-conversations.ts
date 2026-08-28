'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Returns the number of unread conversations + pending friend requests.
 * Uses a server-side RPC function for the initial count, then increments/
 * decrements via Realtime events.
 */
export function useUnreadConversations() {
  const [count, setCount] = useState(0)
  const userIdRef = useRef<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null)

  useEffect(() => {
    const supabase = createClient()
    let destroyed = false

    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || destroyed) return
      userIdRef.current = user.id

      const { data, error } = await supabase.rpc('unread_count_for_user', { uid: user.id })
      if (destroyed) return
      if (error) {
        console.error('[badge] rpc error:', error.message)
        return
      }
      setCount(data ?? 0)
    }

    void init()

    const channel = supabase
      .channel('unread-badge-v3')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as { sender_id: string }
          if (!userIdRef.current || row.sender_id === userIdRef.current) return
          setCount((prev) => prev + 1)
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as { sender_id: string; read_at: string | null }
          if (!userIdRef.current || row.sender_id === userIdRef.current) return
          if (row.read_at) setCount((prev) => Math.max(0, prev - 1))
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests' },
        async () => {
          if (!userIdRef.current) return
          const { data } = await supabase.rpc('unread_count_for_user', { uid: userIdRef.current })
          if (data != null) setCount(data)
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      destroyed = true
      if (channelRef.current) void supabase.removeChannel(channelRef.current)
    }
  }, [])

  return count
}
