# ShahZap Product Specification

## Status
Step 1 — Foundation specification and repository baseline.

## Product vision
ShahZap is a privacy-first anonymous/pseudonymous social discovery product centered on random one-to-one chat, intelligent matching, translation, gamified progression, rewards, geographic targeting, and strong moderation.

## Core principles
- Safety and age compatibility come before matching preferences.
- Generation is a discovery preference, never the primary safety boundary.
- Interest matching has a configurable wait period and a safe random fallback.
- Interface language and chat language are independent.
- Active conversations are never interrupted by advertisements.
- Public SEO content is separate from private conversations.
- Web is mobile-first and PWA-ready.
- Rewards should encourage meaningful activity and resist abuse.

## Matching order
1. Safety compatibility
2. Age compatibility
3. Gender preferences
4. Orientation preferences
5. Exclusions / blocks
6. Language compatibility
7. Generation preference
8. Interests
9. Country / region targeting
10. Safe random fallback

## Privacy
Users can separately control visibility of avatar, gender, age band, generation, interests, country, and online status. Exact age is not displayed.

## Languages
The UI language and preferred chat language are separate. Translation must preserve the original message and store a translated representation rather than replacing the original.

## Social
Users can add friends after conversations and block users. Persistent friend messaging is a later milestone.

## Trust and safety
Required foundations include reporting, moderation, rate limiting, anti-bot protection, blocked-user matching prevention, spam detection, suspicious-account controls, and temporary moderation retention where legally appropriate.

## Progression economy
- XP: progression metric.
- Zap Points: spendable profile/convenience resource.
- Region Credits: geographic targeting resource.
- Time Passes: temporary entitlements such as ad-free Chat Passes.

## Chat Pass
Preferred model: a voluntary rewarded ad grants a 30-minute Chat Pass for a new session. Active conversations are never interrupted by advertisements. Server-side entitlement state prevents refresh/tab manipulation.

## Referrals
A referral should reward meaningful activity, not simple account creation. Exact milestone and anti-abuse rules remain configurable.

## SEO
Public server-rendered pages such as home, random chat, anonymous chat, how-it-works, safety, privacy, FAQ, and blog can be indexed. Private conversations must never be exposed for indexing.

## Architecture direction
- Web-first and responsive.
- PWA-ready.
- Backend designed for later Android/iOS clients.
- Supabase/Postgres for core data and realtime capabilities.
- Cloudflare for edge/security capabilities.
- Privileged secrets and operations remain server-side.

## Build phases
1. Foundation
2. Identity and onboarding
3. Matching
4. Realtime chat
5. Trust and safety
6. Gamification
7. Monetization and referrals
8. Admin
9. SEO/PWA
10. Mobile clients

A phase is complete only when its planned deliverables and acceptance checks are complete. Do not advance to the next phase while a required deliverable from the current phase is unfinished.
