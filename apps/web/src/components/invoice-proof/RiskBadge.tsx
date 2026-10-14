import type { RiskLevel } from '@/lib/invoice-proof/types';

const LABELS: Record<RiskLevel, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
};

export interface RiskBadgeProps {
  risk: RiskLevel;
}

export function RiskBadge({ risk }: RiskBadgeProps) {
  return <span className={`ipa-badge ipa-badge-${risk.toLowerCase()}`}>{LABELS[risk]}</span>;
}
