'use client'

// Media CRUD operations for IndexedDB.
// Stores actual Blob data for images, videos, audio, and files.

import { getDB, type DBMedia } from './schema'

export async function saveMedia(media: DBMedia): Promise<void> {
  const db = await getDB()
  await db.put('media', media)
}

export async function getMedia(messageId: string): Promise<DBMedia | undefined> {
  const db = await getDB()
  return db.get('media', messageId)
}

export async function getMediaByConversation(conversationId: string): Promise<DBMedia[]> {
  const db = await getDB()
  return db.getAllFromIndex('media', 'by-conversation', conversationId)
}

export async function deleteMedia(messageId: string): Promise<void> {
  const db = await getDB()
  await db.delete('media', messageId)
}

export async function deleteMediaByConversation(conversationId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('media', 'readwrite')
  const index = tx.store.index('by-conversation')
  let cursor = await index.openCursor(conversationId)
  while (cursor) {
    cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function getMediaSize(conversationId: string): Promise<number> {
  const db = await getDB()
  const items = await getMediaByConversation(conversationId)
  return items.reduce((sum, m) => sum + m.size, 0)
}
