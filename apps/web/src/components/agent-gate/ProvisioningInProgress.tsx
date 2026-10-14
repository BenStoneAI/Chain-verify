'use client';

import { StateHeader } from './StateHeader';

export interface ProvisioningInProgressProps {
  connectionError?: string | null;
}

/** State 4: payment is confirmed but the webhook has not finished provisioning yet. */
export function ProvisioningInProgress({ connectionError }: ProvisioningInProgressProps) {
  return (
    <div className="ag-state">
      <StateHeader
        eyebrow="PAYMENT RECEIVED"
        title={<>We&rsquo;re finishing your setup</>}
        lead="Your payment is confirmed. We are creating your organization, your plan access and your API credential. This page updates by itself, so there is nothing you need to do."
      />
      <div className="ag-status-line" role="status">
        <span className="ag-spinner" aria-hidden="true" />
        <span>Provisioning Agent Gate access&hellip;</span>
      </div>
      <p className="ag-note">
        If this takes longer than a minute we re-check the payment with Stripe for you. Refreshing
        this page is safe and will not create a second key or a second charge.
      </p>
      {connectionError ? (
        <p className="ag-note ag-warn" role="status">
          We had trouble reaching Chain Verify. Retrying automatically&hellip;
        </p>
      ) : null}
    </div>
  );
}

export default ProvisioningInProgress;
