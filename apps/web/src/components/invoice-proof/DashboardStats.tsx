import type { ScanSummary } from '@/lib/invoice-proof/types';

export interface DashboardStatsProps {
  scans: ScanSummary[];
}

export function DashboardStats({ scans }: DashboardStatsProps) {
  const invoices = scans.reduce((sum, scan) => sum + scan.invoiceCount, 0);
  const highRisk = scans.filter((s) => s.riskLevel === 'HIGH' || s.riskLevel === 'CRITICAL').length;
  const warnings = scans.filter((s) => s.riskLevel === 'MEDIUM').length;
  const passed = scans.filter((s) => s.riskLevel === 'LOW').length;

  const stats = [
    { label: 'Invoices scanned', value: invoices },
    { label: 'High-risk scans', value: highRisk },
    { label: 'Scans with warnings', value: warnings },
    { label: 'Clean scans', value: passed },
  ];

  return (
    <div className="ipa-stats" role="list" aria-label="Scan summary">
      {stats.map((stat) => (
        <div key={stat.label} className="ipa-card" role="listitem">
          <div className="ipa-stat-value">{stat.value.toLocaleString()}</div>
          <div className="ipa-stat-label">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
