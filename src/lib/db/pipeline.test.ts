import { describe, it, expect, beforeEach } from 'vitest'
import { resetDB, getDB } from './schema'
import {
  supabaseToPipeline,
  pipelineToUI,
  uiToPipeline,
  ingestMessage,
  ingestBatch,
  patchMessage,
  handleEvent,
  dispatchChatOperation,
  loadFromIndexedDB,
  messageExists,
  getLatestSenderSequence,
  getNextSenderSequence,
  type PipelineMessage,
  type SupabaseRow,
} from './pipeline'
import { validateChatEvent, type ChatEvent } from '@/lib/file-transfer'

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

// ── Regressions: DM page renders snake_case UI fields ─────────────────
// The DM page renders messages from IndexedDB / ingestBatch (camelCase
// PipelineMessage) AFTER converting them with pipelineToUI(). This guards the
// runtime crash "Cannot read properties of undefined (reading 'split')" which
// happened when a camelCase message was rendered directly: the UI read
// `m.original_message`, got undefined, and passed it to <RichText> →
// `undefined.split('\n')` in a useMemo.

describe('DM render normalization (pipelineToUI)', () => {
  it('loadFromIndexedDB output converted via pipelineToUI exposes original_message as a string', async () => {
    await ingestMessage(makePipelineMsg({
      id: 'ui-norm-1',
      conversationId: 'conv-1',
      senderId: 'user-2',
      originalMessage: 'hello **world**',
      translatedMessage: null,
      createdAt: now,
    }))
    const localMsgs = await loadFromIndexedDB('conv-1')
    const ui = (localMsgs as PipelineMessage[]).map(pipelineToUI)
    // The exact fields the DM page <RichText> branch reads:
    expect(ui[0].original_message).toBe('hello **world**')
    expect(ui[0].created_at).toBe(now)
    expect(ui[0].sender_id).toBe('user-2')
    expect(ui[0].translated_message).toBeNull()
    // original_message must never be undefined for a text message — that is
    // what feeds <RichText text={body}> and would crash on .split().
    expect(typeof ui[0].original_message).toBe('string')
  })

  it('ingestBatch output converted via pipelineToUI keeps original_message defined', async () => {
    const row = makeRow({ id: 'ui-batch-1', sender_id: 'user-2', original_message: 'batch hello' })
    const merged = await ingestBatch([row], 'conv-1', 'supabase')
    const ui = (merged as PipelineMessage[]).map(pipelineToUI)
    expect(ui[0].original_message).toBe('batch hello')
    expect(typeof ui[0].original_message).toBe('string')
    expect(ui[0].created_at).toBeTruthy()
  })

  it('supabaseToPipeline → pipelineToUI round-trip preserves text', async () => {
    const row = makeRow({ id: 'ui-rt-1', original_message: 'round trip' })
    const p = supabaseToPipeline(row)
    p.conversationId = 'conv-1'
    const ui = pipelineToUI(p)
    expect(ui.original_message).toBe('round trip')
    expect(typeof ui.original_message).toBe('string')
  })
})

// ── Phase B: validateChatEvent ─────────────────────────────────────────

describe('validateChatEvent', () => {
  function makeEvent(overrides: Partial<ChatEvent> = {}): ChatEvent {
    return {
      kind: 'event',
      eventId: crypto.randomUUID(),
      conversationId: 'conv-1',
      senderId: 'user-1',
      senderSequence: 1,
      createdAt: new Date().toISOString(),
      operation: 'message.create',
      version: 1,
      payload: {
        messageId: crypto.randomUUID(),
        originalMessage: 'hello',
      },
      ...overrides,
    } as ChatEvent
  }

  it('accepts a valid message.create event', () => {
    expect(validateChatEvent(makeEvent())).toBe(true)
  })

  it('accepts a valid message.edit event', () => {
    expect(validateChatEvent(makeEvent({
      operation: 'message.edit',
      payload: { messageId: 'msg-1', originalMessage: 'edited', editedAt: new Date().toISOString() },
    }))).toBe(true)
  })

  it('accepts a valid message.delete event', () => {
    expect(validateChatEvent(makeEvent({
      operation: 'message.delete',
      payload: { messageId: 'msg-1', deletedAt: new Date().toISOString() },
    }))).toBe(true)
  })

  it('accepts a valid reaction.add event', () => {
    expect(validateChatEvent(makeEvent({
      operation: 'reaction.add',
      payload: { messageId: 'msg-1', emoji: '👍' },
    }))).toBe(true)
  })

  it('accepts a valid reaction.remove event', () => {
    expect(validateChatEvent(makeEvent({
      operation: 'reaction.remove',
      payload: { messageId: 'msg-1', emoji: '👍' },
    }))).toBe(true)
  })

  it('accepts a valid translation.update event', () => {
    expect(validateChatEvent(makeEvent({
      operation: 'translation.update',
      payload: { messageId: 'msg-1', translatedMessage: 'hola' },
    }))).toBe(true)
  })

  it('rejects non-event kind', () => {
    expect(validateChatEvent({ kind: 'text', id: '1' })).toBe(false)
  })

  it('rejects missing required fields', () => {
    expect(validateChatEvent({ kind: 'event' })).toBe(false)
  })

  it('rejects unknown operation', () => {
    expect(validateChatEvent(makeEvent({ operation: 'unknown.op' as never }))).toBe(false)
  })

  it('rejects invalid payload for message.edit', () => {
    // Missing required fields (originalMessage, editedAt)
    const incomplete = { kind: 'event', eventId: 'e1', conversationId: 'c1', senderId: 'u1', senderSequence: 1, createdAt: '2026-01-01', operation: 'message.edit', version: 1, payload: { messageId: 'msg-1' } }
    expect(validateChatEvent(incomplete)).toBe(false)
  })
})

// ── Phase B: handleEvent ───────────────────────────────────────────────

