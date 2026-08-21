/*
 * Paddle webhook handler for ShahZap.
 *
 * POST /api/webhooks/paddle
 *
 * Responsibilities:
 *   1. Verify the Paddle webhook signature (using PADDLE_WEBHOOK_SECRET).
 *   2. Parse the event payload.
 *   3. Process the event idempotently (dedup by Paddle event ID).
 *   4. For completed purchases/subscriptions: upsert premium_subscriptions,
 *      log to reward_ledger.
 *   5. Return a 200 OK to Paddle to acknowledge receipt.
 *
 * Security:
 *   - Signature verification is mandatory; events without a valid signature
 *     are rejected with 401.
 *   - Idempotency: we check if the Paddle event ID has already been processed
 *     before making any DB changes.
 *   - All entitlement grants are server-side; the client never directly gains
 *     Premium state from this endpoint.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Import our Paddle adapter functions
import { verifyWebhook, processWebhook } from '@/lib/providers/paddle';
import type { PaddleWebhookEvent } from '@/lib/providers/paddle';

// ── Configuration ─────────────────────────────────────────────────────────────
function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) {
    throw new Error(
      'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  return { url, key };
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers = new Headers(request.headers);

  try {
    JSON.parse(body);
  } catch (e) {
    console.error('Paddle webhook: invalid JSON body', e);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── 1. Verify webhook signature ────────────────────────────────────────────
  let parsedEvent: Record<string, unknown>;
  try {
    parsedEvent = verifyWebhook(headers, body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Paddle webhook: signature verification failed', message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 401 }
    );
  }

  // ── 2. Process the webhook idempotently ────────────────────────────────────
  const { url, key } = getConfig();
  const result = await processWebhook(parsedEvent as PaddleWebhookEvent, url, key);

  // ── 3. Respond to Paddle ──────────────────────────────────────────────────
  // Paddle expects a 200 OK response to acknowledge receipt.
  // We include a summary of what was done (for our own logs).
  const responseBody = {
    status: result.action,
    ...(result.premiumId && { premium_subscription_id: result.premiumId }),
    ...(result.error && { error: result.error }),
  };

  return NextResponse.json(responseBody, { status: 200 });
}

// ── Optional: GET for healthcheck / verification ──────────────────────────────
// Paddle may ping the webhook URL with a GET during configuration.
// We return 200 with a simple payload to confirm the endpoint is live.
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Paddle webhook endpoint is active',
    endpoint: '/api/webhooks/paddle',
  });
}