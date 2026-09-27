'use client';

import { useState } from 'react';
import Link from 'next/link';

import InvoiceForm from '@/components/proof/InvoiceForm';
import ProductFooter from '@/components/proof/ProductFooter';
import ProductNav from '@/components/proof/ProductNav';
import { ProofCheckoutButton } from '@/components/proof/ProofCheckoutButton';
import { StripeTestModeBanner } from '@/components/proof/StripeTestModeBanner';
import { getProofProductMarketing } from '@/lib/proof-products/marketing';

// Pricing sourced from packages/config/src/billing.ts invoiceProofPlanConfigs.
// Prices below are display values — canonical plan slugs drive Stripe checkout.
const invoiceProofMarketing = getProofProductMarketing('invoiceproof');

const PRICING_TIERS = [
  { slug: 'invoiceproof-pilot', name: 'Pilot', invoices: 100, price: '$750', note: 'one-time' },
  { slug: 'invoiceproof-verify', name: 'Verify', invoices: 500, price: '$1,500', note: '/mo' },
  { slug: 'invoiceproof-protect', name: 'Protect', invoices: 2500, price: '$3,500', note: '/mo' },
  { slug: 'invoiceproof-govern', name: 'Govern', invoices: 10000, price: '$7,500', note: '/mo' },
] as const;

const CATCHES = [
  {
    title: 'Duplicate Invoices',
    desc: 'Same invoice billed twice, caught.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4"
        aria-hidden="true"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    ),
  },
  {
    title: 'PO Mismatches',
    desc: "Line items that don't reconcile.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4"
        aria-hidden="true"
      >
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    title: 'Bank-Change Fraud',
    desc: 'Vendor banking details changed mid-stream.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4"
        aria-hidden="true"
      >
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <line x1="2" y1="10" x2="22" y2="10" />
      </svg>
    ),
  },
  {
    title: 'Payment Anomalies',
    desc: 'Amounts that break the math.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-4 h-4"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
] as const;

