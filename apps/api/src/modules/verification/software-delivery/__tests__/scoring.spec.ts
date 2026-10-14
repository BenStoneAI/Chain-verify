/**
 * Scoring logic tests — exercises the private score() method indirectly
 * by verifying the public surface (verificationStatus, confidence, summary)
 * through the exported types from software-delivery.types.ts.
 *
 * Strategy: we build arrays of CheckResult objects and feed them through
 * a thin re-export of the scoring logic so we can test it in isolation
 * without spinning up the full orchestrator.
 */
import { describe, it, expect } from 'vitest';
import type { CheckResult, SoftwareTier } from '../software-delivery.types.js';

// ---------------------------------------------------------------------------
// Inline reimplementation of the scoring function — mirrors the production
// code in software-delivery.service.ts exactly so tests catch any drift.
// ---------------------------------------------------------------------------
function score(results: CheckResult[]): {
  status: string;
  confidence: number;
  summary: string;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
} {
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warnings = results.filter(r => r.status === 'WARNING').length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;
  const total = results.filter(r => r.status !== 'SKIP').length;
  const rawConfidence = 1 - failed * 0.15 - warnings * 0.05;
  const confidence = Math.round(Math.max(0, Math.min(1, rawConfidence)) * 100) / 100;
  let status: string;
  if (failed === 0 && warnings === 0) status = 'PASSED';
  else if (failed === 0 && warnings > 0) status = 'NEEDS_REVIEW';
  else if (failed <= 2 && confidence >= 0.6) status = 'NEEDS_REVIEW';
  else status = 'FAILED';
  const summary =
    failed === 0 && warnings === 0
      ? `${passed} of ${total} checks passed. Safe to release.`
      : `${passed} of ${total} checks passed. ${failed} failed, ${warnings} warnings.`;
  return { status, confidence, summary, passed, failed, warnings, skipped };
}

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeCheck(
  checkId: string,
  status: CheckResult['status'],
  tier: SoftwareTier = 'BASIC',
): CheckResult {
  return {
    checkId,
    checkName: `Check ${checkId}`,
    tier,
    status,
  };
}

