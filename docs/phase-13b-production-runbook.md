# Phase 13B — Production Runbook

## Purpose

Prepare ShahZap for controlled staging and production deployment without activating real ads or payments.

## 1. Cloudflare

### Runtime

- Next.js is deployed through `@opennextjs/cloudflare`.
- Worker config is `wrangler.jsonc`.
- OpenNext config is `open-next.config.ts`.
- Worker compatibility date is pinned in Wrangler config.
- `nodejs_compat` is enabled.
- Workers observability is enabled.

Cloudflare's current Next.js guidance uses OpenNext for Workers deployments and recommends previewing the application in the Workers runtime before deployment.

### Required repository secrets

GitHub environment secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The deploy token must have only the permissions required to deploy the ShahZap Worker. Do not use a global account credential when a scoped token is possible.

### Workflows

- `.github/workflows/cloudflare-preview.yml` validates build + Wrangler dry run on relevant pull requests/manual runs.
- `.github/workflows/cloudflare-deploy.yml` is manual and requires an explicit `staging` or `production` environment.

Production deployment is intentionally not automatic in Phase 13B.

## 2. Supabase

Current project is healthy and located in `ap-southeast-2`.

Before production release:

- confirm the intended production project;
- confirm migrations are complete and ordered;
- review security advisors;
- verify RLS on all exposed tables;
- verify Edge Functions and scheduled jobs;
- verify Auth redirect URLs and site URL;
- configure production secrets outside Git;
- document backup and restore procedure;
- perform a restore drill before launch.

Never expose the Supabase service-role key to browser code.

## 3. Domain, DNS and TLS

Production checklist:

- add the ShahZap domain to Cloudflare;
- verify authoritative nameservers;
- create required DNS records;
- proxy web traffic through Cloudflare;
- verify Universal SSL certificate coverage;
- configure end-to-end HTTPS to the origin;
- redirect HTTP to HTTPS;
- verify canonical host redirects;
- add HSTS only after confirming all intended subdomains are HTTPS-safe.

Do not enable irreversible DNS/security changes without verifying the staging hostname first.

## 4. Environment separation

Use separate GitHub environments:

- `staging`
- `production`

Never share production secrets with local development or preview environments.

`.dev.vars` and `.env*` are gitignored. `.dev.vars.example` contains names/placeholders only.

## 5. Observability

Cloudflare Workers Logs/Observability should be enabled for the deployed Worker.

Monitor:

- request count
- 4xx/5xx rate
- latency
- CPU/wall time
- uncaught exceptions
- deployment errors
- Supabase API/Auth/Postgres/Realtime errors

Never log:

- access tokens
- refresh tokens
- service-role keys
- payment secrets
- webhook signatures
- private message bodies
- sensitive profile fields

## 6. Backup and recovery

The release owner must maintain:

1. database backup schedule;
2. migration history in Git;
3. recovery credentials stored outside Git;
4. documented restore steps;
5. a tested staging restore before production launch.

Acceptance test:

- restore a recent backup into an isolated environment;
- apply/verify migrations;
- verify RLS and Auth configuration;
- verify the application can read/write expected data;
- record recovery duration and any manual steps.

## 7. Abuse controls

The following need explicit limits before public launch:

| Surface | Control | Acceptance criterion |
|---|---|---|
| Auth | edge/API rate limit | repeated failures are throttled |
| Matching | per-user request limit | automated matching spam is rejected |
| Messages | send-frequency limit | burst spam is throttled |
| Reports | per-user creation limit | report flooding is throttled |
| Friend requests | per-user pending/request limit | social graph abuse is constrained |
| Reward redemption | transactional server checks + rate limit | repeated redemption cannot duplicate rewards |
| Rewarded ads | trusted provider verification | client cannot mint entitlements |
| Admin | staff authorization + audit log | ordinary users cannot perform staff actions |

Database transactions remain authoritative for economy and entitlement state; edge rate limits are an abuse-control layer, not the source of truth.

## 8. Release order

1. Staging secrets/configuration.
2. Cloudflare Workers preview.
3. Supabase security review.
4. Restore drill.
5. DNS/TLS verification on staging.
6. Observability verification.
7. Abuse-control verification.
8. Production environment secrets.
9. Manual production deployment.
10. Smoke test.
11. Monitor before increasing traffic.

## 9. Explicitly deferred

Do not activate real:

- ad provider credentials;
- rewarded-ad provider verification;
- payment provider credentials;
- subscription webhooks;
- payment reconciliation.

Those belong to Phase 13C.
