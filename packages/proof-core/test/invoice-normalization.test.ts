import { describe, it, expect } from 'vitest';

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
} from '../src/control-readiness.js';
import { scanInvoicesWithCoverage, parseInvoices, normalizedToRow } from '../src/invoice-scan.js';
import { isUsable } from '../src/field-value.js';

function ctrl(results: ControlResult[], id: string): ControlResult {
  const r = results.find((c) => c.controlId === id);
  if (!r) throw new Error(`control ${id} not found`);
  return r;
}

describe('field-aliases', () => {
  it('resolves header variants case/space/underscore-insensitively', () => {
    for (const h of ['Invoice Number', 'invoice_number', 'INVOICE NUMBER', 'inv #']) {
      expect(resolveCanonicalField(h)?.canonical).toBe('invoiceNo');
    }
    expect(resolveCanonicalField('Vendor Name')?.canonical).toBe('vendor');
    expect(resolveCanonicalField('Grand_Total')?.canonical).toBe('amount');
    expect(resolveCanonicalField('PO Number')?.canonical).toBe('po');
  });

  it('returns null for genuinely unknown headers', () => {
    expect(resolveCanonicalField('quantum_flux_capacitor')).toBeNull();
  });

  it('strips legal suffixes for vendor name comparison', () => {
    expect(normalizeVendorName('Acme Industrial, Inc.')).toBe('acme industrial');
    expect(normalizeVendorName('acme industrial llc')).toBe('acme industrial');
    expect(normalizeVendorName('ACME INDUSTRIAL CORPORATION')).toBe('acme industrial');
  });
});

describe('tabular parsing', () => {
  it('1. handles reordered CSV columns via headers', () => {
    const text = 'amount,po,invoice_number,vendor\n"$1,200",PO-9,INV-1,Acme';
    const rows = normalizeMany(parseInput({ text }).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].invoiceNo.value).toBe('INV-1');
    expect(rows[0].vendor.value).toBe('Acme');
    expect(rows[0].amount.value).toBe(1200);
    expect(rows[0].po.value).toBe('PO-9');
  });

  it('2. handles uppercase ERP CSV headers + BOM', () => {
    const text = '﻿INVOICE NUMBER,VENDOR NAME,GRAND TOTAL\nINV-2,Globex,2500';
    const { rows } = parseTabular(text);
    const norm = normalizeMany(rows);
    expect(norm[0].invoiceNo.value).toBe('INV-2');
    expect(norm[0].vendor.value).toBe('Globex');
    expect(norm[0].amount.value).toBe(2500);
  });

  it('handles quoted values with embedded commas', () => {
    const text = 'vendor,invoice_number,amount\n"Acme, Inc.",INV-3,"1,000.50"';
    const norm = normalizeMany(parseTabular(text).rows);
    expect(norm[0].vendor.value).toBe('Acme, Inc.');
    expect(norm[0].amount.value).toBe(1000.5);
  });

  it('prefers payable Total over subtotal Amount when both amount columns exist', () => {
    const text = 'Vendor,Invoice #,Amount,Tax,Total\nHarbor ERP,ERP-1,12450,996,13446';
    const norm = normalizeMany(parseTabular(text).rows);
    expect(norm[0].amount.value).toBe(13446);
    expect(norm[0].amount.normalizedFrom).toBe('Total');
    expect(norm[0].lineItemsTotal?.value).toBe(12450);
    expect(norm[0].normalizationWarnings.join(' ')).toContain('used "Total"');
  });

  it('does not treat net amount as line-item total when freight rolls into grand total', () => {
    const text = [
      'Supplier Name\tDoc No\tPO Ref\tNet Amount\tFuel Surcharge\tGrand Total\tApprover',
      'Seaside Freight & Crating\tblue-TSV-1004\tPO-blue-1004\t1990.00\t222.75\t2212.75\tTara Holt',
    ].join('\n');
    const norm = normalizeMany(parseTabular(text).rows);
    expect(norm[0].amount.value).toBe(2212.75);
    expect(norm[0].amount.normalizedFrom).toBe('Grand Total');
    expect(norm[0].lineItemsTotal).toBeUndefined();
  });

  it('maps customer voucher and pay-this-amount fields', () => {
    const text = [
      'Vendor Name\tVoucher\tPay This Amount\tPO',
      'Carolina Alloy Supply\tblue-ND-2008A\t6400.00\tPO-blue-2008',
    ].join('\n');
    const norm = normalizeMany(parseTabular(text).rows);
    expect(norm[0].invoiceNo.value).toBe('blue-ND-2008A');
    expect(norm[0].amount.value).toBe(6400);
    expect(norm[0].po.value).toBe('PO-blue-2008');
  });

  it('maps standing order IDs as procurement references', () => {
    const text = [
      'Vendor,Invoice #,Standing_Order_ID,Amount Due,Service Month,Remit',
      'Seaside Freight & Crating,blue-SO-2026-05,SO-blue-001,1250.00,2026-05,Bank B / 7714',
    ].join('\n');
    const norm = normalizeMany(parseTabular(text).rows);
    expect(norm[0].po.value).toBe('SO-blue-001');
  });

  it('detects TSV delimiter', () => {
    const text = 'invoice_number\tvendor\tamount\nINV-4\tAcme\t99';
    const norm = normalizeMany(parseTabular(text).rows);
    expect(norm[0].invoiceNo.value).toBe('INV-4');
    expect(norm[0].amount.value).toBe(99);
  });

  it('falls back to positional with a warning when no header row', () => {
    const text = 'Acme,INV-5,500';
    const out = parseTabular(text);
    expect(out.warnings.length).toBeGreaterThan(0);
    const norm = normalizeMany(out.rows);
    expect(norm[0].vendor.value).toBe('Acme');
    expect(norm[0].invoiceNo.value).toBe('INV-5');
  });
});

