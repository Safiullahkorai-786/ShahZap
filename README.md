# ⚡ ShahZap

Anonymous social discovery, random chat, intelligent matching, translation, progression, rewards, monetization, moderation, SEO, and privacy-first social features.

## Build status

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
| 10 | Admin | ✅ Completed |
| 11 | SEO | 🔄 In progress |
| 12 | PWA/mobile preparation | ⏳ Not started |

## Current branch

`feat/step-11-seo`

## Step 11 — SEO

The product specification defines Step 11 as **public pages, metadata, sitemap, structured data, and blog**. fileciteturn254file0L49-L55

### SEO architecture

SEO is deliberately separated from the authenticated application. Private areas such as chats, matching, friends and progression are not included in the public sitemap and are disallowed for crawlers.

The source product discussion explicitly recommends a public SEO layer rather than indexing private conversations. fileciteturn254file7L990-L1012

### Public routes

Implemented public content routes include:

- `/`
- `/random-chat`
- `/anonymous-chat`
- `/chat-with-strangers`
- `/gender-chat`
- `/country-chat`
- `/translate-chat`
- `/meet-new-people`
- `/how-it-works`
- `/safety`
- `/privacy`
- `/faq`
- `/about`
- `/blog`

These correspond to the public information architecture discussed in the product specification. fileciteturn254file3L318-L334

### Metadata

The public layout provides:

- descriptive page titles
- descriptions
- canonical URLs
- Open Graph metadata
- Twitter metadata
- ShahZap site/application identity

The homepage is written as actual useful content rather than only a Start Chatting button. The source specification explicitly calls for human-readable homepage content explaining anonymous discovery, worldwide connections, matching, translation, safety and rewards. fileciteturn254file8L1136-L1161

### Sitemap

Next.js `sitemap.ts` generates `/sitemap.xml` containing only public SEO routes.

Private routes are intentionally excluded.

### Robots

Next.js `robots.ts` generates `/robots.txt`.

It allows public content and disallows private application areas including:

- `/app`
- `/chat`
- `/matching`
- `/friends`
- `/profile`
- `/progression`
- `/rewards`
- `/premium`
- `/admin`
- `/api/`

The admin route is especially important: **ordinary users should never see an admin button/link, and search engines should not discover the admin interface through the public SEO layer.** Authorization remains server/database enforced separately from robots rules.

### Structured data

Added a reusable JSON-LD component and public `WebSite` + `WebApplication` structured data.

We intentionally do not generate fake structured data for every page. The source plan explicitly says to use Schema.org types where they actually apply and avoid fake rich-result markup. fileciteturn254file2L232-L240

### Blog

`/blog` is included as a public educational entry point. Initial content focuses on genuine ShahZap topics such as online safety, pseudonymous chat, and cross-language communication.

The architecture is intentionally content-first rather than generating thousands of near-identical keyword pages. The product specification warns against doorway/scaled-content patterns. fileciteturn254file9L1325-L1356

### Search Console

The application exposes the sitemap required for later Google Search Console submission:

`https://shahzap.com/sitemap.xml`

Actual Search Console ownership/verification and domain submission remain deployment/ownership tasks and are not faked in source code.

### Performance principles

Public SEO pages should remain lightweight and mobile-first. The source plan specifically identifies LCP, INP and CLS as important performance considerations and rejects unnecessarily heavy homepage media. fileciteturn254file8L1125-L1135

## Admin visibility rule

The `/admin` page is never part of normal navigation. It must remain invisible to ordinary users.

There are two separate protections:

1. **UI visibility** — ordinary users receive no Admin button/link.
2. **Authorization** — the database staff check rejects non-staff users even if they manually enter `/admin`.

Robots rules are only an additional crawl-control layer; they are not security.

## Existing architecture

Steps 1–10 are completed before Step 11.

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
- protected admin/moderation system
- public SEO layer

## AI handoff instructions

If another AI takes over:

1. Read this README completely.
2. Inspect the current branch and latest commit.
3. Check GitHub Actions before changing code.
4. Keep private application routes out of the sitemap.
5. Never expose admin navigation to ordinary users.
6. Never treat robots.txt as an authorization mechanism.
7. Preserve canonical metadata and public content quality.
8. Do not create mass low-value keyword pages.
9. Update this README after meaningful Step-11 changes.
10. Do not mark Step 11 complete until SEO routes, metadata, sitemap, robots, structured data, build and CI are green.

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
10. Admin — completed
11. SEO — **current**
12. PWA/mobile preparation