const HOW_IT_WORKS = [
  {
    num: '01',
    title: 'Submit invoices',
    desc: 'Upload an invoice PDF, send structured JSON, or paste CSV via the API or dashboard.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    num: '02',
    title: 'Evidence cross-checked',
    desc: 'A rule engine checks for duplicates, bank-detail changes, missing POs, and round-number anomalies across the invoices you submit.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    num: '03',
    title: 'Risk verdict issued',
    desc: 'A backend-generated Proof ID is issued for every verification run you can reference later.',
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
] as const;

export default function InvoiceProofClient() {
  const [fraudMode, setFraudMode] = useState(false);

  return (
    <>
      <ProductNav
        currentProduct="invoice-proof"
        pageAnchors={[
          { label: 'What it catches', href: '#what-it-catches' },
          { label: 'How it works', href: '#how-it-works' },
          { label: 'Example report', href: '#example-report' },
          { label: 'API', href: '#api' },
          { label: 'Pricing', href: '#pricing' },
        ]}
      />

      <div className="ip-scope">
        <div className="page-bg" aria-hidden="true" />

        <div className="page text-slate-200">
          {/* ── S1: HERO ── */}
          <header className="section wrap" style={{ paddingTop: '96px', paddingBottom: '80px' }}>
            <div
              className="hero-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,1fr)',
                gap: '64px',
                alignItems: 'center',
              }}
            >
              {/* Left: copy */}
              <div className="hero-text">
                <span className="eyebrow" style={{ marginBottom: '22px' }}>
                  Invoice Verification
                </span>

                <h1>
                  Catch invoice risk
                  <br />
                  <span className="accent">before you pay</span>
                </h1>

                <p className="lede" style={{ margin: '22px 0 32px' }}>
                  {invoiceProofMarketing.description}
                </p>

                <div className="hero-ctas">
                  <Link
                    href="#demo"
                    className="btn btn-primary btn-arrow"
                    aria-label="Verify an invoice in the sandbox"
                  >
                    Verify an Invoice
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
                  <Link href="#example-report" className="btn btn-secondary">
                    See a Sample Report
                  </Link>
                </div>

                <div className="hero-trust" style={{ marginTop: '28px' }}>
                  {[
                    'Backend proof ID per run',
                    'Duplicate & math check',
                    'Vendor bank-change flags',
                  ].map((t) => (
                    <span key={t} className="trust-pill">
                      <span className="dot" aria-hidden="true" />
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Right: demo console */}
              <div>
                {/* Console chrome */}
                <div
                  style={{
                    background: 'linear-gradient(180deg,#0E1224 0%,#0A0D1B 100%)',
                    border: '1px solid rgba(123,216,255,0.25)',
                    borderRadius: '16px',
                    boxShadow: '0 30px 80px rgba(0,0,0,0.65), 0 1px 0 rgba(255,255,255,0.04) inset',
                    overflow: 'hidden',
                  }}
                >
                  {/* Faux title bar */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 16px',
                      borderBottom: '1px solid rgba(255,255,255,0.06)',
                      background: 'rgba(0,0,0,0.3)',
                    }}
                    role="banner"
                    aria-label="Illustrative example — not a live run"
                  >
                    <span style={{ display: 'inline-flex', gap: '5px' }} aria-hidden="true">
                      <i
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: '50%',
                          background: '#F05252',
                          opacity: 0.75,
                          display: 'inline-block',
                        }}
                      />
                      <i
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: '50%',
                          background: '#F6B955',
                          opacity: 0.75,
                          display: 'inline-block',
                        }}
                      />
                      <i
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: '50%',
                          background: '#3FD18B',
                          opacity: 0.75,
                          display: 'inline-block',
                        }}
                      />
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        color: 'rgba(255,255,255,0.35)',
                        marginLeft: '4px',
                        flex: 1,
                      }}
                    >
                      invoice-verification — ChainVerify
                    </span>
                    {/* Visible EXAMPLE badge so sighted users know this is illustrative */}
                    <span
                      style={{
                        padding: '2px 6px',
                        background: 'rgba(255,180,0,0.10)',
                        border: '1px solid rgba(255,180,0,0.30)',
                        borderRadius: '4px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '9px',
                        fontWeight: 700,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(255,200,80,0.85)',
                        flexShrink: 0,
                      }}
                      aria-hidden="true"
                    >
                      Example
                    </span>
                    {/* Pulsing verifying indicator */}
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        color: fraudMode ? 'var(--err)' : 'var(--ok)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: fraudMode ? 'var(--err)' : 'var(--ok)',
                          boxShadow: fraudMode ? '0 0 8px var(--err)' : '0 0 8px var(--ok)',
                          animation: 'pulse 1.6s ease-in-out infinite',
                          display: 'inline-block',
                        }}
                        aria-hidden="true"
                      />
                      {fraudMode ? 'Fraud Detected' : 'Verifying'}
                    </span>
                  </div>

                  {/* Example output (illustrative — not a real run result) */}
                  <div
                    style={{ padding: '20px' }}
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
                    {(fraudMode
                      ? [
                          {
                            label: 'Invoice number check',
                            sub: 'Duplicate detected · failed',
                            ok: false,
                          },
                          {
                            label: 'Math verification',
                            sub: 'Line-item total mismatch · failed',
                            ok: false,
                          },
                          {
                            label: 'Vendor bank details',
                            sub: 'Bank change flagged · review',
                            ok: false,
                          },
                          { label: 'PO linkage', sub: 'PO not found · failed', ok: false },
                        ]
                      : [
                          { label: 'Invoice number check', sub: 'Unique · passed', ok: true },
                          {
                            label: 'Math verification',
                            sub: 'Line items balance · passed',
                            ok: true,
                          },
                          {
                            label: 'Vendor bank details',
                            sub: 'Matches prior record · passed',
                            ok: true,
                          },
                          { label: 'PO linkage', sub: 'PO confirmed · passed', ok: true },
                        ]
                    ).map((row) => (
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
                            background: row.ok ? 'rgba(63,209,139,0.12)' : 'rgba(240,82,82,0.12)',
                            border: `1px solid ${row.ok ? 'rgba(63,209,139,0.35)' : 'rgba(240,82,82,0.35)'}`,
                            color: row.ok ? '#3FD18B' : '#F05252',
                            fontSize: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginTop: '1px',
                          }}
                          aria-hidden="true"
                        >
                          {row.ok ? '✓' : '✕'}
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
                              color: row.ok ? 'rgba(255,255,255,0.35)' : 'rgba(240,82,82,0.6)',
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
                        background: fraudMode ? 'rgba(240,82,82,0.07)' : 'rgba(63,209,139,0.07)',
                        border: `1px solid ${fraudMode ? 'rgba(240,82,82,0.25)' : 'rgba(63,209,139,0.25)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '11px',
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      }}
                    >
                      <span
                        style={{
                          color: fraudMode ? '#F05252' : '#3FD18B',
                          fontWeight: 700,
                        }}
                      >
                        {fraudMode ? 'BLOCKED' : 'APPROVED'}
                      </span>
                      <span style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {fraudMode ? '4 issues found' : '4 / 4 checks'}
                      </span>
                    </div>
                  </div>

                  {/* Fraud toggle */}
                  <div
                    style={{
                      padding: '12px 20px 16px',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                      display: 'flex',
                      justifyContent: 'center',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setFraudMode((m) => !m)}
                      aria-pressed={fraudMode}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 16px',
                        borderRadius: '8px',
                        border: `1px solid ${fraudMode ? 'var(--err-wire)' : 'var(--border-base)'}`,
                        background: fraudMode ? 'var(--err-dim)' : 'rgba(255,255,255,0.03)',
                        color: fraudMode ? 'var(--err)' : 'var(--text-secondary)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                    >
                      {fraudMode ? (
                        <>
                          <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            style={{ width: 13, height: 13 }}
                            aria-hidden="true"
                          >
                            <polyline
                              points="14 2 6 10 2 6"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Back to clean invoice
                        </>
                      ) : (
                        <>
                          See a caught fraud
                          <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            style={{ width: 13, height: 13 }}
                            aria-hidden="true"
                          >
                            <path
                              d="M3 8h10M9 4l4 4-4 4"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Fraud context note */}
                {fraudMode && (
                  <p
                    style={{
                      marginTop: '10px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: 'var(--err)',
                      textAlign: 'center',
                      letterSpacing: '0.04em',
                    }}
                    aria-live="polite"
                  >
                    Scenario C FAILED — $17,700 math-mismatch + duplicate invoice blocked
                  </p>
                )}
              </div>
            </div>
          </header>

          {/* ── S2: WHAT IT CATCHES ── */}
          <section
            className="section wrap"
            id="what-it-catches"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="section-head">
              <span className="eyebrow">What It Catches</span>
              <h2 style={{ marginTop: '16px' }}>Four fraud vectors checked on submission.</h2>
              <p>Every invoice runs through the full rule set before a payment decision is made.</p>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '16px',
              }}
              role="list"
            >
              {CATCHES.map(({ title, desc, icon }) => (
                <div key={title} className="check-card" role="listitem">
                  <div className="check-icon" aria-hidden="true">
                    {icon}
                  </div>
                  <h4>{title}</h4>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── S3: HOW IT WORKS ── */}
          <section
            className="section wrap"
            id="how-it-works"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="section-head">
              <span className="eyebrow">How It Works</span>
              <h2 style={{ marginTop: '16px' }}>Three steps to a risk verdict.</h2>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '16px',
              }}
            >
              {HOW_IT_WORKS.map(({ num, title, desc, icon }) => (
                <div key={num} className="flow-step">
                  <div className="num">{num}</div>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                  <div className="glyph">{icon}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── S4: EXAMPLE PROOF REPORT ── */}
          <section
            className="section wrap"
            id="example-report"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="section-head">
              <span className="eyebrow">
                Example output{' '}
                <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  (illustrative)
                </span>
              </span>
              <h2 style={{ marginTop: '16px' }}>What a verified invoice looks like.</h2>
              <p>
                Every verified invoice produces a structured proof record you can export or share
                with auditors. The example below shows the structure — backend proof IDs are
                generated per-run.
              </p>
            </div>

            {/* Sample report card — VERIFIED state */}
            <div
              className="audit-card"
              style={{ maxWidth: '680px' }}
              role="region"
              aria-label="Example verified invoice proof report"
            >
              {/* Title bar */}
              <div className="live-strip">
                <span className="dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>InvoiceProof Report</span>
                <span className="pulse">Verified</span>
              </div>

              {/* Header */}
              <div className="audit-head">
                <div className="audit-head-l">
                  <div className="label">
                    Invoice Proof
                    <span className="id">{invoiceProofMarketing.sample.proofId}</span>
                  </div>
                  <div className="vendor">Acme Corp</div>
                  <div className="meta">
                    INV-2026-0041 &middot; <b>Due 2026-06-15</b> &middot; PO-20260418
                  </div>
                </div>
                <div className="audit-head-r">
                  <div className="amount">$12,450</div>
                  <div className="risk-badge ok">
                    <span className="swatch" aria-hidden="true" />
                    LOW RISK
                  </div>
                </div>
              </div>

              {/* Verification trail */}
              <div className="sec-label">Verification Trail</div>

              {[
                {
                  icon: 'ok',
                  label: 'Field Presence',
                  detail: '5 / 5 required fields present',
                  time: '12ms',
                },
                {
                  icon: 'ok',
                  label: 'Math Validation',
                  detail: 'Line items $11,950 + tax $500 = $12,450',
                  time: '18ms',
                },
                {
                  icon: 'ok',
                  label: 'Vendor History',
                  detail: 'Same bank account as prior 4 invoices',
                  time: '31ms',
                },
                {
                  icon: 'ok',
                  label: 'PO Linkage',
                  detail: 'PO-20260418 matches vendor and amount range',
                  time: '24ms',
                },
                {
                  icon: 'ok',
                  label: 'Duplicate Check',
                  detail: 'No prior payment found for INV-2026-0041',
                  time: '9ms',
                },
              ].map(({ icon, label, detail, time }) => (
                <div key={label} className="trail-row">
                  <span
                    className={`trail-icon ${icon}`}
                    aria-label={icon === 'ok' ? 'Pass' : icon === 'warn' ? 'Warning' : 'Fail'}
                  >
                    {icon === 'ok' && (
                      <svg
                        viewBox="0 0 12 12"
                        fill="none"
                        style={{ width: 12, height: 12 }}
                        aria-hidden="true"
                      >
                        <polyline
                          points="2 6 5 9 10 3"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                    {icon === 'warn' && '!'}
                    {icon === 'err' && '✕'}
                  </span>
                  <span className="trail-text">
                    <b>{label}</b> — {detail}
                  </span>
                  <span className="trail-time">{time}</span>
                </div>
              ))}

              {/* Proof chain footer */}
              <div
                style={{
                  marginTop: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: '8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                }}
              >
                <span style={{ color: 'var(--text-faint)' }}>PROOF RECORD</span>
                <span style={{ color: 'var(--accent-soft)' }}>generated per run</span>
                <span
                  style={{
                    padding: '3px 8px',
                    background: 'rgba(255,180,0,0.08)',
                    border: '1px solid rgba(255,180,0,0.25)',
                    borderRadius: '4px',
                    color: 'rgba(255,200,80,0.85)',
                    fontSize: '10px',
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                  }}
                >
                  EXAMPLE
                </span>
              </div>

              {/* Actions — example export only (downloads the static example above) */}
              <div className="audit-actions">
                <button
                  type="button"
                  className="chip-btn primary"
                  onClick={() => window.print()}
                >
                  Export PDF
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => {
                    const example = {
                      proof_id: invoiceProofMarketing.sample.proofId,
                      status: 'PASSED',
                      risk: 'LOW',
                      vendor: 'Acme Corp',
                      invoice: 'INV-2026-0041',
                      amount: 12450,
                      checks: [
                        'Vendor match against approved suppliers',
                        'Line items reconciled to PO',
                        'Tax calculation verified',
                        'Duplicate scan (180 days)',
                      ],
                      issues: [],
                      note: 'Example export only — live proof IDs are generated per run in the sandbox below.',
                    };
                    const blob = new Blob([JSON.stringify(example, null, 2)], {
                      type: 'application/json',
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${invoiceProofMarketing.sample.proofId}.json`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => {
                    const url = `${window.location.origin}/invoice-proof#example-report`;
                    if (navigator.clipboard) {
                      navigator.clipboard.writeText(url);
                    }
                  }}
                >
                  Share audit link
                </button>
              </div>
              <p
                style={{
                  marginTop: '10px',
                  fontSize: '11px',
                  color: 'var(--text-faint)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                Example export only — live proof IDs are generated per run in the sandbox below.
              </p>
            </div>

            <p
              style={{
                marginTop: '16px',
                fontSize: '12px',
                color: 'var(--text-faint)',
                fontFamily: 'var(--font-mono)',
                maxWidth: '680px',
              }}
            >
              Note: Persistent BEC protection (bank-account-change detection across submissions)
              requires prior vendor banking context or an enterprise data feed integration. It is
              not available from a context-free self-serve sample alone.
            </p>
          </section>

          {/* ── S5: API SNIPPET ── */}
          <section
            className="section wrap"
            id="api"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="section-head">
              <span className="eyebrow">API</span>
              <h2 style={{ marginTop: '16px' }}>One call. Instant verdict.</h2>
              <p>
                Drop InvoiceProof into any AP workflow. OpenAI-compatible shape, SSE streaming for
                results.
              </p>
            </div>

            <div
              style={{
                background: '#080c14',
                border: '1px solid rgba(123,216,255,0.2)',
                borderRadius: '14px',
                overflow: 'hidden',
                maxWidth: '760px',
              }}
              aria-label="API example: POST to invoice-proof endpoint"
              role="region"
            >
              {/* Code bar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  background: 'rgba(0,0,0,0.3)',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'rgba(255,255,255,0.35)',
                  }}
                >
                  bash — POST /api/verify
                </span>
                <span
                  style={{
                    padding: '2px 8px',
                    background: 'var(--accent-dim)',
                    border: '1px solid var(--accent-wire)',
                    borderRadius: '4px',
                    color: 'var(--accent-soft)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  REST API
                </span>
              </div>

              <pre
                style={{
                  margin: 0,
                  padding: '20px 22px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  lineHeight: 1.65,
                  color: '#c9d1d9',
                  overflowX: 'auto',
                  tabSize: 2,
                }}
              >
                <code>{`curl -X POST https://chain-verify-api.onrender.com/api/verify \\
  -H "Authorization: Bearer <API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "source_type": "invoice",
    "task": "invoice_extraction",
    "output": {
      "invoice_url": "https://example.com/invoice.pdf",
      "po_number": "PO-2024-001"
    },
    "rules": ["field_presence", "math_validation", "vendor_history"]
  }'`}</code>
              </pre>

              {/* Response preview */}
              <div
                style={{
                  borderTop: '1px dashed rgba(255,255,255,0.06)',
                  padding: '16px 22px',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10.5px',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--text-faint)',
                    marginBottom: '10px',
                  }}
                >
                  Response
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    lineHeight: 1.6,
                    color: '#8b949e',
                    overflowX: 'auto',
                  }}
                >
                  <code>{`{
  "proof_id": "generated-per-run",
  "status": "PASSED",
  "risk": "LOW",
  "action": "approved",
  "confidence": 0.96,
  "proof_record": "generated-per-run",
  "issues": []
}`}</code>
                </pre>
              </div>
            </div>

            <div style={{ marginTop: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <Link
                href="/docs/quickstart-for-agents"
                className="btn btn-secondary"
                style={{ fontSize: '14px', padding: '10px 18px', minHeight: 'unset' }}
              >
                View API docs
              </Link>
              <Link
                href="/console/proof"
                className="btn btn-secondary"
                style={{ fontSize: '14px', padding: '10px 18px', minHeight: 'unset' }}
              >
                Get API key
              </Link>
            </div>
          </section>

          {/* ── S6: PRICING ── */}
          <section
            className="section wrap"
            id="pricing"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="section-head">
              <span className="eyebrow">Pricing</span>
              <h2 style={{ marginTop: '16px' }}>Simple, volume-based pricing.</h2>
              <p>
                Start with the managed pilot. Pilot fee credited back if you convert to a
                subscription.
              </p>
            </div>

            {/* 2-column pricing grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                maxWidth: '880px',
              }}
              role="list"
              aria-label="InvoiceProof pricing tiers"
            >
              {PRICING_TIERS.map(({ slug, name, invoices, price, note }, idx) => {
                const isPilot = slug === 'invoiceproof-pilot';
                return (
                  <div
                    key={slug}
                    role="listitem"
                    style={{
                      background: isPilot
                        ? 'linear-gradient(180deg,rgba(123,216,255,0.10),rgba(123,216,255,0.02))'
                        : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isPilot ? 'var(--accent-wire)' : 'var(--border-base)'}`,
                      borderRadius: '14px',
                      padding: '24px 20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      boxShadow: isPilot ? 'var(--shadow-glow-purple)' : undefined,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10.5px',
                        letterSpacing: '0.14em',
                        textTransform: 'uppercase',
                        color: isPilot ? 'var(--accent-soft)' : 'var(--text-faint)',
                        marginBottom: '6px',
                      }}
                    >
                      {name}
                      {idx === 0 && (
                        <span
                          style={{
                            marginLeft: '8px',
                            padding: '2px 6px',
                            background: 'var(--accent-dim)',
                            border: '1px solid var(--accent-wire)',
                            borderRadius: '3px',
                            fontSize: '9px',
                            color: 'var(--accent-soft)',
                            verticalAlign: '1px',
                          }}
                        >
                          START HERE
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '26px',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        letterSpacing: '-0.02em',
                        lineHeight: 1.1,
                      }}
                    >
                      {price}
                      <span
                        style={{
                          fontSize: '13px',
                          color: 'var(--text-muted)',
                          fontWeight: 400,
                          marginLeft: '3px',
                        }}
                      >
                        {note}
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        color: 'var(--accent-soft)',
                        marginTop: '2px',
                      }}
                    >
                      {invoices.toLocaleString()} invoices{isPilot ? '' : '/mo'}
                    </div>
                    <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                      <ProofCheckoutButton
                        product="invoice-proof"
                        planSlug={slug}
                        className={
                          isPilot
                            ? 'block w-full text-center py-2.5 rounded-lg text-xs font-bold bg-[#7BD8FF] text-white shadow-[0_8px_24px_rgba(123,216,255,0.25)] hover:bg-[#4CAED5] transition-colors cursor-pointer'
                            : 'block w-full text-center py-2.5 rounded-lg text-xs font-bold bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer'
                        }
                      >
                        {isPilot ? 'Start Managed Pilot' : `Subscribe (${price})`}
                      </ProofCheckoutButton>
                      {!isPilot && (
                        <Link
                          href="/start/invoice-proof"
                          style={{
                            display: 'block',
                            textAlign: 'center',
                            marginTop: '8px',
                            fontSize: '11px',
                            color: 'rgba(255,255,255,0.4)',
                            textDecoration: 'underline',
                            textUnderlineOffset: '3px',
                          }}
                        >
                          Request a free pilot instead
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <p
              style={{
                marginTop: '18px',
                fontSize: '13px',
                color: 'var(--text-faint)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              Enterprise volume or custom AP rules?{' '}
              <Link
                href="/contact"
                style={{ color: 'var(--accent-soft)', textDecoration: 'underline' }}
              >
                Talk to us
              </Link>
              .
            </p>
          </section>

          {/* ── INTERACTIVE SANDBOX ── */}
          <section
            className="section wrap"
            id="demo"
            style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="section-head">
              <span className="eyebrow">Interactive Sandbox</span>
              <h2 style={{ marginTop: '16px' }}>Test invoice verification.</h2>
              <p>
                Run a single invoice check to see risk highlights, math verification, and proof
                output structure.
              </p>
            </div>
            <InvoiceForm />
          </section>

          {/* ── S7: FINAL CTA ── */}
          <section className="final wrap" aria-label="Final call to action">
            <span className="eyebrow" style={{ justifyContent: 'center' }}>
              Stop Fraud Before the Wire Goes Out
            </span>
            <h2 style={{ marginTop: '16px' }}>
              Stop fraud before
              <br />
              the wire goes out.
            </h2>
            <p>
              InvoiceProof checks duplicates, math errors, and bank-change risk before payment, then
              returns a structured proof trail your auditors can review.
            </p>
            <div className="final-ctas">
              <Link href="#demo" className="btn btn-primary btn-arrow">
                Verify an Invoice
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
              <Link href="/audit-proof" className="btn btn-secondary">
                Explore AuditProof
              </Link>
            </div>
          </section>

          {/* Related products */}
          <section
            className="section wrap"
            style={{
              borderTop: '1px solid rgba(255,255,255,0.05)',
              paddingTop: '48px',
              paddingBottom: '48px',
            }}
          >
            <div style={{ marginBottom: '24px' }}>
              <span className="eyebrow">ChainVerify Proof Suite</span>
              <h2 style={{ marginTop: '12px', fontSize: '24px' }}>
                More proof products from ChainVerify.
              </h2>
            </div>
            <div className="related-grid">
              <Link
                className="related-card"
                href="/audit-proof"
                aria-label="Explore AuditProof — Audit-ready proof for AI agent work"
              >
                <div className="related-icon audit" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ width: 22, height: 22 }}
                    aria-hidden="true"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div>
                  <h4>AuditProof</h4>
                  <p>Audit-ready proof for AI agent work.</p>
                </div>
                <span className="related-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
              <Link
                className="related-card"
                href="/verify-api"
                aria-label="Explore VerifyAPI — Verify AI outputs before your users rely on them"
              >
                <div className="related-icon verify" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ width: 22, height: 22 }}
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <h4>VerifyAPI</h4>
                  <p>Verify AI outputs before your users rely on them.</p>
                </div>
                <span className="related-arrow" aria-hidden="true">
                  →
                </span>
              </Link>
            </div>
          </section>
        </div>

        <ProductFooter currentProduct="invoice-proof" />
        <StripeTestModeBanner />
      </div>
    </>
  );
}
