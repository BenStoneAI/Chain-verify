import type { ApprovalDecision, ApprovalItem } from '@/lib/invoice-proof/types';

export interface ApprovalCardProps {
  approval: ApprovalItem;
  deciding: boolean;
  onDecide: (approvalId: string, decision: ApprovalDecision) => void;
}

const STATUS_LABELS: Record<ApprovalItem['status'], string> = {
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved for payment',
  BLOCKED: 'Blocked',
};

export function ApprovalCard({ approval, deciding, onDecide }: ApprovalCardProps) {
  const pending = approval.status === 'PENDING_REVIEW';

  return (
    <li className="ipa-card">
      <p className="ipa-finding-pattern">{approval.findingPattern}</p>
      <p>{approval.findingDetail}</p>
      <p className="ipa-faint">
        {[approval.vendor, approval.invoiceNo, STATUS_LABELS[approval.status] ?? approval.status]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {pending ? (
        <div className="ipa-actions">
          <button
            type="button"
            className="ipa-btn ipa-btn-sm ipa-btn-ok"
            disabled={deciding}
            onClick={() => onDecide(approval.id, 'APPROVED')}
          >
            Approve (pay)
          </button>
          <button
            type="button"
            className="ipa-btn ipa-btn-sm ipa-btn-danger"
            disabled={deciding}
            onClick={() => onDecide(approval.id, 'BLOCKED')}
          >
            Block
          </button>
        </div>
      ) : null}
    </li>
  );
}
