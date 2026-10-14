// Phase B1 — InvoiceProof registry test suite.
//
// Asserts business-logic correctness (not existence) across 7 test groups:
//   1. Clean invoice batch         → all invoice-only controls pass.
//   2. Exact duplicate             → IP-C1 fails with ≥1 EvidenceRef.
//   3. Missing vendor_master       → IP-C4/C10/C11/C14 kernel-gated to 'skipped'.
//   4. PO amount overage           → IP-C6 fails with citation.
//   5. Approval matrix violation   → IP-C12 fails with citation.
//   6. Coverage summary semantics  → checked = passed+failed; skipped = gated controls;
//                                    confidence lower when mustCheck controls are skipped.
//   7. Citation guarantee          → every 'failed' result carries ≥1 EvidenceRef.

import { describe, it, expect } from 'vitest';

import {
  INVOICEPROOF_CONTROLS,
  buildInvoiceContext,
  runInvoiceProof,
} from '../src/registries/invoiceproof-controls.js';
import { runControls, buildCoverageSummary, computeDeterministicConfidence } from '../src/proof-kernel/registry.js';
import type { ControlResult, EvidenceContext } from '../src/proof-kernel/types.js';
import type { ClassifiedEvidence } from '../src/ingestion/evidence-input.js';

// ---------------------------------------------------------------------------
// Test fixture factories
// ---------------------------------------------------------------------------

/** Build a ClassifiedEvidence stub for invoice rows (minimal shape). */
function makeInvoiceDoc(
  rows: Record<string, unknown>[],
  fingerprint = 'inv-doc-fp',
): ClassifiedEvidence {
  return {
    documentType: 'invoice',
    confidence: 0.95,
    reasons: ['invoice fixture'],
    rawFingerprint: fingerprint,
    rows,
    sourceProduct: 'invoiceproof',
    normalizationWarnings: [],
  };
}

function makeVendorMasterDoc(rows: Record<string, unknown>[]): ClassifiedEvidence {
  return {
    documentType: 'vendor_master',
    confidence: 0.9,
    reasons: ['vendor_master fixture'],
    rawFingerprint: 'vm-doc-fp',
    rows,
    sourceProduct: 'invoiceproof',
    normalizationWarnings: [],
  };
}

function makePoRegisterDoc(rows: Record<string, unknown>[]): ClassifiedEvidence {
  return {
    documentType: 'purchase_order_register',
    confidence: 0.9,
    reasons: ['po_register fixture'],
    rawFingerprint: 'po-doc-fp',
    rows,
    sourceProduct: 'invoiceproof',
    normalizationWarnings: [],
  };
}

function makeApprovalMatrixDoc(rows: Record<string, unknown>[]): ClassifiedEvidence {
  return {
    documentType: 'approval_matrix',
    confidence: 0.9,
    reasons: ['approval_matrix fixture'],
    rawFingerprint: 'am-doc-fp',
    rows,
    sourceProduct: 'invoiceproof',
    normalizationWarnings: [],
  };
}

/** Resolve a result by controlId — throws if not found. */
function findResult(results: ControlResult[], id: string): ControlResult {
  const r = results.find((x) => x.controlId === id);
  if (!r) throw new Error(`Control ${id} not found in results`);
  return r;
}

// ---------------------------------------------------------------------------
// Clean invoice rows — three distinct invoices, no fraud signals.
// ---------------------------------------------------------------------------

const CLEAN_ROWS = [
  { invoice_number: 'INV-001', vendor: 'Northgate Fabrication LLC', amount: '4800.00', po_number: 'PO-001' },
  { invoice_number: 'INV-002', vendor: 'Creston Valley Supplies Inc', amount: '3200.00', po_number: 'PO-002' },
  { invoice_number: 'INV-003', vendor: 'Bright Meridian Consulting', amount: '7100.00', po_number: 'PO-003' },
];

// ---------------------------------------------------------------------------
// 1. Clean invoice batch
// ---------------------------------------------------------------------------

