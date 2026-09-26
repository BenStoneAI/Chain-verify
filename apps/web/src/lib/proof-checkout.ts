import { ensureAuthTokenAsync } from '@/lib/auth';
import { resolveProofApiBase } from '@/lib/proof-api';

export type ProofProductSlug = 'invoice-proof' | 'audit-proof' | 'verify-api';

export interface ProofCheckoutParams {
  product: ProofProductSlug;
  planSlug: string;
  email?: string;
  successUrl?: string;
  cancelUrl?: string;
  /**
   * When true, the backend creates the checkout session with the test-mode
   * Stripe key (STRIPE_TEST_SECRET_KEY) and the `*_PRICE_ID_TEST` price ids, so
   * no real card is charged. Used by the `?sandbox=1` test-checkout entrypoint.
   */
  isSandbox?: boolean;
}

/**
 * Start a proof product Stripe checkout session.
 *
 * C-5: Both endpoints now require a valid JWT. The caller (ProofCheckoutButton)
 * must verify the user is authenticated before invoking this function. If no
 * token exists, throws immediately instead of silently hitting a public endpoint.
 */
export async function startProofCheckout(params: ProofCheckoutParams): Promise<void> {
  const apiBase = resolveProofApiBase();
  const token = await ensureAuthTokenAsync();

  if (!token) {
    throw new Error('You must be logged in to subscribe. Please register or sign in first.');
  }

  // Both paths now require auth — prefer the authenticated path
  const path = '/billing/proof/checkout';
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  if (res.status === 401) {
    throw new Error('Session expired. Please sign in again.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? `Checkout failed (${res.status})`);
  }

  const data = (await res.json()) as { checkoutUrl?: string | null; isTestMode?: boolean };
  if (!data.checkoutUrl) {
    throw new Error('No checkout URL returned');
  }
  window.location.href = data.checkoutUrl;
}
