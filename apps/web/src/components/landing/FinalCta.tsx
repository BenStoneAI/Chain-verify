import Link from 'next/link';

import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

import { AGENT_GATE_NAME } from './productName';

export function FinalCta() {
  return (
    <section className="lp-section" id="final-cta" aria-labelledby="lp-final-title">
      <div className="lp-final">
        <div className="lp-final-content">
          <div className="lp-mono-badge"><i aria-hidden="true" />READY TO VERIFY</div>
          <h2 id="lp-final-title">When the work matters, put proof in the path.</h2>
          <p>Start with the smallest paid plan or pilot that matches the decision you need to trust.</p>
          <div className="lp-hero-actions">
            <ProofCheckoutButton product="verify-api" planSlug="agent-gate-build" className="lp-btn lp-btn-primary">
              Start {AGENT_GATE_NAME} — $99/mo →
            </ProofCheckoutButton>
            <Link href="#products" className="lp-btn lp-btn-glass">Compare products</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
