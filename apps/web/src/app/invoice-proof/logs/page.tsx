import { ProofHistoryStatusPage } from '@/components/proof/ProofHistoryStatusPage';

export default function InvoiceProofLogsPage() {
  return (
    <ProofHistoryStatusPage
      currentProduct="invoice-proof"
      productLabel="InvoiceProof"
      title="Invoice logs are separated by demo and account records."
      demoHref="/invoice-proof#pilot"
      dashboardHref="/invoice-proof/dashboard"
    />
  );
}
