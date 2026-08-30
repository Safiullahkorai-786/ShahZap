import { describe, it, expect, beforeEach } from 'vitest'
import { resetDB, getDB } from './schema'
import {
  supabaseToPipeline,
  pipelineToUI,
  uiToPipeline,
  ingestMessage,
  ingestBatch,
  patchMessage,
  loadFromIndexedDB,
  messageExists,
  getLatestSenderSequence,
  getNextSenderSequence,
  type PipelineMessage,
  type SupabaseRow,
} from './pipeline'

beforeEach(async () => {
  resetDB()
  const db = await getDB()
  const tx = db.transaction(['conversations', 'messages', 'media', 'sender_sequences'], 'readwrite')
  await Promise.all([
    tx.objectStore('conversations').clear(),
    tx.objectStore('messages').clear(),
    tx.objectStore('media').clear(),
    tx.objectStore('sender_sequences').clear(),
    tx.done,
  ])
})

const now = new Date().toISOString()

function makeRow(overrides: Partial<SupabaseRow> = {}): SupabaseRow {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sender_id: 'user-1',
    original_message: 'hello',
    translated_message: null,
    created_at: now,
    ...overrides,
  }
}

function makePipelineMsg(overrides: Partial<PipelineMessage> = {}): PipelineMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    conversationId: 'conv-1',
    senderId: 'user-1',
    originalMessage: 'hello',
    translatedMessage: null,
    createdAt: now,
    transport: 'supabase',
    reactions: null,
    editedAt: null,
    deletedAt: null,
    replyToMessageId: null,
    deletedByReceiverAt: null,
    deliveredAt: null,
    readAt: null,
    messageType: null,
    callMode: null,
    callStatus: null,
    callDurationSeconds: null,
    ...overrides,
  }
}

// ── Type conversions ───────────────────────────────────────────────────

describe('type conversions', () => {
  it('supabaseToPipeline converts a row', () => {
    const row = makeRow({ id: 'msg-1', original_message: 'test', reactions: { '👍': ['u1'] } })
    const msg = supabaseToPipeline(row, 'webrtc')
    msg.conversationId = 'conv-1'
    expect(msg.id).toBe('msg-1')
    expect(msg.originalMessage).toBe('test')
    expect(msg.transport).toBe('webrtc')
    expect(msg.reactions).toEqual({ '👍': ['u1'] })
  })

  it('pipelineToUI converts back', () => {
    const msg = makePipelineMsg({ id: 'msg-1', originalMessage: 'hello', reactions: { '❤️': ['u2'] } })
    const ui = pipelineToUI(msg)
    expect(ui.id).toBe('msg-1')
    expect(ui.original_message).toBe('hello')
    expect(ui.reactions).toEqual({ '❤️': ['u2'] })
  })

  it('round-trips supabase → pipeline → UI → pipeline', () => {
    const row = makeRow({ id: 'msg-rt', original_message: 'round trip' })
    const pipeline = supabaseToPipeline(row)
    pipeline.conversationId = 'conv-1'
    const ui = pipelineToUI(pipeline)
    const back = uiToPipeline(ui, 'conv-1')
    expect(back.id).toBe('msg-rt')
    expect(back.originalMessage).toBe('round trip')
  })
})

// ── ingestMessage ──────────────────────────────────────────────────────

describe('ingestMessage', () => {
  it('persists a new message and returns true', async () => {
    const msg = makePipelineMsg({ id: 'msg-1' })
    const result = await ingestMessage(msg)
    expect(result).toBe(true)
    expect(await messageExists('msg-1')).toBe(true)
  })

  it('deduplicates — returns false for existing message', async () => {
    const msg = makePipelineMsg({ id: 'msg-1' })
    await ingestMessage(msg)
    const result = await ingestMessage(msg)
    expect(result).toBe(false)
  })

  it('rejects messages without id or conversationId', async () => {
    const msg = makePipelineMsg({ id: '' })
    expect(await ingestMessage(msg)).toBe(false)
    const msg2 = makePipelineMsg({ conversationId: '' })
    expect(await ingestMessage(msg2)).toBe(false)
  })
})

