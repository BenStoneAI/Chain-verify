'use client';

import { StateHeader } from './StateHeader';

export interface VerifyingPaymentProps {
  /** Transient connection problem from the last poll, if any. */
  connectionError?: string | null;
}

/** State 1: waiting for the first answer about the Stripe Checkout Session. */
export function VerifyingPayment({ connectionError }: VerifyingPaymentProps) {
  return (
    <div className="ag-state">
      <StateHeader
        eyebrow="CHECKOUT RETURN"
        title={<>Verifying payment&hellip;</>}
        lead="Stripe sent you back to Chain Verify. We are confirming your payment directly with Stripe. This usually takes a few seconds."
      />
      <div className="ag-status-line" role="status">
        <span className="ag-spinner" aria-hidden="true" />
        <span>Checking your payment. Please keep this page open.</span>
      </div>
      {connectionError ? (
        <p className="ag-note ag-warn" role="status">
          We had trouble reaching Chain Verify. Retrying automatically&hellip;
        </p>
      ) : null}
    </div>
  );
}

export default VerifyingPayment;
