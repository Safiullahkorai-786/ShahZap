# ShahZap Architecture

## Status

Phase K — Authoritative architecture reference. P2P-first + Supabase-reliable chat architecture fully implemented (Phases A–K).

## Product Model

ShahZap is NOT an account-based messaging application. It is an anonymous social discovery PWA:

- Users do not need signup, email, or password
- Users receive an anonymous browser-local session
- Users randomly connect with another person
- Users chat during the active session
- Users may become friends
- Random conversations expire locally after 24 hours
- Friend conversations remain locally available
- Losing browser data/device data is acceptable
- Chat history does NOT follow the user to another device
- The server should NOT permanently store conversation content

## Architectural Principle

**SUPABASE COORDINATES. WEBRTC COMMUNICATES. INDEXEDDB REMEMBERS.**

---

## High-Level Architecture

```
                     SHAHZAP
                        |
             Anonymous Browser Session
                        |
         +--------------+--------------+
         |                             |
      SUPABASE                       WEBRTC
         |                             |
  +------+------+                      |
  |      |      |                      |
Matching Signaling Presence            |
  |      |      |                      |
  +------+------+                      |
         |                             |
         +-------------+---------------+
                       |
                       v
                MESSAGE PIPELINE
                       |
                       v
                   INDEXEDDB
                       |
             +---------+---------+
             |                   |
          RANDOM               FRIEND
           CHAT                  CHAT
             |                   |
          24-hour              RETAIN
           TTL                 locally
```

---

## Supabase Responsibilities

Supabase is the coordination and fallback layer:

- Anonymous session management (auth via `@supabase/ssr`)
- Match queue and matching (`match_next` RPC)
- WebRTC signaling (SDP offer/answer, ICE candidates)
- Presence (online/offline via `last_active_at`)
- Friend relationship metadata (`friend_requests` table)
- Fallback realtime delivery when WebRTC is unavailable
- Read receipts and delivery ticks (`delivered_at`, `read_at`)
- Typing indicator persistence (DB RPC for cross-page visibility)
- Notifications (in-app, push)
- Moderation, reporting, blocks
- Translation rate limiting
- Call logging and call notifications

Supabase should NOT contain:
- Permanent chat transcripts (transitioning away)
- Image/video/audio binaries
- Arbitrary file storage

---

## WebRTC Responsibilities

WebRTC is the preferred transport for realtime communication:

### Voice/Video Calls
- Audio/video tracks via `RTCPeerConnection`
- Signaling through Supabase Realtime broadcast (`call:user:{id}` channels)
- STUN-only (Google STUN servers, no TURN)
- Token-based call session isolation
- Mid-call renegotiation (camera toggle)

### Data Transfer
- Persistent background `RTCDataChannel` (`shahzap-files`)
- Ordered, binary (`arraybuffer`), 16KB chunks
- One DataChannel per conversation, survives call start/end
- Token-based signaling validation
- Initiator selection: local-time heuristic `Date.now() <= parseInt(token.split('-')[0], 36)`. Because both peers create their token in the same millisecond, it is effectively true for both — the channel still converges because the second subscriber's offer reaches the first (both send offers); not currently a correctness bug, but the "earlier peer initiates" intent is not achieved.
- Retry (bounded exponential backoff): `backoff = min(3000 * 2^min(attempts, 4), 30000)` ms → 3000, 6000, 12000, 24000, then capped at 30000. `attemptsRef` resets to 0 on DataChannel open and on teardown. Retries are **not** scheduled while the peer is known offline (`peerOnline !== false`).

