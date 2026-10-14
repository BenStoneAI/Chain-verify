import Link from 'next/link';

import { StateHeader } from './StateHeader';

/** Shown when the return link carries no usable `session_id`. */
export function InvalidSession() {
  return (
    <div className="ag-state">
      <StateHeader
        eyebrow="CHECKOUT RETURN"
        title={<>This checkout link is incomplete.</>}
        lead="We could not find a valid Stripe checkout reference in this link, so there is nothing to verify yet."
      />
      <div className="ag-panel ag-panel-error" role="alert">
        <p className="ag-note">
          Open the link Stripe showed you after paying, or start again from the Agent Gate plans.
          If you already paid, contact us and we will find your purchase.
        </p>
        <div className="ag-actions">
          <Link className="pm-btn pm-btn-primary" href="/agent-gate#plans">
            View Agent Gate plans
          </Link>
          <Link className="pm-btn pm-btn-secondary" href="/contact">
            Contact support
          </Link>
        </div>
      </div>
    </div>
  );
}

export default InvalidSession;
