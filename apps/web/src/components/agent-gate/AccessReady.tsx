'use client';

import type { KeyState } from '@/lib/agentGateProvisioning';
import type { ProvisionStatus } from '@/lib/agentGateProvisioningApi';
import { resolveProofApiBase } from '@/lib/proof-api';
import { getProofPlanDisplayName } from '@/lib/stripe-payment-links';

import { ApiKeyReveal } from './ApiKeyReveal';
import { QuickStartExample } from './QuickStartExample';
import { StateHeader } from './StateHeader';

export interface AccessReadyProps {
  status: ProvisionStatus;
  /** `plan` query-string value, used only when the server did not name the plan. */
  planParam?: string;
  keyState: KeyState;
  onReveal: () => void;
}

function formatSubscription(value: string | undefined): string {
  if (!value) return 'Active';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** State 2: ACCESS READY. */
export function AccessReady({ status, planParam, keyState, onReveal }: AccessReadyProps) {
  const planName =
    status.plan?.name ?? (planParam ? getProofPlanDisplayName(planParam) : 'Agent Gate');
  const endpoint =
    keyState.kind === 'revealed' && keyState.endpoint
      ? keyState.endpoint
      : (status.endpoint ?? resolveProofApiBase());

  return (
    <div className="ag-state">
      <StateHeader
        eyebrow="AGENT GATE ACCESS READY"
        title={<>Your Agent Gate access is ready.</>}
        lead="Payment verified. Your organization, plan and API credential have been set up automatically."
      />

      <dl className="pm-welcome-card" aria-label="Your Agent Gate plan">
        <div><dt>Plan</dt><dd>{planName}</dd></div>
        <div><dt>Organization</dt><dd>{status.organization?.name ?? 'Your organization'}</dd></div>
        <div>
          <dt>Monthly verification limit</dt>
          <dd>
            {status.plan
              ? `${status.plan.monthly_limit.toLocaleString('en-US')} verifications`
              : 'Included with your plan'}
          </dd>
        </div>
        <div><dt>Subscription</dt><dd>{formatSubscription(status.subscription_state)}</dd></div>
        <div><dt>API endpoint</dt><dd><code>{endpoint}</code></dd></div>
      </dl>

      <ApiKeyReveal keyState={keyState} knownKeyPrefix={status.key_prefix} onReveal={onReveal} />
      <QuickStartExample endpoint={endpoint} />
    </div>
  );
}

export default AccessReady;
