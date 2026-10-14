import Link from 'next/link';

import type { ScanSummary } from '@/lib/invoice-proof/types';

import { RiskBadge } from './RiskBadge';

export interface ScanHistoryTableProps {
  scans: ScanSummary[];
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ScanHistoryTable({ scans }: ScanHistoryTableProps) {
  return (
    <div className="ipa-table-wrap">
      <table className="ipa-table">
        <caption className="ipa-sr-only">Invoice scan history</caption>
        <thead>
          <tr>
            <th scope="col">Scan</th>
            <th scope="col">Date</th>
            <th scope="col">Invoices</th>
            <th scope="col">Risk</th>
            <th scope="col">Findings</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {scans.map((scan) => (
            <tr key={scan.id}>
              <td className="ipa-mono">{scan.id.slice(0, 8)}</td>
              <td>{formatDate(scan.createdAt)}</td>
              <td>{scan.invoiceCount}</td>
              <td>
                <RiskBadge risk={scan.riskLevel} />
              </td>
              <td>{scan.findingCount}</td>
              <td>
                <Link className="ipa-btn ipa-btn-sm" href={`/invoice-proof/review/${scan.id}`}>
                  Review
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
