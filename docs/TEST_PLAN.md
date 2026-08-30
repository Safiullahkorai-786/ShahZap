# ShahZap Test Plan

## Overview

This document outlines the testing strategy for the ShahZap project. The goal is to add comprehensive test coverage starting with security-critical and pure function code, then expanding to API routes and business logic.

## Framework: Vitest

- Fast, native ESM + TypeScript support
- Built-in mocking via `vi.mock()`
- Works seamlessly with Next.js projects

## Dependencies

```bash
npm install -D vitest @vitest/coverage-v8
```

## Configuration

### vitest.config.ts

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.ts', 'src/app/api/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

### package.json scripts to add

```json
"test": "vitest",
"test:run": "vitest run",
"test:coverage": "vitest run --coverage"
```

## File Structure

```
src/
├── lib/
│   ├── __tests__/
│   │   ├── identity.test.ts
│   │   ├── bot.test.ts
│   │   ├── errors.test.ts
│   │   ├── regions.test.ts
│   │   └── call.test.ts
│   └── providers/
│       └── __tests__/
│           ├── paddle.test.ts
│           └── adsterra.test.ts
├── app/
│   └── api/
│       └── __tests__/
│           ├── paddle-webhook.test.ts
│           └── translate.test.ts
```

---

## Phase 1: Pure Functions (No Mocking Needed)

### src/lib/identity.test.ts

**File under test:** `src/lib/identity.ts`

**Functions to test:**
- `resolveIdentity(p: GenderIdentity | null | undefined): Identity`

**Test cases:**
- Returns default identity when input is `null`
- Returns default identity when input is `undefined`
- Returns default identity when name is empty string
- Returns default identity when name is missing
- Hides gender when `gender_visible` is `false`
- Displays gender label for `woman`
- Displays gender label for `man`
- Displays gender label for `non_binary`
- Handles whitespace-only name
- Handles unrecognized gender type
- Returns correct `RAINBOW_TEXT_CLASS` constant

**Dependencies:** None (pure function)
**Mocking needed:** None

---

### src/lib/bot.test.ts

**File under test:** `src/lib/bot.ts`

**Functions to test:**
- `isBotProfile(profileId): boolean`
- `getBotPersona(profileId): BotPersona | null`

**Test cases:**
- `isBotProfile` returns `true` for `ZAP_BOT_PROFILE_ID`
- `isBotProfile` returns `true` for `ZAP_GUIDE_PROFILE_ID`
- `isBotProfile` returns `false` for unrelated IDs
- `isBotProfile` returns `false` for `null`
- `isBotProfile` returns `false` for `undefined`
- `getBotPersona` returns correct persona for bot IDs
- `getBotPersona` returns `null` for unknown ID
- `getBotPersona` returns `null` for `null`
- `getBotPersona` returns `null` for `undefined`

**Dependencies:** None (pure functions)
**Mocking needed:** None

---

### src/lib/errors.test.ts

**File under test:** `src/lib/errors.ts`

**Functions to test:**
- `friendlyError(error, fallback?): string`

**Test cases:**
- Returns friendly message for `friend_requests_pending_unique`
- Returns friendly message for Postgres code `23505` (duplicate key)
- Returns friendly message for Postgres code `23514` (self friend request)
- Returns friendly message for Postgres code `23503` (foreign key)
- Returns friendly message for Postgres code `42501` (RLS)
- Returns friendly message for Postgres code `P0001` (custom)
- Returns friendly message for JWT errors
- Returns friendly message for network errors
- Returns friendly message for schema cache errors
- Returns fallback for unknown errors
- Returns fallback when no fallback provided
- Handles `null` input gracefully
- Handles `undefined` input gracefully

**Dependencies:** None (pure function)
**Mocking needed:** None

---

### src/lib/regions.test.ts

**File under test:** `src/lib/regions.ts`

**Functions to test:**
- `getRegionForCountry(code: string | null): string | null`
- `getCountriesForRegion(region: string): string[]`
- `getCountryName(code: string | null): string | null`

**Test cases:**
- `getRegionForCountry` returns correct region for known country codes
- `getRegionForCountry` returns `null` for `null` input
- `getRegionForCountry` returns `null` for unknown code
- `getCountriesForRegion` returns array of country codes for valid region
- `getCountriesForRegion` returns empty array for invalid region
- `getCountriesForRegion` output is sorted
- `getCountryName` returns name for valid country code
- `getCountryName` returns `null` for `null` input
- `getCountryName` returns `null` for unknown code