### Text Messaging
- Text messages route through DataChannel when open (WebRTC-first)
- Supabase fallback when DataChannel unavailable OR `p2pSend()` returns false
- JSON protocol over DataChannel (ordered, reliable via SCTP)
- Text protocol types: `text`, `sync-request`, `sync-response`
- **Canonical messageId**: generated once via `crypto.randomUUID()`, explicitly provided in Supabase INSERT (`id: messageId`), PostgreSQL uses client value instead of `gen_random_uuid()`
- Sender-scoped sequencing via IndexedDB `sender_sequences` store (monotonic, survives refresh)
- In-memory `processingIds` Set for race-safe dedup alongside IndexedDB unique identity
- Reconnect reconciliation: responder sends `sync-request` with sender-scoped `lastKnownSequences` on DataChannel open
- **Supabase is NOT the source of truth for WebRTC messages** — successful WebRTC messages are IndexedDB-only
- Fallback is triggered by genuine DataChannel unavailability or an actual failed `p2pSend()` operation
- **Zero Supabase writes** for successful WebRTC text messages
- **Zero Cloudflare Worker requests** for normal WebRTC text messaging
- Call overlay passes `disableP2P` to prevent duplicate DataChannel on desktop

### Typing Indicators (Planned)
- DataChannel primary, Supabase Realtime fallback

---

## IndexedDB Responsibilities

IndexedDB is the primary local persistence layer. Implemented in `src/lib/db/`:

### Schema (v1)
- **conversations**: `conversationId` (key), `type` (random/friend/bot), `status`, `createdAt`, `endedAt`, `expiresAt`
  - Indexes: `by-type`, `by-expires`
- **messages**: `id` (key), `conversationId`, `senderId`, `originalMessage`, `translatedMessage`, `createdAt`, `transport` (webrtc/supabase/poll/local), `reactions`, `editedAt`, `deletedAt`, `replyToMessageId`, `deletedByReceiverAt`, `deliveredAt`, `readAt`, `messageType`, `callMode`, `callStatus`, `callDurationSeconds`
  - Indexes: `by-conversation`, `by-conversation-created`
- **media**: `messageId` (key), `conversationId`, `mimeType`, `size`, `blob`, `createdAt`
  - Indexes: `by-conversation`

### Public API (`src/lib/db/index.ts`)
```typescript
import { db } from '@/lib/db'

await db.conversations.upsert({ ... })
await db.conversations.setConversationEnded(id)
await db.conversations.setConversationFriend(id)
await db.conversations.cleanupExpiredConversations()

await db.messages.save({ ... })
await db.messages.getMessage(id)
await db.messages.getMessagesByConversation(id)
await db.messages.messageExists(id)

await db.media.save({ ... })
await db.media.getMedia(messageId)

await db.cleanup.runCleanup()
await db.cleanup.startCleanupScheduler()
```

### Cleanup
- Periodic cleanup every 60 seconds
- Random conversations: `expiresAt = endedAt + 24 hours`
- Friend conversations: `expiresAt = null` (no expiration)
- On startup: check and delete expired conversations
- On conversation open: check expiration before rendering

---

## Message Pipeline (Phases A–K — Complete)

All messages flow through a unified handler regardless of transport:

### Canonical ChatEvent Model

All operations are expressed as `ChatEvent` — a discriminated union with 9 variants:

```typescript
type ChatEvent =
  | MessageCreateEvent    // message.create
  | MessageEditEvent      // message.edit
  | MessageDeleteEvent    // message.delete
  | ReactionAddEvent      // reaction.add
  | ReactionRemoveEvent   // reaction.remove
  | TranslationUpdateEvent // translation.update
  | MediaCreateEvent      // media.create
  | MediaDeleteEvent      // media.delete
  | VoiceCreateEvent      // voice.create
```

Each event has: `eventId`, `conversationId`, `senderId`, `senderSequence`, `version`, `createdAt`, `operation`, `payload`.

### Capability Negotiation

Peers exchange `ChatCapabilities` during sync handshake:
```typescript
type ChatCapabilities = {
  protocolVersion: number
  supportsEvents: boolean
}
```
Old clients that don't send capabilities default to `supportsEvents: false` → legacy `kind:'text'` format.

### Outgoing: dispatchChatOperation()

Single exit point for all outgoing operations. Creates ChatEvent, persists to IDB, returns `{ event, msg, uiMsg, via }`:

