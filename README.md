# ⚡ ShahZap

Anonymous social discovery, random chat, intelligent matching, translation, progression, rewards, monetization, moderation, SEO, and privacy-first social features.

## Build status

| Phase | Status |
|---|---|
| Steps 1–11 | ✅ Completed |
| Step 12 — PWA/mobile preparation | ✅ Implemented |
| Phase 13A — Full-system audit | ✅ Completed |
| Phase 13B — Production infrastructure | 🟡 Implementation complete; final CI/deployment runner validation pending |
| Phase 13C-1 — Provider architecture | ✅ Complete |
| Phase 13C-2 — Production secrets/provider configuration | 🔒 Not started |

## Phase 13B

Phase 13B prepares ShahZap for production without activating real advertising or payment credentials. Provider credentials must remain deployment secrets and must never be committed to Git.

### Production stack

- Next.js 16.2.11
- React 19.2.8
- Supabase JS 2.112.1
- Supabase SSR 0.12.4
- TypeScript 5.9.3
- ESLint 10.8.0
- Node.js 24 in CI
- Cloudflare Workers + OpenNext
- Wrangler 4.86.0
- Cloudflare Observability

### CI/deployment gates

`.github/workflows/ci.yml` validates:

1. Node 24
2. lockfile bootstrap when needed
3. `npm ci`
4. `npm run lint`
5. `npm run build`

`.github/workflows/cloudflare.yml` additionally validates:

6. `npm run build:cloudflare`
7. `npx wrangler deploy --dry-run`

Once a lockfile is committed, normal CI must use `npm ci` without changing dependency resolution.

### Supabase production hardening

- exposed application tables use RLS;
- server-owned economy/progression fields are protected from direct client mutation;
- rewarded-ad entitlement grants are not client-callable;
- privileged implementations are isolated from the public schema;
- public wrappers use `SECURITY INVOKER` boundaries;
- security-definer search paths are hardened;
- duplicate RLS policies/indexes identified during the audit were cleaned up;
- RLS `auth.uid()` policies were optimized with `(select auth.uid())` where applicable;
- foreign-key indexing was reviewed/addressed;
- Supabase Security Advisor was brought to zero security findings.

## Phase 13C — Ads & Payments

### 13C-1 — Provider architecture

**Complete.** The architecture is documented in `docs/phase-13c-1-provider-architecture.md`.

The design uses provider-independent server adapters. Provider-specific credentials and product IDs are configuration, not business logic.

The existing ShahZap database already provides the intended monetization persistence boundaries:

- `ad_reward_events`
- `chat_passes`
- `premium_subscriptions`
- `reward_ledger`
- `reward_redemptions`

Core rules:

- a client request never grants a reward;
- rewarded ads are verified server-side;
- a verified rewarded event grants at most one configured 30-minute Chat Pass;
- payment webhooks are verified server-side;
- Premium state comes from verified provider events, not client claims;
- external events are idempotent;
- provider product/price IDs are server-controlled;
- active conversations are never interrupted by advertisements;
- secrets never enter source control, client bundles, plaintext database fields, or logs.

**No provider has been hard-coded at 13C-1 because the repository/context does not establish a definitive provider choice.** The provider credentials/products supplied for ShahZap will be mapped to these contracts in 13C-2.

### 13C-2 — Next

Production provider configuration will be added only after the provider credentials/products are supplied and mapped to the architecture above.

This step will configure:

- ad verification credentials;
- rewarded-ad server verification;
- payment API credentials;
- webhook signing secret;
- Premium product mapping;
- secure deployment secrets.

## Admin rule

Ordinary users must never see an Admin button or navigation link. Database authorization remains mandatory and direct navigation must not grant access.

## PWA privacy rule

The service worker must never cache private conversations, authenticated responses, tokens, admin data, or personalized API responses.

## AI handoff

If another AI takes over, read this README, `docs/phase-13b-production-runbook.md`, and `docs/phase-13c-1-provider-architecture.md` first. Work only in the ShahZap repository. Preserve the Admin visibility rule, PWA privacy boundary, Supabase RLS/security boundaries, and the rule that payment/ad credentials are added only through production secret storage.

When a CI failure occurs: **identify exact failure → smallest correct fix → commit → wait for CI → inspect result → repeat until green.**
