'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

import { ensureAuthToken } from '@/lib/auth';
import { startProofCheckout, type ProofProductSlug } from '@/lib/proof-checkout';

type Props = {
  product: ProofProductSlug;
  planSlug: string;
  children: React.ReactNode;
  className?: string;
  email?: string;
  successUrl?: string;
  cancelUrl?: string;
  /** When true, runs a test-mode (sandbox) checkout — no real card is charged. */
  isSandbox?: boolean;
};

export function ProofCheckoutButton({
  product,
  planSlug,
  children,
  className,
  email,
  successUrl,
  cancelUrl,
  isSandbox,
}: Props) {
  const { status } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    setError(null);

    const checkoutParams = new URLSearchParams({
      product,
      plan: planSlug,
    });
    if (isSandbox) {
      checkoutParams.set('sandbox', '1');
    }
    const checkoutReturnTo = `/proof/checkout?${checkoutParams.toString()}`;

    if (status === 'loading') {
      return;
    }

    const localJwt = ensureAuthToken();

    // C-5 fix: require authentication before creating a Stripe checkout session.
    // Unauthenticated users are redirected to register with a returnTo so they
    // land back on the exact proof checkout page after account creation.
    if (status === 'unauthenticated' && !localJwt) {
      const registerParams = new URLSearchParams({
        type: 'human',
        product,
        plan: planSlug,
        returnTo: checkoutReturnTo,
      });
      if (isSandbox) {
        registerParams.set('sandbox', '1');
      }
      router.push(`/register?${registerParams.toString()}`);
      return;
    }

    setLoading(true);
    try {
      await startProofCheckout({ product, planSlug, email, successUrl, cancelUrl, isSandbox });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setLoading(false);
    }
  }

  return (
    <span className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading || status === 'loading'}
        className={className}
        style={
          className
            ? undefined
            : { all: 'unset', cursor: loading || status === 'loading' ? 'wait' : 'pointer' }
        }
      >
        {loading ? 'Redirecting…' : status === 'loading' ? 'Loading…' : children}
      </button>
      {error ? (
        <span
          role="alert"
          style={{ display: 'block', fontSize: '0.75rem', color: '#f87171', marginTop: 4 }}
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