```
UI → dispatchChatOperation() → ChatEvent
  → handleEvent() → ingestMessage()/patchMessage() → IndexedDB (always)
  → caller → WebRTC DataChannel (if via='webrtc')
  → caller → Supabase fallback (if via='supabase')
```

### Incoming: handleEvent()

Single entry point for all event-based ingestion. Deduplicates by eventId, applies operation through existing pipeline functions:

```
WebRTC DataChannel ─────┐
                         |
Supabase Realtime ───────┤
                         |
Smart Poll (5s) ─────────┘
                |
                v
    handleEvent(event, transport)  ← for ChatEvent
    ingestMessage(msg)             ← for legacy kind:'text'
    ingestBatch(rows)              ← for initial load
                |
                +--> Validate (ID + conversationId required)
                +--> Deduplicate (in-memory processingIds + IndexedDB unique ID)
                +--> Persist to IndexedDB (idbSaveMessage / idbUpdateMessage)
                +--> Update React/UI state (setMessages)
```

### USE_EVENT_PROTOCOL Flag

`USE_EVENT_PROTOCOL = true` (enabled Phase F). Controls:
- Outgoing: sends `ChatEvent` via DataChannel when peer supports it
- Incoming: processes `kind:'event'` messages via `handleEvent()`
- Fallback: sends legacy `kind:'text'` when peer doesn't support events

### Persistence model

```
WebRTC message (successful)
    |
    v
IndexedDB  ← source of truth
    |
    v
UI

Supabase fallback message
    |
    v
Supabase PostgreSQL  ← source of truth
    |
    v
IndexedDB  ← local cache
    |
    v
UI
```

**Supabase is NOT the source of truth for WebRTC-delivered messages.**

### Transport vs Presence vs Conversation Existence (Phase 4.3)

**WebRTC availability must never determine whether a DM can be opened.**

A DM is openable with a recipient who is ONLINE or OFFLINE, and while WebRTC is
OPEN, CONNECTING, DISCONNECTED, or FAILED. The conversation UI does not depend
on WebRTC being connected. WebRTC is a transport; it is not the source of truth
for whether a conversation exists.

- **Conversation existence** = two participants sharing one `conversation_id`.
  Independent of presence. `start_direct_chat` creates/finds one without any
  online-window check; accepted **friends** are always DM-able even when the
  peer is offline and fully private (friendship is mutual consent).
- **Presence** = whether the peer is online right now (`last_active_at` window).
  Only decides whether WebRTC can be attempted and whether `delivered_at` is
  stamped on insert. It never blocks opening or using a conversation.
- **Transport** = the pipe a message rides (`webrtc` vs `supabase`).
- **Offline delivery (Supabase mailbox)** = writing to the `messages` table when
  the peer is offline; the peer ingests pending rows through the unified
  pipeline when they return.
- **WebRTC reconciliation** = `sync-request`/`sync-response` on DataChannel open
  to fill gaps when a peer reconnects.

Presence-aware P2P (`useBackgroundP2P`): when the peer is known offline we keep
the signaling channel subscribed (so we can still answer an inbound offer) but do
not initiate offers or schedule retries. Retries use bounded exponential backoff.
This prevents WebRTC from churning/degrading the page when a DM is opened with an
offline recipient.

Offline send flow (recipient offline):

```
A writes message
   ↓
crypto.randomUUID() → canonical messageId
   ↓
p2pOpen() false (peer offline / WebRTC down)
   ↓
supabase.from('messages').insert({ id: messageId, ... })   ← explicit id
   ↓
unified pipeline → IndexedDB + UI (optimistic, immediate)
```

Recipient return flow:

```
B comes online and opens ShahZap / the DM
   ↓
loadFromIndexedDB (instant) → supabase select (pending rows)
   ↓
ingestBatch → unified pipeline → processingIds + unique messageId dedup
   ↓
IndexedDB + UI
```

### Pipeline API (`src/lib/db/pipeline.ts`)

