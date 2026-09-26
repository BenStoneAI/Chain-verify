import { ProofHistoryStatusPage } from '@/components/proof/ProofHistoryStatusPage';

export default function AuditProofLogsPage() {
  return (
    <ProofHistoryStatusPage
      currentProduct="audit-proof"
      productLabel="AuditProof"
      title="Audit logs are separated by demo and account records."
      demoHref="/audit-proof#control-report"
      dashboardHref="/audit-proof/dashboard"
    />
  );
}
