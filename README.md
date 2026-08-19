# ⚡ ShahZap

Anonymous social discovery, random chat, intelligent matching, translation, progression, rewards, monetization, moderation, SEO, and privacy-first social features.

## Build status

| Phase | Status |
|---|---|
| Steps 1–11 | ✅ Completed |
| Step 12 — PWA/mobile preparation | ✅ Implemented; final CI validation carried into production hardening |
| Phase 13A — Full-system audit | ✅ Completed security/hardening audit |
| Phase 13B — Production infrastructure | 🟡 Final CI/deployment validation |
| Phase 13C — Real ads & payments | 🔒 Not started |

## Phase 13B rules

Phase 13B prepares ShahZap for production without activating real advertising or payment credentials. Provider credentials must remain deployment secrets and must never be committed to Git.

### Production stack

- Next.js 16.2.11
- React 19.2.8
- Supabase JS 2.112.1
- Supabase SSR 0.12.4
- TypeScript 5.9.3
- ESLint 10.8.0
- Node.js 24 in CI

Dependencies are pinned rather than using `latest`. CI generates a lockfile from the pinned manifest, then runs `npm ci`, lint, and the production build. A committed lockfile remains a release requirement once the first successful CI bootstrap has produced it.

### CI gate

`.github/workflows/ci.yml` validates every `main`/`feat/**` push and pull request with:

1. Node 24
2. lockfile generation from the pinned manifest
3. `npm ci`
4. `npm run lint`
5. `npm run build`

The workflow is intentionally read-only with respect to repository contents.

### Supabase production hardening

Completed in the Phase 13A/13B database passes:

- exposed application tables use RLS;
- server-owned economy/progression fields are protected from direct client mutation;
- rewarded-ad entitlement grants are not client-callable;
- privileged implementation functions are isolated from the public schema;
- public wrappers use `SECURITY INVOKER` boundaries;
- security-definer search paths are hardened;
- duplicate RLS policies/indexes identified during the audit were cleaned up;
- RLS `auth.uid()` policies were optimized with `(select auth.uid())` where applicable;
- foreign-key indexing was reviewed/addressed.

### Admin rule

Ordinary users must never see an Admin button or navigation link. Database authorization remains mandatory and direct navigation must not grant access.

### PWA privacy rule

The service worker must never cache private conversations, authenticated responses, tokens, admin data, or personalized API responses.

### Provider credentials

**No real ad/payment credentials are configured in Phase 13B.** Phase 13C will add production provider secrets only after infrastructure validation is green.

## Phase 13C — next

After Phase 13B passes its final CI/deployment gates, Phase 13C will handle:

- production ad provider configuration;
- rewarded-ad server verification;
- payment provider configuration;
- Premium subscription webhooks;
- payment reconciliation and entitlement verification;
- secure production secrets.

## Handoff / debugging rule

`identify exact failure → smallest correct fix → commit → wait for CI → inspect result → repeat until green.`

Never declare a phase green solely because code was written; the validation gate must pass.