describe('JSON + prose parsing', () => {
  it('3. JSON array with alternate key names', () => {
    const json = [{ 'Invoice ID': 'INV-6', supplier: 'Initech', amount_due: '$750' }];
    const rows = normalizeMany(parseInput({ json }).rows);
    expect(rows[0].invoiceNo.value).toBe('INV-6');
    expect(rows[0].vendor.value).toBe('Initech');
    expect(rows[0].amount.value).toBe(750);
  });

  it('JSON object becomes a single record', () => {
    const json = { invoiceNo: 'INV-7', vendor: 'Hooli', amount: 1 };
    const rows = parseInput({ json }).rows;
    expect(rows).toHaveLength(1);
  });

  it('parses JSON pasted as text and extracts a nested invoice object', () => {
    const text = JSON.stringify({
      invoice: {
        vendor: 'Precision Bearing Depot',
        invoice_no: 'blue-JSON-1003',
        po_number: 'PO-blue-1003',
        balance_due: 3945.5,
      },
    });
    const rows = normalizeMany(parseInput({ text }).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].invoiceNo.value).toBe('blue-JSON-1003');
    expect(rows[0].vendor.value).toBe('Precision Bearing Depot');
    expect(rows[0].amount.value).toBe(3945.5);
    expect(rows[0].po.value).toBe('PO-blue-1003');
  });

  it('extracts invoice rows from nested batch JSON', () => {
    const text = JSON.stringify({
      upload: {
        batches: [
          {
            documents: [
              {
                supplier: 'Seaside Freight & Crating',
                doc: 'blue-NJ-2014A',
                totals: { grand_total: 2115 },
              },
              {
                doc: 'blue-NJ-2014B',
                pay: { balance_due: 11125 },
                remit: 'temporary offshore lockbox',
              },
            ],
          },
        ],
      },
    });
    const rows = normalizeMany(parseInput({ text }).rows);
    expect(rows).toHaveLength(2);
    expect(rows[0].invoiceNo.value).toBe('blue-NJ-2014A');
    expect(rows[0].vendor.value).toBe('Seaside Freight & Crating');
    expect(rows[0].amount.value).toBe(2115);
    expect(rows[1].invoiceNo.value).toBe('blue-NJ-2014B');
    expect(rows[1].amount.value).toBe(11125);
  });

  it('4. parses a labeled prose invoice block', () => {
    const text = 'Invoice Number: INV-8\nVendor: Acme\nAmount: $1,200';
    const records = parseProse(text);
    expect(records).toHaveLength(1);
    const norm = normalizeInvoice(records[0]);
    expect(norm.invoiceNo.value).toBe('INV-8');
    expect(norm.amount.value).toBe(1200);
  });

  it('treats markdown invoice headings as prose instead of positional rows', () => {
    const text = [
      '# Invoice IP-01',
      'Vendor: Carolina Alloy Supply',
      'Invoice No: BLUE-1001',
      'PO: PO-blue-1001',
      'Amount Due: 4,820.00',
      'Tax: 385.60',
    ].join('\n');
    const rows = normalizeMany(parseInput({ text }).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].vendor.value).toBe('Carolina Alloy Supply');
    expect(rows[0].invoiceNo.value).toBe('BLUE-1001');
    expect(rows[0].amount.value).toBe(4820);
    expect(rows[0].po.value).toBe('PO-blue-1001');
  });

  it('parses multiple prose blocks separated by blank lines', () => {
    const text = 'Invoice Number: A\nAmount: 10\n\nInvoice Number: B\nAmount: 20';
    expect(parseProse(text)).toHaveLength(2);
  });

  it('parses freeform rush-payment email text into one invoice row', () => {
    const text =
      'Invoice blue-RUSH-2017 from Eastern Tool Rebuild. Please pay 19,475.00 today. PO is not available because field lead gave verbal approval during outage.';
    const rows = normalizeMany(parseInput({ text }).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].invoiceNo.value).toBe('blue-RUSH-2017');
    expect(rows[0].vendor.value).toBe('Eastern Tool Rebuild');
    expect(rows[0].amount.value).toBe(19475);
    expect(rows[0].po.source).toBe('absent');
  });

  it('treats verbal and phone-only procurement placeholders as missing PO evidence', () => {
    const text = [
      '*** OCR CAPTURE ***',
      'VENDOR.. Eastern Tool Rebuild',
      'INV: blue-OCR-2012',
      'PAY THIS AM0UNT: 22,890.00',
      'PO REF: -- handwritten "per phone ok"',
    ].join('\n');
    const rows = normalizeMany(parseInput({ text }).rows).map(normalizedToRow);
    expect(rows).toHaveLength(1);
    expect(rows[0].invoiceNo).toBe('blue-OCR-2012');
    expect(rows[0].amount).toBe(22890);
    expect(rows[0].po).toBe('');
  });
});

