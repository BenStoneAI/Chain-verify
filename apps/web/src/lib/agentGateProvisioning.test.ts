import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_POLL_MS,
  POLL_BACKOFF_MS,
  RECONCILE_AFTER_MS,
  backoffDelay,
  createInitialState,
  createKeyClaimer,
  provisioningReducer,
  runProvisioningLoop,
  type ProvisioningAction,
  type ProvisioningState,
} from './agentGateProvisioning';
import {
  ProvisioningRequestError,
  createProvisioningApi,
  isValidSessionId,
  parseProvisionStatus,
  type ClaimResult,
  type ProvisionStatus,
  type ProvisioningApi,
} from './agentGateProvisioningApi';

const SESSION = 'cs_test_a1B2c3D4e5F6g7H8';
const READY: ProvisionStatus = {
  state: 'READY',
  plan: { slug: 'agent-gate-build', name: 'Agent Gate Build', monthly_limit: 1000 },
  organization: { name: 'Acme' },
  subscription_state: 'active',
  endpoint: 'https://api.example.test',
  key_issued: false,
};

function reduce(actions: ProvisioningAction[], start?: ProvisioningState): ProvisioningState {
  return actions.reduce(provisioningReducer, start ?? createInitialState(true));
}

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function fakeApi(overrides: Partial<ProvisioningApi> = {}) {
  const status = vi.fn(async () => ({ state: 'PROVISIONING' }) as ProvisionStatus);
  const reconcile = vi.fn(async () => ({ state: 'PROVISIONING' }) as ProvisionStatus);
  const claimKey = vi.fn(async (): Promise<ClaimResult> => ({
    outcome: 'issued',
    apiKey: 'ag_live_SECRETSECRET',
    keyPrefix: 'ag_live_SECR',
    endpoint: 'https://api.example.test',
  }));
  return { status, reconcile, claimKey, ...overrides } as ProvisioningApi & {
    status: typeof status;
    reconcile: typeof reconcile;
    claimKey: typeof claimKey;
  };
}

describe('session id validation', () => {
  it('accepts Stripe checkout session ids and rejects everything else', () => {
    expect(isValidSessionId(SESSION)).toBe(true);
    expect(isValidSessionId('cs_live_abcdef1234567890')).toBe(true);
    expect(isValidSessionId(undefined)).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('pi_123456789012')).toBe(false);
    expect(isValidSessionId('cs_test_<script>')).toBe(false);
    expect(createInitialState(false).phase).toBe('invalid_session');
  });
});

describe('reducer state transitions', () => {
  it('maps every server state to a phase', () => {
    const phases = (['VERIFYING', 'PROVISIONING', 'READY', 'NEEDS_ORGANIZATION', 'FAILED'] as const).map(
      (state) => reduce([{ type: 'STATUS_RECEIVED', status: { state } }]).phase,
    );
    expect(phases).toEqual(['verifying', 'provisioning', 'ready', 'needs_organization', 'failed']);
  });

  it('records payment_failed for FAILED and clears connection errors on success', () => {
    const failed = reduce([
      { type: 'POLL_FAILED', message: 'offline' },
      { type: 'STATUS_RECEIVED', status: { state: 'FAILED' } },
    ]);
    expect(failed.failure).toBe('payment_failed');
    expect(failed.connectionError).toBeNull();
  });

  it('times out into the failed state and Retry returns to verifying', () => {
    const timedOut = reduce([{ type: 'TIMED_OUT' }]);
    expect(timedOut).toMatchObject({ phase: 'failed', failure: 'timeout' });
    expect(provisioningReducer(timedOut, { type: 'RETRY_REQUESTED' })).toMatchObject({
      phase: 'verifying',
      failure: null,
    });
  });

  it('resumes as provisioning after organization setup', () => {
    const state = reduce([
      { type: 'STATUS_RECEIVED', status: { state: 'NEEDS_ORGANIZATION' } },
      { type: 'ORGANIZATION_SUBMITTED' },
    ]);
    expect(state.phase).toBe('provisioning');
  });

  it('only starts a claim from the idle key state', () => {
    const claiming = reduce([{ type: 'CLAIM_STARTED' }]);
    expect(claiming.key.kind).toBe('claiming');
    const again = provisioningReducer(
      reduce([{ type: 'CLAIM_STARTED' }, { type: 'CLAIM_ALREADY_ISSUED', keyPrefix: 'ag_live_abcd' }]),
      { type: 'CLAIM_STARTED' },
    );
    expect(again.key.kind).toBe('already_issued');
  });

  it('handles 409 and 410 claim outcomes and clears a revealed key', () => {
    expect(reduce([{ type: 'CLAIM_EXPIRED' }]).key.kind).toBe('expired');
    const revealed = reduce([
      { type: 'CLAIM_STARTED' },
      { type: 'CLAIM_SUCCEEDED', apiKey: 'ag_live_X', keyPrefix: 'ag_live_X', endpoint: null },
    ]);
    expect(revealed.key.kind).toBe('revealed');
    const cleared = provisioningReducer(revealed, { type: 'KEY_CLEARED' });
    expect(cleared.key).toEqual({ kind: 'cleared' });
    expect(JSON.stringify(cleared)).not.toContain('ag_live_X');
  });
});

