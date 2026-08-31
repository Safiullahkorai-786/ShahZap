'use client'

// Hybrid file transfer: broadcast (base64 via Supabase) for files <2MB,
// persistent RTCDataChannel for files >2MB. Zero server storage overhead.

export const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
export const BROADCAST_THRESHOLD = 2 * 1024 * 1024 // 2 MB — above this, use DataChannel
const CHUNK_SIZE = 16 * 1024 // 16 KB per chunk — safe for SCTP
const COMPRESSION_QUALITY = 0.82
const MAX_IMAGE_DIM = 1920 // max width/height for images

// ── Protocol messages (JSON over DataChannel) ─────────────────────────

export type FileMeta = {
  kind: 'file-meta'
  id: string
  name: string
  size: number
  mime: string
  chunkCount: number
  senderName: string
}

export type FileChunk = {
  kind: 'file-chunk'
  id: string
  index: number
}

export type FileEnd = {
  kind: 'file-end'
  id: string
}

export type FileAck = {
  kind: 'file-ack'
  id: string
}

export type FileProtocolMessage = FileMeta | FileEnd | FileAck

// ── Text message protocol (JSON over DataChannel) ──────────────────────

export type TextMessage = {
  kind: 'text'
  id: string
  conversationId: string
  senderId: string
  content: string
  createdAt: string
  senderSequence: number
  replyToId?: string
}

export type TextAck = {
  kind: 'text-ack'
  id: string
  senderId: string
  senderSequence: number
}

export type SyncRequest = {
  kind: 'sync-request'
  senderId: string
  lastKnownSequences: Record<string, number>
  capabilities?: ChatCapabilities
}

export type SyncResponse = {
  kind: 'sync-response'
  senderId: string
  messages: TextMessage[]
  events?: ChatEvent[] // Phase H: event-based reconciliation
  capabilities?: ChatCapabilities
}

// ── Protocol capability negotiation ─────────────────────────────

export type ChatCapabilities = {
  protocolVersion: number
  supportsEvents: boolean
}

// ── ChatEvent: canonical, transport-agnostic operation envelope ──

export type ChatOperation =
  | 'message.create'
  | 'message.edit'
  | 'message.delete'
  | 'reaction.add'
  | 'reaction.remove'
  | 'translation.update'
  | 'media.create'
  | 'media.delete'
  | 'voice.create'

interface ChatEventBase {
  kind: 'event'
  eventId: string
  conversationId: string
  senderId: string
  senderSequence: number
  createdAt: string
}

interface MessageCreateEvent extends ChatEventBase {
  operation: 'message.create'
  version: number
  payload: {
    messageId: string
    originalMessage: string
    translatedMessage?: string | null
    replyToMessageId?: string | null
  }
}

interface MessageEditEvent extends ChatEventBase {
  operation: 'message.edit'
  version: number
  payload: {
    messageId: string
    originalMessage: string
    editedAt: string
  }
}

interface MessageDeleteEvent extends ChatEventBase {
  operation: 'message.delete'
  version: number
  payload: {
    messageId: string
    deletedAt: string
  }
}

interface ReactionAddEvent extends ChatEventBase {
  operation: 'reaction.add'
  version: number
  payload: {
    messageId: string
    emoji: string
  }
}

interface ReactionRemoveEvent extends ChatEventBase {
  operation: 'reaction.remove'
  version: number
  payload: {
    messageId: string
    emoji: string
  }
}

interface TranslationUpdateEvent extends ChatEventBase {
  operation: 'translation.update'
  version: number
  payload: {
    messageId: string
    translatedMessage: string
  }
}

interface MediaCreateEvent extends ChatEventBase {
  operation: 'media.create'
  version: number
  payload: {
    messageId: string
    fileRef: string // file ID for DataChannel transfer or Supabase Storage path
    fileName: string
    fileSize: number
    mimeType: string
    mediaType: 'image' | 'video' | 'audio' | 'file'
  }
}

interface MediaDeleteEvent extends ChatEventBase {
  operation: 'media.delete'
  version: number
  payload: {
    messageId: string
    deletedAt: string
  }
}

interface VoiceCreateEvent extends ChatEventBase {
  operation: 'voice.create'
  version: number
  payload: {
    messageId: string
    fileRef: string
    fileSize: number
    mimeType: string
    durationMs?: number
  }
}

export type ChatEvent =
  | MessageCreateEvent
  | MessageEditEvent
  | MessageDeleteEvent
  | ReactionAddEvent
  | ReactionRemoveEvent
  | TranslationUpdateEvent
  | MediaCreateEvent
  | MediaDeleteEvent
  | VoiceCreateEvent

// ── Validation ──────────────────────────────────────────────────