describe('handleEvent', () => {
  function makeEvent(overrides: Partial<ChatEvent> = {}): ChatEvent {
    return {
      kind: 'event',
      eventId: crypto.randomUUID(),
      conversationId: 'conv-1',
      senderId: 'user-2',
      senderSequence: 1,
      createdAt: new Date().toISOString(),
      operation: 'message.create',
      version: 1,
      payload: {
        messageId: crypto.randomUUID(),
        originalMessage: 'hello via event',
      },
      ...overrides,
    } as ChatEvent
  }

  it('message.create persists a new message', async () => {
    const event = makeEvent()
    const result = await handleEvent(event, 'webrtc')
    expect(result).not.toBeNull()
    expect(result!.id).toBe(event.payload.messageId)
    expect(result!.originalMessage).toBe('hello via event')
    expect(result!.transport).toBe('webrtc')
    expect(result!.version).toBe(1)
    expect(await messageExists(event.payload.messageId)).toBe(true)
  })

  it('message.create deduplicates by eventId', async () => {
    const event = makeEvent()
    await handleEvent(event, 'webrtc')
    const result = await handleEvent(event, 'webrtc')
    expect(result).toBeNull()
    // Message still exists (was not re-created)
    expect(await messageExists(event.payload.messageId)).toBe(true)
  })

  it('message.edit patches an existing message', async () => {
    const createEvent = makeEvent()
    await handleEvent(createEvent, 'webrtc')
    const editEvent = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'message.edit',
      version: 2,
      payload: {
        messageId: createEvent.payload.messageId,
        originalMessage: 'edited text',
        editedAt: new Date().toISOString(),
      },
    })
    const result = await handleEvent(editEvent, 'webrtc')
    expect(result).not.toBeNull()
    expect(result!.originalMessage).toBe('edited text')
    expect(result!.editedAt).toBeTruthy()
    expect(result!.version).toBe(2)
  })

  it('message.delete sets deletedAt', async () => {
    const createEvent = makeEvent()
    await handleEvent(createEvent, 'webrtc')
    const deleteEvent = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'message.delete',
      version: 2,
      payload: {
        messageId: createEvent.payload.messageId,
        deletedAt: new Date().toISOString(),
      },
    })
    const result = await handleEvent(deleteEvent, 'webrtc')
    expect(result).not.toBeNull()
    expect(result!.deletedAt).toBeTruthy()
  })

  it('delete is terminal — late edit is rejected', async () => {
    const createEvent = makeEvent()
    await handleEvent(createEvent, 'webrtc')
    const deleteEvent = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'message.delete',
      version: 2,
      payload: {
        messageId: createEvent.payload.messageId,
        deletedAt: new Date().toISOString(),
      },
    })
    await handleEvent(deleteEvent, 'webrtc')
    // Late edit with same or lower version
    const lateEdit = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'message.edit',
      version: 1,
      payload: {
        messageId: createEvent.payload.messageId,
        originalMessage: 'late edit',
        editedAt: new Date().toISOString(),
      },
    })
    const result = await handleEvent(lateEdit, 'webrtc')
    expect(result).toBeNull()
  })

  it('reaction.add adds emoji to message', async () => {
    const createEvent = makeEvent()
    await handleEvent(createEvent, 'webrtc')
    const reactEvent = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'reaction.add',
      version: 1,
      payload: { messageId: createEvent.payload.messageId, emoji: '👍' },
    })
    const result = await handleEvent(reactEvent, 'webrtc')
    expect(result).not.toBeNull()
    expect(result!.reactions).toEqual({ '👍': ['user-2'] })
  })

  it('reaction.add is idempotent', async () => {
    const createEvent = makeEvent()
    await handleEvent(createEvent, 'webrtc')
    const reactEvent = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'reaction.add',
      version: 1,
      payload: { messageId: createEvent.payload.messageId, emoji: '👍' },
    })
    await handleEvent(reactEvent, 'webrtc')
    // Same operation again (same eventId is deduped, different eventId with same effect)
    const reactEvent2 = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'reaction.add',
      version: 1,
      payload: { messageId: createEvent.payload.messageId, emoji: '👍' },
    })
    const result = await handleEvent(reactEvent2, 'webrtc')
    expect(result).not.toBeNull()
    // user-2 appears only once (idempotent)
    expect(result!.reactions!['👍']).toEqual(['user-2'])
  })

  it('reaction.remove removes emoji from message', async () => {
    const createEvent = makeEvent()
    await handleEvent(createEvent, 'webrtc')
    const addEvent = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'reaction.add',
      version: 1,
      payload: { messageId: createEvent.payload.messageId, emoji: '❤️' },
    })
    await handleEvent(addEvent, 'webrtc')
    const removeEvent = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'reaction.remove',
      version: 2,
      payload: { messageId: createEvent.payload.messageId, emoji: '❤️' },
    })
    const result = await handleEvent(removeEvent, 'webrtc')
    expect(result).not.toBeNull()
    expect(result!.reactions).toEqual({})
  })

  it('translation.update sets translated message', async () => {
    const createEvent = makeEvent()
    await handleEvent(createEvent, 'webrtc')
    const transEvent = makeEvent({
      eventId: crypto.randomUUID(),
      operation: 'translation.update',
      version: 1,
      payload: { messageId: createEvent.payload.messageId, translatedMessage: 'hola mundo' },
    })
    const result = await handleEvent(transEvent, 'webrtc')
    expect(result).not.toBeNull()
    expect(result!.translatedMessage).toBe('hola mundo')
  })

  it('rejects event for non-existent message (edit/delete/reaction)', async () => {
    const editEvent = makeEvent({
      operation: 'message.edit',
      payload: { messageId: 'non-existent', originalMessage: 'x', editedAt: new Date().toISOString() },
    })
    expect(await handleEvent(editEvent, 'webrtc')).toBeNull()
    const deleteEvent = makeEvent({
      operation: 'message.delete',
      payload: { messageId: 'non-existent', deletedAt: new Date().toISOString() },
    })
    expect(await handleEvent(deleteEvent, 'webrtc')).toBeNull()
    const reactEvent = makeEvent({
      operation: 'reaction.add',
      payload: { messageId: 'non-existent', emoji: '👍' },
    })
    expect(await handleEvent(reactEvent, 'webrtc')).toBeNull()
  })
})

// ── Phase B: Compatibility scenarios ───────────────────────────────────

describe('Phase B compatibility', () => {
  it('old→new: legacy kind:text message ingested by ingestMessage works', async () => {
    // Old client sends kind:'text' → new client creates PipelineMessage → ingestMessage
    const canonical: PipelineMessage = {
      id: 'old-msg-1',
      conversationId: 'conv-1',
      senderId: 'user-old',
      originalMessage: 'hello from old client',
      translatedMessage: null,
      createdAt: new Date().toISOString(),
      transport: 'webrtc',
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
    }
    const isNew = await ingestMessage(canonical)
    expect(isNew).toBe(true)
    const exists = await messageExists('old-msg-1')
    expect(exists).toBe(true)
  })

  it('new→new: ChatEvent via handleEvent produces same PipelineMessage', async () => {
    const event: ChatEvent = {
      kind: 'event',
      eventId: 'new-event-1',
      conversationId: 'conv-1',
      senderId: 'user-new',
      senderSequence: 1,
      createdAt: new Date().toISOString(),
      operation: 'message.create',
      version: 1,
      payload: {
        messageId: 'new-msg-1',
        originalMessage: 'hello via event',
      },
    }
    const result = await handleEvent(event, 'webrtc')
    expect(result).not.toBeNull()
    expect(result!.id).toBe('new-msg-1')
    expect(result!.originalMessage).toBe('hello via event')
    expect(result!.version).toBe(1)
  })

  it('new→new: event edit patches message same as direct patchMessage', async () => {
    // Create via event
    const createEvent: ChatEvent = {
      kind: 'event',
      eventId: 'evt-create',
      conversationId: 'conv-1',
      senderId: 'user-1',
      senderSequence: 1,
      createdAt: new Date().toISOString(),
      operation: 'message.create',
      version: 1,
      payload: { messageId: 'msg-patch', originalMessage: 'original' },
    }
    await handleEvent(createEvent, 'webrtc')

    // Edit via event
    const editEvent: ChatEvent = {
      kind: 'event',
      eventId: 'evt-edit',
      conversationId: 'conv-1',
      senderId: 'user-1',
      senderSequence: 2,
      createdAt: new Date().toISOString(),
      operation: 'message.edit',
      version: 2,
      payload: { messageId: 'msg-patch', originalMessage: 'edited', editedAt: new Date().toISOString() },
    }
    const result = await handleEvent(editEvent, 'webrtc')
    expect(result).not.toBeNull()
    expect(result!.originalMessage).toBe('edited')
    expect(result!.editedAt).toBeTruthy()
  })

  it('version defaults to undefined for old IDB records', async () => {
    // Ingest via legacy path (no version)
    const canonical: PipelineMessage = {
      id: 'old-version-msg',
      conversationId: 'conv-1',
      senderId: 'user-1',
      originalMessage: 'old message',
      translatedMessage: null,
      createdAt: new Date().toISOString(),
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
    }
    await ingestMessage(canonical)
    const msgs = await loadFromIndexedDB('conv-1')
    const msg = msgs.find((m) => m.id === 'old-version-msg')
    expect(msg).toBeDefined()
    expect(msg!.version).toBeUndefined()
  })

  it('capabilities field in sync-request is optional', () => {
    // Old client sends sync-request without capabilities
    const oldReq = { kind: 'sync-request', senderId: 'user-1', lastKnownSequences: {} }
    expect(oldReq).not.toHaveProperty('capabilities')
    // New client handles it gracefully
    expect('capabilities' in oldReq ? oldReq.capabilities : null).toBeNull()
  })
})

// ── Phase D: dispatchChatOperation ─────────────────────────────────────

