import type { Metadata } from 'next';

import CheckoutWelcome from '@/components/proof/CheckoutWelcome';

// The return URL carries a Stripe checkout reference: keep it out of search
// indexes and out of cross-origin Referer headers.
export const metadata: Metadata = {
  title: 'Your Agent Gate access | Chain Verify',
  robots: { index: false, follow: false },
  referrer: 'same-origin',
};

export default function WelcomePage({
  searchParams,
}: {
  searchParams: { plan?: string; session_id?: string };
}) {
  return (
    <CheckoutWelcome
      product="verify-api"
      plan={searchParams.plan}
      sessionId={searchParams.session_id}
    />
  );
}
