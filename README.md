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
| 7 | Gamification | ✅ Completed |
| 8 | Rewards | 🔄 In progress |
| 9 | Monetization | ⏳ Not started |
| 10 | Admin | ⏳ Not started |
| 11 | SEO | ⏳ Not started |
| 12 | PWA/mobile preparation | ⏳ Not started |

## Current branch

`feat/step-8-rewards`

## Step 8 — Rewards

The roadmap defines Step 8 as **Region Credits, Chat Passes, and rewards**. fileciteturn240file0L37-L43

The product discussion separates the reward economy into useful resources rather than meaningless points: Region Credits are for geographic targeting, while temporary rewards such as Chat Passes provide uninterrupted chat time. fileciteturn240file6L886-L897

### Implemented reward infrastructure

#### Region Credits

`region_credits` provides a server-side balance per profile.

Purpose:

- future country/region targeting
- separate geographic resource from XP/Zap Points
- private wallet state

The source discussion explicitly proposes Region Credits as the resource for geographic targeting. fileciteturn240file6L962-L990

#### Chat Passes

`chat_passes` stores server-side pass state:

- owner
- source
- started_at
- expires_at
- remaining_seconds
- status
- creation timestamp

This is deliberately server-side. The source product design explicitly says the timer must survive refreshes, closing the browser, and switching chats rather than resetting in the client. fileciteturn240file5L843-L860

The intended ShahZap UX is a 30-minute uninterrupted chat allowance, not an advertisement inserted into an active conversation. fileciteturn240file4L686-L715

#### Rewards catalog

`rewards_catalog` is data-driven and currently contains:

- **30-Minute Chat Pass** — 150 Zap Points
- **10 Region Credits** — 100 Zap Points
- **Streak Shield** — 200 Zap Points
- **Profile Highlight** — 250 Zap Points

The exact prices are balancing values and can later be changed through the catalog without redesigning the application.

#### Reward redemptions

`reward_redemptions` records:

- user
- reward
- actual Zap Point cost
- redemption timestamp

This gives the economy an auditable reward history.

#### Streak Shields

`streak_shields` stores the user's available protection balance separately from XP/ZP.

The product discussion specifically proposes streak protection as a useful reward earned through activity, challenges, referrals, or similar legitimate actions. fileciteturn240file9L1342-L1355

### Secure redemption

Reward spending happens through the Supabase `redeem_reward` security-definer function.

The function:

1. Requires authentication.
2. Looks up an active reward by code.
3. Locks the reward and user's gamification row.
4. Verifies sufficient Zap Points.
5. Deducts the exact catalog price server-side.
6. Records the spend in the gamification ledger.
7. Creates the correct reward entitlement.
8. Records the redemption.
9. Returns the remaining Zap Point balance.

The browser never gets permission to directly modify the wallet balances.

### Chat Pass activation

`activate_chat_pass` verifies that the requested pass belongs to the authenticated user and is still available before activating it.

Activation establishes the server-side start/expiry state using the stored remaining allowance.

**Important future integration requirement:** the chat session must consume the pass's remaining seconds server-side. A UI countdown must never be the authority for time remaining.

### Rewards UI

`/rewards` provides:

- Region Credits wallet
- available Chat Pass count
- Streak Shield balance
- rewards catalog
- Zap Point prices
- one-click secure redemption
- active/available Chat Pass display

The authenticated app should link to this page as the reward wallet becomes part of the main navigation.

## Economy boundaries

Step 7 owns:

- XP
- levels
- streaks
- quests
- achievements
- Zap Point earning

Step 8 owns:

- Region Credits
- Chat Passes
- Streak Shields
- reward catalog
- reward redemption
- reward wallet

Step 9 owns:

- rewarded advertisements
- Premium
- monetization
- country/region commercial targeting

Do not merge advertising implementation into Step 8. Step 8 provides the entitlement infrastructure that Step 9 can later grant through rewarded ads or Premium.

## Product rules carried into Step 8

### Never interrupt an active conversation

The source product requirement is explicit: ads should not interrupt an active conversation. The reward model is intended to exchange an opt-in reward action for uninterrupted chat time. fileciteturn240file4L743-L759

### Pass is session-level, not conversation-level

A Chat Pass represents chat-time allowance that can span multiple conversations. The source design explicitly gives the example of using the same remaining allowance across Chat #1, Next, Chat #2, etc. fileciteturn240file5L784-L798

### Reward alternatives

The product design supports obtaining a Chat Pass through different channels:

- free rewarded-ad flow — Step 9
- Zap Point redemption — Step 8
- Premium entitlement — Step 9
- earned/referral/admin grants — Step 8 infrastructure

The source discussion explicitly describes the free/reward/Premium hierarchy. fileciteturn240file5L799-L820

## Security rules

- Never mutate reward balances directly from browser code.
- Keep Region Credits private to the owning profile.
- Keep Chat Passes private to the owning profile.
- Keep Streak Shields private to the owning profile.
- Only active catalog rewards are publicly readable to authenticated users.
- Reward redemption must be authenticated and server-side.
- Every spend must be represented in the gamification ledger and redemption table.
- Chat Pass timing must remain server-authoritative.
- Later rewarded-ad and Premium grants must use trusted server-side entitlement issuance.

## Existing architecture

### Steps 1–7

Foundation, onboarding, matching, real-time chat, safety, social, and gamification are completed before Step 8.

Key existing systems include:

- Next.js + TypeScript + Tailwind
- Supabase Auth/Postgres/Realtime
- profile and privacy controls
- match queue and compatibility RPC
- real-time conversations/messages
- report/block safety layer
- friends/profile system
- XP/ZP/levels/streaks/quests/achievements

## AI handoff instructions

If another AI takes over:

1. Read this README completely.
2. Inspect the current branch and latest commit.
3. Check GitHub Actions for the latest commit.
4. Inspect Supabase RLS and reward functions before modifying economy code.
5. Treat server-side wallet state as authoritative.
6. Do not implement Step 9 advertising/Premium as part of Step 8.
7. Do not mark Step 8 complete until CI and acceptance checks are green.
8. Update this README with every significant Step-8 change.

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
8. Rewards — **current**
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
