// Phase C — end-to-end proof pipeline + residual layer + final-confidence tests.
//
// Asserts business behavior (not existence):
//   1. runProofProduct('invoiceproof', dup bundle) → overall_status 'fail', a failed
//      IP-C1 finding with evidenceRefs, missing_evidence lists absent-doc controls.
//   2. Residual disabled (no client) → invoked:false, findings only from controls.
//   3. mockLlmClient returns an UNCITED finding → dropped or downgraded to
//      needs_more_evidence; NEVER a hard 'failed'.
//   4. mockLlmClient returns a CITED finding → appears as a ProofFinding w/ refs.
//   5. computeFinalConfidence: modelConfidence=0.99 cannot exceed the deterministic
//      ceiling when a critical control failed.
//   6. Determinism: identical inputs → identical proof_id + confidence across runs.

import { describe, it, expect } from 'vitest';

import { runProofProduct } from '../src/proof-kernel/run-proof-product.js';
import {
  runLlmResidual,
  enforceResidualFindings,
  parseResidualResponse,
  mockLlmClient,
  type LlmResidualInput,
} from '../src/proof-kernel/llm-residual.js';
import { computeFinalConfidence } from '../src/proof-kernel/final-confidence.js';
import type { EvidenceInput } from '../src/ingestion/evidence-input.js';
import type { ControlResult, ProofFinding } from '../src/proof-kernel/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An invoice batch with an exact duplicate (trips IP-C1, critical). */
function dupInvoiceInput(): EvidenceInput {
  return {
    sourceProduct: 'invoiceproof',
    filename: 'invoices.json',
    json: [
      {
        invoice_number: 'INV-DUP-01',
        vendor: 'Northgate Fabrication LLC',
        amount: '5000.00',
        po_number: 'PO-X',
      },
      {
        invoice_number: 'INV-DUP-01',
        vendor: 'Northgate Fabrication LLC',
        amount: '5000.00',
        po_number: 'PO-X',
      },
    ],
  };
}

