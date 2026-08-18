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
| 8 | Rewards | ✅ Completed |
| 9 | Monetization | 🔄 In progress |
| 10 | Admin | ⏳ Not started |
| 11 | SEO | ⏳ Not started |
| 12 | PWA/mobile preparation | ⏳ Not started |

## Current branch

`feat/step-9-monetization`

## Step 9 — Monetization

The master roadmap defines Step 9 as **Rewarded Ads + Premium + country/region targeting**. fileciteturn245file0L41-L43

The monetization philosophy is intentionally different from traditional interruptive chat advertising: users should voluntarily exchange an ad interaction for a valuable Chat Pass, and an active conversation must never be interrupted by an advertisement. fileciteturn245file3L420-L441

### Monetization architecture

Step 9 consists of three separate but connected systems:

1. **Rewarded advertising** — optional ad interaction grants a server-issued 30-minute Chat Pass.
2. **Premium** — subscription entitlement provides unlimited ad-free Chat Pass access and premium geographic targeting.
3. **Country/region targeting** — commercial targeting configuration is separated from the user's private matching preferences.

### Database model

#### `premium_plans`

Stores:

- plan code
- title
- description
- duration
- price in minor currency units
- currency
- active state

Seed plans:

- `premium_monthly` — 30 days — USD 9.99
- `premium_yearly` — 365 days — USD 79.99

These are catalog defaults, not hard-coded checkout amounts. A real payment provider must remain the authority for successful payment.

#### `premium_subscriptions`

Stores:

- profile
- plan
- subscription status
- start/end time
- provider
- provider subscription ID
- update timestamps

This separates the application entitlement from the payment provider. Webhook/server verification should update this table after a successful purchase or cancellation.

#### `ad_reward_events`

Stores rewarded-ad entitlement events:

- profile
- ad provider
- ad unit
- provider event ID
- reward type/value
- status
- grant time

A partial unique index prevents the same provider event ID from granting the reward twice.

#### `monetization_targeting`

Stores commercial country/region settings:

- country code
- region code
- Premium enabled/disabled
- rewarded ads enabled/disabled
- ad frequency cap
- metadata
- active state

This is intentionally distinct from matching preferences and Region Credits.

### Rewarded Chat Pass flow

The intended user experience is:

`User wants a new chat`

→ `No active Premium / pass`

→ `Offer optional rewarded ad`

→ `User explicitly opts in`

→ `Ad provider confirms reward`

→ `Server validates provider event`

→ `Server creates 1 × 30-minute Chat Pass`

→ `User chats without ad interruption`

The source product discussion explicitly defines the 1-ad → 30-minute pass model and says ads should never appear inside an active conversation. fileciteturn245file5L650-L687

### Critical anti-abuse rule

**The browser must never be allowed to claim a rewarded ad merely by calling a client RPC.**

The database entitlement function is designed around a trusted provider event ID and duplicate protection. The final provider adapter must verify the provider's server-side reward callback/token before calling the grant operation.

The client-side `src/lib/monetization.ts` therefore represents application helpers, not proof that an advertisement was watched.

### Chat Pass behavior

A pass is session-level, not conversation-level.

For example:

- Chat #1: 8 minutes
- Next
- Chat #2: 4 minutes
- Next
- Chat #3: 12 minutes
- Total used: 24 minutes

The remaining allowance belongs to the user/pass, not to an individual conversation. fileciteturn245file4L690-L704

When the pass expires during an active conversation:

- do **not** display an ad;
- do **not** force-close the conversation;
- let the current conversation continue;
- request another pass before the next new matching session.

This preserves the core ShahZap product promise. fileciteturn245file4L524-L550

### Premium

Premium is designed around:

- unlimited ad-free Chat Pass access;
- premium country/region targeting;
- future Premium perks without changing the subscription data model.

The Premium screen is available at:

`/premium`

It reads plans and the user's current subscription from Supabase rather than hard-coding the subscription state.

**Payment-provider checkout remains intentionally provider-bound.** The application must not mark a subscription active merely because a user clicked a checkout button. A trusted payment webhook/server event must establish the entitlement.

### Country/region targeting

The monetization targeting table allows commercial configuration to vary by:

- country
- region
- Premium availability
- rewarded-ad availability
- frequency cap

This is not the same thing as the matching engine's Region Credits. Region Credits remain a user-controlled gameplay resource; monetization targeting is an operator/business configuration layer.

The source product discussion describes Premium as the primary monetization model for country/region targeting. fileciteturn245file9L1218-L1246

## Monetization security

- Premium status is determined server-side.
- Subscription status must come from a trusted provider event/webhook.
- Rewarded-ad grants must be tied to provider-verified events.
- Provider event IDs are deduplicated.
- Chat Pass creation is server-side.
- Chat Pass ownership is enforced by RLS.
- Premium subscriptions are private to their owner.
- Monetization targeting is read-only to authenticated clients.
- The client cannot directly edit Premium, ad-reward, or entitlement tables.

## Provider integration boundary

This repository contains the **provider-neutral monetization layer**. External payment/ad providers require their production credentials and provider-specific webhook/SDK configuration before real money or real ad inventory can be enabled.

Required production configuration will include:

- payment provider secret/webhook secret;
- rewarded-ad provider application/ad-unit identifiers;
- server-side provider verification credentials where applicable;
- production currency/tax/business configuration;
- approved country/region availability rules.

Until those credentials are configured, the app must not pretend a payment or ad was completed.

## Product boundaries

### Step 8 owns

- Region Credits
- Chat Pass inventory
- Streak Shields
- reward catalog
- ZP redemption

### Step 9 owns

- rewarded advertising
- Premium plans/subscriptions
- commercial targeting
- trusted entitlement issuance from external providers

### Step 10 will own

- admin control over monetization configuration
- revenue dashboards
- Premium management
- ad settings
- fraud/referral abuse tooling

## Existing architecture

Steps 1–8 are completed before Step 9.

Key systems:

- Next.js + TypeScript + Tailwind
- Supabase Auth/Postgres/Realtime
- profile/privacy system
- compatibility matching
- real-time messages
- safety/report/block
- friends/profile system
- XP/ZP/levels/streaks/quests/achievements
- Region Credits
- Chat Passes
- rewards catalog and redemption

## AI handoff instructions

If another AI takes over:

1. Read this README completely.
2. Inspect the current branch and latest commit.
3. Check GitHub Actions before changing code.
4. Inspect the Step-8 reward tables/functions before changing monetization entitlements.
5. Never grant a paid Premium entitlement from client input.
6. Never grant an ad reward merely because the browser says an ad was watched.
7. Keep payment-provider and ad-provider credentials out of Git.
8. Treat Supabase entitlement state as authoritative only after trusted server/provider verification.
9. Update this README after every meaningful Step-9 change.
10. Do not mark Step 9 complete until implementation, CI, database/RLS checks, and production-provider configuration boundaries have been reviewed.

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
9. Monetization — **current**
10. Admin
11. SEO
12. PWA/mobile preparation

## Product principles

- Privacy-first anonymous/pseudonymous social discovery.
- Safety and age compatibility come before matching preferences.
- Generation is a discovery preference, never the primary safety boundary.
- Interest matching has a configurable wait period and safe random fallback.
- Interface language and chat language are independent.
- **Never interrupt an active conversation with an advertisement.**
- Rewarded ads are opt-in exchanges for useful entitlements.
- Premium is a subscription entitlement, not a client-side flag.
- Public SEO content is separate from private conversations.
- Web is mobile-first and PWA-ready.
- Rewards should encourage meaningful activity and resist abuse.
