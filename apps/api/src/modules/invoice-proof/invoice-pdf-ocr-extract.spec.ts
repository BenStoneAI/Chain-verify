/**
 * Work Item 1 (OCR intake for InvoiceProof) — unit tests for
 * `applyOcrExtraction`, the pure confidence-gating function that sits between
 * OCR engine output and the existing (unmodified) `extractInvoiceFieldsFromText`
 * parser. No rasterization, no real Tesseract call — this is intentionally the
 * fast, deterministic layer; the real rasterize+OCR pipeline is proven end to
 * end by `npm run test:pdf-intake` (scripts/pdf-intake-smoke.ts) against real
 * fixture PDFs, matching the existing convention for anything that needs the
 * ESM-only `unpdf` parser.
 *
 * The single most important behavior under test: an OCR-derived result must
 * NEVER be silently promoted to OK for a fraud-critical field (bank/routing
 * number, account number, total amount), regardless of how high either
 * confidence signal is.
 */
import {
  applyOcrExtraction,
  OCR_ENGINE_MIN_CONFIDENCE,
} from '@swarmsync/proof-core/invoice-pdf-extract.js';

const CLEAN_INVOICE_TEXT =
  'Acme Industrial Supply Invoice #: INV-4471 Invoice Date: 03/14/2026 PO Number: PO-9920 ' +
  'Payment Terms: Net 30 Total Due: $750.00 Routing #: 021000021 Account #: ****6789';

const NO_AMOUNT_TEXT =
  // No amount, no bank/routing, no account — deliberately NOT fraud-critical
  // per applyOcrExtraction's own definition of that term.
  'Acme Industrial Supply Invoice #: INV-4471 Invoice Date: 03/14/2026 PO Number: PO-9920 Payment Terms: Net 30';

describe('applyOcrExtraction — clean scan (high OCR confidence)', () => {
  it('a clean scan with a fraud-critical field (amount) is forced to NEEDS_REVIEW, never OK', () => {
    const r = applyOcrExtraction(CLEAN_INVOICE_TEXT, 1, 96);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.status).not.toBe('OK');
    expect(r.extraction_method).toBe('ocr');
    expect(r.fields.amount).toBe(750);
    expect(r.warnings.join(' ')).toMatch(/always routed to manual review/i);
  });

  it(
    'structural invariant, documented deliberately (NOT a bug): OCR can never reach OK on a real ' +
      'invoice, because `amount` is required for extractInvoiceFieldsFromText to ever say OK in the ' +
      'first place (its own coreCount===3 gate), and `amount` is also on the mandatory fraud-critical ' +
      "list with no confidence carve-out — so \"parser says OK\" and \"no fraud-critical field present\" " +
      'can never both be true at once for OCR-sourced text. See OCR_ENGINE_MIN_CONFIDENCE\'s doc comment ' +
      'and the Work Item 1 final report for why this conservative consequence is intentional, not an oversight.',
    () => {
      const r = applyOcrExtraction(CLEAN_INVOICE_TEXT, 1, 100);
      expect(r.fields.amount).toBeDefined();
      expect(r.status).not.toBe('OK');
    },
  );

  it('a non-fraud-critical, sparse-but-clean scan (missing amount) is NEEDS_REVIEW from the parser itself, not just the OCR gate', () => {
    const r = applyOcrExtraction(NO_AMOUNT_TEXT, 1, 96);
    expect(r.fields.amount).toBeUndefined();
    expect(r.fields.bankRouting).toBeUndefined();
    expect(r.fields.bankAccountLast4).toBeUndefined();
    // extractInvoiceFieldsFromText itself already says NEEDS_REVIEW here
    // (coreCount===2: vendor+invoiceNo present, amount absent) — OCR doesn't
    // need to intervene to keep this out of OK, it simply never upgrades it.
    expect(r.status).toBe('NEEDS_REVIEW');
  });

  it('combined confidence is capped by both signals — a lower OCR engine confidence never produces a HIGHER combined confidence', () => {
    const higherOcrConfidence = applyOcrExtraction(NO_AMOUNT_TEXT, 1, 100);
    const lowerOcrConfidence = applyOcrExtraction(NO_AMOUNT_TEXT, 1, 80);
    expect(lowerOcrConfidence.confidence).toBeLessThan(higherOcrConfidence.confidence);
  });
});

