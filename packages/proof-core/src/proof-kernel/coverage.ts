// Per-control coverage accounting: which controls were expected, which actually
// ran, and - for every control that did not - exactly why.
//
//   passed / failed   control executed and reached a verdict
//   warned            control passed but a warning finding cites it
//   skipped           the evidence it needs was not supplied (or a needed field
//                     was absent), so it was not run
//   unable_to_run     evidence was supplied but could not be interpreted, or the
//                     control produced no result at all
//
// The kernel's CoverageSummary (total/checked/passed/failed/skipped) is untouched
// and remains on ProofReport.coverage_summary; this is the richer companion.

import type {
  ControlCoverageDetail,
  ControlCoverageReport,
  ControlResult,
  ProofFinding,
} from './types.js';

function list(items: string[]): string {
  return items.length > 0 ? items.join(', ') : 'unspecified';
}

function describeSkip(r: Extract<ControlResult, { status: 'skipped' }>): ControlCoverageDetail {
  const what = list(r.missingEvidence);
  switch (r.reason) {
    case 'uninterpretable':
      return {
        control_id: r.controlId,
        outcome: 'unable_to_run',
        reason: `Unable to run: evidence was supplied but could not be interpreted (${what}).`,
      };
    case 'field_absent':
      return {
        control_id: r.controlId,
        outcome: 'skipped',
        reason: `Not run: evidence was supplied but the field(s) this control needs were absent (${what}).`,
      };
    case 'missing_document':
    case 'insufficient_evidence':
    default:
      return {
        control_id: r.controlId,
        outcome: 'skipped',
        reason: `Not run: required evidence was not supplied (${what}).`,
      };
  }
}

export function buildControlCoverage(args: {
  results: ControlResult[];
  /** Ids of every control that should have run for this product, in order. */
  expectedControlIds?: string[];
  findings?: ProofFinding[];
}): ControlCoverageReport {
  const resultById = new Map<string, ControlResult>();
  for (const r of args.results) if (!resultById.has(r.controlId)) resultById.set(r.controlId, r);

  const expected = [...new Set(args.expectedControlIds ?? args.results.map((r) => r.controlId))];
  // Results for controls we did not list as expected are still reported.
  for (const id of resultById.keys()) if (!expected.includes(id)) expected.push(id);

  const warnedIds = new Set(
    (args.findings ?? []).filter((f) => f.status === 'warning').map((f) => f.controlId),
  );

  const details: ControlCoverageDetail[] = expected.map((id): ControlCoverageDetail => {
    const r = resultById.get(id);
    if (!r) {
      return {
        control_id: id,
        outcome: 'unable_to_run',
        reason: 'Unable to run: this control produced no result.',
      };
    }
    switch (r.status) {
      case 'failed':
        return {
          control_id: id,
          outcome: 'failed',
          reason: r.message ?? `${id} failed.`,
        };
      case 'passed': {
        if (warnedIds.has(id)) {
          return {
            control_id: id,
            outcome: 'warned',
            reason: 'Passed, but a warning finding cites this control and needs review.',
          };
        }
        const n = r.evidenceRefs.length;
        const customerOnly =
          n === 0 || r.evidenceRefs.every((e) => (e.provenance ?? 'customer_submitted') === 'customer_submitted');
        return {
          control_id: id,
          outcome: 'passed',
          reason:
            `Passed with ${n} cited evidence reference(s)` +
            (customerOnly ? ', all customer-submitted.' : '.'),
        };
      }
      case 'skipped':
        return describeSkip(r);
    }
  });

  const count = (o: ControlCoverageDetail['outcome']) => details.filter((d) => d.outcome === o).length;
  const passed = count('passed');
  const failed = count('failed');
  const warned = count('warned');
  return {
    controls_expected: details.length,
    controls_executed: passed + failed + warned,
    passed,
    failed,
    warned,
    skipped: count('skipped'),
    unable_to_run: count('unable_to_run'),
    details,
  };
}
