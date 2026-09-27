'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { getStripePaymentLink } from '@/lib/stripe-payment-links';
import type { ProofProductSlug } from '@/lib/proof-checkout';

type Props = {
  product: ProofProductSlug;
  planSlug: string;
  children: React.ReactNode;
  className?: string;
  email?: string;
  successUrl?: string;
  cancelUrl?: string;
  isSandbox?: boolean;
};

export function ProofCheckoutButton({
  product,
  planSlug,
  children,
  className,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (loading) return;

    if (planSlug === 'free') {
      router.push(`/${product}#proof`);
      return;
    }

    const paymentLink = getStripePaymentLink(planSlug);
    if (!paymentLink) {
      router.push(`/${product}#pricing`);
      return;
    }

    setLoading(true);
    window.location.assign(paymentLink);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={className}
      aria-busy={loading}
    >
      {loading ? 'Opening secure checkout…' : children}
    </button>
  );
}
