'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { UserMinus, Trash2, Ban, ShieldCheck, X } from 'lucide-react'

type Props = {
  children: React.ReactNode
  friendId: string
  friendName: string
  isFriend: boolean
  isBlocked: boolean
  onAction: (action: 'unfriend' | 'delete' | 'block' | 'unblock') => void
}

export function FriendContextMenu({ children, friendId, friendName, isFriend, isBlocked, onAction }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirm, setConfirm] = useState<{ action: 'unfriend' | 'delete' | 'block' } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClickRef = useRef(false)

  function clearTimer() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  function handlePointerDown(e: React.PointerEvent) {
    suppressClickRef.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      suppressClickRef.current = true
      e.preventDefault()
      setOpen(true)
    }, 500)
  }

  function handlePointerUp() {
    clearTimer()
  }

  // Block the click event if it follows a long-press
  function handleClick(e: React.MouseEvent) {
    if (suppressClickRef.current) {
      e.preventDefault()
      e.stopPropagation()
      // Reset after a tick so future normal clicks work
      setTimeout(() => { suppressClickRef.current = false }, 100)
      return
    }
  }

  useEffect(() => {
    if (!open) return
    function handleOutsideClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
        setConfirm(null)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [open])

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setOpen(true)
  }

  async function handleUnfriend() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('unfriend_user', { p_other_id: friendId })
    setLoading(false)
    if (!error) { setOpen(false); setConfirm(null); onAction('unfriend') }
  }

  async function handleDelete() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('delete_and_unfriend', { p_other_id: friendId })
    setLoading(false)
    if (!error) { setOpen(false); setConfirm(null); onAction('delete') }
  }

  async function handleBlock(unfriend: boolean) {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('block_user', { p_other_id: friendId, p_unfriend: unfriend })
    setLoading(false)
    if (!error) { setOpen(false); setConfirm(null); onAction('block') }
  }

  async function handleUnblock() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('unblock_user', { p_other_id: friendId })
    setLoading(false)
    if (!error) { setOpen(false); onAction('unblock') }
  }

  function closeMenu() {
    setOpen(false)
    setConfirm(null)
  }

  return (
    <>
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onContextMenu={handleContextMenu}
        onClick={handleClick}
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        className="cursor-pointer select-none"
      >
        {children}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => { setOpen(false); setConfirm(null) }} />
          <div
            ref={menuRef}
            className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-72 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <p className="text-sm font-semibold text-white truncate">{friendName}</p>
              <button onClick={closeMenu} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            {confirm && confirm.action === 'block' ? (
              <div className="p-3">
                <div className="mb-3 rounded-xl bg-red-950/30 p-3">
                  <p className="text-sm font-semibold text-red-200">Really block {friendName}?</p>
                  <p className="mt-0.5 text-xs text-slate-400">They won't be able to message you anymore.</p>
                </div>
                <div className="space-y-2">
                  <button disabled={loading} onClick={() => handleBlock(false)}
                    className="flex w-full items-center justify-center gap-3 rounded-xl bg-red-500 px-3 py-2.5 text-center text-sm font-bold text-white transition hover:bg-red-400">
                    <Ban size={16} /> Yes, block only
                  </button>
                  <button disabled={loading} onClick={() => handleBlock(true)}
                    className="flex w-full items-center justify-center gap-3 rounded-xl bg-red-600 px-3 py-2.5 text-center text-sm font-bold text-white transition hover:bg-red-500">
                    <UserMinus size={16} /> Yes, block &amp; unfriend
                  </button>
                  <button disabled={loading} onClick={() => setConfirm(null)}
                    className="w-full rounded-xl border border-slate-600 px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-800">
                    No
                  </button>
                </div>
              </div>
            ) : confirm ? (
              <div className="p-3">
                <div className="mb-3 rounded-xl bg-red-950/30 p-3">
                  <p className="text-sm font-semibold text-red-200">{confirm.action === 'unfriend' ? `Really unfriend ${friendName}?` : `Delete chat with ${friendName}?`}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {confirm.action === 'unfriend'
                      ? 'Your chats auto-delete after 7 days.'
                      : 'Your messages will be removed instantly and you will no longer be friends.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button disabled={loading} onClick={() => setConfirm(null)}
                    className="flex-1 rounded-xl border border-slate-600 px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-800">
                    No
                  </button>
                  <button disabled={loading} onClick={() => confirm.action === 'unfriend' ? void handleUnfriend() : void handleDelete()}
                    className="flex-1 rounded-xl bg-red-500 px-3 py-2.5 text-sm font-bold text-white transition hover:bg-red-400">
                    Yes
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3 space-y-1">
                {isBlocked ? (
                  <button disabled={loading} onClick={handleUnblock}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800">
                    <ShieldCheck size={16} className="text-emerald-400" />
                    <div><p className="font-medium text-white">Unblock</p><p className="text-xs text-slate-400">Allow them to message you again</p></div>
                  </button>
                ) : (
                  <>
                    {isFriend && (
                      <button disabled={loading} onClick={() => setConfirm({ action: 'unfriend' })}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800">
                        <UserMinus size={16} className="text-amber-400" />
                        <div><p className="font-medium text-white">Unfriend</p><p className="text-xs text-slate-400">Chats auto-delete after 7 days</p></div>
                      </button>
                    )}
                    <button disabled={loading} onClick={() => setConfirm({ action: 'delete' })}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800">
                      <Trash2 size={16} className="text-red-400" />
                      <div><p className="font-medium text-white">Delete chat</p><p className="text-xs text-slate-400">Unfriend and remove all messages instantly</p></div>
                    </button>
                    <button disabled={loading} onClick={() => setConfirm({ action: 'block' })}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800">
                      <Ban size={16} className="text-red-500" />
                      <div><p className="font-medium text-white">Block</p><p className="text-xs text-slate-400">Stop them from messaging you</p></div>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
