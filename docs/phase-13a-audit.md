# Phase 13A — Full-System Audit

Status: **IN PROGRESS — post-fix verification**

Scope: Steps 1–12 as one production system.

## Audit gates

- [x] Authentication/session boundaries reviewed
- [x] RLS and privileged RPC authorization reviewed
- [x] Matching integrity and abuse resistance reviewed
- [x] Realtime chat authorization and privacy reviewed
- [x] Translation boundaries and failure handling reviewed
- [x] Safety: report/block/moderation reviewed
- [x] Social/profile privacy reviewed
- [x] Gamification economy integrity reviewed
- [x] Rewards/entitlement integrity reviewed
- [x] Premium and rewarded-ad provider boundaries reviewed
- [x] Admin visibility and authorization reviewed
- [x] SEO/private-route isolation reviewed
- [x] PWA/service-worker privacy reviewed
- [ ] Environment/secrets/dependency reproducibility
- [ ] Production build and CI

## Findings log

### P13A-001 — Rewarded-ad grant callable by clients
Severity: **Critical**

The rewarded Chat Pass grant RPC was exposed to authenticated clients without real provider verification.

**Fix:** revoked execution from `authenticated` and `anon`. Real provider/webhook infrastructure will grant the entitlement later in Phase 13C.

**Verification:** Supabase function privilege audit confirms `grant_rewarded_chat_pass` is executable by neither `anon` nor `authenticated`.

### P13A-002 — Gamification mutation lacked strict caller ownership
Severity: **High**

The gamification event RPC accepted a profile ID and required stronger ownership validation.

**Fix:** function now requires an authenticated caller and `auth.uid() = p_profile_id`, and rejects oversized event amounts.

**Verification:** function privilege audit shows authenticated-only execution.

### P13A-003 — Direct profile economy/state mutation risk
Severity: **High**

`profiles` contains server-owned economy/progression columns such as XP, Zap Points, Region Credits and level. Direct authenticated table grants were broader than necessary.

**Fix:** revoked broad `profiles` table DML grants and granted only user-facing/profile-editable columns. Server-owned economy/state fields are no longer directly writable through the client table API.

### P13A-004 — Friend request parties/status transitions were too permissive
Severity: **High**

The table policy allowed both parties to update rows without constraining which status transitions were valid.

**Fix:** added a database trigger that makes sender/receiver immutable and permits only receiver `pending → accepted/declined` or sender `pending → cancelled` transitions.

### P13A-005 — Dependency reproducibility
Severity: **Medium**

`package.json` currently uses `latest` for core dependencies and the CI workflow uses `npm install` rather than a committed lockfile with `npm ci`.

**Status:** **OPEN**. This must be hardened before Phase 13A completion.

## Supabase verification snapshot

- All exposed public application tables currently have RLS enabled.
- Privileged SECURITY DEFINER functions are reviewed individually.
- `grant_rewarded_chat_pass` is not executable by `anon` or `authenticated`.
- Staff/admin RPCs are authenticated-only.
- Conversation/message RLS is participant-based.
- Profile economy/state fields are protected from direct client DML.

## Completion rule

Phase 13A is complete only when all high/critical findings are fixed or explicitly accepted, database/security checks pass, dependency/build reproducibility is hardened, CI is green, and the complete system has been reviewed again after fixes.

Do not activate real ad/payment credentials during this phase.
