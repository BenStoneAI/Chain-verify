import Link from 'next/link';

import type { ScanResponse } from '@/lib/invoice-proof/types';

export interface ScanResultPanelProps {
  result: ScanResponse;
  /** True when the caller scanned with an API key and can open the review queue. */
  canReview: boolean;
}

export function ScanResultPanel({ result, canReview }: ScanResultPanelProps) {
  const findings = (result.findings ?? []).slice(0, 5);

  return (
    <section className="ipa-card" aria-label="Scan result" aria-live="polite">
      <div className="ipa-actions">
        <span>
          Rows: <strong>{result.rowCount ?? 0}</strong>
        </span>
        <span>
          Findings: <strong>{result.findingCount ?? 0}</strong>
        </span>
        {result.riskLevel ? (
          <span>
            Risk: <strong>{result.riskLevel}</strong>
          </span>
        ) : null}
        {result.scanId && canReview ? (
          <Link href={`/invoice-proof/review/${result.scanId}`} className="ipa-link">
            Review flagged items
          </Link>
        ) : null}
      </div>
      {findings.length > 0 ? (
        <ul className="ipa-list">
          {findings.map((finding, index) => (
            <li key={`${finding.pattern}-${index}`}>
              <span className="ipa-finding-pattern">{finding.severity}</span> {finding.pattern}: {finding.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {result.freeScanConsumed ? (
        <p className="ipa-faint">
          This was your free scan. Choose a plan to keep scanning and to save results to a dashboard.
          <br />
          <Link href="/invoice-proof#plans" className="ipa-link">
            See InvoiceProof plans
          </Link>
        </p>
      ) : null}
    </section>
  );
}
