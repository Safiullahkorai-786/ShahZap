# ⚡ ShahZap

Anonymous social discovery, random chat, intelligent matching, translation, progression, rewards, monetization, moderation, SEO, and privacy-first social features.

## Build status

| Phase | Status |
|---|---|
| Steps 1–11 | ✅ Completed |
| Step 12 — PWA/mobile preparation | ✅ Implemented |
| Phase 13A — Full-system audit | ✅ Completed |
| Phase 13B — Production infrastructure | ✅ Build & lint passing |
| Phase 13C-1 — Provider architecture | ✅ Complete |
| Phase 13C-2 — Production secrets/provider configuration | 🟡 Implemented (see Phase 13C Implementation section) |

## Fixes Applied (by opencode/mimo-v2-free)

The following issues were identified and fixed across all branches:

### Before (broken)
- **Build failure**: Invalid TypeScript syntax in `src/app/api/webhooks/paddle/route.ts` — `{ [key:]: unknown }` (missing key type `string`)
- **Build failure**: Broken `PaddleWebhookEvent` type — trailing `|` before comment caused parse error in `src/lib/providers/paddle.ts`
- **Build failure**: Stray `*` character outside comment block in `paddle.ts`
- **Build failure**: `NextRequest` imported from `next/navigation` instead of `next/server`
- **Build failure**: `createClient` imported from `@supabase/ssr` instead of `createServerClient`
- **Build failure**: `createClient` imported from `@/lib/supabase/server` (function is exported as `createSupabaseServerClient`)
- **Build failure**: Module-level `throw` for missing env vars prevented build-time page generation
- **Build failure**: `createServerClient` from `@supabase/ssr` requires 3 arguments (url, key, cookies options)
- **Build failure**: `durationDays` used in arithmetic but typed as `unknown`
- **Build failure**: `eventStatus === 'active'` but status type didn't include `'active'`
- **Build failure**: Duplicate type exports (`export type { ... }` after `export type ... = ...`)
- **Lint failure**: `eslint.config.mjs` imported `eslint-config-next/core-vitals` which doesn't exist (should be `core-web-vitals`)
- **Lint failure**: `eslint-plugin-react@7.37.5` incompatible with ESLint 10 (uses removed `getFilename` API)
- **Lint error**: `@typescript-eslint/no-explicit-any` in `paddle-checkout.tsx`
- **Lint warnings**: Multiple unused variables across `adsterra-reward.tsx`, `paddle-checkout.tsx`, `adsterra.ts`
- **Warning**: `themeColor` in metadata export (Next.js 16 wants it in `viewport` export)

### After (fixed)
- All TypeScript syntax errors corrected
- All import paths fixed to match actual package exports
- Module-level env var checks deferred to runtime (function-based)
- ESLint config fixed (`core-web-vitals`, removed incompatible `eslint-plugin-react` direct import)
- ESLint downgraded to v9 for compatibility with `eslint-config-next@16.2.11`
- `any` types replaced with proper types (`unknown` + `instanceof Error` checks)
- Unused variables removed or prefixed with `_`
- `themeColor` moved to `viewport` export
- **Build: ✅ passing** | **Lint: ✅ 0 errors**

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

## Phase 13C Implementation

### Overview
Phase 13C adds production-grade ads and payments to ShahZap using two external providers:

- **Paddle** — payment processor for Premium subscriptions.
- **Adsterra** — ad network for rewarded advertisements that grant 30-minute Chat Passes.

All provider credentials are configured as deployment secrets (never committed to Git). The implementation consists of:

1. **Provider adapters** (`src/lib/providers/paddle.ts`, `src/lib/providers/adsterra.ts`) that implement the Phase 13C-1 adapter contracts (`createCheckout`, `verifyReward`, `grantReward`, `verifyWebhook`, `processWebhook`).
2. **Webhook handler** (`app/api/webhooks/paddle/route.ts`) that verifies Paddle webhook signatures, checks idempotency, upserts `premium_subscriptions`, and logs to `reward_ledger`.
3. **Frontend components** (`components/paddle-checkout.tsx`, `components/adsterra-reward.tsx`) that expose the monetization flows to users while keeping all sensitive operations server-side.
4. **Environment variables** (`.env.example`) listing all required placeholders.

### Environment Variables (Production)
All secrets belong in the deployment platform's secret store — never in Git:

| Variable | Purpose | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase super key | ✅ |
| `NEXT_PUBLIC_APP_URL` | Application base URL | ✅ |
| `PADDLE_VENDOR_ID` | Paddle vendor ID | ✅ |
| `PADDLE_API_KEY` | Paddle API key | ✅ |
| `PADDLE_WEBHOOK_SECRET` | Webhook signature verification secret | ✅ |
| `PADDLE_PREMIUM_MONTHLY_PRICE_ID` | Paddle price ID for monthly premium | ✅ |
| `PADDLE_PREMIUM_YEARLY_PRICE_ID` | Paddle price ID for yearly premium | ✅ |
| `ADSTERRA_ZONE_ID` | Adsterra zone ID for rewarded ads | ✅ |

### Webhook Configuration
After deploying, configure the Paddle webhook URL in your Paddle dashboard:

```
https://<your-domain>/api/webhooks/paddle
```

The webhook must be enabled for `purchase` and `subscription_created` events with `status=completed`. Paddle will POST the event payload to this URL; the handler verifies the signature using `PADDLE_WEBHOOK_SECRET` and updates Premium entitlement server-side.

### Security Rules Preserved
- **Client never grants rewards**: All Chat Pass and Premium grants are server-side only.
- **Webhook signatures verified**: Paddle signature must match `PADDLE_WEBHOOK_SECRET`; invalid signatures return 401.
- **Idempotent processing**: Paddle event IDs are deduped via `reward_ledger` checks; duplicate events are no-oped.
- **Rate-limited ad rewards**: 1 Chat Pass per 30 minutes per user (enforced server-side via `chat_passes` query).
- **No secrets in client bundle**: Paddle API keys and Adsterra zone ID are loaded only on the server; the client never sees secret values.
- **Premium state from verified events only**: Client claims of payment success are never sufficient; state comes from verified Paddle webhook events.

### Adsterra Rate Limiting
- 1 Chat Pass per 30 minutes per user, enforced server-side.
- The `isRateLimited()` and `grantReward()` functions check `chat_passes` for an active/adsterra pass before granting a new one.
- If the user already has an available or active adsterra pass, the grant is a no-op (per the architecture rule: "Repeated provider event → zero additional reward").

## AI handoff

If another AI takes over, read this README, `docs/phase-13b-production-runbook.md`, and `docs/phase-13c-1-provider-architecture.md` first. Work only in the ShahZap repository. Preserve the Admin visibility rule, PWA privacy boundary, Supabase RLS/security boundaries, and the rule that payment/ad credentials are added only through production secret storage.

When a CI failure occurs: **identify exact failure → smallest correct fix → commit → wait for CI → inspect result → repeat until green.**
