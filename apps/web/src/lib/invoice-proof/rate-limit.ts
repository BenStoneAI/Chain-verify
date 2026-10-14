import type { NextRequest } from 'next/server';

// Best-effort in-memory IP limiter for the public invoice scan proxies.
// It only blunts abuse within a single server instance; authoritative quota and
// free-scan gating are enforced by the Chain Verify API.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

const globalForRateLimit = globalThis as typeof globalThis & {
  __invoiceProofRequests?: Map<string, number[]>;
};
const requests = (globalForRateLimit.__invoiceProofRequests ??= new Map<string, number[]>());

export function clientKey(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0]!.trim() : null) || req.headers.get('x-real-ip') || 'unknown';
}

/** Returns true when the request is within the limit, false when it should be rejected with 429. */
export function allowRequest(req: NextRequest): boolean {
  const key = clientKey(req);
  const now = Date.now();
  const recent = (requests.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    requests.set(key, recent);
    return false;
  }
  recent.push(now);
  requests.set(key, recent);
  return true;
}
