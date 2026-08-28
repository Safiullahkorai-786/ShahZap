'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Returns the number of items needing attention: conversations with unread
 * messages + pending friend requests. Updates in real-time via Supabase
 * Realtime on new messages, message reads, and friend request changes.
 */
export function useUnreadConversations() {
  const [count, setCount] = useState(0)
  const userIdRef = useRef<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null)

  const fetchCount = useCallback(async () => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    userIdRef.current = user.id

    // Count distinct conversations with unread inbound messages
    const { data: msgData } = await supabase
      .from('messages')
      .select('conversation_id')
      .neq('sender_id', user.id)
      .is('read_at', null)

    const unreadMsgConvs = msgData ? new Set(msgData.map((m) => m.conversation_id)).size : 0

    // Count pending friend requests sent TO me
    const { count: reqCount } = await supabase
      .from('friend_requests')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', user.id)
      .eq('status', 'pending')

    setCount(unreadMsgConvs + (reqCount ?? 0))
  }, [])

  useEffect(() => {
    const supabase = createClient()

    void fetchCount()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        userIdRef.current = session.user.id
        void fetchCount()
      }
    })

    const channel = supabase
      .channel('unread-badge-all')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as { sender_id: string; read_at: string | null }
          if (!userIdRef.current || row.sender_id === userIdRef.current) return
          if (!row.read_at) setCount((prev) => prev + 1)
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
        { event: 'INSERT', schema: 'public', table: 'friend_requests' },
        (payload) => {
          const row = payload.new as { receiver_id: string; status: string }
          if (!userIdRef.current) return
          if (row.receiver_id === userIdRef.current && row.status === 'pending') {
            setCount((prev) => prev + 1)
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'friend_requests' },
        (payload) => {
          const row = payload.new as { receiver_id: string; status: string }
          if (!userIdRef.current) return
          if (row.receiver_id === userIdRef.current && row.status !== 'pending') {
            setCount((prev) => Math.max(0, prev - 1))
          }
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      subscription.unsubscribe()
      if (channelRef.current) void supabase.removeChannel(channelRef.current)
    }
  }, [fetchCount])

  return count
}
