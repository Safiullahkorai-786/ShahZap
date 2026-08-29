'use client'

// Inline chat panel shown beside the active call on desktop (when the chat
// button is toggled), like WhatsApp Web's split view. Reads and sends messages
// in the live conversation so you can chat while staying on the call.

import { FormEvent, useEffect, useRef, useState } from 'react'
import { X, Send, MessageCircle } from 'lucide-react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { RichText } from '@/components/rich-text'

type ChatMessage = {
  id: string
  sender_id: string
  original_message: string
  created_at: string
}

const COLUMNS = 'id,sender_id,original_message,created_at'

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function CallChatPanel({ conversationId, otherName, onClose }: {
  conversationId: string
  otherName: string
  onClose: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setUserId(data.user?.id ?? null)
    })

    supabase
      .from('messages')
      .select(COLUMNS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (!cancelled && !error && data) setMessages(data as ChatMessage[])
      })

    const channel = supabase
      .channel(`call-chat:${conversationId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = payload.new as ChatMessage
          if (row?.id && row?.original_message != null) {
            setMessages((cur) => (cur.some((m) => m.id === row.id) ? cur : [...cur, row]))
          }
        })
      .subscribe()
    channelRef.current = channel

    return () => {
      cancelled = true
      if (channelRef.current) void supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
  }, [conversationId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [messages])

  async function send(e: FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value || !userId) return
    setText('')
    const supabase = createClient()
    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({ conversation_id: conversationId, sender_id: userId, original_message: value })
      .select(COLUMNS)
      .single()
    if (!error && inserted) {
      setMessages((cur) => (cur.some((m) => m.id === inserted.id) ? cur : [...cur, inserted as ChatMessage]))
    } else {
      setText(value)
    }
  }

  return (
    <aside className="flex h-full w-full flex-col border-l border-white/10 bg-slate-950">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircle size={18} className="shrink-0 text-cyan-400" />
          <span className="truncate text-sm font-semibold text-white">{otherName}</span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">Say hi to {otherName}</p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === userId
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`relative max-w-[85%] select-none rounded-2xl px-3.5 py-2 shadow-sm ${
                  mine
                    ? 'rounded-br-md bg-gradient-to-br from-cyan-500 to-cyan-400 text-slate-950'
                    : 'rounded-bl-md bg-slate-800 text-slate-100'
                }`}
              >
                <RichText text={m.original_message} className="text-[15px] leading-relaxed [overflow-wrap:anywhere]" />
                <span className={`mt-1 block text-right text-[10px] ${mine ? 'text-slate-800/70' : 'text-slate-400'}`}>
                  {fmtTime(m.created_at)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <form onSubmit={send} className="flex items-center gap-2 border-t border-white/10 px-3 py-3">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message ${otherName}`}
          className="min-w-0 flex-1 rounded-full border border-white/10 bg-slate-800/70 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
        />
        <button
          type="submit"
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-slate-950 transition hover:bg-cyan-400"
        >
          <Send size={18} />
        </button>
      </form>
    </aside>
  )
}
