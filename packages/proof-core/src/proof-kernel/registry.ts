// Proof-kernel control registry + coverage + deterministic confidence.
//
// runControls() enforces the evidence-gating contract: before a control's run() is
// invoked, the registry verifies the document types it declared as requiredEvidence
// (and/or one full alternativeEvidence OR-group) are actually present in the
// context. If they are not, the control short-circuits to a 'skipped' result with
// the precise missing-document list — run() is NEVER called, so each control body
// can safely assume its evidence exists. There is no silent-pass path.

import type {
  ControlDefinition,
  ControlResult,
  CoverageSummary,
  EvidenceContext,
} from './types.js';

/** Document types present in the context (deduped). */
function presentDocumentTypes(ctx: EvidenceContext): Set<string> {
  const out = new Set<string>();
  for (const doc of ctx.documents) out.add(doc.documentType);
  return out;
}

/**
 * Determine whether a control's evidence requirements are met.
 *   - requiredEvidence: ALL must be present.
 *   - alternativeEvidence: if any required entry is missing, the control still
 *     passes the gate when at least one OR-group is fully present.
 * Returns the satisfied flag plus the list of missing document types (for the skip
 * result) and whether the shortfall is a missing document vs insufficient evidence.
 */
function evaluateEvidenceGate(
  def: ControlDefinition,
  present: Set<string>,
): { satisfied: boolean; missing: string[]; reason: 'missing_document' | 'insufficient_evidence' } {
  const missingRequired = def.requiredEvidence.filter((d) => !present.has(d));

  if (missingRequired.length === 0) {
    return { satisfied: true, missing: [], reason: 'missing_document' };
  }

  // Required evidence is incomplete — see if an alternative OR-group rescues it.
  if (def.alternativeEvidence && def.alternativeEvidence.length > 0) {
    for (const group of def.alternativeEvidence) {
      const groupMissing = group.filter((d) => !present.has(d));
      if (groupMissing.length === 0) {
        return { satisfied: true, missing: [], reason: 'missing_document' };
      }
    }
    // No alternative group fully satisfied. Report the smallest shortfall so the
    // caller sees the most actionable "add these documents" list.
    const groupsMissing = def.alternativeEvidence.map((g) => g.filter((d) => !present.has(d)));
    const smallest = groupsMissing.reduce(
      (acc, cur) => (cur.length < acc.length ? cur : acc),
      missingRequired,
    );
    return {
      satisfied: false,
      missing: dedupe([...missingRequired, ...smallest]),
      reason: 'insufficient_evidence',
    };
  }

  return { satisfied: false, missing: missingRequired, reason: 'missing_document' };
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Run a set of control definitions against the evidence context. Gates each control
 * on its declared evidence BEFORE calling run(); short-circuits to 'skipped' when
 * the gate is not satisfied. Never silent-passes.
 */
export function runControls(defs: ControlDefinition[], ctx: EvidenceContext): ControlResult[] {
  const present = presentDocumentTypes(ctx);
  const results: ControlResult[] = [];

  for (const def of defs) {
    const gate = evaluateEvidenceGate(def, present);
    if (!gate.satisfied) {
      results.push({
        status: 'skipped',
        controlId: def.id,
        reason: gate.reason,
        missingEvidence: gate.missing.length > 0 ? gate.missing : def.requiredEvidence,
      });
      continue;
    }
    results.push(def.run(ctx));
  }

  return results;
}

/** Thin class wrapper for callers that prefer an OO surface. */
export class ProofControlRegistry {
  constructor(private readonly defs: ControlDefinition[]) {}

  run(ctx: EvidenceContext): ControlResult[] {
    return runControls(this.defs, ctx);
  }

  get definitions(): ControlDefinition[] {
    return this.defs;
  }
}

/** Aggregate control results into a coverage summary. checked = passed + failed. */
export function buildCoverageSummary(results: ControlResult[]): CoverageSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    switch (r.status) {
      case 'passed':
        passed++;
        break;
      case 'failed':
        failed++;
        break;
      case 'skipped':
        skipped++;
        break;
    }
  }
  return {
    total_controls: results.length,
    checked: passed + failed,
    passed,
    failed,
    skipped,
  };
}

