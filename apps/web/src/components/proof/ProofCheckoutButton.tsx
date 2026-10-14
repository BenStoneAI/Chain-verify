import {
  getProofProductRoute,
  getStripePaymentLink,
  type ProofProductSlug,
} from '@/lib/stripe-payment-links';

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
  const route = getProofProductRoute(product);
  const href =
    planSlug === 'free'
      ? `${route}#proof`
      : getStripePaymentLink(planSlug) ?? `${route}#plans`;

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
