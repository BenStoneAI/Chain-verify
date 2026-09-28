import { describe, expect, it } from 'vitest';

import {
  hashFingerprint,
  parseInvoiceScanBody,
  runInvoiceScan,
} from './invoice-proof-scan.runner.js';

describe('invoice-proof-scan.runner', () => {
  it('hashFingerprint is deterministic', () => {
    const a = hashFingerprint('ip:127.0.0.1');
    const b = hashFingerprint('ip:127.0.0.1');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('parseInvoiceScanBody parses CSV text', () => {
    const parsed = parseInvoiceScanBody({
      text: 'vendor,invoice_no,amount,po,bank\nAcme Corp,INV-001,1500,PO-100,021000021',
    });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].vendor).toBe('Acme Corp');
    expect(parsed.rows[0].invoiceNo).toBe('INV-001');
    expect(parsed.rows[0].amount).toBe(1500);
  });

  it('runInvoiceScan detects bank change vs vendor master', () => {
    const parsed = parseInvoiceScanBody({
      invoices: [
        {
          vendor: 'Carolina Alloy Supply',
          invoiceNo: 'blue-BEC-2010',
          amount: 28750,
          po: 'PO-9001',
          bankRouting: '909000909',
        },
      ],
      vendorMaster: [
        {
          vendorName: 'Carolina Alloy Supply',
          bankRoutingNumber: '021000021',
          city: 'Charlotte',
          state: 'NC',
        },
      ],
    });
    const result = runInvoiceScan(parsed);
    const bankFinding = result.findings.find((f) => f.pattern.includes('BANK_ACCOUNT_CHANGE'));
    expect(bankFinding).toBeDefined();
    expect(bankFinding?.severity).toBe('critical');
  });

  it('runInvoiceScan flags PO overage', () => {
    const parsed = parseInvoiceScanBody({
      invoices: [
        { vendor: 'Steel Co', invoiceNo: 'INV-99', amount: 5000, po: 'PO-500', bank: '021000021' },
      ],
      poRegister: [{ poNumber: 'PO-500', vendorName: 'Steel Co', authorizedAmount: 2000 }],
    });
    const result = runInvoiceScan(parsed);
    expect(result.findings.some((f) => f.pattern.toLowerCase().includes('po amount exceeded'))).toBe(
      true,
    );
  });
});
