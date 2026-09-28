import Link from 'next/link';

import ProductFooter from '@/components/proof/ProductFooter';
import ProductNav from '@/components/proof/ProductNav';
import type { ProofProductSlug } from '@/lib/stripe-payment-links';

const PRODUCT_COPY: Record<ProofProductSlug, { name: string; next: string; emailSubject: string }> = {
  'verify-api': {
    name: 'VerifyAPI',
    next: 'We’ll connect your purchased plan to the API onboarding workflow.',
    emailSubject: 'Activate ChainVerify VerifyAPI purchase',
  },
  'audit-proof': {
    name: 'AuditProof',
    next: 'We’ll connect your purchase to the AuditProof onboarding workflow.',
    emailSubject: 'Activate ChainVerify AuditProof purchase',
  },
  'invoice-proof': {
    name: 'InvoiceProof',
    next: 'We’ll connect your purchase to the InvoiceProof onboarding workflow.',
    emailSubject: 'Activate ChainVerify InvoiceProof purchase',
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
  const body = encodeURIComponent(
    [
      'I completed ChainVerify checkout and need activation.',
      '',
      `Product: ${copy.name}`,
      `Plan: ${plan || 'not supplied'}`,
      `Stripe Checkout Session: ${sessionId || 'not supplied'}`,
      '',
      'Please use the same email address as the Stripe checkout.',
    ].join('\n'),
  );
  const subject = encodeURIComponent(copy.emailSubject);

  return (
    <>
      <ProductNav currentProduct={product} pageAnchors={[]} />
      <main className={'pm-page pm-' + product}>
        <section className="pm-welcome">
          <div className="pm-eyebrow">CHECKOUT RETURN</div>
          <h1>Payment step complete.<br/><span>Finish activation.</span></h1>
          <p>
            Stripe returned you to ChainVerify after checkout. Paid access is activated separately
            so we can connect the purchase to the correct organization and workflow.
          </p>

          <div className="pm-welcome-card">
            <div><span>Product</span><strong>{copy.name}</strong></div>
            <div><span>Plan</span><strong>{plan || 'Purchased plan'}</strong></div>
            <div><span>Next step</span><strong>{copy.next}</strong></div>
            {sessionId ? <div><span>Checkout reference</span><code>{sessionId}</code></div> : null}
          </div>

          <div className="pm-welcome-actions">
            <a
              className="pm-btn pm-btn-primary"
              href={`mailto:proof@chainverify.org?subject=${subject}&body=${body}`}
            >
              Activate my purchase
            </a>
            <Link className="pm-btn pm-btn-secondary" href={'/' + product}>Back to {copy.name}</Link>
          </div>

          <p className="pm-welcome-note">
            Use the same email address you entered in Stripe. Your Stripe receipt remains the
            payment record; this page does not independently verify payment status.
          </p>
        </section>
      </main>
      <ProductFooter currentProduct={product} />
    </>
  );
}

export default CheckoutWelcome;
