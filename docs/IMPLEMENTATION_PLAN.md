# ShahZap P2P Infrastructure Migration — Implementation Plan

## Phase 1 Audit Summary

### Current State

**Persistence:** Zero IndexedDB usage. All messages stored permanently in Supabase PostgreSQL `messages` table. Files are ephemeral blob URLs in React state only (vanish on reload).

**Message Transport:** 100% Supabase. Every send = DB insert. Every receive = postgres_changes or 5s smart poll. No WebRTC text messaging.

**WebRTC:** Two independent stacks:
1. Voice/video call (`use-call.ts`) — audio/video tracks only, no DataChannel, signaling via Supabase broadcast
2. Background P2P DataChannel (`use-background-p2p.ts`) — file transfer only, persistent, 16KB chunks

**Typing:** Dual mechanism — Supabase broadcast (realtime) + DB RPC (cross-page visibility). No WebRTC typing.

**Files:** Hybrid — base64 broadcast (<2MB) or DataChannel chunks (>2MB). Files never persist to IndexedDB or Supabase Storage.

**Channels:** 16 Supabase Realtime channels across the app.

**Conversations:** No random/friend type distinction in the database. All created as `status = 'active'`. No expiration logic. No local TTL.

### Gap Analysis

| Feature | Current | Target |
|---|---|---|
| Local message persistence | None | IndexedDB primary |
| WebRTC text messaging | None | DataChannel primary |
| Unified message pipeline | None (direct DB insert) | Single handler for all transports |
| Message deduplication | None needed (single source) | ID-based dedup across transports |
| Random chat expiration | None | 24-hour local TTL |
| Friend conversion | None | local expiresAt = null |
| Media persistence | Blob URLs only | IndexedDB blob storage |
| Transport state machine | None | Explicit connecting/connected/failed states |

---

## Phase 2: IndexedDB Persistence Layer

### New Files

```
src/lib/db/
  schema.ts          — Database schema, version, store definitions
  connection.ts      — Open/connect to IndexedDB, handle upgrades
  conversations.ts   — CRUD for conversations store
  messages.ts        — CRUD for messages store
  media.ts           — CRUD for media store
  cleanup.ts         — Expiration checking and deletion
  index.ts           — Public API re-exports
```

### Schema (schema.ts)

```typescript
const DB_NAME = 'ShahZapDB'
const DB_VERSION = 1

// Object stores:
// conversations: { conversationId, type, status, createdAt, endedAt, expiresAt }
// messages: { messageId, conversationId, senderId, type, content, createdAt, transport, ... }
// media: { messageId, conversationId, mimeType, size, blob }
```

### Dependencies

Add `idb` (lightweight, 1.2KB, Promise-based IndexedDB wrapper). Justified: raw IndexedDB API is callback-based and verbose. `idb` is the standard choice, maintained by the Chrome team.

### Requirements

- `getConversation(id)` / `upsertConversation(data)` / `deleteConversation(id)`
- `getMessages(conversationId)` / `saveMessage(msg)` / `updateMessage(id, patch)` / `deleteMessage(id)`
- `saveMedia(messageId, blob, mime)` / `getMedia(messageId)` / `deleteMedia(messageId)`
- `getExpiredConversations()` / `deleteExpiredConversations()`
- `deleteConversationAndMedia(conversationId)` — cascade delete
- Migration/version handling via `onupgradeneeded`

### Testing

- Unit tests for each CRUD function
- Verify upsert deduplication
- Verify cascade deletes
- Verify expiration queries

---

## Phase 3: Unified Message Pipeline

### New File

```
src/lib/message-pipeline.ts
```

### Architecture

```typescript
type InboundMessage = {
  id: string
  conversationId: string
  senderId: string
  content: string
  createdAt: string
  transport: 'webrtc' | 'supabase' | 'poll'
  // ... other fields matching the existing Message type
}

async function handleMessage(msg: InboundMessage): Promise<boolean> {
  // 1. Validate schema
  // 2. Deduplicate by ID (check IndexedDB)
  // 3. If duplicate → return false
  // 4. Persist to IndexedDB
  // 5. Return true (caller updates React state)
}
```

### Integration Points

Modify `src/app/chat/[conversationId]/page.tsx`:

