/**
 * Work Item 2 (URL intake for InvoiceProof) — InvoiceProofService.scanUrl()
 * orchestration tests: mocked ConduitBrowserService + mocked DNS resolution
 * (no real browser, no real network — the real end-to-end pipeline, including
 * the REAL SSRF guard against a REAL local HTTP server, is proven by
 * scripts/url-intake-smoke.ts).
 *
 * Convention: direct class instantiation with mocked collaborators, matching
 * the existing "InvoiceProofService.scanPdf" describe block in
 * invoice-proof.service.spec.ts.
 */
vi.mock('./invoice-proof-scan.runner.js', () => ({
  hashFingerprint: vi.fn((v: string) => Buffer.from(v).toString('hex').slice(0, 64)),
  parseInvoiceScanBody: vi.fn((body: { invoices?: unknown[] }) => ({
    rows: (body.invoices ?? []).map((inv: Record<string, unknown>) => ({
      invoiceNo: inv.invoiceNo ?? 'INV-0',
      vendor: inv.vendor ?? 'Test Co',
      amount: Number(inv.amount ?? 0),
      po: inv.po ?? '',
      bank: inv.bank ?? '',
    })),
    vendorMaster: [],
    vendorMasterExtended: [],
    poRegister: [],
    seededHistory: [],
  })),
  runInvoiceScan: vi.fn(() => ({
    findings: [],
    findingCount: 0,
    rowCount: 1,
    coverage_summary: {},
  })),
}));

// DNS lookups must be mocked so assertSsrfSafeWithDns resolves deterministically
// without a real network call — same convention as deployment-checks.service.spec.ts.
const mockDnsLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => mockDnsLookup(...args),
}));

import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { InvoiceProofService } from './invoice-proof.service.js';

function makeService(overrides: {
  conduitBrowser?: Record<string, Mock> | undefined;
  pdfExtract?: Mock;
} = {}) {
  const prisma = { orgVendorMaster: { findFirst: vi.fn(), update: vi.fn() } };
  const pdfService = { extract: overrides.pdfExtract ?? vi.fn() };
  const conduitBrowser =
    overrides.conduitBrowser === undefined
      ? {
          initSession: vi.fn().mockResolvedValue(undefined),
          navigate: vi.fn(),
          extractMain: vi.fn(),
          accessibilitySnapshot: vi.fn(),
          closeSession: vi.fn().mockResolvedValue(undefined),
        }
      : overrides.conduitBrowser;

  const service = new InvoiceProofService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    pdfService as never,
    undefined,
    undefined,
    conduitBrowser as never,
  );
  return { service, conduitBrowser, pdfService };
}

