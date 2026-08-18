# Step 1 — Foundation Acceptance

## Scope
Step 1 establishes the application, repository, database, security baseline, responsive UI foundation, and automated validation required before identity/onboarding work begins.

## Completed deliverables
- [x] ShahZap-only repository and dedicated foundation branch.
- [x] Next.js App Router application baseline.
- [x] React + TypeScript strict configuration.
- [x] Supabase SSR/browser client foundation.
- [x] Session refresh middleware foundation.
- [x] Responsive public landing page shell.
- [x] ShahZap design tokens, typography, surfaces, buttons, cards, responsive breakpoints.
- [x] Environment-variable template with no secrets committed.
- [x] Supabase migration tracked in the repository.
- [x] Core relational tables for profiles, interests, preferences, blocks, friends, conversations, messages, reports, rewards, passes, referrals, and admin settings.
- [x] Core indexes and updated-at triggers.
- [x] RLS enabled across all Step 1 application tables.
- [x] Realtime publication configured for messages.
- [x] Initial interests and product configuration seeded.
- [x] CI workflow for install, lint, and production build.
- [x] Product and implementation documentation.

## Database verification
The connected Supabase project was queried after the foundation migration. All 14 Step 1 application tables exist and RLS is enabled on each. Policy counts were also inspected for every table.

## Validation note
The repository CI workflow is configured to run `npm install`, `npm run lint`, and `npm run build` on pushes and pull requests. The execution environment used by the assistant cannot resolve external GitHub hosts, so a local npm build could not be executed from this environment. The CI workflow is therefore the authoritative executable validation path and must be green before merge.

## Gate for Step 2
Step 2 may begin only after the foundation branch is reviewed and the CI workflow reports a successful lint/build run. No Step 2 application feature is included in this branch beyond foundation-level plumbing.
