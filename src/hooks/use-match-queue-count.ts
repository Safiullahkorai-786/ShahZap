'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

type QueueRow = {
  id: string
  profile_id: string
  status: string
  expires_at: string
}

/**
 * Live count of how many people are currently looking for a match.
 *
 * INSTANT strategy (no count-RPC round-trip on every event):
 * - Load the authoritative count once via match_queue_count()
 * - Then adjust the local figure by a DELTA computed straight off each
 *   Realtime event's row payload:
 *     INSERT waiting (not self)  -> +1
 *     UPDATE leaving waiting     -> -1 / entering waiting -> +1
 *     DELETE waiting (not self)  -> -1
 *   Updates therefore appear the moment the row changes, not one RPC later.
 * - Keep a slower safety-net correction (focus + 15s poll) so expiring rows
 *   that never emit a DB event don't drift the count.
 */
export function useMatchQueueCount() {
  const [count, setCount] = useState<number | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null)
  const countRef = useRef<number | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selfRef = useRef<any>(null)

  countRef.current = count

  function syncCount(supabase: ReturnType<typeof createClient>) {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      selfRef.current = user.id
      const { data, error } = await supabase.rpc('match_queue_count')
      if (error || typeof data !== 'number') return
      countRef.current = data
      setCount(data)
    })()
  }

  function adjust(delta: number) {
    const cur = countRef.current
    if (cur === null) return
    const next = Math.max(0, cur + delta)
    countRef.current = next
    setCount(next)
  }

  // True when an event represents a waiting entry for someone else.
  function isActive(row: QueueRow | undefined, selfId: unknown) {
    if (!row) return false
    if (row.profile_id === selfId) return false
    if (row.status !== 'waiting') return false
    if (!row.expires_at) return false
    return new Date(row.expires_at).getTime() > Date.now()
  }

  useEffect(() => {
    const supabase = createClient()

    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      selfRef.current = user.id
    })()

    syncCount(supabase)

    const channel = supabase
      .channel('match-queue-count-v2')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'match_queue' },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const row = payload.new as unknown as QueueRow
          if (isActive(row, selfRef.current)) adjust(1)
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'match_queue' },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const was = payload.old as unknown as QueueRow
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const now = payload.new as unknown as QueueRow
          const wasActive = isActive(was, selfRef.current)
          const nowActive = isActive(now, selfRef.current)
          if (wasActive && !nowActive) adjust(-1)
          else if (!wasActive && nowActive) adjust(1)
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'match_queue' },
        (payload) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const old = payload.old as unknown as QueueRow
          if (isActive(old, selfRef.current)) adjust(-1)
        },
      )
      .subscribe()

    channelRef.current = channel

    function handleVisible() {
      if (document.visibilityState === 'visible') syncCount(supabase)
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)

    // Safety-net correction (handles server-side expiries that emit no event)
    const poll = window.setInterval(() => syncCount(supabase), 30_000)

    return () => {
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
      window.clearInterval(poll)
      if (channelRef.current) void supabase.removeChannel(channelRef.current)
    }
  }, [])

  return count
}