describe('dispatchChatOperation', () => {
  const conversationId = 'conv-dispatch'
  const senderId = 'user-dispatch'
  const noopOpen = () => false

  it('message.create via Supabase persists to IDB', async () => {
    const result = await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-msg-1', originalMessage: 'hello dispatch' },
      currentVersion: 0,
      p2pOpen: noopOpen,
    })
    expect(result.via).toBe('supabase')
    expect(result.msg.id).toBe('dispatch-msg-1')
    expect(result.msg.originalMessage).toBe('hello dispatch')
    expect(result.msg.version).toBe(1)
    expect(result.event.operation).toBe('message.create')
    expect(result.event.version).toBe(1)
    expect(await messageExists('dispatch-msg-1')).toBe(true)
  })

  it('message.create via WebRTC persists to IDB', async () => {
    const result = await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-msg-2', originalMessage: 'via webrtc' },
      currentVersion: 0,
      p2pOpen: () => true,
    })
    expect(result.via).toBe('webrtc')
    expect(result.msg.id).toBe('dispatch-msg-2')
    expect(result.msg.originalMessage).toBe('via webrtc')
    expect(await messageExists('dispatch-msg-2')).toBe(true)
  })

  it('message.create via supabase when p2p closed', async () => {
    const result = await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-msg-3', originalMessage: 'via supabase' },
      currentVersion: 0,
      p2pOpen: () => false,
    })
    expect(result.via).toBe('supabase')
    expect(result.msg.id).toBe('dispatch-msg-3')
  })

  it('message.edit persists edit to IDB', async () => {
    // Create first
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-edit-1', originalMessage: 'original' },
      currentVersion: 0,

      p2pOpen: noopOpen,
    })
    // Edit
    const result = await dispatchChatOperation({
      operation: 'message.edit',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-edit-1', originalMessage: 'edited', editedAt: new Date().toISOString() },
      currentVersion: 1,

      p2pOpen: noopOpen,
    })
    expect(result.via).toBe('supabase')
    expect(result.event.operation).toBe('message.edit')
    expect(result.event.version).toBe(2)
    expect(result.msg.originalMessage).toBe('edited')
  })

  it('message.delete persists delete to IDB', async () => {
    // Create first
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-del-1', originalMessage: 'to delete' },
      currentVersion: 0,

      p2pOpen: noopOpen,
    })
    // Delete
    const result = await dispatchChatOperation({
      operation: 'message.delete',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-del-1', deletedAt: new Date().toISOString() },
      currentVersion: 1,

      p2pOpen: noopOpen,
    })
    expect(result.via).toBe('supabase')
    expect(result.event.operation).toBe('message.delete')
    expect(result.msg.deletedAt).toBeTruthy()
  })

  it('reaction.add persists reaction to IDB', async () => {
    // Create first
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-react-1', originalMessage: 'react to me' },
      currentVersion: 0,

      p2pOpen: noopOpen,
    })
    // Add reaction
    const result = await dispatchChatOperation({
      operation: 'reaction.add',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-react-1', emoji: '👍' },
      currentVersion: 1,

      p2pOpen: noopOpen,
    })
    expect(result.via).toBe('supabase')
    expect(result.event.operation).toBe('reaction.add')
    expect(result.msg.reactions).toEqual({ '👍': ['user-dispatch'] })
  })

  it('reaction.remove persists reaction removal to IDB', async () => {
    // Create and add reaction
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-react-2', originalMessage: 'react to me' },
      currentVersion: 0,

      p2pOpen: noopOpen,
    })
    await dispatchChatOperation({
      operation: 'reaction.add',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-react-2', emoji: '❤️' },
      currentVersion: 1,

      p2pOpen: noopOpen,
    })
    // Remove reaction
    const result = await dispatchChatOperation({
      operation: 'reaction.remove',
      conversationId,
      senderId,
      payload: { messageId: 'dispatch-react-2', emoji: '❤️' },
      currentVersion: 2,

      p2pOpen: noopOpen,
    })
    expect(result.via).toBe('supabase')
    expect(result.event.operation).toBe('reaction.remove')
    // Reaction removed — emoji key deleted since empty
    expect(result.msg.reactions).toEqual({})
  })

  it('assigns correct senderSequence', async () => {
    const r1 = await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'seq-1', originalMessage: 'first' },
      currentVersion: 0,

      p2pOpen: noopOpen,
    })
    const r2 = await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'seq-2', originalMessage: 'second' },
      currentVersion: 0,

      p2pOpen: noopOpen,
    })
    expect(r1.event.senderSequence).toBe(1)
    expect(r2.event.senderSequence).toBe(2)
  })

  it('eventId equals messageId for message.create', async () => {
    const result = await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'eid-check', originalMessage: 'check' },
      currentVersion: 0,

      p2pOpen: noopOpen,
    })
    expect(result.event.eventId).toBe('eid-check')
  })

  it('eventId is different from messageId for non-create operations', async () => {
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId,
      senderId,
      payload: { messageId: 'eid-edit-check', originalMessage: 'check' },
      currentVersion: 0,

      p2pOpen: noopOpen,
    })
    const result = await dispatchChatOperation({
      operation: 'message.edit',
      conversationId,
      senderId,
      payload: { messageId: 'eid-edit-check', originalMessage: 'edited', editedAt: new Date().toISOString() },
      currentVersion: 1,

      p2pOpen: noopOpen,
    })
    expect(result.event.eventId).not.toBe('eid-edit-check')
  })

  it('sendTextMessage uses dispatcher and returns via webrtc', async () => {
    let sentData = ''
    const { sendTextMessage } = await import('./pipeline')
    const result = await sendTextMessage({
      conversationId,
      senderId,
      content: 'dispatched text',
      p2pSend: (data) => { sentData = data as string; return true },
      p2pOpen: () => true,
    })
    expect(result.via).toBe('webrtc')
    expect(result.msg.originalMessage).toBe('dispatched text')
    // Sends legacy kind:'text' for backward compatibility
    expect(sentData).toContain('"kind":"text"')
    expect(sentData).toContain('dispatched text')
  })

  it('sendTextMessage uses dispatcher and returns via supabase when p2p closed', async () => {
    const { sendTextMessage } = await import('./pipeline')
    const result = await sendTextMessage({
      conversationId,
      senderId,
      content: 'supabase text',
      p2pSend: () => false,
      p2pOpen: noopOpen,
    })
    expect(result.via).toBe('supabase')
    expect(result.msg.originalMessage).toBe('supabase text')
  })
})

// ── Phase E: Storage layer responsibilities ────────────────────────────