describe('InvoiceProofService.scanUrl — SSRF guard (mandatory, checked before Conduit)', () => {
  it('rejects a private-IP-resolving hostname BEFORE any Conduit call is made', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    const { service, conduitBrowser } = makeService();

    await expect(service.scanUrl('https://internal.example.com/invoice', null, '127.0.0.1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(conduitBrowser.initSession).not.toHaveBeenCalled();
    expect(conduitBrowser.navigate).not.toHaveBeenCalled();
  });

  it('rejects a literal loopback/private-pattern hostname synchronously (no DNS lookup even needed)', async () => {
    const { service, conduitBrowser } = makeService();

    await expect(service.scanUrl('http://127.0.0.1/invoice', null, '127.0.0.1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(conduitBrowser.initSession).not.toHaveBeenCalled();
  });

  it('rejects a cloud metadata endpoint (169.254.169.254)', async () => {
    const { service, conduitBrowser } = makeService();

    await expect(
      service.scanUrl('http://169.254.169.254/latest/meta-data/', null, '127.0.0.1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(conduitBrowser.initSession).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) scheme', async () => {
    const { service, conduitBrowser } = makeService();

    await expect(service.scanUrl('file:///etc/passwd', null, '127.0.0.1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.scanUrl('javascript:alert(1)', null, '127.0.0.1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(conduitBrowser.initSession).not.toHaveBeenCalled();
  });

  it('rejects an unparseable URL', async () => {
    const { service, conduitBrowser } = makeService();

    await expect(service.scanUrl('not a url at all', null, '127.0.0.1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(conduitBrowser.initSession).not.toHaveBeenCalled();
  });

  it('allows a plain http:// URL through the SSRF gate (only non-http(s) schemes are blocked, per spec)', async () => {
    const { service, conduitBrowser } = makeService({
      conduitBrowser: {
        initSession: vi.fn().mockResolvedValue(undefined),
        navigate: vi.fn().mockResolvedValue({ success: false }),
        extractMain: vi.fn(),
        accessibilitySnapshot: vi.fn(),
        closeSession: vi.fn().mockResolvedValue(undefined),
      },
    });

    const result = await service.scanUrl('http://public-vendor-portal.example.com/invoice', null, '127.0.0.1');

    expect(conduitBrowser.initSession).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('FETCH_FAILED'); // navigation itself was mocked to fail, but it WAS attempted
  });
});

describe('InvoiceProofService.scanUrl — availability guard', () => {
  it('throws ServiceUnavailableException when no Conduit browser engine is configured', async () => {
    // Constructed with only the 5 required args (no 6th conduitBrowser arg at
    // all) — the exact shape every pre-existing test in this module uses,
    // proving this optional 6th param is truly backward compatible.
    const bareService = new InvoiceProofService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      bareService.scanUrl('https://vendor.example.com/invoice', null, '127.0.0.1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('InvoiceProofService.scanUrl — URL resolves directly to a PDF', () => {
  it('routes through the SAME pipeline as scanPdf() and tags extraction_method: url_pdf', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4 fake pdf bytes for this test');
    const conduitBrowser = {
      initSession: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue({
        success: true,
        contentType: 'application/pdf',
        bodyBase64: pdfBytes.toString('base64'),
      }),
      extractMain: vi.fn(),
      accessibilitySnapshot: vi.fn(),
      closeSession: vi.fn().mockResolvedValue(undefined),
    };
    const pdfExtract = vi.fn().mockResolvedValue({
      ok: true,
      extraction: {
        status: 'OK',
        confidence: 0.9,
        fields: { vendor: 'Acme', invoiceNo: 'INV-1', amount: 100 },
        warnings: [],
        pageCount: 1,
        charCount: 200,
      },
    });
    const { service } = makeService({ conduitBrowser, pdfExtract });
    const scanSpy = vi.spyOn(service, 'scan').mockResolvedValue({ scanId: 'scan-url-pdf-1' } as never);

    const result = await service.scanUrl('https://vendor.example.com/invoice.pdf', null, '127.0.0.1');

    // The PDF bytes handed to InvoicePdfService.extract() must be exactly what
    // Conduit's NAVIGATE response body contained — no second/separate fetch.
    expect(pdfExtract).toHaveBeenCalledTimes(1);
    expect(Buffer.compare(pdfExtract.mock.calls[0][0] as Buffer, pdfBytes)).toBe(0);

    expect(result.status).toBe('SCANNED');
    expect((result.extraction as { extraction_method?: string }).extraction_method).toBe('url_pdf');
    expect(scanSpy).toHaveBeenCalledTimes(1);
    // Session must always be closed, even on the success path.
    expect(conduitBrowser.closeSession).toHaveBeenCalledTimes(1);
  });

  it('a TEXT_EXTRACTION_FAILED PDF-via-URL result never calls scan() (same honesty contract as scanPdf)', async () => {
    const conduitBrowser = {
      initSession: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue({
        success: true,
        contentType: 'application/pdf',
        bodyBase64: Buffer.from('%PDF-1.4 scanned image only').toString('base64'),
      }),
      extractMain: vi.fn(),
      accessibilitySnapshot: vi.fn(),
      closeSession: vi.fn().mockResolvedValue(undefined),
    };
    const pdfExtract = vi.fn().mockResolvedValue({
      ok: true,
      extraction: {
        status: 'TEXT_EXTRACTION_FAILED',
        confidence: 0,
        fields: {},
        warnings: ['No usable text layer found.'],
        pageCount: 1,
        charCount: 0,
      },
    });
    const { service } = makeService({ conduitBrowser, pdfExtract });
    const scanSpy = vi.spyOn(service, 'scan');

    const result = await service.scanUrl('https://vendor.example.com/scan.pdf', null, '127.0.0.1');

    expect(scanSpy).not.toHaveBeenCalled();
    expect(result.status).toBe('TEXT_EXTRACTION_FAILED');
  });
});

describe('InvoiceProofService.scanUrl — HTML-rendered invoice page', () => {
  function makeHtmlConduitBrowser(mainText: string, snapshotJson: string | null) {
    return {
      initSession: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue({ success: true, contentType: 'text/html; charset=utf-8' }),
      extractMain: vi.fn().mockResolvedValue({ success: true, data: mainText }),
      accessibilitySnapshot: vi.fn().mockResolvedValue({ success: true, data: snapshotJson }),
      closeSession: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('extracts fields from the rendered page text via the SAME field parser (no parallel parser)', async () => {
    const mainText =
      'Acme Industrial Supply Invoice #: INV-9001 Invoice Date: 03/14/2026 PO Number: PO-1 ' +
      'Payment Terms: Net 30 Total Due: $500.00 Routing #: 021000021';
    const conduitBrowser = makeHtmlConduitBrowser(mainText, null);
    const { service } = makeService({ conduitBrowser });
    vi.spyOn(service, 'scan').mockResolvedValue({ scanId: 'scan-url-html-1' } as never);

    const result = await service.scanUrl('https://vendor-portal.example.com/invoice/9001', null, '127.0.0.1');

    const extraction = result.extraction as {
      fields: { invoiceNo?: string; amount?: number };
      extraction_method?: string;
    };
    expect(extraction.fields.invoiceNo).toBe('INV-9001');
    expect(extraction.fields.amount).toBe(500);
    expect(extraction.extraction_method).toBe('url_html');
  });

  it(
    'a fraud-critical field (amount) read from HTML is ALWAYS forced to NEEDS_REVIEW, never OK ' +
      '(mirrors Work Item 1\'s OCR gate — page content is not independently verified), but the ' +
      'fraud engine STILL runs (parity fix: NEEDS_REVIEW means "double-check the fields", not ' +
      '"withhold findings" — see the identical rule for OCR NEEDS_REVIEW in invoice-proof.service.ts)',
    async () => {
      const mainText =
        'Acme Industrial Supply Invoice #: INV-9002 Invoice Date: 03/14/2026 PO Number: PO-1 ' +
        'Payment Terms: Net 30 Total Due: $9,999.00';
      const conduitBrowser = makeHtmlConduitBrowser(mainText, null);
      const { service } = makeService({ conduitBrowser });
      const scanSpy = vi.spyOn(service, 'scan').mockResolvedValue({
        scanId: 'scan-url-html-fraud',
        findings: [{ pattern: 'Round-dollar amount (ROUND_DOLLAR_AMOUNT)', severity: 'medium' }],
      } as never);

      const result = await service.scanUrl('https://vendor-portal.example.com/invoice/9002', null, '127.0.0.1');

      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.status).not.toBe('OK');
      // The fraud engine must still run — findings are never withheld just
      // because the extraction itself needs a human's eyes.
      expect(scanSpy).toHaveBeenCalledTimes(1);
      expect(result.scan).not.toBeNull();
      const optionsArg = scanSpy.mock.calls[0][4] as
        | { skipHistoryWrite?: boolean; historySkippedReason?: string }
        | undefined;
      // History is still skipped — url_html content is unverified third-party
      // page content and must never seed the org's duplicate-detection baseline.
      expect(optionsArg?.skipHistoryWrite).toBe(true);
    },
  );

  it(
    'a fraud-relevant field read via BANK_ACCOUNT_CHANGE-style content still surfaces the finding ' +
      'through scan() while the extraction stays NEEDS_REVIEW (never silently downgraded below it)',
    async () => {
      const mainText =
        'Acme Industrial Supply Invoice #: INV-9004 Invoice Date: 03/14/2026 PO Number: PO-1 ' +
        'Payment Terms: Net 30 Total Due: $500.00 Routing #: 999999999';
      const conduitBrowser = makeHtmlConduitBrowser(mainText, null);
      const { service } = makeService({ conduitBrowser });
      const scanSpy = vi.spyOn(service, 'scan').mockResolvedValue({
        scanId: 'scan-url-html-bec',
        findings: [{ pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)', severity: 'critical' }],
      } as never);

      const result = await service.scanUrl('https://vendor-portal.example.com/invoice/9004', null, '127.0.0.1');

      expect(result.status).toBe('NEEDS_REVIEW');
      expect(scanSpy).toHaveBeenCalledTimes(1);
      expect(
        (result.scan as { findings: Array<{ pattern: string }> }).findings.some((f) =>
          f.pattern.includes('BANK_ACCOUNT_CHANGE'),
        ),
      ).toBe(true);
    },
  );

  it('an HTML page with NO fraud-relevant field at NEEDS_REVIEW does not call scan() — nothing useful to evaluate', async () => {
    // Vendor + invoice number only — no amount/bank/routing field at all, so
    // coreCount stays below 3 and the parser itself lands on NEEDS_REVIEW
    // with no fraud-critical field present.
    const mainText = 'Acme Industrial Supply Invoice #: INV-9005';
    const conduitBrowser = makeHtmlConduitBrowser(mainText, null);
    const { service } = makeService({ conduitBrowser });
    const scanSpy = vi.spyOn(service, 'scan');

    const result = await service.scanUrl('https://vendor-portal.example.com/invoice/9005', null, '127.0.0.1');

    expect(result.status).toBe('NEEDS_REVIEW');
    expect(scanSpy).not.toHaveBeenCalled();
    expect(result.scan).toBeNull();
  });

  it('combines EXTRACT_MAIN text with the ACCESSIBILITY_SNAPSHOT ariaSnapshot text (both signals feed the same parser)', async () => {
    const mainText = 'Acme Industrial Supply';
    // Real shape ACCESSIBILITY_SNAPSHOT returns (Playwright locator.ariaSnapshot()) —
    // see conduit-browser.service.ts's doc comment on that action.
    const ariaSnapshot = [
      '- paragraph: "Invoice #: INV-9003"',
      '- paragraph: "Invoice Date: 03/14/2026"',
      '- paragraph: "PO Number: PO-1"',
      '- paragraph: "Payment Terms: Net 30"',
    ].join('\n');
    const conduitBrowser = makeHtmlConduitBrowser(mainText, ariaSnapshot);
    const { service } = makeService({ conduitBrowser });

    const result = await service.scanUrl('https://vendor-portal.example.com/invoice/9003', null, '127.0.0.1');

    const extraction = result.extraction as { fields: { invoiceNo?: string; vendor?: string } };
    expect(extraction.fields.invoiceNo).toBe('INV-9003');
    expect(extraction.fields.vendor).toBe('Acme Industrial Supply');
  });

  it('a page with no usable extractable content returns TEXT_EXTRACTION_FAILED, never a fabricated field', async () => {
    const conduitBrowser = makeHtmlConduitBrowser('', null);
    const { service } = makeService({ conduitBrowser });

    const result = await service.scanUrl('https://vendor-portal.example.com/blank', null, '127.0.0.1');

    expect(result.status).toBe('TEXT_EXTRACTION_FAILED');
    expect((result.extraction as { fields: Record<string, unknown> } | null)?.fields).toEqual({});
  });
});

describe('InvoiceProofService.scanUrl — navigation failure and session cleanup', () => {
  it('returns FETCH_FAILED (not a thrown error) when Conduit NAVIGATE fails, and still closes the session', async () => {
    const conduitBrowser = {
      initSession: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockResolvedValue({ success: false }),
      extractMain: vi.fn(),
      accessibilitySnapshot: vi.fn(),
      closeSession: vi.fn().mockResolvedValue(undefined),
    };
    const { service } = makeService({ conduitBrowser });

    const result = await service.scanUrl('https://unreachable.example.com/invoice', null, '127.0.0.1');

    expect(result.status).toBe('FETCH_FAILED');
    expect(result.ok).toBe(false);
    expect(conduitBrowser.closeSession).toHaveBeenCalledTimes(1);
  });

  it('closes the Conduit session even when an action throws unexpectedly', async () => {
    const conduitBrowser = {
      initSession: vi.fn().mockResolvedValue(undefined),
      navigate: vi.fn().mockRejectedValue(new Error('boom')),
      extractMain: vi.fn(),
      accessibilitySnapshot: vi.fn(),
      closeSession: vi.fn().mockResolvedValue(undefined),
    };
    const { service } = makeService({ conduitBrowser });

    await expect(service.scanUrl('https://vendor.example.com/invoice', null, '127.0.0.1')).rejects.toThrow('boom');
    expect(conduitBrowser.closeSession).toHaveBeenCalledTimes(1);
  });
});
