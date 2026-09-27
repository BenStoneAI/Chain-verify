import Link from 'next/link';

import { ChainVerifyMark } from '@/components/brand/ChainVerifyMark';
import { ThemeToggle } from '@/components/brand/ThemeToggle';

const products = [
  {
    name: 'VerifyAPI',
    href: '/verify-api',
    accent: 'violet',
    glyph: '</>',
    title: 'Verify AI output before users rely on it.',
    body: 'Check AI outputs and software-delivery claims against rules, evidence, and acceptance criteria. Return a structured verdict, issues, confidence, and proof ID.',
    tags: ['API','RULES','REAL-TIME'],
  },
  {
    name: 'AuditProof',
    href: '/audit-proof',
    accent: 'cyan',
    glyph: '◇',
    title: 'Prove what your AI did — and who approved it.',
    body: 'Capture agent execution evidence, human oversight, policy context, and a reviewable proof record for clients, investors, auditors, and governance teams.',
    tags: ['AUDIT','PROOF RECORDS','GOVERNANCE'],
  },
  {
    name: 'InvoiceProof',
    href: '/invoice-proof',
    accent: 'amber',
    glyph: '▤',
    title: 'Catch invoice risk before money moves.',
    body: 'Flag duplicate invoices, vendor and PO mismatches, and bank-change risk, then generate structured evidence your finance team can review.',
    tags: ['INVOICES','CLAIMS','RISK DETECTION'],
  },
];

const live = [
  ['✓','AI output verified','2s ago'],
  ['</>','Build checked','14s ago'],
  ['▤','Invoice analyzed','37s ago'],
  ['◆','Agent activity traced','1m ago'],
];

const sampleJson = '{\n  "verdict": "pass",\n  "confidence": 0.98,\n  "checks": [\n    "source_match",\n    "policy_compliant",\n    "no_fabrication"\n  ],\n  "proof_id": "cv_8f3e2..."\n}';

