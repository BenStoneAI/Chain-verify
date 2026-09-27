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
  const href =
    planSlug === 'free'
      ? `/${product}#proof`
      : getStripePaymentLink(planSlug) ?? `/${product}#plans`;

  return (
    <a
      href={href}
      className={className}
      aria-label={typeof children === 'string' ? children : undefined}
    >
      {children}
    </a>
  );
}

export default ProofCheckoutButton;
