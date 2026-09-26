import { ProofHistoryStatusPage } from '@/components/proof/ProofHistoryStatusPage';

export default function InvoiceProofHistoryPage() {
  return (
    <ProofHistoryStatusPage
      currentProduct="invoice-proof"
      productLabel="InvoiceProof"
      title="Invoice history appears after account login."
      demoHref="/invoice-proof#pilot"
      dashboardHref="/invoice-proof/dashboard"
    />
  );
}
