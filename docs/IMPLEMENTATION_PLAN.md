# ShahZap P2P Infrastructure Migration — Implementation Plan

## Status: COMPLETE (Phases A–K)

All phases have been implemented, tested (166/166 tests passing), and deployed.

## Completed Phases

| Phase | Name | Status | Commit |
|---|---|---|---|
| A | Architecture Audit | ✅ Complete | — |
| B | Design Revision | ✅ Complete | — |
| C | Unify Ingestion Pipeline | ✅ Complete | d84f1760 |
| D | Unify Outgoing Operations | ✅ Complete | d84f1760 |
| E | Storage Layer Responsibilities | ✅ Complete | d84f1760 |
| F | CRUD Fixes | ✅ Complete | d84f1760 |
| G | Media Architecture | ✅ Complete | d84f1760 |
| H | Reconciliation Improvements | ✅ Complete | d84f1760 |
| I | Cost Optimization | ✅ Complete | d84f1760 |
| J | Testing | ✅ Complete | d84f1760 |
| K | Final Report | ✅ Complete | d84f1760 |

---

## Architecture Summary

### Canonical ChatEvent Model (9 variants)

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

### Unified Pipeline

- **`handleEvent(event, transport)`** — Single entry point for all incoming events
- **`dispatchChatOperation(opts)`** — Single exit point for all outgoing operations
- **`validateChatEvent(parsed)`** — Type-safe validation for all event types
- **`ingestMessage(msg)`** — Legacy text message ingestion (backward compat)
- **`ingestBatch(rows)`** — Batch ingestion for initial load

### Transport Architecture

```
WebRTC DataChannel (primary)
  → Text messages (kind:'event' or kind:'text')
  → Media binary transfer (16KB chunks)
  → Voice notes (MediaRecorder → DataChannel)
  → File transfer (chunked)
  → Capability negotiation (sync handshake)
  → Reconciliation (sync-request/sync-response with events)

Supabase (fallback/mailbox)
  → INSERT/UPDATE when WebRTC unavailable
  → Realtime for presence, typing, notifications
  → Storage fallback for large files
  → Social operations (friends, blocks, reports)

IndexedDB (durable local state)
  → Messages store (all CRUD operations)
  → Media store (blobs for images, videos, audio)
  → Sender sequences (monotonic per-sender)
  → Source of truth for WebRTC-delivered messages
```

### Capability Negotiation

```typescript
type ChatCapabilities = {
  protocolVersion: number
  supportsEvents: boolean
}
```

Exchanged during sync handshake. Old clients → `supportsEvents: false` → legacy `kind:'text'`.

### Cost Optimizations

- Removed `.select().single()` after INSERT/UPDATE (saves 1 query per write)
- Removed redundant `mark_conversation_read` RPC calls
- WebRTC path: 0 Supabase writes for all CRUD operations
- Supabase fallback: minimal writes (INSERT/UPDATE only, no SELECT)

---

## Implementation Summary

### What Was Built

**Phase A–B: Architecture Audit + Design**
- 17 gaps identified in original architecture
- 27-section design document with discriminated union `ChatEvent`, capability negotiation, 4-identity model

**Phase C–D: Unified Pipeline**
- `handleEvent(event, transport)` — single entry point for all incoming events
- `dispatchChatOperation(opts)` — single exit point for all outgoing operations
- `validateChatEvent(parsed)` — type-safe validation for 9 event types

**Phase E: Storage Layer**
- IndexedDB is canonical state for all WebRTC-delivered messages
- Every write persists to IDB before or alongside Supabase

**Phase F: CRUD Fixes**
- `USE_EVENT_PROTOCOL = true` — all CRUD sends `ChatEvent` via DataChannel
- `message.create`, `message.edit`, `message.delete`, `reaction.add`, `reaction.remove`, `translation.update` all go through event pipeline

**Phase G: Media Architecture**
- `media.create`, `media.delete`, `voice.create` event types
- Voice recording via MediaRecorder API
- Media blobs persisted to IDB `media` store (was unused before)
- Supabase Storage fallback for large files

**Phase H: Reconciliation**
- `SyncResponse` carries both `TextMessage[]` and `ChatEvent[]`
- All event types reconciled on reconnect (text, edits, deletions, reactions, media, voice)

**Phase I: Cost Optimization**
- Removed `.select().single()` after INSERT/UPDATE (saves 1 query per write)
- Removed redundant `mark_conversation_read` RPC calls
- WebRTC path: 0 Supabase writes for all CRUD

**Phase J–K: Testing + Validation**
- 166 tests passing
- TypeScript clean, build succeeds
- Production deployment verified

### Files Created/Modified

| File | Lines Changed | Purpose |
|---|---|---|
| `src/lib/file-transfer.ts` | +189/-28 | ChatEvent model (9 variants), validateChatEvent, capabilities |
| `src/lib/db/pipeline.ts` | +290/-29 | handleEvent, dispatchChatOperation, media/voice events |
| `src/lib/db/pipeline.test.ts` | +2067 | 166 tests |
| `src/lib/db/schema.ts` | +3/-1 | messageType extended, DBMessage.version |
| `src/lib/db/media-storage.ts` | **new** | IDB media persistence + Supabase Storage |
| `src/lib/voice-recording.ts` | **new** | MediaRecorder voice capture |
| `src/app/chat/[conversationId]/page.tsx` | +575/-249 | Event dispatch, media, voice, cost optimization |
| `src/hooks/use-background-p2p.ts` | +112 | Capability negotiation, presence-aware |
| `src/hooks/use-background-p2p.test.ts` | +243 | Hook tests |

### Test Coverage

| Category | Tests |
|---|---|
| Pipeline ingestion | 25 |
| Event protocol | 40 |
| CRUD operations | 35 |
| Media operations | 12 |
| Reconciliation | 9 |
| Cost optimization | 12 |
| P2P hook | 33 |
| **Total** | **166** |

### Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| WebRTC fails for ~5-15% (symmetric NAT) | No P2P for those users | Supabase fallback |
| IndexedDB is browser-local | Data lost on device change | Product model accepts this |
| No cross-device sync | History doesn't follow user | Product model accepts this |
| Voice notes: no waveform visualization | Basic `<audio>` controls | Future enhancement |
| `media.delete` has no UI button | Event type exists, no trigger | Future enhancement |
| Supabase Storage download not wired | Upload exists, download path incomplete | Files go through DataChannel only |

---

## References

- `docs/ARCHITECTURE.md` — Authoritative architecture reference
- `src/lib/file-transfer.ts` — ChatEvent model, validateChatEvent, capabilities
- `src/lib/db/pipeline.ts` — handleEvent, dispatchChatOperation
- `src/lib/db/pipeline.test.ts` — 166 tests
- Commit `d84f1760` — Phase A–K implementation
