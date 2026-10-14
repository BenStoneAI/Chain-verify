'use client';

import Link from 'next/link';

import type { FailureReason } from '@/lib/agentGateProvisioning';

import { StateHeader } from './StateHeader';

export interface PaymentNotVerifiedProps {
  reason: FailureReason | null;
  sessionId: string;
  /** Last server or connection message, shown when we have one. */
  detail?: string | null;
  onRetry: () => void;
}

const EXPLANATION: Record<FailureReason, string> = {
  timeout:
    'Stripe has not confirmed this payment to us yet. This can take a minute after checkout, and it often resolves on its own.',
  payment_failed:
    'Stripe did not report this checkout as paid, or we could not complete the setup for it.',
  rejected: 'We did not recognize this checkout reference.',
};

/** State 5: could not verify. Retry and the contact form are the only paths; no email address is shown. */
export function PaymentNotVerified({ reason, sessionId, detail, onRetry }: PaymentNotVerifiedProps) {
  return (
    <div className="ag-state">
      <StateHeader
        eyebrow="CHECKOUT RETURN"
        title={<>Payment could not be verified</>}
        lead={EXPLANATION[reason ?? 'timeout']}
      />
      <div className="ag-panel ag-panel-warning" role="alert">
        <p className="ag-note">
          Retrying only re-checks the payment with Stripe. It never charges you again and never
          creates a second key.
        </p>
        {detail ? <p className="ag-note">{detail}</p> : null}
        <div className="ag-actions">
          <button type="button" className="pm-btn pm-btn-primary" onClick={onRetry}>
            Retry verification
          </button>
          <Link className="pm-btn pm-btn-secondary" href="/contact">
            Contact support
          </Link>
        </div>
        <p className="ag-note">
          Include this checkout reference when you contact us:{' '}
          <code className="ag-ref">{sessionId}</code>
        </p>
      </div>
    </div>
  );
}

export default PaymentNotVerified;
