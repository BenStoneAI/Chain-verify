import type { Metadata } from 'next';

import { DataImportPanel } from '@/components/invoice-proof/DataImportPanel';
import { InvoiceProofKeyGate } from '@/components/invoice-proof/InvoiceProofKeyGate';
import { InvoiceProofShell } from '@/components/invoice-proof/InvoiceProofShell';

import '../../invoice-proof-app.css';

export const metadata: Metadata = {
  title: 'InvoiceProof Data Import | ChainVerify',
  robots: { index: false, follow: false },
};

export default function InvoiceProofDataSettingsPage() {
  return (
    <InvoiceProofKeyGate>
      <InvoiceProofShell narrow>
        <DataImportPanel />
      </InvoiceProofShell>
    </InvoiceProofKeyGate>
  );
}