1. **Initial load** (line 482): Load from IndexedDB first, then fetch from Supabase and merge
2. **postgres_changes INSERT** (line 502): Route through `handleMessage()`
3. **postgres_changes UPDATE** (line 517): Update in IndexedDB + React state
4. **Smart poll** (line 375): Route through `handleMessage()` for each new message
5. **Outgoing message** (line 1037): After DB insert, also persist to IndexedDB

### Key Change

The UI must NOT know which transport delivered the message. All paths converge on `handleMessage()`.

---

## Phase 4: WebRTC-First Text Messaging ✅ (Phase 4.2 — Automated Verified, Browser Pending)

### Files Modified
- `src/lib/file-transfer.ts` — Text protocol types (`TextMessage`, `SyncRequest`, `SyncResponse`)
- `src/lib/db/pipeline.ts` — `senderSequence` field, `getNextSenderSequence()`, `getLatestSenderSequence()`, race-safe dedup via `processingIds` Set
- `src/lib/db/sender-sequences.ts` — **NEW**: IndexedDB `sender_sequences` store for monotonic per-sender sequence tracking
- `src/lib/db/schema.ts` — `senderSequence` on `DBMessage`, `DBSenderSequence` type, `sender_sequences` store, bumped to v3
- `src/hooks/use-background-p2p.ts` — Reconnect reconciliation with sender-scoped `lastKnownSequences`, `enabled` option
- `src/app/chat/[conversationId]/page.tsx` — WebRTC-first `send()` with fallback, `onData` handles `text`, `sync-request`, `sync-response`, `disableP2P` prop, Supabase INSERT uses `id: messageId`
- `src/components/call-overlay.tsx` — Passes `disableP2P` to embedded ChatRoom
- `src/lib/db/pipeline.test.ts` — 54 tests (all pass)

### Protocol

```
Text message (JSON over DataChannel):
{
  kind: 'text',
  id: string,           // crypto.randomUUID()
  conversationId: string,
  senderId: string,
  content: string,
  createdAt: string,
  senderSequence: number,
  replyToId?: string
}
```

### Reconnect Reconciliation

```
sync-request (responder → initiator on DataChannel open):
{
  kind: 'sync-request',
  senderId: string,
  lastKnownSequences: Record<string, number>  // senderId → last known sequence
}

sync-response (initiator → responder with missing messages):
{
  kind: 'sync-response',
  senderId: string,
  messages: TextMessage[]
}
```

### Send Logic

1. Generate message ID with `crypto.randomUUID()`
2. Atomically increment + persist sender sequence via `getNextSenderSequence()`
3. Build canonical `PipelineMessage` with `transport: 'webrtc'`
4. Persist locally via `ingestMessage()` (optimistic)
5. Call `p2pSend(JSON.stringify(textMsg))`
6. If `p2pSend()` returns `true` → done
7. If `p2pSend()` returns `false` → remove optimistic entry, fall through to Supabase
8. Supabase fallback: `supabase.from('messages').insert()`, persist result, update UI

### Receive Logic

1. `onData` callback parses incoming JSON
2. `kind === 'text'`: ignore own messages (echo check), persist via `ingestMessage()`, update React state
3. `kind === 'sync-request`: load messages where `senderSequence > lastKnownSequences[senderId]`, send `sync-response`
4. `kind === 'sync-response'`: ingest each message via `ingestMessage()`

### Persistence Model

```
WebRTC message (successful)  → IndexedDB only
Supabase fallback message    → Supabase + IndexedDB
```

Supabase is NOT the source of truth for WebRTC-delivered messages.

### Sender Sequence Design

```
sender_sequences (IndexedDB store):
  key: "{conversationId}:{senderId}"
  value: { nextSequence: number }

getNextSenderSequence() → atomically read + increment + persist
getLatestSenderSequence() → read current value
```

Survives page refresh. Resets on new anonymous session (IndexedDB cleanup).

### Key Invariants
- DO NOT double-send (WebRTC + Supabase for same message)
- DO NOT add application-level ACKs (SCTP handles reliability)
- Message ID is deterministic (generated before send)
- Sender sequence is monotonic (per-sender, persisted in IndexedDB)
- `processingIds` Set prevents race-safe concurrent dedup
- `p2pSend()` return value determines transport success
- Fallback only on genuine DataChannel unavailability or actual `p2pSend()` failure

---