```typescript
// Single message ingestion (returns true if new, false if duplicate)
await ingestMessage(canonicalMsg)

// Batch ingestion (initial load, smart poll — merges, deduplicates)
const merged = await ingestBatch(supabaseRows, conversationId, 'supabase')

// Patch a message (edit, delete, reaction)
await patchMessage(msgId, { editedAt: '...', originalMessage: '...' })

// Load from IndexedDB (instant rendering on page open)
const localMsgs = await loadFromIndexedDB(conversationId)
```

### Type Conversions

```
SupabaseRow → supabaseToPipeline() → PipelineMessage (canonical)
PipelineMessage → pipelineToUI() → UIMessage (React state)
UIMessage → uiToPipeline() → PipelineMessage (IndexedDB)
```

> **Read-only constraint (CRITICAL):** The React `messages` state must contain **only** snake_case `UIMessage` objects (the shape the renderer and `<RichText>` consume). Any `PipelineMessage` (camelCase) entering the DM page via `loadFromIndexedDB()`, `ingestBatch()`, or a local/WebRTC send **must** be mapped through `pipelineToUI()` before being added to state. Skipping this made `m.original_message` `undefined` for rendered text messages, which crashed `RichText`'s `useMemo(() => parse(text))` on `text.split()` — production error `Cannot read properties of undefined (reading 'split')`.

### Current Integration Points

| Path | How it uses the pipeline |
|---|---|
| Initial load | `loadFromIndexedDB()` → instant render → `ingestBatch()` → merge |
| Post-read-receipt re-fetch | `ingestBatch()` |
| Realtime INSERT | `ingestMessage()` (async persist) |
| Realtime UPDATE | `patchMessage()` (async persist) |
| Smart poll | `ingestBatch()` (fire-and-forget) |
| Local send | `ingestMessage()` (after server INSERT) |
| Edit | `patchMessage()` (after server UPDATE) |
| Delete for everyone | `patchMessage()` optimistic + rollback |
| Delete for me | `patchMessage()` optimistic + rollback |
| Reaction toggle | `patchMessage()` optimistic + server confirm + rollback |
| Translation | `patchMessage()` (after API response) |

No transport-specific UI logic. The UI consumes normalized messages.

---

## Media Pipeline (Phase G — Complete)

All media flows through the canonical event pipeline:

### Event Types
- `media.create` — images, videos, audio, files (metadata + fileRef)
- `media.delete` — marks media message as deleted
- `voice.create` — voice notes (metadata + fileRef + durationMs)

### Send Flow
```
File/voice → dispatchChatOperation(media.create/voice.create)
  → handleEvent → IDB messages store (metadata)
  → persistMediaToIDB → IDB media store (blob)
  → WebRTC DataChannel (binary chunks) OR Supabase broadcast (<2MB)
  → event via WebRTC if peer supports it
```

### Receive Flow
```
DataChannel/broadcast → blob received
  → persistMediaToIDB → IDB media store (blob)
  → React state (SharedFile[]) → renders <img>/<video>/<audio>
```

### Voice Recording
- `MediaRecorder` API with webm/opus codec
- `startRecording()` → `stopRecording()` → `VoiceRecording` (blob, durationMs, mimeType)
- UI: Mic button with recording indicator and duration timer

### Persistence
- IndexedDB `messages` store: metadata (messageType, fileName, etc.)
- IndexedDB `media` store: actual blob data
- Both survive page refresh
- Supabase Storage fallback available for large files via `uploadToSupabaseStorage()`

---

## Typing Pipeline

Typing indicators are ephemeral, not persisted as chat history:

```
typing:start
    |
    v
WebRTC DataChannel (primary)
    |
    v
Recipient

Fallback:
typing:start
    |
    v
Supabase Realtime broadcast
    |
    v
Recipient

DB fallback (cross-page visibility):
typing:start
    |
    v
Supabase RPC (set_typing)
    |
    v
Friends list / other pages
```

Heartbeat/throttle: at most every 1400ms. Auto-stop after 2200ms inactivity.

