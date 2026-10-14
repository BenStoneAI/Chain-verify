import type { CheckResult } from '../software-delivery.types.js';

export interface CoverageReason {
  checkId: string;
  checkName: string;
  /** SKIPPED = declared but not enabled in this run; UNABLE = ran but lacked what it needed. */
  outcome: 'SKIPPED' | 'UNABLE';
  reason: string;
}

export interface CoverageSummary {
  /** Distinct checks this run was asked to evaluate. */
  expected: number;
  /** Checks that produced a PASS, FAIL or WARNING. */
  executed: number;
  passed: number;
  failed: number;
  warned: number;
  /** Declared for this tier/job type but not evaluated in this run. */
  skipped: number;
  /** Evaluated but unable to reach a verdict (missing token, CI signal, diff, URL...). */
  unable: number;
  reasons: CoverageReason[];
}

export function summarizeCoverage(checkList: string[], results: CheckResult[]): CoverageSummary {
  const summary: CoverageSummary = {
    expected: Math.max(new Set(checkList).size, new Set(results.map((r) => r.checkId)).size),
    executed: 0,
    passed: 0,
    failed: 0,
    warned: 0,
    skipped: 0,
    unable: 0,
    reasons: [],
  };
  for (const r of results) {
    if (r.status === 'PASS') summary.passed += 1;
    else if (r.status === 'FAIL') summary.failed += 1;
    else if (r.status === 'WARNING') summary.warned += 1;
    else if (r.skipKind === 'NOT_EVALUATED') {
      summary.skipped += 1;
      summary.reasons.push({
        checkId: r.checkId,
        checkName: r.checkName,
        outcome: 'SKIPPED',
        reason: r.detail ?? 'Not evaluated in this run.',
      });
    } else {
      summary.unable += 1;
      summary.reasons.push({
        checkId: r.checkId,
        checkName: r.checkName,
        outcome: 'UNABLE',
        reason: r.detail ?? 'The check could not obtain the evidence it needs.',
      });
    }
  }
  summary.executed = summary.passed + summary.failed + summary.warned;
  return summary;
}
