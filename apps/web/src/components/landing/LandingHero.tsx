import Link from 'next/link';

import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

import { ProofRecordCard } from './ProofRecordCard';
import { AGENT_GATE_NAME } from './productName';

const trustPoints = [
  'Secure Stripe checkout',
  'No account required before purchase',
  'Independent · Reviewable · Exportable',
] as const;

export function LandingHero() {
  return (
    <section className="lp-hero" id="proof-model" aria-labelledby="lp-hero-title">
      <div className="lp-hero-copy">
        <div className="lp-mono-badge"><i aria-hidden="true" />INDEPENDENT AI VERIFICATION</div>
        <h1 id="lp-hero-title">
          Don’t trust the output.<br />
          <span className="lp-gradient-text">Verify it.</span>
        </h1>
        <p>
          ChainVerify turns AI output, software-delivery claims, agent activity, and invoice risk
          into structured evidence your team can review before it makes a decision.
        </p>
        <div className="lp-hero-actions">
          <ProofCheckoutButton product="verify-api" planSlug="agent-gate-build" className="lp-btn lp-btn-primary">
            Start {AGENT_GATE_NAME} — $99/mo →
          </ProofCheckoutButton>
          <Link href="#products" className="lp-btn lp-btn-glass">Compare proof products</Link>
        </div>
        <ul className="lp-trust-list">
          {trustPoints.map((point) => (
            <li key={point}><span aria-hidden="true">✓</span> {point}</li>
          ))}
        </ul>
      </div>

      <ProofRecordCard />
    </section>
  );
}
