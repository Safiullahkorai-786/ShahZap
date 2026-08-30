'use client'

// Message CRUD operations for IndexedDB.

import { getDB, type DBMessage } from './schema'

export async function saveMessage(msg: DBMessage): Promise<void> {
  const db = await getDB()
  await db.put('messages', msg)
}

export async function saveMessages(msgs: DBMessage[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  for (const msg of msgs) {
    tx.store.put(msg)
  }
  await tx.done
}

export async function getMessage(id: string): Promise<DBMessage | undefined> {
  const db = await getDB()
  return db.get('messages', id)
}

export async function getMessagesByConversation(conversationId: string): Promise<DBMessage[]> {
  const db = await getDB()
  return db.getAllFromIndex('messages', 'by-conversation', conversationId)
}

export async function getMessagesByConversationOrdered(conversationId: string): Promise<DBMessage[]> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readonly')
  const index = tx.store.index('by-conversation-created')
  const range = IDBKeyRange.bound([conversationId, ''], [conversationId, '\uffff'])
  return index.getAll(range)
}

export async function updateMessage(id: string, patch: Partial<Omit<DBMessage, 'id'>>): Promise<void> {
  const db = await getDB()
  const existing = await db.get('messages', id)
  if (!existing) return
  await db.put('messages', { ...existing, ...patch })
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('messages', id)
}

export async function deleteMessagesByConversation(conversationId: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  const index = tx.store.index('by-conversation')
  let cursor = await index.openCursor(conversationId)
  while (cursor) {
    cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function messageExists(id: string): Promise<boolean> {
  const db = await getDB()
  const count = await db.count('messages', id)
  return count > 0
}

export async function getMessageCount(conversationId: string): Promise<number> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readonly')
  const index = tx.store.index('by-conversation')
  return index.count(conversationId)
}
