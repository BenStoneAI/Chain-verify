import Link from 'next/link';

import { ChainVerifyMark } from '@/components/brand/ChainVerifyMark';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';

const offers = [
  {
    product: 'verify-api' as const,
    name: 'VerifyAPI',
    eyebrow: 'AI + SOFTWARE DELIVERY',
    price: '$99/mo',
    plan: 'verify-api-build',
    cta: 'Start VerifyAPI — $99/mo',
    title: 'Verify AI output before users rely on it.',
    body: 'Check output and delivery claims against rules, tests, CI, evidence, and acceptance criteria.',
    href: '/verify-api',
    bullets: ['5,000 runs / month', 'Proof ID every run', '90-day retention'],
  },
  {
    product: 'audit-proof' as const,
    name: 'AuditProof',
    eyebrow: 'AI GOVERNANCE',
    price: '$2,500 pilot',
    plan: 'auditproof-pilot',
    cta: 'Start AuditProof Pilot — $2,500',
    title: 'Prove what the AI did — and who approved it.',
    body: 'Capture agent activity, human oversight, policy context, and structured evidence for review.',
    href: '/audit-proof',
    bullets: ['100-run managed pilot', 'Structured proof record', 'Reviewable evidence'],
  },
  {
    product: 'invoice-proof' as const,
    name: 'InvoiceProof',
    eyebrow: 'FINANCE + AP',
    price: '$750 pilot',
    plan: 'invoiceproof-pilot',
    cta: 'Start InvoiceProof Pilot — $750',
    title: 'Catch invoice risk before money moves.',
    body: 'Flag duplicates, vendor changes, PO mismatches, and payment anomalies before approval.',
    href: '/invoice-proof',
    bullets: ['100-invoice pilot', 'Duplicate + math checks', 'Payment-risk evidence'],
  },
];

export default function HomePage() {
  return (
    <main className="cv-home cv-home-conversion">
      <div className="cv-ambient" aria-hidden="true">
        <i className="orb orb-one"/><i className="orb orb-two"/><span className="cv-noise"/>
      </div>

      <header className="cv-home-nav">
        <Link href="/" className="cv-brand" aria-label="ChainVerify home">
          <ChainVerifyMark className="cv-brand-mark" />
          <span>ChainVerify</span>
        </Link>
        <nav aria-label="Primary">
          <Link href="#products">Products</Link>
          <Link href="#how-it-works">How it works</Link>
          <Link href="#proof">Proof model</Link>
        </nav>
        <div className="cv-home-nav-actions">
          <ThemeToggle />
          <Link href="#products" className="cv-nav-cta">Choose a product <span>↓</span></Link>
        </div>
      </header>

      <section className="cv-conversion-hero">
        <div className="cv-kicker"><i/>INDEPENDENT AI VERIFICATION</div>
        <h1>Don’t trust the output.<br/><span>Verify it.</span></h1>
        <p>
          ChainVerify turns AI output, software-delivery claims, agent activity, and invoice risk
          into structured evidence your team can review before it makes a decision.
        </p>
        <div className="cv-hero-actions cv-conversion-actions">
          <ProofCheckoutButton product="verify-api" planSlug="verify-api-build" className="cv-button cv-button-primary">
            Start VerifyAPI — $99/mo <span>→</span>
          </ProofCheckoutButton>
          <Link href="#products" className="cv-button cv-button-secondary">Compare proof products</Link>
        </div>
        <div className="cv-conversion-trust">
          <span>✓ Secure Stripe checkout</span>
          <span>✓ No account required before purchase</span>
          <span>✓ Independent · Reviewable · Exportable</span>
        </div>
      </section>

      <section id="products" className="cv-offer-section">
        <div className="cv-offer-heading">
          <span>CHOOSE THE DECISION YOU NEED TO TRUST</span>
          <h2>Buy the proof layer that matches the risk.</h2>
          <p>Starting price, outcome, and checkout are visible before you have to dig through a product page.</p>
        </div>
        <div className="cv-offer-grid">
          {offers.map((offer) => (
            <article className={'cv-offer-card ' + offer.product} key={offer.name}>
              <div className="cv-offer-top">
                <span>{offer.eyebrow}</span>
                <strong>{offer.price}</strong>
              </div>
              <h3>{offer.name}</h3>
              <h4>{offer.title}</h4>
              <p>{offer.body}</p>
              <ul>{offer.bullets.map((item) => <li key={item}>✓ {item}</li>)}</ul>
              <div className="cv-offer-actions">
                <ProofCheckoutButton product={offer.product} planSlug={offer.plan} className="cv-button cv-button-primary">
                  {offer.cta}
                </ProofCheckoutButton>
                <Link href={offer.href}>See details <span>→</span></Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="cv-proof-story" id="proof">
        <div className="cv-proof-story-copy">
          <div className="cv-kicker"><i/>WHAT YOU ACTUALLY GET</div>
          <h2>A verdict is useful.<br/>A proof record is defensible.</h2>
          <p>
            Each product is built around the same idea: don’t stop at a model answer or a status message.
            Keep the evidence, the checks, the decision, and the proof ID together.
          </p>
        </div>
        <div className="cv-proof-record-card">
          <div className="cv-proof-record-head"><span>ChainVerify proof record</span><b>VERIFIED</b></div>
          <div><span>Claim</span><strong>Captured</strong></div>
          <div><span>Evidence</span><strong>Attached</strong></div>
          <div><span>Checks</span><strong>Passed</strong></div>
          <div><span>Human review</span><strong>Recorded</strong></div>
          <div><span>Proof ID</span><code>cv_8f3e2…</code></div>
        </div>
      </section>

      <section className="cv-story cv-conversion-story" id="how-it-works">
        <div className="cv-section-copy">
          <div className="cv-kicker"><i/>ONE SIMPLE FLOW</div>
          <h2>From claim to proof in three moves.</h2>
          <p>Every page now follows the same path so buyers always know what happens next.</p>
        </div>
        <div className="cv-story-steps">
          <article><span>01</span><h3>Send the work.</h3><p>Submit the output, delivery claim, invoice, or evidence bundle you need to trust.</p></article>
          <article><span>02</span><h3>Run the checks.</h3><p>ChainVerify evaluates the relevant evidence, rules, risk signals, and review context.</p></article>
          <article><span>03</span><h3>Keep the proof.</h3><p>Use the structured result and proof record to approve, hold, reject, or escalate.</p></article>
        </div>
      </section>

      <section className="cv-final cv-conversion-final">
        <div className="cv-final-glow"/>
        <h2>When the work matters,<br/>put proof in the path.</h2>
        <p>Start with the smallest paid plan or pilot that matches the decision you need to trust.</p>
        <div className="cv-hero-actions">
          <ProofCheckoutButton product="verify-api" planSlug="verify-api-build" className="cv-button cv-button-primary">
            Start VerifyAPI — $99/mo
          </ProofCheckoutButton>
          <Link href="#products" className="cv-button cv-button-secondary">Compare products</Link>
        </div>
      </section>

      <footer className="cv-home-footer">
        <div className="cv-brand"><ChainVerifyMark className="cv-brand-mark"/><span>ChainVerify</span></div>
        <p>Independent verification for AI work and high-stakes workflows.</p>
        <div><Link href="/verify-api">VerifyAPI</Link><Link href="/audit-proof">AuditProof</Link><Link href="/invoice-proof">InvoiceProof</Link><Link href="/contact">Contact</Link><Link href="/security">Security</Link><Link href="/privacy">Privacy</Link></div>
      </footer>
    </main>
  );
}
