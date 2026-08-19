# ⚡ ShahZap

Anonymous social discovery, random chat, intelligent matching, translation, progression, rewards, monetization, moderation, SEO, and privacy-first social features.

## Build status

| Phase | Status |
|---|---|
| Steps 1–11 | ✅ Completed |
| Step 12 — PWA/mobile preparation | ✅ Implemented |
| Phase 13A — Full-system audit | ✅ Completed |
| Phase 13B — Production infrastructure | 🟡 Implementation complete; final CI/deployment runner validation pending |
| Phase 13C — Real ads & payments | 🔒 Not started |

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

### Admin rule

Ordinary users must never see an Admin button or navigation link. Database authorization remains mandatory and direct navigation must not grant access.

### PWA privacy rule

The service worker must never cache private conversations, authenticated responses, tokens, admin data, or personalized API responses.

### Provider credentials

**No real ad/payment credentials are configured in Phase 13B.** Phase 13C will add production provider secrets only after the infrastructure validation runner is green.

## Phase 13B runbook

See `docs/phase-13b-production-runbook.md` for build gates, Cloudflare configuration, Supabase security, secrets, rollback, privacy, and the Phase 13C handoff.

## Phase 13C — next

After Phase 13B passes its final CI/deployment gates, Phase 13C will handle:

- production ad provider configuration;
- rewarded-ad server verification;
- payment provider configuration;
- Premium subscription webhooks;
- payment reconciliation and entitlement verification;
- secure production secrets.

## AI handoff

If another AI takes over, read this README and `docs/phase-13b-production-runbook.md` first. Work only in the ShahZap repository. Preserve the Admin visibility rule, PWA privacy boundary, Supabase RLS/security boundaries, and the rule that payment/ad credentials remain absent until Phase 13C.

When a CI failure occurs: **identify exact failure → smallest correct fix → commit → wait for CI → inspect result → repeat until green.**

Never declare a phase green solely because code was written; the validation gate must pass.
