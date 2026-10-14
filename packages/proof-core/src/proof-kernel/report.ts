// Proof-kernel report builder.
//
// Assembles the canonical ProofReport (Prompt2 section 8 shape) from control
// results, findings, and ingestion artifacts. Every derived value is deterministic:
//   - overall_status follows a fixed rule (fail > needs_review > pass),
//   - proof_id is derived from a content fingerprint (no Date.now / random),
//   - missing_evidence and recommended_next_actions are aggregated + deduped.

import { fnv1a, type ClassifiedEvidence } from '../ingestion/evidence-input.js';
import { buildControlCoverage } from './coverage.js';
import {
  DEFAULT_EVIDENCE_MAX_AGE_DAYS,
  computeEvidenceFingerprint,
  computeStaleAfter,
  resolveEvidenceAsOf,
} from './freshness.js';
import {
  PROVENANCE_CONFIDENCE_CAP,
  applyConfidenceCap,
  evaluateProvenanceCap,
  summariseProvenance,
  type ProvenanceSummary,
} from './provenance.js';
import {
  buildCoverageSummary,
  computeDeterministicConfidence,
  type ConfidenceInputs,
} from './registry.js';
import type {
  ControlCoverageReport,
  ControlDefinition,
  ControlResult,
  CoverageSummary,
  ProofFinding,
  ProofProduct,
} from './types.js';

export type ProofReport = {
  product: ProofProduct;
  overall_status: 'pass' | 'fail' | 'needs_review';
  evidence_sufficiency_score: number;
  findings: ProofFinding[];
  controls: {
    passed: string[];
    failed: string[];
    skipped: string[];
  };
  missing_evidence: string[];
  normalization_warnings: string[];
  unknown_fields: string[];
  recommended_next_actions: string[];
  proof_id: string;
  export_urls: string[];
  /** Coverage summary surfaced for callers that render a coverage panel. */
  coverage_summary: CoverageSummary;
  /** Deterministic confidence breakdown (sufficiency + citation coverage). */
  confidence: number;
  /** Evidence items counted by provenance class (every class present). */
  provenance_summary: ProvenanceSummary;
  /** Cap applied because critical controls passed only on self-reported evidence; null = none. */
  confidence_cap: number | null;
  /** Plain-English reason for the cap; null when no cap applies. */
  confidence_cap_reason: string | null;
  /** sha256 of the canonical classified evidence content. */
  evidence_fingerprint: string;
  /** ISO time the evidence is as-of (latest evidence timestamp, else verification time). */
  evidence_as_of: string;
  /** ISO deadline after which this proof is STALE (evidence_as_of + max age). */
  stale_after: string;
  /** Max evidence age, in days, that produced stale_after. */
  evidence_max_age_days: number;
  /** Full per-control coverage accounting (skipped / unable-to-run carry reasons). */
  coverage: ControlCoverageReport;
};

export type BuildProofReportArgs = {
  product: ProofProduct;
  results: ControlResult[];
  findings?: ProofFinding[];
  normalizationWarnings?: string[];
  unknownFields?: string[];
  /** Stable fingerprint of the ingested content; seeds proof_id when no id given. */
  contentFingerprint?: string;
  /** Explicit proof id override (still must be deterministic at the call site). */
  proofId?: string;
  exportUrls?: string[];
  /** Forwarded to computeDeterministicConfidence (mustCheck ids, model nudge). */
  confidenceInputs?: ConfidenceInputs;
  /** Ingested evidence: drives provenance_summary, fingerprint and as-of time. */
  documents?: ClassifiedEvidence[];
  /** The product's control definitions: drives coverage "expected" and the cap's critical set. */
  controlDefinitions?: ControlDefinition[];
  /** Verification time (default: now). Only feeds evidence_as_of / stale_after. */
  now?: Date;
  /** Evidence max age in days (default 30). */
  maxAgeDays?: number;
  /**
   * Apply the self-reported-evidence confidence cap. Off unless the caller opts in
   * (runProofProduct opts in for AuditProof only).
   */
  applyProvenanceCap?: boolean;
  /** Override the cap value (default PROVENANCE_CONFIDENCE_CAP). */
  provenanceCap?: number;
};

const SEVERITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/**
 * Derive overall_status deterministically:
 *   - 'fail'         if any control failed at critical/high severity, OR any finding
 *                    is status 'failed' at critical/high.
 *   - 'needs_review' if any control was skipped while flagged mustCheck, any result
 *                    is needs_more_evidence, any finding is needs_more_evidence/warning,
 *                    or there are only lower-severity (medium/low) failures.
 *   - 'pass'         otherwise.
 */
