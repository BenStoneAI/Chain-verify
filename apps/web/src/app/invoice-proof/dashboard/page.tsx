import type { Metadata } from 'next';

import { InvoiceProofDashboard } from '@/components/invoice-proof/InvoiceProofDashboard';
import { InvoiceProofKeyGate } from '@/components/invoice-proof/InvoiceProofKeyGate';
import { InvoiceProofShell } from '@/components/invoice-proof/InvoiceProofShell';

import '../invoice-proof-app.css';

export const metadata: Metadata = {
  title: 'InvoiceProof Dashboard | ChainVerify',
  robots: { index: false, follow: false },
};

export default function InvoiceProofDashboardPage() {
  return (
    <InvoiceProofKeyGate>
      <InvoiceProofShell>
        <InvoiceProofDashboard />
      </InvoiceProofShell>
    </InvoiceProofKeyGate>
  );
}