**Dependencies:** None (pure lookup functions)
**Mocking needed:** None

---

### src/lib/call.test.ts

**File under test:** `src/lib/call.ts`

**Constants to validate:**
- `RING_MS` is `30000` (30 seconds)
- `CALL_TIMEOUT_MS` is `30000` (30 seconds)
- `ICE_SERVERS` has at least one entry
- `ICE_SERVERS[0]` has `urls: 'stun:stun.l.google.com:19302'`

**Dependencies:** None (constants only)
**Mocking needed:** None

---

## Phase 2: Security-Critical Adapters (Mock Supabase + fetch)

### src/lib/providers/paddle.test.ts

**File under test:** `src/lib/providers/paddle.ts`

**Functions to test:**
- `createCheckout(userId, product)`
- `verifyWebhook(headers, rawBody)`
- `processWebhook(event, supabaseUrl, serviceRoleKey)`

**Test cases for `verifyWebhook`:**
- Throws when `PADDLE_WEBHOOK_SECRET` is missing
- Throws when signature header is missing
- Throws when signature header is malformed
- Throws when timestamp is outside tolerance window
- Throws when event `id` is missing
- Returns `true` for valid signature with correct HMAC
- Returns `false` for invalid HMAC

**Test cases for `createCheckout`:**
- Throws when `PADDLE_API_KEY` is missing
- Throws when price ID env var is missing
- Returns `null` when fetch fails
- Returns `null` when response has no URL
- Returns checkout URL on success

**Test cases for `processWebhook`:**
- Returns no-op on duplicate event (idempotency)
- Grants premium on `purchase.completed` event
- Grants premium on `subscription.created` with active status
- Ignores non-completion events
- Returns error when `user_id` is missing
- Calculates premium expiry duration correctly
- Handles DB errors on upsert/insert

**Dependencies:** `crypto` (Node built-in), `@supabase/ssr`, `fetch`
**Mocking needed:**
- `vi.mock('crypto')` for HMAC verification
- `vi.mock('fetch')` for API calls
- `vi.mock('@/lib/supabase/ssr')` for DB operations
- `vi.stubGlobal('process.env', {...})` for environment variables

---

### src/lib/providers/adsterra.test.ts

**File under test:** `src/lib/providers/adsterra.ts`

**Functions to test:**
- `serviceClient(): SupabaseClient | null`
- `grantRewardedPass(admin, userId): Promise<GrantResult>`

**Test cases for `serviceClient`:**
- Returns `null` when `NEXT_PUBLIC_SUPABASE_URL` is missing
- Returns `null` when `SUPABASE_SERVICE_ROLE_KEY` is missing
- Returns Supabase client when env vars are present

**Test cases for `grantRewardedPass`:**
- Returns rate-limit error when recent pass exists
- Returns error when rate-limit query fails
- Returns success when grant is inserted
- Returns error when insert fails
- Handles idempotent behavior (existing pass)

**Dependencies:** `@supabase/supabase-js`
**Mocking needed:**
- `vi.mock('@supabase/supabase-js')` for createClient
- `vi.stubGlobal('process.env', {...})` for environment variables
- Mock Supabase query chain builder (`.from().select().eq().gte().limit()`)

---

## Phase 3: API Route Handlers (Mock Adapters)

### src/app/api/__tests__/paddle-webhook.test.ts

**File under test:** `src/app/api/webhooks/paddle/route.ts`

**Functions to test:**
- `GET()` — healthcheck
- `POST(request)` — webhook handler

**Test cases:**
- GET returns 200 with healthcheck message
- POST with invalid JSON returns 400
- POST with bad signature returns 401
- POST with valid webhook returns 200
- POST with missing env vars returns 500

**Dependencies:** `NextRequest`, `NextResponse`, `@/lib/providers/paddle`
**Mocking needed:**
- `vi.mock('@/lib/providers/paddle')` to mock `verifyWebhook` and `processWebhook`
- Mock `NextRequest` with headers and body

---

### src/app/api/__tests__/translate.test.ts

**File under test:** `src/app/api/translate/route.ts`

**Functions to test:**
- `POST(req: Request)` — translation handler