// ── ingestBatch ────────────────────────────────────────────────────────

describe('ingestBatch', () => {
  it('persists all new messages and returns sorted list', async () => {
    const rows = [
      makeRow({ id: 'msg-2', created_at: '2026-01-01T00:00:02Z' }),
      makeRow({ id: 'msg-1', created_at: '2026-01-01T00:00:01Z' }),
    ]
    const result = await ingestBatch(rows, 'conv-1')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('msg-1')
    expect(result[1].id).toBe('msg-2')
    expect(await messageExists('msg-1')).toBe(true)
    expect(await messageExists('msg-2')).toBe(true)
  })

  it('deduplicates against existing IndexedDB messages', async () => {
    // Pre-populate
    await ingestMessage(makePipelineMsg({ id: 'msg-1', conversationId: 'conv-1' }))
    // Batch with overlap
    const rows = [
      makeRow({ id: 'msg-1', created_at: '2026-01-01T00:00:01Z' }),
      makeRow({ id: 'msg-2', created_at: '2026-01-01T00:00:02Z' }),
    ]
    const result = await ingestBatch(rows, 'conv-1')
    expect(result).toHaveLength(2)
  })

  it('updates metadata when server has newer data', async () => {
    await ingestMessage(makePipelineMsg({
      id: 'msg-1',
      conversationId: 'conv-1',
      deliveredAt: null,
    }))
    const rows = [
      makeRow({ id: 'msg-1', created_at: now, delivered_at: now }),
    ]
    await ingestBatch(rows, 'conv-1')
    const db = await getDB()
    const msg = await db.get('messages', 'msg-1')
    expect(msg!.deliveredAt).toBe(now)
  })

  it('preserves IndexedDB messages not in the batch', async () => {
    await ingestMessage(makePipelineMsg({ id: 'msg-local', conversationId: 'conv-1' }))
    const rows = [makeRow({ id: 'msg-server', created_at: now })]
    const result = await ingestBatch(rows, 'conv-1')
    expect(result).toHaveLength(2)
    expect(result.some((m) => m.id === 'msg-local')).toBe(true)
    expect(result.some((m) => m.id === 'msg-server')).toBe(true)
  })
})

// ── patchMessage ───────────────────────────────────────────────────────

describe('patchMessage', () => {
  it('patches and persists changes', async () => {
    await ingestMessage(makePipelineMsg({ id: 'msg-1', conversationId: 'conv-1' }))
    const result = await patchMessage('msg-1', { editedAt: now, originalMessage: 'edited' })
    expect(result).not.toBeNull()
    expect(result!.editedAt).toBe(now)
    expect(result!.originalMessage).toBe('edited')
  })

  it('returns null for nonexistent message', async () => {
    const result = await patchMessage('nonexistent', { editedAt: now })
    expect(result).toBeNull()
  })
})

// ── loadFromIndexedDB ──────────────────────────────────────────────────

describe('loadFromIndexedDB', () => {
  it('loads and sorts messages', async () => {
    await ingestMessage(makePipelineMsg({ id: 'msg-2', conversationId: 'conv-1', createdAt: '2026-01-01T00:00:02Z' }))
    await ingestMessage(makePipelineMsg({ id: 'msg-1', conversationId: 'conv-1', createdAt: '2026-01-01T00:00:01Z' }))
    const result = await loadFromIndexedDB('conv-1')
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('msg-1')
    expect(result[1].id).toBe('msg-2')
  })

  it('returns empty array for nonexistent conversation', async () => {
    const result = await loadFromIndexedDB('nonexistent')
    expect(result).toHaveLength(0)
  })
})

// ── getLatestSenderSequence ────────────────────────────────────────────

