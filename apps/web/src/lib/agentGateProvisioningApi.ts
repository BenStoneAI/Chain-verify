/**
 * HTTP client for the Agent Gate post-purchase provisioning endpoints.
 *
 * Contract (served by the Chain Verify API):
 *   GET  /api/billing/proof/provision-status?session_id=cs_...
 *   POST /api/billing/proof/reconcile   { session_id }
 *   POST /api/billing/proof/claim-key   { session_id }
 *
 * This module never logs, stores, or caches anything. The plaintext API key
 * only ever exists in the return value of `claimKey`.
 */

export type ProvisionServerState =
  | 'VERIFYING'
  | 'PROVISIONING'
  | 'READY'
  | 'NEEDS_ORGANIZATION'
  | 'FAILED';

export interface ProvisionPlan {
  slug: string;
  name: string;
  monthly_limit: number;
}

export interface ProvisionStatus {
  state: ProvisionServerState;
  plan?: ProvisionPlan;
  organization?: { name: string };
  subscription_state?: string;
  endpoint?: string;
  key_issued?: boolean;
  key_prefix?: string;
}

export type ClaimResult =
  | { outcome: 'issued'; apiKey: string; keyPrefix: string; endpoint: string | null }
  | { outcome: 'already_issued'; keyPrefix: string | null }
  | { outcome: 'expired' }
  | { outcome: 'rejected'; message: string }
  | { outcome: 'network_error'; message: string };

export interface ProvisioningApi {
  status(signal?: AbortSignal): Promise<ProvisionStatus>;
  reconcile(signal?: AbortSignal): Promise<ProvisionStatus>;
  claimKey(signal?: AbortSignal): Promise<ClaimResult>;
}

/** Thrown by status/reconcile. `retryable` is false for definitive 4xx answers. */
export class ProvisioningRequestError extends Error {
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(message: string, httpStatus: number | null, retryable: boolean) {
    super(message);
    this.name = 'ProvisioningRequestError';
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

const STATES: readonly ProvisionServerState[] = [
  'VERIFYING',
  'PROVISIONING',
  'READY',
  'NEEDS_ORGANIZATION',
  'FAILED',
];

const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{8,200}$/;

export function isValidSessionId(value: string | null | undefined): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function parseProvisionStatus(payload: unknown): ProvisionStatus | null {
  const body = asRecord(payload);
  if (!body) return null;
  const state = STATES.find((candidate) => candidate === body.state);
  if (!state) return null;

  const status: ProvisionStatus = { state };
  const plan = asRecord(body.plan);
  const slug = asString(plan?.slug);
  const name = asString(plan?.name);
  if (plan && slug && name) {
    const limit = Number(plan.monthly_limit);
    status.plan = { slug, name, monthly_limit: Number.isFinite(limit) ? limit : 0 };
  }
  const orgName = asString(asRecord(body.organization)?.name);
  if (orgName) status.organization = { name: orgName };
  const subscription = asString(body.subscription_state);
  if (subscription) status.subscription_state = subscription;
  const endpoint = asString(body.endpoint);
  if (endpoint) status.endpoint = endpoint;
  if (typeof body.key_issued === 'boolean') status.key_issued = body.key_issued;
  const prefix = asString(body.key_prefix);
  if (prefix) status.key_prefix = prefix;
  return status;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageFrom(payload: unknown, fallback: string): string {
  const body = asRecord(payload);
  return asString(body?.message) ?? asString(body?.error) ?? fallback;
}

export interface CreateProvisioningApiOptions {
  baseUrl: string;
  sessionId: string;
  fetchImpl?: typeof fetch;
}

export function createProvisioningApi(options: CreateProvisioningApiOptions): ProvisioningApi {
  const { baseUrl, sessionId } = options;
  const doFetch: typeof fetch = options.fetchImpl ?? ((...args) => fetch(...args));
  const root = `${baseUrl.replace(/\/$/, '')}/api/billing/proof`;

  async function requestStatus(init: RequestInit, url: string): Promise<ProvisionStatus> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, cache: 'no-store' });
    } catch {
      throw new ProvisioningRequestError('Network error while checking your payment.', null, true);
    }
    const payload = await readJson(response);
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 429 || response.status === 408;
      throw new ProvisioningRequestError(
        messageFrom(payload, `Payment check failed (HTTP ${response.status}).`),
        response.status,
        retryable,
      );
    }
    const status = parseProvisionStatus(payload);
    if (!status) {
      throw new ProvisioningRequestError('Unexpected response while checking your payment.', null, true);
    }
    return status;
  }

  const postJson = (signal?: AbortSignal): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
    signal,
  });

  return {
    status: (signal) =>
      requestStatus(
        { method: 'GET', signal },
        `${root}/provision-status?session_id=${encodeURIComponent(sessionId)}`,
      ),
    reconcile: (signal) => requestStatus(postJson(signal), `${root}/reconcile`),

    async claimKey(signal) {
      let response: Response;
      try {
        response = await doFetch(`${root}/claim-key`, { ...postJson(signal), cache: 'no-store' });
      } catch {
        return { outcome: 'network_error', message: 'Network error while requesting your key.' };
      }
      const payload = await readJson(response);
      const body = asRecord(payload);

      if (response.status === 200) {
        const apiKey = asString(body?.api_key);
        if (!apiKey) {
          return { outcome: 'rejected', message: 'The server did not return a key.' };
        }
        return {
          outcome: 'issued',
          apiKey,
          keyPrefix: asString(body?.key_prefix) ?? apiKey.slice(0, 12),
          endpoint: asString(body?.endpoint) ?? null,
        };
      }
      if (response.status === 409) {
        return { outcome: 'already_issued', keyPrefix: asString(body?.key_prefix) ?? null };
      }
      if (response.status === 410) return { outcome: 'expired' };
      return {
        outcome: 'rejected',
        message: messageFrom(payload, `Your key could not be issued (HTTP ${response.status}).`),
      };
    },
  };
}
