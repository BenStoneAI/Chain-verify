// Smoke tests for the shared proof kernel (Phase A foundation).
//
// Asserts the four load-bearing guarantees Phases B/C/D depend on:
//   (a) the classifier labels an invoice CSV 'invoice' and a policy prose blob 'policy';
//   (b) the registry SKIPS a control whose required document is absent — without
//       calling its run() — and populates missingEvidence;
//   (c) deterministic confidence is LOWER when a must-check control is skipped vs
//       when everything is checked;
//   (d) buildProofReport derives overall_status 'fail' on a failed-critical result.

import { describe, it, expect } from 'vitest';

import { ingestEvidence } from '../src/ingestion/evidence-input.js';
import { classifyEvidence } from '../src/ingestion/classifier.js';
import {
  runControls,
  computeDeterministicConfidence,
} from '../src/proof-kernel/registry.js';
import { buildProofReport } from '../src/proof-kernel/report.js';
import type {
  ControlDefinition,
  ControlResult,
  EvidenceContext,
} from '../src/proof-kernel/types.js';
import type { ClassifiedEvidence } from '../src/ingestion/evidence-input.js';

const INVOICE_CSV = [
  'invoice_number,vendor,amount,po_number',
  'INV-001,Acme Industrial Inc,1200.00,PO-9001',
  'INV-002,Bright Meridian,8400.50,PO-9002',
].join('\n');

const POLICY_PROSE = `Accounts Payable Control Policy

This policy shall govern the procedure for approving and paying supplier invoices.
All staff must comply with the segregation-of-duties requirements set out herein.
The governance committee reviews this policy annually.`;

describe('classifier', () => {
  it('labels an invoice CSV as "invoice"', () => {
    const ev = ingestEvidence({ text: INVOICE_CSV, sourceProduct: 'invoiceproof' });
    expect(ev.documentType).toBe('invoice');
    expect(ev.confidence).toBeGreaterThan(0.3);
    // Unknown docs are never discarded — rows are preserved.
    expect(ev.rows && ev.rows.length).toBe(2);
  });

  it('labels a policy prose blob as "policy"', () => {
    const result = classifyEvidence(undefined, POLICY_PROSE, undefined);
    expect(result.documentType).toBe('policy');
    expect(result.confidence).toBeGreaterThan(0.3);
  });
});

describe('registry evidence gating', () => {
  // A control that REQUIRES a vendor_master document. Its run() is a spy that throws
  // if ever called — the test proves the gate short-circuits before run().
  let runCalled = false;
  const needsVendorMaster: ControlDefinition = {
    id: 'TEST-NEEDS-VM',
    product: 'invoiceproof',
    name: 'Requires vendor master',
    severityDefault: 'high',
    requiredEvidence: ['vendor_master'],
    run: () => {
      runCalled = true;
      return { status: 'passed', controlId: 'TEST-NEEDS-VM', evidenceRefs: [] };
    },
  };

  it('skips a control whose required document is absent and never calls run()', () => {
    const invoiceDoc: ClassifiedEvidence = {
      documentType: 'invoice',
      confidence: 0.9,
      reasons: [],
      rawFingerprint: 'deadbeef',
      sourceProduct: 'invoiceproof',
      normalizationWarnings: [],
    };
    const ctx: EvidenceContext = { product: 'invoiceproof', documents: [invoiceDoc] };

    const results = runControls([needsVendorMaster], ctx);
    expect(runCalled).toBe(false);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r.status).toBe('skipped');
    if (r.status === 'skipped') {
      expect(r.reason).toBe('missing_document');
      expect(r.missingEvidence).toContain('vendor_master');
    }
  });
});

describe('computeDeterministicConfidence', () => {
  it('is lower when a must-check control is skipped vs all-checked', () => {
    const allChecked: ControlResult[] = [
      { status: 'passed', controlId: 'A', evidenceRefs: [] },
      { status: 'passed', controlId: 'B', evidenceRefs: [] },
    ];
    const oneSkipped: ControlResult[] = [
      { status: 'passed', controlId: 'A', evidenceRefs: [] },
      { status: 'skipped', controlId: 'B', reason: 'missing_document', missingEvidence: ['x'] },
    ];
    const mustCheckIds = new Set(['A', 'B']);

    const checked = computeDeterministicConfidence(allChecked, { mustCheckIds });
    const skipped = computeDeterministicConfidence(oneSkipped, { mustCheckIds });

    expect(checked.confidence).toBeGreaterThan(skipped.confidence);
    // All-checked, no failures → full confidence and sufficiency.
    expect(checked.confidence).toBe(1);
    expect(checked.evidenceSufficiency).toBe(1);
    // One of two controls evaluated → sufficiency 0.5.
    expect(skipped.evidenceSufficiency).toBe(0.5);
  });
});

describe('buildProofReport', () => {
  it('derives overall_status="fail" on a failed-critical result', () => {
    const results: ControlResult[] = [
      {
        status: 'failed',
        controlId: 'IP-C1',
        severity: 'critical',
        evidenceRefs: [{ documentId: 'd1', documentType: 'invoice', field: 'invoiceNo' }],
        recommendedAction: 'Remove the duplicate invoice before payment.',
        message: 'Exact duplicate invoice detected.',
      },
    ];
    const report = buildProofReport({
      product: 'invoiceproof',
      results,
      contentFingerprint: 'abc123',
    });
    expect(report.overall_status).toBe('fail');
    expect(report.controls.failed).toContain('IP-C1');
    expect(report.proof_id).toBe('proof_abc123');
    expect(report.recommended_next_actions).toContain(
      'Remove the duplicate invoice before payment.',
    );
  });

  it('derives overall_status="needs_review" when a must-check control is skipped', () => {
    const results: ControlResult[] = [
      { status: 'passed', controlId: 'A', evidenceRefs: [] },
      {
        status: 'skipped',
        controlId: 'B',
        reason: 'missing_document',
        missingEvidence: ['vendor_master'],
      },
    ];
    const report = buildProofReport({
      product: 'invoiceproof',
      results,
      confidenceInputs: { mustCheckIds: new Set(['B']) },
    });
    expect(report.overall_status).toBe('needs_review');
    expect(report.missing_evidence).toContain('vendor_master');
  });
});
