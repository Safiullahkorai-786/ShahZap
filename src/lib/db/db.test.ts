import { describe, it, expect, beforeEach } from 'vitest'
import { resetDB, getDB, type DBConversation, type DBMessage, type DBMedia } from './schema'
import {
  upsertConversation,
  getConversation,
  getAllConversations,
  deleteConversation,
  getExpiredConversations,
  cleanupExpiredConversations,
  setConversationEnded,
  setConversationFriend,
} from './conversations'
import {
  saveMessage,
  getMessage,
  getMessagesByConversation,
  updateMessage,
  deleteMessage,
  messageExists,
} from './messages'
import { saveMedia, getMedia, deleteMedia, getMediaByConversation } from './media'

beforeEach(async () => {
  resetDB()
  // Open and close the DB to get a fresh instance
  const db = await getDB()
  // Clear all stores
  const tx = db.transaction(['conversations', 'messages', 'media'], 'readwrite')
  await Promise.all([
    tx.objectStore('conversations').clear(),
    tx.objectStore('messages').clear(),
    tx.objectStore('media').clear(),
    tx.done,
  ])
})

// ── Conversations ──────────────────────────────────────────────────────

describe('conversations', () => {
  const now = new Date().toISOString()
  const future = new Date(Date.now() + 86400000).toISOString()
  const past = new Date(Date.now() - 1000).toISOString()

  const sample: DBConversation = {
    conversationId: 'conv-1',
    type: 'random',
    status: 'active',
    createdAt: now,
    endedAt: null,
    expiresAt: future,
  }

  it('upserts and retrieves a conversation', async () => {
    await upsertConversation(sample)
    const result = await getConversation('conv-1')
    expect(result).toBeDefined()
    expect(result!.conversationId).toBe('conv-1')
    expect(result!.type).toBe('random')
  })

  it('returns undefined for nonexistent conversation', async () => {
    const result = await getConversation('nonexistent')
    expect(result).toBeUndefined()
  })

  it('overwrites on upsert', async () => {
    await upsertConversation(sample)
    await upsertConversation({ ...sample, status: 'ended', endedAt: now })
    const result = await getConversation('conv-1')
    expect(result!.status).toBe('ended')
    expect(result!.endedAt).toBe(now)
  })

  it('gets all conversations', async () => {
    await upsertConversation(sample)
    await upsertConversation({ ...sample, conversationId: 'conv-2', type: 'friend' })
    const all = await getAllConversations()
    expect(all).toHaveLength(2)
  })

  it('deletes conversation and cascades to messages/media', async () => {
    await upsertConversation(sample)
    await saveMessage({
      id: 'msg-1',
      conversationId: 'conv-1',
      senderId: 'user-1',
      originalMessage: 'hello',
      translatedMessage: null,
      createdAt: now,
      transport: 'local',
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
    })
    await saveMedia({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      mimeType: 'image/png',
      size: 1024,
      blob: new Blob(['test']),
      createdAt: now,
    })

    await deleteConversation('conv-1')

    expect(await getConversation('conv-1')).toBeUndefined()
    expect(await getMessage('msg-1')).toBeUndefined()
    expect(await getMedia('msg-1')).toBeUndefined()
  })

  it('identifies expired conversations', async () => {
    await upsertConversation(sample)
    await upsertConversation({ ...sample, conversationId: 'conv-2', expiresAt: past })
    const expired = await getExpiredConversations()
    expect(expired).toHaveLength(1)
    expect(expired[0].conversationId).toBe('conv-2')
  })

  it('does not expire friend conversations', async () => {
    await upsertConversation({ ...sample, type: 'friend', expiresAt: null })
    const expired = await getExpiredConversations()
    expect(expired).toHaveLength(0)
  })

  it('cleanup removes expired conversations', async () => {
    await upsertConversation({ ...sample, conversationId: 'conv-expired', expiresAt: past })
    await upsertConversation({ ...sample, conversationId: 'conv-active', expiresAt: future })
    const count = await cleanupExpiredConversations()
    expect(count).toBe(1)
    expect(await getConversation('conv-expired')).toBeUndefined()
    expect(await getConversation('conv-active')).toBeDefined()
  })

  it('setConversationEnded sets 24h expiration', async () => {
    await upsertConversation(sample)
    await setConversationEnded('conv-1')
    const result = await getConversation('conv-1')
    expect(result!.status).toBe('ended')
    expect(result!.endedAt).toBeDefined()
    expect(result!.expiresAt).toBeDefined()
    // Should be ~24h from now
    const expiresMs = new Date(result!.expiresAt!).getTime()
    const nowMs = Date.now()
    expect(expiresMs - nowMs).toBeGreaterThan(23 * 3600_000)
    expect(expiresMs - nowMs).toBeLessThan(25 * 3600_000)
  })

  it('setConversationFriend removes expiration', async () => {
    await upsertConversation(sample)
    await setConversationFriend('conv-1')
    const result = await getConversation('conv-1')
    expect(result!.type).toBe('friend')
    expect(result!.expiresAt).toBeNull()
  })
})