export function validateChatEvent(parsed: unknown): parsed is ChatEvent {
  if (typeof parsed !== 'object' || parsed === null) return false
  const obj = parsed as Record<string, unknown>
  if (obj.kind !== 'event') return false
  if (typeof obj.eventId !== 'string') return false
  if (typeof obj.conversationId !== 'string') return false
  if (typeof obj.senderId !== 'string') return false
  if (typeof obj.senderSequence !== 'number') return false
  if (typeof obj.operation !== 'string') return false
  if (typeof obj.version !== 'number') return false
  if (typeof obj.createdAt !== 'string') return false
  if (typeof obj.payload !== 'object' || obj.payload === null) return false
  const payload = obj.payload as Record<string, unknown>
  switch (obj.operation) {
    case 'message.create':
      return typeof payload.messageId === 'string'
        && typeof payload.originalMessage === 'string'
    case 'message.edit':
      return typeof payload.messageId === 'string'
        && typeof payload.originalMessage === 'string'
        && typeof payload.editedAt === 'string'
    case 'message.delete':
      return typeof payload.messageId === 'string'
        && typeof payload.deletedAt === 'string'
    case 'reaction.add':
    case 'reaction.remove':
      return typeof payload.messageId === 'string'
        && typeof payload.emoji === 'string'
    case 'translation.update':
      return typeof payload.messageId === 'string'
        && typeof payload.translatedMessage === 'string'
    case 'media.create':
      return typeof payload.messageId === 'string'
        && typeof payload.fileRef === 'string'
        && typeof payload.fileName === 'string'
        && typeof payload.fileSize === 'number'
        && typeof payload.mimeType === 'string'
        && typeof payload.mediaType === 'string'
    case 'media.delete':
      return typeof payload.messageId === 'string'
        && typeof payload.deletedAt === 'string'
    case 'voice.create':
      return typeof payload.messageId === 'string'
        && typeof payload.fileRef === 'string'
        && typeof payload.fileSize === 'number'
        && typeof payload.mimeType === 'string'
    default:
      return false
  }
}

export type TextProtocolMessage = TextMessage | TextAck | SyncRequest | SyncResponse | ChatEvent

// ── Broadcast message (base64 via Supabase Realtime) ──────────────────

export type BroadcastFileMessage = {
  type: 'file'
  id: string
  name: string
  mime: string
  dataUrl: string // base64 data URL
  senderId: string
  senderName: string
}

// ── File ID generator ─────────────────────────────────────────────────

export function newFileId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Validation ────────────────────────────────────────────────────────

export function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
    return 'Only images, videos, and audio are supported.'
  }
  return null
}

// ── Image compression ─────────────────────────────────────────────────

function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
        const scale = MAX_IMAGE_DIM / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas compression failed'))),
        'image/jpeg',
        COMPRESSION_QUALITY,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')) }
    img.src = url
  })
}

// ── Prepare file for transfer ─────────────────────────────────────────

export async function prepareFile(file: File): Promise<{ blob: Blob; mime: string }> {
  if (file.type.startsWith('image/')) {
    const compressed = await compressImage(file)
    return { blob: compressed, mime: 'image/jpeg' }
  }
  return { blob: file, mime: file.type }
}

// ── Base64 conversion (for broadcast path <2MB) ───────────────────────

export async function fileToDataUrl(file: File): Promise<string> {
  const { blob } = await prepareFile(file)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',')
  const mime = parts[0].match(/:(.*?);/)?.[1] ?? 'application/octet-stream'
  const binary = atob(parts[1])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// ── Chunking ──────────────────────────────────────────────────────────

export interface ChunkedFile {
  meta: FileMeta
  chunks: ArrayBuffer[]
}

export async function chunkFile(
  file: File,
  id: string,
  senderName: string,
): Promise<ChunkedFile> {
  const { blob, mime } = await prepareFile(file)
  const buffer = await blob.arrayBuffer()
  const chunkCount = Math.ceil(buffer.byteLength / CHUNK_SIZE)
  const meta: FileMeta = {
    kind: 'file-meta',
    id,
    name: file.name,
    size: buffer.byteLength,
    mime,
    chunkCount,
    senderName,
  }
  const chunks: ArrayBuffer[] = []
  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, buffer.byteLength)
    chunks.push(buffer.slice(start, end))
  }
  return { meta, chunks }
}

// ── Reconstruction ────────────────────────────────────────────────────

export interface IncomingFile {
  meta: FileMeta
  chunks: ArrayBuffer[]
  received: number
}

export function createEmptyIncoming(meta: FileMeta): IncomingFile {
  return { meta, chunks: new Array(meta.chunkCount), received: 0 }
}

export function addChunk(file: IncomingFile, index: number, data: ArrayBuffer): IncomingFile {
  const chunks = [...file.chunks]
  chunks[index] = data
  return { ...file, chunks, received: file.received + 1 }
}

export function isComplete(file: IncomingFile): boolean {
  return file.received === file.meta.chunkCount
}

export function reconstructFile(file: IncomingFile): Blob {
  return new Blob(file.chunks, { type: file.meta.mime })
}

// ── Progress tracking ─────────────────────────────────────────────────

export type TransferProgress = {
  fileId: string
  sent: number
  total: number
  percent: number
}