**Test cases:**
- Returns 500 when config is missing
- Returns 400 when required fields are missing
- Returns 404 when message is not found
- Returns 422 when text is empty
- Returns 200 with translated text on success
- Returns same text when languages match (passthrough)
- Returns 429 when rate limit is exceeded
- Handles AI model failure with translation refund

**Dependencies:** `NextResponse`, `@supabase/supabase-js`, Cloudflare AI binding
**Mocking needed:**
- `vi.mock('next/server')` for NextResponse
- `vi.mock('@supabase/supabase-js')` for DB queries
- Mock Cloudflare AI binding

---

## Phase 4: Business Logic (Mock Supabase RPC)

### src/lib/matching.test.ts

**File under test:** `src/lib/matching.ts`

**Functions to test:**
- `getMatchPreferences()`
- `updateMatchPreferences(overrides)`
- `joinMatchQueue()`
- `renewMatchQueue()`
- `getQueueCount()`
- `leaveMatchQueue()`
- `findBestMatch()`
- `getMatchedConversation()`

**Test cases:**
- `joinMatchQueue` clamps timeout to minimum 5 seconds
- `joinMatchQueue` returns error when user is unauthenticated
- `renewMatchQueue` only updates `waiting` status
- `findBestMatch` handles RPC error gracefully
- `findBestMatch` returns `null` when no match found
- `getMatchedConversation` returns conversation ID on success
- `getMatchedConversation` returns `null` on error

**Dependencies:** `@/lib/supabase/client`
**Mocking needed:**
- `vi.mock('@/lib/supabase/client')` for createClient
- Mock Supabase query chain builder

---

### src/lib/gamification.test.ts

**File under test:** `src/lib/gamification.ts`

**Functions to test:**
- `getGamification()`
- `getActiveQuests()`
- `applyGamificationEvent(source, zap, xp, metadata)`

**Test cases:**
- Returns error when user is unauthenticated
- Returns gamification data on success
- `applyGamificationEvent` infers `p_kind` as `earn` for positive zap
- `applyGamificationEvent` infers `p_kind` as `spend` for negative zap
- Handles RPC error in `applyGamificationEvent`
- `getActiveQuests` returns quests on success
- `getActiveQuests` handles error gracefully

**Dependencies:** `@/lib/supabase/client`
**Mocking needed:**
- `vi.mock('@/lib/supabase/client')` for createClient
- Mock `supabase.rpc` calls

---

### src/lib/rewards.test.ts

**File under test:** `src/lib/rewards.ts`

**Functions to test:**
- `getRewards()`
- `getRewardWallet()`
- `redeemReward(code)`
- `activateChatPass(id)`

**Test cases:**
- `getRewardWallet` returns parallel query results
- `getRewardWallet` handles error from credits query
- `getRewardWallet` handles error from passes query
- `getRewardWallet` handles error from shields query
- Returns error when user is unauthenticated
- `redeemReward` returns success on valid code
- `activateChatPass` returns success on valid pass

**Dependencies:** `@/lib/supabase/client`
**Mocking needed:**
- `vi.mock('@/lib/supabase/client')` for createClient
- Mock `Promise.all` for parallel queries

---

## Execution Order

1. **Phase 1** — Pure functions (Day 1)
   - `identity.test.ts`
   - `bot.test.ts`
   - `errors.test.ts`
   - `regions.test.ts`
   - `call.test.ts`

2. **Phase 2** — Security-critical adapters (Day 2-3)
   - `paddle.test.ts`
   - `adsterra.test.ts`

3. **Phase 3** — API route handlers (Day 4-5)
   - `paddle-webhook.test.ts`
   - `translate.test.ts`

4. **Phase 4** — Business logic (Day 6+)
   - `matching.test.ts`
   - `gamification.test.ts`
   - `rewards.test.ts`

---

## CI Integration

Add to `.github/workflows/ci.yml`:

```yaml
- name: Run tests
  run: npm run test:run
```

Add to `package.json` scripts:

```json
"test": "vitest",
"test:run": "vitest run",
"test:coverage": "vitest run --coverage"
```

---

## Notes

- All test files should be placed in `__tests__/` directories adjacent to the code they test
- Use `vi.mock()` for module-level mocking
- Use `vi.fn()` for function-level mocking
- Use `vi.stubGlobal()` for environment variables and browser APIs
- Keep tests independent — no shared state between test files
- Aim for >80% coverage on Phase 1 and Phase 2 files
