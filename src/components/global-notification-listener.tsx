'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { playFriendRequestSound, playMessageSound, playUnfriendSound } from '@/lib/notification-sound'
import { isBotProfile } from '@/lib/bot'
import { notifCategoryEnabled } from '@/lib/notification-prefs'

/**
 * Global notification listener — mounts in the root layout so sounds
 * play on ANY page whenever a new notification arrives via Realtime.
 */
export function GlobalNotificationListener() {
  const userIdRef = useRef<string | null>(null)
  const channelRef = useRef<ReturnType<typeof createClient.prototype.channel> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef2 = useRef<any>(null)

  useEffect(() => {
    const supabase = createClient()

    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      userIdRef.current = user.id

      // Subscribe to ALL notification events for this user
      const channel = supabase
        .channel(`global-notif:${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
          (payload) => {
            const row = payload.new as { kind: string; from_user_id: string | null }
            if (row.from_user_id && isBotProfile(row.from_user_id)) return
            if (!notifCategoryEnabled(row.kind)) return

            switch (row.kind) {
              case 'message':
                playMessageSound()
                break
              case 'friend_request':
              case 'accept':
                playFriendRequestSound()
                break
              case 'unfriend':
              case 'reject':
              case 'blocked':
              case 'unblocked':
              case 'delete_chat':
                playUnfriendSound()
                break
            }
          },
        )
        .subscribe()

      channelRef.current = channel
    }

    void init()

    return () => {
      if (channelRef.current) void supabase.removeChannel(channelRef.current)
      if (channelRef2.current) void supabase.removeChannel(channelRef2.current)
    }
  }, [])

  return null
}
