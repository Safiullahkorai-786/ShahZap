'use client'

// ShahZap IndexedDB persistence layer — public API.
//
// Usage:
//   import { db } from '@/lib/db'
//
//   await db.conversations.upsert({ ... })
//   await db.messages.save({ ... })
//   await db.media.save({ ... })
//   await db.cleanup.run()

export { getDB, resetDB, DB_NAME, DB_VERSION } from './schema'
export type { DBConversation, DBMessage, DBMedia, ConversationType, MessageTransport } from './schema'

import * as conversations from './conversations'
import * as messages from './messages'
import * as media from './media'
import * as cleanup from './cleanup'
import * as senderSequences from './sender-sequences'

export const db = {
  conversations,
  messages,
  media,
  cleanup,
  senderSequences,
} as const
