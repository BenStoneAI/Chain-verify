// AuditProof: evidence provenance, staleness and coverage (Phase 5, T5-auditproof).
//
// These tests assert business behaviour of the three AgentGate-derived concepts
// that live in proof-core (signing is covered in the API package):
//   1. provenance stamping, summary and the self-reported-evidence confidence cap
//   2. evidence fingerprint / as-of / stale-after and CURRENT vs STALE evaluation
//   3. per-control coverage with a reason for every skipped / unable-to-run control

import { describe, it, expect } from 'vitest';

import {
  ingestEvidence,
  normaliseProvenance,
  type EvidenceInput,
} from '../src/ingestion/evidence-input.js';
import { buildEvidenceInputsFromPayloads } from '../src/ingestion/evidence-splitter.js';
import { runAuditProof } from '../src/registries/auditproof-controls.js';
import { runProofProduct } from '../src/proof-kernel/run-proof-product.js';
import { buildControlCoverage } from '../src/proof-kernel/coverage.js';
import {
  PROVENANCE_CONFIDENCE_CAP,
  applyConfidenceCap,
} from '../src/proof-kernel/provenance.js';
import {
  DEFAULT_EVIDENCE_MAX_AGE_DAYS,
  computeEvidenceFingerprint,
  evaluateAuditFreshness,
  resolveEvidenceMaxAgeDays,
} from '../src/proof-kernel/freshness.js';
import type { ControlResult, ProofFinding } from '../src/proof-kernel/types.js';

// ---------------------------------------------------------------------------
// Fixtures: a clean AuditProof bundle that passes every critical control.
// ---------------------------------------------------------------------------

type Prov = EvidenceInput['provenance'];

function policy(provenance?: Prov, observedAt?: string): EvidenceInput {
  return {
    sourceProduct: 'auditproof',
    filename: 'policy.txt',
    text:
      'Accounts Payable Policy. Last reviewed: 2026-09-01. Next review due: 2027-09-01. ' +
      'New vendor onboarding approval is required. A vendor bank account change requires ' +
      'call-back verification before payment.',
    provenance,
    observedAt,
  };
}

function approvalMatrix(provenance?: Prov, observedAt?: string): EvidenceInput {
  return {
    sourceProduct: 'auditproof',
    filename: 'approval_matrix.json',
    json: {
      approval_matrix: [
        { role: 'CFO', signed: true, approverName: 'Jane Doe' },
        { role: 'Controller', signed: true, approverName: 'John Roe' },
      ],
    },
    provenance,
    observedAt,
  };
}

function riskRegister(provenance?: Prov, observedAt?: string): EvidenceInput {
  return {
    sourceProduct: 'auditproof',
    filename: 'risk_register.json',
    json: {
      risk_register: [
        {
          id: 'R1',
          description: 'Vendor fraud',
          impact: 'low',
          likelihood: 'low',
          owner: 'Ops',
          status: 'open',
        },
      ],
    },
    provenance,
    observedAt,
  };
}

function exceptionLog(provenance?: Prov, observedAt?: string): EvidenceInput {
  return {
    sourceProduct: 'auditproof',
    filename: 'exception_log.json',
    json: {
      exception_log: [{ id: 'E1', description: 'Late approval', status: 'closed', owner: 'Ops' }],
    },
    provenance,
    observedAt,
  };
}

function bundle(p?: Prov, observedAt?: string): EvidenceInput[] {
  return [policy(p, observedAt), approvalMatrix(p, observedAt), riskRegister(p, observedAt), exceptionLog(p, observedAt)];
}

const FIXED_NOW = new Date('2026-10-14T12:00:00.000Z');

