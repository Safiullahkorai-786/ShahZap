'use client'

// Conversation CRUD operations for IndexedDB.

import { getDB, type DBConversation, type ConversationType } from './schema'

export async function upsertConversation(data: DBConversation): Promise<void> {
  const db = await getDB()
  await db.put('conversations', data)
}

export async function getConversation(conversationId: string): Promise<DBConversation | undefined> {
  const db = await getDB()
  return db.get('conversations', conversationId)
}

export async function getAllConversations(): Promise<DBConversation[]> {
  const db = await getDB()
  return db.getAll('conversations')
}

export async function getConversationsByType(type: ConversationType): Promise<DBConversation[]> {
  const db = await getDB()
  return db.getAllFromIndex('conversations', 'by-type', type)
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const db = await getDB()
  // Delete conversation
  await db.delete('conversations', conversationId)
  // Delete associated messages (must iterate since deleteAll on index isn't supported everywhere)
  const msgTx = db.transaction('messages', 'readwrite')
  const msgIndex = msgTx.store.index('by-conversation')
  let cursor = await msgIndex.openCursor(conversationId)
  while (cursor) {
    cursor.delete()
    cursor = await cursor.continue()
  }
  await msgTx.done
  // Delete associated media
  const mediaTx = db.transaction('media', 'readwrite')
  const mediaIndex = mediaTx.store.index('by-conversation')
  let mediaCursor = await mediaIndex.openCursor(conversationId)
  while (mediaCursor) {
    mediaCursor.delete()
    mediaCursor = await mediaCursor.continue()
  }
  await mediaTx.done
}

export async function deleteConversationAndMedia(conversationId: string): Promise<void> {
  return deleteConversation(conversationId)
}

export async function getExpiredConversations(): Promise<DBConversation[]> {
  const db = await getDB()
  const all = await db.getAll('conversations')
  const now = Date.now()
  return all.filter((c) => {
    if (!c.expiresAt) return false
    return new Date(c.expiresAt).getTime() <= now
  })
}

export async function cleanupExpiredConversations(): Promise<number> {
  const expired = await getExpiredConversations()
  for (const conv of expired) {
    await deleteConversation(conv.conversationId)
  }
  return expired.length
}

export async function setConversationEnded(
  conversationId: string,
  endedAt: string = new Date().toISOString(),
): Promise<void> {
  const db = await getDB()
  const existing = await db.get('conversations', conversationId)
  if (!existing) return
  const endedDate = new Date(endedAt)
  await db.put('conversations', {
    ...existing,
    status: 'ended',
    endedAt,
    expiresAt: new Date(endedDate.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  })
}

export async function setConversationFriend(conversationId: string): Promise<void> {
  const db = await getDB()
  const existing = await db.get('conversations', conversationId)
  if (!existing) return
  await db.put('conversations', {
    ...existing,
    type: 'friend',
    expiresAt: null,
  })
}
