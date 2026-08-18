# ⚡ ShahZap

Anonymous social discovery, random chat, intelligent matching, translation, progression, rewards, monetization, moderation, SEO, and privacy-first social features.

## Current production-hardening status

**Phase 13A — Full-System Audit: 🟡 CI verification in progress**

Steps 1–12 are the completed implementation roadmap. Phase 13A is the post-roadmap security and production audit before infrastructure setup and real provider activation.

### Phase 13A gates

- Authentication/session boundaries — reviewed
- Supabase RLS and privileged RPC authorization — reviewed and hardened
- Matching integrity — reviewed
- Realtime chat privacy — reviewed
- Translation boundaries — reviewed
- Safety/report/block/moderation — reviewed
- Social/profile privacy — reviewed and hardened
- Gamification economy — reviewed and hardened
- Rewards/entitlements — reviewed and hardened
- Premium/rewarded-ad boundaries — reviewed and hardened
- Admin visibility/authorization — reviewed and hardened
- SEO/private-route isolation — reviewed
- PWA/service-worker privacy — reviewed
- Dependency reproducibility — modernized; GitHub lockfile/CI verification pending
- Production lint/build — CI verification pending

### Security rules

- Ordinary users must never see an Admin button or navigation item.
- `/admin` is protected by staff authorization; entering the URL does not grant access.
- Production ad/payment credentials must never be committed to Git.
- Rewarded-ad entitlements must only be granted after trusted provider verification; client calls cannot manufacture Chat Passes.
- Server-owned economy/progression fields cannot be directly modified through the client profile API.
- Friend-request participants and valid status transitions are enforced at the database layer.
- Private conversations, authenticated data, tokens, and admin data must never be placed in the PWA offline cache.

### Modernized production stack

Core dependencies are pinned instead of using floating `latest` versions:

- Next.js `16.2.11`
- React `19.2.8`
- React DOM `19.2.8`
- Supabase JS `2.112.1`
- Supabase SSR `0.12.4`
- ESLint `10.8.0`
- TypeScript `5.9.2`
- Node.js `24` in GitHub Actions

The production CI workflow uses `npm ci` once `package-lock.json` is present. A bootstrap workflow is configured to generate the lockfile on GitHub because this repository previously had no lockfile.

### CI verification procedure

`identify exact failure → smallest correct fix → commit → wait for CI → inspect result → repeat until green.`

The lockfile, lint, and production build must actually pass in GitHub Actions before Phase 13A is declared green.

## Roadmap after Phase 13A

### Phase 13B — Production infrastructure

- production domain/DNS
- Cloudflare configuration
- Supabase production configuration
- deployment environment/secrets
- backups/recovery
- logging/monitoring
- rate limits/abuse protection
- error tracking

### Phase 13C — Real provider activation

Only after the audit and infrastructure gates pass:

- production ad provider
- trusted rewarded-ad verification
- payment provider
- subscription webhooks
- payment reconciliation

### Phase 13D — Launch readiness

- legal/privacy/terms review
- safety/age policy review
- moderation operations
- support/contact flows
- analytics
- Search Console
- performance tests
- staging-to-production checklist

### Phase 13E — Controlled launch and iteration

- beta rollout
- monitor abuse and retention
- balance rewards economy
- monitor infrastructure cost
- fix production issues
- prioritize improvements from real usage

## AI handoff instructions

If another AI takes over:

1. Read this README completely.
2. Inspect `feat/phase-13a-audit` and the latest CI result.
3. Do not declare Phase 13A green until GitHub Actions proves the locked install, lint, and production build pass.
4. Review `docs/phase-13a-audit.md` for the findings history.
5. Never commit production credentials.
6. Preserve the Admin visibility rule.
7. Keep private data out of service-worker caches.
8. Update this README after major production-hardening decisions.
