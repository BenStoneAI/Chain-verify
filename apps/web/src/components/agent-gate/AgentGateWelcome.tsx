'use client';

import { AccessReady } from './AccessReady';
import { InvalidSession } from './InvalidSession';
import { OrganizationSetup } from './OrganizationSetup';
import { PaymentNotVerified } from './PaymentNotVerified';
import { ProvisioningInProgress } from './ProvisioningInProgress';
import { useAgentGateProvisioning } from './useAgentGateProvisioning';
import { VerifyingPayment } from './VerifyingPayment';

export interface AgentGateWelcomeProps {
  sessionId?: string;
  /** `plan` query alias (agent-gate-* or legacy verify-api-*). */
  plan?: string;
}

/** Automated post-purchase experience for Agent Gate (states 1 to 5). */
export function AgentGateWelcome({ sessionId, plan }: AgentGateWelcomeProps) {
  const { state, retry, resumeAfterOrganization, revealKey } = useAgentGateProvisioning(sessionId);

  switch (state.phase) {
    case 'invalid_session':
      return <InvalidSession />;

    case 'verifying':
      return <VerifyingPayment connectionError={state.connectionError} />;

    case 'provisioning':
      return <ProvisioningInProgress connectionError={state.connectionError} />;

    case 'needs_organization':
      return (
        <OrganizationSetup
          sessionId={sessionId ?? ''}
          planSlug={state.status?.plan?.slug ?? plan ?? null}
          onComplete={resumeAfterOrganization}
        />
      );

    case 'ready':
      return state.status ? (
        <AccessReady
          status={state.status}
          planParam={plan}
          keyState={state.key}
          onReveal={revealKey}
        />
      ) : null;

    case 'failed':
      return (
        <PaymentNotVerified
          reason={state.failure}
          sessionId={sessionId ?? ''}
          detail={state.failure === 'rejected' ? state.connectionError : null}
          onRetry={retry}
        />
      );
  }
}

export default AgentGateWelcome;
