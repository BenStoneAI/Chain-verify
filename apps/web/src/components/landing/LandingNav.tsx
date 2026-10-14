import Link from 'next/link';

import { ChainVerifyMark } from '@/components/brand/ChainVerifyMark';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

import { AGENT_GATE_NAME } from './productName';

const anchors = [
  { href: '#products', label: 'Products', collapses: false },
  { href: '#3d-engine', label: '3D Proof Engine', collapses: true },
  { href: '#how-it-works', label: 'How it works', collapses: true },
  { href: '#plans', label: 'Plans', collapses: true },
  { href: '#faq', label: 'FAQ', collapses: true },
] as const;

export function LandingNav() {
  return (
    <div className="lp-nav-wrap">
      <header className="lp-nav">
        <Link href="/" className="lp-brand" aria-label="ChainVerify home">
          <ChainVerifyMark className="lp-brand-mark" />
          <span>ChainVerify</span>
        </Link>

        <nav className="lp-nav-links" aria-label="Primary">
          {anchors.map((anchor) => (
            <Link
              key={anchor.href}
              href={anchor.href}
              className={anchor.collapses ? 'lp-nav-anchor' : undefined}
            >
              {anchor.label}
            </Link>
          ))}
        </nav>

        <div className="lp-nav-actions">
          <ThemeToggle />
          <ProofCheckoutButton
            product="verify-api"
            planSlug="agent-gate-build"
            className="lp-btn lp-btn-primary lp-btn-sm"
          >
            Start {AGENT_GATE_NAME}
            <span className="lp-nav-price"> — $99/mo</span> →
          </ProofCheckoutButton>
        </div>
      </header>
    </div>
  );
}
