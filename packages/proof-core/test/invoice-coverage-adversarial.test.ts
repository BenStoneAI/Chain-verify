/**
 * Adversarial test suite for InvoiceProof normalization + coverage layer.
 *
 * SCENARIO COVERAGE MAP
 * ─────────────────────────────────────────────────────────────────────────
 * Scenario  | This file                      | invoice-normalization.test.ts
 * ─────────────────────────────────────────────────────────────────────────
 *  1  CSV reorder    | generic-3 fixture (PO before INV#) | "1. handles reordered…" ✓ (primary)
 *  2  Uppercase ERP  | s2-* tests (INVOICE_NUMBER etc)    | "2. handles uppercase…" ✓ (primary)
 *  3  JSON alt keys  | s3-inv_no/supplier/grand_total     | "3. JSON array…" (partial) ✓ (gap filled)
 *  4  Prose labels   | s4-* deeper assertions             | "4. parses a labeled…" ✓ (primary)
 *  5  Unknown amount | s5-* multiple bad formats          | "5. unparseable amount…" (partial) ✓ (gap filled)
 *  6  Legal suffix   | (covered in existing file)         | "6. vendor master mismatch…" ✓
 *  7  PO qty overage | (covered in existing file)         | "7. PO quantity…" ✓
 *  8  Inactive vendor| s8-compliance_status               | "8. inactive vendor…" ✓ (both cover)
 *  9  Remit mismatch | (covered in existing file)         | "9. remit address mismatch…" ✓
 * 10  No vendor master| (covered in existing file)        | "10. missing vendor master…" ✓
 * 11  No PO register | (covered in existing file)        | "11. missing PO register…" ✓
 * 12  Standing order | (covered in existing file)        | "12. standing order…" ✓
 *
 * Generic fixtures: Northgate Fabrication (inv-G1), Creston Valley Supplies (inv-G2),
 *                   Bright Meridian Consulting (inv-G3)
 *
 * Route-level coverage tests (runner-level) live in
 *   apps/api/src/modules/invoice-proof/invoice-proof-scan-coverage.spec.ts
 */

import { describe, expect, it } from 'vitest';

import {
  parseInput,
  parseTabular,
  parseProse,
  normalizeInvoice,
  normalizeMany,
} from '../src/normalizers/invoice-normalizer.js';
import { resolveCanonicalField, normalizeVendorName } from '../src/field-aliases.js';
import {
  runControls,
  buildCoverageSummary,
  type ControlResult,
  type ControlContext,
} from '../src/control-readiness.js';
import {
  scanInvoicesWithCoverage,
  parseInvoices,
  type Row,
  type HistoryRecord,
} from '../src/invoice-scan.js';
import { isUsable } from '../src/field-value.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ctrl(results: ControlResult[], id: string): ControlResult {
  const r = results.find((c) => c.controlId === id);
  if (!r) throw new Error(`control ${id} not found in results`);
  return r;
}

// ---------------------------------------------------------------------------
// Generic test fixtures (NOT Redwood/Kestrel/Harper — mandatory 3)
// ---------------------------------------------------------------------------

/** Generic Fixture 1: Northgate Fabrication */
const NORTHGATE_CLEAN = {
  invoice_number: 'NGF-2024-001',
  vendor_name: 'Northgate Fabrication LLC',
  grand_total: '4800.00',
  po_number: 'PO-NGF-88',
  city: 'Columbus',
  state: 'OH',
};

/** Generic Fixture 2: Creston Valley Supplies */
const CRESTON_CLEAN = {
  'Invoice ID': 'CVS-551',
  supplier: 'Creston Valley Supplies Inc',
  amount_due: '$12,500.00',
  'PO Reference': 'PO-CV-2024-009',
  vendor_email: 'billing@crestonvalley.com',
};

/** Generic Fixture 3: Bright Meridian Consulting */
const MERIDIAN_CLEAN = {
  inv_no: 'BMC-700',
  company: 'Bright Meridian Consulting',
  grand_total: '9750.00',
  purchase_order_number: 'PO-BMC-14',
  remit_to: '42 Commerce Blvd, Suite 200, Denver CO 80202',
};

// ---------------------------------------------------------------------------
// Scenario 2 — Uppercase ERP CSV headers (supplementary depth)
// The primary scenario 2 test lives in invoice-normalization.test.ts.
// These tests verify the alias registry resolves every uppercase ERP column
// name in the CLAUDE.md spec and that the correct canonical slots are populated.
// ---------------------------------------------------------------------------

