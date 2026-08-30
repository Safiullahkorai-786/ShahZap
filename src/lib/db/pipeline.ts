'use client'

// Unified message pipeline.
// All messages — from WebRTC, Supabase, or local — enter through this handler.
// It validates, deduplicates, persists to IndexedDB, and returns the canonical form.
//
// This is the ONLY path for message ingestion. The UI never needs to know
// which transport delivered the message.

import {
  saveMessage as idbSaveMessage,
  saveMessages as idbSaveMessages,
  getMessage as idbGetMessage,
  getMessagesByConversation as idbGetMessages,
  messageExists as idbMessageExists,
  updateMessage as idbUpdateMessage,
} from './messages'
import type { DBMessage, MessageTransport } from './schema'
import { getLatestSenderSequence as idbGetLatestSenderSequence, getNextSenderSequence as idbGetNextSenderSequence } from './sender-sequences'

// ── Canonical message type ─────────────────────────────────────────────
// This is the single source of truth for message shape in the pipeline.
// It maps 1:1 to the Supabase `messages` table plus a `transport` field.

export type PipelineMessage = DBMessage & {
  senderSequence?: number
}

// ── Map Supabase row to canonical type ─────────────────────────────────

export type SupabaseRow = {
  id: string
  sender_id: string
  original_message: string
  translated_message: string | null
  created_at: string
  reactions?: Record<string, string[]> | null
  edited_at?: string | null
  deleted_at?: string | null
  reply_to_message_id?: string | null
  deleted_by_receiver_at?: string | null
  delivered_at?: string | null
  read_at?: string | null
  message_type?: 'text' | 'call' | null
  call_mode?: 'audio' | 'video' | null
  call_status?: 'answered' | 'missed' | 'outgoing_unanswered' | null
  call_duration_seconds?: number | null
}

export function supabaseToPipeline(row: SupabaseRow, transport: MessageTransport = 'supabase'): PipelineMessage {
  return {
    id: row.id,
    conversationId: '', // caller must set this
    senderId: row.sender_id,
    originalMessage: row.original_message,
    translatedMessage: row.translated_message ?? null,
    createdAt: row.created_at,
    transport,
    reactions: row.reactions ?? null,
    editedAt: row.edited_at ?? null,
    deletedAt: row.deleted_at ?? null,
    replyToMessageId: row.reply_to_message_id ?? null,
    deletedByReceiverAt: row.deleted_by_receiver_at ?? null,
    deliveredAt: row.delivered_at ?? null,
    readAt: row.read_at ?? null,
    messageType: row.message_type ?? null,
    callMode: row.call_mode ?? null,
    callStatus: row.call_status ?? null,
    callDurationSeconds: row.call_duration_seconds ?? null,
  }
}

// ── Map canonical type back to the existing Message shape (for React state) ──

export type UIMessage = {
  id: string
  sender_id: string
  original_message: string
  translated_message: string | null
  created_at: string
  reactions?: Record<string, string[]> | null
  edited_at?: string | null
  deleted_at?: string | null
  reply_to_message_id?: string | null
  deleted_by_receiver_at?: string | null
  delivered_at?: string | null
  read_at?: string | null
  message_type?: 'text' | 'call' | null
  call_mode?: 'audio' | 'video' | null
  call_status?: 'answered' | 'missed' | 'outgoing_unanswered' | null
  call_duration_seconds?: number | null
}

export function pipelineToUI(msg: PipelineMessage): UIMessage {
  return {
    id: msg.id,
    sender_id: msg.senderId,
    original_message: msg.originalMessage,
    translated_message: msg.translatedMessage,
    created_at: msg.createdAt,
    reactions: msg.reactions ?? undefined,
    edited_at: msg.editedAt,
    deleted_at: msg.deletedAt,
    reply_to_message_id: msg.replyToMessageId,
    deleted_by_receiver_at: msg.deletedByReceiverAt,
    delivered_at: msg.deliveredAt,
    read_at: msg.readAt,
    message_type: msg.messageType,
    call_mode: msg.callMode,
    call_status: msg.callStatus,
    call_duration_seconds: msg.callDurationSeconds,
  }
}

export function uiToPipeline(msg: UIMessage, conversationId: string, transport: MessageTransport = 'local'): PipelineMessage {
  return {
    id: msg.id,
    conversationId,
    senderId: msg.sender_id,
    originalMessage: msg.original_message,
    translatedMessage: msg.translated_message ?? null,
    createdAt: msg.created_at,
    transport,
    reactions: msg.reactions ?? null,
    editedAt: msg.edited_at ?? null,
    deletedAt: msg.deleted_at ?? null,
    replyToMessageId: msg.reply_to_message_id ?? null,
    deletedByReceiverAt: msg.deleted_by_receiver_at ?? null,
    deliveredAt: msg.delivered_at ?? null,
    readAt: msg.read_at ?? null,
    messageType: msg.message_type ?? null,
    callMode: msg.call_mode ?? null,
    callStatus: msg.call_status ?? null,
    callDurationSeconds: msg.call_duration_seconds ?? null,
  }
}

// ── Pipeline: single message ingestion ─────────────────────────────────
// Returns true if the message was new (persisted), false if duplicate.
// Uses in-memory processingIds Set for fast concurrent dedup, backed by
// IndexedDB persistence for durable uniqueness.

const processingIds = new Set<string>()

