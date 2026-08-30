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