## Phase 4.3: Offline DM Access + Asynchronous Message Delivery ✅

### Core Rule

**WebRTC is a transport, not a source of truth.** A conversation, and the
ability to open and message in it, must NEVER depend on WebRTC being
connected — or on the recipient being online/present.

A DM is openable when the recipient is ONLINE or OFFLINE, and WebRTC is OPEN,
CONNECTING, DISCONNECTED, or FAILED. Presence only decides transport
availability, never conversation existence.

### Conceptual model

```
                         SEND MESSAGE
                              │
                       Is WebRTC OPEN?
                         /          \
                       YES           NO
                        │             │
                     WebRTC       Supabase
                        │          fallback
                        │             │
                        └──────┬──────┘
                               ▼
                        Unified Pipeline
                               │
                        ┌──────┴──────┐
                        ▼             ▼
                    IndexedDB         UI
```

### Transport / Presence / Existence (distinctions)

| Concept | Definition | Determines |
|---|---|---|
| **Transport** | Which pipe a message rides (`webrtc` vs `supabase`) | Delivery mechanism only |
| **Presence** | Whether the peer is online right now (`last_active_at` window) | Whether WebRTC can be attempted; `delivered_at` tick on insert |
| **Conversation existence** | Two participants sharing one `conversation_id` | Whether the DM can be opened at all — independent of presence |
| **Offline delivery** | Sending to a `messages` row when the peer is offline | Supabase mailbox; retrieved when peer returns |
| **IndexedDB persistence** | Local store of all messages | Offline rendering, dedup, history |
| **Supabase mailbox/fallback** | `messages` table used when WebRTC unavailable OR peer offline | Async delivery + controlled fallback |
| **WebRTC reconciliation** | `sync-request`/`sync-response` on DataChannel open | Filling gaps when a peer reconnects |

### Files Modified

- `supabase/migrations/20260831000100_fix_offline_friend_dm.sql` — `start_direct_chat`
  now also authorizes a DM when the two users are **accepted friends**, so an
  offline, fully-private friend is still DM-able (friendship is mutual consent,
  independent of directory visibility flags and presence).
- `src/hooks/use-background-p2p.ts` — presence-aware P2P: when the peer is known
  offline, keep the signaling channel subscribed (so we can still answer an
  inbound offer) but do NOT initiate offers or schedule retries. Retries use
  bounded exponential backoff. WebRTC no longer churns/degrades the page when a
  DM is opened with an offline recipient.
- `src/app/chat/[conversationId]/page.tsx` — passes `peerOnline={otherOnline}` to
  `useBackgroundP2P`. Offline send already routes through the Supabase fallback
  (`p2pOpen()` false → `insert({ id: messageId, ... })`); recipient reconnect
  already ingests pending rows via `ingestBatch` (initial load + smart poll +
  realtime), all deduplicated.

### Offline send flow (recipient offline)

```
A writes message
       ↓
crypto.randomUUID() → messageId (canonical)
       ↓
p2pOpen() false (peer offline / WebRTC down)
       ↓
supabase.from('messages').insert({ id: messageId, ... })   ← explicit id
       ↓
supabaseToPipeline → ingestMessage → IndexedDB + UI (optimistic, immediate)
       ↓
messages row persists (mailbox)
```

### Recipient return flow

```
B comes online, opens ShahZap / the DM
       ↓
loadFromIndexedDB (instant render of local copy)
       ↓
supabase.from('messages').select(...) → pending rows (mailbox)
       ↓
ingestBatch(..., 'supabase') → unified pipeline
       ↓
processingIds + IndexedDB unique messageId dedup → one record
       ↓
UI + IndexedDB
```

### Online WebRTC flow (unchanged, WebRTC-first)

```
A → WebRTC DataChannel → B    (zero Supabase message INSERT for successful P2P)
```

### Identity model (what identifies a recipient offline)

Anonymous users are created via `supabase.auth.signInAnonymously()`. The
server-issued `auth.uid()` (UUID) is stored in the Auth session cookie and used
as `profile_id` in `conversations`/`conversation_participants`/`messages`. This
is a stable identifier across the recipient's offline period, so an offline
mailbox keyed by `conversation_id`/`profile_id` is reliable. No new auth system
is introduced.

