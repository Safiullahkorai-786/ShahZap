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
| 11 | SEO | ✅ Completed |
| 12 | PWA/mobile preparation | 🔄 In progress |

## Current branch

`feat/step-12-pwa`

## Step 12 — PWA / Mobile Preparation

Step 12 is the final roadmap phase in the original 12-step build plan. It prepares ShahZap to behave like a mobile-first installable web application without prematurely creating separate native iOS/Android applications.

### Implemented

- `public/manifest.webmanifest`
  - app name and short name
  - standalone display mode
  - portrait orientation
  - theme/background colors
  - installable web-app metadata
- `src/app/icon.svg`
  - ShahZap application icon
- `src/app/layout.tsx`
  - manifest metadata
  - theme color
  - application icon
- `public/sw.js`
  - minimal service worker
  - install/activate lifecycle
  - same-origin GET fallback
  - offline fallback to cached homepage
- `src/components/PwaRegister.tsx`
  - browser-side service-worker registration
  - HTTPS-only registration

### Security boundary

The service worker must not cache private conversations, authenticated user data, tokens, admin data, or personalized API responses. The current implementation only provides a minimal shell fallback and does not turn private ShahZap data into an offline cache.

### Mobile-first rule

PWA work does not replace responsive web design. All existing application flows remain web-first and responsive. Native mobile applications should only be created later if product usage justifies them.

## Admin visibility rule

The Admin area remains invisible to ordinary users:

1. no normal navigation link/button;
2. database staff authorization remains mandatory;
3. `/admin` remains excluded from SEO/sitemap/crawling;
4. manually entering `/admin` does not grant access.

PWA installation does not change this rule.

## Provider credentials

Production ad/payment provider credentials are deliberately not committed to Git. They will be configured as deployment secrets when the complete product is ready for real monetization activation.

## Validation requirements for Step 12

Before Step 12 is marked complete:

- TypeScript/build must pass.
- CI must be green.
- Manifest must be reachable.
- Service worker must register only in a secure browser context.
- No private/authenticated data may be added to the offline cache.
- Existing authenticated routes must continue working normally.
- Admin visibility/authorization must remain intact.
- README must be updated with final implementation and handoff details.

## What comes after Step 12?

The original 12-step implementation roadmap ends with Step 12. That means the next phase should **not** be another arbitrary feature number. It should be a **post-roadmap production hardening and launch phase**.

Recommended order after Step 12:

### Phase 13A — Full-system audit

- review Steps 1–12 together
- verify database schema and RLS
- test auth/session edge cases
- test matching/safety/chat flows
- test rewards/economy integrity
- test monetization boundaries
- test admin authorization
- verify SEO/private-route separation
- verify PWA behavior

### Phase 13B — Production infrastructure

- production domain/DNS
- Cloudflare configuration
- Supabase production configuration
- environment variables/secrets
- backups and recovery
- logging/monitoring
- rate limits and abuse protection
- error tracking

### Phase 13C — Real provider activation

Only after the core product passes the audit:

- production ad provider
- rewarded-ad server verification
- payment provider
- subscription webhooks
- payment reconciliation
- App Store/Play Store accounts if native apps are later created

### Phase 13D — Launch readiness

- legal/privacy/terms review
- age/safety policy review
- moderation operations
- support/contact flows
- analytics
- Search Console
- production performance tests
- staging-to-production release checklist

### Phase 13E — Launch + iteration

- controlled beta
- monitor abuse and retention
- balance rewards economy
- monitor infrastructure costs
- fix production issues
- prioritize improvements from real usage

## AI handoff instructions

If another AI takes over:

1. Read this README completely.
2. Inspect `feat/step-12-pwa` and the latest CI result.
3. Do not declare Step 12 complete until the validation requirements above are green.
4. Do not start Phase 13 until Step 12 is complete.
5. After Step 12, use the post-roadmap phases documented here rather than inventing a new feature roadmap.
6. Never commit production credentials.
7. Preserve the Admin visibility rule.
8. Keep private data out of service-worker caches.
9. Update this README after every major production-hardening decision.

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
11. SEO — completed
12. PWA/mobile preparation — **current**
13. Production hardening & launch — next after Step 12