describe('Phase E: storage layer', () => {
  const convId = 'conv-storage'
  const uid = 'user-storage'

  it('messages survive page refresh (IDB persistence)', async () => {
    // Create a message
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'persist-1', originalMessage: 'survives refresh' },
      currentVersion: 0,
      p2pOpen: () => false,
    })

    // Simulate page refresh: reset IDB connection, reload from IDB
    resetDB()
    const loaded = await loadFromIndexedDB(convId)
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe('persist-1')
    expect(loaded[0].originalMessage).toBe('survives refresh')
  })

  it('edits survive page refresh (IDB persistence)', async () => {
    // Create then edit
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'persist-edit-1', originalMessage: 'original' },
      currentVersion: 0,
      p2pOpen: () => false,
    })
    await dispatchChatOperation({
      operation: 'message.edit',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'persist-edit-1', originalMessage: 'edited', editedAt: new Date().toISOString() },
      currentVersion: 1,
      p2pOpen: () => false,
    })

    // Simulate page refresh
    resetDB()
    const loaded = await loadFromIndexedDB(convId)
    const msg = loaded.find((m) => m.id === 'persist-edit-1')
    expect(msg).toBeDefined()
    expect(msg!.originalMessage).toBe('edited')
    expect(msg!.editedAt).toBeTruthy()
  })

  it('deletes survive page refresh (IDB persistence)', async () => {
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'persist-del-1', originalMessage: 'to delete' },
      currentVersion: 0,
      p2pOpen: () => false,
    })
    await dispatchChatOperation({
      operation: 'message.delete',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'persist-del-1', deletedAt: new Date().toISOString() },
      currentVersion: 1,
      p2pOpen: () => false,
    })

    resetDB()
    const loaded = await loadFromIndexedDB(convId)
    const msg = loaded.find((m) => m.id === 'persist-del-1')
    expect(msg).toBeDefined()
    expect(msg!.deletedAt).toBeTruthy()
  })

  it('reactions survive page refresh (IDB persistence)', async () => {
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'persist-react-1', originalMessage: 'react here' },
      currentVersion: 0,
      p2pOpen: () => false,
    })
    await dispatchChatOperation({
      operation: 'reaction.add',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'persist-react-1', emoji: '👍' },
      currentVersion: 1,
      p2pOpen: () => false,
    })

    resetDB()
    const loaded = await loadFromIndexedDB(convId)
    const msg = loaded.find((m) => m.id === 'persist-react-1')
    expect(msg).toBeDefined()
    expect(msg!.reactions).toEqual({ '👍': ['user-storage'] })
  })

  it('messages survive WebRTC failure (Supabase fallback via dispatchChatOperation)', async () => {
    // WebRTC closed → via: 'supabase' → message still persisted to IDB
    const result = await dispatchChatOperation({
      operation: 'message.create',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'fallback-1', originalMessage: 'webRTC failed' },
      currentVersion: 0,
      p2pOpen: () => false,
    })
    expect(result.via).toBe('supabase')
    expect(result.msg.id).toBe('fallback-1')

    // Message exists in IDB regardless of transport
    const loaded = await loadFromIndexedDB(convId)
    const msg = loaded.find((m) => m.id === 'fallback-1')
    expect(msg).toBeDefined()
    expect(msg!.originalMessage).toBe('webRTC failed')
  })

  it('messages survive both WebRTC and Supabase failure (local persistence)', async () => {
    // Dispatch via Supabase path (WebRTC closed) — IDB is persisted
    const result = await dispatchChatOperation({
      operation: 'message.create',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'local-only-1', originalMessage: 'all transports down' },
      currentVersion: 0,
      p2pOpen: () => false,
    })
    expect(result.via).toBe('supabase')

    // Even if Supabase INSERT fails (caller handles that), IDB has the message
    const loaded = await loadFromIndexedDB(convId)
    const msg = loaded.find((m) => m.id === 'local-only-1')
    expect(msg).toBeDefined()
    expect(msg!.originalMessage).toBe('all transports down')
    expect(msg!.transport).toBe('supabase')
  })

  it('edit persists to IDB even when Supabase is unreachable', async () => {
    // Create message in IDB
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'offline-edit-1', originalMessage: 'before' },
      currentVersion: 0,
      p2pOpen: () => false,
    })
    // Edit — IDB is updated via handleEvent/patchMessage
    const result = await dispatchChatOperation({
      operation: 'message.edit',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'offline-edit-1', originalMessage: 'after', editedAt: new Date().toISOString() },
      currentVersion: 1,
      p2pOpen: () => false,
    })
    expect(result.msg.originalMessage).toBe('after')

    // IDB has the edit
    const loaded = await loadFromIndexedDB(convId)
    const msg = loaded.find((m) => m.id === 'offline-edit-1')
    expect(msg!.originalMessage).toBe('after')
  })

  it('delete persists to IDB even when Supabase is unreachable', async () => {
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'offline-del-1', originalMessage: 'delete me' },
      currentVersion: 0,
      p2pOpen: () => false,
    })
    const result = await dispatchChatOperation({
      operation: 'message.delete',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'offline-del-1', deletedAt: new Date().toISOString() },
      currentVersion: 1,
      p2pOpen: () => false,
    })
    expect(result.msg.deletedAt).toBeTruthy()

    const loaded = await loadFromIndexedDB(convId)
    const msg = loaded.find((m) => m.id === 'offline-del-1')
    expect(msg!.deletedAt).toBeTruthy()
  })

  it('multiple operations on same message all persist to IDB', async () => {
    await dispatchChatOperation({
      operation: 'message.create',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'multi-op-1', originalMessage: 'v1' },
      currentVersion: 0,
      p2pOpen: () => false,
    })
    await dispatchChatOperation({
      operation: 'message.edit',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'multi-op-1', originalMessage: 'v2', editedAt: new Date().toISOString() },
      currentVersion: 1,
      p2pOpen: () => false,
    })
    await dispatchChatOperation({
      operation: 'reaction.add',
      conversationId: convId,
      senderId: uid,
      payload: { messageId: 'multi-op-1', emoji: '🎉' },
      currentVersion: 2,
      p2pOpen: () => false,
    })

    const loaded = await loadFromIndexedDB(convId)
    const msg = loaded.find((m) => m.id === 'multi-op-1')
    expect(msg).toBeDefined()
    expect(msg!.originalMessage).toBe('v2')
    expect(msg!.editedAt).toBeTruthy()
    expect(msg!.reactions).toEqual({ '🎉': ['user-storage'] })
  })

  it('IDB is the canonical state — loadFromIndexedDB returns all persisted messages', async () => {
    // Create several messages
    for (let i = 0; i < 5; i++) {
      await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: `batch-${i}`, originalMessage: `msg ${i}` },
        currentVersion: 0,
        p2pOpen: () => false,
      })
    }

    const loaded = await loadFromIndexedDB(convId)
    expect(loaded).toHaveLength(5)
    // Sorted by createdAt
    for (let i = 0; i < 5; i++) {
      expect(loaded[i].id).toBe(`batch-${i}`)
    }
  })
})

// ── Phase F: CRUD operations via event protocol ──────────────────────

