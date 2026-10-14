/**
 * Agent Gate post-purchase state machine: reducer, backoff schedule, polling
 * loop and the once-only API key claimer. Pure TypeScript (no React, no DOM)
 * so the whole flow is unit-testable.
 *
 * Key handling rules enforced here:
 *  - the plaintext key only lives in `ProvisioningState.key` (React memory),
 *  - it is never written to storage, URL, console or analytics,
 *  - claim-key is requested at most once per claimer (one per page load).
 */

import type {
  ProvisionServerState,
  ProvisionStatus,
  ProvisioningApi,
} from './agentGateProvisioningApi';
import { ProvisioningRequestError } from './agentGateProvisioningApi';

export type Phase =
  | 'invalid_session'
  | 'verifying'
  | 'provisioning'
  | 'ready'
  | 'needs_organization'
  | 'failed';

export type FailureReason = 'timeout' | 'payment_failed' | 'rejected';

export type KeyState =
  | { kind: 'idle' }
  | { kind: 'claiming' }
  | { kind: 'revealed'; apiKey: string; keyPrefix: string; endpoint: string | null }
  | { kind: 'already_issued'; keyPrefix: string | null }
  | { kind: 'expired' }
  | { kind: 'cleared' }
  | { kind: 'error'; message: string };

export interface ProvisioningState {
  phase: Phase;
  status: ProvisionStatus | null;
  failure: FailureReason | null;
  /** Latest transient connection problem; cleared by the next good response. */
  connectionError: string | null;
  key: KeyState;
}

export type ProvisioningAction =
  | { type: 'STATUS_RECEIVED'; status: ProvisionStatus }
  | { type: 'POLL_FAILED'; message: string }
  | { type: 'REQUEST_REJECTED'; message: string }
  | { type: 'TIMED_OUT' }
  | { type: 'RETRY_REQUESTED' }
  | { type: 'ORGANIZATION_SUBMITTED' }
  | { type: 'CLAIM_STARTED' }
  | { type: 'CLAIM_SUCCEEDED'; apiKey: string; keyPrefix: string; endpoint: string | null }
  | { type: 'CLAIM_ALREADY_ISSUED'; keyPrefix: string | null }
  | { type: 'CLAIM_EXPIRED' }
  | { type: 'CLAIM_FAILED'; message: string }
  | { type: 'KEY_CLEARED' };

export function createInitialState(hasValidSession: boolean): ProvisioningState {
  return {
    phase: hasValidSession ? 'verifying' : 'invalid_session',
    status: null,
    failure: null,
    connectionError: null,
    key: { kind: 'idle' },
  };
}

const PHASE_BY_SERVER_STATE: Record<ProvisionServerState, Phase> = {
  VERIFYING: 'verifying',
  PROVISIONING: 'provisioning',
  READY: 'ready',
  NEEDS_ORGANIZATION: 'needs_organization',
  FAILED: 'failed',
};

export function provisioningReducer(
  state: ProvisioningState,
  action: ProvisioningAction,
): ProvisioningState {
  switch (action.type) {
    case 'STATUS_RECEIVED':
      return {
        ...state,
        phase: PHASE_BY_SERVER_STATE[action.status.state],
        status: action.status,
        failure: action.status.state === 'FAILED' ? 'payment_failed' : null,
        connectionError: null,
      };
    case 'POLL_FAILED':
      return { ...state, connectionError: action.message };
    case 'REQUEST_REJECTED':
      return { ...state, phase: 'failed', failure: 'rejected', connectionError: action.message };
    case 'TIMED_OUT':
      return { ...state, phase: 'failed', failure: 'timeout' };
    case 'RETRY_REQUESTED':
      return { ...state, phase: 'verifying', failure: null, connectionError: null };
    case 'ORGANIZATION_SUBMITTED':
      return { ...state, phase: 'provisioning', failure: null, connectionError: null };
    case 'CLAIM_STARTED':
      // Once-only: a claim can only begin from the untouched state.
      return state.key.kind === 'idle' ? { ...state, key: { kind: 'claiming' } } : state;
    case 'CLAIM_SUCCEEDED':
      return {
        ...state,
        key: {
          kind: 'revealed',
          apiKey: action.apiKey,
          keyPrefix: action.keyPrefix,
          endpoint: action.endpoint,
        },
      };
    case 'CLAIM_ALREADY_ISSUED':
      return { ...state, key: { kind: 'already_issued', keyPrefix: action.keyPrefix } };
    case 'CLAIM_EXPIRED':
      return { ...state, key: { kind: 'expired' } };
    case 'CLAIM_FAILED':
      return { ...state, key: { kind: 'error', message: action.message } };
    case 'KEY_CLEARED':
      return state.key.kind === 'revealed' ? { ...state, key: { kind: 'cleared' } } : state;
    default:
      return state;
  }
}

