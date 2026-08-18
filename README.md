# ⚡ ShahZap

Anonymous social discovery, random chat, intelligent matching, translation, progression, rewards, and privacy-first social features.

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
| 7 | Gamification | 🔄 In progress |
| 8 | Rewards | ⏳ Not started |
| 9 | Monetization | ⏳ Not started |
| 10 | Admin | ⏳ Not started |
| 11 | SEO | ⏳ Not started |
| 12 | PWA/mobile preparation | ⏳ Not started |

## Current branch

`feat/step-7-gamification`

## Step 7 — Gamification

The product roadmap defines Step 7 as **Zap Points, XP, levels, streaks, quests, and achievements**. The original product discussion also specifies that XP should have real utility rather than being a meaningless number. fileciteturn233file0L33-L39

### Implemented database model

- `gamification_profiles`
  - Zap Points balance
  - XP balance
  - level
  - current streak
  - longest streak
  - last active date
- `gamification_ledger`
  - immutable-style event history for earn/spend/adjust operations
  - source and metadata
  - XP amount
- `quests`
  - daily / weekly / one-time cadence
  - XP and Zap rewards
- `quest_progress`
  - per-user quest progress and period
- `achievements`
  - achievement definitions
- `profile_achievements`
  - unlocked achievement records

### Progression logic

The database owns the main progression mutation through `gamification_apply_event` so the browser cannot simply edit its own XP/ZP totals.

The function:

1. Creates a gamification profile when necessary.
2. Locks the user's progression row while updating it.
3. Applies Zap Points and XP.
4. Recalculates level from total XP.
5. Updates daily activity streaks.
6. Preserves the longest streak.
7. Records the event in the gamification ledger.

This is intentionally server-side because progression values are an economy and must not be trusted to client-side arithmetic.

### Initial quests

Seeded mission definitions:

- **Three Chats** — complete three valid conversations.
- **15 Minutes** — spend 15 minutes in valid conversations.
- **Shared Interest** — complete a conversation with a shared interest.
- **Use Translation** — use translation during a conversation.
- **Complete Profile** — complete profile setup.

The source product discussion gives these as examples of ShahZap Missions and explicitly connects them to XP/ZP progression. fileciteturn233file8L1319-L1330

### Initial achievements

- First Chat
- Ten Chats
- Seven Day Streak

These are starter definitions and are intentionally data-driven so the achievement catalog can grow without changing the application schema.

### Progression UI

`/progression` provides:

- Zap Points
- XP
- current level
- current streak
- active mission list
- reward values for each mission

The authenticated application dashboard now links directly to Progression.

## Economy design notes

Zap Points are the main progression currency. The source discussion explicitly proposes spending ZP on useful personalization and perks such as display-name changes, avatar customization, profile customization, ad-free time, Region Credits, streak shields, and profile spotlight. Exact costs are intentionally treated as balancing values rather than permanently fixed product requirements. fileciteturn233file4L702-L722

The source discussion also recommends a daily earning cap to prevent chat-bot farming and other economy abuse. A future reward implementation must preserve that anti-abuse principle rather than allowing unlimited passive chat earnings. fileciteturn233file8L1243-L1261

## Important implementation boundary

Step 7 creates the **progression foundation**. Step 8 owns Region Credits, Chat Passes, and the broader rewards shop. Step 9 owns advertising and Premium monetization.

Do not mix those later economies into Step 7 merely because the database already contains related legacy columns.

## Existing architecture

### Step 1 — Foundation

- Next.js + TypeScript
- responsive Tailwind UI
- Supabase client/server foundations
- GitHub Actions validation
- Node 22 CI
- production build validation
- current Next.js proxy convention

### Step 2 — Anonymous onboarding

- pseudonymous profile
- age band
- gender/orientation
- generation preference
- interface language
- chat language
- interests
- visibility preferences

### Step 3 — Matching

Safety → age compatibility → preferences → language → generation → interests → region → random fallback.

Includes match queue, compatibility scoring, configurable interest timeout, block-aware matching, and matched conversation creation.

### Step 4 — Real-time chat

- authenticated conversation route
- message history
- message sending
- Supabase Realtime
- original/translated message architecture
- Next navigation
- participant-aware RLS

### Step 5 — Safety

- report
- block
- report reasons
- safety controls in chat
- block-aware matching/social interactions
- RLS protections

### Step 6 — Social

- friend requests
- accept/decline/cancel
- friends list
- profile viewing
- visibility-aware profile display
- block-aware requests
- social RLS

## Security rules

- Never allow browser code to directly mutate XP, ZP, level, or streak totals.
- Use authenticated server-side/RPC operations for progression mutations.
- Keep the gamification ledger protected by RLS.
- Quest and achievement definitions can be read by authenticated users only when active.
- User progress and unlocked achievements are private to the owning profile.
- Do not use client-side balances as authoritative economy state.

## AI handoff instructions

If another AI takes over:

1. Read this README completely.
2. Inspect the current branch and latest commit.
3. Check GitHub Actions for the latest commit before changing code.
4. Inspect the Supabase schema and RLS before changing economy logic.
5. Preserve the staged roadmap.
6. Do not mark Step 7 complete until CI and acceptance checks are green.
7. Update this README whenever Step 7 changes.
8. Keep later Step 8/9 features separated from Step 7 unless the master specification explicitly requires shared infrastructure.

When fixing CI:

`identify exact failure → smallest correct fix → commit → wait for CI → inspect result → repeat until green.`

## Roadmap

1. Foundation — completed
2. Anonymous onboarding — completed
3. Matching — completed
4. Real-time chat — completed
5. Safety — completed
6. Social — completed
7. Gamification — **current**
8. Rewards
9. Monetization
10. Admin
11. SEO
12. PWA/mobile preparation

## Product principles

- Privacy-first anonymous/pseudonymous social discovery.
- Safety and age compatibility come before matching preferences.
- Generation is a discovery preference, never the primary safety boundary.
- Interest matching has a configurable wait period and safe random fallback.
- Interface language and chat language are independent.
- Active conversations are never interrupted by advertisements.
- Public SEO content is separate from private conversations.
- Web is mobile-first and PWA-ready.
- Rewards should encourage meaningful activity and resist abuse.
