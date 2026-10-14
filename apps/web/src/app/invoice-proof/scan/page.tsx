import type { Metadata } from 'next';

import { InvoiceBatchScan } from '@/components/invoice-proof/InvoiceBatchScan';
import { InvoiceProofShell } from '@/components/invoice-proof/InvoiceProofShell';

import '../invoice-proof-app.css';

export const metadata: Metadata = {
  title: 'InvoiceProof Batch Scan | ChainVerify',
  description: 'Scan invoices from pasted CSV or JSON, an uploaded PDF, or a URL before payment.',
  robots: { index: false, follow: false },
};

export default function InvoiceProofScanPage() {
  return (
    <InvoiceProofShell narrow>
      <header>
        <p className="ipa-eyebrow">InvoiceProof</p>
        <h1 className="ipa-title">Scan invoices</h1>
        <p className="ipa-sub">
          Paste CSV or JSON rows, upload a PDF, or point to an invoice URL. Duplicate, vendor,
          bank-change, and PO checks run before money moves.
        </p>
      </header>
      <InvoiceBatchScan />
    </InvoiceProofShell>
  );
}