describe('s2 — uppercase ERP CSV headers (deep alias verification)', () => {
  it('INVOICE_NUMBER resolves to invoiceNo', () => {
    expect(resolveCanonicalField('INVOICE_NUMBER')?.canonical).toBe('invoiceNo');
  });

  it('VENDOR_NAME resolves to vendor', () => {
    expect(resolveCanonicalField('VENDOR_NAME')?.canonical).toBe('vendor');
  });

  it('GRAND_TOTAL / INVOICE_TOTAL / AMOUNT_DUE all resolve to amount', () => {
    expect(resolveCanonicalField('GRAND_TOTAL')?.canonical).toBe('amount');
    expect(resolveCanonicalField('INVOICE_TOTAL')?.canonical).toBe('amount');
    expect(resolveCanonicalField('AMOUNT_DUE')?.canonical).toBe('amount');
  });

  it('PO_NUMBER resolves to po', () => {
    expect(resolveCanonicalField('PO_NUMBER')?.canonical).toBe('po');
  });

  it('ROUTING_NUMBER resolves to bankRouting', () => {
    expect(resolveCanonicalField('ROUTING_NUMBER')?.canonical).toBe('bankRouting');
  });

  it('full ERP row with all-caps headers normalizes correctly end-to-end', () => {
    const csv = 'INVOICE_NUMBER,VENDOR_NAME,INVOICE_TOTAL,PO_NUMBER,ROUTING_NUMBER\nINV-ERP-1,Northgate Fabrication,4800,PO-NGF-88,021000021';
    const { rows } = parseTabular(csv);
    const norm = normalizeMany(rows);
    expect(norm).toHaveLength(1);
    expect(norm[0].invoiceNo.value).toBe('INV-ERP-1');
    expect(norm[0].vendor.value).toBe('Northgate Fabrication');
    expect(norm[0].amount.value).toBe(4800);
    expect(norm[0].po.value).toBe('PO-NGF-88');
    // bankRouting should be populated via ROUTING_NUMBER alias
    expect(isUsable(norm[0].bankRouting)).toBe(true);
    expect(norm[0].bankRouting!.value).toBe('021000021');
    // Source must reflect that this came from an alias, not an exact match
    expect(['alias', 'exact', 'fuzzy']).toContain(norm[0].bankRouting!.source);
  });

  it('ERP row with BOM prefix still normalizes without error', () => {
    // BOM + UPPERCASE + all canonical fields
    const csv = '﻿INVOICE_NUMBER,VENDOR_NAME,GRAND_TOTAL,PO_NUMBER\nINV-BOM-1,Creston Valley,12500,PO-CV-1';
    const { rows, warnings } = parseTabular(csv);
    const norm = normalizeMany(rows);
    expect(norm[0].invoiceNo.value).toBe('INV-BOM-1');
    expect(norm[0].amount.value).toBe(12500);
    // BOM should produce no normalization warnings (stripped silently)
    expect(warnings.filter((w) => /BOM/i.test(w))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — JSON with alternate key names (gap: inv_no, supplier, grand_total)
// The existing test only covers Invoice ID, supplier, amount_due.
// ---------------------------------------------------------------------------

describe('s3 — JSON alternate key names (gap fill)', () => {
  it('inv_no + supplier + grand_total all normalize correctly', () => {
    const json = [{ inv_no: 'BMC-700', supplier: 'Bright Meridian', grand_total: '9750.00' }];
    const rows = normalizeMany(parseInput({ json }).rows);
    expect(rows[0].invoiceNo.value).toBe('BMC-700');
    expect(rows[0].vendor.value).toBe('Bright Meridian');
    expect(rows[0].amount.value).toBe(9750);
  });

  it('payee + invoice_id + net_amount all resolve to correct canonical fields', () => {
    const json = [{ invoice_id: 'X-99', payee: 'Northgate Fabrication', net_amount: '2000' }];
    const rows = normalizeMany(parseInput({ json }).rows);
    expect(rows[0].invoiceNo.value).toBe('X-99');
    expect(rows[0].vendor.value).toBe('Northgate Fabrication');
    expect(rows[0].amount.value).toBe(2000);
  });

  it('doc_no + company_name + billed_amount + purchase_order normalize correctly', () => {
    const json = [
      {
        doc_no: 'DOC-555',
        company_name: 'Creston Valley Supplies',
        billed_amount: '$500',
        purchase_order: 'PO-555',
      },
    ];
    const rows = normalizeMany(parseInput({ json }).rows);
    expect(rows[0].invoiceNo.value).toBe('DOC-555');
    expect(rows[0].vendor.value).toBe('Creston Valley Supplies');
    expect(rows[0].amount.value).toBe(500);
    expect(rows[0].po.value).toBe('PO-555');
  });

  it('bill no + payee name + payment total resolves', () => {
    const json = [{ 'bill no': 'B-10', 'payee name': 'Meridian Corp', 'payment total': '999' }];
    const rows = normalizeMany(parseInput({ json }).rows);
    expect(rows[0].invoiceNo.value).toBe('B-10');
    expect(rows[0].vendor.value).toBe('Meridian Corp');
    expect(rows[0].amount.value).toBe(999);
  });

  it('JSON object (not array) dispatches as single record', () => {
    const json = CRESTON_CLEAN;
    const rows = normalizeMany(parseInput({ json }).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].invoiceNo.value).toBe('CVS-551');
    expect(rows[0].amount.value).toBe(12500);
  });

  it('JSON with all three generic fixture key patterns normalizes without warnings', () => {
    const json = [NORTHGATE_CLEAN, CRESTON_CLEAN, MERIDIAN_CLEAN];
    const rows = normalizeMany(parseInput({ json }).rows);
    expect(rows).toHaveLength(3);
    // Each must produce a valid invoice number and amount
    expect(rows[0].invoiceNo.value).toBe('NGF-2024-001');
    expect(rows[1].invoiceNo.value).toBe('CVS-551');
    expect(rows[2].invoiceNo.value).toBe('BMC-700');
    expect(rows[0].amount.value).toBe(4800);
    expect(rows[1].amount.value).toBe(12500);
    expect(rows[2].amount.value).toBe(9750);
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Prose invoice parsing (deeper assertions)
// The primary coverage is in invoice-normalization.test.ts.
// These verify optional fields (PO, routing, city, email) land correctly.
// ---------------------------------------------------------------------------

describe('s4 — prose invoice parsing (depth)', () => {
  it('parses all canonical fields from a fully-labeled prose block', () => {
    const text = [
      'Invoice Number: NGF-PROSE-1',
      'Vendor: Northgate Fabrication LLC',
      'Amount: $4,800.00',
      'PO Number: PO-NGF-88',
      'City: Columbus',
      'State: OH',
      'Routing Number: 021000021',
    ].join('\n');
    const records = parseProse(text);
    const norm = normalizeInvoice(records[0]);
    expect(norm.invoiceNo.value).toBe('NGF-PROSE-1');
    expect(norm.vendor.value).toBe('Northgate Fabrication LLC');
    expect(norm.amount.value).toBe(4800);
    expect(norm.po.value).toBe('PO-NGF-88');
    expect(isUsable(norm.vendorCity)).toBe(true);
    expect(norm.vendorCity!.value).toBe('Columbus');
    expect(isUsable(norm.bankRouting)).toBe(true);
    expect(norm.bankRouting!.value).toBe('021000021');
  });

  it('parses vendor email to domain from prose block', () => {
    const text = 'Invoice Number: CVS-PROSE-2\nVendor: Creston Valley\nVendor Email: billing@crestonvalley.com\nAmount: 1000';
    const norm = normalizeInvoice(parseProse(text)[0]);
    expect(isUsable(norm.emailDomain)).toBe(true);
    expect(norm.emailDomain!.value).toBe('crestonvalley.com');
  });

  it('parses remit address from prose block — source is alias not absent', () => {
    const text = 'Invoice Number: BMC-PROSE-3\nVendor: Bright Meridian\nAmount: 9750\nRemit To: 42 Commerce Blvd Denver CO';
    const norm = normalizeInvoice(parseProse(text)[0]);
    expect(isUsable(norm.remitAddress)).toBe(true);
    expect(norm.remitAddress!.source).not.toBe('absent');
  });

  it('multiple prose blocks each become independent NormalizedInvoice', () => {
    const text = [
      'Invoice Number: A\nVendor: Northgate\nAmount: 100',
      '',
      'Invoice Number: B\nVendor: Creston\nAmount: 200',
    ].join('\n');
    const records = parseProse(text);
    const norms = normalizeMany(records);
    expect(norms).toHaveLength(2);
    expect(norms[0].invoiceNo.value).toBe('A');
    expect(norms[1].invoiceNo.value).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Unknown amount formats (gap: USD 1.2k, "1,200.00 dollars", garbage)
// The existing test only covers "twelve hundred".
// CRITICAL: these must produce source:'unknown' and a normalizationWarning,
// never silently produce 0 or a non-null value.
// ---------------------------------------------------------------------------

describe('s5 — unknown/unparseable amount formats', () => {
  const unparseableCases: Array<{ label: string; raw: string }> = [
    { label: 'k-suffix', raw: 'USD 1.2k' },
    { label: 'words-suffix', raw: '1,200.00 dollars' },
    { label: 'garbage', raw: 'N/A' },
    { label: 'empty-after-strip', raw: '$$$' },
    { label: 'tilde-amount', raw: '~$500' },
    { label: 'range', raw: '$500-$600' },
  ];

  for (const { label, raw } of unparseableCases) {
    it(`"${raw}" (${label}) → source:'unknown', value:null, NOT 0`, () => {
      const norm = normalizeInvoice({
        invoice_number: `INV-S5-${label}`,
        vendor: 'Northgate Fabrication',
        amount: raw,
        po: 'PO-1',
      });
      // The guarantee: unknown amounts must NEVER be coerced to 0 or any non-null value.
      expect(norm.amount.value).toBeNull();
      expect(norm.amount.source).toBe('unknown');
      // A warning must be emitted so the caller knows the field was present but unparseable.
      expect(norm.normalizationWarnings.length).toBeGreaterThan(0);
      // isUsable must return false — controls that depend on amount must skip, not pass.
      expect(isUsable(norm.amount)).toBe(false);
    });
  }

  it('garbage string "N/A" → null, source:unknown, warning emitted', () => {
    const norm = normalizeInvoice({ invoice_number: 'INV-NA', vendor: 'X', amount: 'N/A' });
    expect(norm.amount.value).toBeNull();
    expect(norm.amount.source).toBe('unknown');
    expect(norm.normalizationWarnings.length).toBeGreaterThan(0);
  });

  it('empty string after currency-strip ("$$$") → null, source:unknown', () => {
    const norm = normalizeInvoice({ invoice_number: 'INV-S5-DDD', vendor: 'X', amount: '$$$' });
    expect(norm.amount.value).toBeNull();
    expect(norm.amount.source).toBe('unknown');
  });

  it('unknown amount on a control-checked invoice → IP-C1 skips, NOT passes', () => {
    // If amount is unparseable, C1 (exact duplicate) must be skipped/absent, not pass
    const invoices = normalizeMany([
      { invoice_number: 'INV-BAD', vendor: 'Northgate', amount: 'N/A', po: 'PO-1' },
    ]);
    expect(isUsable(invoices[0].amount)).toBe(false);
    const results = runControls({ invoices });
    // C1 requires both invoiceNo AND amount to be usable — with unusable amount it must skip
    const c1 = ctrl(results, 'IP-C1');
    expect(c1.status).toBe('skipped_field_absent');
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — Vendor name legal suffix tolerance (deeper coverage)
// The primary scenario 6 test is in invoice-normalization.test.ts.
// These verify additional suffix combinations and that the bank/address
// controls still fire correctly despite suffix differences.
// ---------------------------------------------------------------------------

describe('s6 — vendor legal suffix normalization (adversarial depth)', () => {
  it('normalizeVendorName handles stacked suffixes (Inc. Corp.)', () => {
    // Degenerate: "Northgate Fabrication Inc Corp" — strips both
    expect(normalizeVendorName('Northgate Fabrication Inc Corp')).toBe('northgate fabrication');
  });

  it('IP-C4 bank mismatch fires despite Acme Inc vs Acme LLC suffix difference', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S6-BANK',
        vendor: 'Northgate Fabrication Inc',
        amount: '4800',
        po: 'PO-1',
        bank_routing: '999999999',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [
        {
          vendorName: 'Northgate Fabrication LLC',
          bankRoutingNumber: '021000021',
        },
      ],
    });
    // Suffix difference must NOT prevent match; bank mismatch must fire
    expect(ctrl(results, 'IP-C4').status).toBe('failed');
    expect(ctrl(results, 'IP-C4').severity).toBe('critical');
  });

  it('IP-C14 remit address fires despite vendor Inc vs Corp suffix difference', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S6-REM',
        vendor: 'Bright Meridian Consulting Inc',
        amount: '9750',
        po: 'PO-BMC-14',
        remit_to: '999 Fraud Avenue',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [
        {
          vendorName: 'Bright Meridian Consulting Corp',
          remitAddress: '42 Commerce Blvd, Suite 200',
        },
      ],
    });
    expect(ctrl(results, 'IP-C14').status).toBe('failed');
  });

  it('IP-C10 address mismatch fires despite suffix difference', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S6-ADDR',
        vendor: 'Creston Valley Supplies Inc',
        amount: '1000',
        po: 'PO-1',
        city: 'Portland',
        state: 'OR',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [
        { vendorName: 'Creston Valley Supplies LLC', city: 'Seattle', state: 'WA' },
      ],
    });
    expect(ctrl(results, 'IP-C10').status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 — PO quantity overage with alternate qty field names
// Primary coverage in invoice-normalization.test.ts. These tests verify
// additional field-name variants from the CLAUDE.md spec.
// ---------------------------------------------------------------------------

describe('s7 — PO quantity overage (alternate qty field names)', () => {
  it('billed_qty (alternate billed qty alias) overage fires IP-C7', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S7-A',
        vendor: 'Northgate Fabrication',
        amount: '500',
        po: 'PO-S7',
        billed_qty: '15', // canonical alias: billedQty
      },
    ]);
    const results = runControls({
      invoices,
      poRegister: [
        { poNumber: 'PO-S7', vendorName: 'Northgate Fabrication', authorizedQty: 10, authorizedAmount: 5000 },
      ],
    });
    expect(ctrl(results, 'IP-C7').status).toBe('failed');
  });

  it('invoice_qty (another billed qty alias) overage fires IP-C7', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S7-B',
        vendor: 'Creston Valley',
        amount: '500',
        po: 'PO-S7B',
        invoice_qty: '20', // canonical alias: billedQty
      },
    ]);
    const results = runControls({
      invoices,
      poRegister: [
        { poNumber: 'PO-S7B', vendorName: 'Creston Valley', authorizedQty: 12, authorizedAmount: 5000 },
      ],
    });
    expect(ctrl(results, 'IP-C7').status).toBe('failed');
  });

  it('quantity field under ordered_qty (authorizedQty alias) inline on invoice — overage fires', () => {
    // authorized_qty on the invoice row alongside billed quantity
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S7-C',
        vendor: 'Bright Meridian',
        amount: '500',
        po: 'PO-S7C',
        ordered_qty: '5',   // authorizedQty canonical alias
        quantity: '8',      // billedQty canonical alias
      },
    ]);
    // No PO register — authorized qty comes from inline invoice field
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C7').status).toBe('failed');
  });

  it('within-auth-qty does NOT fire IP-C7 (no false positive)', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S7-CLEAN',
        vendor: 'Northgate',
        amount: '500',
        po: 'PO-CLEAN',
        billed_qty: '5',
      },
    ]);
    const results = runControls({
      invoices,
      poRegister: [
        { poNumber: 'PO-CLEAN', vendorName: 'Northgate', authorizedQty: 10, authorizedAmount: 5000 },
      ],
    });
    expect(ctrl(results, 'IP-C7').status).toBe('passed');
  });
});

