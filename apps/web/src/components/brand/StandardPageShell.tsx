import type { ReactNode } from 'react';
import Link from 'next/link';

import { ChainVerifyMark } from '@/components/brand/ChainVerifyMark';
import { ThemeToggle } from '@/components/brand/ThemeToggle';

export function StandardPageShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="cv-standard-page">
      <header className="cv-home-nav cv-standard-nav">
        <Link href="/" className="cv-brand" aria-label="ChainVerify home">
          <ChainVerifyMark className="cv-brand-mark" />
          <span>ChainVerify</span>
        </Link>
        <nav aria-label="Primary">
          <Link href="/agent-gate">Agent Gate</Link>
          <Link href="/audit-proof">AuditProof</Link>
          <Link href="/invoice-proof">InvoiceProof</Link>
        </nav>
        <div className="cv-home-nav-actions">
          <ThemeToggle />
          <Link href="/contact" className="cv-nav-cta">Contact <span>→</span></Link>
        </div>
      </header>

      <section className="cv-standard-hero">
        <div className="cv-kicker"><i />{eyebrow}</div>
        <h1>{title}</h1>
        <p>{intro}</p>
      </section>

      <section className="cv-standard-content">
        {children}
      </section>

      <footer className="cv-standard-footer">
        <div className="cv-brand">
          <ChainVerifyMark className="cv-brand-mark" />
          <span>ChainVerify</span>
        </div>
        <nav aria-label="Footer">
          <Link href="/contact">Contact</Link>
          <Link href="/security">Security</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
        <span>© 2026 ChainVerify</span>
      </footer>
    </main>
  );
}

export default StandardPageShell;
