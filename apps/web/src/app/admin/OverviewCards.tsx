import type { AdminOverview } from './admin-api';

interface OverviewCardsProps {
  overview: AdminOverview;
}

/** The "is anything on fire" row — answerable in under 5 seconds. */
export function OverviewCards({ overview }: OverviewCardsProps) {
  const cards = [
    { label: 'Organizations', value: overview.totalOrganizations },
    { label: 'Active API keys', value: overview.totalActiveApiKeys },
    { label: 'Verification runs this month', value: overview.verificationRunsThisMonth },
    {
      label: 'Zero-usage organizations (24h+)',
      value: overview.zeroUsageOrganizations,
      warn: overview.zeroUsageOrganizations > 0,
    },
  ];

  return (
    <section aria-label="Platform overview">
      <div className="cva-kpi-row">
        {cards.map((card) => (
          <div key={card.label} className={`cva-kpi-card${card.warn ? ' cva-kpi-card-warn' : ''}`}>
            <div className="cva-kpi-value">{card.value.toLocaleString()}</div>
            <div className="cva-kpi-label">{card.label}</div>
          </div>
        ))}
      </div>
      {overview.recentAuditLog.length > 0 && (
        <ul className="cva-recent-activity" aria-label="Recent admin activity">
          {overview.recentAuditLog.slice(0, 5).map((entry) => (
            <li key={entry.id}>
              <code>{entry.action}</code> by {entry.adminLabel} — {entry.reason}
              <span className="cva-muted"> · {new Date(entry.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