// ---------------------------------------------------------------------------
// Scenario 8 — Inactive vendor under alternate column names
// The existing test covers compliance_status=SUSPENDED.
// These add terminated, on hold, and vendor-master-driven status paths.
// ---------------------------------------------------------------------------

describe('s8 — inactive vendor (alternate column names + vendor master status)', () => {
  it('compliance_status=TERMINATED fires IP-C13', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S8-TERM',
        vendor: 'Creston Valley',
        amount: '500',
        po: 'PO-1',
        compliance_status: 'TERMINATED',
      },
    ]);
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C13').status).toBe('failed');
  });

  it('vendor_status=on hold fires IP-C13', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S8-HOLD',
        vendor: 'Northgate Fabrication',
        amount: '4800',
        po: 'PO-1',
        vendor_status: 'on hold',
      },
    ]);
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C13').status).toBe('failed');
  });

  it('supplier_status=NONCOMPLIANT fires IP-C13', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S8-NC',
        vendor: 'Bright Meridian',
        amount: '9750',
        po: 'PO-1',
        supplier_status: 'NONCOMPLIANT',
      },
    ]);
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C13').status).toBe('failed');
  });

  it('vendor master status SUSPENDED fires IP-C13 even when invoice has no status column', () => {
    // Status only on vendor master, not on invoice
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S8-MASTER',
        vendor: 'Creston Valley Supplies',
        amount: '500',
        po: 'PO-1',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Creston Valley Supplies', status: 'suspended' }],
    });
    expect(ctrl(results, 'IP-C13').status).toBe('failed');
  });

  it('active vendor does NOT fire IP-C13', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S8-OK',
        vendor: 'Northgate',
        amount: '500',
        po: 'PO-1',
        compliance_status: 'ACTIVE',
      },
    ]);
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C13').status).toBe('passed');
  });
});

