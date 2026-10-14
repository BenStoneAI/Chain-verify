'use client';

import Link from 'next/link';

import PurchaseActivationForm from '@/components/proof/PurchaseActivationForm';

import { StateHeader } from './StateHeader';

export interface OrganizationSetupProps {
  sessionId: string;
  /** Plan slug from the server status or the `plan` query parameter. */
  planSlug: string | null;
  onComplete: () => void;
}

/** State 3: payment is verified but we still need an organization name. */
export function OrganizationSetup({ sessionId, planSlug, onComplete }: OrganizationSetupProps) {
  return (
    <div className="ag-state">
      <StateHeader
        eyebrow="ONE LAST STEP"
        title={<>Finish organization setup</>}
        lead="Your payment is verified. Tell us which organization this Agent Gate plan belongs to and we will finish provisioning your access right away."
      />
      {planSlug ? (
        <PurchaseActivationForm
          product="verify-api"
          planSlug={planSlug}
          sessionId={sessionId}
          submitLabel="Finish setup"
          onActivated={onComplete}
        />
      ) : (
        <div className="ag-panel ag-panel-error" role="alert">
          <p className="ag-note">
            We could not determine which plan you purchased from this link. Return to the plans
            page or contact support with your checkout reference.
          </p>
          <div className="ag-actions">
            <Link className="pm-btn pm-btn-primary" href="/agent-gate#plans">View plans</Link>
            <Link className="pm-btn pm-btn-secondary" href="/contact">Contact support</Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrganizationSetup;
