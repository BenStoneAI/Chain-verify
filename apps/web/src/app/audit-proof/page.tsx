import type { Metadata } from 'next';
import Link from 'next/link';

import ProductFooter from '@/components/proof/ProductFooter';
import ProductNav from '@/components/proof/ProductNav';
import { ProofTierLink } from '@/components/proof/ProofTierLink';
import { StripeTestModeBanner } from '@/components/proof/StripeTestModeBanner';
import { getProofProductMarketing } from '@/lib/proof-products/marketing';
// Pricing tiers sourced from packages/config/src/billing.ts (auditProofPlanConfigs).
// Confirm exact per-seat prices with billing team before launch.
import './audit-proof.css';

const auditProofMarketing = getProofProductMarketing('audit-proof');

export const metadata: Metadata = {
  title: 'AuditProof by SwarmSync — Prove your AI work to clients and regulators',
  description: auditProofMarketing.description,
  keywords: [
    'EU AI Act Article 12',
    'AI audit trail',
    'AI compliance logging',
    'high-risk AI documentation',
    'AI decision proof records',
    'AI agent audit',
    'AI governance records',
    'AI work verification',
  ],
  alternates: { canonical: 'https://swarmsync.ai/audit-proof' },
  openGraph: {
    title: 'AuditProof by SwarmSync — Prove your AI work to clients and regulators',
    description: auditProofMarketing.description,
    url: 'https://swarmsync.ai/audit-proof',
    siteName: 'SwarmSync',
    type: 'website',
    images: [
      {
        url: 'https://swarmsync.ai/og-audit-proof.png',
        width: 1200,
        height: 630,
        alt: 'AuditProof by SwarmSync',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AuditProof by SwarmSync',
    description: 'Hand clients and regulators independent proof that your AI work is real.',
    images: ['https://swarmsync.ai/og-audit-proof.png'],
  },
};

export default function AuditProofPage() {
  return (
    <>
      <ProductNav
        currentProduct="audit-proof"
        pageAnchors={[
          { label: 'What it captures', href: '#what-it-captures' },
          { label: 'How it works', href: '#how-it-works' },
          { label: 'Sample report', href: '#sample-report' },
          { label: 'API', href: '#api-snippet' },
          { label: 'Pricing', href: '#pricing' },
        ]}
      />
      <div className="ap-scope">
        <div className="page-bg" aria-hidden="true" />

        <div className="page text-slate-200">
          {/* ── S1: HERO ─────────────────────────────────────────────── */}
          <header className="hero wrap" style={{ paddingTop: '100px' }}>
            <div className="hero-grid">
              {/* Left copy */}
              <div className="hero-text">
                <span className="eyebrow">Proof for the people you answer to</span>
                <h1>
                  Show your AI work
                  <br />
                  is <span className="accent">real.</span>
                </h1>
                <p className="lede">
                  When a client, investor, or regulator asks how your AI did the work, hand them an
                  independent proof record — not your word for it.
                </p>
                <div className="hero-ctas">
                  <Link
                    href="#api-snippet"
                    className="btn btn-primary btn-arrow"
                    aria-label="Generate Audit Proof — jump to API snippet"
                  >
                    Generate Audit Proof
                    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path
                        d="M3 7h8M7 3l4 4-4 4"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Link>
                  <Link href="#sample-report" className="btn btn-secondary">
                    See a Sample Report
                  </Link>
                </div>
                <div className="hero-trust" aria-label="Trust signals">
                  <span className="trust-pill">
                    <span className="dot" aria-hidden="true" />
                    Independent
                  </span>
                  <span className="trust-pill">
                    <span className="dot" aria-hidden="true" />
                    Reviewable
                  </span>
                  <span className="trust-pill">
                    <span className="dot" aria-hidden="true" />
                    Exportable
                  </span>
                </div>
              </div>

              {/* Right: floating console card wrapping the demo */}
              <div className="hero-visual" aria-label="Audit verification sample">
                {/* Console chrome wrapper */}
                <div
                  style={{
                    background: 'linear-gradient(180deg,#0d1021 0%,#080c18 100%)',
                    border: '1px solid rgba(124,92,255,0.28)',
                    borderRadius: '14px',
                    boxShadow:
                      '0 32px 80px rgba(0,0,0,0.65), 0 0 48px rgba(124,92,255,0.12), 0 1px 0 rgba(255,255,255,0.04) inset',
                    overflow: 'hidden',
                  }}
                >
                  {/* Faux title bar */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 14px',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      background: 'rgba(255,255,255,0.025)',
                    }}
                    aria-hidden="true"
                  >
                    {/* Traffic lights */}
                    <span style={{ display: 'inline-flex', gap: '5px' }}>
                      <i
                        style={{
                          display: 'block',
                          width: '9px',
                          height: '9px',
                          borderRadius: '999px',
                          background: '#F05252',
                          opacity: 0.75,
                        }}
                      />
                      <i
                        style={{
                          display: 'block',
                          width: '9px',
                          height: '9px',
                          borderRadius: '999px',
                          background: '#F6B955',
                          opacity: 0.75,
                        }}
                      />
                      <i
                        style={{
                          display: 'block',
                          width: '9px',
                          height: '9px',
                          borderRadius: '999px',
                          background: '#3FD18B',
                          opacity: 0.75,
                        }}
                      />
                    </span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                        fontSize: '11px',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: '#3FD18B',
                      }}
                    >
                      {/* Pulsing dot */}
                      <span
                        style={{
                          display: 'block',
                          width: '6px',
                          height: '6px',
                          borderRadius: '999px',
                          background: '#3FD18B',
                          boxShadow: '0 0 8px #3FD18B',
                          animation: 'ap-pulse 1.6s ease-in-out infinite',
                        }}
                        aria-hidden="true"
                      />
                      Verifying
                    </span>
                  </div>

                  {/* Example output (illustrative — not a real run result) */}
                  <div
                    style={{ padding: '18px' }}
                    aria-label="Example output — illustrative only"
                    role="img"
                  >
                    <p
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: 'rgba(255,255,255,0.35)',
                        marginBottom: '12px',
                      }}
                      aria-hidden="true"
                    >
                      Example output — illustrative
                    </p>
                    {[
                      { label: 'Agent identity verified', sub: 'Identity check · passed' },
                      { label: 'Input / output pair captured', sub: 'Evidence linked · passed' },
                      { label: 'Human approval recorded', sub: 'Approval timestamp · passed' },
                      { label: 'Policy rules checked', sub: '8 of 8 rules · passed' },
                      { label: 'Proof record prepared', sub: 'Export-ready sample state' },
                    ].map((row) => (
                      <div
                        key={row.label}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '10px',
                          padding: '9px 0',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                        }}
                      >
                        <span
                          style={{
                            flexShrink: 0,
                            width: '18px',
                            height: '18px',
                            borderRadius: '50%',
                            background: 'rgba(63,209,139,0.12)',
                            border: '1px solid rgba(63,209,139,0.35)',
                            color: '#3FD18B',
                            fontSize: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: '1px',
                          }}
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                        <span>
                          <span
                            style={{
                              display: 'block',
                              fontSize: '12px',
                              color: 'rgba(255,255,255,0.75)',
                              fontWeight: 500,
                            }}
                          >
                            {row.label}
                          </span>
                          <span
                            style={{
                              display: 'block',
                              fontSize: '11px',
                              color: 'rgba(255,255,255,0.35)',
                              fontFamily: 'var(--font-mono)',
                              marginTop: '2px',
                            }}
                          >
                            {row.sub}
                          </span>
                        </span>
                      </div>
                    ))}
                    <div
                      style={{
                        marginTop: '14px',
                        padding: '8px 12px',
                        borderRadius: '7px',
                        background: 'rgba(63,209,139,0.07)',
                        border: '1px solid rgba(63,209,139,0.25)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      <span style={{ color: '#3FD18B', fontWeight: 700 }}>VERIFIED</span>
                      <span style={{ color: 'rgba(255,255,255,0.35)' }}>5 / 5 checks</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          {/* ── S2: WHAT IT CAPTURES ─────────────────────────────────── */}
          <section className="section wrap" id="what-it-captures" aria-labelledby="s2-heading">
            <div className="section-divider" aria-hidden="true" style={{ marginBottom: '88px' }} />
            <div className="section-head">
              <span className="eyebrow">What it captures</span>
              <h2 id="s2-heading">Three things a reviewer asks you to prove.</h2>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '16px',
              }}
              className="capture-grid"
            >
              {[
                {
                  icon: (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ width: '16px', height: '16px' }}
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                    </svg>
                  ),
                  title: 'What the agent did',
                  body: 'Every action logged in sequence, so reviewers can follow exactly what happened.',
                },
                {
                  icon: (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ width: '16px', height: '16px' }}
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ),
                  title: 'Who signed off',
                  body: 'Human approvals recorded with timestamps, so oversight is on the record.',
                },
                {
                  icon: (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{ width: '16px', height: '16px' }}
                      aria-hidden="true"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                  ),
                  title: 'Evidence you can hand over',
                  body: 'Export a structured proof record to send to a client, investor, or auditor.',
                },
              ].map((card) => (
                <article
                  key={card.title}
                  className="check-card"
                  style={{ minHeight: 'unset', padding: '28px 24px' }}
                >
                  <div className="check-icon" aria-hidden="true">
                    {card.icon}
                  </div>
                  <h3 style={{ fontSize: '17px', marginBottom: '8px' }}>{card.title}</h3>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{card.body}</p>
                </article>
              ))}
            </div>
          </section>

          {/* ── S3: HOW IT WORKS ─────────────────────────────────────── */}
          <section className="section wrap" id="how-it-works" aria-labelledby="s3-heading">
            <div className="section-divider" aria-hidden="true" style={{ marginBottom: '88px' }} />
            <div className="section-head">
              <span className="eyebrow">How it works</span>
              <h2 id="s3-heading">Three steps from agent run to proof record.</h2>
            </div>
            <ol
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '16px',
              }}
              aria-label="How AuditProof works"
            >
              {[
                {
                  n: '1',
                  title: 'Agent does work',
                  desc: 'The agent completes its task. Inputs, outputs, and execution telemetry are captured when provided.',
                },
                {
                  n: '2',
                  title: 'Evidence cross-checked',
                  desc: 'Policy rules run automatically. Human approvals are verified. Risk is scored against configured thresholds.',
                },
                {
                  n: '3',
                  title: 'Proof you can send',
                  desc: 'A structured proof record is generated for you to share with a client, investor, or auditor. Export as JSON or PDF where the backend route supports it.',
                },
              ].map((step) => (
                <li
                  key={step.n}
                  className="flow-step"
                  style={{ minHeight: 'unset', padding: '28px 24px' }}
                >
                  <span className="num" aria-hidden="true">
                    {step.n}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.desc}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* ── S4: SAMPLE REPORT CARD ───────────────────────────────── */}
          <section className="section wrap" id="sample-report" aria-labelledby="s4-heading">
            <div className="section-divider" aria-hidden="true" style={{ marginBottom: '88px' }} />
            <div className="section-head">
              <span className="eyebrow">Example report</span>
              <h2 id="s4-heading" className="sr-only">
                Sample audit report
              </h2>
            </div>

            {/* Sample VERIFIED report card */}
            <div style={{ maxWidth: '640px' }} aria-label="Sample audit report in VERIFIED state">
              <div
                className="audit-card"
                style={{
                  border: '1px solid rgba(63,209,139,0.38)',
                  boxShadow: '0 0 40px rgba(63,209,139,0.10), 0 30px 80px rgba(0,0,0,0.65)',
                }}
              >
                {/* Console title bar */}
                <div className="live-strip" aria-hidden="true">
                  <span className="dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: 'var(--text-faint)',
                      letterSpacing: '0.08em',
                    }}
                  >
                    AuditProof — Sample Report
                  </span>
                  <span className="pulse">Sample</span>
                </div>

                {/* Report header */}
                <div className="audit-head">
                  <div className="audit-head-l">
                    <div className="label">
                      Proof ID <span className="id">{auditProofMarketing.sample.proofId}</span>
                    </div>
                    <div className="vendor">DataExtractor-v2 — extract_invoice_fields</div>
                    <div className="meta">
                      Sample session · Sample agent · illustrative timestamp
                    </div>
                  </div>
                  <div className="audit-head-r">
                    <div className="score">
                      <span className="lbl">Conf.</span> 97%
                    </div>
                    <span className="risk-badge" aria-label="Risk level: LOW">
                      <span className="swatch" aria-hidden="true" />
                      LOW RISK
                    </span>
                  </div>
                </div>

                {/* Checks */}
                <div className="sec-label">Evidence checks</div>
                <div className="events" role="list" aria-label="Audit evidence trail">
                  {[
                    {
                      label: 'Agent Identity Verified',
                      sub: 'DataExtractor-v2 · agent_abc123',
                      time: '09:14:01',
                    },
                    {
                      label: 'Input/Output Pair Captured',
                      sub: 'Evidence linked for review',
                      time: '09:14:02',
                    },
                    {
                      label: 'Human Approval Recorded',
                      sub: 'jane.smith@corp.com · APPROVED',
                      time: '09:14:08',
                    },
                    {
                      label: 'Policy Rules Passed',
                      sub: '8 / 8 sample policy checks',
                      time: '09:14:09',
                    },
                    {
                      label: 'Proof Record Prepared',
                      sub: 'Backend export state shown as a sample',
                      time: '09:14:10',
                    },
                  ].map((ev) => (
                    <div key={ev.label} className="event-row done" role="listitem">
                      <span
                        className="dot"
                        aria-label="Passed"
                        style={{
                          background: 'var(--ok-dim)',
                          borderColor: 'var(--ok-wire)',
                          color: 'var(--ok)',
                        }}
                      >
                        ✓
                      </span>
                      <span className="label">
                        {ev.label}
                        <span className="sub">{ev.sub}</span>
                      </span>
                      <span className="t">{ev.time}</span>
                    </div>
                  ))}
                </div>

                {/* Outcome */}
                <div className="reco" role="status" aria-label="Proof outcome: VERIFIED">
                  <span className="reco-icon" aria-hidden="true">
                    ✓
                  </span>
                  <div>
                    <div className="reco-title">Outcome: VERIFIED</div>
                    <div className="reco-body">
                      All 8 sample checks passed. Proof record ready for backend export.
                    </div>
                  </div>
                </div>

                {/* VERIFIED badge strip */}
                <div
                  style={{
                    marginTop: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'rgba(63,209,139,0.06)',
                    border: '1px solid rgba(63,209,139,0.25)',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--ok)',
                  }}
                  aria-label="Report status: VERIFIED with 97% confidence"
                >
                  <span>VERIFIED</span>
                  <span style={{ color: 'var(--text-faint)' }}>Confidence: 97%</span>
                </div>
              </div>
            </div>
          </section>

          {/* ── S5: API SNIPPET ──────────────────────────────────────── */}
          <section className="section wrap" id="api-snippet" aria-labelledby="s5-heading">
            <div className="section-divider" aria-hidden="true" style={{ marginBottom: '88px' }} />
            <div className="section-head">
              <span className="eyebrow">Developer API</span>
              <h2 id="s5-heading">One call to generate a proof.</h2>
              <p>
                Wire it into your delivery workflow, then export proof records to attach to a client
                report, data room, or audit response.
              </p>
            </div>

            <div
              style={{
                background: '#080c14',
                border: '1px solid rgba(124,92,255,0.22)',
                borderRadius: '12px',
                overflow: 'hidden',
                maxWidth: '780px',
              }}
              role="region"
              aria-label="API example"
            >
              {/* Tab bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  background: 'rgba(255,255,255,0.025)',
                  padding: '0 16px',
                }}
                aria-hidden="true"
              >
                <span
                  style={{
                    padding: '10px 14px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    color: 'var(--accent-soft)',
                    borderBottom: '2px solid var(--accent)',
                    letterSpacing: '0.04em',
                  }}
                >
                  cURL
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--text-faint)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  POST /api/verify
                </span>
              </div>

              {/* Code block */}
              <pre
                style={{
                  margin: 0,
                  padding: '20px 22px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  lineHeight: '1.65',
                  color: '#c9d1e0',
                  overflowX: 'auto',
                  whiteSpace: 'pre',
                  tabSize: 2,
                }}
                aria-label="cURL example for generating audit proof"
              >
                <code>{`curl -X POST https://api.swarmsync.ai/api/verify \\
  -H "Authorization: Bearer <API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source_type": "agent_session",
    "task": "audit_proof",
    "output": {
      "agent_id":   "agent_abc123",
      "session_id": "sess_xyz789"
    },
    "rules": ["identity_verified", "io_captured", "policy_checks"]
  }'`}</code>
              </pre>
            </div>

            <p
              style={{
                marginTop: '16px',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--text-faint)',
                letterSpacing: '0.06em',
              }}
            >
              Returns a backend-generated <code style={{ color: 'var(--accent-soft)' }}>proof_id</code> and export links when available.
            </p>
          </section>

          {/* ── S6: PRICING ──────────────────────────────────────────── */}
          {/*
            Tier slugs map to auditProofPlanConfigs in packages/config/src/billing.ts.
            Confirm monthly prices (auditproof-comply, auditproof-govern, auditproof-certify)
            with the billing team before launch — placeholder figures used below.
          */}
          <section className="section wrap" id="pricing" aria-labelledby="s6-heading">
            <div className="section-divider" aria-hidden="true" style={{ marginBottom: '88px' }} />
            <div className="section-head">
              <span className="eyebrow">Pricing</span>
              <h2 id="s6-heading">Predictable rates. No user-seat fees.</h2>
              <p>Billed per agent run. No take-rate on your outputs.</p>
            </div>

            {/* Compact 2-column pricing table */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '12px',
                maxWidth: '860px',
              }}
              role="list"
              aria-label="AuditProof pricing tiers"
            >
              {[
                {
                  slug: 'auditproof-comply',
                  name: 'Comply',
                  price: '$1,800',
                  per: '/mo',
                  runs: '500 agent runs / mo',
                  features: [
                    'Structured evidence packages',
                    'Proof ID per run',
                    'JSON export where available',
                    '12-month retention',
                  ],
                  featured: false,
                },
                {
                  slug: 'auditproof-govern',
                  name: 'Govern',
                  price: '$4,500',
                  per: '/mo',
                  runs: '2,000 agent runs / mo',
                  features: [
                    'Custom report templates',
                    'Full API + Webhook access',
                    'Slack & email alerts',
                    '36-month retention',
                  ],
                  featured: true,
                },
                {
                  slug: 'auditproof-certify',
                  name: 'Certify',
                  price: '$9,000',
                  per: '/mo',
                  runs: '10,000 agent runs / mo',
                  features: [
                    'Board-ready governance reports',
                    'Regulator export helper',
                    'Dedicated compliance CSM',
                    '84-month retention',
                  ],
                  featured: false,
                },
                {
                  slug: 'auditproof-enterprise',
                  name: 'Enterprise',
                  price: 'Custom',
                  per: '',
                  runs: 'Unlimited runs',
                  features: [
                    'SLA-backed uptime',
                    'On-prem / VPC deployment',
                    'Custom compliance rulesets',
                    'Dedicated support',
                  ],
                  featured: false,
                },
              ].map((tier) => (
                <div
                  key={tier.slug}
                  className={`tier${tier.featured ? ' featured' : ''}`}
                  role="listitem"
                  aria-label={`${tier.name} plan`}
                >
                  <div className="tname">{tier.name}</div>
                  <div className="price">
                    {tier.price}
                    {tier.per && <span className="per">{tier.per}</span>}
                  </div>
                  <div className="summary">{tier.runs}</div>
                  <ul aria-label={`${tier.name} features`}>
                    {tier.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  {tier.slug === 'auditproof-enterprise' ? (
                    <Link
                      href="mailto:proof@swarmsync.ai"
                      className="tcta"
                      style={{
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: '18px',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid var(--border-base)',
                        color: 'var(--text-primary)',
                        fontSize: '13.5px',
                        fontWeight: 500,
                      }}
                    >
                      Contact us
                    </Link>
                  ) : (
                    <>
                      <ProofTierLink product="audit-proof" planSlug={tier.slug} className="tcta">
                        Subscribe ({tier.price}/mo)
                      </ProofTierLink>
                      <Link
                        href="/start/audit-proof"
                        style={{
                          display: 'block',
                          textAlign: 'center',
                          marginTop: '8px',
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          textDecoration: 'underline',
                          textUnderlineOffset: '3px',
                        }}
                      >
                        Request a free pilot instead
                      </Link>
                    </>
                  )}
                </div>
              ))}
            </div>

            <p className="tiers-note" style={{ marginTop: '24px' }}>
              All tiers include structured proof records, JSON export where available, and API access. Enterprise
              pricing available on request —{' '}
              <a
                href="mailto:proof@swarmsync.ai"
                style={{ color: 'var(--accent-soft)', textDecoration: 'none' }}
              >
                proof@swarmsync.ai
              </a>
            </p>
          </section>

          {/* ── S7: FINAL CTA ────────────────────────────────────────── */}
          <section className="final wrap" aria-labelledby="s7-heading">
            <p
              className="eyebrow"
              style={{ display: 'block', marginBottom: '16px', textAlign: 'center' }}
            >
              AuditProof
            </p>
            <h2 id="s7-heading">Independent. Reviewable. Exportable.</h2>
            <div className="final-ctas">
              <Link
                href="#api-snippet"
                className="btn btn-primary btn-arrow"
                aria-label="Generate Audit Proof — jump to API snippet"
              >
                Generate Audit Proof
                <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path
                    d="M3 7h8M7 3l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <a href="/verify-api" className="btn btn-secondary">
                Explore VerifyAPI
              </a>
            </div>
          </section>

          {/* Related products */}
          <section className="related wrap" aria-labelledby="related-heading">
            <div className="section-head" style={{ marginBottom: '32px' }}>
              <span className="eyebrow">SwarmSync Proof Suite</span>
              <h2 id="related-heading" style={{ fontSize: '28px' }}>
                More proof products.
              </h2>
            </div>
            <div className="related-grid">
              <Link className="related-card" href="/invoice-proof">
                <div className="label">
                  <span className="ic" aria-hidden="true">
                    IP
                  </span>
                  Invoice Proof
                </div>
                <h3>
                  <span className="pname">InvoiceProof</span>
                </h3>
                <p>AI invoice review your finance team can prove.</p>
                <span className="go">
                  View product
                  <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2 6h8M6 2l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </Link>
              <Link className="related-card" href="/verify-api">
                <div className="label">
                  <span className="ic" aria-hidden="true">
                    VA
                  </span>
                  Verify API
                </div>
                <h3>
                  <span className="pname">VerifyAPI</span>
                </h3>
                <p>Verify AI outputs before your users rely on them.</p>
                <span className="go">
                  View product
                  <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path
                      d="M2 6h8M6 2l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </Link>
            </div>
          </section>
        </div>

        <ProductFooter currentProduct="audit-proof" />
        <StripeTestModeBanner />
      </div>
    </>
  );
}
