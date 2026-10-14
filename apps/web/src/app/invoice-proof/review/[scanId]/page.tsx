import type { Metadata } from 'next';

import { InvoiceProofKeyGate } from '@/components/invoice-proof/InvoiceProofKeyGate';
import { InvoiceProofShell } from '@/components/invoice-proof/InvoiceProofShell';
import { ScanReview } from '@/components/invoice-proof/ScanReview';

import '../../invoice-proof-app.css';

export const metadata: Metadata = {
  title: 'InvoiceProof Scan Review | ChainVerify',
  robots: { index: false, follow: false },
};

export default function InvoiceProofReviewPage({ params }: { params: { scanId: string } }) {
  return (
    <InvoiceProofKeyGate>
      <InvoiceProofShell narrow>
        <ScanReview scanId={params.scanId} />
      </InvoiceProofShell>
    </InvoiceProofKeyGate>
  );
}
