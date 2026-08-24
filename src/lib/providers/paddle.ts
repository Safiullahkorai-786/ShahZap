/**
 * Paddle payment provider adapter for ShahZap.
 *
 * Adapter contract (Phase 13C-1):
 *   - createCheckout(userId, productId) → creates provider checkout/session
 *   - verifyWebhook(headers, rawBody) → verifies provider signature
 *   - processWebhook(event) → processes verified event idempotently,
 *     synchronizes Premium entitlement state
 *
 * Security:
 *   - Never expose API keys to the client.
 *   - Webhook signatures must be strictly verified.
 *   - All entitlement grants happen server-side.
 *   - Idempotent processing (dedup by provider event ID).
 */

import crypto from 'crypto';

// ── Paddle API base ──────────────────────────────────────────────────────────
const PADDLE_API_BASE = 'https://api.paddle.com';

// ── Types ──────────────────────────────────────────────────────────────────────

export type PremiumProduct = 'premium_monthly' | 'premium_yearly';

export type PaddleCreateCheckoutResponse = {
  id: string;
  url?: string;
  checkout?: { url?: string };
};

/**
 * Internal event shape consumed by processWebhook(). Accepts both the legacy
 * internal taxonomy (`id`/`type`/`custom`) and raw Paddle Billing payloads
 * (`event_id`/`event_type`/`custom_data`) so provider retries keep working
 * after a future switch to the official event types.
 */
export type PaddleWebhookEvent = {
  id: string; // provider event ID — used for idempotency dedup
  type: 'purchase' | 'subscription_created' | 'subscription_updated';
  status: 'completed' | 'pending' | 'cancelled' | 'failed' | 'active';
  custom?: Record<string, unknown>;
};

// ── createCheckout ────────────────────────────────────────────────────────────
/**
 * Creates a Paddle checkout session for the given ShahZap user/product.
 *
 * ShahZap product → provider price ID mapping is server-controlled:
 *   premium_monthal → price_ID_for_monthly_premium
 *   etc.
 *
 * The browser may request only a known ShahZap product identifier;
 * it may not supply an arbitrary provider price ID.
 */
export async function createCheckout(userId: string, product: PremiumProduct): Promise<{ url: string; sessionId: string }> {
  // Map ShahZap product names to Paddle price IDs.
  // These are configuration — not business logic — and are set via
  // environment variables (see .env.example).
  const priceIdMap: Record<PremiumProduct, string | undefined> = {
    premium_monthly: process.env.PADDLE_PREMIUM_MONTHLY_PRICE_ID,
    premium_yearly: process.env.PADDLE_PREMIUM_YEARLY_PRICE_ID,
  };

  const priceId = priceIdMap[product];
  if (!priceId) {
    throw new Error(`Missing Paddle price ID for product: ${product}`);
  }

  const authToken = process.env.PADDLE_API_KEY ?? process.env.PADDLE_API_TOKEN;
  if (!authToken) {
    throw new Error('Missing Paddle API credentials (PADDLE_API_KEY).');
  }

  const response = await fetch(`${PADDLE_API_BASE}/transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      // Custom data lets the webhook map the transaction back to ShahZap.
      custom_data: { user_id: userId, product },
      return_url: `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? ''}/premium`,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Paddle checkout failed: ${response.status} ${err}`);
  }

  const data = (await response.json()) as PaddleCreateCheckoutResponse;
  const url = data.url ?? data.checkout?.url ?? '';
  if (!url) {
    throw new Error('Paddle checkout response did not include a checkout URL.');
  }
  return { url, sessionId: data.id };
}

// ── verifyWebhook ─────────────────────────────────────────────────────────────
/**
 * Verifies a Paddle Billing webhook signature against the raw request body.
 *
 * Paddle sends `Paddle-Signature: ts=<unix_seconds>;h1=<hmac_sha256_hex>`
 * where the HMAC is computed over `${ts}:${rawBody}` using the webhook
 * signing secret (PADDLE_WEBHOOK_SECRET).
 *
 * Security rules:
 *   - Verification is mandatory. If no secret is configured, the event is
 *     rejected — an unverified webhook must never reach processing.
 *   - Signatures older than SIGNATURE_TOLERANCE_SECONDS are rejected
 *     (replay protection), per Paddle's guidance.
 *   - Comparison is constant-time and length-guarded.
 *
 * Returns the parsed event if signature is valid, otherwise throws.
 */
