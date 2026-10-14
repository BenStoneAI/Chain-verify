'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  abortableSleep,
  createInitialState,
  createKeyClaimer,
  provisioningReducer,
  runProvisioningLoop,
  type LoopOptions,
  type ProvisioningState,
} from '@/lib/agentGateProvisioning';
import { createProvisioningApi, isValidSessionId } from '@/lib/agentGateProvisioningApi';
import { resolveProofApiBase } from '@/lib/proof-api';

export interface AgentGateProvisioning {
  state: ProvisioningState;
  /** Re-check Stripe (Retry verification button). */
  retry: () => void;
  /** Called after the organization form was accepted; resumes polling. */
  resumeAfterOrganization: () => void;
  /** Requests the one-time API key. Safe to call repeatedly: one request per page load. */
  revealKey: () => void;
}

export function useAgentGateProvisioning(sessionId: string | undefined): AgentGateProvisioning {
  const validSession = isValidSessionId(sessionId) ? sessionId : null;
  const [state, dispatch] = useReducer(provisioningReducer, validSession !== null, createInitialState);
  const [runId, setRunId] = useState(0);
  const loopOptions = useRef<LoopOptions>({});

  const api = useMemo(
    () =>
      validSession
        ? createProvisioningApi({ baseUrl: resolveProofApiBase(), sessionId: validSession })
        : null,
    [validSession],
  );
  const claimer = useMemo(() => (api ? createKeyClaimer(api, dispatch) : null), [api]);

  useEffect(() => {
    if (!api) return undefined;
    const controller = new AbortController();
    void runProvisioningLoop(
      { api, dispatch, signal: controller.signal, sleep: abortableSleep, now: () => Date.now() },
      loopOptions.current,
    );
    return () => controller.abort();
  }, [api, runId]);

  // The plaintext key must not survive navigation, bfcache restores or unmount.
  useEffect(() => {
    const clear = () => dispatch({ type: 'KEY_CLEARED' });
    window.addEventListener('pagehide', clear);
    return () => {
      window.removeEventListener('pagehide', clear);
      clear();
    };
  }, []);

  const restart = useCallback((action: 'RETRY_REQUESTED' | 'ORGANIZATION_SUBMITTED') => {
    loopOptions.current = { startWithReconcile: true };
    dispatch({ type: action });
    setRunId((value) => value + 1);
  }, []);

  const retry = useCallback(() => restart('RETRY_REQUESTED'), [restart]);
  const resumeAfterOrganization = useCallback(() => restart('ORGANIZATION_SUBMITTED'), [restart]);
  const revealKey = useCallback(() => {
    void claimer?.claim();
  }, [claimer]);

  return { state, retry, resumeAfterOrganization, revealKey };
}
