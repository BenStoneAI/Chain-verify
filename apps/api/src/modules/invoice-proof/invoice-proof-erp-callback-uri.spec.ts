import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoiceProofErpService, buildErpCallbackUri } from './invoice-proof-erp.service.js';

vi.mock('./credential-crypto.js', () => ({
  encryptCredentials: vi.fn((v: unknown) => JSON.stringify(v)),
  decryptCredentials: vi.fn((v: string) => JSON.parse(v)),
}));

describe('buildErpCallbackUri', () => {
  it('includes the /api global prefix on the configured public API base', () => {
    expect(buildErpCallbackUri('quickbooks', { API_BASE_URL: 'https://chain-verify-api.onrender.com' })).toBe(
      'https://chain-verify-api.onrender.com/api/invoice-proof/erp/callback/quickbooks',
    );
  });

  it('tolerates a trailing slash and an /api suffix without doubling the prefix', () => {
    const expected = 'https://api.example.com/api/invoice-proof/erp/callback/xero';
    expect(buildErpCallbackUri('XERO', { API_BASE_URL: 'https://api.example.com/' })).toBe(expected);
    expect(buildErpCallbackUri('xero', { API_BASE_URL: 'https://api.example.com/api' })).toBe(expected);
    expect(buildErpCallbackUri('xero', { API_BASE_URL: 'https://api.example.com/api/' })).toBe(expected);
  });

  it('defaults to localhost on the API listen port (3001), not 3000', () => {
    expect(buildErpCallbackUri('sage', {})).toBe('http://localhost:3001/api/invoice-proof/erp/callback/sage');
    expect(buildErpCallbackUri('sage', { PORT: '4100' })).toBe(
      'http://localhost:4100/api/invoice-proof/erp/callback/sage',
    );
    expect(buildErpCallbackUri('sage', { CHAIN_VERIFY_API_PORT: '4200', PORT: '4100' })).toBe(
      'http://localhost:4200/api/invoice-proof/erp/callback/sage',
    );
  });
});

describe('InvoiceProofErpService.startConnect redirect_uri', () => {
  const original = process.env.API_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.API_BASE_URL;
    else process.env.API_BASE_URL = original;
    vi.unstubAllEnvs();
  });

  it('sends the prefixed callback to the provider as redirect_uri', async () => {
    process.env.API_BASE_URL = 'https://chain-verify-api.onrender.com';
    vi.stubEnv('QUICKBOOKS_CLIENT_ID', 'cid');
    vi.stubEnv('QUICKBOOKS_CLIENT_SECRET', 'secret');
    const prisma = { orgErpConnection: { upsert: vi.fn().mockResolvedValue({}) } };
    const service = new InvoiceProofErpService(prisma as never);

    const result = await service.startConnect('org-1', 'quickbooks');

    const expected = 'https://chain-verify-api.onrender.com/api/invoice-proof/erp/callback/quickbooks';
    expect(result.callback).toBe(expected);
    expect(new URL(result.authUrl as string).searchParams.get('redirect_uri')).toBe(expected);
  });
});
