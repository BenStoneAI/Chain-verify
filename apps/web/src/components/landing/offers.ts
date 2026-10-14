import type { ProofProductSlug } from '@/lib/stripe-payment-links';

import { AGENT_GATE_NAME } from './productName';

export type OfferBanner = 'agent-gate' | 'audit' | 'invoice';

export interface Offer {
  product: ProofProductSlug;
  name: string;
  eyebrow: string;
  price: string;
  plan: string;
  cta: string;
  title: string;
  body: string;
  href: string;
  bullets: readonly string[];
  banner: OfferBanner;
  bannerLabel: string;
  featured: boolean;
}

/** Prices and limits mirror packages/config (proof-billing.ts, billing.ts). */
export const offers: readonly Offer[] = [
  {
    product: 'verify-api',
    name: AGENT_GATE_NAME,
    eyebrow: 'AI + SOFTWARE DELIVERY',
    price: '$99/mo',
    plan: 'agent-gate-build',
    cta: `Start ${AGENT_GATE_NAME} — $99/mo`,
    title: 'Verify software delivery before users rely on it.',
    body: 'Run 49 repository, CI, deploy, security, and test checks against the delivery claim, with per-check evidence.',
    href: '/agent-gate',
    bullets: ['5,000 runs / month', 'Proof ID every run', '90-day retention'],
    banner: 'agent-gate',
    bannerLabel: `${AGENT_GATE_NAME} 3D verification shield icon`,
    featured: true,
  },
  {
    product: 'audit-proof',
    name: 'AuditProof',
    eyebrow: 'AI GOVERNANCE',
    price: '$2,500 pilot',
    plan: 'auditproof-pilot',
    cta: 'Start AuditProof Pilot — $2,500',
    title: 'Prove what the AI did — and who approved it.',
    body: 'Capture agent activity, human oversight, policy context, and structured evidence for review.',
    href: '/audit-proof',
    bullets: ['100-run managed pilot', 'Structured proof record', 'Reviewable evidence'],
    banner: 'audit',
    bannerLabel: 'AuditProof 3D governance ledger icon',
    featured: false,
  },
  {
    product: 'invoice-proof',
    name: 'InvoiceProof',
    eyebrow: 'FINANCE + AP',
    price: '$750 pilot',
    plan: 'invoiceproof-pilot',
    cta: 'Start InvoiceProof Pilot — $750',
    title: 'Catch invoice risk before money moves.',
    body: 'Flag duplicates, vendor changes, PO mismatches, and payment anomalies before approval.',
    href: '/invoice-proof',
    bullets: ['100-invoice pilot', 'Duplicate + math checks', 'Payment-risk evidence'],
    banner: 'invoice',
    bannerLabel: 'InvoiceProof 3D invoice scanner icon',
    featured: false,
  },
];
