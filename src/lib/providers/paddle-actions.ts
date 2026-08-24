'use server';

/*
 * Paddle checkout Server Action.
 *
 * 'use server' files may only export async functions — the interactive
 * button lives in components/paddle-checkout.tsx ('use client') and calls
 * this action.
 *
 * Security:
 *   - The Paddle API call runs entirely on the server; no API keys are
 *     exposed to the client bundle.
 *   - The user is redirected to Paddle's hosted checkout — no sensitive
 *     data returns to the browser.
 */

import { redirect } from 'next/navigation';
import { createCheckout, type PremiumProduct } from '@/lib/providers/paddle';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function startPremiumCheckout(product: PremiumProduct): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('You must be signed in to purchase Premium.');
  }

  const { url } = await createCheckout(user.id, product);
  redirect(url);
}