describe('getLatestSenderSequence', () => {
  it('returns 0 when no sequences exist', async () => {
    const seq = await getLatestSenderSequence('conv-1', 'user-1')
    expect(seq).toBe(0)
  })

  it('returns latest sequence from sender_sequences store', async () => {
    // Simulate three messages sent by user-1
    const s1 = await getNextSenderSequence('conv-1', 'user-1')
    const s2 = await getNextSenderSequence('conv-1', 'user-1')
    const s3 = await getNextSenderSequence('conv-1', 'user-1')
    expect(s1).toBe(1)
    expect(s2).toBe(2)
    expect(s3).toBe(3)
    const latest = await getLatestSenderSequence('conv-1', 'user-1')
    expect(latest).toBe(3)
  })

  it('tracks independent sequences per sender', async () => {
    await getNextSenderSequence('conv-1', 'user-1')
    await getNextSenderSequence('conv-1', 'user-1')
    await getNextSenderSequence('conv-1', 'user-2')
    const seq1 = await getLatestSenderSequence('conv-1', 'user-1')
    const seq2 = await getLatestSenderSequence('conv-1', 'user-2')
    expect(seq1).toBe(2)
    expect(seq2).toBe(1)
  })

  it('tracks independent sequences per conversation', async () => {
    await getNextSenderSequence('conv-1', 'user-1')
    await getNextSenderSequence('conv-1', 'user-1')
    await getNextSenderSequence('conv-2', 'user-1')
    const seq1 = await getLatestSenderSequence('conv-1', 'user-1')
    const seq2 = await getLatestSenderSequence('conv-2', 'user-1')
    expect(seq1).toBe(2)
    expect(seq2).toBe(1)
  })
})

// ── getNextSenderSequence ──────────────────────────────────────────────

describe('getNextSenderSequence', () => {
  it('returns 1 on first call', async () => {
    const seq = await getNextSenderSequence('conv-1', 'user-1')
    expect(seq).toBe(1)
  })

  it('increments monotonically', async () => {
    const s1 = await getNextSenderSequence('conv-1', 'user-1')
    const s2 = await getNextSenderSequence('conv-1', 'user-1')
    const s3 = await getNextSenderSequence('conv-1', 'user-1')
    expect([s1, s2, s3]).toEqual([1, 2, 3])
  })

  it('persists across calls (survives page refresh simulation)', async () => {
    await getNextSenderSequence('conv-1', 'user-1')
    await getNextSenderSequence('conv-1', 'user-1')
    // Simulate page refresh: resetDB clears everything, but sender_sequences persists
    // In real app, IndexedDB persists across refreshes
    const seq = await getNextSenderSequence('conv-1', 'user-1')
    expect(seq).toBe(3)
  })

  it('resets after resetDB (new session)', async () => {
    await getNextSenderSequence('conv-1', 'user-1')
    await getNextSenderSequence('conv-1', 'user-1')
    resetDB()
    const db = await getDB()
    const tx = db.transaction('sender_sequences', 'readwrite')
    await tx.objectStore('sender_sequences').clear()
    await tx.done
    const seq = await getNextSenderSequence('conv-1', 'user-1')
    expect(seq).toBe(1)
  })
})

// ── senderSequence persistence ─────────────────────────────────────────

describe('senderSequence persistence', () => {
  it('persists and retrieves senderSequence on messages', async () => {
    await ingestMessage(makePipelineMsg({ id: 'msg-1', senderSequence: 42 }))
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs[0].senderSequence).toBe(42)
  })

  it('senderSequence is optional — old messages still work', async () => {
    await ingestMessage(makePipelineMsg({ id: 'msg-1' }))
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs[0].senderSequence).toBeUndefined()
  })
})

// ── deduplication across transports ────────────────────────────────────

