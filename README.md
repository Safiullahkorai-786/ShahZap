# ⚡ ShahZap

Anonymous social discovery, random chat, intelligent matching, translation, progression, rewards, monetization, moderation, and privacy-first social features.

## Build status

ShahZap is built deliberately in completed phases. **Do not move to the next phase until the current phase's implementation, database/security work, CI validation, and acceptance checks are complete.**

| Step | Area | Status |
|---|---|---|
| 1 | Foundation | ✅ Completed |
| 2 | Anonymous onboarding | ✅ Completed |
| 3 | Matching | ✅ Completed |
| 4 | Real-time chat | ✅ Completed |
| 5 | Safety | ✅ Completed |
| 6 | Social | ✅ Completed |
| 7 | Gamification | ✅ Completed |
| 8 | Rewards | ✅ Completed |
| 9 | Monetization | ✅ Completed |
| 10 | Admin | 🔄 In progress |
| 11 | SEO | ⏳ Not started |
| 12 | PWA/mobile preparation | ⏳ Not started |

## Current branch

`feat/step-10-admin`

## Step 10 — Admin & Moderation

Step 10 is the operational control layer for ShahZap. It must remain separate from normal user permissions and must be auditable.

### Database model

#### `admin_roles`

Maps a profile to a restricted staff role:

- `admin`
- `moderator`

The table is protected by RLS and a user can only see their own role record.

#### `admin_audit_log`

Records staff actions:

- actor
- action
- target type
- target ID
- metadata
- timestamp

Audit records are readable only by staff.

#### `moderation_actions`

Records operational moderation actions:

- warn
- mute
- suspend
- unsuspend
- review
- dismiss_report

Each action records its staff actor, target profile/message where applicable, reason, expiry and creation time.

### Staff authorization

The database owns staff checks through:

- `is_staff()`
- `is_admin()`

Admin operations must not rely on a hidden route or client-side boolean. The server/database authorization boundary is authoritative.

### Admin dashboard

`/admin` is a protected operational screen.

It:

- verifies the authenticated session;
- checks the user's staff role;
- denies non-staff users;
- shows recent moderation actions;
- shows recent audit events;
- does not expose admin data to ordinary users.

### Admin action recording

`admin_record_action()` is the server-side audit entry point.

It verifies staff access before inserting an audit event.

Client helper:

`src/lib/admin.ts`

The client helper is only a convenience wrapper around the protected RPC; it is not an authorization mechanism.

## Security requirements

- Never trust `/admin` route visibility as authorization.
- Never let ordinary users write audit records.
- Never let ordinary users read moderation records.
- Staff actions must be auditable.
- Keep actor identity on every moderation/audit event.
- Keep production payment/ad credentials out of Git.
- Admin UI must not bypass the existing report/block/safety protections.

## Operational boundaries

### Step 5 owns

Safety reports, blocks and user safety controls.

### Step 8 owns

Rewards and user economy.

### Step 9 owns

Monetization, Premium and provider-neutral ad/payment entitlement infrastructure.

### Step 10 owns

Operational administration:

- staff roles
- moderation actions
- audit trail
- operational review interface
- future revenue/monetization configuration controls
- future abuse/fraud review tools

Provider credentials remain outside source control and will be configured later when the full product is ready for real ad/payment activation.

## Existing architecture

Steps 1–9 are completed before Step 10.

Key systems include:

- Next.js + TypeScript + Tailwind
- Supabase Auth/Postgres/Realtime
- anonymous/pseudonymous profiles
- compatibility matching
- real-time chat
- translation architecture
- safety/report/block
- friends/profile system
- XP/ZP/levels/streaks/quests/achievements
- Region Credits
- Chat Passes
- rewards catalog/redemption
- Premium/ad monetization foundation

## AI handoff instructions

If another AI takes over:

1. Read this README completely.
2. Inspect the current branch and latest commit.
3. Check GitHub Actions before changing code.
4. Inspect admin RLS and staff functions before modifying authorization.
5. Never make the client the source of truth for staff permissions.
6. Never commit production secrets.
7. Preserve the audit trail when adding administrative operations.
8. Update this README after meaningful Step-10 changes.
9. Do not mark Step 10 complete until UI, authorization, database/RLS, CI and acceptance checks are green.

CI/debug process:

`identify exact failure → smallest correct fix → commit → wait for CI → inspect result → repeat until green.`

## Roadmap

1. Foundation — completed
2. Anonymous onboarding — completed
3. Matching — completed
4. Real-time chat — completed
5. Safety — completed
6. Social — completed
7. Gamification — completed
8. Rewards — completed
9. Monetization — completed
10. Admin — **current**
11. SEO
12. PWA/mobile preparation

## Product principles

- Privacy-first anonymous/pseudonymous social discovery.
- Safety and age compatibility come before matching preferences.
- Generation is a discovery preference, never the primary safety boundary.
- Interface language and chat language are independent.
- Never interrupt an active conversation with an advertisement.
- Rewarded ads are opt-in exchanges for useful entitlements.
- Premium is a subscription entitlement, not a client-side flag.
- Public SEO content is separate from private conversations.
- Web is mobile-first and PWA-ready.
- Rewards should encourage meaningful activity and resist abuse.
