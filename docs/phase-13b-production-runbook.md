# Phase 13B — Production Infrastructure Runbook

## Scope

Phase 13B prepares ShahZap for production without activating real advertising or payment credentials.

## Application runtime

- Next.js + React production application
- Node.js 24 in CI/deployment validation
- Cloudflare Workers via OpenNext
- `nodejs_compat` enabled
- Cloudflare Observability enabled

## Build gates

1. `npm install --package-lock-only --ignore-scripts` (bootstrap only when the repository lockfile is absent)
2. `npm ci`
3. `npm run lint`
4. `npm run build`
5. `npm run build:cloudflare`
6. `npx wrangler deploy --dry-run`

Once a lockfile is committed, normal CI should use `npm ci` directly and must not regenerate the lockfile.

## Secrets

Never commit secrets to GitHub. Production secrets belong in the deployment platform's secret store. Do not add ad/payment credentials during Phase 13B.

Expected future secret categories include Supabase server credentials, Turnstile, ad provider verification, payment provider credentials, webhook secrets, and analytics keys.

## Supabase

- RLS enabled on application tables.
- Security Advisor must remain free of security findings.
- Privileged implementation functions live in a non-exposed schema.
- Public RPC wrappers use SECURITY INVOKER and strict authorization.
- RLS policies use `(select auth.uid())` where applicable.
- Foreign-key access paths are indexed where justified.

## Cloudflare

- `wrangler.jsonc` is the source of Worker configuration.
- `.open-next/worker.js` is the Worker entrypoint.
- `.open-next/assets` is the asset directory.
- Use dry-run validation before production deployment.
- Production deployment should be attached to an explicit protected environment with secrets configured outside Git.

## Rollback

1. Stop the production deployment.
2. Identify the last known-good commit.
3. Redeploy that commit through the protected production workflow.
4. Verify application health, authentication, chat, matching, and Supabase connectivity.
5. Record the incident and root cause before resuming releases.

## Privacy and PWA

The service worker must not cache authenticated/private responses, private chat content, tokens, admin information, or personalized API responses.

## Admin

Ordinary users must not see an Admin navigation entry. Server-side/database staff authorization remains mandatory, and manually navigating to `/admin` must never grant access.

## Phase 13C gate

Phase 13C may begin only after the Phase 13B CI/deployment gates are green. Real ad and payment credentials must then be stored as production secrets and never committed to the repository.
