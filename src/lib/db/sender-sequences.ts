'use client'

// Sender-scoped sequence persistence for monotonic ordering.
// Each (conversationId, senderId) pair has an independent sequence counter
// stored in IndexedDB. This survives page refresh within the same browser session.

import { getDB, type DBSenderSequence } from './schema'

function compositeKey(conversationId: string, senderId: string): string {
  return `${conversationId}:${senderId}`
}

export async function getNextSenderSequence(conversationId: string, senderId: string): Promise<number> {
  const db = await getDB()
  const key = compositeKey(conversationId, senderId)
  const existing = await db.get('sender_sequences', key)
  const next = (existing?.nextSequence ?? 0) + 1
  await db.put('sender_sequences', { key, conversationId, senderId, nextSequence: next })
  return next
}

export async function getLatestSenderSequence(conversationId: string, senderId: string): Promise<number> {
  const db = await getDB()
  const key = compositeKey(conversationId, senderId)
  const existing = await db.get('sender_sequences', key)
  return existing?.nextSequence ?? 0
}