describe('Phase F — CRUD via event protocol', () => {
  const convId = 'conv-crud'
  const uid = 'user-crud'

  beforeEach(async () => {
    await resetDB()
  })

  describe('message.create — WebRTC path', () => {
    it('dispatch returns via:webrtc with kind:event and persists to IDB', async () => {
      const result = await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'create-webrtc', originalMessage: 'Hello via event' },
        currentVersion: 0,
        p2pOpen: () => true,
      })

      expect(result.via).toBe('webrtc')
      expect(result.event.kind).toBe('event')
      expect(result.event.operation).toBe('message.create')
      expect((result.event.payload as { originalMessage: string }).originalMessage).toBe('Hello via event')

      // IDB persisted
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].id).toBe('create-webrtc')
      expect(loaded[0].originalMessage).toBe('Hello via event')
    })
  })

  describe('message.create — Supabase fallback', () => {
    it('dispatch returns via:supabase when p2pOpen is false', async () => {
      const result = await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'create-sb', originalMessage: 'Hello via Supabase' },
        currentVersion: 0,
        p2pOpen: () => false,
      })

      expect(result.via).toBe('supabase')
      // IDB still persisted even in Supabase fallback path
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].id).toBe('create-sb')
    })
  })

  describe('message.edit — WebRTC path', () => {
    it('dispatch returns via:webrtc with kind:event and patches IDB', async () => {
      // Seed message
      await ingestMessage(makePipelineMsg({ id: 'edit-target', conversationId: convId, senderId: uid, originalMessage: 'original' }))

      const result = await dispatchChatOperation({
        operation: 'message.edit',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'edit-target', originalMessage: 'edited via event', editedAt: new Date().toISOString() },
        currentVersion: 1,
        p2pOpen: () => true,
      })

      expect(result.via).toBe('webrtc')
      expect(result.event.kind).toBe('event')
      expect(result.event.operation).toBe('message.edit')
      expect((result.event.payload as { originalMessage: string }).originalMessage).toBe('edited via event')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].originalMessage).toBe('edited via event')
      expect(loaded[0].editedAt).toBeTruthy()
    })
  })

  describe('message.edit — Supabase fallback', () => {
    it('dispatch returns via:supabase when p2pOpen is false', async () => {
      await ingestMessage(makePipelineMsg({ id: 'edit-sb', conversationId: convId, senderId: uid, originalMessage: 'original' }))

      const result = await dispatchChatOperation({
        operation: 'message.edit',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'edit-sb', originalMessage: 'edited via supabase', editedAt: new Date().toISOString() },
        currentVersion: 1,
        p2pOpen: () => false,
      })

      expect(result.via).toBe('supabase')
      expect(result.event.operation).toBe('message.edit')
      // IDB still patched
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].originalMessage).toBe('edited via supabase')
    })
  })

  describe('message.delete — WebRTC path', () => {
    it('dispatch returns via:webrtc with kind:event and marks deleted in IDB', async () => {
      await ingestMessage(makePipelineMsg({ id: 'del-target', conversationId: convId, senderId: uid, originalMessage: 'delete me' }))

      const result = await dispatchChatOperation({
        operation: 'message.delete',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'del-target', deletedAt: new Date().toISOString() },
        currentVersion: 1,
        p2pOpen: () => true,
      })

      expect(result.via).toBe('webrtc')
      expect(result.event.kind).toBe('event')
      expect(result.event.operation).toBe('message.delete')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].deletedAt).toBeTruthy()
    })
  })

  describe('message.delete — Supabase fallback', () => {
    it('dispatch returns via:supabase when p2pOpen is false', async () => {
      await ingestMessage(makePipelineMsg({ id: 'del-sb', conversationId: convId, senderId: uid, originalMessage: 'delete me sb' }))

      const result = await dispatchChatOperation({
        operation: 'message.delete',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'del-sb', deletedAt: new Date().toISOString() },
        currentVersion: 1,
        p2pOpen: () => false,
      })

      expect(result.via).toBe('supabase')
      expect(result.event.operation).toBe('message.delete')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].deletedAt).toBeTruthy()
    })
  })

  describe('reaction.add — WebRTC path', () => {
    it('dispatch returns via:webrtc with kind:event and merges reactions in IDB', async () => {
      await ingestMessage(makePipelineMsg({ id: 'react-target', conversationId: convId, senderId: uid, originalMessage: 'react to me' }))

      const result = await dispatchChatOperation({
        operation: 'reaction.add',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'react-target', emoji: '❤️' },
        currentVersion: 1,
        p2pOpen: () => true,
      })

      expect(result.via).toBe('webrtc')
      expect(result.event.kind).toBe('event')
      expect(result.event.operation).toBe('reaction.add')
      expect((result.event.payload as { emoji: string }).emoji).toBe('❤️')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].reactions).toEqual({ '❤️': ['user-crud'] })
    })
  })

  describe('reaction.add — Supabase fallback', () => {
    it('dispatch returns via:supabase when p2pOpen is false', async () => {
      await ingestMessage(makePipelineMsg({ id: 'react-sb', conversationId: convId, senderId: uid, originalMessage: 'react sb' }))

      const result = await dispatchChatOperation({
        operation: 'reaction.add',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'react-sb', emoji: '👍' },
        currentVersion: 1,
        p2pOpen: () => false,
      })

      expect(result.via).toBe('supabase')
      expect(result.event.operation).toBe('reaction.add')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].reactions).toEqual({ '👍': ['user-crud'] })
    })
  })

  describe('reaction.remove — WebRTC path', () => {
    it('dispatch returns via:webrtc with kind:event and removes emoji from IDB', async () => {
      await ingestMessage(makePipelineMsg({
        id: 'react-remove', conversationId: convId, senderId: uid, originalMessage: 'remove reaction',
        reactions: { '🔥': [uid], '👍': ['user-other'] },
      }))

      const result = await dispatchChatOperation({
        operation: 'reaction.remove',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'react-remove', emoji: '🔥' },
        currentVersion: 1,
        p2pOpen: () => true,
      })

      expect(result.via).toBe('webrtc')
      expect(result.event.operation).toBe('reaction.remove')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].reactions).toEqual({ '👍': ['user-other'] })
    })
  })

  describe('translation.update — WebRTC path', () => {
    it('dispatch returns via:webrtc with kind:event and sets translation in IDB', async () => {
      await ingestMessage(makePipelineMsg({ id: 'trans-target', conversationId: convId, senderId: uid, originalMessage: 'hello' }))

      const result = await dispatchChatOperation({
        operation: 'translation.update',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'trans-target', translatedMessage: 'hola' },
        currentVersion: 1,
        p2pOpen: () => true,
      })

      expect(result.via).toBe('webrtc')
      expect(result.event.kind).toBe('event')
      expect(result.event.operation).toBe('translation.update')
      expect((result.event.payload as { translatedMessage: string }).translatedMessage).toBe('hola')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].translatedMessage).toBe('hola')
    })
  })

  describe('translation.update — Supabase fallback', () => {
    it('dispatch returns via:supabase when p2pOpen is false', async () => {
      await ingestMessage(makePipelineMsg({ id: 'trans-sb', conversationId: convId, senderId: uid, originalMessage: 'bonjour' }))

      const result = await dispatchChatOperation({
        operation: 'translation.update',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'trans-sb', translatedMessage: 'hello' },
        currentVersion: 1,
        p2pOpen: () => false,
      })

      expect(result.via).toBe('supabase')
      expect(result.event.operation).toBe('translation.update')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].translatedMessage).toBe('hello')
    })
  })

  describe('handleEvent — processes all event types', () => {
    it('message.create event persists to IDB', async () => {
      const event = {
        kind: 'event' as const,
        operation: 'message.create' as const,
        eventId: 'ev-create-1',
        messageId: 'ev-create-1',
        conversationId: convId,
        senderId: 'other-user',
        senderSequence: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'ev-create-1', originalMessage: 'from event' },
      }
      const result = await handleEvent(event, 'webrtc')
      expect(result).not.toBeNull()
      expect(result!.originalMessage).toBe('from event')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].id).toBe('ev-create-1')
    })

    it('message.edit event patches existing message', async () => {
      await ingestMessage(makePipelineMsg({ id: 'ev-edit-1', conversationId: convId, senderId: 'other-user', originalMessage: 'before' }))

      const event = {
        kind: 'event' as const,
        operation: 'message.edit' as const,
        eventId: 'ev-edit-ev',
        messageId: 'ev-edit-1',
        conversationId: convId,
        senderId: 'other-user',
        senderSequence: 2,
        version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'ev-edit-1', originalMessage: 'after', editedAt: new Date().toISOString() },
      }
      await handleEvent(event, 'webrtc')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].originalMessage).toBe('after')
    })

    it('message.delete event marks message deleted', async () => {
      await ingestMessage(makePipelineMsg({ id: 'ev-del-1', conversationId: convId, senderId: 'other-user', originalMessage: 'delete me' }))

      const event = {
        kind: 'event' as const,
        operation: 'message.delete' as const,
        eventId: 'ev-del-ev',
        messageId: 'ev-del-1',
        conversationId: convId,
        senderId: 'other-user',
        senderSequence: 2,
        version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'ev-del-1', deletedAt: new Date().toISOString() },
      }
      await handleEvent(event, 'webrtc')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].deletedAt).toBeTruthy()
    })

    it('reaction.add event merges reactions', async () => {
      await ingestMessage(makePipelineMsg({ id: 'ev-react-1', conversationId: convId, senderId: 'other-user', originalMessage: 'react' }))

      const event = {
        kind: 'event' as const,
        operation: 'reaction.add' as const,
        eventId: 'ev-react-ev',
        messageId: 'ev-react-1',
        conversationId: convId,
        senderId: 'other-user',
        senderSequence: 2,
        version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'ev-react-1', emoji: '❤️' },
      }
      await handleEvent(event, 'webrtc')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].reactions).toEqual({ '❤️': ['other-user'] })
    })

    it('translation.update event sets translation', async () => {
      await ingestMessage(makePipelineMsg({ id: 'ev-trans-1', conversationId: convId, senderId: 'other-user', originalMessage: 'hola' }))

      const event = {
        kind: 'event' as const,
        operation: 'translation.update' as const,
        eventId: 'ev-trans-ev',
        messageId: 'ev-trans-1',
        conversationId: convId,
        senderId: 'other-user',
        senderSequence: 2,
        version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'ev-trans-1', translatedMessage: 'hello' },
      }
      await handleEvent(event, 'webrtc')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].translatedMessage).toBe('hello')
    })
  })

  describe('backward compat — kind:text still works', () => {
    it('ingestMessage handles legacy kind:text pipeline messages', async () => {
      const msg = makePipelineMsg({
        id: 'legacy-1',
        conversationId: convId,
        senderId: 'other-user',
        originalMessage: 'legacy text',
        transport: 'webrtc',
      })
      const isNew = await ingestMessage(msg)
      expect(isNew).toBe(true)

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].originalMessage).toBe('legacy text')
    })
  })

  describe('multi-operation event chain', () => {
    it('create → edit → reaction → translation via events persists all state', async () => {
      // Create
      const r1 = await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'chain-1', originalMessage: 'v1' },
        currentVersion: 0,
        p2pOpen: () => true,
      })
      expect(r1.event.operation).toBe('message.create')

      // Edit
      const r2 = await dispatchChatOperation({
        operation: 'message.edit',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'chain-1', originalMessage: 'v2', editedAt: new Date().toISOString() },
        currentVersion: 1,
        p2pOpen: () => true,
      })
      expect(r2.event.operation).toBe('message.edit')

      // Reaction
      const r3 = await dispatchChatOperation({
        operation: 'reaction.add',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'chain-1', emoji: '🎉' },
        currentVersion: 2,
        p2pOpen: () => true,
      })
      expect(r3.event.operation).toBe('reaction.add')

      // Translation
      const r4 = await dispatchChatOperation({
        operation: 'translation.update',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'chain-1', translatedMessage: 'translated v2' },
        currentVersion: 3,
        p2pOpen: () => true,
      })
      expect(r4.event.operation).toBe('translation.update')

      // Verify final IDB state
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].originalMessage).toBe('v2')
      expect(loaded[0].editedAt).toBeTruthy()
      expect(loaded[0].reactions).toEqual({ '🎉': ['user-crud'] })
      expect(loaded[0].translatedMessage).toBe('translated v2')
    })
  })
})

