import { ProofHistoryStatusPage } from '@/components/proof/ProofHistoryStatusPage';

export default function VerifyApiLogsPage() {
  return (
    <ProofHistoryStatusPage
      currentProduct="verify-api"
      productLabel="VerifyAPI"
      title="Verification logs are account-scoped."
      demoHref="/verify-api#sandbox"
      dashboardHref="/verify-api/dashboard"
      docsHref="/verify-api/docs"
    />
  );
}
