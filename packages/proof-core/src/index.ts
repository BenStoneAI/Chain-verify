export { runProofProduct } from './proof-kernel/run-proof-product.js';
export { buildEvidenceInputsFromPayloads, expandEvidenceInput } from './ingestion/evidence-splitter.js';
export {
  DEFAULT_EVIDENCE_PROVENANCE,
  EVIDENCE_PROVENANCE_VALUES,
  normaliseProvenance,
} from './ingestion/evidence-input.js';
export type { EvidenceProvenance } from './ingestion/evidence-input.js';
export {
  PROVENANCE_CONFIDENCE_CAP,
  applyConfidenceCap,
  evaluateProvenanceCap,
  summariseProvenance,
} from './proof-kernel/provenance.js';
export type { ProvenanceSummary, ProvenanceCapDecision } from './proof-kernel/provenance.js';
export {
  DEFAULT_EVIDENCE_MAX_AGE_DAYS,
  EVIDENCE_MAX_AGE_ENV,
  computeEvidenceFingerprint,
  computeStaleAfter,
  evaluateAuditFreshness,
  resolveEvidenceAsOf,
  resolveEvidenceMaxAgeDays,
} from './proof-kernel/freshness.js';
export type {
  AuditFreshness,
  AuditFreshnessReasonCode,
  AuditFreshnessState,
  StoredFreshness,
} from './proof-kernel/freshness.js';
export { buildControlCoverage } from './proof-kernel/coverage.js';
export type {
  ControlCoverageDetail,
  ControlCoverageReport,
  CoverageOutcome,
} from './proof-kernel/types.js';
export type { RunProofProductArgs } from './proof-kernel/run-proof-product.js';
export type { ProofReport } from './proof-kernel/report.js';
export type { EvidenceInput, ClassifiedEvidence } from './ingestion/evidence-input.js';
export type { ProofProduct, ControlResult, ControlDefinition } from './proof-kernel/types.js';
