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
  const [blockMode, setBlockMode] = useState<'choose' | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handlePointerDown(e: React.PointerEvent) {
    timerRef.current = setTimeout(() => {
      e.preventDefault()
      setOpen(true)
    }, 500)
  }
  function handlePointerUp() {
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
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
    if (!error) { setOpen(false); onAction('unfriend') }
  }

  async function handleDelete() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('delete_and_unfriend', { p_other_id: friendId })
    setLoading(false)
    if (!error) { setOpen(false); onAction('delete') }
  }

  async function handleBlock(unfriend: boolean) {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('block_user', { p_other_id: friendId, p_unfriend: unfriend })
    setLoading(false)
    if (!error) { setOpen(false); setBlockMode(null); onAction('block') }
  }

  async function handleUnblock() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('unblock_user', { p_other_id: friendId })
    setLoading(false)
    if (!error) { setOpen(false); onAction('unblock') }
  }

  return (
    <>
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onContextMenu={handleContextMenu}
        className="cursor-pointer select-none"
      >
        {children}
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => { setOpen(false); setBlockMode(null) }} />
          <div
            ref={menuRef}
            className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-72 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <p className="text-sm font-semibold text-white truncate">{friendName}</p>
              <button onClick={() => { setOpen(false); setBlockMode(null) }} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            {blockMode === 'choose' ? (
              <div className="p-3 space-y-2">
                <p className="text-xs text-slate-400 mb-2">How do you want to block {friendName}?</p>
                <button
                  disabled={loading}
                  onClick={() => handleBlock(false)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800"
                >
                  <Ban size={16} className="text-amber-400" />
                  <div>
                    <p className="font-medium text-white">Block only</p>
                    <p className="text-xs text-slate-400">Stay friends but stop messages from them</p>
                  </div>
                </button>
                <button
                  disabled={loading}
                  onClick={() => handleBlock(true)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800"
                >
                  <Ban size={16} className="text-red-400" />
                  <UserMinus size={16} className="text-red-400 -ml-1" />
                  <div>
                    <p className="font-medium text-white">Block &amp; unfriend</p>
                    <p className="text-xs text-slate-400">Remove friendship and block them</p>
                  </div>
                </button>
              </div>
            ) : (
              <div className="p-3 space-y-1">
                {isBlocked ? (
                  <button
                    disabled={loading}
                    onClick={handleUnblock}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800"
                  >
                    <ShieldCheck size={16} className="text-emerald-400" />
                    <div>
                      <p className="font-medium text-white">Unblock</p>
                      <p className="text-xs text-slate-400">Allow them to message you again</p>
                    </div>
                  </button>
                ) : (
                  <>
                    {isFriend && (
                      <button
                        disabled={loading}
                        onClick={handleUnfriend}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800"
                      >
                        <UserMinus size={16} className="text-amber-400" />
                        <div>
                          <p className="font-medium text-white">Unfriend</p>
                          <p className="text-xs text-slate-400">Chats auto-delete after 7 days</p>
                        </div>
                      </button>
                    )}
                    <button
                      disabled={loading}
                      onClick={handleDelete}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800"
                    >
                      <Trash2 size={16} className="text-red-400" />
                      <div>
                        <p className="font-medium text-white">Delete chat</p>
                        <p className="text-xs text-slate-400">Unfriend and remove all messages instantly</p>
                      </div>
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => setBlockMode('choose')}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-slate-800"
                    >
                      <Ban size={16} className="text-red-500" />
                      <div>
                        <p className="font-medium text-white">Block</p>
                        <p className="text-xs text-slate-400">Stop them from messaging you</p>
                      </div>
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