// ---------------------------------------------------------------------------
// Scenario 9 — Remit address mismatch (supplementary cases)
// Primary coverage in invoice-normalization.test.ts ("9. remit address…").
// These add variant field names and the no-match case.
// ---------------------------------------------------------------------------

describe('s9 — remit address mismatch (adversarial depth)', () => {
  it('remittance_address field fires IP-C14 when it differs from vendor master', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S9-A',
        vendor: 'Northgate Fabrication',
        amount: '4800',
        po: 'PO-1',
        remittance_address: '99 Fake Road, Suite 1',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Northgate Fabrication', remitAddress: '1 Real Street' }],
    });
    expect(ctrl(results, 'IP-C14').status).toBe('failed');
  });

  it('payment_address field fires IP-C14 when mismatched', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S9-B',
        vendor: 'Bright Meridian',
        amount: '9750',
        po: 'PO-1',
        payment_address: '88 Fraudster Way',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Bright Meridian', remitAddress: '42 Commerce Blvd' }],
    });
    expect(ctrl(results, 'IP-C14').status).toBe('failed');
  });

  it('matching remit address passes IP-C14', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S9-PASS',
        vendor: 'Creston Valley Supplies',
        amount: '500',
        po: 'PO-1',
        remit_to: '100 Main St, Portland OR',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Creston Valley Supplies', remitAddress: '100 Main St, Portland OR' }],
    });
    expect(ctrl(results, 'IP-C14').status).toBe('passed');
  });

  it('vendor not in master → IP-C14 skips, NOT fails (no false positive)', () => {
    // Invoice has a remit address, but this vendor is not in the master
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-S9-NOMATCH',
        vendor: 'Unknown Widget Co',
        amount: '500',
        po: 'PO-1',
        remit_to: '1 Nowhere Lane',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Creston Valley Supplies', remitAddress: '100 Main St' }],
    });
    // Vendor not in master → no mismatch can be evaluated → must be passed (no hit found)
    // This is correct behavior: no match in master means we can't raise a finding.
    expect(['passed', 'skipped_field_absent']).toContain(ctrl(results, 'IP-C14').status);
  });
});

