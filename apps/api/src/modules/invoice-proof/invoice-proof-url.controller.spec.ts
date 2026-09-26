/**
 * Work Item 2 (URL intake for InvoiceProof) — controller wiring for
 * POST /invoice-proof/scan-url: public route, delegates to
 * InvoiceProofService.scanUrl() with a trimmed URL + resolved client IP,
 * rejects a missing/blank url BEFORE ever calling the service.
 */
import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator.js';
import { InvoiceProofController } from './invoice-proof.controller.js';

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: '203.0.113.5',
    ...overrides,
  } as unknown as Request;
}

describe('POST /invoice-proof/scan-url — route wiring', () => {
  it('is marked @Public() — matches scan/scan-pdf (anonymous free-scan gate applies, not JWT)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, InvoiceProofController.prototype.scanUrl)).toBe(true);
  });

  it('delegates to invoiceProof.scanUrl with the trimmed url, user, client IP, and email', async () => {
    const scanUrl = jest.fn().mockResolvedValue({ status: 'SCANNED', ok: true, extraction: null, scan: null });
    const controller = new InvoiceProofController({ scanUrl } as never);
    const user = { id: 'user-1', email: 'u@x.co', displayName: 'U', role: 'USER' };

    await controller.scanUrl(
      { url: '  https://vendor.example.com/invoice  ' },
      user as never,
      makeRequest(),
      'notify@example.com',
    );

    expect(scanUrl).toHaveBeenCalledWith(
      'https://vendor.example.com/invoice', // trimmed
      user,
      '203.0.113.5',
      'notify@example.com',
    );
  });

  it('resolves client IP from X-Forwarded-For when present, same as scan/scan-pdf', async () => {
    const scanUrl = jest.fn().mockResolvedValue({ status: 'SCANNED', ok: true, extraction: null, scan: null });
    const controller = new InvoiceProofController({ scanUrl } as never);

    await controller.scanUrl(
      { url: 'https://vendor.example.com/invoice' },
      null,
      makeRequest({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } }),
      undefined,
    );

    expect(scanUrl.mock.calls[0][2]).toBe('198.51.100.7');
  });

  it('rejects a missing url BEFORE calling the service', async () => {
    const scanUrl = jest.fn();
    const controller = new InvoiceProofController({ scanUrl } as never);

    await expect(controller.scanUrl({}, null, makeRequest(), undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(scanUrl).not.toHaveBeenCalled();
  });

  it('rejects a blank/whitespace-only url BEFORE calling the service', async () => {
    const scanUrl = jest.fn();
    const controller = new InvoiceProofController({ scanUrl } as never);

    await expect(controller.scanUrl({ url: '   ' }, null, makeRequest(), undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(scanUrl).not.toHaveBeenCalled();
  });
});
