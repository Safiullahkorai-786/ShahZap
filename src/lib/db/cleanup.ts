'use client'

// Expiration and cleanup logic for IndexedDB.
// Random conversations expire after 24 hours. Friend conversations do not.

import { getDB } from './schema'
import { cleanupExpiredConversations, getAllConversations } from './conversations'
import { deleteMessagesByConversation } from './messages'
import { deleteMediaByConversation } from './media'

const CLEANUP_INTERVAL_MS = 60_000 // Check every 60 seconds
let cleanupTimer: ReturnType<typeof setInterval> | null = null

/**
 * Run expiration check and delete expired conversations + their messages/media.
 * Returns the number of conversations cleaned up.
 */
export async function runCleanup(): Promise<number> {
  return cleanupExpiredConversations()
}

/**
 * Start periodic cleanup. Call once on app mount.
 */
export function startCleanupScheduler(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    void runCleanup()
  }, CLEANUP_INTERVAL_MS)
}

/**
 * Stop periodic cleanup. Call on app unmount.
 */
export function stopCleanupScheduler(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

/**
 * Check if a specific conversation has expired.
 */
export async function isConversationExpired(conversationId: string): Promise<boolean> {
  const { getConversation } = await import('./conversations')
  const conv = await getConversation(conversationId)
  if (!conv || !conv.expiresAt) return false
  return new Date(conv.expiresAt).getTime() <= Date.now()
}

/**
 * Delete a conversation and all its data if it has expired.
 * Returns true if the conversation was deleted.
 */
export async function cleanupConversationIfExpired(conversationId: string): Promise<boolean> {
  const { getConversation, deleteConversation } = await import('./conversations')
  const conv = await getConversation(conversationId)
  if (!conv) return false
  if (!conv.expiresAt) return false
  if (new Date(conv.expiresAt).getTime() > Date.now()) return false
  await deleteConversation(conversationId)
  return true
}

/**
 * Get storage estimate (if supported by browser).
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const estimate = await navigator.storage.estimate()
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
}

/**
 * Attempt to free space by deleting the oldest non-friend conversations.
 * Returns the number of conversations deleted.
 */
export async function freeSpace(targetBytes: number = 50 * 1024 * 1024): Promise<number> {
  const convs = await getAllConversations()
  const deletable = convs
    .filter((c) => c.type !== 'friend')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  let freed = 0
  let deleted = 0
  for (const conv of deletable) {
    if (freed >= targetBytes) break
    const { deleteConversation: del } = await import('./conversations')
    await del(conv.conversationId)
    freed += targetBytes // approximate — exact size requires querying media store
    deleted++
  }
  return deleted
}