describe('backoff schedule', () => {
  it('ramps from ~1s to 5s and then holds', () => {
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(POLL_BACKOFF_MS.length - 1)).toBe(5000);
    expect(backoffDelay(99)).toBe(5000);
    expect(backoffDelay(-3)).toBe(1000);
    const sorted = [...POLL_BACKOFF_MS].sort((a, b) => a - b);
    expect([...POLL_BACKOFF_MS]).toEqual(sorted);
  });
});

describe('polling loop', () => {
  it('stops immediately when the first status is READY', async () => {
    const api = fakeApi({ status: vi.fn(async () => READY) });
    const clock = fakeClock();
    const dispatch = vi.fn();
    await runProvisioningLoop({ api, dispatch, signal: new AbortController().signal, ...clock });
    expect(api.reconcile).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: 'STATUS_RECEIVED', status: READY });
    expect(clock.sleeps).toEqual([]);
  });

  it('polls on the backoff schedule, reconciles once after ~6s, and finishes when READY', async () => {
    const clock = fakeClock();
    const api = fakeApi();
    api.reconcile.mockImplementation(async () => READY);
    const dispatch = vi.fn();
    await runProvisioningLoop({ api, dispatch, signal: new AbortController().signal, ...clock });

    // status polls at t=0, 1000, 2500, 4500; the next wake-up (7500) is past 6s -> reconcile.
    expect(clock.sleeps).toEqual([1000, 1500, 2000, 3000]);
    expect(api.status).toHaveBeenCalledTimes(4);
    expect(api.reconcile).toHaveBeenCalledTimes(1);
    expect(clock.now()).toBeGreaterThanOrEqual(RECONCILE_AFTER_MS);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'STATUS_RECEIVED', status: READY });
  });

  it('after the max window calls reconcile one last time then reports a timeout', async () => {
    const clock = fakeClock();
    const api = fakeApi();
    const dispatch = vi.fn();
    await runProvisioningLoop({ api, dispatch, signal: new AbortController().signal, ...clock });

    expect(clock.now()).toBeGreaterThanOrEqual(MAX_POLL_MS);
    expect(clock.now()).toBeLessThan(MAX_POLL_MS + 1);
    // one soft reconcile at ~6s + one final reconcile at timeout
    expect(api.reconcile).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'TIMED_OUT' });
  });

  it('survives transient network errors and keeps polling', async () => {
    const clock = fakeClock();
    const status = vi
      .fn()
      .mockRejectedValueOnce(new ProvisioningRequestError('offline', null, true))
      .mockResolvedValueOnce(READY);
    const dispatch = vi.fn();
    await runProvisioningLoop({
      api: fakeApi({ status }),
      dispatch,
      signal: new AbortController().signal,
      ...clock,
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'POLL_FAILED', message: 'offline' });
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'STATUS_RECEIVED', status: READY });
  });

  it('stops with REQUEST_REJECTED on a definitive 4xx', async () => {
    const status = vi.fn().mockRejectedValue(new ProvisioningRequestError('No such session', 404, false));
    const dispatch = vi.fn();
    await runProvisioningLoop({
      api: fakeApi({ status }),
      dispatch,
      signal: new AbortController().signal,
      ...fakeClock(),
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'REQUEST_REJECTED', message: 'No such session' });
    expect(status).toHaveBeenCalledTimes(1);
  });

  it('opens with reconcile when asked (Retry button / after org setup)', async () => {
    const api = fakeApi();
    api.reconcile.mockImplementation(async () => READY);
    await runProvisioningLoop(
      { api, dispatch: vi.fn(), signal: new AbortController().signal, ...fakeClock() },
      { startWithReconcile: true },
    );
    expect(api.reconcile).toHaveBeenCalledTimes(1);
    expect(api.status).not.toHaveBeenCalled();
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    const api = fakeApi({
      status: vi.fn(async () => {
        controller.abort();
        return { state: 'PROVISIONING' } as ProvisionStatus;
      }),
    });
    const dispatch = vi.fn();
    await runProvisioningLoop({ api, dispatch, signal: controller.signal, ...fakeClock() });
    expect(api.status).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('once-only key claim', () => {
  it('issues exactly one claim-key request however often Reveal is triggered', async () => {
    const api = fakeApi();
    const actions: ProvisioningAction[] = [];
    const claimer = createKeyClaimer(api, (action) => actions.push(action));
    await Promise.all([claimer.claim(), claimer.claim(), claimer.claim()]);
    await claimer.claim();
    expect(api.claimKey).toHaveBeenCalledTimes(1);
    expect(actions.map((a) => a.type)).toEqual(['CLAIM_STARTED', 'CLAIM_SUCCEEDED']);
  });

  it.each([
    [{ outcome: 'already_issued', keyPrefix: 'ag_live_abcd' } as ClaimResult, 'already_issued'],
    [{ outcome: 'expired' } as ClaimResult, 'expired'],
    [{ outcome: 'rejected', message: 'nope' } as ClaimResult, 'error'],
    [{ outcome: 'network_error', message: 'offline' } as ClaimResult, 'error'],
  ])('maps %o to key state %s', async (result, kind) => {
    const api = fakeApi({ claimKey: vi.fn(async () => result) });
    let state = createInitialState(true);
    const claimer = createKeyClaimer(api, (action) => {
      state = provisioningReducer(state, action);
    });
    await claimer.claim();
    expect(state.key.kind).toBe(kind);
  });
});

describe('api client', () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('calls the contract endpoints with the session id', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, { state: 'READY' });
    }) as unknown as typeof fetch;
    const api = createProvisioningApi({ baseUrl: 'https://api.test/', sessionId: SESSION, fetchImpl });
    await api.status();
    await api.reconcile();
    expect(calls[0].url).toBe(`https://api.test/api/billing/proof/provision-status?session_id=${SESSION}`);
    expect(calls[1].url).toBe('https://api.test/api/billing/proof/reconcile');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ session_id: SESSION });
  });

  it('maps claim-key 200 / 409 / 410 / 4xx / network failure', async () => {
    const responses = [
      jsonResponse(200, { api_key: 'ag_live_ABCDEFGH1234', key_prefix: 'ag_live_ABCD', endpoint: 'https://e.test' }),
      jsonResponse(409, { already_issued: true, key_prefix: 'ag_live_ABCD' }),
      jsonResponse(410, {}),
      jsonResponse(403, { message: 'Forbidden' }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch;
    const api = createProvisioningApi({ baseUrl: 'https://api.test', sessionId: SESSION, fetchImpl });
    expect(await api.claimKey()).toEqual({
      outcome: 'issued',
      apiKey: 'ag_live_ABCDEFGH1234',
      keyPrefix: 'ag_live_ABCD',
      endpoint: 'https://e.test',
    });
    expect(await api.claimKey()).toEqual({ outcome: 'already_issued', keyPrefix: 'ag_live_ABCD' });
    expect(await api.claimKey()).toEqual({ outcome: 'expired' });
    expect(await api.claimKey()).toEqual({ outcome: 'rejected', message: 'Forbidden' });

    const offline = createProvisioningApi({
      baseUrl: 'https://api.test',
      sessionId: SESSION,
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    expect((await offline.claimKey()).outcome).toBe('network_error');
  });

  it('classifies status failures as retryable (5xx) or definitive (4xx)', async () => {
    const make = (status: number) =>
      createProvisioningApi({
        baseUrl: 'https://api.test',
        sessionId: SESSION,
        fetchImpl: (async () => jsonResponse(status, { error: 'x' })) as unknown as typeof fetch,
      });
    await expect(make(503).status()).rejects.toMatchObject({ retryable: true });
    await expect(make(404).status()).rejects.toMatchObject({ retryable: false, httpStatus: 404 });
  });

  it('rejects malformed status payloads', () => {
    expect(parseProvisionStatus({ state: 'NOPE' })).toBeNull();
    expect(parseProvisionStatus(null)).toBeNull();
    expect(parseProvisionStatus({ state: 'READY', plan: { slug: 'a', name: 'A', monthly_limit: '500' } })).toMatchObject({
      plan: { monthly_limit: 500 },
    });
  });
});

describe('key is never persisted', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not touch storage or console while claiming and revealing a key', async () => {
    const setItem = vi.fn();
    const storage = { setItem, getItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );

    const api = fakeApi();
    let state = createInitialState(true);
    const claimer = createKeyClaimer(api, (action) => {
      state = provisioningReducer(state, action);
    });
    await claimer.claim();
    expect(state.key.kind).toBe('revealed');
    state = provisioningReducer(state, { type: 'KEY_CLEARED' });

    expect(setItem).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    spies.forEach((spy) => spy.mockRestore());
    expect(JSON.stringify(state)).not.toContain('SECRETSECRET');
  });

  it('never puts the key in the request URL', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ api_key: 'ag_live_SECRETSECRET' }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = createProvisioningApi({ baseUrl: 'https://api.test', sessionId: SESSION, fetchImpl });
    await api.claimKey();
    expect(urls.every((url) => !url.includes('SECRETSECRET'))).toBe(true);
  });
});