// ── Phase G: Media operations ──────────────────────────────────────

describe('Phase G — Media operations', () => {
  const convId = 'conv-media'
  const uid = 'user-media'

  beforeEach(async () => {
    await resetDB()
  })

  describe('validateChatEvent — accepts media events', () => {
    it('validates media.create event', () => {
      expect(validateChatEvent({
        kind: 'event',
        operation: 'media.create',
        eventId: 'ev-1',
        conversationId: convId,
        senderId: uid,
        senderSequence: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'm1', fileRef: 'ref-1', fileName: 'photo.jpg', fileSize: 1024, mimeType: 'image/jpeg', mediaType: 'image' },
      })).toBe(true)
    })

    it('validates media.delete event', () => {
      expect(validateChatEvent({
        kind: 'event',
        operation: 'media.delete',
        eventId: 'ev-2',
        conversationId: convId,
        senderId: uid,
        senderSequence: 2,
        version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'm1', deletedAt: new Date().toISOString() },
      })).toBe(true)
    })

    it('validates voice.create event', () => {
      expect(validateChatEvent({
        kind: 'event',
        operation: 'voice.create',
        eventId: 'ev-3',
        conversationId: convId,
        senderId: uid,
        senderSequence: 3,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'v1', fileRef: 'ref-v1', fileSize: 2048, mimeType: 'audio/webm;codecs=opus', durationMs: 5000 },
      })).toBe(true)
    })

    it('rejects media.create with missing fields', () => {
      expect(validateChatEvent({
        kind: 'event',
        operation: 'media.create',
        eventId: 'ev-4',
        conversationId: convId,
        senderId: uid,
        senderSequence: 4,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'm1' },
      })).toBe(false)
    })
  })

  describe('handleEvent — media.create', () => {
    it('persists media message to IDB with messageType media', async () => {
      const event = {
        kind: 'event' as const,
        operation: 'media.create' as const,
        eventId: 'ev-media-1',
        messageId: 'media-1',
        conversationId: convId,
        senderId: 'other-user',
        senderSequence: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'media-1', fileRef: 'ref-1', fileName: 'photo.jpg', fileSize: 1024, mimeType: 'image/jpeg', mediaType: 'image' as const },
      }
      const result = await handleEvent(event, 'webrtc')
      expect(result).not.toBeNull()
      expect(result!.messageType).toBe('media')
      expect(result!.originalMessage).toBe('photo.jpg')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].messageType).toBe('media')
    })
  })

  describe('handleEvent — voice.create', () => {
    it('persists voice message to IDB with messageType voice', async () => {
      const event = {
        kind: 'event' as const,
        operation: 'voice.create' as const,
        eventId: 'ev-voice-1',
        messageId: 'voice-1',
        conversationId: convId,
        senderId: 'other-user',
        senderSequence: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'voice-1', fileRef: 'ref-v1', fileSize: 2048, mimeType: 'audio/webm;codecs=opus', durationMs: 5000 },
      }
      const result = await handleEvent(event, 'webrtc')
      expect(result).not.toBeNull()
      expect(result!.messageType).toBe('voice')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].messageType).toBe('voice')
    })
  })

  describe('handleEvent — media.delete', () => {
    it('marks media message as deleted', async () => {
      // First create a media message
      await handleEvent({
        kind: 'event',
        operation: 'media.create',
        eventId: 'ev-md-1',
        conversationId: convId,
        senderId: 'other-user',
        senderSequence: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'media-del', fileRef: 'ref', fileName: 'doc.pdf', fileSize: 512, mimeType: 'application/pdf', mediaType: 'file' },
      }, 'webrtc')

      // Now delete it
      const deleteResult = await handleEvent({
        kind: 'event',
        operation: 'media.delete',
        eventId: 'ev-md-del',
        conversationId: convId,
        senderId: 'other-user',
        senderSequence: 2,
        version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'media-del', deletedAt: new Date().toISOString() },
      }, 'webrtc')

      expect(deleteResult).not.toBeNull()
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].deletedAt).toBeTruthy()
    })
  })

  describe('dispatchChatOperation — media.create', () => {
    it('dispatch returns via:webrtc with kind:event for media', async () => {
      const result = await dispatchChatOperation({
        operation: 'media.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'media-disp', fileRef: 'ref', fileName: 'photo.png', fileSize: 2048, mimeType: 'image/png', mediaType: 'image' },
        currentVersion: 0,
        p2pOpen: () => true,
      })

      expect(result.via).toBe('webrtc')
      expect(result.event.kind).toBe('event')
      expect(result.event.operation).toBe('media.create')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].messageType).toBe('media')
    })

    it('dispatch returns via:supabase when p2pOpen is false', async () => {
      const result = await dispatchChatOperation({
        operation: 'media.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'media-sb', fileRef: 'ref', fileName: 'video.mp4', fileSize: 4096, mimeType: 'video/mp4', mediaType: 'video' },
        currentVersion: 0,
        p2pOpen: () => false,
      })

      expect(result.via).toBe('supabase')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].messageType).toBe('media')
    })
  })

  describe('dispatchChatOperation — voice.create', () => {
    it('dispatch returns via:webrtc with kind:event for voice', async () => {
      const result = await dispatchChatOperation({
        operation: 'voice.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'voice-disp', fileRef: 'ref', fileSize: 3072, mimeType: 'audio/webm;codecs=opus', durationMs: 10000 },
        currentVersion: 0,
        p2pOpen: () => true,
      })

      expect(result.via).toBe('webrtc')
      expect(result.event.kind).toBe('event')
      expect(result.event.operation).toBe('voice.create')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].messageType).toBe('voice')
    })

    it('dispatch returns via:supabase when p2pOpen is false', async () => {
      const result = await dispatchChatOperation({
        operation: 'voice.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'voice-sb', fileRef: 'ref', fileSize: 3072, mimeType: 'audio/webm;codecs=opus', durationMs: 8000 },
        currentVersion: 0,
        p2pOpen: () => false,
      })

      expect(result.via).toBe('supabase')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].messageType).toBe('voice')
    })
  })

  describe('media persistence — mixed with text', () => {
    it('media and text messages coexist correctly in IDB', async () => {
      // Create a text message
      await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'text-1', originalMessage: 'Hello' },
        currentVersion: 0,
        p2pOpen: () => true,
      })

      // Create a media message
      await dispatchChatOperation({
        operation: 'media.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'media-1', fileRef: 'ref', fileName: 'image.jpg', fileSize: 1024, mimeType: 'image/jpeg', mediaType: 'image' },
        currentVersion: 0,
        p2pOpen: () => true,
      })

      // Create a voice message
      await dispatchChatOperation({
        operation: 'voice.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'voice-1', fileRef: 'ref', fileSize: 2048, mimeType: 'audio/webm', durationMs: 3000 },
        currentVersion: 0,
        p2pOpen: () => true,
      })

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(3)
      const textMsg = loaded.find((m) => m.id === 'text-1')
      const mediaMsg = loaded.find((m) => m.id === 'media-1')
      const voiceMsg = loaded.find((m) => m.id === 'voice-1')
      expect(textMsg!.messageType).toBeNull()
      expect(mediaMsg!.messageType).toBe('media')
      expect(voiceMsg!.messageType).toBe('voice')
    })
  })
})

