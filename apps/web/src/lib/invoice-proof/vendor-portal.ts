import { resolveProofApiBase } from '@/lib/proof-api';

/**
 * Posts to the public vendor-portal endpoints. These authenticate with the portal token
 * in the URL plus an emailed one-time code, not with a customer API key.
 */
export async function postVendorPortal(path: string, body?: Record<string, string>): Promise<void> {
  const res = await fetch(`${resolveProofApiBase()}/api/invoice-proof/vendor-portal/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return;

  let message = `Request failed (${res.status})`;
  try {
    const data = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(data.message)) message = data.message.join(', ');
    else if (data.message) message = data.message;
  } catch {
    // non-JSON error body
  }
  throw new Error(message);
}
