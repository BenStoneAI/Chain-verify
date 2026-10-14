import Link from 'next/link';

import ProductFooter from '@/components/proof/ProductFooter';
import ProductNav from '@/components/proof/ProductNav';
import PurchaseActivationForm from '@/components/proof/PurchaseActivationForm';
import {
  getProofPlanDisplayName,
  getProofProductRoute,
  type ProofProductSlug,
} from '@/lib/stripe-payment-links';

const PRODUCT_COPY: Record<ProofProductSlug, { name: string; next: string }> = {
  'verify-api': {
    name: 'Agent Gate',
    next: 'Verify the Stripe purchase and connect it to your Agent Gate onboarding.',
  },
  'audit-proof': {
    name: 'AuditProof',
    next: 'Verify the Stripe purchase and connect it to your AuditProof onboarding.',
  },
  'invoice-proof': {
    name: 'InvoiceProof',
    next: 'Verify the Stripe purchase and connect it to your InvoiceProof onboarding.',
  },
};

export function CheckoutWelcome({
  product,
  plan,
  sessionId,
}: {
  product: ProofProductSlug;
  plan?: string;
  sessionId?: string;
}) {
  const copy = PRODUCT_COPY[product];

  return (
    <>
      <ProductNav currentProduct={product} pageAnchors={[]} />
      <main className={'pm-page pm-' + product}>
        <section className="pm-welcome">
          <div className="pm-eyebrow">CHECKOUT RETURN</div>
          <h1>Finish activation.<br/><span>No email app required.</span></h1>
          <p>
            Stripe returned you to ChainVerify after checkout. Confirm the purchase below using
            the same email address you entered in Stripe. ChainVerify will verify the Checkout
            Session directly with Stripe before recording the activation request.
          </p>

          <div className="pm-welcome-card">
            <div><span>Product</span><strong>{copy.name}</strong></div>
            <div><span>Plan</span><strong>{plan ? getProofPlanDisplayName(plan) : 'Purchased plan'}</strong></div>
            <div><span>Next step</span><strong>{copy.next}</strong></div>
            {sessionId ? <div><span>Checkout reference</span><code>{sessionId}</code></div> : null}
          </div>

          {sessionId && plan ? (
            <PurchaseActivationForm product={product} planSlug={plan} sessionId={sessionId} />
          ) : (
            <div className="pm-activation-error" role="alert">
              This return link is missing the Stripe checkout reference or plan. Return to the
              product page and contact support if the problem continues.
            </div>
          )}

          <div className="pm-welcome-actions pm-welcome-back">
            <Link className="pm-btn pm-btn-secondary" href={getProofProductRoute(product)}>Back to {copy.name}</Link>
          </div>

          <p className="pm-welcome-note">
            The activation endpoint verifies the Stripe session status, amount, product, plan,
            and checkout email before accepting the request. Full card details are never submitted
            to this form.
          </p>
        </section>
      </main>
      <ProductFooter currentProduct={product} />
    </>
  );
}

export default CheckoutWelcome;