export type ConfidenceInputs = {
  /** Set of control IDs that are flagged mustCheck; skipping one degrades confidence. */
  mustCheckIds?: Set<string>;
  /**
   * Optional model/LLM confidence (0–1). Only a MINOR nudge — never dominant. The
   * deterministic floor/ceiling below cap its influence to ±5%.
   */
  modelConfidence?: number;
};

export type ConfidenceResult = {
  confidence: number;
  evidenceSufficiency: number;
  citationCoverage: number;
};

// Deterministic penalty weights (documented in the return-value JSDoc).
const PENALTY_FAILED_CRITICAL = 0.25;
const PENALTY_FAILED_HIGH = 0.15;
const PENALTY_FAILED_OTHER = 0.05;
const PENALTY_SKIPPED_MUSTCHECK = 0.1;
const MODEL_NUDGE_MAX = 0.05;

/**
 * Compute a deterministic confidence score from control results.
 *
 * FORMULA (deterministic; model input is at most a ±5% nudge):
 *   start at 1.0
 *   for each FAILED control:  − 0.25 (critical) / 0.15 (high) / 0.05 (medium|low)
 *   for each SKIPPED control that is flagged mustCheck:  − 0.10
 *   multiply the running score by evidenceSufficiency  (= checked / total)
 *   multiply the running score by (0.5 + 0.5 * citationCoverage)
 *       where citationCoverage = fraction of FAILED findings carrying ≥1 evidenceRef
 *       (1.0 when there are no failures — nothing to cite)
 *   optionally blend in modelConfidence as a ±0.05 nudge around the result
 *   clamp to [0, 1]
 */
export function computeDeterministicConfidence(
  results: ControlResult[],
  opts: ConfidenceInputs = {},
): ConfidenceResult {
  const mustCheckIds = opts.mustCheckIds ?? new Set<string>();

  let score = 1.0;
  let failedCount = 0;
  let citedFailures = 0;
  let hasCriticalFailure = false;
  let hasHighFailure = false;

  for (const r of results) {
    if (r.status === 'failed') {
      failedCount++;
      if (r.evidenceRefs.length > 0) citedFailures++;
      if (r.severity === 'critical') {
        hasCriticalFailure = true;
        score -= PENALTY_FAILED_CRITICAL;
      } else if (r.severity === 'high') {
        hasHighFailure = true;
        score -= PENALTY_FAILED_HIGH;
      } else score -= PENALTY_FAILED_OTHER;
    } else if (r.status === 'skipped') {
      if (mustCheckIds.has(r.controlId)) score -= PENALTY_SKIPPED_MUSTCHECK;
    }
  }

  const summary = buildCoverageSummary(results);
  const evidenceSufficiency =
    summary.total_controls > 0 ? summary.checked / summary.total_controls : 0;
  const citationCoverage = failedCount > 0 ? citedFailures / failedCount : 1;

  score = Math.max(0, score);
  // A critical/high deterministic failure means confidence in acceptability is
  // capped, not merely reduced. This keeps product confidence non-inverted:
  // failed must-check controls can only drive the score into review/block ranges.
  if (hasCriticalFailure) score = Math.min(score, 0.15);
  else if (hasHighFailure) score = Math.min(score, 0.3);
  score *= evidenceSufficiency;
  score *= 0.5 + 0.5 * citationCoverage;

  if (typeof opts.modelConfidence === 'number' && Number.isFinite(opts.modelConfidence)) {
    const m = Math.max(0, Math.min(1, opts.modelConfidence));
    // Nudge toward the model signal, bounded to ±MODEL_NUDGE_MAX.
    score += Math.max(-MODEL_NUDGE_MAX, Math.min(MODEL_NUDGE_MAX, (m - score) * MODEL_NUDGE_MAX));
  }

  score = Math.max(0, Math.min(1, score));

  return {
    confidence: Number(score.toFixed(4)),
    evidenceSufficiency: Number(evidenceSufficiency.toFixed(4)),
    citationCoverage: Number(citationCoverage.toFixed(4)),
  };
}