export default function HomePage() {
  return (
    <main className="cv-home">
      <div className="cv-ambient" aria-hidden="true">
        <i className="orb orb-one"/><i className="orb orb-two"/><i className="orb orb-three"/>
        <span className="cv-noise"/>
      </div>

      <header className="cv-home-nav">
        <Link href="/" className="cv-brand" aria-label="ChainVerify home">
          <ChainVerifyMark className="cv-brand-mark" />
          <span>ChainVerify</span>
        </Link>
        <nav aria-label="Primary">
          <Link href="#products">Product</Link>
          <Link href="#how-it-works">How it works</Link>
          <Link href="#proof">Proof model</Link>
          <Link href="/verify-api">Docs</Link>
        </nav>
        <div className="cv-home-nav-actions">
          <ThemeToggle />
          <Link href="/verify-api" className="cv-nav-cta">Get started <span>→</span></Link>
        </div>
      </header>

      <section className="cv-hero">
        <div className="cv-hero-copy">
          <div className="cv-kicker"><i/>INDEPENDENT AI VERIFICATION</div>
          <h1>Don’t trust<br/>the output.<br/><span>Verify it.</span></h1>
          <p>
            AI can say the work is done. ChainVerify gives you independent evidence that it actually is —
            across software delivery, agent activity, and finance workflows.
          </p>
          <div className="cv-hero-actions">
            <Link href="/verify-api" className="cv-button cv-button-primary">Try ChainVerify <span>→</span></Link>
            <Link href="#products" className="cv-button cv-button-secondary"><i>▶</i> Explore proof products</Link>
          </div>
          <div className="cv-trust-list">
            <span>✓ Independent</span><span>✓ Reviewable</span><span>✓ Exportable</span>
          </div>
        </div>

        <div className="cv-hero-stage" id="proof" aria-label="Illustrative ChainVerify proof console">
          <div className="cv-orbit orbit-a"/><div className="cv-orbit orbit-b"/>
          <div className="cv-planet"/>
          <div className="cv-float-card card-ai"><b>AI Output</b><span>Analyze and verify</span></div>
          <div className="cv-float-card card-agent"><b>Agent Activity</b><span>Trace every action</span></div>
          <div className="cv-float-card card-delivery"><b>Software Delivery</b><span>Check builds, tests, CI</span></div>
          <div className="cv-float-card card-invoice"><b>Invoice Risk</b><span>Verify claims and bills</span></div>

          <div className="cv-dashboard">
            <aside>
              <div className="cv-mini-brand"><ChainVerifyMark className="cv-mini-mark"/><strong>ChainVerify</strong></div>
              <span className="active">Overview</span>
              <span>Verifications</span><span>Proof Records</span><span>Integrations</span><span>Settings</span>
            </aside>
            <section>
              <div className="cv-dashboard-head">
                <div><span className="cv-check">✓</span><div><strong>Verification Complete</strong><small>AI output verified and traced to source</small></div></div>
                <button type="button">Share proof</button>
              </div>
              <div className="cv-tabs"><span>Output</span><span className="active">Evidence</span><span>Policy</span><span>Verdict</span></div>
              <div className="cv-dashboard-grid">
                <pre>{sampleJson}</pre>
                <div className="cv-evidence-list">
                  <div><i>✓</i><span><b>Source traced</b><small>Matches repository commit</small></span></div>
                  <div><i>✓</i><span><b>Policy compliant</b><small>No disallowed content</small></span></div>
                  <div><i>✓</i><span><b>Evidence attached</b><small>4 artifacts, 1 log, 2 references</small></span></div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>

      <section id="products" className="cv-products">
        {products.map(product => (
          <Link href={product.href} className={'cv-product-card ' + product.accent} key={product.name}>
            <div className="cv-product-top">
              <span className="cv-product-icon">{product.glyph}</span><span className="cv-card-arrow">→</span>
            </div>
            <h2>{product.name}</h2>
            <h3>{product.title}</h3>
            <p>{product.body}</p>
            <div className="cv-tags">{product.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
            <div className="cv-card-wave" aria-hidden="true"/>
          </Link>
        ))}
      </section>

      <section className="cv-live">
        <div className="cv-live-heading"><i/>LIVE VERIFICATIONS</div>
        <div className="cv-live-grid">
          {live.map(([glyph,label,time]) => (
            <div className="cv-live-item" key={label}><i>{glyph}</i><span><b>{label}</b><small>{time}</small></span></div>
          ))}
          <div className="cv-live-stat"><div className="bars"><i/><i/><i/><i/></div><span><b>12,458</b><small>verifications this hour</small></span></div>
        </div>
      </section>

      <section id="how-it-works" className="cv-story">
        <div className="cv-section-copy">
          <div className="cv-kicker"><i/>FROM CLAIM TO PROOF</div>
          <h2>From claim to proof in three moves.</h2>
          <p>Use the product that matches the decision you need to trust.</p>
        </div>
        <div className="cv-story-steps">
          <article><span>01</span><h3>Send the claim.</h3><p>Output, delivery statement, invoice, URL, or evidence bundle.</p></article>
          <article><span>02</span><h3>Run the checks.</h3><p>Rules, evidence, risk signals, and review context are evaluated.</p></article>
          <article><span>03</span><h3>Keep the proof.</h3><p>Return a verdict and generate a structured record you can review or export.</p></article>
        </div>
      </section>

      <section className="cv-proof-layer">
        <div>
          <div className="cv-kicker"><i/>ONE PROOF LAYER</div>
          <h2>Built for the moment AI work has to be believed.</h2>
          <p>ChainVerify is for engineering teams, AI vendors, finance teams, auditors, and operators who need more than a model response or a delivery report.</p>
        </div>
        <div className="cv-proof-metrics">
          <span><b>AI verification API</b><small>Structured verdicts</small></span>
          <span><b>AI audit trail</b><small>Reviewable evidence</small></span>
          <span><b>Invoice fraud detection</b><small>Risk before payment</small></span>
          <span><b>Agent proof records</b><small>Traceable activity</small></span>
        </div>
      </section>

      <section className="cv-final">
        <div className="cv-final-glow"/>
        <h2>When the work matters,<br/>ask for proof.</h2>
        <p>Verify the output before your users, buyers, finance team, or auditors have to trust it.</p>
        <Link href="/verify-api" className="cv-button cv-button-primary">Start with VerifyAPI <span>→</span></Link>
      </section>

      <footer className="cv-home-footer">
        <div className="cv-brand"><ChainVerifyMark className="cv-brand-mark"/><span>ChainVerify</span></div>
        <p>Independent verification for AI work and high-stakes workflows.</p>
        <div><Link href="/verify-api">VerifyAPI</Link><Link href="/audit-proof">AuditProof</Link><Link href="/invoice-proof">InvoiceProof</Link></div>
      </footer>
    </main>
  );
}
