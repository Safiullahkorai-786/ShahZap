# ⚡ ShahZap

Anonymous social discovery, random chat, intelligent matching, translation, progression, rewards, monetization, moderation, SEO, and privacy-first social features.

## Current production-hardening status

**Phase 13A — Full-System Audit: ✅ Completed**

**Phase 13B — Production Infrastructure: 🟡 In progress**

Steps 1–12 are the completed implementation roadmap. Phase 13A audited those systems together. Phase 13B now prepares the application for controlled staging/production deployment without activating real ad/payment providers yet.

## Phase 13A security baseline

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
- Dependency reproducibility — pinned production stack

## Security rules

- Ordinary users must never see an Admin button or navigation item.
- `/admin` is protected by staff authorization; entering the URL does not grant access.
- Production ad/payment credentials must never be committed to Git.
- Rewarded-ad entitlements must only be granted after trusted provider verification; client calls cannot manufacture Chat Passes.
- Server-owned economy/progression fields cannot be directly modified through the client profile API.
- Friend-request participants and valid status transitions are enforced at the database layer.
- Private conversations, authenticated data, tokens, and admin data must never be placed in the PWA offline cache.

## Modernized production stack

Core dependencies are pinned instead of using floating `latest` versions:

- Next.js `16.2.11`
- React `19.2.8`
- React DOM `19.2.8`
- Supabase JS `2.112.1`
- Supabase SSR `0.12.4`
- ESLint `10.8.0`
- TypeScript `5.9.2`
- Node.js `24` in GitHub Actions
- Cloudflare OpenNext `1.19.11`
- Wrangler `4.86.0`

## Phase 13B — Production Infrastructure

### Cloudflare runtime

ShahZap is prepared for the current Cloudflare Workers + OpenNext deployment path for Next.js. Cloudflare's current guidance supports App Router, SSR, RSC, Route Handlers, streaming, Server Actions and other core Next.js features through the OpenNext adapter. citeturn0search1turn2search0

Files added:

- `wrangler.jsonc`
  - Worker entrypoint: `.open-next/worker.js`
  - static assets: `.open-next/assets`
  - `nodejs_compat`
  - compatibility date `2026-08-19`
  - Cloudflare observability enabled
- `open-next.config.ts`
- `.dev.vars.example`
- `public/_headers`
- `.gitignore` protection for local secrets and Cloudflare build artifacts

### Cloudflare commands

- `npm run preview` — build and preview in the Workers runtime
- `npm run deploy` — build and deploy to Cloudflare
- `npm run upload` — build and upload a version
- `npm run cf-typegen` — generate Cloudflare environment types

Cloudflare recommends testing with the Workers runtime rather than relying only on the Node development server because production runs on `workerd`. citeturn0search1

### Observability

Workers Logs and observability are enabled in the Worker configuration. Cloudflare currently provides invocation logs, errors, metrics, traces, real-time logs, and OpenTelemetry export options. citeturn0search0turn0search2turn0search6

We will not log message bodies, auth tokens, payment credentials, or other private user content.

### Domain / DNS / TLS gate

Before production activation:

1. Connect the ShahZap domain to Cloudflare.
2. Verify DNS records and proxying.
3. Use end-to-end HTTPS.
4. Redirect HTTP to HTTPS.
5. Enable appropriate TLS minimums/HSTS after verifying all subdomains.
6. Verify certificate coverage.

Cloudflare's current HTTPS guidance recommends encrypting both visitor→Cloudflare and Cloudflare→origin connections. citeturn0search12turn0search11

### Secrets

Never commit `.dev.vars`, `.env`, production API keys, service-role keys, payment secrets, ad secrets, or webhook signing secrets.

Local development uses `.dev.vars` based on `.dev.vars.example`.

Production secrets must be configured through the deployment platform's secret/environment mechanism. Cloudflare recommends secrets rather than hardcoding credentials in Wrangler configuration. fileciteturn104file0

### Supabase production baseline

Current Supabase project:

- region: `ap-southeast-2`
- PostgreSQL 17
- status: active/healthy
- RLS remains enabled across the exposed application tables

Supabase security advisors must be reviewed after infrastructure/database changes. Any new security warning must be triaged before production release.

### Backups / recovery

Phase 13B must establish:

- database backup policy
- recovery procedure
- migration history discipline
- environment separation
- restore verification

No production launch is considered complete until a recovery path has been tested.

### Rate limits / abuse protection

Before public launch we need explicit limits for:

- authentication attempts
- matching requests
- message sending
- report creation
- friend requests
- reward redemption
- rewarded-ad entitlement requests
- admin/moderation actions

The database remains authoritative for economy/security state; edge rate limiting is an additional abuse-control layer.

### Provider boundary

Real ads and payments remain **disabled** during Phase 13B.

Phase 13C will handle:

- real ad provider
- rewarded-ad verification
- payment provider
- subscription webhooks
- payment reconciliation

No production provider secret belongs in this repository.

## Phase 13B completion gates

Phase 13B is not complete until:

- Cloudflare deployment configuration is validated in a Workers preview.
- Production/staging environment variables are documented and separated.
- Domain/DNS/TLS configuration is verified.
- Supabase production configuration is reviewed.
- Backup/recovery procedure is documented and tested.
- Logging/observability is verified without leaking private data.
- Rate-limit/abuse-control plan is implemented or explicitly staged with acceptance criteria.
- CI/build and Cloudflare preview pass.
- README is updated with the final infrastructure handoff.

## CI/debug process

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
12. PWA/mobile preparation — completed
13A. Full-system audit — completed
13B. Production infrastructure — **current**
13C. Real ad/payment provider activation — next
13D. Launch readiness — after 13C
13E. Controlled launch and iteration — final

## AI handoff instructions

If another AI takes over:

1. Read this README completely.
2. Work only on the ShahZap repository.
3. Work phase-by-phase; never skip a failed gate.
4. Inspect `docs/phase-13a-audit.md` before changing security-sensitive code.
5. Validate Cloudflare preview before production deployment.
6. Never commit production credentials.
7. Preserve the Admin visibility rule.
8. Keep private data out of service-worker caches and observability logs.
9. Do not activate real ads/payments before Phase 13C.
10. Update this README after every major infrastructure decision.