describe('applyOcrExtraction — noisy/low-quality scan (low OCR engine confidence)', () => {
  it(`OCR engine confidence below ${OCR_ENGINE_MIN_CONFIDENCE} forces NEEDS_REVIEW even with all fields present`, () => {
    const r = applyOcrExtraction(CLEAN_INVOICE_TEXT, 1, 45);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.warnings.join(' ')).toMatch(/OCR engine confidence/i);
  });

  it(`OCR engine confidence below ${OCR_ENGINE_MIN_CONFIDENCE} still forces NEEDS_REVIEW when no fraud-critical field is present`, () => {
    const r = applyOcrExtraction(NO_AMOUNT_TEXT, 1, 45);
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.warnings.join(' ')).toMatch(/OCR engine confidence/i);
  });

  // NOTE on OCR_MIN_CONFIDENCE_FOR_OK: this constant/branch cannot currently
  // be exercised through a real extractInvoiceFieldsFromText() parse, because
  // `amount` is BOTH required for the parser's own OK status (its
  // coreCount===3 gate) AND on applyOcrExtraction's fraud-critical list —
  // so "parser says OK" and "no fraud-critical field present" can never both
  // be true for the same input today. It is kept as defense-in-depth (not
  // dead weight to delete) in case the base parser's OK criteria are ever
  // relaxed to not require `amount` — see the Work Item 1 final report.

  it('never throws and never fabricates a field for a low-confidence but non-empty OCR read', () => {
    const r = applyOcrExtraction('smudged partial te t #4 4', 1, 20);
    expect(r.status).not.toBe('OK');
    expect(r.fields.amount).toBeUndefined();
  });
});

describe('applyOcrExtraction — garbage/non-invoice image (no usable OCR text at all)', () => {
  it('empty OCR text stays TEXT_EXTRACTION_FAILED — never fabricates a field, regardless of confidence', () => {
    const r = applyOcrExtraction('', 1, 95);
    expect(r.status).toBe('TEXT_EXTRACTION_FAILED');
    expect(r.fields).toEqual({});
    expect(r.extraction_method).toBe('ocr');
  });

  it('near-empty/garbage OCR text (below the parser\'s own MIN_TOTAL_CHARS floor) stays TEXT_EXTRACTION_FAILED', () => {
    const r = applyOcrExtraction('x', 1, 95);
    expect(r.status).toBe('TEXT_EXTRACTION_FAILED');
    expect(r.fields).toEqual({});
  });

  it('TEXT_EXTRACTION_FAILED is never overridden even at maximum OCR engine confidence', () => {
    const r = applyOcrExtraction('', 1, 100);
    expect(r.status).toBe('TEXT_EXTRACTION_FAILED');
  });
});

describe('applyOcrExtraction — fraud-critical field gate has no confidence carve-out', () => {
  it.each([
    ['amount only', 'Vendor Co Invoice #: INV-1 Total Due: $500.00'],
    ['bank routing only', 'Vendor Co Invoice #: INV-1 Invoice Date: 03/14/2026 PO Number: PO-1 Routing #: 021000021'],
  ])('%s at 99%% OCR engine confidence is still forced to NEEDS_REVIEW', (_label, text) => {
    const r = applyOcrExtraction(text, 1, 99);
    expect(r.status).not.toBe('OK');
  });

  it('never crosses into OK regardless of how high both confidence signals are, when a fraud-critical field is present', () => {
    for (const ocrConfidence of [60, 70, 80, 90, 100]) {
      const r = applyOcrExtraction(CLEAN_INVOICE_TEXT, 1, ocrConfidence);
      expect(r.status).not.toBe('OK');
    }
  });
});

describe('applyOcrExtraction — confidence values are clamped and never throw on bad input', () => {
  it('clamps an out-of-range OCR confidence instead of producing a nonsensical result', () => {
    expect(() => applyOcrExtraction(CLEAN_INVOICE_TEXT, 1, 150)).not.toThrow();
    expect(() => applyOcrExtraction(CLEAN_INVOICE_TEXT, 1, -10)).not.toThrow();
    const negative = applyOcrExtraction(CLEAN_INVOICE_TEXT, 1, -10);
    expect(negative.status).not.toBe('OK');
  });

  it('treats NaN/undefined-like confidence as 0 (fails closed, not open)', () => {
    const r = applyOcrExtraction(CLEAN_INVOICE_TEXT, 1, NaN);
    expect(r.status).not.toBe('OK');
    expect(r.confidence).toBe(0);
  });
});

describe('applyOcrExtraction — status can only move toward review, never be upgraded', () => {
  it('never upgrades a parser NEEDS_REVIEW to OK, even at 100% OCR confidence', () => {
    // Sparse text the parser itself can only call NEEDS_REVIEW (missing core fields).
    const sparse = 'Some unrelated document text that is long enough to have a text layer but no invoice fields here.';
    const r = applyOcrExtraction(sparse, 1, 100);
    expect(r.status).toBe('NEEDS_REVIEW');
  });
});
