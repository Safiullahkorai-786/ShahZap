'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, UserPlus, MessageCircle, UserMinus, UserCheck, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { playFriendRequestSound, playMessageSound, playUnfriendSound } from '@/lib/notification-sound'
import { resolveIdentity, type Identity } from '@/lib/identity'
import { isBotProfile } from '@/lib/bot'

type Notification = {
  id: string
  tag?: string
  kind: 'friend_request' | 'message' | 'unfriend' | 'accept' | 'reject'
  identity: Identity
  text: string
  href: string
  at: number
}

function ago(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [nowTick, setNowTick] = useState(0)
  const userIdRef = useRef<string | null>(null)
  const acceptedRows = useRef<Map<string, string>>(new Map()) // rowId → other profile id
  const pendingRows = useRef<Map<string, string>>(new Map()) // rowId → sender id

  useEffect(() => {
    const supabase = createClient()
    let frChannel: ReturnType<typeof supabase.channel> | undefined
    let msgChannel: ReturnType<typeof supabase.channel> | undefined

    async function identityOf(profileId: string): Promise<Identity> {
      const { data } = await supabase
        .from('profiles')
        .select('display_name,gender,gender_visible')
        .eq('id', profileId)
        .maybeSingle()
      return resolveIdentity(data as never)
    }

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      userIdRef.current = user.id
      const { data: accepted } = await supabase
        .from('friend_requests')
        .select('id,sender_id,receiver_id')
        .eq('status', 'accepted')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      if (accepted) for (const r of accepted) {
        const otherId2 = r.sender_id === user.id ? r.receiver_id : r.sender_id
        acceptedRows.current.set(String(r.id), otherId2)
      }

      // Friend requests sent TO me — realtime.
      frChannel = supabase
        .channel(`fr-notif:${user.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${user.id}` },
          async (payload) => {
            playFriendRequestSound()
            const row = payload.new as { id?: string | number; sender_id: string }
            if (row.id != null) pendingRows.current.set(String(row.id), row.sender_id)
            const senderId = row.sender_id
            const identity = await identityOf(senderId)
            setItems((cur) => [
              { id: `fr-${row.id}`, kind: 'friend_request', tag: senderId, identity, text: 'sent you a friend request', href: '/friends', at: Date.now() },
              ...cur,
            ])
            setUnread((c) => c + 1)
          },
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'friend_requests' },
          async (payload) => {
            // Realtime strips deleted rows to their id — resolve via ledger.
            const key = payload.old?.id != null ? String(payload.old.id) : null
            if (!key || !userIdRef.current) return
            const pendingFrom = pendingRows.current.get(key)
            if (pendingFrom) {
              pendingRows.current.delete(key)
              setItems((cur) => cur.filter((x) => !(x.kind === 'friend_request' && x.tag === pendingFrom)))
              return
            }
            const other = acceptedRows.current.get(key)
            if (!other || other === userIdRef.current) return
            acceptedRows.current.delete(key)
            playUnfriendSound()
            const identity = await identityOf(other)
            setItems((cur) => [
              { id: `un-${key}`, kind: 'unfriend', identity, text: 'unfriended you', href: '/friends', at: Date.now() },
              ...cur,
            ])
            setUnread((c) => Math.min(c + 1, 99))
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'friend_requests', filter: `receiver_id=eq.${user.id}` },
          async (payload) => {
            const row = payload.new as { id: string; sender_id: string; receiver_id: string; status: string }
            if (row.status !== 'accepted') return
            {
            const otherId2 = row.sender_id === userIdRef.current ? row.receiver_id : row.sender_id
            acceptedRows.current.set(String(row.id), otherId2)
          }
            if (!userIdRef.current || row.sender_id === userIdRef.current) return
            playFriendRequestSound()
            const identity = await identityOf(row.sender_id)
            setItems((cur) => [
              { id: `ac-${row.sender_id}-${row.receiver_id}`, kind: 'accept', identity, text: 'accepted your friend request', href: '/friends', at: Date.now() },
              ...cur,
            ])
            setUnread((c) => Math.min(c + 1, 99))
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'friend_requests', filter: `sender_id=eq.${user.id}` },
          async (payload) => {
            const row = payload.new as { id: string; sender_id: string; receiver_id: string; status: string }
            if (!userIdRef.current) return
            const otherId2 = row.sender_id === userIdRef.current ? row.receiver_id : row.sender_id
            if (row.status === 'accepted') {
              acceptedRows.current.set(String(row.id), otherId2)
              if (row.sender_id === userIdRef.current) {
                playFriendRequestSound()
                const identity = await identityOf(row.receiver_id)
                setItems((cur) => [
                  { id: `ac-${row.id}`, kind: 'accept', identity, text: 'accepted your friend request', href: '/friends', at: Date.now() },
                  ...cur,
                ])
                setUnread((c) => Math.min(c + 1, 99))
              }
            }
            if (row.status === 'declined' && row.sender_id === userIdRef.current) {
              playUnfriendSound()
              const identity = await identityOf(row.receiver_id)
              setItems((cur) => [
                { id: `rj-${row.id}`, kind: 'reject', identity, text: 'rejected your friend request', href: '/friends', at: Date.now() },
                ...cur,
              ])
              setUnread((c) => Math.min(c + 1, 99))
            }
          },
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'friend_requests' },
          async (payload) => {
            // Realtime strips deleted rows to their id — resolve via ledger.
            const key = payload.old?.id != null ? String(payload.old.id) : null
            if (!key || !userIdRef.current) return
            const pendingFrom = pendingRows.current.get(key)
            if (pendingFrom) {
              pendingRows.current.delete(key)
              setItems((cur) => cur.filter((x) => !(x.kind === 'friend_request' && x.tag === pendingFrom)))
              return
            }
            const other = acceptedRows.current.get(key)
            if (!other || other === userIdRef.current) return
            acceptedRows.current.delete(key)
            playUnfriendSound()
            const identity = await identityOf(other)
            setItems((cur) => [
              { id: `un-${key}`, kind: 'unfriend', identity, text: 'unfriended you', href: '/friends', at: Date.now() },
              ...cur,
            ])
            setUnread((c) => Math.min(c + 1, 99))
          },
        )
        .subscribe()

      // Message inserts anywhere — Supabase Realtime enforces RLS per listener,
      // so only messages inside MY conversations are ever delivered here.
      msgChannel = supabase
        .channel('msg-notif')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          async (payload) => {
            const row = payload.new as { id: string; sender_id: string; conversation_id: string }
            if (!userIdRef.current || row.sender_id === userIdRef.current) return
            if (isBotProfile(row.sender_id)) return // bots already ping in-chat
            playMessageSound()
            const identity = await identityOf(row.sender_id)
            setItems((cur) => [
              { id: `msg-${row.id}`, kind: 'message', identity, text: 'sent you a message', href: `/chat/${row.conversation_id}`, at: Date.now() },
              ...cur.slice(0, 19),
            ])
            setUnread((c) => Math.min(c + 1, 99))
          },
        )
        .subscribe()
    }

    void load()
    const ticker = window.setInterval(() => setNowTick(Date.now()), 30_000)
    return () => {
      window.clearInterval(ticker)
      if (frChannel) void supabase.removeChannel(frChannel)
      if (msgChannel) void supabase.removeChannel(msgChannel)
    }
  }, [])

  return (
    <div className="relative">
      <button
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        onClick={() => { setOpen((v) => !v); if (!open) setUnread(0) }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 transition hover:border-slate-500 hover:text-white"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60">
            <p className="border-b border-slate-800 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400">Notifications</p>
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-slate-500">You&apos;re all caught up 🎉</p>
            ) : (
              <ul className="max-h-96 divide-y divide-slate-800 overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id}>
                    <Link href={n.href} onClick={() => setOpen(false)} className="flex items-start gap-3 px-4 py-3 transition hover:bg-slate-800">
                      <span className={`mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-xl ${n.kind === 'friend_request' ? 'bg-cyan-400/10 text-cyan-300' : n.kind === 'unfriend' || n.kind === 'reject' ? 'bg-red-400/10 text-red-300' : n.kind === 'accept' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-violet-400/10 text-violet-300'}`}>
                        {n.kind === 'friend_request' ? <UserPlus size={15} /> : n.kind === 'unfriend' ? <UserMinus size={15} /> : n.kind === 'accept' ? <UserCheck size={15} /> : n.kind === 'reject' ? <X size={15} /> : <MessageCircle size={15} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          <span className={`font-semibold ${n.identity.colorClass}`}>{n.identity.label}</span>{' '}
                          <span className="text-slate-400">{n.text}</span>
                        </span>
                        <span className="mt-0.5 block text-[10px] text-slate-600">{ago((nowTick || n.at) - n.at)} ago</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