function deriveOverallStatus(
  results: ControlResult[],
  findings: ProofFinding[],
  mustCheckIds: Set<string>,
): 'pass' | 'fail' | 'needs_review' {
  let hasHardFail = false;
  let needsReview = false;

  for (const r of results) {
    if (r.status === 'failed') {
      if (r.severity === 'critical' || r.severity === 'high') hasHardFail = true;
      else needsReview = true;
    } else if (r.status === 'skipped' && mustCheckIds.has(r.controlId)) {
      needsReview = true;
    }
  }

  for (const f of findings) {
    if (f.status === 'failed' && (f.severity === 'critical' || f.severity === 'high')) {
      hasHardFail = true;
    } else if (
      f.status === 'failed' ||
      f.status === 'warning' ||
      f.status === 'needs_more_evidence'
    ) {
      needsReview = true;
    }
  }

  if (hasHardFail) return 'fail';
  if (needsReview) return 'needs_review';
  return 'pass';
}

/** Aggregate every skipped control's missingEvidence into a deduped list. */
function aggregateMissingEvidence(results: ControlResult[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    if (r.status === 'skipped') out.push(...r.missingEvidence);
  }
  return [...new Set(out)];
}

/** Sort findings by severity (critical first) then controlId for stable output. */
function sortFindings(findings: ProofFinding[]): ProofFinding[] {
  return [...findings].sort((a, b) => {
    const rank = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
    if (rank !== 0) return rank;
    return a.controlId.localeCompare(b.controlId);
  });
}

/**
 * Build the canonical proof report. Pure and deterministic given identical inputs.
 */
export function buildProofReport(args: BuildProofReportArgs): ProofReport {
  const findings = sortFindings(args.findings ?? []);
  const mustCheckIds = args.confidenceInputs?.mustCheckIds ?? new Set<string>();

  const overall_status = deriveOverallStatus(args.results, findings, mustCheckIds);

  const controls = { passed: [] as string[], failed: [] as string[], skipped: [] as string[] };
  for (const r of args.results) {
    if (r.status === 'passed') controls.passed.push(r.controlId);
    else if (r.status === 'failed') controls.failed.push(r.controlId);
    else controls.skipped.push(r.controlId); // status === 'skipped'
  }

  const coverage_summary = buildCoverageSummary(args.results);
  const conf = computeDeterministicConfidence(args.results, args.confidenceInputs);

  const missing_evidence = aggregateMissingEvidence(args.results);

  // --- provenance / cap -----------------------------------------------------
  const documents = args.documents ?? [];
  const capDecision = args.applyProvenanceCap
    ? evaluateProvenanceCap(
        args.results,
        args.controlDefinitions ?? [],
        args.provenanceCap ?? PROVENANCE_CONFIDENCE_CAP,
      )
    : { cap: null, reason: null, controlIds: [] as string[] };
  const cappedConfidence = applyConfidenceCap(conf.confidence, capDecision.cap);

  // --- freshness ------------------------------------------------------------
  const verifiedAt = args.now ?? new Date();
  const maxAgeDays = args.maxAgeDays ?? DEFAULT_EVIDENCE_MAX_AGE_DAYS;
  const asOf = resolveEvidenceAsOf(documents, verifiedAt);
  const staleAfter = computeStaleAfter(asOf, maxAgeDays);

  // --- coverage -------------------------------------------------------------
  const coverage = buildControlCoverage({
    results: args.results,
    expectedControlIds: args.controlDefinitions?.map((d) => d.id),
    findings,
  });

  // Recommended next actions: gather missing-evidence prompts, the remediation on
  // each failed ControlResult, and the remediation on each failed finding (deduped,
  // stable order — missing-evidence first, then result remediations, then findings).
  const recommended_next_actions: string[] = [];
  for (const m of missing_evidence) {
    recommended_next_actions.push(`Provide ${m} to enable the skipped control(s) that require it.`);
  }
  for (const r of args.results) {
    if (r.status === 'failed' && r.recommendedAction) {
      recommended_next_actions.push(r.recommendedAction);
    }
  }
  for (const f of findings) {
    if (f.status === 'failed' && f.recommendedAction) {
      recommended_next_actions.push(f.recommendedAction);
    }
  }
  const dedupedActions = [...new Set(recommended_next_actions)];

  // proof_id: explicit override > content fingerprint > fingerprint of the report's
  // own deterministic shape. Never time/random based.
  const proof_id =
    args.proofId ??
    `proof_${
      args.contentFingerprint ??
      fnv1a(
        JSON.stringify({
          product: args.product,
          controls,
          findings: findings.map((f) => f.id),
          missing_evidence,
        }),
      )
    }`;

  return {
    product: args.product,
    overall_status,
    evidence_sufficiency_score: conf.evidenceSufficiency,
    findings,
    controls,
    missing_evidence,
    normalization_warnings: [...new Set(args.normalizationWarnings ?? [])],
    unknown_fields: [...new Set(args.unknownFields ?? [])],
    recommended_next_actions: dedupedActions,
    proof_id,
    export_urls: args.exportUrls ?? [],
    coverage_summary,
    confidence: cappedConfidence,
    provenance_summary: summariseProvenance(documents),
    confidence_cap: capDecision.cap,
    confidence_cap_reason: capDecision.reason,
    evidence_fingerprint: computeEvidenceFingerprint(documents),
    evidence_as_of: asOf.toISOString(),
    stale_after: staleAfter.toISOString(),
    evidence_max_age_days: maxAgeDays,
    coverage,
  };
}
