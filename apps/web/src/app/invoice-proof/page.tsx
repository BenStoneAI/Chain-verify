import type { Metadata } from 'next';

import InvoiceProofClient from '@/components/proof/InvoiceProofClient';
import { getProofProductMarketing } from '@/lib/proof-products/marketing';

import './invoice-proof.css';

const invoiceProofMarketing = getProofProductMarketing('invoiceproof');

export const metadata: Metadata = {
  title: 'InvoiceProof by SwarmSync — Catch invoice fraud before you pay',
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
  alternates: { canonical: 'https://swarmsync.ai/invoice-proof' },
  openGraph: {
    title: 'InvoiceProof by SwarmSync — Catch invoice fraud before you pay',
    description: invoiceProofMarketing.description,
    url: 'https://swarmsync.ai/invoice-proof',
    siteName: 'SwarmSync',
    type: 'website',
    images: [{ url: 'https://swarmsync.ai/og-invoice-proof.png', width: 1200, height: 630, alt: 'InvoiceProof by SwarmSync' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'InvoiceProof by SwarmSync',
    description: invoiceProofMarketing.shortClaim,
    images: ['https://swarmsync.ai/og-invoice-proof.png'],
  },
};

export default function InvoiceProofPage() {
  return <InvoiceProofClient />;
}
