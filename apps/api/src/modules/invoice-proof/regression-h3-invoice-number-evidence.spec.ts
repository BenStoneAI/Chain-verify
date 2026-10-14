/**
 * Regression: H3 — VRF-T001 clean invoice falsely failed with evidence
 *
 * Root cause: the old invoiceRe regex in expectedFromEvidence() matched any
 * "invoice:" record-pointer string (e.g. "invoice:INV-T001"), extracting the
 * record ID as though it were an expected invoice number, then comparing it
 * against the extraction output and raising a false contradiction.
 *
 * Fix: The regex was tightened to require an explicit "expected invoice ..." or
 * "invoice_number: ..." prefix before extracting a value. A bare "invoice:INV-T001"
 * reference string must return undefined, not "INV-T001".
 *
 * FAILURE CONDITION: If the regex is reverted to the old broad pattern, the input
 * "invoice:INV-T001" will again produce "INV-T001" and this test will fail.
 *
 * All assertions use verifyApiRuleTestHooks so they run entirely in-process.
 */

import 'reflect-metadata';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@chain-verify/config', () => ({
  verifyApiPlanConfigs: [
    { slug: 'free', monthlyRuns: 10, overageCents: null, retentionDays: 7 },
  ],
}));

import { verifyApiRuleTestHooks as _hooks } from '../verification/verify-api.controller.js';

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const hooks = _hooks!;

// evaluateEvidenceConsistency is the public-facing function that calls expectedFromEvidence
// internally; we use it as the observable surface for the regression because
// expectedFromEvidence itself is not exported from the test hooks.
describe('Regression H3: bare evidence record pointer does not extract invoice number', () => {
  it('returns no issues when evidence is only a record pointer "invoice:INV-T001"', () => {
    // VRF-T001 shape: evidence is a record reference, not an expected-value hint.
    // Before the fix, expectedFromEvidence() would extract "INV-T001" from this string
    // and compare it to the output's invoice_number, causing a false contradiction.
    const issues = hooks.evaluateEvidenceConsistency(
      { invoice_number: 'INV-T001', vendor_name: 'Harper Lane Inc', amount_total: 4500 },
      ['invoice:INV-T001', 'po:PO-38001'],
    );

    // No evidence_invoice_number_mismatch should fire — the pointer is not an expected value.
    const invoiceMismatch = issues.filter((i) => i.rule === 'evidence_invoice_number_mismatch');
    expect(invoiceMismatch).toHaveLength(0);
  });

  it('still extracts invoice number when evidence explicitly states "expected invoice SMG-9000"', () => {
    // Confirm the fix did not accidentally break legitimate invoice-number extraction.
    const issues = hooks.evaluateEvidenceConsistency(
      { invoice_number: 'INV-WRONG', vendor_name: 'Acme' },
      ['expected invoice SMG-9000'],
    );
    const mismatch = issues.find((i) => i.rule === 'evidence_invoice_number_mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe('critical');
  });

  it('extracts invoice number when evidence uses "invoice_number: SMG-9000" key=value format', () => {
    const issues = hooks.evaluateEvidenceConsistency(
      { invoice_number: 'DIFFERENT-999' },
      ['invoice_number: SMG-9000'],
    );
    const mismatch = issues.find((i) => i.rule === 'evidence_invoice_number_mismatch');
    expect(mismatch).toBeDefined();
  });

  it('does not raise an evidence_invoice_number_mismatch for mixed record-pointer evidence', () => {
    // Exact VRF-T001 evidence array per the bug report.
    const issues = hooks.evaluateEvidenceConsistency(
      {
        invoice_number: 'INV-T001',
        vendor_name: 'Harper Lane Inc',
        amount_total: 4500,
        due_date: '2026-07-15',
      },
      ['invoice:INV-T001', 'po:PO-38001', 'vendor_master:Harper Lane Inc'],
    );

    // None of the evidence keys should produce an invoice-number or vendor-name mismatch
    // because the strings are record pointers, not expected-value overrides.
    const badRules = issues.filter((i) =>
      i.rule === 'evidence_invoice_number_mismatch' || i.rule === 'evidence_vendor_mismatch',
    );
    expect(badRules).toHaveLength(0);
  });
});