async function run(inputs: EvidenceInput[], extra: { now?: Date; maxAgeDays?: number } = {}) {
  return runProofProduct({
    product: 'auditproof',
    evidenceInputs: inputs,
    now: FIXED_NOW,
    maxAgeDays: 30,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Provenance normalisation
// ---------------------------------------------------------------------------

describe('normaliseProvenance', () => {
  it('defaults to customer_submitted and never upgrades unknown input', () => {
    expect(normaliseProvenance(undefined)).toBe('customer_submitted');
    expect(normaliseProvenance(null)).toBe('customer_submitted');
    expect(normaliseProvenance('')).toBe('customer_submitted');
    expect(normaliseProvenance('verified')).toBe('customer_submitted');
    expect(normaliseProvenance('HUMAN_APPROVED_BY_ADMIN')).toBe('customer_submitted');
    expect(normaliseProvenance({ x: 1 })).toBe('customer_submitted');
    expect(normaliseProvenance(7)).toBe('customer_submitted');
  });

  it('accepts exactly the five known classes', () => {
    for (const p of [
      'customer_submitted',
      'independently_observed',
      'externally_verified',
      'derived',
      'human_approved',
    ]) {
      expect(normaliseProvenance(p)).toBe(p);
    }
  });

  it('ingestEvidence stamps the normalised provenance on the classified item', () => {
    expect(ingestEvidence({ ...policy('externally_verified') }).provenance).toBe('externally_verified');
    expect(ingestEvidence({ ...policy('made-up') }).provenance).toBe('customer_submitted');
    expect(ingestEvidence({ ...policy() }).provenance).toBe('customer_submitted');
  });
});

// ---------------------------------------------------------------------------
// Provenance in the report, and the confidence cap
// ---------------------------------------------------------------------------

describe('customer-submitted evidence only', () => {
  it('counts every item as customer_submitted and caps confidence with a plain-English reason', async () => {
    const report = await run(bundle());
    expect(report.provenance_summary).toEqual({
      customer_submitted: 4,
      derived: 0,
      independently_observed: 0,
      externally_verified: 0,
      human_approved: 0,
    });
    expect(report.controls.failed).toEqual([]);
    expect(report.confidence_cap).toBe(PROVENANCE_CONFIDENCE_CAP);
    expect(report.confidence).toBeLessThanOrEqual(PROVENANCE_CONFIDENCE_CAP);
    expect(report.confidence_cap_reason).toMatch(/customer-submitted/i);
    expect(report.confidence_cap_reason).toContain('70%');
    // Names the critical controls that only had self-reported support.
    expect(report.confidence_cap_reason).toContain('AP-C1');
    expect(report.confidence_cap_reason).toContain('AP-C5');
  });

  it('carries provenance onto every EvidenceRef of every finding and result', async () => {
    // Introduce a failure so findings carry refs: CFO has not signed.
    const failing = approvalMatrix();
    failing.json = {
      approval_matrix: [{ role: 'CFO', signed: false, approverName: 'Jane Doe' }],
    };
    const report = await run([policy(), failing, riskRegister(), exceptionLog()]);
    const ap1 = report.findings.find((f) => f.controlId === 'AP-C1');
    expect(ap1).toBeDefined();
    expect(ap1!.evidenceRefs.length).toBeGreaterThan(0);
    for (const ref of ap1!.evidenceRefs) expect(ref.provenance).toBe('customer_submitted');
  });

  it('an unrecognised provenance string is treated as customer_submitted (still capped)', async () => {
    const report = await run(bundle('trusted_by_admin'));
    expect(report.provenance_summary.customer_submitted).toBe(4);
    expect(report.confidence_cap).toBe(PROVENANCE_CONFIDENCE_CAP);
  });
});

describe('independently observed evidence', () => {
  it('has no cap, no reason, and shows provenance in the summary and refs', async () => {
    const report = await run(bundle('independently_observed'));
    expect(report.provenance_summary.independently_observed).toBe(4);
    expect(report.provenance_summary.customer_submitted).toBe(0);
    expect(report.confidence_cap).toBeNull();
    expect(report.confidence_cap_reason).toBeNull();
    expect(report.confidence).toBe(1);
    expect(report.coverage.passed).toBe(11);
  });

  it('every control result passes and its refs are stamped independently_observed', async () => {
    // Re-run through the kernel to read stamped refs on passed results via findings of a failing bundle.
    const failing = approvalMatrix('independently_observed');
    failing.json = { approval_matrix: [{ role: 'CFO', signed: false, approverName: 'Jane Doe' }] };
    const report = await run([
      policy('independently_observed'),
      failing,
      riskRegister('independently_observed'),
      exceptionLog('independently_observed'),
    ]);
    const ap1 = report.findings.find((f) => f.controlId === 'AP-C1')!;
    for (const ref of ap1.evidenceRefs) expect(ref.provenance).toBe('independently_observed');
  });
});

describe('mixed provenance', () => {
  it('caps only because the self-reported controls are critical, and names them', async () => {
    // Policy + approval matrix independently observed; risk + exception log self-reported.
    const report = await run([
      policy('externally_verified'),
      approvalMatrix('independently_observed'),
      riskRegister(),
      exceptionLog(),
    ]);
    expect(report.provenance_summary).toMatchObject({
      externally_verified: 1,
      independently_observed: 1,
      customer_submitted: 2,
    });
    expect(report.confidence_cap).toBe(PROVENANCE_CONFIDENCE_CAP);
    const reason = report.confidence_cap_reason!;
    expect(reason).toContain('AP-C5'); // unowned high risk: risk register, self-reported
    expect(reason).toContain('AP-C8'); // open exception: exception log, self-reported
    expect(reason).not.toMatch(/AP-C1(?![0-9])/); // approval matrix independently observed (AP-C11 is a different control)
    expect(reason).not.toContain('AP-C3'); // policy externally verified
  });

  it('no cap once every critical control has independent support', async () => {
    const report = await run([
      policy('human_approved'),
      approvalMatrix('independently_observed'),
      riskRegister('externally_verified'),
      exceptionLog('derived'),
    ]);
    expect(report.confidence_cap).toBeNull();
    expect(report.confidence).toBe(1);
  });
});

describe('provenance can never raise confidence', () => {
  it('independent provenance equals the deterministic ceiling and never exceeds it', async () => {
    const ceiling = runAuditProof(bundle().map(ingestEvidence)).confidence.confidence;
    for (const p of ['independently_observed', 'externally_verified', 'human_approved', 'derived'] as const) {
      const r = await run(bundle(p));
      expect(r.confidence).toBeLessThanOrEqual(ceiling);
    }
  });

  it('self-reported evidence never scores higher than independent evidence', async () => {
    const self = await run(bundle());
    const indep = await run(bundle('independently_observed'));
    expect(self.confidence).toBeLessThanOrEqual(indep.confidence);
  });

  it('with failures present, provenance leaves confidence unchanged (no uplift for observed)', async () => {
    const weak = (p?: Prov) => {
      const risk = riskRegister(p);
      risk.json = {
        risk_register: [{ id: 'R9', description: 'Unowned', impact: 'critical', likelihood: 'high' }],
      };
      return [policy(p), approvalMatrix(p), risk, exceptionLog(p)];
    };
    const self = await run(weak());
    const indep = await run(weak('independently_observed'));
    expect(self.controls.failed).toContain('AP-C5');
    expect(indep.confidence).toBe(self.confidence);
  });

  it('applyConfidenceCap only ever lowers', () => {
    expect(applyConfidenceCap(0.95, 0.7)).toBe(0.7);
    expect(applyConfidenceCap(0.4, 0.7)).toBe(0.4);
    expect(applyConfidenceCap(0.95, null)).toBe(0.95);
  });

  it('does not touch other products (cap is AuditProof-only)', async () => {
    const report = await runProofProduct({
      product: 'invoiceproof',
      evidenceInputs: [
        {
          sourceProduct: 'invoiceproof',
          filename: 'invoices.json',
          json: [{ invoice_number: 'INV-1', vendor: 'Acme', amount: '10.00' }],
        },
      ],
      now: FIXED_NOW,
    });
    expect(report.confidence_cap).toBeNull();
    expect(report.confidence_cap_reason).toBeNull();
  });
});

describe('splitter propagates provenance', () => {
  it('stamps every derived input with the supplied provenance, defaulting to none', () => {
    const withProv = buildEvidenceInputsFromPayloads({
      output: { policies: [{ title: 'P', text: 'x' }], risks: [{ id: 'R1', description: 'd' }] },
      sourceProduct: 'auditproof',
      provenance: 'independently_observed',
    });
    expect(withProv.length).toBeGreaterThan(1);
    for (const i of withProv) expect(i.provenance).toBe('independently_observed');

    const without = buildEvidenceInputsFromPayloads({
      output: { policies: [{ title: 'P', text: 'x' }] },
      sourceProduct: 'auditproof',
    });
    for (const i of without) expect(i.provenance).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

describe('evidence fingerprint', () => {
  const docs = (inputs: EvidenceInput[]) => inputs.map(ingestEvidence);

  it('is a deterministic sha256 and independent of submission order', () => {
    const a = computeEvidenceFingerprint(docs(bundle()));
    const b = computeEvidenceFingerprint(docs([...bundle()].reverse()));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(computeEvidenceFingerprint(docs(bundle()))).toBe(a);
  });

  it('changes when the evidence content changes', () => {
    const changed = bundle();
    changed[2].json = {
      risk_register: [{ id: 'R1', description: 'Vendor fraud', impact: 'high', likelihood: 'high', owner: 'Ops' }],
    };
    expect(computeEvidenceFingerprint(docs(changed))).not.toBe(computeEvidenceFingerprint(docs(bundle())));
  });

  it('changes when provenance changes (trust is part of what was proven)', () => {
    expect(computeEvidenceFingerprint(docs(bundle('independently_observed')))).not.toBe(
      computeEvidenceFingerprint(docs(bundle())),
    );
  });

  it('ignores filenames (labels, not content)', () => {
    const renamed = bundle().map((i, n) => ({ ...i, filename: `renamed-${n}.dat` }));
    expect(computeEvidenceFingerprint(docs(renamed))).toBe(computeEvidenceFingerprint(docs(bundle())));
  });

  it('is surfaced on the report', async () => {
    const report = await run(bundle());
    expect(report.evidence_fingerprint).toBe(computeEvidenceFingerprint(docs(bundle())));
  });
});

describe('evidence_as_of and stale_after', () => {
  it('uses the verification time when no evidence timestamp is supplied', async () => {
    const report = await run(bundle());
    expect(report.evidence_as_of).toBe(FIXED_NOW.toISOString());
    expect(report.evidence_max_age_days).toBe(30);
    expect(report.stale_after).toBe('2026-11-13T12:00:00.000Z');
  });

  it('uses the latest supplied evidence timestamp', async () => {
    const inputs = [
      policy(undefined, '2026-08-01T00:00:00Z'),
      approvalMatrix(undefined, '2026-09-20T00:00:00Z'),
      riskRegister(),
      exceptionLog(undefined, '2026-09-01T00:00:00Z'),
    ];
    const report = await run(inputs);
    expect(report.evidence_as_of).toBe('2026-09-20T00:00:00.000Z');
    expect(report.stale_after).toBe('2026-10-20T00:00:00.000Z');
  });

  it('clamps a future-dated timestamp to the verification time', async () => {
    const report = await run([policy(undefined, '2030-01-01T00:00:00Z'), approvalMatrix()]);
    expect(report.evidence_as_of).toBe(FIXED_NOW.toISOString());
  });

  it('ignores an unreadable timestamp', async () => {
    const report = await run([policy(undefined, 'not-a-date'), approvalMatrix()]);
    expect(report.evidence_as_of).toBe(FIXED_NOW.toISOString());
  });

  it('honours AUDIT_PROOF_EVIDENCE_MAX_AGE_DAYS and falls back safely when invalid', () => {
    expect(resolveEvidenceMaxAgeDays({})).toBe(DEFAULT_EVIDENCE_MAX_AGE_DAYS);
    expect(resolveEvidenceMaxAgeDays({ AUDIT_PROOF_EVIDENCE_MAX_AGE_DAYS: '7' })).toBe(7);
    expect(resolveEvidenceMaxAgeDays({ AUDIT_PROOF_EVIDENCE_MAX_AGE_DAYS: '0' })).toBe(30);
    expect(resolveEvidenceMaxAgeDays({ AUDIT_PROOF_EVIDENCE_MAX_AGE_DAYS: '-5' })).toBe(30);
    expect(resolveEvidenceMaxAgeDays({ AUDIT_PROOF_EVIDENCE_MAX_AGE_DAYS: 'soon' })).toBe(30);
  });
});

describe('evaluateAuditFreshness', () => {
  const stored = {
    evidenceFingerprint: 'a'.repeat(64),
    staleAfter: new Date('2026-11-13T12:00:00.000Z'),
  };

  it('is CURRENT with a matching fingerprint inside the window', () => {
    const r = evaluateAuditFreshness({ stored, currentFingerprint: 'a'.repeat(64), now: FIXED_NOW });
    expect(r.state).toBe('CURRENT');
    expect(r.reasons).toEqual([]);
  });

  it('is CURRENT inside the window when no current fingerprint is supplied', () => {
    expect(evaluateAuditFreshness({ stored, now: FIXED_NOW }).state).toBe('CURRENT');
  });

  it('is STALE when the fingerprint changed', () => {
    const r = evaluateAuditFreshness({ stored, currentFingerprint: 'b'.repeat(64), now: FIXED_NOW });
    expect(r.state).toBe('STALE');
    expect(r.reason_codes).toContain('fingerprint_changed');
    expect(r.reasons.join(' ')).toMatch(/evidence has changed/i);
  });

  it('is STALE once the age window has expired, and CURRENT exactly at the deadline', () => {
    const after = new Date('2026-11-13T12:00:00.001Z');
    const r = evaluateAuditFreshness({ stored, currentFingerprint: 'a'.repeat(64), now: after });
    expect(r.state).toBe('STALE');
    expect(r.reason_codes).toEqual(['age_expired']);
    expect(evaluateAuditFreshness({ stored, now: stored.staleAfter }).state).toBe('CURRENT');
  });

  it('reports both reasons when changed AND expired', () => {
    const r = evaluateAuditFreshness({
      stored,
      currentFingerprint: 'c'.repeat(64),
      now: new Date('2027-01-01T00:00:00Z'),
    });
    expect(r.reason_codes.sort()).toEqual(['age_expired', 'fingerprint_changed']);
  });

  it('refuses to call a legacy record with no binding CURRENT', () => {
    const r = evaluateAuditFreshness({ stored: {}, now: FIXED_NOW });
    expect(r.state).toBe('STALE');
    expect(r.reason_codes).toEqual(['no_freshness_binding']);
  });

  it('treats an unreadable stale_after as STALE', () => {
    const r = evaluateAuditFreshness({
      stored: { evidenceFingerprint: 'a', staleAfter: 'garbage' },
      now: FIXED_NOW,
    });
    expect(r.state).toBe('STALE');
    expect(r.reason_codes).toContain('unreadable_stale_after');
  });

  it('a report round-trips: fresh proof is CURRENT, then STALE after 31 days', async () => {
    const report = await run(bundle());
    const s = { evidenceFingerprint: report.evidence_fingerprint, staleAfter: report.stale_after };
    expect(
      evaluateAuditFreshness({ stored: s, currentFingerprint: report.evidence_fingerprint, now: FIXED_NOW }).state,
    ).toBe('CURRENT');
    const later = new Date(FIXED_NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(evaluateAuditFreshness({ stored: s, now: later }).state).toBe('STALE');
  });
});

// ---------------------------------------------------------------------------
// Coverage summary
// ---------------------------------------------------------------------------

describe('coverage summary', () => {
  it('accounts for every expected control and keeps coverage_summary intact', async () => {
    const report = await run(bundle());
    const c = report.coverage;
    expect(c.controls_expected).toBe(11);
    expect(c.details).toHaveLength(11);
    expect(c.passed + c.failed + c.warned + c.skipped + c.unable_to_run).toBe(c.controls_expected);
    expect(c.controls_executed).toBe(c.passed + c.failed + c.warned);
    // Backward-compatible kernel summary is unchanged in shape and agrees.
    expect(report.coverage_summary).toEqual({
      total_controls: 11,
      checked: c.controls_executed,
      passed: c.passed,
      failed: c.failed,
      skipped: c.skipped,
    });
  });

  it('gives a missing-evidence reason for every skipped control', async () => {
    // Only a policy: everything keyed on approval_matrix / risk_register / exception_log is skipped.
    const report = await run([policy()]);
    const c = report.coverage;
    expect(c.skipped).toBeGreaterThan(0);
    const ap5 = c.details.find((d) => d.control_id === 'AP-C5')!;
    expect(ap5.outcome).toBe('skipped');
    expect(ap5.reason).toMatch(/not run/i);
    expect(ap5.reason).toContain('risk_register');
    for (const d of c.details.filter((x) => x.outcome === 'skipped')) {
      expect(d.reason.length).toBeGreaterThan(10);
    }
    expect(report.controls.skipped).toContain('AP-C5');
  });

  it('reports a present-but-uninterpretable control as unable_to_run with its reason', () => {
    const results: ControlResult[] = [
      { status: 'passed', controlId: 'X-1', evidenceRefs: [] },
      {
        status: 'skipped',
        controlId: 'X-2',
        reason: 'uninterpretable',
        missingEvidence: ['amount field'],
      },
      { status: 'skipped', controlId: 'X-3', reason: 'missing_document', missingEvidence: ['vendor_master'] },
    ];
    const cov = buildControlCoverage({ results, expectedControlIds: ['X-1', 'X-2', 'X-3', 'X-4'] });
    const byId = Object.fromEntries(cov.details.map((d) => [d.control_id, d]));
    expect(byId['X-2'].outcome).toBe('unable_to_run');
    expect(byId['X-2'].reason).toContain('could not be interpreted');
    expect(byId['X-2'].reason).toContain('amount field');
    expect(byId['X-3'].outcome).toBe('skipped');
    // Expected but produced no result at all: also unable to run, never silently dropped.
    expect(byId['X-4'].outcome).toBe('unable_to_run');
    expect(byId['X-4'].reason).toMatch(/no result/i);
    expect(cov).toMatchObject({
      controls_expected: 4,
      controls_executed: 1,
      passed: 1,
      skipped: 1,
      unable_to_run: 2,
    });
  });

  it('counts a passed control with a warning finding as warned, not passed', () => {
    const results: ControlResult[] = [
      { status: 'passed', controlId: 'X-1', evidenceRefs: [] },
      { status: 'passed', controlId: 'X-2', evidenceRefs: [] },
    ];
    const findings: ProofFinding[] = [
      {
        id: 'w1',
        controlId: 'X-2',
        severity: 'low',
        status: 'warning',
        message: 'm',
        evidenceRefs: [],
        recommendedAction: 'a',
      },
    ];
    const cov = buildControlCoverage({ results, findings });
    expect(cov.warned).toBe(1);
    expect(cov.passed).toBe(1);
    expect(cov.controls_executed).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Existing behaviour is not disturbed
// ---------------------------------------------------------------------------

describe('AP-C1..C11 verdicts are unchanged by provenance', () => {
  it('produces identical per-control statuses with and without provenance', async () => {
    const plain = await run(bundle());
    const observed = await run(bundle('independently_observed'));
    expect(observed.controls).toEqual(plain.controls);
    expect(observed.overall_status).toBe(plain.overall_status);
    expect(plain.coverage.details.map((d) => [d.control_id, d.outcome])).toEqual(
      observed.coverage.details.map((d) => [d.control_id, d.outcome]),
    );
  });
});