describe('unknown / uninterpretable values', () => {
  it('5. unparseable amount becomes source:unknown with a warning, NOT 0', () => {
    const norm = normalizeInvoice({
      invoice_number: 'INV-9',
      vendor: 'Acme',
      amount: 'twelve hundred',
    });
    expect(norm.amount.value).toBeNull();
    expect(norm.amount.source).toBe('unknown');
    expect(norm.normalizationWarnings.length).toBeGreaterThan(0);
    expect(isUsable(norm.amount)).toBe(false);
  });

  it('absent field is source:absent', () => {
    const norm = normalizeInvoice({ invoice_number: 'INV-10', vendor: 'Acme' });
    expect(norm.amount.source).toBe('absent');
  });

  it('keeps unmatched columns in unknownFields', () => {
    const norm = normalizeInvoice({ invoice_number: 'INV-11', vendor: 'Acme', weird_extra: 'x' });
    expect(norm.unknownFields).toHaveProperty('weird_extra', 'x');
  });
});

describe('control engine — evidence accounting', () => {
  const baseInvoices = normalizeMany([
    { invoice_number: 'INV-100', vendor: 'Acme', amount: '1000', po: 'PO-1' },
  ]);

  it('10. missing vendor master → mismatch controls skipped, not clean', () => {
    const results = runControls({ invoices: baseInvoices });
    expect(ctrl(results, 'IP-C4').status).toBe('needs_more_evidence');
    expect(ctrl(results, 'IP-C10').status).toBe('needs_more_evidence');
    expect(ctrl(results, 'IP-C11').status).toBe('needs_more_evidence');
    expect(ctrl(results, 'IP-C14').status).toBe('needs_more_evidence');
    expect(ctrl(results, 'IP-C4').missingEvidence).toContain('vendorMaster');
  });

  it('11. missing PO register → PO overage skipped, not clean', () => {
    const results = runControls({ invoices: baseInvoices });
    expect(ctrl(results, 'IP-C6').status).toBe('needs_more_evidence');
    expect(ctrl(results, 'IP-C6').missingEvidence).toContain('poRegister');
  });

  it('6. vendor master mismatch tolerates legal suffix differences', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-200',
        vendor: 'Acme Industrial LLC',
        amount: '500',
        po: 'PO-2',
        city: 'Reno',
        state: 'NV',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Acme Industrial, Inc.', city: 'Dallas', state: 'TX' }],
    });
    // suffix difference must NOT block the match; address mismatch must fire
    expect(ctrl(results, 'IP-C10').status).toBe('failed');
  });

  it('7. PO quantity overage with alternate qty field names', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-300',
        vendor: 'Acme',
        amount: '500',
        po: 'PO-3',
        qty_ordered: '10',
        quantity: '14',
      },
    ]);
    const results = runControls({
      invoices,
      poRegister: [
        { poNumber: 'PO-3', vendorName: 'Acme', authorizedQty: 10, authorizedAmount: 1000 },
      ],
    });
    expect(ctrl(results, 'IP-C7').status).toBe('failed');
  });

  it('8. inactive vendor status under alternate column name', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-400',
        vendor: 'Acme',
        amount: '500',
        po: 'PO-4',
        compliance_status: 'SUSPENDED',
      },
    ]);
    const results = runControls({ invoices });
    expect(ctrl(results, 'IP-C13').status).toBe('failed');
  });

  it('9. remit address mismatch fires against vendor master', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-500',
        vendor: 'Acme',
        amount: '500',
        po: 'PO-5',
        remit_to: '999 Fraud Lane',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Acme', remitAddress: '1 Real Street' }],
    });
    expect(ctrl(results, 'IP-C14').status).toBe('failed');
  });

  it('approval authority mismatch fires when amount exceeds role limit', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-600',
        vendor: 'Acme',
        amount: '50000',
        po: 'PO-6',
        approver_role: 'manager',
      },
    ]);
    const results = runControls({
      invoices,
      approvalMatrix: [{ approverRole: 'manager', approvalLimit: 10000 }],
    });
    expect(ctrl(results, 'IP-C12').status).toBe('failed');
  });

  it('email/domain mismatch fires', () => {
    const invoices = normalizeMany([
      {
        invoice_number: 'INV-700',
        vendor: 'Acme',
        amount: '500',
        po: 'PO-7',
        vendor_email: 'ap@evil.com',
      },
    ]);
    const results = runControls({
      invoices,
      vendorMaster: [{ vendorName: 'Acme', expectedEmailDomain: 'acme.com' }],
    });
    expect(ctrl(results, 'IP-C11').status).toBe('failed');
  });

  it('coverage summary counts passed/failed/skipped correctly', () => {
    const results = runControls({ invoices: baseInvoices });
    const summary = buildCoverageSummary(results);
    expect(summary.total_controls).toBe(17);
    expect(summary.checked).toBe(summary.passed + summary.failed);
    expect(summary.passed + summary.failed + summary.skipped + summary.needs_more_evidence).toBe(
      17,
    );
  });
});

