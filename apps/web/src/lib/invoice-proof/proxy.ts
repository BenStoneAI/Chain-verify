import { type NextRequest, NextResponse } from 'next/server';

import { resolveProofApiBase } from '@/lib/proof-api';

import { clientKey } from './rate-limit';

export const UPGRADE_HREF = '/invoice-proof#plans';

/** Header carrying a Chain Verify API key (the API also accepts Authorization: Bearer). */
const API_KEY_HEADER = 'x-chain-verify-api-key';

export function upstreamUrl(path: string, request: NextRequest): string {
  const email = request.nextUrl.searchParams.get('email');
  const query = email ? `?email=${encodeURIComponent(email)}` : '';
  return `${resolveProofApiBase()}/api/invoice-proof${path}${query}`;
}

/** Forwards the caller's API key (if any) and the client IP used by the free-scan gate. */
export function forwardHeaders(request: NextRequest): Record<string, string> {
  const ip = clientKey(request);
  const headers: Record<string, string> = { 'X-Forwarded-For': ip, 'X-Real-IP': ip };
  const auth = request.headers.get('authorization');
  if (auth) headers.Authorization = auth;
  const apiKey = request.headers.get(API_KEY_HEADER);
  if (apiKey) headers[API_KEY_HEADER] = apiKey;
  return headers;
}

function asObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

/**
 * Relays an upstream API response. 402/403 (quota or free-scan gate) always point the
 * browser at the plans section instead of whatever URL the API reported.
 */
export async function relayUpstream(
  upstream: Response,
  extra: Record<string, unknown> = {},
): Promise<NextResponse> {
  const parsed: unknown = await upstream.json().catch(() => ({ error: 'Invalid upstream response' }));
  const body: unknown = Array.isArray(parsed) ? parsed : { ...asObject(parsed), ...extra };
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };

  if (!Array.isArray(body) && (upstream.status === 402 || upstream.status === 403)) {
    Object.assign(body as Record<string, unknown>, { upgradeUrl: UPGRADE_HREF });
    headers['X-InvoiceProof-Upgrade'] = UPGRADE_HREF;
  }
  return NextResponse.json(body, { status: upstream.status, headers });
}

export async function proxyToApi(
  url: string,
  init: RequestInit,
  extra?: Record<string, unknown>,
): Promise<NextResponse> {
  try {
    const upstream = await fetch(url, { ...init, cache: 'no-store' });
    return await relayUpstream(upstream, extra);
  } catch {
    return NextResponse.json(
      { error: 'InvoiceProof service is temporarily unreachable. Try again shortly.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