/* ---------------------------- backoff + polling --------------------------- */

/** Delay before each successive status poll; the last value repeats. */
export const POLL_BACKOFF_MS: readonly number[] = [1000, 1500, 2000, 3000, 4000, 5000];
/** Still not ready after this long: actively re-check Stripe once. */
export const RECONCILE_AFTER_MS = 6000;
/** Stop polling after this long, reconcile one final time, then show the failure state. */
export const MAX_POLL_MS = 60000;

export function backoffDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), POLL_BACKOFF_MS.length - 1);
  return POLL_BACKOFF_MS[index];
}

export function isTerminalState(state: ProvisionServerState): boolean {
  return state === 'READY' || state === 'NEEDS_ORGANIZATION' || state === 'FAILED';
}

export interface LoopDeps {
  api: ProvisioningApi;
  dispatch: (action: ProvisioningAction) => void;
  signal: AbortSignal;
  /** Must resolve (not reject) when the signal aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
}

export interface LoopOptions {
  /** Open with a reconcile call (used by Retry and after organization setup). */
  startWithReconcile?: boolean;
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

export async function runProvisioningLoop(deps: LoopDeps, options: LoopOptions = {}): Promise<void> {
  const { api, dispatch, signal, sleep, now } = deps;
  const startedAt = now();
  let attempt = 0;
  let forceReconcile = options.startWithReconcile === true;
  let softReconcileDone = forceReconcile;

  while (!signal.aborted) {
    const elapsed = now() - startedAt;
    const timedOut = elapsed >= MAX_POLL_MS;
    const useReconcile =
      forceReconcile || timedOut || (!softReconcileDone && elapsed >= RECONCILE_AFTER_MS);

    let status: ProvisionStatus | null = null;
    try {
      status = useReconcile ? await api.reconcile(signal) : await api.status(signal);
    } catch (error) {
      if (signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Connection problem.';
      if (error instanceof ProvisioningRequestError && !error.retryable) {
        dispatch({ type: 'REQUEST_REJECTED', message });
        return;
      }
      dispatch({ type: 'POLL_FAILED', message });
    }
    if (signal.aborted) return;

    if (useReconcile) {
      forceReconcile = false;
      softReconcileDone = true;
    }

    if (status) {
      dispatch({ type: 'STATUS_RECEIVED', status });
      if (isTerminalState(status.state)) return;
    }

    if (timedOut) {
      dispatch({ type: 'TIMED_OUT' });
      return;
    }

    const remaining = MAX_POLL_MS - (now() - startedAt);
    await sleep(Math.max(0, Math.min(backoffDelay(attempt), remaining)), signal);
    attempt += 1;
  }
}

/* ------------------------------ key claiming ------------------------------ */

export interface KeyClaimer {
  /** Idempotent: every call after the first returns the first call's promise. */
  claim: () => Promise<void>;
}

/** One claimer per page load; guarantees claim-key is requested at most once. */
export function createKeyClaimer(
  api: ProvisioningApi,
  dispatch: (action: ProvisioningAction) => void,
): KeyClaimer {
  let inFlight: Promise<void> | null = null;

  async function run(): Promise<void> {
    dispatch({ type: 'CLAIM_STARTED' });
    const result = await api.claimKey();
    switch (result.outcome) {
      case 'issued':
        dispatch({
          type: 'CLAIM_SUCCEEDED',
          apiKey: result.apiKey,
          keyPrefix: result.keyPrefix,
          endpoint: result.endpoint,
        });
        return;
      case 'already_issued':
        dispatch({ type: 'CLAIM_ALREADY_ISSUED', keyPrefix: result.keyPrefix });
        return;
      case 'expired':
        dispatch({ type: 'CLAIM_EXPIRED' });
        return;
      case 'rejected':
      case 'network_error':
        dispatch({ type: 'CLAIM_FAILED', message: result.message });
        return;
    }
  }

  return {
    claim() {
      if (!inFlight) inFlight = run();
      return inFlight;
    },
  };
}
