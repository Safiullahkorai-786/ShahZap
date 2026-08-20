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
import type { NextRequest } from 'next/navigation';

// Import our Paddle adapter functions
import { verifyWebhook, processWebhook } from '@/lib/providers/paddle';

// Import Supabase server client for DB operations
import { createClient } from '@supabase/ssr';

// ── Configuration ─────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
  );
}

// Create a reusable Supabase server client
function getSupabase() {
  const { cookies } = require('next/headers');
  // In a serverless function environment, we need to handle cookies carefully.
  // For webhook handling, we typically don't need client cookies — we use
  // the service role key for direct DB operations.
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // no-op in webhook context
      },
    },
  });
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers = new Headers(request.headers);

  let event: { [key:]: unknown };
  try {
    event = JSON.parse(body);
  } catch (e) {
    console.error('Paddle webhook: invalid JSON body', e);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── 1. Verify webhook signature ────────────────────────────────────────────
  let parsedEvent: Record<string, unknown>;
  try {
    parsedEvent = verifyWebhook(headers, body);
  } catch (err: any) {
    console.error('Paddle webhook: signature verification failed', err.message);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${err.message}` },
      { status: 401 }
    );
  }

  // ── 2. Process the webhook idempotently ────────────────────────────────────
  const supabase = getSupabase();
  const result = await processWebhook(parsedEvent as any, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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