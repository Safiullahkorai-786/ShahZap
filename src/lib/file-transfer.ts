'use client'

// P2P file transfer over WebRTC DataChannel.
// Files are compressed client-side, chunked into 16 KB binary slices,
// sent directly device-to-device, and reconstructed in browser memory.
// Zero server bandwidth — Supabase storage is never touched.

export const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
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
  // binary payload follows as a separate ArrayBuffer message
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

// ── File ID generator ─────────────────────────────────────────────────

export function newFileId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Validation ────────────────────────────────────────────────────────

export function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.`
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return 'Only images and videos are supported.'
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
// Compresses images, passes videos through as-is (already encoded).

export async function prepareFile(file: File): Promise<{ blob: Blob; mime: string }> {
  if (file.type.startsWith('image/')) {
    const compressed = await compressImage(file)
    return { blob: compressed, mime: 'image/jpeg' }
  }
  // Video: send as-is (browser-encoded mp4/webm)
  return { blob: file, mime: file.type }
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