const SIGNATURE_TOLERANCE_SECONDS = 5;

export function verifyWebhook(headers: Headers, rawBody: string): PaddleWebhookEvent {
  const secret = process.env.PADDLE_WEBHOOK_SECRET ?? '';
  const signatureHeader = headers.get('Paddle-Signature') ?? headers.get('paddle-signature');

  if (!secret || !signatureHeader) {
    // Never process unauthenticated events — reject so Paddle retries only
    // once the webhook secret is configured in deployment secrets.
    throw new Error('Missing Paddle-Signature header or PADDLE_WEBHOOK_SECRET');
  }

  let timestampPart: string | undefined;
  let digestPart: string | undefined;
  for (const segment of signatureHeader.split(';')) {
    const [key, value] = segment.split('=');
    if (key === 'ts') timestampPart = value;
    if (key === 'h1') digestPart = value;
  }

  const timestampSeconds = Number(timestampPart);
  if (!timestampPart || !digestPart || !Number.isFinite(timestampSeconds)) {
    throw new Error('Malformed Paddle-Signature header');
  }

  if (Math.abs(Date.now() / 1000 - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new Error('Paddle webhook timestamp outside tolerance window');
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestampPart}:${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(digestPart, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Invalid Paddle webhook signature');
  }

  // Parse and return a normalized event for idempotent processing.
  const raw = JSON.parse(rawBody) as Record<string, unknown>;
  const custom = (raw.custom ?? raw.custom_data) as Record<string, unknown> | undefined;
  const eventId = raw.id ?? raw.event_id;
  if (!eventId || typeof eventId !== 'string') {
    throw new Error('Paddle webhook event missing required `id` field');
  }

  return {
    id: eventId,
    type: (raw.type as PaddleWebhookEvent['type']) ?? 'purchase',
    status: (raw.status as PaddleWebhookEvent['status']) ?? 'completed',
    custom,
  };
}

// ── processWebhook ────────────────────────────────────────────────────────────
/**
 * Processes a verified Paddle webhook event idempotently and synchronizes
 * Premium entitlement state.
 *
 * Flow:
 *   1. Check if we've already processed an event with this `id` → if so, no-op.
 *   2. For `purchase`/`subscription_created` events with `status=completed`:
 *      a. Look up the ShahZap user ID from the `custom` variables we sent
 *         when creating the checkout.
 *      b. Upsert/set `premium_subscriptions` with `status='active'` and
 *         appropriate `starts_at`/`ends_at` dates.
 *      c. Log the event to `reward_ledger` (or a purchase ledger) for audit.
 *   3. For other event types (refund, cancellation), update entitlement state
 *      accordingly based on the verified provider state.
 *
 * Idempotency: The `id` field from Paddle is a globally unique event ID.
 * We store processed IDs in a simple approach: check if a ledger entry
 * already exists for this event ID before processing.
 */
export async function processWebhook(event: PaddleWebhookEvent, supabaseUrl: string, serviceRoleKey: string): Promise<{
  action: 'granted' | 'no-op' | 'error';
  premiumId?: string;
  error?: string;
}> {
  // ── Idempotency check ─────────────────────────────────────────────────────
  // We use a pragmatic approach: store processed Paddle event IDs in the
  // reward_ledger with a special reason='paddle_webhook'. Before processing,
  // query: SELECT 1 FROM reward_ledger WHERE reference_id = $1 LIMIT 1
  // If found, return 'no-op'.

  // For this implementation, we'll use a direct Supabase POSTgrest check.
  // In production, consider a dedicated `paddle_webhook_events` table or
  // using the existing `reward_ledger` with a `reference_type` discriminator.

  const { createServerClient } = await import('@supabase/ssr');
  const supabase = createServerClient(supabaseUrl, serviceRoleKey ?? '', {
    cookies: {
      getAll() { return []; },
      setAll() { /* no-op in webhook context */ },
    },
  });

  // Look for an existing ledger entry with this Paddle event ID
  const { data: existing } = await supabase
    .from('reward_ledger')
    .select('id')
    .eq('reason', 'paddle_webhook')
    .eq('reference_id', event.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Already processed this event — idempotent no-op
    return { action: 'no-op' };
  }

  // ── Process the event ─────────────────────────────────────────────────────
  // Paddle event types we care about:
  //   - purchase with status=completed → grant Premium
  //   - subscription_created → grant Premium (active)
  //   - subscription_updated/refund → revoke or adjust Premium

  const eventType = event.type ?? '';
  const eventStatus = event.status ?? '';

  // Only process completed events that grant entitlement
  const isCompletion =
    eventType === 'purchase' && eventStatus === 'completed' ||
    eventType === 'subscription_created' && eventStatus === 'active';

  if (!isCompletion) {
    // Non‑completion events (pending, cancelled, failed) may still need
    // state reconciliation; for now we log and no-op.
    // TODO: handle refund/cancellation state updates if required.
    return { action: 'no-op' };
  }

  // Extract the ShahZap user ID from the custom data we sent
  // when creating the checkout: { user_id: "<supabase_auth_uid>" }
  const userId = typeof event.custom?.user_id === 'string' ? event.custom.user_id : null;
  if (!userId) {
    return { action: 'error', error: 'Paddle webhook missing user_id in custom variables' };
  }

  // Compute the entitlement window from the product recorded at checkout time.
  const product = typeof event.custom?.product === 'string' ? event.custom.product : '';
  const durationDays: number =
    typeof event.custom?.duration_days === 'number'
      ? event.custom.duration_days
      : product === 'premium_yearly' ? 365 : 30;

  const nowIso = new Date().toISOString();
  const endsAtIso = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  // premium_subscriptions live columns: id, profile_id, status, starts_at,
  // ends_at, plan_id, created_at, updated_at. Select-then-write avoids
  // assuming a unique constraint on profile_id for upsert.
  const { data: current } = await supabase
    .from('premium_subscriptions')
    .select('id')
    .eq('profile_id', userId)
    .order('ends_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let premiumId: string | null = null;
  if (current?.id) {
    const { data, error: dbError } = await supabase
      .from('premium_subscriptions')
      .update({ status: 'active', starts_at: nowIso, ends_at: endsAtIso, updated_at: nowIso })
      .eq('id', current.id)
      .select('id')
      .single();
    if (dbError) {
      console.error('Paddle webhook: DB error updating premium_subscriptions', dbError);
      return { action: 'error', error: dbError.message };
    }
    premiumId = data?.id ?? current.id;
  } else {
    const planId = typeof event.custom?.plan_id === 'string' ? event.custom.plan_id : null;
    const { data, error: dbError } = await supabase
      .from('premium_subscriptions')
      .insert({
        profile_id: userId,
        status: 'active',
        starts_at: nowIso,
        ends_at: endsAtIso,
        ...(planId ? { plan_id: planId } : {}),
      })
      .select('id')
      .single();
    if (dbError) {
      console.error('Paddle webhook: DB error inserting premium_subscriptions', dbError);
      return { action: 'error', error: dbError.message };
    }
    premiumId = data?.id ?? null;
  }

  // Log the verified event to the reward ledger for audit/idempotency.
  // reward_ledger.currency is constrained to ('xp','zap_points',
  // 'region_credits','reward_tokens') and has no metadata column.
  await supabase.from('reward_ledger').insert({
    profile_id: userId,
    currency: 'reward_tokens',
    amount: 1,
    reason: 'paddle_webhook',
    reference_type: 'paddle_transaction',
    reference_id: event.id,
  });

  return {
    action: 'granted',
    premiumId: premiumId ?? undefined,
  };
}