---

## Random Chat Lifecycle

```
Users matched
    |
    v
conversationType = 'random'
conversation created in Supabase
messages stored in IndexedDB
    |
    v
Session active
    |
    v
Session ends (user leaves, times out, or new match)
    |
    v
expiresAt = endedAt + 24 hours
    |
    v
Local cleanup (on startup, on open, periodically):
  - Check expiration
  - If expired: delete messages, media, conversation from IndexedDB
  - If valid: keep
```

---

## Friend Conversion

When both users become friends:

```
RANDOM conversation
    |
    v
Friendship confirmed (friend_requests.status = 'accepted')
    |
    v
Local state change:
  expiresAt = null (no expiration)
    |
    v
Existing IndexedDB messages remain
No data duplication
No server copy
```

Friend history remains as long as browser storage permits.
Users can clear browser data at any time — this is acceptable.

---

## Session Identity

- Anonymous cryptographically generated session via Supabase Auth
- No email, phone, password required
- Session stored in cookies (via `@supabase/ssr`)
- Profile created with random display name on first login
- Profile data: display_name, gender, age_band, country, languages, interests

**Offline-mailbox identity (Phase 4.3):** anonymous users are created via
`supabase.auth.signInAnonymously()`. The server-issued `auth.uid()` (UUID) is a
stable identifier stored in the Auth session cookie, used as `profile_id` across
`conversations` / `conversation_participants` / `messages`. This is stable enough
to support asynchronous/offline delivery keyed by `conversation_id`/`profile_id`
across the recipient's offline period. No new auth system is introduced.

**Limitation (documented):** if the recipient clears browser data/cookies or the
anonymous session is lost, the identifier is gone and history does not follow to
a new session. Offline delivery is scoped to a stable anonymous session, matching
the product model ("chat history does not follow the user to another device").

---

## Conversation Types

| Type | Created By | Expiration | Persistence |
|------|-----------|------------|-------------|
| Random match | `match_next` RPC | 24 hours after end | IndexedDB local |
| Direct chat | `start_direct_chat` RPC | None (friends) | IndexedDB local |
| Bot chat | Bot system | Session only | Ephemeral |

---

## Data Flow: Sending a Message

### When WebRTC DataChannel is open:
1. User types message
2. Message gets unique ID (`crypto.randomUUID()`)
3. Message sent via DataChannel (binary)
4. Message persisted to IndexedDB locally
5. Message appears in UI immediately (optimistic)
6. Receiver's DataChannel delivers message
7. Receiver's unified handler validates, deduplicates, persists to IndexedDB
8. Receiver's UI updates

### When WebRTC DataChannel is unavailable:
1. User types message
2. Message gets unique ID
3. Message sent via Supabase broadcast (fallback)
4. Message persisted to IndexedDB locally
5. Message appears in UI immediately (optimistic)
6. Receiver's Supabase channel delivers message
7. Receiver's unified handler validates, deduplicates, persists to IndexedDB
8. Receiver's UI updates

---

## Data Flow: Receiving a Message

```
Incoming data (WebRTC or Supabase)
    |
    v
Parse message
    |
    v
Validate (schema, sender, conversation)
    |
    v
Check message ID (deduplicate)
    |
    +--> Already exists in IndexedDB → skip
    |
    +--> New message → continue
            |
            v
        Persist to IndexedDB
            |
            v
        Update React state (setMessages)
            |
            v
        UI renders message
```

---

## Offline / Reload Behavior

When a conversation opens:

1. Open IndexedDB
2. Load locally cached messages
3. Render immediately (no server wait)
4. Establish Supabase Realtime connection
5. Synchronize any missed messages
6. Establish WebRTC DataChannel (if applicable)
7. Continue receiving new messages
8. Persist new messages locally

---

## Failure / Recovery

```
WebRTC connected
    → use WebRTC

WebRTC unavailable
    → use Supabase fallback

Supabase also unavailable
    → show clear failure state

WebRTC reconnects
    → resume WebRTC transport
    → sync any messages missed during fallback
```

