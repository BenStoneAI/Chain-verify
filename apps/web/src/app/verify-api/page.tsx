import type { Metadata } from 'next';
import Link from 'next/link';

import ProductFooter from '@/components/proof/ProductFooter';
import ProductNav from '@/components/proof/ProductNav';
import { ProofTierLink } from '@/components/proof/ProofTierLink';
import { StripeTestModeBanner } from '@/components/proof/StripeTestModeBanner';
import { VerifyAPISandbox } from '@/components/proof/VerifyAPISandbox';

// Canonical pricing source: packages/config/src/billing.ts — verifyApiPlanConfigs
import './verify-api.css';

export const metadata: Metadata = {
  title: 'VerifyAPI — AI Said the Work Is Done. Now Prove It. | SwarmSync',
  description:
    'Independent checks on commits, builds, tests, CI, security, and fake-work patterns before you accept or release AI-generated deliveries.',
  keywords: [
    'software delivery verification',
    'AI-generated code verification',
    'CI/CD delivery checks',
    'AI code verification API',
    'software delivery proof',
    'fake work detection',
    'AI delivery validation',
    'commit verification',
  ],
  alternates: { canonical: 'https://swarmsync.ai/verify-api' },
  openGraph: {
    title: 'VerifyAPI — AI Said the Work Is Done. Now Prove It. | SwarmSync',
    description:
      'Independent checks on commits, builds, tests, CI, security, and fake-work patterns before you accept or release AI-generated deliveries.',
    url: 'https://swarmsync.ai/verify-api',
    siteName: 'SwarmSync',
    type: 'website',
    images: [{ url: 'https://swarmsync.ai/og-verify-api.png', width: 1200, height: 630, alt: 'VerifyAPI by SwarmSync' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VerifyAPI by SwarmSync',
    description: 'AI Said the Work Is Done. Now Prove It.',
    images: ['https://swarmsync.ai/og-verify-api.png'],
  },
};

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

export default function VerifyApiPage() {
  return (
    <>
      <ProductNav
        currentProduct="verify-api"
        pageAnchors={[
          { label: 'Three Questions', href: '#three-questions' },
          { label: 'Demo', href: '#demo' },
          { label: 'Verdict Cards', href: '#verdicts' },
          { label: 'Fake-work', href: '#fake-work' },
          { label: 'API', href: '#api-example' },
          { label: 'Pricing', href: '#pricing' },
        ]}
      />

      <div className="va-scope">
        <div className="page-bg" aria-hidden="true" />

        <div className="page text-slate-200">

          {/* ── S1: HERO ─────────────────────────────────────────────────── */}
          <header className="hero wrap" style={{ paddingTop: '100px' }}>
            {/*
              hero-grid: two columns. At <860px (va-scope breakpoint 980px), stacks vertically.
              Left: copy. Right: backend sandbox.
            */}
            <div className="hero-grid">
              <div className="hero-text">
                <span className="eyebrow">VerifyAPI by SwarmSync</span>
                <h1>
                  AI Said the Work Is Done.{' '}
                  <span className="accent">Now Prove It.</span>
                </h1>
                <p className="lede">
                  Independent checks on commits, builds, tests, CI, security, and fake-work patterns.
                </p>
                <div className="hero-ctas">
                  <Link
                    href="#api-example"
                    className="btn btn-primary btn-arrow"
                    aria-label="Verify a delivery — jump to API section"
                  >
                    Verify a Delivery
                    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                  <Link
                    href="#demo"
                    className="btn btn-secondary"
                    aria-label="Watch the backend sandbox"
                  >
                    Watch the Demo
                  </Link>
                </div>
                <div className="hero-trust">
                  <span className="trust-pill"><span className="dot" aria-hidden="true" />Git &amp; CI verified</span>
                  <span className="trust-pill"><span className="dot" aria-hidden="true" />Proof ID every run</span>
                  <span className="trust-pill"><span className="dot" aria-hidden="true" />Free demo: 500 req/month, no card required</span>
                </div>
              </div>

              {/* Right: backend sandbox — calls /api/verify/demo */}
              <div className="hero-visual" aria-label="VerifyAPI backend sandbox">
                <VerifyAPISandbox />
              </div>
            </div>
          </header>

          {/* ── S2: THREE QUESTIONS ───────────────────────────────────────── */}
          <section className="section wrap" id="three-questions" aria-labelledby="three-questions-heading">
            <div className="section-divider" aria-hidden="true" />
            <div className="section-head" style={{ marginTop: '88px' }}>
              <span className="eyebrow">What buyers need to know</span>
              <h2 id="three-questions-heading">Three questions every delivery must answer.</h2>
            </div>
            <div className="problem-grid" role="list">
              <article className="problem-card" role="listitem">
                <div className="tag">Question 01</div>
                <h3>Did the work happen?</h3>
                <p>Commits, branches, and history verified.</p>
              </article>
              <article className="problem-card accent" role="listitem">
                <div className="tag">Question 02</div>
                <h3>Does it actually work?</h3>
                <p>Builds and tests run independently.</p>
              </article>
              <article className="problem-card" role="listitem">
                <div className="tag">Question 03</div>
                <h3>Is it safe?</h3>
                <p>Security and CI checks enforced.</p>
              </article>
            </div>
          </section>

          {/* ── S3: BACKEND SANDBOX ──────────────────────────────────────── */}
          {/*
            This demo calls the VerifyAPI demo endpoint (/api/verify/demo)
            and displays the returned proof result. All proof IDs and statuses
            shown are generated by the real backend — nothing is fabricated.
          */}
          <section className="section wrap" id="demo" aria-labelledby="demo-heading">
            <div className="section-divider" aria-hidden="true" />
            <div className="section-head" style={{ marginTop: '88px' }}>
              <span className="eyebrow">Backend sandbox</span>
              <h2 id="demo-heading">Try a sandbox verification now.</h2>
              <p>
                Paste any AI output — JSON or plain text — and submit. This sandbox calls{' '}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>POST /api/verify/demo</span>{' '}
                and returns a backend-generated proof ID, verification status, and result.
              </p>
            </div>
            <VerifyAPISandbox />
          </section>

          {/* ── S4: WHAT BUYERS SEE — VERDICT CARDS ──────────────────────── */}
          <section className="section wrap" id="verdicts" aria-labelledby="verdicts-heading">
            <div className="section-divider" aria-hidden="true" />
            <div className="section-head" style={{ marginTop: '88px' }}>
              <span className="eyebrow">Verdict cards</span>
              <h2 id="verdicts-heading">What buyers see.</h2>
              <p>Every run returns one of three unified verdicts. No raw JSON — a clear decision.</p>
            </div>

            <div
              className="problem-grid"
              role="list"
              aria-label="Verification verdict types"
            >
              {/* VERIFIED */}
              <article
                className="problem-card"
                role="listitem"
                style={{
                  borderColor: 'var(--ok-wire)',
                  background: 'linear-gradient(180deg, var(--ok-dim) 0%, rgba(63,209,139,0.02) 100%)',
                  boxShadow: '0 0 40px rgba(63,209,139,0.07)',
                }}
              >
                <div style={{ marginBottom: '14px' }}>
                  <span
                    className="v-pill"
                    aria-label="Verdict: Verified"
                    style={{ fontSize: '12px', padding: '6px 14px' }}
                  >
                    <span className="swatch" aria-hidden="true" />
                    VERIFIED
                  </span>
                </div>
                <h3 style={{ color: 'var(--ok)', marginBottom: '10px' }}>Work evidence is present and checks passed.</h3>
                <p>
                  Commits confirmed after job start, all tests pass, CI is green, deploy SHA matches, no secrets
                  exposed, and no fake-work patterns detected.
                </p>
                <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px dashed rgba(63,209,139,0.15)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-faint)', marginBottom: '8px', letterSpacing: '0.10em', textTransform: 'uppercase' }}>Recommended action</div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--ok)', fontWeight: 600 }}>APPROVE DELIVERY</span>
                </div>
              </article>

              {/* NEEDS REVIEW */}
              <article
                className="problem-card"
                role="listitem"
                style={{
                  borderColor: 'var(--hold-wire)',
                  background: 'linear-gradient(180deg, var(--hold-dim) 0%, rgba(246,185,85,0.02) 100%)',
                  boxShadow: '0 0 40px rgba(246,185,85,0.07)',
                }}
              >
                <div style={{ marginBottom: '14px' }}>
                  <span
                    className="v-pill review"
                    aria-label="Verdict: Needs Review"
                    style={{ fontSize: '12px', padding: '6px 14px' }}
                  >
                    <span className="swatch" aria-hidden="true" />
                    NEEDS REVIEW
                  </span>
                </div>
                <h3 style={{ color: 'var(--hold)', marginBottom: '10px' }}>Something flagged — human review required.</h3>
                <p>
                  One or more warnings detected: scope drift, tests with no assertions, a stale lock file,
                  or a staging build in the production slot.
                </p>
                <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px dashed rgba(246,185,85,0.15)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-faint)', marginBottom: '8px', letterSpacing: '0.10em', textTransform: 'uppercase' }}>Recommended action</div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--hold)', fontWeight: 600 }}>HUMAN REVIEW</span>
                </div>
              </article>

              {/* FAILED */}
              <article
                className="problem-card"
                role="listitem"
                style={{
                  borderColor: 'var(--err-wire)',
                  background: 'linear-gradient(180deg, var(--err-dim) 0%, rgba(240,82,82,0.02) 100%)',
                  boxShadow: '0 0 40px rgba(240,82,82,0.07)',
                }}
              >
                <div style={{ marginBottom: '14px' }}>
                  <span
                    className="v-pill fail"
                    aria-label="Verdict: Failed"
                    style={{ fontSize: '12px', padding: '6px 14px' }}
                  >
                    <span className="swatch" aria-hidden="true" />
                    FAILED
                  </span>
                </div>
                <h3 style={{ color: 'var(--err)', marginBottom: '10px' }}>Fake work or broken delivery detected.</h3>
                <p>
                  Critical failures: tests skipped, build errors, CI pipeline failing, deploy SHA mismatch,
                  errors swallowed in catch blocks, or delivery report contradicts the diff.
                </p>
                <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px dashed rgba(240,82,82,0.15)' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-faint)', marginBottom: '8px', letterSpacing: '0.10em', textTransform: 'uppercase' }}>Recommended action</div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--err)', fontWeight: 600 }}>REJECT DELIVERY</span>
                </div>
              </article>
            </div>
          </section>

          {/* ── S5: FAKE-WORK PATTERNS ────────────────────────────────────── */}
          <section className="section wrap" id="fake-work" aria-labelledby="fake-work-heading">
            <div className="section-divider" aria-hidden="true" />
            <div className="section-head" style={{ marginTop: '88px' }}>
              <span className="eyebrow">Fake-work detection</span>
              <h2 id="fake-work-heading">Patterns VerifyAPI catches.</h2>
              <p>AI coding agents can generate plausible-looking PRs that mask missing logic. These ten patterns are checked on every run.</p>
            </div>

            <ul
              className="uses-grid"
              aria-label="Fake-work patterns detected"
              style={{ listStyle: 'none', padding: 0, margin: 0, gridTemplateColumns: 'repeat(5, 1fr)' }}
            >
              {[
                'Empty commits',
                'Failing CI merged',
                'Deleted tests',
                'Stubbed functions',
                'Hardcoded test passes',
                'No production deploy evidence',
                'Copied code',
                'Mismatched PR claims',
                'Skipped builds',
                'Fake green badges',
              ].map((pattern) => (
                <li key={pattern} className="use-tile" style={{ minHeight: 'auto', padding: '16px' }}>
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      background: 'var(--err-dim)',
                      border: '1px solid var(--err-wire)',
                      color: 'var(--err)',
                      fontSize: '13px',
                      fontWeight: 700,
                      marginBottom: '10px',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </span>
                  <h4 style={{ fontSize: '13px', marginBottom: 0 }}>{pattern}</h4>
                </li>
              ))}
            </ul>
          </section>

          {/* ── S6: API SNIPPET ───────────────────────────────────────────── */}
          <section className="section wrap" id="api-example" aria-labelledby="api-example-heading">
            <div className="section-divider" aria-hidden="true" />
            <div style={{ marginTop: '88px' }} className="api-preview">
              <div>
                <span className="eyebrow">API endpoint</span>
                <h2 id="api-example-heading" style={{ marginTop: '16px' }}>
                  One POST. One verified result.
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: 1.6, marginTop: '16px', maxWidth: '46ch' }}>
                  Drop verification directly into your CI pipeline or AI delivery workflow.
                  Send a repo URL and commit SHA — get back a structured verdict with proof ID.{' '}
                  <Link
                    href="/docs/verify-api#software-delivery-verification"
                    style={{ color: '#7C5CFF', textDecoration: 'underline', textUnderlineOffset: '3px' }}
                  >
                    Full integration docs →
                  </Link>
                </p>
                <div style={{ marginTop: '24px' }}>
                  <Link
                    href="#pricing"
                    className="btn btn-primary btn-arrow"
                    aria-label="View pricing and get an API key"
                    style={{ fontSize: '14px', padding: '11px 18px' }}
                  >
                    Get an API Key
                    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                      <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </div>
              </div>

              <div className="code-panel" role="region" aria-label="API request example">
                <div className="code-head">
                  <span className="dots" aria-hidden="true"><i /><i /><i /></span>
                  <span className="path">POST /api/verify</span>
                  <span className="right">
                    <span className="method post">POST</span>
                  </span>
                </div>
                {/* Request */}
                <div className="code-body">
                  <pre
                    aria-label="curl command for VerifyAPI"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{
                      __html: `<span style="color:var(--syn-com)"># Verify a delivery</span>
<span style="color:var(--text-secondary)">curl</span> <span style="color:var(--syn-key)">-X POST</span> https://api.swarmsync.ai/api/verify \\
  <span style="color:var(--syn-key)">-H</span> <span style="color:var(--syn-str)">"Authorization: Bearer &lt;API_KEY&gt;"</span> \\
  <span style="color:var(--syn-key)">-H</span> <span style="color:var(--syn-str)">"Content-Type: application/json"</span> \\
  <span style="color:var(--syn-key)">-d</span> <span style="color:var(--syn-str)">'{"source_type": "software_delivery", "task": "verify_delivery", "output": {"repo_url": "https://github.com/org/repo", "commit_sha": "abc123def"}, "rules": []}'</span>`,
                    }}
                  />
                </div>
                {/* Response */}
                <div className="badge-strip" aria-label="Example response">
                  <span className="label">Response</span>
                  <span className="v-pill" style={{ fontSize: '10px', padding: '4px 9px' }}><span className="swatch" aria-hidden="true" />200 OK</span>
                </div>
                <div className="code-body">
                  <pre
                    aria-label="API response JSON"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{
                      __html: `<span style="color:var(--syn-pun)">{</span>
  <span style="color:var(--syn-key)">"verdict"</span><span style="color:var(--syn-pun)">:</span>  <span style="color:var(--syn-str)">"VERIFIED"</span><span style="color:var(--syn-pun)">,</span>
  <span style="color:var(--syn-key)">"confidence"</span><span style="color:var(--syn-pun)">:</span> <span style="color:var(--syn-num)">96</span><span style="color:var(--syn-pun)">,</span>
  <span style="color:var(--syn-key)">"checks_passed"</span><span style="color:var(--syn-pun)">:</span> <span style="color:var(--syn-num)">11</span><span style="color:var(--syn-pun)">,</span>
  <span style="color:var(--syn-key)">"checks_failed"</span><span style="color:var(--syn-pun)">:</span> <span style="color:var(--syn-num)">0</span><span style="color:var(--syn-pun)">,</span>
  <span style="color:var(--syn-key)">"proof_id"</span><span style="color:var(--syn-pun)">:</span>  <span style="color:var(--syn-str)">"sdv_..."  <span style="color:var(--syn-com)">// generated per-run</span></span>
<span style="color:var(--syn-pun)">}</span>`,
                    }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── S7: PRICING ───────────────────────────────────────────────── */}
          {/* Canonical plan data: packages/config/src/billing.ts — verifyApiPlanConfigs */}
          <section className="section wrap" id="pricing" aria-labelledby="pricing-heading">
            <div className="section-divider" aria-hidden="true" />
            <div className="section-head" style={{ marginTop: '88px', textAlign: 'center', maxWidth: 'none' }}>
              <span className="eyebrow">Pricing</span>
              <h2 id="pricing-heading" style={{ marginTop: '16px' }}>VerifyAPI subscriptions.</h2>
              <p style={{ margin: '12px auto 0', maxWidth: '52ch' }}>
                Pay based on monthly verification volume. Proof ID on every run. Cancel anytime.
              </p>
            </div>

            <div className="tiers" role="list" aria-label="VerifyAPI pricing tiers">
              {[
                {
                  name: 'Free',
                  price: '$0',
                  per: '/mo',
                  summary: 'Build the integration, ship a prototype.',
                  runs: '500 runs / mo',
                  retention: '30-day retention',
                  hardCap: null,
                  featured: false,
                  slug: 'free',
                },
                {
                  name: 'Build',
                  price: '$99',
                  per: '/mo',
                  summary: 'Steady verification stream for smaller apps.',
                  runs: '5,000 runs / mo',
                  retention: '90-day retention',
                  hardCap: null,
                  featured: false,
                  slug: 'verify-api-build',
                },
                {
                  name: 'Scale',
                  price: '$499',
                  per: '/mo',
                  summary: 'Steady production volume for active products.',
                  runs: '50,000 verification runs / month',
                  retention: '3-year retention',
                  overage: null,
                  hardCap: 'Hard monthly cap · Contact us for higher volume',
                  featured: true,
                  slug: 'verify-api-scale',
                },
                {
                  name: 'Production',
                  price: '$1,200',
                  per: '/mo',
                  summary: 'Defensible records at enterprise scale.',
                  runs: '250,000 verification runs / month',
                  retention: '7-year retention',
                  overage: null,
                  hardCap: 'Hard monthly cap · Contact us for higher volume',
                  featured: false,
                  slug: 'verify-api-production',
                },
              ].map((tier) => (
                <div key={tier.slug} className={`tier${tier.featured ? ' featured' : ''}`} role="listitem">
                  <div>
                    <div className="tname">{tier.name}</div>
                    <div className="price">
                      {tier.price}
                      <span className="per">{tier.per}</span>
                    </div>
                    <p className="summary">{tier.summary}</p>
                    <ul aria-label={`${tier.name} plan features`}>
                      <li>
                        <span className="ck" aria-hidden="true"><CheckIcon /></span>
                        {tier.runs}
                      </li>
                      <li>
                        <span className="ck" aria-hidden="true"><CheckIcon /></span>
                        Proof ID on every result
                      </li>
                      <li>
                        <span className="ck" aria-hidden="true"><CheckIcon /></span>
                        {tier.retention}
                      </li>
                      {tier.hardCap && (
                        <li>
                          <span className="ck" aria-hidden="true"><CheckIcon /></span>
                          {tier.hardCap}
                        </li>
                      )}
                    </ul>
                  </div>
                  <ProofTierLink
                    product="verify-api"
                    planSlug={tier.slug}
                    className="tcta"
                  >
                    {tier.name === 'Free' ? 'Start free' : `Subscribe (${tier.price}/mo)`}
                  </ProofTierLink>
                  {tier.name !== 'Free' && (
                    <Link
                      href="/start/verify-api"
                      style={{
                        display: 'block',
                        textAlign: 'center',
                        marginTop: '8px',
                        fontSize: '12px',
                        color: 'var(--text-secondary, rgba(255,255,255,0.5))',
                        textDecoration: 'underline',
                        textUnderlineOffset: '3px',
                      }}
                    >
                      Request a free pilot instead
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ── S8: FINAL CTA ─────────────────────────────────────────────── */}
          <section className="final wrap" aria-labelledby="final-cta-heading">
            <h2 id="final-cta-heading">
              Don&apos;t trust the delivery report.{' '}
              <span className="accent">Verify it.</span>
            </h2>
            <p>
              Every AI-generated delivery should come with proof. VerifyAPI gives buyers and agents a single,
              independent source of truth.
            </p>
            <div className="final-ctas">
              <Link
                href="#api-example"
                className="btn btn-primary btn-arrow"
                aria-label="Verify a delivery — jump to API section"
              >
                Verify a Delivery
                <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <Link
                href="#pricing"
                className="btn btn-secondary"
                aria-label="View VerifyAPI pricing"
              >
                View Pricing
              </Link>
            </div>
          </section>

        </div>

        <ProductFooter currentProduct="verify-api" />
        <StripeTestModeBanner />
      </div>
    </>
  );
}
