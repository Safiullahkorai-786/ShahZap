'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Message = { id: string; sender_id: string; original_message: string; translated_message: string | null; created_at: string }

export default function ChatPage() {
  const params = useParams<{ conversationId: string }>()
  const router = useRouter()
  const conversationId = params.conversationId
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | undefined
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/'); return }
      setUserId(user.id)
      const { data, error: readError } = await supabase.from('messages').select('id,sender_id,original_message,translated_message,created_at').eq('conversation_id', conversationId).order('created_at', { ascending: true })
      if (readError) setError(readError.message)
      setMessages(data ?? [])
      setLoading(false)
      channel = supabase.channel(`conversation:${conversationId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        setMessages((current) => current.some((item) => item.id === payload.new.id) ? current : [...current, payload.new as Message])
      }).subscribe()
    }
    void load()
    return () => { if (channel) void supabase.removeChannel(channel) }
  }, [conversationId, router])

  async function send(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!value || !userId) return
    setText('')
    setError('')
    const supabase = createClient()
    const { error: sendError } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: userId, original_message: value })
    if (sendError) { setError(sendError.message); setText(value) }
  }

  return <main className="flex min-h-screen flex-col bg-slate-950 text-white"><header className="border-b border-slate-800 bg-slate-900/90 px-4 py-4"><div className="mx-auto flex max-w-3xl items-center justify-between"><div><p className="text-sm font-semibold text-cyan-300">⚡ ShahZap</p><h1 className="font-semibold">Random conversation</h1></div><button onClick={()=>router.push('/match')} className="rounded-xl border border-slate-700 px-4 py-2 text-sm">Next</button></div></header><section className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6"><div className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/50 p-4">{loading ? <p className="text-sm text-slate-500">Loading conversation…</p> : messages.length === 0 ? <p className="text-center text-sm text-slate-500">Say hello 👋</p> : messages.map((message)=><div key={message.id} className={`flex ${message.sender_id===userId?'justify-end':'justify-start'}`}><div className={`max-w-[80%] rounded-2xl px-4 py-3 ${message.sender_id===userId?'bg-cyan-400 text-slate-950':'bg-slate-800'}`}><p>{message.translated_message ?? message.original_message}</p>{message.translated_message && <p className="mt-1 text-xs opacity-60">Original: {message.original_message}</p>}</div></div>)}</div>{error && <p className="mt-3 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}<form onSubmit={send} className="mt-4 flex gap-3"><input value={text} onChange={e=>setText(e.target.value)} maxLength={2000} className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-cyan-400" placeholder="Write a message…"/><button type="submit" className="rounded-xl bg-cyan-400 px-6 py-3 font-bold text-slate-950">Send</button></form></section></main>
}
