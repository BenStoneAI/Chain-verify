import { type NextRequest, NextResponse } from 'next/server';

import { forwardHeaders, proxyToApi, upstreamUrl } from '@/lib/invoice-proof/proxy';
import { allowRequest } from '@/lib/invoice-proof/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requestedSessionHistory(body: unknown): boolean {
  return Boolean(
    body && typeof body === 'object' && 'useSessionHistory' in body && body.useSessionHistory === true,
  );
}

/** Thin proxy: scan auth, quota, and persistence live in the API (POST /api/invoice-proof/scan). */
export async function POST(request: NextRequest) {
  if (!allowRequest(request)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  return proxyToApi(
    upstreamUrl('/scan', request),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...forwardHeaders(request) },
      body: JSON.stringify(body),
    },
    { sessionHistoryUsed: requestedSessionHistory(body) },
  );
}