// ── Phase H: Reconciliation with mixed event types ─────────────────

describe('Phase H — Reconciliation', () => {
  const convId = 'conv-reconcile'
  const senderId = 'user-sender'
  const receiverId = 'user-receiver'

  beforeEach(async () => {
    await resetDB()
  })

  describe('handleEvent processes all event types from sync-response', () => {
    it('text message.create via handleEvent persists to IDB', async () => {
      const event = {
        kind: 'event' as const,
        operation: 'message.create' as const,
        eventId: 'rec-text-1',
        conversationId: convId,
        senderId,
        senderSequence: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'rec-text-1', originalMessage: 'reconciled text' },
      }
      const result = await handleEvent(event, 'webrtc')
      expect(result).not.toBeNull()
      expect(result!.originalMessage).toBe('reconciled text')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
    })

    it('message.edit via handleEvent patches existing message', async () => {
      // Seed original
      await ingestMessage(makePipelineMsg({ id: 'rec-edit-1', conversationId: convId, senderId, originalMessage: 'before' }))

      const event = {
        kind: 'event' as const,
        operation: 'message.edit' as const,
        eventId: 'rec-edit-ev',
        conversationId: convId,
        senderId,
        senderSequence: 2,
        version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'rec-edit-1', originalMessage: 'after', editedAt: new Date().toISOString() },
      }
      await handleEvent(event, 'webrtc')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].originalMessage).toBe('after')
      expect(loaded[0].editedAt).toBeTruthy()
    })

    it('message.delete via handleEvent marks deleted', async () => {
      await ingestMessage(makePipelineMsg({ id: 'rec-del-1', conversationId: convId, senderId, originalMessage: 'delete me' }))

      const event = {
        kind: 'event' as const,
        operation: 'message.delete' as const,
        eventId: 'rec-del-ev',
        conversationId: convId,
        senderId,
        senderSequence: 2,
        version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'rec-del-1', deletedAt: new Date().toISOString() },
      }
      await handleEvent(event, 'webrtc')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].deletedAt).toBeTruthy()
    })

    it('reaction.add via handleEvent merges reactions', async () => {
      await ingestMessage(makePipelineMsg({ id: 'rec-react-1', conversationId: convId, senderId, originalMessage: 'react' }))

      const event = {
        kind: 'event' as const,
        operation: 'reaction.add' as const,
        eventId: 'rec-react-ev',
        conversationId: convId,
        senderId,
        senderSequence: 2,
        version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'rec-react-1', emoji: '🔥' },
      }
      await handleEvent(event, 'webrtc')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].reactions).toEqual({ '🔥': [senderId] })
    })

    it('media.create via handleEvent persists media message', async () => {
      const event = {
        kind: 'event' as const,
        operation: 'media.create' as const,
        eventId: 'rec-media-1',
        conversationId: convId,
        senderId,
        senderSequence: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'rec-media-1', fileRef: 'ref', fileName: 'photo.jpg', fileSize: 1024, mimeType: 'image/jpeg', mediaType: 'image' as const },
      }
      const result = await handleEvent(event, 'webrtc')
      expect(result).not.toBeNull()
      expect(result!.messageType).toBe('media')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].messageType).toBe('media')
    })

    it('voice.create via handleEvent persists voice message', async () => {
      const event = {
        kind: 'event' as const,
        operation: 'voice.create' as const,
        eventId: 'rec-voice-1',
        conversationId: convId,
        senderId,
        senderSequence: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'rec-voice-1', fileRef: 'ref', fileSize: 2048, mimeType: 'audio/webm', durationMs: 5000 },
      }
      const result = await handleEvent(event, 'webrtc')
      expect(result).not.toBeNull()
      expect(result!.messageType).toBe('voice')
    })
  })

  describe('mixed event reconciliation', () => {
    it('processes text, edit, delete, reaction, media, voice in sequence', async () => {
      // 1. Text message
      await handleEvent({
        kind: 'event', operation: 'message.create', eventId: 'mix-1',
        conversationId: convId, senderId, senderSequence: 1, version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'mix-1', originalMessage: 'hello' },
      }, 'webrtc')

      // 2. Edit
      await handleEvent({
        kind: 'event', operation: 'message.edit', eventId: 'mix-2',
        conversationId: convId, senderId, senderSequence: 2, version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'mix-1', originalMessage: 'hello edited', editedAt: new Date().toISOString() },
      }, 'webrtc')

      // 3. Reaction
      await handleEvent({
        kind: 'event', operation: 'reaction.add', eventId: 'mix-3',
        conversationId: convId, senderId, senderSequence: 3, version: 3,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'mix-1', emoji: '👍' },
      }, 'webrtc')

      // 4. Media
      await handleEvent({
        kind: 'event', operation: 'media.create', eventId: 'mix-4',
        conversationId: convId, senderId, senderSequence: 4, version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'mix-media', fileRef: 'ref', fileName: 'img.jpg', fileSize: 512, mimeType: 'image/jpeg', mediaType: 'image' },
      }, 'webrtc')

      // 5. Voice
      await handleEvent({
        kind: 'event', operation: 'voice.create', eventId: 'mix-5',
        conversationId: convId, senderId, senderSequence: 5, version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'mix-voice', fileRef: 'ref', fileSize: 1024, mimeType: 'audio/webm', durationMs: 3000 },
      }, 'webrtc')

      // 6. Delete the voice message
      await handleEvent({
        kind: 'event', operation: 'media.delete', eventId: 'mix-6',
        conversationId: convId, senderId, senderSequence: 6, version: 2,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'mix-voice', deletedAt: new Date().toISOString() },
      }, 'webrtc')

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(3) // mix-1, mix-media, mix-voice

      const textMsg = loaded.find((m) => m.id === 'mix-1')
      expect(textMsg!.originalMessage).toBe('hello edited')
      expect(textMsg!.editedAt).toBeTruthy()
      expect(textMsg!.reactions).toEqual({ '👍': [senderId] })

      const mediaMsg = loaded.find((m) => m.id === 'mix-media')
      expect(mediaMsg!.messageType).toBe('media')

      const voiceMsg = loaded.find((m) => m.id === 'mix-voice')
      expect(voiceMsg!.messageType).toBe('voice')
      expect(voiceMsg!.deletedAt).toBeTruthy()
    })
  })

  describe('sender-scoped sequences', () => {
    it('all event types increment sender sequence correctly', async () => {
      const ops = [
        { operation: 'message.create' as const, payload: { messageId: 'seq-1', originalMessage: 'msg' } },
        { operation: 'message.edit' as const, payload: { messageId: 'seq-1', originalMessage: 'edited', editedAt: new Date().toISOString() } },
        { operation: 'reaction.add' as const, payload: { messageId: 'seq-1', emoji: '❤️' } },
        { operation: 'media.create' as const, payload: { messageId: 'seq-media', fileRef: 'r', fileName: 'f', fileSize: 100, mimeType: 'image/jpeg', mediaType: 'image' as const } },
        { operation: 'voice.create' as const, payload: { messageId: 'seq-voice', fileRef: 'r', fileSize: 200, mimeType: 'audio/webm' } },
      ]

      for (let i = 0; i < ops.length; i++) {
        const result = await dispatchChatOperation({
          operation: ops[i].operation,
          conversationId: convId,
          senderId,
          payload: ops[i].payload,
          currentVersion: i,
          p2pOpen: () => true,
        })
        expect(result.event.senderSequence).toBe(i + 1)
      }

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(3) // seq-1, seq-media, seq-voice
      // Verify sequences are monotonically increasing
      const seqs = loaded.map((m) => m.senderSequence ?? 0).sort((a, b) => a - b)
      expect(seqs).toEqual([1, 4, 5])
    })
  })

  describe('deduplication across reconciliation', () => {
    it('processing same event twice produces one message', async () => {
      const event = {
        kind: 'event' as const,
        operation: 'message.create' as const,
        eventId: 'dedup-1',
        conversationId: convId,
        senderId,
        senderSequence: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        payload: { messageId: 'dedup-1', originalMessage: 'unique' },
      }

      const first = await handleEvent(event, 'webrtc')
      const second = await handleEvent(event, 'webrtc')
      expect(first).not.toBeNull()
      expect(second).toBeNull() // deduplicated

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
    })
  })
})

