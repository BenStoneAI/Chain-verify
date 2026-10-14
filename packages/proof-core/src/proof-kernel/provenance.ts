// Evidence provenance: stamping, summary, and the self-reported confidence cap.
//
// Provenance can only ever LOWER confidence. Nothing in this module raises a
// number: the cap is applied with Math.min, and independently observed /
// externally verified / human-approved evidence simply fails to trigger it.

import {
  DEFAULT_EVIDENCE_PROVENANCE,
  EVIDENCE_PROVENANCE_VALUES,
  provenanceRank,
  type ClassifiedEvidence,
  type EvidenceProvenance,
} from '../ingestion/evidence-input.js';
import type { ControlDefinition, ControlResult, EvidenceRef, ProofFinding } from './types.js';

/**
 * Maximum confidence a proof may report when a critical / must-check control
 * passed ONLY on customer-submitted evidence. Named constant, not a magic number.
 */
export const PROVENANCE_CONFIDENCE_CAP = 0.7;

export type ProvenanceSummary = Record<EvidenceProvenance, number>;

/** Count evidence items by provenance class (every class present, zero-filled). */
export function summariseProvenance(documents: ClassifiedEvidence[]): ProvenanceSummary {
  const out = Object.fromEntries(
    EVIDENCE_PROVENANCE_VALUES.map((p) => [p, 0]),
  ) as ProvenanceSummary;
  for (const doc of documents) {
    out[doc.provenance ?? DEFAULT_EVIDENCE_PROVENANCE] += 1;
  }
  return out;
}

/**
 * documentId (rawFingerprint) -> provenance. When two items share a fingerprint
 * but disagree, the WEAKEST class wins so a collision can never launder trust.
 */
function provenanceByDocumentId(documents: ClassifiedEvidence[]): Map<string, EvidenceProvenance> {
  const map = new Map<string, EvidenceProvenance>();
  for (const doc of documents) {
    const p = doc.provenance ?? DEFAULT_EVIDENCE_PROVENANCE;
    const existing = map.get(doc.rawFingerprint);
    if (existing === undefined || provenanceRank(p) < provenanceRank(existing)) {
      map.set(doc.rawFingerprint, p);
    }
  }
  return map;
}

function stampRefs(refs: EvidenceRef[], byDoc: Map<string, EvidenceProvenance>): EvidenceRef[] {
  // A ref we cannot trace back to an ingested item is treated as self-reported.
  return refs.map((ref) => ({
    ...ref,
    provenance: byDoc.get(ref.documentId) ?? DEFAULT_EVIDENCE_PROVENANCE,
  }));
}

/** Carry provenance onto every EvidenceRef of every control result. Returns copies. */
export function stampResultProvenance(
  results: ControlResult[],
  documents: ClassifiedEvidence[],
): ControlResult[] {
  const byDoc = provenanceByDocumentId(documents);
  return results.map((r) =>
    r.status === 'skipped' ? r : { ...r, evidenceRefs: stampRefs(r.evidenceRefs, byDoc) },
  );
}

/** Carry provenance onto every EvidenceRef of every finding. Returns copies. */
export function stampFindingProvenance(
  findings: ProofFinding[],
  documents: ClassifiedEvidence[],
): ProofFinding[] {
  const byDoc = provenanceByDocumentId(documents);
  return findings.map((f) => ({ ...f, evidenceRefs: stampRefs(f.evidenceRefs, byDoc) }));
}

export type ProvenanceCapDecision = {
  /** The cap that applies, or null when no cap is triggered. */
  cap: number | null;
  /** Plain-English reason, or null when no cap is triggered. */
  reason: string | null;
  /** Controls that passed only on customer-submitted evidence. */
  controlIds: string[];
};

/**
 * A critical or must-check control that PASSED, where every piece of evidence it
 * cites is customer_submitted (or it cites nothing traceable), triggers the cap.
 * Any independent evidence among its citations means it did not pass ONLY on
 * self-reported evidence, so it does not trigger.
 */
export function evaluateProvenanceCap(
  results: ControlResult[],
  definitions: ControlDefinition[],
  cap: number = PROVENANCE_CONFIDENCE_CAP,
): ProvenanceCapDecision {
  const gated = new Set(
    definitions.filter((d) => d.mustCheck || d.severityDefault === 'critical').map((d) => d.id),
  );
  const controlIds: string[] = [];
  for (const r of results) {
    if (r.status !== 'passed' || !gated.has(r.controlId)) continue;
    const onlySelfReported =
      r.evidenceRefs.length === 0 ||
      r.evidenceRefs.every(
        (ref) => (ref.provenance ?? DEFAULT_EVIDENCE_PROVENANCE) === 'customer_submitted',
      );
    if (onlySelfReported) controlIds.push(r.controlId);
  }
  if (controlIds.length === 0) return { cap: null, reason: null, controlIds: [] };
  const pct = Math.round(cap * 100);
  return {
    cap,
    controlIds,
    reason:
      `Confidence is limited to ${pct}% because ${controlIds.length} critical or must-check ` +
      `control(s) (${controlIds.join(', ')}) passed only on customer-submitted evidence that ` +
      `nothing independent has confirmed. Supply independently observed, externally verified or ` +
      `human-approved evidence for these controls to lift the limit.`,
  };
}

/** Apply a cap (if any). Math.min only - this can never raise a value. */
export function applyConfidenceCap(confidence: number, cap: number | null): number {
  return cap === null ? confidence : Math.min(confidence, cap);
}
