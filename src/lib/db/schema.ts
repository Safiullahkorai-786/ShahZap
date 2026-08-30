'use client'

// ShahZap IndexedDB schema and version management.
// This is the primary local persistence layer for conversations, messages, and media.

import { type IDBPDatabase, openDB } from 'idb'

export const DB_NAME = 'ShahZapDB'
export const DB_VERSION = 3

// ── Store types ────────────────────────────────────────────────────────

export type ConversationType = 'random' | 'friend' | 'bot'

export type DBConversation = {
  conversationId: string
  type: ConversationType
  status: 'active' | 'ended'
  createdAt: string
  endedAt: string | null
  expiresAt: string | null
}

export type MessageTransport = 'webrtc' | 'supabase' | 'poll' | 'local'

export type DBMessage = {
  id: string
  conversationId: string
  senderId: string
  originalMessage: string
  translatedMessage: string | null
  createdAt: string
  transport: MessageTransport
  reactions: Record<string, string[]> | null
  editedAt: string | null
  deletedAt: string | null
  replyToMessageId: string | null
  deletedByReceiverAt: string | null
  deliveredAt: string | null
  readAt: string | null
  messageType: 'text' | 'call' | null
  callMode: 'audio' | 'video' | null
  callStatus: 'answered' | 'missed' | 'outgoing_unanswered' | null
  callDurationSeconds: number | null
  senderSequence?: number
}

export type DBMedia = {
  messageId: string
  conversationId: string
  mimeType: string
  size: number
  blob: Blob
  createdAt: string
}

export type DBSenderSequence = {
  /** Composite key: `${conversationId}:${senderId}` */
  key: string
  conversationId: string
  senderId: string
  nextSequence: number
}

// ── Database schema ────────────────────────────────────────────────────

// Using a concrete interface for the DB schema. The idb library's DBSchema
// type requires a string index signature which conflicts with specific store
// definitions in some TypeScript configurations.
interface ShahZapDB {
  conversations: {
    key: string
    value: DBConversation
    indexes: {
      'by-type': ConversationType
      'by-expires': string | null
    }
  }
  messages: {
    key: string
    value: DBMessage
    indexes: {
      'by-conversation': string
      'by-conversation-created': [string, string]
    }
  }
  media: {
    key: string
    value: DBMedia
    indexes: {
      'by-conversation': string
    }
  }
  sender_sequences: {
    key: string
    value: DBSenderSequence
  }
  [name: string]: {
    key: any
    value: any
    indexes?: Record<string, any>
  }
}

// ── Connection ─────────────────────────────────────────────────────────

let dbPromise: Promise<IDBPDatabase<ShahZapDB>> | null = null

export function getDB(): Promise<IDBPDatabase<ShahZapDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ShahZapDB>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, tx) {
        // Conversations store
        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', { keyPath: 'conversationId' })
          convStore.createIndex('by-type', 'type')
          convStore.createIndex('by-expires', 'expiresAt')
        }

        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' })
          msgStore.createIndex('by-conversation', 'conversationId')
          msgStore.createIndex('by-conversation-created', ['conversationId', 'createdAt'])
        }

        // Media store
        if (!db.objectStoreNames.contains('media')) {
          const mediaStore = db.createObjectStore('media', { keyPath: 'messageId' })
          mediaStore.createIndex('by-conversation', 'conversationId')
        }

        // v2: senderSequence is optional on existing messages — no schema change needed.
        // The field is simply absent on older records, which is fine.

        // v3: sender_sequences store for monotonic sender-scoped sequencing
        if (!db.objectStoreNames.contains('sender_sequences')) {
          db.createObjectStore('sender_sequences', { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

// Reset for testing
export function resetDB(): void {
  dbPromise = null
}
