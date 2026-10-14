/**
 * Real-PDF regression suite (ported from SwarmSync b776039f apps/api/scripts/pdf-intake-smoke.ts).
 *
 * Runs InvoicePdfService.extract() with the REAL unpdf parser against the 15 committed
 * fixture PDFs in packages/proof-core/test/fixtures/invoice-pdf, then feeds the extracted
 * fields into the live scan engine to prove the fraud rules fire on PDF-sourced data.
 *
 * - Digital-text and rejection cases run unconditionally (OCR disabled for determinism).
 * - OCR cases (scanned-*.pdf, mixed.pdf) need Tesseract's `eng` language data, which
 *   tesseract.js downloads on first use and caches in the working directory. They run only
 *   when RUN_OCR_FIXTURE_TESTS=true so the default suite stays offline and leaves no files
 *   (an OCR run drops `eng.traineddata` in the cwd, apps/api; delete it afterwards).
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InvoicePdfService } from './invoice-pdf.service.js';
import { parseInvoiceScanBody, runInvoiceScan } from './invoice-proof-scan.runner.js';

const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/proof-core/test/fixtures/invoice-pdf',
);
const load = (name: string) => readFileSync(resolve(FIXTURES, name));

const svc = new InvoicePdfService();

function fieldsToInvoice(f: Record<string, unknown>) {
  return {
    vendor: f.vendor ?? '',
    invoiceNo: f.invoiceNo ?? '',
    amount: f.amount ?? 0,
    po: f.po ?? '',
    bankRouting: f.bankRouting ?? '',
    ...(f.lineItemsTotal !== undefined ? { lineItemsTotal: f.lineItemsTotal } : {}),
  };
}

const poRegister = [
  { poNumber: 'PO-5001', vendorName: 'Redwood Industrial Supply', authorizedAmount: 4500 },
  { poNumber: 'PO-5002', vendorName: 'Redwood Industrial Supply', authorizedAmount: 3500 },
];
const vendorMaster = [
  { vendorName: 'Redwood Industrial Supply', bankRoutingNumber: '021000021', city: 'Springfield', state: 'IL' },
];
// The engine only treats a payment-register record as a duplicate source for a CHANGED amount
// when it was paid within the last 90 days (invoice-scan.ts seed-context recency check). The
// original smoke script hard-coded 2026-06-01, which silently aged out of that window and made
// the modified-duplicate check fail; keep the record a fixed, recent age instead.
const RECENT_PAYMENT_DATE = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const paymentHistory = [
  { invoiceNo: 'INV-1001', vendor: 'Redwood Industrial Supply', amount: 4500, po: 'PO-5001', submittedAt: RECENT_PAYMENT_DATE },
];

async function patternsFor(name: string): Promise<string[]> {
  const r = await svc.extract(load(name));
  if (!r.ok) throw new Error(`${name} did not extract: ${(r as { reason: string }).reason}`);
  const parsed = parseInvoiceScanBody({
    invoices: [fieldsToInvoice(r.extraction.fields as Record<string, unknown>)],
    poRegister,
    vendorMaster,
    paymentHistory,
  } as never);
  return runInvoiceScan(parsed, []).findings.map((f) => f.pattern);
}

describe('invoice PDF fixtures: extraction status (digital text, OCR off)', () => {
  const original = process.env.INVOICE_PROOF_OCR_ENABLED;
  beforeAll(() => {
    process.env.INVOICE_PROOF_OCR_ENABLED = 'false';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.INVOICE_PROOF_OCR_ENABLED;
    else process.env.INVOICE_PROOF_OCR_ENABLED = original;
  });

  it('clean.pdf extracts OK as digital_text', async () => {
    const r = await svc.extract(load('clean.pdf'));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.extraction.status).toBe('OK');
      expect(r.extraction.extraction_method).toBe('digital_text');
    }
  });

  it('multipage.pdf reports at least 3 pages', async () => {
    const r = await svc.extract(load('multipage.pdf'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extraction.pageCount).toBeGreaterThanOrEqual(3);
  });

  it('encrypted.pdf is rejected as ENCRYPTED', async () => {
    const r = await svc.extract(load('encrypted.pdf'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('ENCRYPTED');
  });

  it('corrupt.pdf is rejected as CORRUPT', async () => {
    const r = await svc.extract(load('corrupt.pdf'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('CORRUPT');
  });

  it('image-only.pdf is TEXT_EXTRACTION_FAILED (never fabricated fields)', async () => {
    const r = await svc.extract(load('image-only.pdf'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.extraction.status).toBe('TEXT_EXTRACTION_FAILED');
  });

  it('not-a-pdf.png is rejected as NOT_PDF', async () => {
    const r = await svc.extract(load('not-a-pdf.png'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NOT_PDF');
  });
});

describe('invoice PDF fixtures: extracted fields drive the scan engine', () => {
  const original = process.env.INVOICE_PROOF_OCR_ENABLED;
  beforeAll(() => {
    process.env.INVOICE_PROOF_OCR_ENABLED = 'false';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.INVOICE_PROOF_OCR_ENABLED;
    else process.env.INVOICE_PROOF_OCR_ENABLED = original;
  });

  it('bank-change.pdf fires BANK_ACCOUNT_CHANGE', async () => {
    const patterns = await patternsFor('bank-change.pdf');
    expect(patterns.some((p) => p.includes('BANK_ACCOUNT_CHANGE'))).toBe(true);
  });

  it('missing-po.pdf fires a missing-PO finding', async () => {
    const patterns = await patternsFor('missing-po.pdf');
    expect(patterns.some((p) => /missing.*po/i.test(p))).toBe(true);
  });

  it('po-overage.pdf fires a PO-amount-exceeded finding', async () => {
    const patterns = await patternsFor('po-overage.pdf');
    expect(patterns.some((p) => /po amount exceeded/i.test(p))).toBe(true);
  });

  it('modified-duplicate.pdf fires a duplicate finding', async () => {
    const patterns = await patternsFor('modified-duplicate.pdf');
    expect(patterns.some((p) => p.includes('DUPLICATE'))).toBe(true);
  });
});

describe.skipIf(process.env.RUN_OCR_FIXTURE_TESTS !== 'true')(
  'invoice PDF fixtures: OCR path (real Tesseract; needs eng language data)',
  () => {
    const original = process.env.INVOICE_PROOF_OCR_ENABLED;
    beforeAll(() => {
      delete process.env.INVOICE_PROOF_OCR_ENABLED;
    });
    afterAll(() => {
      if (original !== undefined) process.env.INVOICE_PROOF_OCR_ENABLED = original;
    });

    it('scanned-clean.pdf: OCR provenance, invoice number read, never silently promoted to OK', async () => {
      const r = await svc.extract(load('scanned-clean.pdf'));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.extraction.extraction_method).toBe('ocr');
      expect(r.extraction.fields.invoiceNo).toBe('INV-2001');
      expect(r.extraction.status).toBe('NEEDS_REVIEW');
    }, 120_000);

    it('scanned-noisy.pdf is never OK', async () => {
      const r = await svc.extract(load('scanned-noisy.pdf'));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.extraction.status).not.toBe('OK');
    }, 120_000);

    it('mixed.pdf merges digital page 1 with OCR page 2 and stays NEEDS_REVIEW', async () => {
      const r = await svc.extract(load('mixed.pdf'));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.extraction.fields.invoiceNo).toBe('INV-3001');
      expect(r.extraction.fields.vendor).toBe('Redwood Industrial Supply');
      expect(r.extraction.fields.amount).toBe(4500);
      expect(r.extraction.fields.bankRouting).toBe('021000021');
      expect(r.extraction.extraction_method).toBe('ocr');
      expect(r.extraction.status).toBe('NEEDS_REVIEW');
    }, 180_000);

    it('scanned-bank-change.pdf: BANK_ACCOUNT_CHANGE still fires on OCR text alongside NEEDS_REVIEW', async () => {
      const r = await svc.extract(load('scanned-bank-change.pdf'));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.extraction.extraction_method).toBe('ocr');
      expect(r.extraction.status).toBe('NEEDS_REVIEW');
      const parsed = parseInvoiceScanBody({
        invoices: [fieldsToInvoice(r.extraction.fields as Record<string, unknown>)],
        poRegister,
        vendorMaster,
        paymentHistory,
      } as never);
      const patterns = runInvoiceScan(parsed, []).findings.map((f) => f.pattern);
      expect(patterns.some((p) => p.includes('BANK_ACCOUNT_CHANGE'))).toBe(true);
    }, 180_000);
  },
);