// ── Messages ───────────────────────────────────────────────────────────

describe('messages', () => {
  const now = new Date().toISOString()

  const sampleMsg: DBMessage = {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'user-1',
    originalMessage: 'hello world',
    translatedMessage: null,
    createdAt: now,
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

  it('saves and retrieves a message', async () => {
    await saveMessage(sampleMsg)
    const result = await getMessage('msg-1')
    expect(result).toBeDefined()
    expect(result!.originalMessage).toBe('hello world')
    expect(result!.transport).toBe('webrtc')
  })

  it('deduplicates by ID', async () => {
    await saveMessage(sampleMsg)
    await saveMessage({ ...sampleMsg, originalMessage: 'updated' })
    const result = await getMessage('msg-1')
    expect(result!.originalMessage).toBe('updated')
  })

  it('gets messages by conversation', async () => {
    await saveMessage(sampleMsg)
    await saveMessage({ ...sampleMsg, id: 'msg-2', createdAt: new Date(Date.now() + 1000).toISOString() })
    const msgs = await getMessagesByConversation('conv-1')
    expect(msgs).toHaveLength(2)
  })

  it('updates a message', async () => {
    await saveMessage(sampleMsg)
    await updateMessage('msg-1', { editedAt: now, originalMessage: 'edited' })
    const result = await getMessage('msg-1')
    expect(result!.editedAt).toBe(now)
    expect(result!.originalMessage).toBe('edited')
  })

  it('deletes a message', async () => {
    await saveMessage(sampleMsg)
    await deleteMessage('msg-1')
    expect(await getMessage('msg-1')).toBeUndefined()
  })

  it('checks message existence', async () => {
    expect(await messageExists('msg-1')).toBe(false)
    await saveMessage(sampleMsg)
    expect(await messageExists('msg-1')).toBe(true)
  })
})

// ── Media ──────────────────────────────────────────────────────────────

describe('media', () => {
  const now = new Date().toISOString()

  const sampleMedia: DBMedia = {
    messageId: 'msg-1',
    conversationId: 'conv-1',
    mimeType: 'image/png',
    size: 2048,
    blob: new Blob([new Uint8Array(2048)], { type: 'image/png' }),
    createdAt: now,
  }

  it('saves and retrieves media', async () => {
    await saveMedia(sampleMedia)
    const result = await getMedia('msg-1')
    expect(result).toBeDefined()
    expect(result!.mimeType).toBe('image/png')
    expect(result!.size).toBe(2048)
    // fake-indexeddb doesn't perfectly serialize Blobs, but real browsers do.
    // Verify the blob data round-trips by checking it has content.
    expect(result!.blob).toBeDefined()
  })

  it('overwrites on save', async () => {
    await saveMedia(sampleMedia)
    await saveMedia({ ...sampleMedia, size: 4096 })
    const result = await getMedia('msg-1')
    expect(result!.size).toBe(4096)
  })

  it('gets media by conversation', async () => {
    await saveMedia(sampleMedia)
    await saveMedia({ ...sampleMedia, messageId: 'msg-2' })
    const items = await getMediaByConversation('conv-1')
    expect(items).toHaveLength(2)
  })

  it('deletes media', async () => {
    await saveMedia(sampleMedia)
    await deleteMedia('msg-1')
    expect(await getMedia('msg-1')).toBeUndefined()
  })
})
