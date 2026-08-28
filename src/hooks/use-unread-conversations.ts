'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type UnreadState = {
  total: number
  friends: Set<string>
  unreadBySender: Map<string, number>
  pendingRequests: number
}

export function useUnreadConversations() {
  const [count, setCount] = useState(0)
  const userIdRef = useRef<string | null>(null)
  const stateRef = useRef<UnreadState>({
    total: 0,
    friends: new Set(),
    unreadBySender: new Map(),
    pendingRequests: 0,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null)

  const recalc = useCallback(() => {
    const s = stateRef.current
    let msgCount = 0
    for (const [senderId, n] of s.unreadBySender) {
      if (s.friends.has(senderId)) msgCount += n
    }
    const total = msgCount + s.pendingRequests
    s.total = total
    setCount(total)
  }, [])

  const loadFriends = useCallback(async (supabase: ReturnType<typeof createClient>) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('friend_requests')
      .select('sender_id,receiver_id')
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${user.id})`)
      .eq('status', 'accepted')
    const friendIds = new Set<string>()
    if (data) {
      for (const r of data) {
        friendIds.add(r.sender_id === user.id ? r.receiver_id : r.sender_id)
      }
    }
    stateRef.current.friends = friendIds
  }, [])

  const loadUnread = useCallback(async (supabase: ReturnType<typeof createClient>) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    userIdRef.current = user.id
    const { data } = await supabase
      .from('messages')
      .select('sender_id')
      .neq('sender_id', user.id)
      .is('read_at', null)
    const bySender = new Map<string, number>()
    if (data) {
      for (const m of data) {
        bySender.set(m.sender_id, (bySender.get(m.sender_id) ?? 0) + 1)
      }
    }
    stateRef.current.unreadBySender = bySender
  }, [])

  const loadPendingRequests = useCallback(async (supabase: ReturnType<typeof createClient>) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { count } = await supabase
      .from('friend_requests')
      .select('id', { count: 'exact', head: true })
      .eq('receiver_id', user.id)
      .eq('status', 'pending')
    stateRef.current.pendingRequests = count ?? 0
  }, [])

  useEffect(() => {
    const supabase = createClient()

    async function init() {
      await Promise.all([loadFriends(supabase), loadUnread(supabase), loadPendingRequests(supabase)])
      recalc()
    }
    void init()

    const channel = supabase
      .channel('unread-badge-v2')
      // New inbound message
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as { sender_id: string; read_at: string | null }
          if (!userIdRef.current || row.sender_id === userIdRef.current) return
          if (!row.read_at) {
            const s = stateRef.current
            s.unreadBySender.set(row.sender_id, (s.unreadBySender.get(row.sender_id) ?? 0) + 1)
            if (s.friends.has(row.sender_id)) {
              s.total += 1
              setCount(s.total)
            }
          }
        },
      )
      // Message read
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as { sender_id: string; read_at: string | null }
          if (!userIdRef.current || row.sender_id === userIdRef.current) return
          if (row.read_at) {
            const s = stateRef.current
            const cur = s.unreadBySender.get(row.sender_id) ?? 0
            if (cur <= 1) s.unreadBySender.delete(row.sender_id)
            else s.unreadBySender.set(row.sender_id, cur - 1)
            if (s.friends.has(row.sender_id)) {
              s.total = Math.max(0, s.total - 1)
              setCount(s.total)
            }
          }
        },
      )
      // Friend request changes — refresh friends set + pending count
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'friend_requests' },
        async () => {
          await loadFriends(supabase)
          await loadPendingRequests(supabase)
          recalc()
        },
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) void supabase.removeChannel(channelRef.current)
    }
  }, [loadFriends, loadUnread, loadPendingRequests, recalc])

  return count
}
