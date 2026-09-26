import { ProofHistoryStatusPage } from '@/components/proof/ProofHistoryStatusPage';

export default function AuditProofHistoryPage() {
  return (
    <ProofHistoryStatusPage
      currentProduct="audit-proof"
      productLabel="AuditProof"
      title="Audit history appears after account login."
      demoHref="/audit-proof#control-report"
      dashboardHref="/audit-proof/dashboard"
    />
  );
}
