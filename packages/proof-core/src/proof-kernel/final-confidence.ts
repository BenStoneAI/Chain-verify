// Proof-kernel FINAL confidence (Prompt2 section 5).
//
// This module is the SINGLE source of the final confidence number for a proof run.
// It is computed DETERMINISTICALLY. The LLM residual layer can only LOWER it; it can
// never raise it above the deterministic ceiling, and its self-reported
// modelConfidence is at most a ±0.05 nudge that is itself clamped to the ceiling.
//
// ── FORMULA (plain words) ──────────────────────────────────────────────────────
//   1. CEILING = computeDeterministicConfidence(deterministicResults) — the kernel's
//      existing deterministic score from failed critical/high controls, skipped
//      must-check controls, evidence sufficiency, and citation coverage. This is the
//      absolute upper bound. Nothing below can exceed it.
//   2. Residual findings adjust DOWNWARD only:
//        • each cited residual 'failed'            → −0.10 (critical/high) / −0.04 (else)
//        • each residual 'needs_more_evidence'     → lowers evidenceSufficiency by
//          treating it as an unmet check (−0.05 on the running score, floored at 0)
//      Residual warnings carry no numeric weight (they are advisory).
//   3. MODEL NUDGE: blend modelConfidence as a bounded ±0.05 nudge AROUND the
//      adjusted score — but only AFTER step 4's ceiling clamp is also applied to the
//      nudged value, so the model can never push the result above the ceiling.
//   4. CLAMP: final = clamp(min(adjusted, CEILING), 0, 1). The min() with CEILING is
//      applied LAST, so no residual/model contribution can raise confidence.
//
// ── WHY THE LLM CANNOT INVERT OR RAISE CONFIDENCE ──────────────────────────────
//   • CEILING is derived only from deterministic control results — residual findings
//     and modelConfidence are NOT inputs to it.
//   • Every residual contribution is strictly ≤ 0 (penalties only).
//   • The model nudge is bounded to ±0.05 AND re-clamped under the ceiling.
//   • The final min(…, CEILING) guarantees: if a critical control failed, CEILING is
//     already low, and no amount of LLM optimism (even modelConfidence = 0.99) can
//     exceed it. Proven by test 5 in proof-pipeline.test.ts.

import { computeDeterministicConfidence } from './registry.js';
import type { ControlResult, ProofFinding } from './types.js';

export type FinalConfidenceOptions = {
  /** Control ids flagged mustCheck — forwarded to the deterministic base. */
  mustCheckIds?: Set<string>;
  /** Advisory LLM self-confidence (0–1). Bounded ±0.05 nudge, clamped to ceiling. */
  modelConfidence?: number;
};

export type FinalConfidenceBreakdown = {
  /** The deterministic ceiling — the hard upper bound on `confidence`. */
  deterministicCeiling: number;
  /** Penalty applied for cited residual failures. */
  residualFailurePenalty: number;
  /** Penalty applied for residual needs_more_evidence findings. */
  residualUncertaintyPenalty: number;
  /** Net ±nudge actually applied from modelConfidence (after bounding). */
  modelNudgeApplied: number;
  /** Count of residual findings folded in. */
  residualFindingCount: number;
};

export type FinalConfidenceResult = {
  confidence: number;
  evidenceSufficiency: number;
  citationCoverage: number;
  breakdown: FinalConfidenceBreakdown;
};

// Residual penalty weights (downward only).
const RESIDUAL_FAILED_HEAVY = 0.1; // cited residual failed @ critical/high
const RESIDUAL_FAILED_LIGHT = 0.04; // cited residual failed @ medium/low
const RESIDUAL_NEEDS_EVIDENCE = 0.05; // each needs_more_evidence residual
const MODEL_NUDGE_MAX = 0.05;

/**
 * Compute the single, authoritative final confidence for a proof run.
 *
 * @param deterministicResults the control results from the kernel (source of truth)
 * @param residualFindings      the enforced residual findings (citation-gated)
 * @param opts                  mustCheck ids + advisory modelConfidence
 */
export function computeFinalConfidence(
  deterministicResults: ControlResult[],
  residualFindings: ProofFinding[] = [],
  opts: FinalConfidenceOptions = {},
): FinalConfidenceResult {
  // 1. Deterministic ceiling — computed WITHOUT any model/residual influence.
  const base = computeDeterministicConfidence(deterministicResults, {
    mustCheckIds: opts.mustCheckIds,
  });
  const ceiling = base.confidence;

  // 2. Fold residual findings DOWNWARD only.
  let residualFailurePenalty = 0;
  let residualUncertaintyPenalty = 0;
  for (const f of residualFindings) {
    if (f.status === 'failed' && f.evidenceRefs.length > 0) {
      residualFailurePenalty +=
        f.severity === 'critical' || f.severity === 'high'
          ? RESIDUAL_FAILED_HEAVY
          : RESIDUAL_FAILED_LIGHT;
    } else if (f.status === 'needs_more_evidence') {
      residualUncertaintyPenalty += RESIDUAL_NEEDS_EVIDENCE;
    }
    // 'warning' residuals carry no numeric weight.
  }

  let adjusted = ceiling - residualFailurePenalty - residualUncertaintyPenalty;
  adjusted = Math.max(0, adjusted);

  // 3. Model nudge — bounded ±0.05 around the adjusted score, then re-clamped under
  //    the ceiling so the model can never raise the result past the deterministic cap.
  let modelNudgeApplied = 0;
  if (typeof opts.modelConfidence === 'number' && Number.isFinite(opts.modelConfidence)) {
    const m = Math.max(0, Math.min(1, opts.modelConfidence));
    const nudge = Math.max(
      -MODEL_NUDGE_MAX,
      Math.min(MODEL_NUDGE_MAX, (m - adjusted) * MODEL_NUDGE_MAX),
    );
    const before = adjusted;
    adjusted = Math.min(ceiling, adjusted + nudge);
    modelNudgeApplied = adjusted - before;
  }

  // 4. Final clamp — min() with ceiling LAST guarantees no upward escape.
  const confidence = Math.max(0, Math.min(1, Math.min(adjusted, ceiling)));

  // Evidence sufficiency is lowered by residual uncertainty (capped at 0). Residual
  // needs_more_evidence means "we received signal we could not confirm" — that is a
  // sufficiency gap, surfaced here for the report's evidence_sufficiency_score.
  const evidenceSufficiency = Math.max(
    0,
    Number((base.evidenceSufficiency - residualUncertaintyPenalty).toFixed(4)),
  );

  return {
    confidence: Number(confidence.toFixed(4)),
    evidenceSufficiency,
    citationCoverage: base.citationCoverage,
    breakdown: {
      deterministicCeiling: ceiling,
      residualFailurePenalty: Number(residualFailurePenalty.toFixed(4)),
      residualUncertaintyPenalty: Number(residualUncertaintyPenalty.toFixed(4)),
      modelNudgeApplied: Number(modelNudgeApplied.toFixed(4)),
      residualFindingCount: residualFindings.length,
    },
  };
}
