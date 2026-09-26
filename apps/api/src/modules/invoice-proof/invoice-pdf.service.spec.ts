import { InvoicePdfService, PDF_MAX_BYTES } from './invoice-pdf.service.js';

/**
 * Unit coverage for the validation branches that run BEFORE unpdf is loaded
 * (empty / oversized / non-PDF). These are deterministic and never touch the ESM
 * unpdf parser, so they run cleanly in the CJS Jest runtime.
 *
 * Real-PDF extraction (OK / encrypted / corrupt / image-only / multi-page) and the
 * end-to-end scan-engine integration are exercised against committed fixtures by
 * scripts/pdf-intake-smoke.ts (`npm run test:pdf-intake`), which runs in Node ESM
 * where unpdf loads natively.
 */
describe('InvoicePdfService.extract — pre-parse validation', () => {
  const svc = new InvoicePdfService();

  it('returns EMPTY for an empty buffer', async () => {
    const r = await svc.extract(Buffer.alloc(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('EMPTY');
  });

  it('returns NOT_PDF when the magic bytes are not %PDF-', async () => {
    const r = await svc.extract(Buffer.from('this is plainly not a pdf document'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NOT_PDF');
  });

  it('returns NOT_PDF for a renamed PNG (unsupported file type)', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const r = await svc.extract(png);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('NOT_PDF');
  });

  it('returns TOO_LARGE above the byte ceiling', async () => {
    const big = Buffer.alloc(PDF_MAX_BYTES + 1, 0x25); // 0x25 = '%'
    const r = await svc.extract(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('TOO_LARGE');
  });
});

// ---------------------------------------------------------------------------
// Kraken audit regression (Work Item 1 review): an already-confident digital
// extraction must never be downgraded to OCR/NEEDS_REVIEW just because one
// unrelated page (a blank signature page, a near-empty cover sheet) happens
// to fall below the per-page character floor. Before this fix, ANY weak page
// forced the whole document through applyOcrExtraction's stricter gate, which
// unconditionally downgrades a fraud-critical field (amount is always present
// on a real OK parse) to NEEDS_REVIEW — silently regressing the pre-OCR
// baseline (which only checked the document-WIDE average chars/page) for
// every multi-page invoice with an incidental sparse page. `unpdf` is mocked
// here (real extraction is otherwise only exercised by the ESM-only smoke
// script) specifically so this exact per-page-vs-whole-document branch is
// covered by a deterministic, CI-run test.
// ---------------------------------------------------------------------------
jest.mock('unpdf', () => ({
  getDocumentProxy: jest.fn(async () => ({ numPages: 2 })),
  extractText: jest.fn(async () => ({
    text: [
      'Acme Industrial Supply Invoice #: INV-5001 Invoice Date: 03/14/2026 PO Number: PO-1 ' +
        'Payment Terms: Net 30 Total Due: $1,200.00',
      '   ', // page 2: a near-blank trailing page (e.g. a signature/terms page)
    ],
  })),
}));
jest.mock('./invoice-pdf-ocr.js', () => ({
  invoiceProofOcrEnabled: jest.fn(() => true),
  ocrPdfPage: jest.fn(),
}));

describe('InvoicePdfService.extract — already-OK digital text is never sent through OCR just for an incidental weak page', () => {
  it('a document that already parses OK from digital text alone stays digital_text/OK, even with a blank trailing page', async () => {
    const { ocrPdfPage } = await import('./invoice-pdf-ocr.js');
    const svc = new InvoicePdfService();

    const r = await svc.extract(Buffer.from('%PDF-1.4 fake multi-page pdf'));

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.extraction.status).toBe('OK');
      expect(r.extraction.extraction_method).toBe('digital_text');
      expect(r.extraction.fields.invoiceNo).toBe('INV-5001');
      expect(r.extraction.fields.amount).toBe(1200);
    }
    // The single most important assertion: OCR must never even be attempted
    // when the digital-only pass already reached a confident OK.
    expect(ocrPdfPage).not.toHaveBeenCalled();
  });
});