export async function ingestMessage(msg: PipelineMessage): Promise<boolean> {
  if (!msg.id || !msg.conversationId) return false
  // Fast in-memory dedup (same-runtime concurrent processing)
  if (processingIds.has(msg.id)) return false
  processingIds.add(msg.id)
  try {
    const exists = await idbMessageExists(msg.id)
    if (exists) return false
    await idbSaveMessage(msg)
    return true
  } finally {
    processingIds.delete(msg.id)
  }
}

// ── Pipeline: batch ingestion (initial load, smart poll) ───────────────
// Accepts raw Supabase rows, converts to canonical, deduplicates, persists.
// Returns the merged message list sorted by createdAt.
// Existing messages in IndexedDB that are NOT in the batch are preserved
// (handles the case where IndexedDB has messages the server query missed).

export async function ingestBatch(
  rows: SupabaseRow[],
  conversationId: string,
  transport: MessageTransport = 'supabase',
): Promise<PipelineMessage[]> {
  const canonical = rows.map((r) => {
    const msg = supabaseToPipeline(r, transport)
    msg.conversationId = conversationId
    return msg
  })

  // Get existing messages from IndexedDB
  const existing = await idbGetMessages(conversationId)
  const existingMap = new Map(existing.map((m) => [m.id, m]))

  // Merge: prefer server data for existing messages, add new ones
  let newCount = 0
  for (const msg of canonical) {
    const existingMsg = existingMap.get(msg.id)
    if (!existingMsg) {
      // New message — persist it
      await idbSaveMessage(msg)
      existingMap.set(msg.id, msg)
      newCount++
    } else if (
      existingMsg.editedAt !== msg.editedAt ||
      existingMsg.deletedAt !== msg.deletedAt ||
      existingMsg.deletedByReceiverAt !== msg.deletedByReceiverAt ||
      existingMsg.deliveredAt !== msg.deliveredAt ||
      existingMsg.readAt !== msg.readAt ||
      JSON.stringify(existingMsg.reactions) !== JSON.stringify(msg.reactions)
    ) {
      // Server has newer metadata — update local
      await idbSaveMessage(msg)
      existingMap.set(msg.id, msg)
    }
  }

  // Sort by createdAt
  const sorted = Array.from(existingMap.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  return sorted
}

// ── Pipeline: update a single message (edit, delete, reaction) ─────────
// Persists the patch to IndexedDB and returns the updated canonical message.

export async function patchMessage(
  id: string,
  patch: Partial<Omit<PipelineMessage, 'id'>>,
): Promise<PipelineMessage | null> {
  const existing = await idbGetMessage(id)
  if (!existing) return null
  const updated = { ...existing, ...patch }
  await idbSaveMessage(updated)
  return updated
}

// ── Pipeline: load from IndexedDB (for instant rendering on open) ──────

export async function loadFromIndexedDB(conversationId: string): Promise<PipelineMessage[]> {
  const msgs = await idbGetMessages(conversationId)
  return msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

// ── Pipeline: check if a message exists ────────────────────────────────

export async function messageExists(id: string): Promise<boolean> {
  return idbMessageExists(id)
}

// ── Pipeline: get latest sender sequence for a conversation ────────────
// Delegates to the sender_sequences IndexedDB store for monotonic,
// per-sender sequence tracking that survives page refresh.

export async function getLatestSenderSequence(conversationId: string, senderId: string): Promise<number> {
  return idbGetLatestSenderSequence(conversationId, senderId)
}

// ── Pipeline: increment and persist sender sequence ────────────────────
// Atomically reads the current sequence, increments it, persists, and
// returns the new sequence number. Used by the send path.

export async function getNextSenderSequence(conversationId: string, senderId: string): Promise<number> {
  return idbGetNextSenderSequence(conversationId, senderId)
}

// ── Pipeline: WebRTC-first message send ────────────────────────────────
// Creates a canonical message, persists locally for optimistic UI,
// then sends via DataChannel if open, or Supabase fallback if not.
// Returns the canonical message for React state update.

export async function sendTextMessage(opts: {
  conversationId: string
  senderId: string
  content: string
  replyToId?: string
  p2pSend: (data: string | ArrayBuffer) => boolean
  p2pOpen: () => boolean
}): Promise<{ msg: PipelineMessage; uiMsg: UIMessage; via: 'webrtc' | 'supabase' }> {
  const { conversationId, senderId, content, replyToId, p2pSend, p2pOpen } = opts

  // Generate message ID
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Get next sender sequence (atomically increment + persist)
  const senderSequence = await idbGetNextSenderSequence(conversationId, senderId)

  // Build canonical message
  const canonical: PipelineMessage = {
    id,
    conversationId,
    senderId,
    originalMessage: content,
    translatedMessage: null,
    createdAt: now,
    transport: p2pOpen() ? 'webrtc' : 'supabase',
    reactions: null,
    editedAt: null,
    deletedAt: null,
    replyToMessageId: replyToId ?? null,
    deletedByReceiverAt: null,
    deliveredAt: null,
    readAt: null,
    messageType: null,
    callMode: null,
    callStatus: null,
    callDurationSeconds: null,
    senderSequence,
  }

  // Persist locally (optimistic)
  await ingestMessage(canonical)

  // Send via DataChannel if open
  if (p2pOpen()) {
    const textMsg = {
      kind: 'text' as const,
      id,
      conversationId,
      senderId,
      content,
      createdAt: now,
      senderSequence,
      replyToId,
    }
    p2pSend(JSON.stringify(textMsg))
    return { msg: canonical, uiMsg: pipelineToUI(canonical), via: 'webrtc' }
  }

  // Supabase fallback — caller handles the DB insert
  return { msg: canonical, uiMsg: pipelineToUI(canonical), via: 'supabase' }
}
