'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Returns the number of conversations that have unread messages for the
 * current user. Updates in real-time via Supabase Realtime on new message
 * INSERTs and message UPDATEs (when read_at gets set).
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

    // Count distinct conversations where I have unread inbound messages
    const { data, error } = await supabase
      .from('messages')
      .select('conversation_id')
      .neq('sender_id', user.id)
      .is('read_at', null)

    if (error || !data) return

    const uniqueConvs = new Set(data.map((m) => m.conversation_id))
    setCount(uniqueConvs.size)
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

    // Subscribe to new messages (to increment count)
    const channel = supabase
      .channel('unread-convos-badge')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const row = payload.new as { sender_id: string; conversation_id: string; read_at: string | null }
          if (!userIdRef.current) return
          if (row.sender_id === userIdRef.current) return
          // New inbound message — if it's from a new conversation, increment
          if (!row.read_at) {
            setCount((prev) => prev + 1)
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as { sender_id: string; conversation_id: string; read_at: string | null }
          if (!userIdRef.current) return
          if (row.sender_id === userIdRef.current) return
          // Message was read — check if this conversation still has unread
          if (row.read_at) {
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