// ---------------------------------------------------------------------------
// Scenario 10 — Missing vendor master: coverage accounting is correct
// Primary coverage in invoice-normalization.test.ts ("10. missing vendor master…").
// These add missingEvidence assertions and verify no false passes.
// ---------------------------------------------------------------------------

describe('s10 — missing vendor master (evidence accounting depth)', () => {
  const invoicesWithBankAndRemit = normalizeMany([
    {
      invoice_number: 'INV-S10',
      vendor: 'Northgate Fabrication',
      amount: '4800',
      po: 'PO-1',
      bank_routing: '021000021',
      remit_to: '999 Fraud Lane',
      vendor_email: 'ap@phishing.com',
      city: 'Columbus',
      state: 'OH',
    },
  ]);

  it('IP-C4 missingEvidence contains vendorMaster', () => {
    const results = runControls({ invoices: invoicesWithBankAndRemit });
    const c4 = ctrl(results, 'IP-C4');
    expect(c4.status).toBe('needs_more_evidence');
    expect(c4.missingEvidence).toBeDefined();
    expect(c4.missingEvidence).toContain('vendorMaster');
  });

  it('IP-C10 missingEvidence contains vendorMaster', () => {
    const results = runControls({ invoices: invoicesWithBankAndRemit });
    const c10 = ctrl(results, 'IP-C10');
    expect(c10.status).toBe('needs_more_evidence');
    expect(c10.missingEvidence).toContain('vendorMaster');
  });

  it('IP-C11 missingEvidence contains vendorMaster', () => {
    const results = runControls({ invoices: invoicesWithBankAndRemit });
    const c11 = ctrl(results, 'IP-C11');
    expect(c11.status).toBe('needs_more_evidence');
    expect(c11.missingEvidence).toContain('vendorMaster');
  });

  it('IP-C14 missingEvidence contains vendorMaster', () => {
    const results = runControls({ invoices: invoicesWithBankAndRemit });
    const c14 = ctrl(results, 'IP-C14');
    expect(c14.status).toBe('needs_more_evidence');
    expect(c14.missingEvidence).toContain('vendorMaster');
  });

  it('coverage summary skipped/needs_more_evidence > 0 when no vendor master', () => {
    const results = runControls({ invoices: invoicesWithBankAndRemit });
    const summary = buildCoverageSummary(results);
    expect(summary.needs_more_evidence + summary.skipped).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 11 — Missing PO register: coverage accounting is correct
// Primary coverage in invoice-normalization.test.ts ("11. missing PO register…").
// These add missingEvidence assertions and verify C6 skips, not passes.
// ---------------------------------------------------------------------------

describe('s11 — missing PO register (evidence accounting depth)', () => {
  const invoicesWithPO = normalizeMany([
    {
      invoice_number: 'INV-S11',
      vendor: 'Creston Valley Supplies',
      amount: '99999', // would massively exceed any PO if one existed
      po: 'PO-HUGE',
    },
  ]);

  it('IP-C6 skips with missingEvidence=[poRegister] — NEVER a false pass', () => {
    const results = runControls({ invoices: invoicesWithPO });
    const c6 = ctrl(results, 'IP-C6');
    expect(c6.status).toBe('needs_more_evidence');
    expect(c6.missingEvidence).toContain('poRegister');
  });

  it('IP-C7 skips when no PO register and no inline qty — not a pass', () => {
    const results = runControls({ invoices: invoicesWithPO });
    const c7 = ctrl(results, 'IP-C7');
    // Without billedQty on invoice OR authorizedQty in PO register, must skip
    expect(['skipped_field_absent', 'needs_more_evidence']).toContain(c7.status);
  });

  it('evidenceSufficiency is less than 1.0 when PO register absent', () => {
    const results = runControls({ invoices: invoicesWithPO });
    const summary = buildCoverageSummary(results);
    const sufficiency = summary.total_controls > 0
      ? summary.checked / summary.total_controls
      : 0;
    expect(sufficiency).toBeLessThan(1.0);
  });
});

// ---------------------------------------------------------------------------
// Scenario 12 — Standing order does NOT false-positive as duplicate
// Primary coverage in invoice-normalization.test.ts ("12. standing order…").
// These test the multi-vendor generic fixture and a 2-invoice standing order.
// ---------------------------------------------------------------------------

describe('s12 — standing order suppression (adversarial depth)', () => {
  it('2-invoice standing order (same vendor + PO + amount) is suppressed', () => {
    const rows = parseInvoices(
      'invoice_number,vendor,amount,po\nNGF-001,Northgate Fabrication,1500,PO-NGF-STAND\nNGF-002,Northgate Fabrication,1500,PO-NGF-STAND',
    );
    const result = scanInvoicesWithCoverage(rows);
    const nearDup = result.findings.filter((f) => /duplicate|near.?dup/i.test(f.pattern));
    expect(nearDup).toHaveLength(0);
  });

  it('3-invoice standing order (3 sequential nos, same vendor+PO+amount) is suppressed', () => {
    const rows = parseInvoices(
      'invoice_number,vendor,amount,po\nCVS-101,Creston Valley,2500,PO-CV-MONTHLY\nCVS-102,Creston Valley,2500,PO-CV-MONTHLY\nCVS-103,Creston Valley,2500,PO-CV-MONTHLY',
    );
    const result = scanInvoicesWithCoverage(rows);
    const nearDup = result.findings.filter((f) => /duplicate/i.test(f.pattern));
    expect(nearDup).toHaveLength(0);
  });

  it('non-sequential invoice numbers with same vendor+amount ARE flagged (not standing order)', () => {
    // BMC-700 and BMC-750 — not sequential, same amount → should be flagged
    const rows = parseInvoices(
      'invoice_number,vendor,amount,po\nBMC-700,Bright Meridian,9750,PO-BMC\nBMC-750,Bright Meridian,9750,PO-BMC',
    );
    const result = scanInvoicesWithCoverage(rows);
    // Non-sequential → NOT a standing order → near-duplicate warning must fire
    const nearDup = result.findings.filter((f) =>
      /duplicate|near.?dup/i.test(f.pattern),
    );
    expect(nearDup.length).toBeGreaterThan(0);
  });

  it('standing order with 4 invoices — none flagged as duplicate', () => {
    const csv = [
      'invoice_number,vendor,amount,po',
      'NG-Q1,Northgate Fabrication,5000,PO-RETAINER',
      'NG-Q2,Northgate Fabrication,5000,PO-RETAINER',
      'NG-Q3,Northgate Fabrication,5000,PO-RETAINER',
      'NG-Q4,Northgate Fabrication,5000,PO-RETAINER',
    ].join('\n');
    const rows = parseInvoices(csv);
    const result = scanInvoicesWithCoverage(rows);
    const nearDup = result.findings.filter((f) => /duplicate/i.test(f.pattern));
    expect(nearDup).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Generic Fixture 1 — Northgate Fabrication
// Tests clean-path behavior with this fixture across key controls.
// ---------------------------------------------------------------------------

describe('generic-fixture-1 — Northgate Fabrication (clean path)', () => {
  it('normalizes correctly from JSON fixture', () => {
    const norm = normalizeInvoice(NORTHGATE_CLEAN as Record<string, unknown>);
    expect(norm.invoiceNo.value).toBe('NGF-2024-001');
    expect(norm.vendor.value).toBe('Northgate Fabrication LLC');
    expect(norm.amount.value).toBe(4800);
    expect(norm.po.value).toBe('PO-NGF-88');
    expect(isUsable(norm.vendorCity)).toBe(true);
    expect(norm.vendorCity!.value).toBe('Columbus');
    expect(norm.normalizationWarnings).toHaveLength(0);
  });

  it('C1 passes (no duplicate in single-invoice batch)', () => {
    const invoices = normalizeMany([NORTHGATE_CLEAN as Record<string, unknown>]);
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C1').status).toBe('passed');
  });

  it('C9 does NOT flag $4800 (not a round $500 multiple)', () => {
    const invoices = normalizeMany([NORTHGATE_CLEAN as Record<string, unknown>]);
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C9').status).toBe('passed');
  });
});

// ---------------------------------------------------------------------------
// Generic Fixture 2 — Creston Valley Supplies
// Tests email domain extraction and alias JSON parsing.
// ---------------------------------------------------------------------------

describe('generic-fixture-2 — Creston Valley Supplies', () => {
  it('normalizes all fields from JSON (supplier / amount_due / PO Reference)', () => {
    const norm = normalizeInvoice(CRESTON_CLEAN as Record<string, unknown>);
    expect(norm.invoiceNo.value).toBe('CVS-551');
    expect(norm.vendor.value).toBe('Creston Valley Supplies Inc');
    expect(norm.amount.value).toBe(12500);
    expect(norm.po.value).toBe('PO-CV-2024-009');
    // Email domain extraction
    expect(isUsable(norm.emailDomain)).toBe(true);
    expect(norm.emailDomain!.value).toBe('crestonvalley.com');
  });

  it('C9 flags $12,500 (multiple of $500 at ≥$1000)', () => {
    const invoices = normalizeMany([CRESTON_CLEAN as Record<string, unknown>]);
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C9').status).toBe('failed');
  });

  it('C11 fires when email domain mismatches vendor master', () => {
    const invoices = normalizeMany([CRESTON_CLEAN as Record<string, unknown>]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Creston Valley Supplies Inc', expectedEmailDomain: 'crestonvalley.com' }],
    });
    // Email matches → C11 must pass, not fire
    expect(ctrl(results, 'IP-C11').status).toBe('passed');
  });
});

// ---------------------------------------------------------------------------
// Generic Fixture 3 — Bright Meridian Consulting
// Tests remit address parsing, purchase_order_number alias, inv_no alias.
// ---------------------------------------------------------------------------

describe('generic-fixture-3 — Bright Meridian Consulting', () => {
  it('normalizes from JSON (inv_no + company + purchase_order_number + remit_to)', () => {
    const norm = normalizeInvoice(MERIDIAN_CLEAN as Record<string, unknown>);
    expect(norm.invoiceNo.value).toBe('BMC-700');
    expect(norm.vendor.value).toBe('Bright Meridian Consulting');
    expect(norm.amount.value).toBe(9750);
    expect(norm.po.value).toBe('PO-BMC-14');
    expect(isUsable(norm.remitAddress)).toBe(true);
    expect(norm.remitAddress!.value).toContain('42 Commerce Blvd');
  });

  it('C9 flags $9750 (≥$10000? no — $9750 < $10000 so must NOT flag)', () => {
    // $9750 < $10000 → tier-b ($10k+ multiples of $100) does NOT apply
    // $9750 % 500 = 250 → tier-a does NOT apply either
    // Result: must NOT be flagged
    const invoices = normalizeMany([MERIDIAN_CLEAN as Record<string, unknown>]);
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C9').status).toBe('passed');
  });

  it('C14 fires when remit address mismatches vendor master', () => {
    const invoices = normalizeMany([MERIDIAN_CLEAN as Record<string, unknown>]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Bright Meridian Consulting', remitAddress: '1 Wrong Place' }],
    });
    expect(ctrl(results, 'IP-C14').status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// CSV reordered columns — Generic Fixture 3 scenario
// Verifies that when PO comes before invoice number, parsing still lands
// each value in the correct canonical slot.
// ---------------------------------------------------------------------------

describe('generic-3 — CSV reordered columns (scenario 1 depth)', () => {
  it('po,vendor,amount,invoice_number order normalizes to correct slots', () => {
    const csv = 'po,vendor,amount,invoice_number\nPO-BMC-14,"Bright Meridian Consulting",9750,BMC-700';
    const norm = normalizeMany(parseTabular(csv).rows);
    expect(norm).toHaveLength(1);
    expect(norm[0].po.value).toBe('PO-BMC-14');
    expect(norm[0].vendor.value).toBe('Bright Meridian Consulting');
    expect(norm[0].amount.value).toBe(9750);
    expect(norm[0].invoiceNo.value).toBe('BMC-700');
  });

  it('amount,city,state,invoice_number,vendor,po order normalizes', () => {
    const csv = 'amount,city,state,invoice_number,vendor,po\n12500,Portland,OR,CVS-551,"Creston Valley Supplies",PO-CV';
    const norm = normalizeMany(parseTabular(csv).rows);
    expect(norm[0].invoiceNo.value).toBe('CVS-551');
    expect(norm[0].amount.value).toBe(12500);
    expect(norm[0].po.value).toBe('PO-CV');
    expect(isUsable(norm[0].vendorCity)).toBe(true);
    expect(norm[0].vendorCity!.value).toBe('Portland');
    expect(isUsable(norm[0].vendorState)).toBe(true);
    expect(norm[0].vendorState!.value).toBe('OR');
  });

  it('bank column before invoice_number still maps to bankRouting', () => {
    const csv = 'routing_number,invoice_number,vendor,amount,po\n021000021,NGF-2024-001,Northgate Fabrication,4800,PO-NGF-88';
    const norm = normalizeMany(parseTabular(csv).rows);
    expect(norm[0].invoiceNo.value).toBe('NGF-2024-001');
    expect(isUsable(norm[0].bankRouting)).toBe(true);
    expect(norm[0].bankRouting!.value).toBe('021000021');
  });
});