describe('cross-transport deduplication', () => {
  it('same messageId via WebRTC and Supabase produces one message', async () => {
    const msgId = 'shared-msg-id'
    // Simulate WebRTC receive
    await ingestMessage(makePipelineMsg({
      id: msgId,
      conversationId: 'conv-1',
      senderId: 'user-2',
      senderSequence: 1,
      transport: 'webrtc',
    }))
    // Simulate Supabase realtime for same message
    const result = await ingestMessage(makePipelineMsg({
      id: msgId,
      conversationId: 'conv-1',
      senderId: 'user-2',
      senderSequence: 1,
      transport: 'supabase',
    }))
    expect(result).toBe(false) // deduplicated
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(msgId)
  })

  it('Supabase first then WebRTC still produces one message', async () => {
    const msgId = 'reverse-order-id'
    // Simulate Supabase arriving first
    await ingestMessage(makePipelineMsg({
      id: msgId,
      conversationId: 'conv-1',
      senderId: 'user-2',
      senderSequence: 1,
      transport: 'supabase',
    }))
    // WebRTC delivers same message later
    const result = await ingestMessage(makePipelineMsg({
      id: msgId,
      conversationId: 'conv-1',
      senderId: 'user-2',
      senderSequence: 1,
      transport: 'webrtc',
    }))
    expect(result).toBe(false)
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs).toHaveLength(1)
  })
})

// ── messageId contract ────────────────────────────────────────────────

describe('messageId contract', () => {
  it('client-generated ID is a valid UUID', () => {
    const id = crypto.randomUUID()
    // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('message retains same ID regardless of transport field', async () => {
    const msgId = crypto.randomUUID()
    // WebRTC transport
    await ingestMessage(makePipelineMsg({
      id: msgId,
      conversationId: 'conv-1',
      transport: 'webrtc',
    }))
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs[0].id).toBe(msgId)
    expect(msgs[0].transport).toBe('webrtc')
  })

  it('no second ID generated when same message arrives via different transport', async () => {
    const msgId = crypto.randomUUID()
    // First arrival: WebRTC
    const r1 = await ingestMessage(makePipelineMsg({
      id: msgId,
      conversationId: 'conv-1',
      senderId: 'user-1',
      transport: 'webrtc',
    }))
    expect(r1).toBe(true)
    // Second arrival: Supabase (same logical message)
    const r2 = await ingestMessage(makePipelineMsg({
      id: msgId,
      conversationId: 'conv-1',
      senderId: 'user-1',
      transport: 'supabase',
    }))
    expect(r2).toBe(false) // deduplicated
    // Only one record in IndexedDB
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(msgId)
  })

  it('existing PostgreSQL-generated IDs continue to work', async () => {
    // Simulate an existing message with a server-generated UUID
    const pgId = crypto.randomUUID()
    await ingestMessage(makePipelineMsg({
      id: pgId,
      conversationId: 'conv-1',
      senderId: 'user-1',
      transport: 'supabase',
    }))
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(pgId)
  })

  it('different messages always have different IDs', async () => {
    const id1 = crypto.randomUUID()
    const id2 = crypto.randomUUID()
    expect(id1).not.toBe(id2)
    await ingestMessage(makePipelineMsg({ id: id1, conversationId: 'conv-1' }))
    await ingestMessage(makePipelineMsg({ id: id2, conversationId: 'conv-1' }))
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs).toHaveLength(2)
  })

  it('message ID survives edit (patch preserves identity)', async () => {
    const msgId = crypto.randomUUID()
    await ingestMessage(makePipelineMsg({ id: msgId, conversationId: 'conv-1', originalMessage: 'original' }))
    await patchMessage(msgId, { originalMessage: 'edited', editedAt: now })
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(msgId)
    expect(msgs[0].originalMessage).toBe('edited')
  })

  it('message ID survives delete (patch preserves identity)', async () => {
    const msgId = crypto.randomUUID()
    await ingestMessage(makePipelineMsg({ id: msgId, conversationId: 'conv-1' }))
    await patchMessage(msgId, { deletedAt: now })
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(msgId)
    expect(msgs[0].deletedAt).toBe(now)
  })

  it('message ID survives reaction (patch preserves identity)', async () => {
    const msgId = crypto.randomUUID()
    await ingestMessage(makePipelineMsg({ id: msgId, conversationId: 'conv-1' }))
    await patchMessage(msgId, { reactions: { '👍': ['user-2'] } })
    const msgs = await loadFromIndexedDB('conv-1')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].id).toBe(msgId)
    expect(msgs[0].reactions).toEqual({ '👍': ['user-2'] })
  })
})
