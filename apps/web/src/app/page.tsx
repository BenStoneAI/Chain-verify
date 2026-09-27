import Image from 'next/image';
import Link from 'next/link';

const products = [
  {
    name: 'VerifyAPI',
    href: '/verify-api',
    accent: 'mint',
    title: 'Verify AI output before users rely on it.',
    body: 'Check AI outputs and software-delivery claims against rules, evidence, and acceptance criteria. Return a structured verdict, issues, confidence, and proof ID.'
  },
  {
    name: 'AuditProof',
    href: '/audit-proof',
    accent: 'sky',
    title: 'Prove what your AI did — and who approved it.',
    body: 'Capture agent execution evidence, human oversight, policy context, and a reviewable proof record for clients, investors, auditors, and governance teams.'
  },
  {
    name: 'InvoiceProof',
    href: '/invoice-proof',
    accent: 'amber',
    title: 'Catch invoice risk before money moves.',
    body: 'Flag duplicate invoices, vendor and PO mismatches, and bank-change risk, then generate structured evidence your finance team can review.'
  }
];

const proofRows = [
  ['Input / output pair', 'Captured'],
  ['Policy checks', '8 / 8 passed'],
  ['Evidence links', 'Attached'],
  ['Human review', 'Recorded'],
  ['Proof record', 'Generated']
];

export default function HomePage() {
  return (
    <main>
      <header className="site-nav">
        <Link href="/" className="brand" aria-label="ChainVerify home">
          <Image src="/chainverify-logo.svg" alt="ChainVerify" width={176} height={42} priority className="brand-logo" />
        </Link>
        <nav aria-label="Primary">
          <Link href="#products">Products</Link>
          <Link href="#how-it-works">How it works</Link>
          <Link href="#proof">Proof model</Link>
          <Link href="/verify-api">API</Link>
        </nav>
        <Link href="/verify-api#pricing" className="nav-cta">Start verifying</Link>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <h1>Don’t trust the output. <span>Verify it.</span></h1>
          <p>
            AI can say the work is done. ChainVerify gives you independent evidence that it actually is —
            across software delivery, agent activity, and finance workflows.
          </p>
          <div className="hero-actions">
            <Link href="/verify-api" className="button primary">Verify AI output</Link>
            <Link href="#products" className="button secondary">Explore proof products</Link>
          </div>
          <div className="trust-line">
            <span>Independent</span><span>Reviewable</span><span>Exportable</span>
          </div>
        </div>

        <div className="proof-console" id="proof" aria-label="Illustrative verification record">
          <div className="console-top">
            <span className="window-dots" aria-hidden="true">● ● ●</span>
            <span className="status"><i />VERIFIED</span>
          </div>
          <div className="proof-id">proof_7f42c9e8</div>
          {proofRows.map(([label,value]) => (
            <div className="proof-row" key={label}>
              <span>{label}</span><strong>{value}</strong>
            </div>
          ))}
          <div className="chain-seal">
            <span>CHAIN HASH</span>
            <code>83fe…a14c</code>
          </div>
        </div>
      </section>

      <section className="proof-strip" aria-label="What ChainVerify verifies">
        <span>AI OUTPUT</span><span>SOFTWARE DELIVERY</span><span>AGENT ACTIONS</span><span>INVOICE RISK</span>
      </section>

      <section id="products" className="section products">
        <div className="section-head">
          <h2>Three verification products. One proof layer.</h2>
          <p>Use the product that matches the decision you need to trust.</p>
        </div>
        <div className="bento">
          {products.map((product, index) => (
            <article className={"product-card "+product.accent+(index===0?" featured":"")} key={product.name}>
              <div>
                <div className="product-name">{product.name}</div>
                <h3>{product.title}</h3>
                <p>{product.body}</p>
              </div>
              <Link href={product.href}>Open {product.name} <span>→</span></Link>
            </article>
          ))}
          <aside className="mechanism-card">
            <div className="pulse-line"><i/><i/><i/><i/></div>
            <h3>Evidence becomes a proof record.</h3>
            <p>Each run can store structured evidence, verification status, confidence, and a chain-linked record that can be reviewed later.</p>
          </aside>
        </div>
      </section>

      <section id="how-it-works" className="section process">
        <div className="section-head">
          <h2>From claim to proof in three moves.</h2>
        </div>
        <div className="process-grid">
          <div><strong>Send the claim.</strong><p>Output, delivery statement, invoice, URL, or evidence bundle.</p></div>
          <div><strong>Run the checks.</strong><p>Rules, evidence, risk signals, and review context are evaluated.</p></div>
          <div><strong>Keep the proof.</strong><p>Return a verdict and generate a structured record you can review or export.</p></div>
        </div>
      </section>

      <section className="section seo-grid">
        <div>
          <h2>Built for the moment AI work has to be believed.</h2>
          <p>ChainVerify is for engineering teams, AI vendors, finance teams, auditors, and operators who need more than a model response or a delivery report.</p>
        </div>
        <div className="seo-points">
          <span>AI verification API</span>
          <span>AI audit trail</span>
          <span>software delivery verification</span>
          <span>invoice fraud detection</span>
          <span>AI governance evidence</span>
          <span>proof records for agent work</span>
        </div>
      </section>

      <section className="final-cta">
        <h2>When the work matters, ask for proof.</h2>
        <p>Verify the output before your users, buyers, finance team, or auditors have to trust it.</p>
        <Link href="/verify-api" className="button primary">Start with VerifyAPI</Link>
      </section>

      <footer>
        <div className="brand footer-brand"><Image src="/chainverify-logo.svg" alt="ChainVerify" width={164} height={40} className="brand-logo" /></div>
        <p>Independent verification for AI work and high-stakes workflows.</p>
        <div><Link href="/audit-proof">AuditProof</Link><Link href="/invoice-proof">InvoiceProof</Link><Link href="/verify-api">VerifyAPI</Link></div>
      </footer>
    </main>
  );
}