**Limitation (documented):** if the recipient clears browser data / cookies, or
the anonymous session is lost, the account identifier is gone and history does
not follow to a new session. Offline delivery is therefore scoped to a stable
anonymous session, matching the product model ("chat history does not follow the
user to another device").

### RLS / Security

Offline delivery does not weaken RLS. `messages` select/insert remain scoped to
conversation participants; `start_direct_chat` remains `security definer` and
still rejects blocks and self-targets. The friendship carve-out only adds a
consent path for accepted friends (explicit mutual consent) — an arbitrary user
still cannot open a conversation with or read a stranger's offline messages
merely by knowing a conversation id.

### Traffic impact

- Healthy P2P: WebRTC → IndexedDB, no Supabase message INSERT.
- Offline/fallback: only the actual message rows are written (no ACKs, no
  new polling loops, no per-message worker calls).
- No new Realtime channels, no Cloudflare Worker call for messaging.

---

## Phase 5: WebRTC-First Typing

### Modify typing to use DataChannel

In the chat page's typing logic:

```typescript
function broadcastTyping(typing: boolean) {
  const payload = { type: 'typing', typing, from: userId }

  if (p2pOpen()) {
    // Primary: WebRTC DataChannel
    p2pSend(JSON.stringify(payload))
  } else {
    // Fallback: Supabase broadcast (existing)
    channel.send({ type: 'broadcast', event: 'typing', payload })
  }

  // DB RPC for cross-page visibility (keep as-is)
  supabase.rpc('set_typing', { ... })
}
```

### Receive Logic

In `use-background-p2p.ts` `onData`:

```typescript
if (parsed.type === 'typing') {
  // Emit to chat page's typing handler
  onTypingRef.current(parsed)
}
```

### Keep Existing

- Supabase broadcast typing as fallback
- DB RPC for cross-page visibility (friends list)
- The 1400ms throttle and 2200ms auto-stop

---

## Phase 6: Migrate Media to WebRTC Pipeline

### Current State

Files already use the background P2P DataChannel for >2MB transfers. The <2MB path uses Supabase broadcast (base64).

### Changes

1. **Persist received files to IndexedDB** — Currently files are ephemeral blob URLs. After receiving a file via DataChannel or broadcast, save the blob to IndexedDB `media` store.

2. **Load files from IndexedDB on conversation open** — When opening a conversation, load any previously received media from IndexedDB and create fresh blob URLs.

3. **Remove base64 broadcast path** — Once DataChannel is reliable, route ALL files through DataChannel. The base64 path sends large strings through Supabase Realtime which is not designed for this.

4. **Add media to unified pipeline** — File transfers produce a "file message" that flows through `handleMessage()`.

### File Message Type

```typescript
{
  type: 'file',
  id: string,
  conversationId: string,
  senderId: string,
  name: string,
  mime: string,
  size: number,
  createdAt: string,
  // Blob stored separately in IndexedDB media store
}
```

---

## Phase 7: Remove Duplicated Call-Specific Code

### Only after Phases 4-6 are working

Audit and remove:
- `dcRef` in `use-call.ts` (already removed)
- `onFileData` in `use-call.ts` (already removed)
- `sendFileData` / `isDataChannelOpen` in `use-call.ts` (already removed)
- `useFileTransfer` in `call-provider.tsx` (already removed)
- `onFileDataRef` in `call-provider.tsx` (already removed)

**Note:** These were already cleaned up in the previous session. Verify nothing was missed.

### Do NOT Remove

- Voice/video call audio/video tracks
- Call signaling channels
- Call overlay UI

---

## Phase 8: Random Chat Expiration

### IndexedDB Schema Addition

Conversations store needs:
```typescript
{
  conversationId: string
  type: 'random' | 'friend' | 'bot'
  status: 'active' | 'ended'
  createdAt: string
  endedAt: string | null
  expiresAt: string | null  // null = no expiration (friends)
}
```

### Expiration Logic

```typescript
// On app startup + periodically (every 60s)
async function cleanupExpiredConversations() {
  const expired = await db.getExpiredConversations()
  for (const conv of expired) {
    await db.deleteConversationAndMedia(conv.conversationId)
  }
}

// On conversation open
async function checkConversationExpiration(conversationId: string) {
  const conv = await db.getConversation(conversationId)
  if (conv?.expiresAt && new Date(conv.expiresAt) < new Date()) {
    await db.deleteConversationAndMedia(conversationId)
    // Redirect to /match or /friends
    return true
  }
  return false
}
```

### Conversation Type Detection

- Random match conversations: created by `match_next` RPC → `type = 'random'`
- Direct chat: created by `start_direct_chat` RPC → `type = 'friend'`
- Bot chat: created by bot system → `type = 'bot'`

### When to Set endedAt

When the user navigates away from a random conversation, or when the other user disconnects. The 24-hour clock starts from `endedAt`.

---

## Phase 9: Friend Conversion

### Detection

When `friend_requests.status` changes to `'accepted'` for a conversation's participants:

```typescript
// In the postgres_changes listener for friend_requests
if (newStatus === 'accepted') {
  // Update local conversation type
  await db.upsertConversation({
    conversationId,
    type: 'friend',
    expiresAt: null,  // No expiration for friends
  })
}
```

### No Data Copy

Existing IndexedDB messages remain. Only the conversation metadata changes.

---

## Phase 10: Failure/Recovery Testing

### Test Matrix

| Scenario | Expected Behavior |
|---|---|
| WebRTC connected, send text | Text via DataChannel, persisted to IndexedDB |
| WebRTC disconnected, send text | Text via Supabase fallback, persisted to IndexedDB |
| WebRTC reconnects after fallback | Resume DataChannel, no duplicate messages |
| Both transports fail | Show error state, retry |
| Refresh browser | Load from IndexedDB, re-establish connections |
| Close/reopen browser | Load from IndexedDB, re-establish connections |
| Receive same message via both transports | Dedup by ID, only show once |
| Send while offline | Queue locally, send when reconnected |
| File transfer interrupted | Resume from last chunk, or fail gracefully |
| Random chat 24h expiry | Delete from IndexedDB, redirect |
| Friend conversion | Stop expiration, keep messages |

---

## Phase 11: Performance/Storage Audit

### Metrics to Measure

- `navigator.storage.estimate()` — IndexedDB usage
- Supabase Realtime message volume (before/after)
- Supabase database writes (before/after)
- WebRTC transfer performance (latency, throughput)
- Memory usage (blob URLs, IndexedDB connections)
- React re-render behavior (message list updates)

### Graceful Degradation

```typescript
try {
  await db.saveMessage(msg)
} catch (e) {
  if (e.name === 'QuotaExceededError') {
    // Delete oldest non-friend messages
    await db.cleanupOldMessages()
    // Retry
    await db.saveMessage(msg)
  }
}
```

---

## Phase 12: Final Cleanup

1. TypeScript check: `npx tsc --noEmit`
2. Lint: `npm run lint`
3. Tests: `npm test` (if test suite exists)
4. Production build: `npm run build`
5. Verify no obsolete DataChannel logic
6. Verify no duplicate Supabase subscriptions
7. Verify IndexedDB cleanup on all paths
8. Verify WebRTC cleanup on all paths
9. Verify Blob URL cleanup on all paths
10. Update `docs/ARCHITECTURE.md`
11. Update `docs/TEST_PLAN.md`
12. Review diff: `git diff`
13. Commit, push, deploy

---

## Implementation Order

The phases must be implemented in order because each builds on the previous:

```
Phase 2 (IndexedDB)
    ↓
Phase 3 (Unified Pipeline)
    ↓
Phase 4 (WebRTC Text)
    ↓
Phase 5 (WebRTC Typing)
    ↓
Phase 6 (Media Migration)
    ↓
Phase 7 (Code Cleanup)
    ↓
Phase 8 (Random Expiration)
    ↓
Phase 9 (Friend Conversion)
    ↓
Phase 10 (Testing)
    ↓
Phase 11 (Performance)
    ↓
Phase 12 (Deploy)
```

Each phase should be committed and tested before proceeding to the next.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| IndexedDB storage quota | Implement cleanup, measure with `storage.estimate()` |
| WebRTC connectivity failures | Supabase fallback remains, auto-retry |
| Message deduplication bugs | Strict ID-based dedup, test thoroughly |
| Data loss during migration | Keep Supabase path as fallback until IndexedDB is proven |
| Breaking voice/video calls | Phases 4-6 don't touch call code |
| Breaking existing file transfer | Extend, don't replace, existing DataChannel |
| Performance regression | Measure in Phase 11, optimize as needed |
