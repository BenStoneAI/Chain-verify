import { type NextRequest, NextResponse } from 'next/server';

import { forwardHeaders, proxyToApi, upstreamUrl } from '@/lib/invoice-proof/proxy';
import { allowRequest } from '@/lib/invoice-proof/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PDF_BYTES = 10 * 1024 * 1024; // mirrors the API limit; reject early

/** Thin multipart proxy to POST /api/invoice-proof/scan-pdf. Extraction and gating live in the API. */
export async function POST(request: NextRequest) {
  if (!allowRequest(request)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Try again shortly.' }, { status: 429 });
  }

  let inForm: FormData;
  try {
    inForm = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data upload' }, { status: 400 });
  }

  const file = inForm.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No PDF file provided (field "file")' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Uploaded file is empty' }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: 'PDF exceeds the 10 MB limit' }, { status: 413 });
  }

  const outForm = new FormData();
  outForm.append('file', file, file.name || 'invoice.pdf');

  // Do not set Content-Type: fetch supplies the multipart boundary.
  return proxyToApi(upstreamUrl('/scan-pdf', request), {
    method: 'POST',
    headers: forwardHeaders(request),
    body: outForm,
  });
}