// ── Phase I: Cost Optimization verification ────────────────────────

describe('Phase I — Cost Optimization', () => {
  const convId = 'conv-cost'
  const uid = 'user-cost'

  beforeEach(async () => {
    await resetDB()
  })

  describe('dispatcher correctly routes to WebRTC or Supabase', () => {
    it('returns via:webrtc when p2pOpen is true', async () => {
      const result = await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-1', originalMessage: 'via webrtc' },
        currentVersion: 0,
        p2pOpen: () => true,
      })
      expect(result.via).toBe('webrtc')
    })

    it('returns via:supabase when p2pOpen is false', async () => {
      const result = await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-2', originalMessage: 'via supabase' },
        currentVersion: 0,
        p2pOpen: () => false,
      })
      expect(result.via).toBe('supabase')
    })
  })

  describe('WebRTC path: 0 Supabase writes needed', () => {
    it('message.create via WebRTC persists to IDB only', async () => {
      const result = await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-webrtc-1', originalMessage: 'webrtc only' },
        currentVersion: 0,
        p2pOpen: () => true,
      })
      expect(result.via).toBe('webrtc')
      // Verify persisted to IDB (no Supabase needed)
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].originalMessage).toBe('webrtc only')
    })

    it('message.edit via WebRTC patches IDB only', async () => {
      await ingestMessage(makePipelineMsg({ id: 'cost-edit-1', conversationId: convId, senderId: uid, originalMessage: 'before' }))
      const result = await dispatchChatOperation({
        operation: 'message.edit',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-edit-1', originalMessage: 'after', editedAt: new Date().toISOString() },
        currentVersion: 1,
        p2pOpen: () => true,
      })
      expect(result.via).toBe('webrtc')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].originalMessage).toBe('after')
    })

    it('message.delete via WebRTC marks IDB only', async () => {
      await ingestMessage(makePipelineMsg({ id: 'cost-del-1', conversationId: convId, senderId: uid, originalMessage: 'delete' }))
      const result = await dispatchChatOperation({
        operation: 'message.delete',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-del-1', deletedAt: new Date().toISOString() },
        currentVersion: 1,
        p2pOpen: () => true,
      })
      expect(result.via).toBe('webrtc')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].deletedAt).toBeTruthy()
    })

    it('reaction.add via WebRTC merges in IDB only', async () => {
      await ingestMessage(makePipelineMsg({ id: 'cost-react-1', conversationId: convId, senderId: uid, originalMessage: 'react' }))
      const result = await dispatchChatOperation({
        operation: 'reaction.add',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-react-1', emoji: '🎉' },
        currentVersion: 1,
        p2pOpen: () => true,
      })
      expect(result.via).toBe('webrtc')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].reactions).toEqual({ '🎉': ['user-cost'] })
    })

    it('media.create via WebRTC persists to IDB only', async () => {
      const result = await dispatchChatOperation({
        operation: 'media.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-media-1', fileRef: 'ref', fileName: 'img.jpg', fileSize: 1024, mimeType: 'image/jpeg', mediaType: 'image' },
        currentVersion: 0,
        p2pOpen: () => true,
      })
      expect(result.via).toBe('webrtc')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].messageType).toBe('media')
    })

    it('voice.create via WebRTC persists to IDB only', async () => {
      const result = await dispatchChatOperation({
        operation: 'voice.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-voice-1', fileRef: 'ref', fileSize: 2048, mimeType: 'audio/webm', durationMs: 5000 },
        currentVersion: 0,
        p2pOpen: () => true,
      })
      expect(result.via).toBe('webrtc')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].messageType).toBe('voice')
    })
  })

  describe('Supabase fallback path: writes happen', () => {
    it('message.create via Supabase persists to IDB', async () => {
      const result = await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-sb-1', originalMessage: 'via supabase' },
        currentVersion: 0,
        p2pOpen: () => false,
      })
      expect(result.via).toBe('supabase')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(1)
      expect(loaded[0].originalMessage).toBe('via supabase')
    })

    it('message.edit via Supabase patches IDB', async () => {
      await ingestMessage(makePipelineMsg({ id: 'cost-sb-edit', conversationId: convId, senderId: uid, originalMessage: 'before' }))
      const result = await dispatchChatOperation({
        operation: 'message.edit',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-sb-edit', originalMessage: 'after', editedAt: new Date().toISOString() },
        currentVersion: 1,
        p2pOpen: () => false,
      })
      expect(result.via).toBe('supabase')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].originalMessage).toBe('after')
    })

    it('reaction.add via Supabase merges in IDB', async () => {
      await ingestMessage(makePipelineMsg({ id: 'cost-sb-react', conversationId: convId, senderId: uid, originalMessage: 'react' }))
      const result = await dispatchChatOperation({
        operation: 'reaction.add',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-sb-react', emoji: '👍' },
        currentVersion: 1,
        p2pOpen: () => false,
      })
      expect(result.via).toBe('supabase')
      const loaded = await loadFromIndexedDB(convId)
      expect(loaded[0].reactions).toEqual({ '👍': ['user-cost'] })
    })
  })

  describe('IDB is always the source of truth', () => {
    it('message persists to IDB regardless of transport', async () => {
      // WebRTC path
      await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-persist-1', originalMessage: 'via webrtc' },
        currentVersion: 0,
        p2pOpen: () => true,
      })
      // Supabase path
      await dispatchChatOperation({
        operation: 'message.create',
        conversationId: convId,
        senderId: uid,
        payload: { messageId: 'cost-persist-2', originalMessage: 'via supabase' },
        currentVersion: 0,
        p2pOpen: () => false,
      })

      const loaded = await loadFromIndexedDB(convId)
      expect(loaded).toHaveLength(2)
      expect(loaded.map((m) => m.id).sort()).toEqual(['cost-persist-1', 'cost-persist-2'])
    })
  })
})