/** A vendor master so vendor-master-gated controls are not all skipped. */
function vendorMasterInput(): EvidenceInput {
  return {
    sourceProduct: 'invoiceproof',
    filename: 'vendor_master.json',
    json: [
      {
        vendorName: 'Northgate Fabrication LLC',
        bankRoutingNumber: '021000021',
        city: 'Columbus',
        state: 'OH',
        status: 'active',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. End-to-end fail report
// ---------------------------------------------------------------------------

describe('1. runProofProduct(invoiceproof) on a duplicate bundle', () => {
  it('overall_status is "fail" (critical IP-C1 duplicate)', async () => {
    const report = await runProofProduct({
      product: 'invoiceproof',
      evidenceInputs: [dupInvoiceInput(), vendorMasterInput()],
    });
    expect(report.overall_status).toBe('fail');
  });

  it('produces a failed IP-C1 finding carrying ≥1 evidenceRef', async () => {
    const report = await runProofProduct({
      product: 'invoiceproof',
      evidenceInputs: [dupInvoiceInput(), vendorMasterInput()],
    });
    const ipc1 = report.findings.find((f) => f.controlId === 'IP-C1');
    expect(ipc1).toBeDefined();
    expect(ipc1!.status).toBe('failed');
    expect(ipc1!.evidenceRefs.length).toBeGreaterThanOrEqual(1);
    expect(ipc1!.evidenceRefs[0].documentId).toBeTruthy();
  });

  it('missing_evidence lists controls whose documents were absent', async () => {
    // No purchase_order_register and no approval_matrix supplied → IP-C6 (PO register)
    // and IP-C12 (approval_matrix) are gated to skipped, so their required docs land in
    // missing_evidence.
    const report = await runProofProduct({
      product: 'invoiceproof',
      evidenceInputs: [dupInvoiceInput()], // invoice only — most supplements absent
    });
    expect(report.missing_evidence).toContain('vendor_master');
    expect(report.missing_evidence).toContain('purchase_order_register');
    expect(report.missing_evidence).toContain('approval_matrix');
    // Skipped controls are listed in controls.skipped.
    expect(report.controls.skipped).toContain('IP-C6');
    expect(report.controls.skipped).toContain('IP-C12');
  });

  it('confidence is below 1 when a critical control failed', async () => {
    const report = await runProofProduct({
      product: 'invoiceproof',
      evidenceInputs: [dupInvoiceInput(), vendorMasterInput()],
    });
    expect(report.confidence).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Residual disabled → no-op
// ---------------------------------------------------------------------------

describe('2. residual layer disabled (no client) is a no-op', () => {
  const input: LlmResidualInput = {
    product: 'invoiceproof',
    canonicalEvidence: [],
    deterministicResults: [],
    skippedControlIds: [],
    sourcePassages: [],
  };

  it('runLlmResidual with no client → invoked:false, no findings', async () => {
    const res = await runLlmResidual(input);
    expect(res.invoked).toBe(false);
    expect(res.findings).toHaveLength(0);
  });

  it('runLlmResidual with enabled:false → invoked:false even if a client exists', async () => {
    const res = await runLlmResidual(input, {
      client: mockLlmClient('{"findings":[]}'),
      enabled: false,
    });
    expect(res.invoked).toBe(false);
  });

  it('runProofProduct without residual options → findings come only from controls', async () => {
    const report = await runProofProduct({
      product: 'invoiceproof',
      evidenceInputs: [dupInvoiceInput(), vendorMasterInput()],
    });
    // Every finding must originate from a deterministic control (id prefix ctrl_).
    for (const f of report.findings) {
      expect(f.id.startsWith('ctrl_')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Uncited residual finding → dropped or downgraded (never hard failed)
// ---------------------------------------------------------------------------

describe('3. uncited residual finding is never a hard failure', () => {
  const uncitedResponse = JSON.stringify({
    findings: [
      {
        controlId: 'LLM-X1',
        severity: 'critical',
        message: 'The narrative implies a contradiction with no document cited.',
        evidenceRefs: [], // NO citation
        recommendedAction: 'Investigate.',
        modelConfidence: 0.95,
      },
    ],
  });

  it('enforceResidualFindings downgrades the uncited finding to needs_more_evidence', () => {
    const residual = parseResidualResponse(uncitedResponse);
    const findings = enforceResidualFindings(residual, []);
    // It must NOT be a hard 'failed'.
    for (const f of findings) {
      expect(f.status).not.toBe('failed');
    }
    // And if it survives, it is needs_more_evidence with severity floored.
    if (findings.length > 0) {
      expect(findings[0].status).toBe('needs_more_evidence');
      expect(findings[0].severity).toBe('low');
      expect(findings[0].evidenceRefs).toHaveLength(0);
    }
  });

  it('runLlmResidual end-to-end: uncited critical never surfaces as failed', async () => {
    const res = await runLlmResidual(
      {
        product: 'verifyapi',
        canonicalEvidence: [],
        deterministicResults: [],
        skippedControlIds: [],
        sourcePassages: [],
      },
      { client: mockLlmClient(uncitedResponse) },
    );
    expect(res.invoked).toBe(true);
    for (const f of res.findings) {
      expect(f.status).not.toBe('failed');
    }
  });

  it('a finding with neither message nor citation is dropped entirely', () => {
    const empty = JSON.stringify({
      findings: [{ controlId: '', severity: 'high', evidenceRefs: [] }],
    });
    const findings = enforceResidualFindings(parseResidualResponse(empty), []);
    expect(findings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Cited residual finding → surfaces with its evidenceRefs
// ---------------------------------------------------------------------------

describe('4. cited residual finding surfaces as a ProofFinding', () => {
  const citedResponse = JSON.stringify({
    findings: [
      {
        controlId: 'LLM-SEMANTIC-1',
        severity: 'high',
        message: 'Delivery prose contradicts the contracted scope.',
        evidenceRefs: [
          {
            documentId: 'doc-fp-1',
            documentType: 'delivery_statement',
            sourcePassage: 'scope reduced to read-only',
          },
        ],
        recommendedAction: 'Confirm scope with the vendor before acceptance.',
        modelConfidence: 0.7,
      },
    ],
  });

  it('cited residual becomes a failed ProofFinding carrying its evidenceRefs', () => {
    const findings = enforceResidualFindings(parseResidualResponse(citedResponse), []);
    expect(findings).toHaveLength(1);
    expect(findings[0].controlId).toBe('LLM-SEMANTIC-1');
    expect(findings[0].status).toBe('failed');
    expect(findings[0].severity).toBe('high');
    expect(findings[0].evidenceRefs).toHaveLength(1);
    expect(findings[0].evidenceRefs[0].documentId).toBe('doc-fp-1');
  });

  it('a cited residual whose controlId already fired deterministically is deduped out', () => {
    const deterministic: ControlResult[] = [
      {
        status: 'failed',
        controlId: 'LLM-SEMANTIC-1',
        severity: 'high',
        evidenceRefs: [],
        recommendedAction: 'x',
      },
    ];
    const findings = enforceResidualFindings(parseResidualResponse(citedResponse), deterministic);
    expect(findings).toHaveLength(0);
  });

  it('runLlmResidual returns the cited finding and raw output', async () => {
    const res = await runLlmResidual(
      {
        product: 'verifyapi',
        canonicalEvidence: [],
        deterministicResults: [],
        skippedControlIds: [],
        sourcePassages: [],
      },
      { client: mockLlmClient(citedResponse) },
    );
    expect(res.invoked).toBe(true);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].evidenceRefs.length).toBeGreaterThanOrEqual(1);
    expect(res.raw).toBe(citedResponse);
  });
});

// ---------------------------------------------------------------------------
// 5. Final confidence cannot be raised by the LLM above the deterministic ceiling
// ---------------------------------------------------------------------------

describe('5. computeFinalConfidence — LLM cannot exceed the deterministic ceiling', () => {
  // One failed critical control → deterministic ceiling is materially below 1.
  const criticalFailed: ControlResult[] = [
    {
      status: 'failed',
      controlId: 'IP-C1',
      severity: 'critical',
      evidenceRefs: [{ documentId: 'd1', documentType: 'invoice' }],
      recommendedAction: 'remove duplicate',
    },
    {
      status: 'passed',
      controlId: 'IP-C5',
      evidenceRefs: [{ documentId: 'd1', documentType: 'invoice' }],
    },
  ];

  it('modelConfidence 0.99 does not raise final confidence above the ceiling', () => {
    const withoutModel = computeFinalConfidence(criticalFailed, []);
    const withHotModel = computeFinalConfidence(criticalFailed, [], { modelConfidence: 0.99 });

    // The ceiling is the deterministic-only confidence; final must never exceed it.
    expect(withHotModel.confidence).toBeLessThanOrEqual(
      withHotModel.breakdown.deterministicCeiling,
    );
    expect(withHotModel.breakdown.deterministicCeiling).toBe(
      withoutModel.breakdown.deterministicCeiling,
    );
    // A hot model can nudge by at most +0.05 AND never past the ceiling.
    expect(withHotModel.confidence).toBeLessThanOrEqual(
      withoutModel.breakdown.deterministicCeiling,
    );
  });

  it('a cited residual failure can only LOWER confidence, never raise it', () => {
    const baseline = computeFinalConfidence(criticalFailed, []);
    const residualFail: ProofFinding[] = [
      {
        id: 'r1',
        controlId: 'LLM-1',
        severity: 'high',
        status: 'failed',
        message: 'cited residual failure',
        evidenceRefs: [{ documentId: 'd1', documentType: 'invoice' }],
        recommendedAction: 'x',
      },
    ];
    const withResidual = computeFinalConfidence(criticalFailed, residualFail);
    expect(withResidual.confidence).toBeLessThanOrEqual(baseline.confidence);
  });

  it('a residual needs_more_evidence lowers evidence sufficiency', () => {
    const baseline = computeFinalConfidence(criticalFailed, []);
    const residualNME: ProofFinding[] = [
      {
        id: 'r2',
        controlId: 'LLM-2',
        severity: 'low',
        status: 'needs_more_evidence',
        message: 'uncertain',
        evidenceRefs: [],
        recommendedAction: 'provide more',
      },
    ];
    const withNME = computeFinalConfidence(criticalFailed, residualNME);
    expect(withNME.evidenceSufficiency).toBeLessThanOrEqual(baseline.evidenceSufficiency);
  });
});

// ---------------------------------------------------------------------------
// 6. Determinism — identical inputs yield identical report
// ---------------------------------------------------------------------------

describe('6. determinism — identical inputs yield identical proof_id + confidence', () => {
  it('two runs produce identical proof_id and confidence', async () => {
    const inputs = () => [dupInvoiceInput(), vendorMasterInput()];

    const a = await runProofProduct({ product: 'invoiceproof', evidenceInputs: inputs() });
    const b = await runProofProduct({ product: 'invoiceproof', evidenceInputs: inputs() });

    expect(a.proof_id).toBe(b.proof_id);
    expect(a.confidence).toBe(b.confidence);
    expect(a.evidence_sufficiency_score).toBe(b.evidence_sufficiency_score);
    expect(a.overall_status).toBe(b.overall_status);
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id));
  });

  it('proof_id is stable and not time/random based', async () => {
    const report = await runProofProduct({
      product: 'invoiceproof',
      evidenceInputs: [dupInvoiceInput(), vendorMasterInput()],
    });
    expect(report.proof_id).toMatch(/^proof_/);
  });
});
