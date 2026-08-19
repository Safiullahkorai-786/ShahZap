# Phase 13C-1 — Provider Architecture

## Status

**COMPLETE — architecture defined; no live provider credentials configured.**

## Goal

Create a provider-independent monetization boundary before any production keys are added. ShahZap must be able to change an ad or payment provider without changing entitlement rules, economy rules, or client trust boundaries.

## Existing ShahZap monetization model

The product specification defines:

- voluntary rewarded ads;
- a rewarded ad grants a 30-minute Chat Pass for a new session;
- active conversations are never interrupted by advertisements;
- entitlement state is server-side;
- XP, Zap Points, Region Credits, and temporary passes are part of the server-owned economy;
- Premium is a separate entitlement.

The current database already contains `ad_reward_events`, `chat_passes`, `premium_subscriptions`, `reward_ledger`, and `reward_redemptions`. These are the persistence boundaries for the provider integrations.

## Architecture

```text
Browser / PWA
   |
   | public client configuration only
   v
Next.js application
   |
   +---- Ad adapter --------------------+
   |                                    |
   +---- Payment adapter ---------------+--> provider APIs
   |                                    |
   +---- Webhook verification ----------+
   |
   v
Server-side entitlement service
   |
   +--> ad_reward_events
   +--> chat_passes
   +--> premium_subscriptions
   +--> reward_ledger
   +--> reward_redemptions
   |
   v
Supabase/Postgres
```

## Trust boundaries

### Client

The client may:

- request an ad/reward flow;
- display provider UI using public identifiers/configuration;
- start checkout using a server-created checkout/session reference;
- display entitlement state returned by the server.

The client must never:

- decide that an ad was watched successfully;
- grant a Chat Pass;
- grant Premium;
- mark a payment as successful;
- write provider webhook events;
- provide the authoritative subscription status.

### Server

Only server-side code may:

- verify rewarded-ad callbacks/server-to-server events;
- verify payment webhook signatures;
- enforce idempotency;
- map verified provider events to ShahZap users;
- grant/revoke entitlements;
- write authoritative reward/payment ledger entries;
- reconcile provider state.

## Adapter contracts

Provider-specific implementations must expose the following logical operations.

### Ads

`createRewardContext(userId, sessionId)`

Creates an opaque server-side reward context. It must contain no secret and must expire.

`verifyReward(event)`

Validates the provider event, including authenticity, user/session binding, expiry, and replay protection.

`grantReward(verifiedEvent)`

Performs an idempotent server-side entitlement grant. A successful rewarded event may grant exactly one configured Chat Pass.

### Payments

`createCheckout(userId, productId)`

Creates a provider checkout/session from a server-controlled product mapping.

`verifyWebhook(headers, rawBody)`

Verifies the provider signature against the raw request body before parsing/processing the event.

`processWebhook(event)`

Processes the verified event idempotently and synchronizes Premium entitlement state.

`getProviderSubscription(providerReference)`

Used for reconciliation when webhook state and local state disagree.

## Product mapping

Provider product IDs are **configuration**, not business logic.

The server owns the mapping:

`ShahZap product -> provider product/price ID`

The browser may request only a known ShahZap product identifier such as `premium_monthly`; it may not supply an arbitrary provider price ID.

## Idempotency requirements

Every external event must have a stable provider event ID/reference.

The server must reject or no-op duplicate processing for an already-consumed event.

Required examples:

- duplicate rewarded-ad callback;
- duplicate payment webhook;
- webhook retry after timeout;
- subscription renewal delivered twice;
- cancellation/refund event delivered after a prior state update.

## Entitlement rules

### Rewarded ad

Verified event -> one idempotent reward -> one 30-minute Chat Pass.

Unverified client request -> **zero reward**.

Repeated provider event -> **zero additional reward**.

### Premium

Verified payment/subscription event -> authoritative Premium state.

Client claim of payment success -> **never sufficient**.

Refund/cancellation/expiry -> entitlement state is updated according to the verified provider event.

## Secret categories

No real values belong in Git.

Future production secrets will be separated into:

- ad verification credentials;
- payment API credentials;
- payment webhook signing secret;
- provider-specific server credentials;
- production Supabase server credentials where required;
- Cloudflare Worker secrets.

Public provider identifiers, where required by the provider, are explicitly separated from secret values.

## Provider selection status

**No provider name is hard-coded in this architecture document.** The existing ShahZap repository/context does not establish a definitive ad provider or payment provider choice. Phase 13C-2 must therefore use the provider credentials/products supplied for ShahZap rather than inventing provider identities or credentials.

## Security acceptance checklist

- [x] Client cannot directly grant a Chat Pass.
- [x] Client cannot directly grant Premium.
- [x] Provider event verification is server-side.
- [x] Payment webhook verification is server-side.
- [x] Product IDs are server-controlled.
- [x] External event processing is idempotent by provider event/reference ID.
- [x] Provider secrets are deployment secrets, never source code.
- [x] Active conversations are never interrupted by advertisements.
- [x] Real provider credentials remain absent until the next Phase 13C step.

## Next step

**Phase 13C-2 — Production secrets and provider configuration.**

Before adding any secret, map the supplied provider credentials to the adapter contract above and verify that no secret can enter the client bundle, repository, database plaintext fields, or application logs.
