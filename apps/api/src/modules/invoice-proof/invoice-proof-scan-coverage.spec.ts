/**
 * Runner-level port of the "route-level" coverage suite from
 * apps/web/tests/vitest/invoice-coverage-adversarial.test.ts (SwarmSync b776039f).
 *
 * The original drove the Next.js proxy `POST /api/scan/invoices` with `fetch` mocked to call
 * parseInvoiceScanBody + runInvoiceScan. The proxy contributed no scan logic, so this spec
 * drives the same two functions directly through a local `POST` that reproduces the mocked
 * fetch handler (including the opt-in session-history behaviour). Assertions are unchanged.
 * The proxy itself is a web concern (apps/web) and is not part of this spec.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import type { HistoryRecord } from '@chain-verify/proof-core/invoice-scan.js';

import { parseInvoiceScanBody, runInvoiceScan } from './invoice-proof-scan.runner.js';

type RouteRequest = { body: Record<string, unknown>; ip: string };

function makeRequest(body: unknown, ip = '127.9.9.1'): RouteRequest {
  return { body: body as Record<string, unknown>, ip };
}

const routeHistory = new Map<string, HistoryRecord[]>();

async function POST(req: RouteRequest) {
  const body = req.body;
  const historyKey = req.ip;
  const parsed = parseInvoiceScanBody(body);
  const useSessionHistory = body.useSessionHistory === true;
  const result = runInvoiceScan(parsed, useSessionHistory ? routeHistory.get(historyKey) ?? [] : []);

  if (useSessionHistory) {
    const nextHistory = parsed.rows.map((row) => ({
      invoiceNo: row.invoiceNo,
      vendor: row.vendor,
      amount: row.amount,
      po: row.po,
      submittedAt: new Date(),
    }));
    routeHistory.set(historyKey, [...(routeHistory.get(historyKey) ?? []), ...nextHistory]);
  }

  const payload = { ...result, sessionHistoryUsed: useSessionHistory };
  return { status: 200, json: async () => payload };
}

describe('route-level — POST /api/scan/invoices coverage guarantee', () => {
  const routeHistory = new Map<string, HistoryRecord[]>();

  beforeEach(() => {
    routeHistory.clear();
  });

  it('scan with no vendorMaster/poRegister returns coverage_summary.skipped > 0', async () => {
    const req = makeRequest({
      invoices: [
        {
          vendor: 'Northgate Fabrication',
          invoiceNo: 'NGF-ROUTE-1',
          amount: 4800,
          po: 'PO-NGF-88',
        },
      ],
      // Deliberately omit vendorMaster and poRegister
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      coverage_summary: { skipped: number; total_controls: number; checked: number };
      checks_skipped: Array<{ controlId: string }>;
    };

    // The skipped count in coverage_summary must be > 0 — several controls
    // need vendorMaster or poRegister and must be skipped/needs_more_evidence.
    expect(data.coverage_summary.skipped).toBeGreaterThan(0);

    // checks_skipped array must be non-empty so the caller sees WHICH controls skipped.
    expect(Array.isArray(data.checks_skipped)).toBe(true);
    expect(data.checks_skipped.length).toBeGreaterThan(0);

    // The "no findings != clean" contract: even with 0 findings, all controls
    // remain represented in total_controls.
    expect(data.coverage_summary.total_controls).toBe(17);
  });

  it('scan with no evidence at all has evidence_sufficiency_score < 1.0', async () => {
    const req = makeRequest({
      invoices: [
        {
          vendor: 'Creston Valley Supplies',
          invoiceNo: 'CVS-ROUTE-2',
          amount: 500,
        },
        // No po, no vendorMaster, no poRegister
      ],
    }, '127.9.9.2');
    const res = await POST(req);
    const data = (await res.json()) as { evidence_sufficiency_score: number };
    expect(data.evidence_sufficiency_score).toBeLessThan(1.0);
  });

  it('IP-C6 is in checks_skipped when poRegister is absent', async () => {
    const req = makeRequest({
      invoices: [{ vendor: 'Bright Meridian', invoiceNo: 'BMC-ROUTE-3', amount: 9750, po: 'PO-1' }],
    }, '127.9.9.3');
    const res = await POST(req);
    const data = (await res.json()) as {
      checks_skipped: Array<{ controlId: string }>;
    };
    const skippedIds = data.checks_skipped.map((c) => c.controlId);
    expect(skippedIds).toContain('IP-C6');
  });

  it('IP-C4 and IP-C14 are in checks_skipped when vendorMaster is absent', async () => {
    const req = makeRequest({
      invoices: [
        {
          vendor: 'Northgate Fabrication',
          invoiceNo: 'NGF-ROUTE-4',
          amount: 4800,
          po: 'PO-1',
          bankRouting: '021000021',
        },
      ],
    }, '127.9.9.4');
    const res = await POST(req);
    const data = (await res.json()) as {
      checks_skipped: Array<{ controlId: string }>;
    };
    const skippedIds = data.checks_skipped.map((c) => c.controlId);
    expect(skippedIds).toContain('IP-C4');
    expect(skippedIds).toContain('IP-C14');
  });

  it('route accepts text/CSV mode and returns coverage fields', async () => {
    const req = makeRequest({
      text: 'invoice_number,vendor,amount,po\nNGF-CSV-1,Northgate Fabrication,4800,PO-NGF',
    }, '127.9.9.5');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      coverage_summary: unknown;
      checks_passed: unknown[];
      checks_skipped: unknown[];
    };
    expect(data.coverage_summary).toBeDefined();
    expect(Array.isArray(data.checks_passed)).toBe(true);
    expect(Array.isArray(data.checks_skipped)).toBe(true);
  });

  it('route parses JSON submitted through the text field', async () => {
    const req = makeRequest({
      text: JSON.stringify({
        invoice: {
          vendor: 'Precision Bearing Depot',
          invoice_no: 'JSON-TEXT-1',
          po_number: 'PO-JSON-1',
          balance_due: 3945.5,
        },
      }),
    }, '127.9.9.6');
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      rowCount: number;
      checks_passed: Array<{ controlId: string }>;
    };

    expect(data.rowCount).toBe(1);
    expect(data.checks_passed.map((c) => c.controlId)).toContain('IP-C1');
  });

  it('does not reuse prior public scan history unless explicitly requested', async () => {
    const ip = '127.9.9.7';
    const first = await POST(
      makeRequest({
        invoices: [{ vendor: 'History Safe Vendor', invoiceNo: 'HIST-1', amount: 1000 }],
      }, ip),
    );
    expect(first.status).toBe(200);

    const second = await POST(
      makeRequest({
        invoices: [{ vendor: 'History Safe Vendor', invoiceNo: 'HIST-1', amount: 1000 }],
      }, ip),
    );
    const secondData = (await second.json()) as {
      sessionHistoryUsed: boolean;
      findingCount: number;
      findings: Array<{ pattern: string }>;
    };

    expect(secondData.sessionHistoryUsed).toBe(false);
    expect(secondData.findings.some((f) => /Exact duplicate/.test(f.pattern))).toBe(false);
  });

  it('keeps session history available when the caller opts in', async () => {
    const ip = '127.9.9.8';
    await POST(
      makeRequest({
        useSessionHistory: true,
        invoices: [{ vendor: 'History Opt In Vendor', invoiceNo: 'HIST-OPT-1', amount: 1000 }],
      }, ip),
    );

    const second = await POST(
      makeRequest({
        useSessionHistory: true,
        invoices: [{ vendor: 'History Opt In Vendor', invoiceNo: 'HIST-OPT-1', amount: 1000 }],
      }, ip),
    );
    const secondData = (await second.json()) as {
      sessionHistoryUsed: boolean;
      findings: Array<{ pattern: string }>;
    };

    expect(secondData.sessionHistoryUsed).toBe(true);
    expect(secondData.findings.some((f) => /Exact duplicate/.test(f.pattern))).toBe(true);
  });
});
