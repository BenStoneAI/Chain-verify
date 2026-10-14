import Link from 'next/link';

import { ChainVerifyMark } from '@/components/brand/ChainVerifyMark';

import { AGENT_GATE_NAME } from './productName';

const footerLinks = [
  { href: '/agent-gate', label: AGENT_GATE_NAME },
  { href: '/audit-proof', label: 'AuditProof' },
  { href: '/invoice-proof', label: 'InvoiceProof' },
  { href: '/contact', label: 'Contact' },
  { href: '/security', label: 'Security' },
  { href: '/privacy', label: 'Privacy' },
] as const;

export function LandingFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-inner">
        <div className="lp-footer-brand">
          <ChainVerifyMark className="lp-footer-mark" />
          <p>
            <strong>ChainVerify</strong> — Independent verification for AI work and high-stakes workflows.
          </p>
        </div>
        <nav className="lp-footer-links" aria-label="Footer">
          {footerLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </nav>
      </div>
    </footer>
  );
}
