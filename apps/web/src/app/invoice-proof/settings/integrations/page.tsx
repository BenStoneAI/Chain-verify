import type { Metadata } from 'next';

import { ErpIntegrationsPanel } from '@/components/invoice-proof/ErpIntegrationsPanel';
import { InvoiceProofKeyGate } from '@/components/invoice-proof/InvoiceProofKeyGate';
import { InvoiceProofShell } from '@/components/invoice-proof/InvoiceProofShell';

import '../../invoice-proof-app.css';

export const metadata: Metadata = {
  title: 'InvoiceProof ERP Integrations | ChainVerify',
  robots: { index: false, follow: false },
};

export default function InvoiceProofIntegrationsPage() {
  return (
    <InvoiceProofKeyGate>
      <InvoiceProofShell narrow>
        <ErpIntegrationsPanel />
      </InvoiceProofShell>
    </InvoiceProofKeyGate>
  );
}
