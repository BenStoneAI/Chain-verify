import { describe, expect, it } from 'vitest';

import { extractInvoiceFieldsFromText } from '@chain-verify/proof-core/invoice-pdf-extract.js';

const CLEAN_INVOICE = `Acme Industrial Supply
123 Market Street, Springfield, IL

Invoice #: INV-4471
Invoice Date: 03/14/2026
PO Number: PO-9920
Payment Terms: Net 30

Description           Qty   Amount
Steel brackets         10   $450.00
Mounting hardware       5   $300.00

Subtotal: $750.00
Tax: $0.00
Total Due: $750.00

Remit to:
Routing #: 021000021
Account #: ****6789
`;

describe('extractInvoiceFieldsFromText', () => {
  it('extracts core fields from a clean text invoice with high confidence', () => {
    const r = extractInvoiceFieldsFromText(CLEAN_INVOICE, 1);
    expect(r.status).toBe('OK');
    expect(r.confidence).toBeGreaterThanOrEqual(0.75);
    expect(r.fields.invoiceNo).toBe('INV-4471');
    expect(r.fields.amount).toBe(750);
    expect(r.fields.po).toBe('PO-9920');
    expect(r.fields.invoiceDate).toBe('03/14/2026');
    expect(r.fields.paymentTerms?.toLowerCase()).toBe('net 30');
    expect(r.fields.bankRouting).toBe('021000021');
    expect(r.fields.bankAccountLast4).toBe('6789');
    expect(r.fields.vendor).toBe('Acme Industrial Supply');
  });

  it('picks the grand total, not a line item or subtotal', () => {
    const r = extractInvoiceFieldsFromText(CLEAN_INVOICE, 1);
    expect(r.fields.amount).toBe(750);
  });

  it('returns TEXT_EXTRACTION_FAILED for empty text (scanned/image-only PDF)', () => {
    const r = extractInvoiceFieldsFromText('', 3);
    expect(r.status).toBe('TEXT_EXTRACTION_FAILED');
    expect(r.confidence).toBe(0);
    expect(r.warnings[0]).toMatch(/scanned|image-only/i);
  });

  it('returns TEXT_EXTRACTION_FAILED when chars-per-page is below threshold', () => {
    const r = extractInvoiceFieldsFromText('x', 5);
    expect(r.status).toBe('TEXT_EXTRACTION_FAILED');
  });

  it('returns NEEDS_REVIEW when core fields are missing', () => {
    const r = extractInvoiceFieldsFromText(
      'Some unrelated document text that is long enough to have a text layer but no invoice fields at all here.',
      1,
    );
    expect(r.status).toBe('NEEDS_REVIEW');
    expect(r.confidence).toBeLessThan(0.6);
    expect(r.warnings.join(' ')).toMatch(/review/i);
  });

  it('extracts fields from space-joined single-line text (real unpdf output shape)', () => {
    // unpdf/pdf.js commonly returns text with items joined by spaces and few newlines.
    const text =
      'Vendor: Globex Manufacturing Invoice #: INV-7788 Invoice Date: 04/02/2026 ' +
      'PO Number: PO-3310 Payment Terms: Net 45 Total Due: $12,400.00 Routing #: 121000248';
    const r = extractInvoiceFieldsFromText(text, 1);
    expect(r.status).toBe('OK');
    expect(r.fields.vendor).toBe('Globex Manufacturing');
    expect(r.fields.invoiceNo).toBe('INV-7788');
    expect(r.fields.amount).toBe(12400);
    expect(r.fields.po).toBe('PO-3310');
    expect(r.fields.bankRouting).toBe('121000248');
  });

  it('never throws on null/garbage input', () => {
    expect(() => extractInvoiceFieldsFromText(undefined as unknown as string, 0)).not.toThrow();
    const r = extractInvoiceFieldsFromText(undefined as unknown as string, 0);
    expect(r.status).toBe('TEXT_EXTRACTION_FAILED');
  });

  it('extracts only the last 4 of an account number, never the full number', () => {
    const r = extractInvoiceFieldsFromText(CLEAN_INVOICE, 1);
    expect(r.fields.bankAccountLast4).toBe('6789');
    // The full masked account string (****6789) must never be captured — only the last 4.
    expect(r.fields.bankAccountLast4).toHaveLength(4);
    expect(r.fields).not.toHaveProperty('bankAccountNumber');
  });

  // Real pdf.js/unpdf output: a header row ("Invoice No. Balance Due") is emitted
  // immediately followed by the values row, so the label and its value are separated
  // by OTHER column headers. These are verbatim strings pulled from real STV invoices
  // (see testing/proof-products/results/drive-corpus-test-2026-07-03.md) that previously
  // broke the extractor.
  describe('real-world multi-column PDF text (header-row-then-values)', () => {
    it('City of Moab: pulls the invoice number and amount past intervening header words, not the "Balance" header itself', () => {
      const text =
        'Phone: 435-259-5123 Fax: 435-259-4135 CITY OF MOAB 217 E CENTER ST MOAB, UT 84532 ' +
        'INVOICE Bill Date Invoice No. Balance Due 06/04/2026 154249 $3,500.00 Due Date: ' +
        '07/04/2026 DESCRIPTION AMOUNT Bill To: LYKOS ACQUISITION LLC 79 W 900 N SUITE B ' +
        'SPRINGVILLE UT 84663 ACCOUNT NO. 10505820 Notice: Late charges are assessed at the ' +
        'interest rate of 3.00% per month on the unpaid balance. Amount: 3,500.00 SUNSET RIM ' +
        'WATER DEVELOPMENT REVIEW 3,500.00 Please include this Account Number 10505820 with ' +
        'your payment.';
      const r = extractInvoiceFieldsFromText(text, 1);
      expect(r.fields.invoiceNo).toBe('154249');
      expect(r.fields.amount).toBe(3500);
      expect(r.fields.vendor).toBe('CITY OF MOAB');
    });

    it('Terradyne: skips "DATE TOTAL DUE DUE DATE TERMS ENCLOSED" header words to reach the real invoice number, and picks the vendor letterhead over the Bill To recipient', () => {
      const text =
        'Terradyne Engineering, Inc. 354 E Glade Rd EULESS, TX 76039 US +18179527217 ' +
        'accounting@terradyne.com www.terradyne.com Invoice BILL TO Aubrey Palmer Summa Elite ' +
        'LLC 1412 Main Street Ste 410 Dallas, TX 75202 SHIP TO Aubrey Palmer Summa Elite LLC ' +
        '1412 Main Street Ste 410 Dallas, TX 75202 INVOICE # DATE TOTAL DUE DUE DATE TERMS ' +
        'ENCLOSED D242098-024 06/22/2026 $512.50 06/22/2026 Due on receipt ACTIVITY ' +
        'DESCRIPTION QTY RATE AMOUNT 2 - CMT Rock Creek Apartments 1 512.50 512.50 Ways to ' +
        'pay SUBTOTAL 512.50 TAX (0%) 0.00 TOTAL 512.50 BALANCE DUE $512.50';
      const r = extractInvoiceFieldsFromText(text, 1);
      expect(r.fields.invoiceNo).toBe('D242098-024');
      expect(r.fields.amount).toBe(512.5);
      expect(r.fields.vendor).toBe('Terradyne Engineering, Inc.');
    });

    it('Wright: "Invoice Date" must not be mistaken for the "Invoice #" label', () => {
      const text =
        'Invoice Date 5/18/2026 Invoice # 4927 Bill To Michael Watson Summa Elite, LLC 79 W ' +
        '900 N Suite B Springville, UT 84663 Due Date 5/18/2026';
      const r = extractInvoiceFieldsFromText(text, 1);
      expect(r.fields.invoiceNo).toBe('4927');
    });
  });
});
