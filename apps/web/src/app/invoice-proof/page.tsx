import type { Metadata } from 'next';

import InvoiceProofClient from '@/components/proof/InvoiceProofClient';
import { getProofProductMarketing } from '@/lib/proof-products/marketing';

import './invoice-proof.css';

const invoiceProofMarketing = getProofProductMarketing('invoiceproof');

export const metadata: Metadata = {
  title: 'InvoiceProof by ChainVerify — Catch invoice fraud before you pay',
  description: invoiceProofMarketing.description,
  keywords: [
    'invoice fraud detection',
    'AP fraud prevention',
    'duplicate invoice detection',
    'bank change fraud',
    'BEC fraud invoices',
    'AI invoice scanner',
    'accounts payable fraud',
    'PO mismatch detection',
    'invoice verification',
  ],
  alternates: { canonical: 'https://chainverify.org/invoice-proof' },
  openGraph: {
    title: 'InvoiceProof by ChainVerify — Catch invoice fraud before you pay',
    description: invoiceProofMarketing.description,
    url: 'https://chainverify.org/invoice-proof',
    siteName: 'ChainVerify',
    type: 'website',
    images: [{ url: 'https://chainverify.org/chainverify-logo.svg', width: 1200, height: 630, alt: 'InvoiceProof by ChainVerify' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'InvoiceProof by ChainVerify',
    description: invoiceProofMarketing.shortClaim,
    images: ['https://chainverify.org/chainverify-logo.svg'],
  },
};

export default function InvoiceProofPage() {
  return <InvoiceProofClient />;
}