Do not silently upload large media to cloud storage when WebRTC fails.
Fail gracefully rather than destroying quality.

---

## Random Chat Expiration (24-hour TTL)

On app startup and periodically:
1. Query IndexedDB for conversations with `type = 'random'`
2. For each: check `expiresAt` against current time
3. If expired: delete messages, media, conversation record
4. If valid: keep

Also check when opening a specific conversation.

Friend conversations are exempt from expiration.

---

## Security / Privacy

- No PII stored on server beyond what's needed for matching
- Conversation content stays on devices when possible
- WebRTC is peer-to-peer (no server relay for media)
- Supabase RLS enforces per-user data access
- Messages are soft-deleted (tombstones), not hard-deleted immediately
- Blocks prevent matching and messaging
- Rate limiting on friend requests, messages, translations

---

## Existing Supabase Channels (16 total)

| Channel Topic | Purpose |
|---|---|
| `conversation:{id}` | Primary chat: postgres_changes + typing + file broadcast |
| `call:user:{id}` | Voice/video call signaling (inbound + outbound) |
| `signal:{id}` | Background P2P DataChannel signaling |
| `unread-badge-v5` | Badge count updates |
| `match-queue-count-v2` | Live match queue count |
| `notif-banner:{id}` | In-app notification banners |
| `notif-bell:{id}` | Notification bell updates |
| `profile:{id}` | Live profile updates |
| `match-queue-live` | Match page queue count |
| `online-msg-tab` | Online messages thread list |
| `call-chat-unread` | Unread count in call overlay |
| `online-directory` | Online members directory |
| `global-notif:{id}` | Global notification sound player |
| `friends-rt` | Friends list realtime |
| `friends-requests-rt` | Pending friend requests |

---

## Existing Supabase RPCs (12+)

| RPC | Purpose |
|---|---|
| `match_next` | Atomic random matching |
| `set_typing` | Persist typing indicator |
| `mark_conversation_read` | Server-side read receipt |
| `sync_deliveries` | Set delivered_at on inbound messages |
| `mark_message_notifications_read` | Clear notification badges |
| `toggle_message_reaction` | Toggle emoji reaction |
| `message_reactors` | Fetch reaction details |
| `insert_call_log` | Insert call history row |
| `create_call_notification` | Create incoming-call notification |
| `resolve_call_notification` | Clear pending call notification |
| `unread_count_for_user` | Badge count across conversations |
| `translation_reserve` / `translation_refund` | Translation rate limiting |
| `send_friend_request` | Send friend request |
| `cancel_friend_request` | Cancel pending request |
| `unfriend_user` / `unfriend` | Unfriend with 7-day retention |
| `delete_and_unfriend` | Hard delete + unfriend |
| `block_user` / `unblock_user` | Block/unblock users |

---

## Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19, Tailwind CSS, Lucide icons |
| Backend | Supabase (PostgreSQL, Realtime, Auth, RPC) |
| P2P | WebRTC (STUN-only, no TURN) |
| Deployment | Cloudflare Workers (via opennextjs-cloudflare) |
| Package Manager | npm |
| Language | TypeScript (strict) |

---

## Deployment

- `npm run deploy` — local build + deploy to Cloudflare Workers
- GitHub Actions CI: lint + build + dry-run only
- Production URL: `https://shahzap.safiullahkorai600.workers.dev`
- Commit → push to `main` → deploy locally

---

## Key Files

