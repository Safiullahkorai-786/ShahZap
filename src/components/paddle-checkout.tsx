'use server';

/*
 * Paddle Checkout Component for ShahZap.
 *
 * Usage:
 *   <PaddleCheckout product="premium_monthly" />
 *   or
 *   <PaddleCheckout product="premium_yearly" />
 *
 * Security:
 *   - This is a Server Action; the Paddle API call runs entirely on the server.
 *   - No API keys are exposed to the client bundle.
 *   - The user is redirected to Paddle's hosted checkout page — no sensitive
 *     data returns to the browser.
 */

import { createCheckout } from '@/lib/providers/paddle';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

type Product = 'premium_monthly' | 'premium_yearly';

interface PaddleCheckoutProps {
  product: Product;
  className?: string;
  disabled?: boolean;
}

export function PaddleCheckout({
  product,
  className = 'rounded-xl bg-cyan-400 px-6 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-300',
  disabled = false,
}: PaddleCheckoutProps) {
  async function handleClick() {
    // Get the current user from Supabase (server-side)
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      // Not authenticated — redirect to sign-in or show error
      throw new Error('You must be signed in to purchase Premium.');
    }

    // Create the Paddle checkout session
    try {
      const { url, sessionId } = await createCheckout(user.id, product);

      // Redirect the user to Paddle's hosted checkout
      redirect(url);
    } catch (err: any) {
      console.error('PaddleCheckout: error creating checkout', err);
      throw new Error(
        err.message ?? 'Unable to create Paddle checkout session.'
      );
    }
  }

  return (
    <button
      disabled={disabled}
      onClick={handleClick}
      className={className}
    >
      {disabled ? 'Processing…' : 'Subscribe to Premium'}
    </button>
  );
}