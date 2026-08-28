import { NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const MAX_LEN = 1000

// Free-tier Workers AI has a small daily neuron allowance. Caps are read from
// runtime env so they can be tuned without rebuilding; generous-but-safe tops.
const USER_DAILY_CAP = Number(process.env.TRANSLATION_USER_DAILY_CAP ?? 50)
const GLOBAL_DAILY_CAP = Number(process.env.TRANSLATION_GLOBAL_DAILY_CAP ?? 300)

type M2MResponse = { result?: { translated_text?: string }; translated_text?: string }

// Minimal shape of the Workers AI binding (@cf/meta/m2m100); @cloudflare/
// workers-types isn't installed, so declare just what we call.
type AiBinding = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> }

function db(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

/** Resolve a message + the two profiles' chat languages, reusing an existing
 *  translation when one already exists (translate-once / reuse). */
async function resolveMessage(supabase: SupabaseClient, messageId: string) {
  const { data: msg } = await supabase
    .from('messages')
    .select('id, sender_id, original_message, translated_message')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg) return { error: null, notFound: true } as const

  const ids = Array.from(new Set([msg.sender_id as string]))
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, chat_language')
    .in('id', ids)
  const langOf = new Map<string, string | null>((profiles ?? []).map((p) => [p.id, p.chat_language]))
  return { error: null, notFound: false, msg, senderLang: langOf.get(msg.sender_id) ?? null } as const
}

export async function POST(req: Request) {
  const supabase = db()
  if (!supabase) return NextResponse.json({ error: 'Missing server config.' }, { status: 500 })

  let payload: { messageId?: string; targetLang?: string; userId?: string } = {}
  try { payload = await req.json() } catch { /* ignore */ }
  const messageId = typeof payload.messageId === 'string' ? payload.messageId.trim() : ''
  const targetLang = typeof payload.targetLang === 'string' ? payload.targetLang.trim() : ''
  const userId = typeof payload.userId === 'string' ? payload.userId.trim() : ''
  if (!messageId || !targetLang || !userId) {
    return NextResponse.json({ error: 'messageId, targetLang and userId are required.' }, { status: 400 })
  }

  const resolved = await resolveMessage(supabase, messageId)
  if (resolved.notFound) return NextResponse.json({ error: 'Message not found.' }, { status: 404 })
  const msg = resolved.msg!
  const sourceLang = resolved.senderLang

  // Reuse a previously-computed translation if we already have one.
  if (msg.translated_message) {
    return NextResponse.json({ translatedText: msg.translated_message, reused: true, sourceLang, targetLang })
  }

  const text = (msg.original_message ?? '').slice(0, MAX_LEN)
  if (!text.trim()) {
    return NextResponse.json({ error: 'Nothing to translate.' }, { status: 422 })
  }

  // Already the same language — nothing real to translate.
  let translatedText = text
  let reused = false
  if (!sourceLang || sourceLang === targetLang) {
    reused = true
  } else {
    // Reserve a slot against the daily budget; only real model calls consume it.
    const { data: reserved } = await supabase.rpc('translation_reserve', {
      p_user_id: userId,
      p_user_cap: USER_DAILY_CAP,
      p_global_cap: GLOBAL_DAILY_CAP,
    })
    const allow = typeof reserved === 'object' && reserved !== null && (reserved as { allowed?: boolean }).allowed
    if (!allow) {
      return NextResponse.json(
        { error: 'Daily translation limit reached. Try again tomorrow.' },
        { status: 429 }
      )
    }
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const env = (await getCloudflareContext()).env as { AI: AiBinding }
    let out: M2MResponse
    try {
      out = (await env.AI.run('@cf/meta/m2m100', {
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
      })) as M2MResponse
    } catch (e) {
      await supabase.rpc('translation_refund', { p_user_id: userId }).then(() => {}, () => {})
      return NextResponse.json(
        { error: `Translation failed. ${e instanceof Error ? e.message : ''}` },
        { status: 502 }
      )
    }
    translatedText = (out?.result?.translated_text ?? (out.translated_text as string | undefined)) ?? text
    if (translatedText === text) reused = true
  }

  await supabase
    .from('messages')
    .update({ translated_message: translatedText })
    .eq('id', msg.id)

  return NextResponse.json({ translatedText, reused, sourceLang, targetLang })
}