| File | Purpose |
|---|---|
| `src/app/chat/[conversationId]/page.tsx` | Main chat page — event dispatch, media, voice, reconciliation |
| `src/hooks/use-call.ts` | Voice/video call engine |
| `src/hooks/use-background-p2p.ts` | Persistent P2P DataChannel + capability negotiation |
| `src/components/call-provider.tsx` | Global call context provider |
| `src/components/call-overlay.tsx` | Call UI overlay |
| `src/lib/file-transfer.ts` | ChatEvent model (9 variants), validateChatEvent, capabilities, file chunking |
| `src/lib/db/pipeline.ts` | Unified pipeline — handleEvent, dispatchChatOperation, ingestMessage, patchMessage |
| `src/lib/db/schema.ts` | IndexedDB schema (messages, media, sender_sequences) |
| `src/lib/db/messages.ts` | Message CRUD |
| `src/lib/db/media.ts` | Media CRUD |
| `src/lib/db/media-storage.ts` | Media persistence + Supabase Storage fallback |
| `src/lib/db/sender-sequences.ts` | Monotonic sender-scoped sequencing |
| `src/lib/db/cleanup.ts` | Expiration and cleanup |
| `src/lib/db/index.ts` | Public API |
| `src/lib/voice-recording.ts` | MediaRecorder voice capture |
| `src/lib/call.ts` | ICE servers, call types, constants |
| `src/lib/notification-sound.ts` | Sound preferences and playback |
| `src/lib/identity.ts` | Display name resolution |
| `src/lib/matching.ts` | Match queue client logic |
| `src/components/presence-heartbeat.tsx` | Online presence heartbeat |

---

## Infrastructure Budget Strategy

### Cloudflare Request Minimization
- Static assets served directly (no Worker invocation)
- API routes only for: translate, webhooks, ads config, rewards
- Normal chat messages do NOT route through Cloudflare Worker
- Typing indicators do NOT route through Cloudflare Worker
- Read receipts do NOT route through Cloudflare Worker

### Supabase Usage Minimization
- WebRTC is primary transport for text, typing, media, reactions, edits, deletes
- Supabase is fallback when WebRTC unavailable
- No permanent chat transcripts in PostgreSQL (transitioning)
- No normal media in Supabase Storage (only fallback for large files)
- Typing via DataChannel primary, Supabase broadcast fallback
- Smart poll (5s) is reliability backbone, not primary transport
- **Cost optimization:** removed redundant SELECTs after INSERT/UPDATE, removed redundant `mark_conversation_read` RPC calls

### WebRTC-First Strategy
- Text messages via DataChannel when open
- Typing via DataChannel when open
- Media via DataChannel (16KB chunks) when open
- Supabase fallback only when DataChannel unavailable
- No TURN servers (STUN-only, Google STUN)

### IndexedDB-First Persistence
- All messages stored locally in IndexedDB
- Media blobs stored locally in IndexedDB
- Conversation metadata stored locally
- Page refresh loads from IndexedDB first, then syncs
- Random conversations expire after 24 hours locally
- Friend conversations persist indefinitely (browser-local)

### Fallback Strategy
- WebRTC available → use P2P
- WebRTC unavailable → Supabase Realtime fallback
- Supabase unavailable → show clear failure state
- Do not silently upload to cloud storage

### No-TURN Decision
- STUN-only for now (Google STUN servers)
- Direct P2P works for most users
- Controlled fallback for users behind symmetric NATs
- TURN may be added in future if measured need exists

### Known Limitations
- WebRTC P2P fails for ~5-15% of users (symmetric NAT)
- IndexedDB is browser-local (data lost on device change)
- No cross-device history sync
- Supabase Realtime has payload size limits
- No permanent server-side chat archive

---

## Testing

| Framework | Purpose |
|---|---|
| Vitest | Unit tests (pipeline, events, reconciliation, cost optimization) |
| happy-dom | DOM environment for tests |
| fake-indexeddb | IndexedDB polyfill for Node.js tests |

**166 tests** covering:
- Pipeline ingestion (dedup, batch, cross-transport)
- Event protocol (validate, handle, dispatch)
- CRUD operations (text, edit, delete, reaction, translation)
- Media operations (media.create, voice.create, media.delete)
- Reconciliation (mixed events, sequences, dedup)
- Cost optimization (WebRTC vs Supabase paths)
- P2P hook (capabilities, signaling, reconnect)

Run tests: `npm test`
