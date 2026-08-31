'use client'

// Media storage: IndexedDB persistence + Supabase Storage fallback.
// IndexedDB is the primary store for media blobs (survives page refresh).
// Supabase Storage is the fallback for when P2P is unavailable.

import { createClient } from '@/lib/supabase/client'
import { saveMedia, getMedia, deleteMedia } from './media'
import type { DBMedia } from './schema'

const STORAGE_BUCKET = 'chat-media'
const MAX_SUPABASE_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

// ── IndexedDB persistence ──────────────────────────────────────────

export async function persistMediaToIDB(opts: {
  messageId: string
  conversationId: string
  blob: Blob
  mimeType: string
  fileName: string
}): Promise<void> {
  const media: DBMedia = {
    messageId: opts.messageId,
    conversationId: opts.conversationId,
    mimeType: opts.mimeType,
    size: opts.blob.size,
    blob: opts.blob,
    createdAt: new Date().toISOString(),
  }
  await saveMedia(media)
}

export async function loadMediaFromIDB(messageId: string): Promise<DBMedia | undefined> {
  return getMedia(messageId)
}

export async function removeMediaFromIDB(messageId: string): Promise<void> {
  return deleteMedia(messageId)
}

// ── Supabase Storage fallback ──────────────────────────────────────
// Used when P2P is unavailable and the file needs to be stored server-side
// so the receiver can download it later.

export async function uploadToSupabaseStorage(opts: {
  messageId: string
  conversationId: string
  blob: Blob
  mimeType: string
  fileName: string
}): Promise<string | null> {
  if (opts.blob.size > MAX_SUPABASE_FILE_SIZE) return null
  const supabase = createClient()
  const path = `${opts.conversationId}/${opts.messageId}/${opts.fileName}`
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, opts.blob, { contentType: opts.mimeType, upsert: true })
  if (error) return null
  return path
}

export async function getSupabaseStorageUrl(path: string): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

export async function deleteFromSupabaseStorage(path: string): Promise<void> {
  const supabase = createClient()
  await supabase.storage.from(STORAGE_BUCKET).remove([path])
}

// ── Combined: persist locally, upload to Supabase if needed ─────────

export async function persistMedia(opts: {
  messageId: string
  conversationId: string
  blob: Blob
  mimeType: string
  fileName: string
  uploadToServer: boolean
}): Promise<{ localPath: string; serverPath: string | null }> {
  // Always persist to IndexedDB
  await persistMediaToIDB(opts)

  // Optionally upload to Supabase Storage
  let serverPath: string | null = null
  if (opts.uploadToServer) {
    serverPath = await uploadToSupabaseStorage(opts)
  }

  return { localPath: opts.messageId, serverPath }
}
