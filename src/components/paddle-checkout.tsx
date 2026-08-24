'use client';

/*
 * Paddle Checkout button for ShahZap.
 *
 * Usage:
 *   <PaddleCheckout product="premium_monthly" />
 *   <PaddleCheckout product="premium_yearly" />
 *
 * The checkout session is created by the Server Action in
 * lib/providers/paddle-actions.ts; this component only renders the
 * interactive button. No API keys ever reach the client bundle.
 */

import { useState, useTransition } from 'react';
import { startPremiumCheckout } from '@/lib/providers/paddle-actions';

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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  function handleClick() {
    setError('');
    startTransition(async () => {
      try {
        await startPremiumCheckout(product);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unable to create Paddle checkout session.';
        console.error('PaddleCheckout: error creating checkout', err);
        setError(message);
      }
    });
  }

  return (
    <div>
      <button type="button" disabled={disabled || pending} onClick={handleClick} className={className}>
        {pending ? 'Processing…' : 'Subscribe to Premium'}
      </button>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}
