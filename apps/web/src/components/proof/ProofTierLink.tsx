'use client';

import type { ReactNode } from 'react';

import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';
import type { ProofProductSlug } from '@/lib/stripe-payment-links';

type Props = {
  product: ProofProductSlug;
  planSlug: string;
  className?: string;
  children: ReactNode;
};

/** Drop-in for pricing tier CTAs (replaces buy.stripe.com Link). */
export function ProofTierLink({ product, planSlug, className, children }: Props) {
  return (
    <ProofCheckoutButton product={product} planSlug={planSlug} className={className}>
      {children}
    </ProofCheckoutButton>
  );
}