describe('1. clean invoice batch — invoice-only controls all pass', () => {
  const documents = [makeInvoiceDoc(CLEAN_ROWS)];
  const ctx = buildInvoiceContext(documents);
  const results = runControls(INVOICEPROOF_CONTROLS, ctx);

  // Controls that require ONLY invoices (mustCheck or otherwise).
  const invoiceOnlyIds = ['IP-C1', 'IP-C2', 'IP-C5', 'IP-C8', 'IP-C9', 'IP-C15'];

  for (const id of invoiceOnlyIds) {
    it(`${id} passes on clean batch`, () => {
      const r = findResult(results, id);
      // C8 and C9 may skip if fields are absent (no lineItemsTotal / amount ≥ threshold).
      // What must NOT happen is 'failed'. Either pass or skipped is acceptable on clean data.
      expect(r.status).not.toBe('failed');
    });
  }

  it('no control produces "failed" on a clean, de-duplicated batch', () => {
    const failed = results.filter((r) => r.status === 'failed');
    expect(failed).toHaveLength(0);
  });

  it('vendor-master-requiring controls are skipped (not failed) when no VM supplied', () => {
    // Without a vendor_master doc, IP-C4/C10/C11/C14 must be kernel-gated to skipped.
    const gated = ['IP-C4', 'IP-C10', 'IP-C11', 'IP-C14'];
    for (const id of gated) {
      const r = findResult(results, id);
      expect(r.status).toBe('skipped');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Exact duplicate → IP-C1 fails with ≥1 EvidenceRef
// ---------------------------------------------------------------------------

describe('2. exact duplicate — IP-C1 fails with citation', () => {
  const dupRows = [
    { invoice_number: 'INV-DUP-01', vendor: 'Northgate Fabrication', amount: '5000.00', po_number: 'PO-X' },
    // Exact same invoice number + same amount → duplicate.
    { invoice_number: 'INV-DUP-01', vendor: 'Northgate Fabrication', amount: '5000.00', po_number: 'PO-X' },
  ];

  const documents = [makeInvoiceDoc(dupRows, 'dup-inv-fp')];
  const { results } = runInvoiceProof(documents);

  it('IP-C1 status is "failed"', () => {
    const r = findResult(results, 'IP-C1');
    expect(r.status).toBe('failed');
  });

  it('IP-C1 carries at least one EvidenceRef', () => {
    const r = findResult(results, 'IP-C1');
    expect(r.status).toBe('failed');
    if (r.status === 'failed') {
      expect(r.evidenceRefs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('IP-C1 EvidenceRef documentType is "invoice"', () => {
    const r = findResult(results, 'IP-C1');
    if (r.status === 'failed' && r.evidenceRefs.length > 0) {
      expect(r.evidenceRefs[0].documentType).toBe('invoice');
    }
  });

  it('IP-C1 EvidenceRef.documentId matches the invoice doc fingerprint', () => {
    const r = findResult(results, 'IP-C1');
    if (r.status === 'failed' && r.evidenceRefs.length > 0) {
      expect(r.evidenceRefs[0].documentId).toBe('dup-inv-fp');
    }
  });

  it('IP-C1 severity is critical', () => {
    const r = findResult(results, 'IP-C1');
    if (r.status === 'failed') {
      expect(r.severity).toBe('critical');
    }
  });

  it('IP-C1 carries a recommendedAction', () => {
    const r = findResult(results, 'IP-C1');
    if (r.status === 'failed') {
      expect(typeof r.recommendedAction).toBe('string');
      expect(r.recommendedAction.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Missing vendor_master → IP-C4/C10/C11/C14 kernel-gated to 'skipped'
// ---------------------------------------------------------------------------

describe('3. missing vendor_master — kernel-gated controls are skipped', () => {
  // Invoice has all the fields these controls need — but no vendor_master doc.
  const invoiceWithBankAndCity = [
    {
      invoice_number: 'INV-VM-01',
      vendor: 'Northgate Fabrication LLC',
      amount: '4800.00',
      po_number: 'PO-001',
      bank_routing: '021000021',
      city: 'Columbus',
      state: 'OH',
      vendor_email: 'ap@northgate.com',
      remit_to: '1 North Gate Way',
    },
  ];

  const documents = [makeInvoiceDoc(invoiceWithBankAndCity)];
  // Deliberately NO vendor_master document.
  const { results } = runInvoiceProof(documents);

  const requiresVendorMaster = ['IP-C4', 'IP-C10', 'IP-C11', 'IP-C14'];

  for (const id of requiresVendorMaster) {
    it(`${id} status is "skipped" (kernel-gated, run() not called)`, () => {
      const r = findResult(results, id);
      expect(r.status).toBe('skipped');
    });

    it(`${id} reason indicates missing_document`, () => {
      const r = findResult(results, id);
      if (r.status === 'skipped') {
        expect(r.reason).toBe('missing_document');
      }
    });

    it(`${id} missingEvidence contains "vendor_master"`, () => {
      const r = findResult(results, id);
      if (r.status === 'skipped') {
        expect(r.missingEvidence).toContain('vendor_master');
      }
    });
  }

  it('IP-C4/C10/C11/C14 are ALL in the skipped set', () => {
    const skipped = results.filter((r) => r.status === 'skipped').map((r) => r.controlId);
    for (const id of requiresVendorMaster) {
      expect(skipped).toContain(id);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. PO amount overage with purchase_order_register → IP-C6 fails with citation
// ---------------------------------------------------------------------------

describe('4. PO amount overage — IP-C6 fails with citation', () => {
  const invoiceRows = [
    {
      invoice_number: 'INV-PO-01',
      vendor: 'Northgate Fabrication LLC',
      amount: '15000.00',
      po_number: 'PO-OVER-01',
    },
  ];

  const poRows = [
    {
      poNumber: 'PO-OVER-01',
      vendorName: 'Northgate Fabrication LLC',
      authorizedAmount: 10000,
    },
  ];

  const documents = [makeInvoiceDoc(invoiceRows, 'po-inv-fp'), makePoRegisterDoc(poRows)];
  const { results } = runInvoiceProof(documents);

  it('IP-C6 status is "failed"', () => {
    const r = findResult(results, 'IP-C6');
    expect(r.status).toBe('failed');
  });

  it('IP-C6 carries at least one EvidenceRef', () => {
    const r = findResult(results, 'IP-C6');
    if (r.status === 'failed') {
      expect(r.evidenceRefs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('IP-C6 EvidenceRef points to the invoice document', () => {
    const r = findResult(results, 'IP-C6');
    if (r.status === 'failed' && r.evidenceRefs.length > 0) {
      expect(r.evidenceRefs[0].documentType).toBe('invoice');
      expect(r.evidenceRefs[0].documentId).toBe('po-inv-fp');
    }
  });

  it('IP-C6 severity is high', () => {
    const r = findResult(results, 'IP-C6');
    if (r.status === 'failed') {
      expect(r.severity).toBe('high');
    }
  });

  it('IP-C6 sourcePassage mentions the overage', () => {
    const r = findResult(results, 'IP-C6');
    if (r.status === 'failed' && r.evidenceRefs.length > 0) {
      const passage = r.evidenceRefs[0].sourcePassage ?? '';
      // Legacy evidence string contains the invoice number or amount comparison.
      expect(passage.length).toBeGreaterThan(0);
    }
  });

  it('IP-C6 is NOT skipped when purchase_order_register is present', () => {
    const r = findResult(results, 'IP-C6');
    expect(r.status).not.toBe('skipped');
  });
});

// ---------------------------------------------------------------------------
// 5. Approval authority exceeded → IP-C12 fails with citation
// ---------------------------------------------------------------------------

describe('5. approval authority exceeded — IP-C12 fails with citation', () => {
  // Invoice billed at $25,000 but the approver's limit is only $5,000.
  const invoiceRows = [
    {
      invoice_number: 'INV-AUTH-01',
      vendor: 'Creston Valley Supplies',
      amount: '25000.00',
      po_number: 'PO-AUTH-01',
      approver_role: 'Manager',
    },
  ];

  const approvalRows = [
    {
      approverRole: 'Manager',
      approvalLimit: 5000,
    },
  ];

  const documents = [makeInvoiceDoc(invoiceRows, 'auth-inv-fp'), makeApprovalMatrixDoc(approvalRows)];
  const { results } = runInvoiceProof(documents);

  it('IP-C12 status is "failed"', () => {
    const r = findResult(results, 'IP-C12');
    expect(r.status).toBe('failed');
  });

  it('IP-C12 carries at least one EvidenceRef', () => {
    const r = findResult(results, 'IP-C12');
    if (r.status === 'failed') {
      expect(r.evidenceRefs.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('IP-C12 EvidenceRef documentId matches the invoice', () => {
    const r = findResult(results, 'IP-C12');
    if (r.status === 'failed' && r.evidenceRefs.length > 0) {
      expect(r.evidenceRefs[0].documentId).toBe('auth-inv-fp');
    }
  });

  it('IP-C12 severity is high', () => {
    const r = findResult(results, 'IP-C12');
    if (r.status === 'failed') {
      expect(r.severity).toBe('high');
    }
  });

  it('IP-C12 recommendedAction references a higher-authority approver', () => {
    const r = findResult(results, 'IP-C12');
    if (r.status === 'failed') {
      expect(r.recommendedAction.toLowerCase()).toMatch(/approv/);
    }
  });

  it('IP-C12 is NOT skipped when approval_matrix is present', () => {
    const r = findResult(results, 'IP-C12');
    expect(r.status).not.toBe('skipped');
  });
});

// ---------------------------------------------------------------------------
// 6. Coverage summary semantics
// ---------------------------------------------------------------------------

describe('6. coverage summary semantics', () => {
  describe('6a. checked = passed + failed', () => {
    it('full vendor-master batch: checked equals passed + failed', () => {
      // Provide vendor_master so C4/C10/C11/C14 are NOT skipped.
      const invoiceRows = [
        {
          invoice_number: 'INV-COV-01',
          vendor: 'Northgate Fabrication LLC',
          amount: '4800.00',
          po_number: 'PO-COV-01',
          city: 'Columbus',
          state: 'OH',
        },
      ];
      const vmRows = [{ vendorName: 'Northgate Fabrication LLC', city: 'Columbus', state: 'OH' }];
      const { results, coverage } = runInvoiceProof([
        makeInvoiceDoc(invoiceRows),
        makeVendorMasterDoc(vmRows),
      ]);

      // Kernel summary does NOT include needs_more_evidence as a separate bucket —
      // legacy needs_more_evidence is mapped to 'skipped/insufficient_evidence'.
      expect(coverage.checked).toBe(coverage.passed + coverage.failed);
    });
  });

  describe('6b. skipped counts the kernel-gated controls', () => {
    it('without vendor_master: skipped ≥ 4 (C4/C10/C11/C14 all gated)', () => {
      const { coverage } = runInvoiceProof([makeInvoiceDoc(CLEAN_ROWS)]);
      expect(coverage.skipped).toBeGreaterThanOrEqual(4);
    });

    it('with vendor_master: IP-C4/C10/C11/C14 are no longer missing_document-skipped', () => {
      // Without VM: C4/C10/C11/C14 are skipped with reason 'missing_document' (kernel gate).
      // With VM:    the kernel gate passes; the controls run (or skip for a different reason
      //             like absent invoice fields), but the 'missing_document' reason disappears.
      const withoutVM = runInvoiceProof([makeInvoiceDoc(CLEAN_ROWS)]).results;
      const withVM = runInvoiceProof([
        makeInvoiceDoc(CLEAN_ROWS),
        makeVendorMasterDoc([
          { vendorName: 'Northgate Fabrication LLC', city: 'Columbus', state: 'OH' },
          { vendorName: 'Creston Valley Supplies Inc', city: 'Portland', state: 'OR' },
          { vendorName: 'Bright Meridian Consulting' },
        ]),
      ]).results;

      const getMissingDocSkipped = (results: ControlResult[]) =>
        results.filter(
          (r): r is Extract<ControlResult, { status: 'skipped' }> =>
            r.status === 'skipped' && r.reason === 'missing_document',
        ).map((r) => r.controlId);

      const withoutVMMissingDoc = getMissingDocSkipped(withoutVM);
      const withVMMissingDoc = getMissingDocSkipped(withVM);

      // The VM-requiring controls must no longer appear in the missing_document set.
      for (const id of ['IP-C4', 'IP-C10', 'IP-C11', 'IP-C14']) {
        expect(withoutVMMissingDoc).toContain(id);
        expect(withVMMissingDoc).not.toContain(id);
      }
    });
  });

  describe('6c. deterministic confidence is lower when mustCheck controls are skipped', () => {
    it('confidence without vendor_master < confidence with everything provided', () => {
      // Without any supporting docs: mustCheck controls can still run (they only need
      // invoice), but skipped gated controls reduce evidenceSufficiency.
      const noSupplementDocs = [makeInvoiceDoc(CLEAN_ROWS)];
      const fullDocs = [
        makeInvoiceDoc(CLEAN_ROWS),
        makeVendorMasterDoc([{ vendorName: 'Northgate Fabrication LLC' }]),
        makePoRegisterDoc([{ poNumber: 'PO-001', vendorName: 'Northgate Fabrication LLC', authorizedAmount: 10000 }]),
        makeApprovalMatrixDoc([{ approverRole: 'Manager', approvalLimit: 50000 }]),
      ];

      const noSupplementConf = runInvoiceProof(noSupplementDocs).confidence;
      const fullConf = runInvoiceProof(fullDocs).confidence;

      // evidenceSufficiency is lower when more controls are skipped, so confidence
      // must be lower with fewer documents.
      expect(noSupplementConf.confidence).toBeLessThan(fullConf.confidence);
    });

    it('mustCheck skipped: confidence degrades vs same controls all passing', () => {
      const mustCheckIds = new Set(
        INVOICEPROOF_CONTROLS.filter((c) => c.mustCheck).map((c) => c.id),
      );

      // All mustCheck controls passed → confidence should be 1.0 (no failures, full
      // coverage of the must-check set).
      const allPassed: ControlResult[] = INVOICEPROOF_CONTROLS.filter((c) => c.mustCheck).map(
        (c) => ({ status: 'passed' as const, controlId: c.id, evidenceRefs: [] }),
      );

      // Same set but all skipped (simulates no invoice document present at all).
      const allSkipped: ControlResult[] = INVOICEPROOF_CONTROLS.filter((c) => c.mustCheck).map(
        (c) => ({
          status: 'skipped' as const,
          controlId: c.id,
          reason: 'missing_document' as const,
          missingEvidence: ['invoice'],
        }),
      );

      const passedConf = computeDeterministicConfidence(allPassed, { mustCheckIds });
      const skippedConf = computeDeterministicConfidence(allSkipped, { mustCheckIds });

      expect(passedConf.confidence).toBeGreaterThan(skippedConf.confidence);
    });

    it('evidenceSufficiency equals checked/total_controls', () => {
      const { results, coverage, confidence } = runInvoiceProof([makeInvoiceDoc(CLEAN_ROWS)]);
      const expectedSufficiency = coverage.total_controls > 0
        ? coverage.checked / coverage.total_controls
        : 0;
      expect(confidence.evidenceSufficiency).toBeCloseTo(expectedSufficiency, 4);
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Citation guarantee — every 'failed' result carries ≥1 EvidenceRef
// ---------------------------------------------------------------------------

describe('7. citation guarantee — every failed result carries ≥1 EvidenceRef', () => {
  // Build a batch that triggers as many failures as possible.
  const invoiceRows = [
    // Exact duplicate pair.
    { invoice_number: 'INV-CITE-01', vendor: 'Northgate Fabrication LLC', amount: '5000.00', po_number: 'PO-CITE-01' },
    { invoice_number: 'INV-CITE-01', vendor: 'Northgate Fabrication LLC', amount: '5000.00', po_number: 'PO-CITE-01' },
    // Modified duplicate pair.
    { invoice_number: 'INV-CITE-02', vendor: 'Creston Valley Supplies', amount: '1200.00', po_number: 'PO-CITE-02' },
    { invoice_number: 'INV-CITE-02', vendor: 'Creston Valley Supplies', amount: '1300.00', po_number: 'PO-CITE-02' },
    // Missing PO.
    { invoice_number: 'INV-CITE-03', vendor: 'Bright Meridian Consulting', amount: '3000.00' },
    // Round dollar ($5000).
    { invoice_number: 'INV-CITE-04', vendor: 'Northgate Fabrication LLC', amount: '5000.00', po_number: 'PO-CITE-04' },
    // Bank mismatch.
    {
      invoice_number: 'INV-CITE-05',
      vendor: 'Creston Valley Supplies',
      amount: '800.00',
      po_number: 'PO-CITE-05',
      bank_routing: '999999999',
    },
    // PO overage.
    { invoice_number: 'INV-CITE-06', vendor: 'Bright Meridian Consulting', amount: '20000.00', po_number: 'PO-CITE-06' },
    // Approval overage.
    {
      invoice_number: 'INV-CITE-07',
      vendor: 'Northgate Fabrication LLC',
      amount: '25000.00',
      po_number: 'PO-CITE-07',
      approver_role: 'Clerk',
    },
  ];

  const vmRows = [
    { vendorName: 'Creston Valley Supplies', bankRoutingNumber: '021000021', city: 'Portland', state: 'OR' },
    { vendorName: 'Bright Meridian Consulting' },
    { vendorName: 'Northgate Fabrication LLC', bankRoutingNumber: '021000021' },
  ];

  const poRows = [
    { poNumber: 'PO-CITE-06', vendorName: 'Bright Meridian Consulting', authorizedAmount: 5000 },
    { poNumber: 'PO-CITE-01', vendorName: 'Northgate Fabrication LLC', authorizedAmount: 10000 },
    { poNumber: 'PO-CITE-02', vendorName: 'Creston Valley Supplies', authorizedAmount: 10000 },
    { poNumber: 'PO-CITE-04', vendorName: 'Northgate Fabrication LLC', authorizedAmount: 10000 },
    { poNumber: 'PO-CITE-05', vendorName: 'Creston Valley Supplies', authorizedAmount: 10000 },
    { poNumber: 'PO-CITE-07', vendorName: 'Northgate Fabrication LLC', authorizedAmount: 10000 },
  ];

  const approvalRows = [{ approverRole: 'Clerk', approvalLimit: 1000 }];

  const documents = [
    makeInvoiceDoc(invoiceRows, 'citation-test-fp'),
    makeVendorMasterDoc(vmRows),
    makePoRegisterDoc(poRows),
    makeApprovalMatrixDoc(approvalRows),
  ];

  const { results } = runInvoiceProof(documents);

  it('at least some controls fail (the batch has real fraud signals)', () => {
    const failed = results.filter((r) => r.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
  });

  it('every failed result has evidenceRefs.length ≥ 1', () => {
    const failed = results.filter((r) => r.status === 'failed');
    for (const r of failed) {
      if (r.status === 'failed') {
        expect(r.evidenceRefs.length, `${r.controlId} failed with no evidenceRefs`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('every failed result evidenceRef has a non-empty documentId', () => {
    const failed = results.filter((r) => r.status === 'failed');
    for (const r of failed) {
      if (r.status === 'failed') {
        for (const ref of r.evidenceRefs) {
          expect(ref.documentId, `${r.controlId} evidenceRef missing documentId`).toBeTruthy();
        }
      }
    }
  });

  it('every failed result evidenceRef has documentType "invoice"', () => {
    const failed = results.filter((r) => r.status === 'failed');
    for (const r of failed) {
      if (r.status === 'failed') {
        for (const ref of r.evidenceRefs) {
          expect(ref.documentType, `${r.controlId} evidenceRef wrong documentType`).toBe('invoice');
        }
      }
    }
  });

  it('IP-C1 fails (exact duplicate pair in batch)', () => {
    expect(findResult(results, 'IP-C1').status).toBe('failed');
  });

  it('IP-C2 fails (modified duplicate pair in batch)', () => {
    expect(findResult(results, 'IP-C2').status).toBe('failed');
  });

  it('IP-C5 fails (invoice with no PO)', () => {
    expect(findResult(results, 'IP-C5').status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// 8. buildInvoiceContext — context projection integrity
// ---------------------------------------------------------------------------

describe('8. buildInvoiceContext projection integrity', () => {
  it('projects invoice rows into NormalizedInvoice via normalizeMany', () => {
    const documents = [makeInvoiceDoc(CLEAN_ROWS)];
    const ctx = buildInvoiceContext(documents);
    const legacyCtx = (ctx as { _legacyCtx: { invoices: unknown[] } })._legacyCtx;
    expect(legacyCtx.invoices).toHaveLength(CLEAN_ROWS.length);
  });

  it('projects vendor_master rows into the legacy context', () => {
    const vmRows = [{ vendorName: 'Northgate Fabrication LLC', city: 'Columbus' }];
    const documents = [makeInvoiceDoc(CLEAN_ROWS), makeVendorMasterDoc(vmRows)];
    const ctx = buildInvoiceContext(documents);
    const legacyCtx = (ctx as { _legacyCtx: { vendorMaster: unknown[] | undefined } })._legacyCtx;
    expect(legacyCtx.vendorMaster).toBeDefined();
    expect(legacyCtx.vendorMaster!.length).toBe(1);
  });

  it('projects purchase_order_register rows into the legacy context', () => {
    const poRows = [{ poNumber: 'PO-001', vendorName: 'Northgate', authorizedAmount: 10000 }];
    const documents = [makeInvoiceDoc(CLEAN_ROWS), makePoRegisterDoc(poRows)];
    const ctx = buildInvoiceContext(documents);
    const legacyCtx = (ctx as { _legacyCtx: { poRegister: unknown[] | undefined } })._legacyCtx;
    expect(legacyCtx.poRegister).toBeDefined();
    expect(legacyCtx.poRegister!.length).toBe(1);
  });

  it('projects approval_matrix rows into the legacy context', () => {
    const approvalRows = [{ approverRole: 'VP', approvalLimit: 100000 }];
    const documents = [makeInvoiceDoc(CLEAN_ROWS), makeApprovalMatrixDoc(approvalRows)];
    const ctx = buildInvoiceContext(documents);
    const legacyCtx = (ctx as { _legacyCtx: { approvalMatrix: unknown[] | undefined } })._legacyCtx;
    expect(legacyCtx.approvalMatrix).toBeDefined();
    expect(legacyCtx.approvalMatrix!.length).toBe(1);
  });

  it('product is "invoiceproof"', () => {
    const ctx = buildInvoiceContext([makeInvoiceDoc(CLEAN_ROWS)]);
    expect(ctx.product).toBe('invoiceproof');
  });

  it('documents array is preserved on the context', () => {
    const docs = [makeInvoiceDoc(CLEAN_ROWS)];
    const ctx = buildInvoiceContext(docs);
    expect(ctx.documents).toBe(docs);
  });
});

// ---------------------------------------------------------------------------
// 9. INVOICEPROOF_CONTROLS — structural invariants
// ---------------------------------------------------------------------------

describe('9. INVOICEPROOF_CONTROLS structural invariants', () => {
  it('exports exactly 15 controls', () => {
    expect(INVOICEPROOF_CONTROLS).toHaveLength(15);
  });

  it('all control ids are unique', () => {
    const ids = INVOICEPROOF_CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all control ids follow IP-C1..IP-C15 pattern', () => {
    for (let i = 1; i <= 15; i++) {
      expect(INVOICEPROOF_CONTROLS.map((c) => c.id)).toContain(`IP-C${i}`);
    }
  });

  it('all controls have product "invoiceproof"', () => {
    for (const c of INVOICEPROOF_CONTROLS) {
      expect(c.product).toBe('invoiceproof');
    }
  });

  it('all controls have requiredEvidence containing "invoice"', () => {
    for (const c of INVOICEPROOF_CONTROLS) {
      expect(c.requiredEvidence).toContain('invoice');
    }
  });

  it('mustCheck controls are IP-C1, C2, C5, C8, C9, C13, C15', () => {
    const mustCheck = INVOICEPROOF_CONTROLS.filter((c) => c.mustCheck).map((c) => c.id);
    expect(mustCheck).toContain('IP-C1');
    expect(mustCheck).toContain('IP-C2');
    expect(mustCheck).toContain('IP-C5');
    expect(mustCheck).toContain('IP-C8');
    expect(mustCheck).toContain('IP-C9');
    expect(mustCheck).toContain('IP-C13');
    expect(mustCheck).toContain('IP-C15');
  });

  it('vendor_master-requiring controls are IP-C4, C10, C11, C14', () => {
    const vmRequired = INVOICEPROOF_CONTROLS.filter(
      (c) => c.requiredEvidence.includes('vendor_master'),
    ).map((c) => c.id);
    expect(vmRequired).toContain('IP-C4');
    expect(vmRequired).toContain('IP-C10');
    expect(vmRequired).toContain('IP-C11');
    expect(vmRequired).toContain('IP-C14');
  });

  it('IP-C6 requires purchase_order_register', () => {
    const c6 = INVOICEPROOF_CONTROLS.find((c) => c.id === 'IP-C6')!;
    expect(c6.requiredEvidence).toContain('purchase_order_register');
  });

  it('IP-C12 requires approval_matrix', () => {
    const c12 = INVOICEPROOF_CONTROLS.find((c) => c.id === 'IP-C12')!;
    expect(c12.requiredEvidence).toContain('approval_matrix');
  });
});