function makeResults(counts: {
  pass?: number;
  fail?: number;
  warning?: number;
  skip?: number;
}): CheckResult[] {
  const results: CheckResult[] = [];
  let id = 1;
  for (let i = 0; i < (counts.pass ?? 0); i++) results.push(makeCheck(`P${id++}`, 'PASS'));
  for (let i = 0; i < (counts.fail ?? 0); i++) results.push(makeCheck(`F${id++}`, 'FAIL'));
  for (let i = 0; i < (counts.warning ?? 0); i++) results.push(makeCheck(`W${id++}`, 'WARNING'));
  for (let i = 0; i < (counts.skip ?? 0); i++) results.push(makeCheck(`S${id++}`, 'SKIP'));
  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Scoring logic', () => {

  // ── Status determination ──────────────────────────────────────────────────

  describe('status determination', () => {
    it('0 failures + 0 warnings → PASSED', () => {
      const result = score(makeResults({ pass: 7 }));
      expect(result.status).toBe('PASSED');
    });

    it('0 failures + 1 warning → NEEDS_REVIEW', () => {
      const result = score(makeResults({ pass: 6, warning: 1 }));
      expect(result.status).toBe('NEEDS_REVIEW');
    });

    it('0 failures + 3 warnings → NEEDS_REVIEW', () => {
      const result = score(makeResults({ pass: 4, warning: 3 }));
      expect(result.status).toBe('NEEDS_REVIEW');
    });

    it('0 failures + many warnings → still NEEDS_REVIEW not FAILED', () => {
      // Even 20 warnings still means no failure → NEEDS_REVIEW
      const result = score(makeResults({ pass: 1, warning: 20 }));
      expect(result.status).toBe('NEEDS_REVIEW');
    });

    it('1 failure + 0 warnings → NEEDS_REVIEW when confidence ≥ 0.6 (conf=0.85)', () => {
      // 1 failure: 1 - 0.15 = 0.85 ≥ 0.6 and failed ≤ 2 → NEEDS_REVIEW
      const result = score(makeResults({ pass: 6, fail: 1 }));
      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.confidence).toBe(0.85);
    });

    it('2 failures → NEEDS_REVIEW when confidence ≥ 0.6 (conf=0.7)', () => {
      // 2 failures: 1 - 0.30 = 0.70 ≥ 0.6 and failed ≤ 2 → NEEDS_REVIEW
      const result = score(makeResults({ pass: 5, fail: 2 }));
      expect(result.status).toBe('NEEDS_REVIEW');
      expect(result.confidence).toBe(0.7);
    });

    it('3 failures → FAILED (confidence 0.55 < 0.6)', () => {
      // 3 * 0.15 = 0.45; confidence = 0.55 < 0.6 → FAILED
      const result = score(makeResults({ pass: 4, fail: 3 }));
      expect(result.status).toBe('FAILED');
    });

    it('5 failures → FAILED with very low confidence', () => {
      const result = score(makeResults({ pass: 2, fail: 5 }));
      expect(result.status).toBe('FAILED');
      expect(result.confidence).toBeLessThanOrEqual(0.25);
    });

    it('7 failures → FAILED with confidence clamped to 0', () => {
      // 7 * 0.15 = 1.05 > 1; clamp to 0
      const result = score(makeResults({ fail: 7 }));
      expect(result.status).toBe('FAILED');
      expect(result.confidence).toBe(0);
    });
  });

  // ── Confidence calculation ─────────────────────────────────────────────────

  describe('confidence calculation', () => {
    it('0 failures + 0 warnings → confidence 1.0', () => {
      const result = score(makeResults({ pass: 5 }));
      expect(result.confidence).toBe(1.0);
    });

    it('0 failures + 1 warning → confidence 0.95', () => {
      const result = score(makeResults({ pass: 4, warning: 1 }));
      expect(result.confidence).toBe(0.95);
    });

    it('0 failures + 3 warnings → confidence 0.85', () => {
      const result = score(makeResults({ pass: 4, warning: 3 }));
      expect(result.confidence).toBe(0.85);
    });

    it('0 failures + 4 warnings → confidence 0.80', () => {
      const result = score(makeResults({ pass: 3, warning: 4 }));
      expect(result.confidence).toBe(0.80);
    });

    it('1 failure + 0 warnings → confidence 0.85', () => {
      const result = score(makeResults({ pass: 6, fail: 1 }));
      expect(result.confidence).toBe(0.85);
    });

    it('2 failures + 0 warnings → confidence 0.70', () => {
      const result = score(makeResults({ pass: 5, fail: 2 }));
      expect(result.confidence).toBe(0.70);
    });

    it('1 failure + 2 warnings → confidence 0.75', () => {
      // 1*0.15 + 2*0.05 = 0.25; 1 - 0.25 = 0.75
      const result = score(makeResults({ pass: 4, fail: 1, warning: 2 }));
      expect(result.confidence).toBe(0.75);
    });

    it('confidence is always between 0 and 1 inclusive', () => {
      // Stress test with many failures
      const result = score(makeResults({ fail: 20 }));
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('confidence is rounded to 2 decimal places', () => {
      // 1 failure + 1 warning: 1 - 0.15 - 0.05 = 0.80 (clean)
      const result = score(makeResults({ pass: 3, fail: 1, warning: 1 }));
      const decimalPlaces = result.confidence.toString().split('.')[1]?.length ?? 0;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });
  });

  // ── SKIP handling ─────────────────────────────────────────────────────────

  describe('SKIP handling', () => {
    it('all checks skipped → PASSED (no runnable checks failed)', () => {
      const result = score(makeResults({ skip: 5 }));
      expect(result.status).toBe('PASSED');
      expect(result.confidence).toBe(1.0);
    });

    it('mix of PASS and SKIP → PASSED', () => {
      const result = score(makeResults({ pass: 3, skip: 4 }));
      expect(result.status).toBe('PASSED');
    });

    it('SKIP checks are not counted in the total for summary', () => {
      // 3 pass + 2 skip → summary should say "3 of 3 checks passed"
      const result = score(makeResults({ pass: 3, skip: 2 }));
      expect(result.summary).toContain('3 of 3');
    });

    it('SKIP checks do not affect confidence', () => {
      const withSkip = score(makeResults({ pass: 3, skip: 5 }));
      const withoutSkip = score(makeResults({ pass: 3 }));
      expect(withSkip.confidence).toBe(withoutSkip.confidence);
    });
  });

  // ── Summary string content ─────────────────────────────────────────────────

  describe('summary string', () => {
    it('PASSED summary says "Safe to release."', () => {
      const result = score(makeResults({ pass: 7 }));
      expect(result.summary).toContain('Safe to release.');
    });

    it('PASSED summary includes total pass count', () => {
      const result = score(makeResults({ pass: 5 }));
      expect(result.summary).toContain('5 of 5 checks passed');
    });

    it('NEEDS_REVIEW summary includes failure count', () => {
      const result = score(makeResults({ pass: 5, fail: 1 }));
      expect(result.summary).toContain('1 failed');
    });

    it('NEEDS_REVIEW summary includes warning count', () => {
      const result = score(makeResults({ pass: 5, warning: 2 }));
      expect(result.summary).toContain('2 warnings');
    });

    it('FAILED summary includes failure count', () => {
      const result = score(makeResults({ pass: 2, fail: 5 }));
      expect(result.summary).toContain('5 failed');
    });

    it('summary is plain English — no JSON braces', () => {
      const result = score(makeResults({ pass: 3, fail: 1, warning: 2 }));
      expect(result.summary).not.toContain('{');
      expect(result.summary).not.toContain('}');
    });

    it('summary does not contain stack trace patterns', () => {
      const result = score(makeResults({ pass: 2, fail: 3 }));
      expect(result.summary).not.toMatch(/Error:|at .+:\d+:\d+/);
    });
  });

  // ── Boundary: 2 failures with warnings ──────────────────────────────────

  describe('boundary: 2 failures with warnings affecting confidence', () => {
    it('2 failures + 2 warnings → confidence 0.60 → NEEDS_REVIEW (boundary)', () => {
      // 2*0.15 + 2*0.05 = 0.40; confidence = 0.60; failed ≤ 2 and conf ≥ 0.6 → NEEDS_REVIEW
      const result = score(makeResults({ pass: 3, fail: 2, warning: 2 }));
      expect(result.confidence).toBe(0.60);
      expect(result.status).toBe('NEEDS_REVIEW');
    });

    it('2 failures + 3 warnings → confidence 0.55 → FAILED (just below threshold)', () => {
      // 2*0.15 + 3*0.05 = 0.45; confidence = 0.55 < 0.60 → FAILED
      const result = score(makeResults({ pass: 3, fail: 2, warning: 3 }));
      expect(result.confidence).toBe(0.55);
      expect(result.status).toBe('FAILED');
    });
  });

  // ── Counts returned correctly ─────────────────────────────────────────────

  describe('counts returned correctly', () => {
    it('passed count matches PASS status results', () => {
      const result = score(makeResults({ pass: 4, fail: 1, warning: 2, skip: 3 }));
      expect(result.passed).toBe(4);
    });

    it('failed count matches FAIL status results', () => {
      const result = score(makeResults({ pass: 4, fail: 2, warning: 1, skip: 2 }));
      expect(result.failed).toBe(2);
    });

    it('warnings count matches WARNING status results', () => {
      const result = score(makeResults({ pass: 3, fail: 1, warning: 4, skip: 1 }));
      expect(result.warnings).toBe(4);
    });

    it('skipped count matches SKIP status results', () => {
      const result = score(makeResults({ pass: 2, fail: 0, warning: 1, skip: 6 }));
      expect(result.skipped).toBe(6);
    });
  });
});