describe('scanInvoicesWithCoverage integration', () => {
  it('messy input with no findings still reports skipped controls (not silently clean)', () => {
    // A single clean-looking invoice, no vendor master / PO register supplied.
    const rows = parseInvoices('invoice_number,vendor,amount,po\nINV-1,Acme,123.45,PO-1');
    const result = scanInvoicesWithCoverage(rows);
    expect(result.coverage.total_controls).toBe(17);
    // Several controls cannot run without external evidence → must be skipped.
    expect(result.coverage.skipped + result.coverage.needs_more_evidence).toBeGreaterThan(0);
    expect(result.controlResults.some((c) => c.status === 'needs_more_evidence')).toBe(true);
  });

  it('12. standing order does not false-positive as duplicate (legacy findings preserved)', () => {
    const rows = parseInvoices(
      'invoice_number,vendor,amount,po\nINV-001,Acme,500,PO-9\nINV-002,Acme,500,PO-9\nINV-003,Acme,500,PO-9',
    );
    const result = scanInvoicesWithCoverage(rows);
    // standing-order suppression means no near-duplicate finding should surface
    const nearDup = result.findings.filter((f) => /duplicate/i.test(f.pattern));
    expect(nearDup).toHaveLength(0);
  });

  it('does not double-count exact duplicates as near-duplicates', () => {
    const rows = parseInvoices(
      'invoice_number,vendor,amount,po\nDUP-1,Acme,500,PO-1\nDUP-1,Acme,500,PO-1',
    );
    const result = scanInvoicesWithCoverage(rows);
    expect(result.findings.filter((f) => /Exact duplicate/.test(f.pattern))).toHaveLength(1);
    expect(result.findings.filter((f) => /near-duplicate/i.test(f.pattern))).toHaveLength(0);
  });

  it('still flags same vendor and amount under different invoice numbers', () => {
    const rows = parseInvoices(
      'invoice_number,vendor,amount,po\nDUP-10,Acme,500,PO-1\nDUP-90,Acme,500,PO-1',
    );
    const result = scanInvoicesWithCoverage(rows);
    expect(result.findings.some((f) => /near-duplicate/i.test(f.pattern))).toBe(true);
  });

  it('legacy positional CSV (no header) parses in original column order', () => {
    // vendor, invoiceNo, amount, po, bank, lineItems — the legacy contract.
    const rows = parseInvoices('Acme,INV-9,1100.00,PO-7,021000021,1000');
    expect(rows).toHaveLength(1);
    expect(rows[0].vendor).toBe('Acme');
    expect(rows[0].invoiceNo).toBe('INV-9');
    expect(rows[0].amount).toBe(1100);
    expect(rows[0].po).toBe('PO-7');
    expect(rows[0].bank).toBe('021000021');
    expect(rows[0].lineItemsTotal).toBe(1000);
  });

  it('legacy header line is still parsed (header-keyed, better than positional)', () => {
    const rows = parseInvoices(
      'vendor,invoice no,amount,po,bank\nGlobex,INV-10,2500,PO-8,123456789',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].vendor).toBe('Globex');
    expect(rows[0].invoiceNo).toBe('INV-10');
    expect(rows[0].amount).toBe(2500);
  });

  it('exposes normalization warnings and unknown fields', () => {
    const rows = parseInvoices('vendor,invoice_number,amount,mystery_col\nAcme,INV-1,100,zzz');
    const result = scanInvoicesWithCoverage(rows);
    expect(Array.isArray(result.normalizationWarnings)).toBe(true);
    expect(Array.isArray(result.unknownFields)).toBe(true);
  });
});
