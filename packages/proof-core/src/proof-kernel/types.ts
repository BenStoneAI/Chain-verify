// Proof-kernel core types — the citation-first contract shared by Phases B/C/D.
//
// IMPORTANT: this ControlResult is the NEW, richer kernel shape (every failure
// carries EvidenceRefs and a recommendedAction; every skip carries the missing
// evidence). It is DISTINCT from control-readiness.ts's ControlResult — that legacy
// shape is NOT edited here. Phase B1 supplies an adapter to map the 15 existing
// InvoiceProof controls into ControlDefinition[] (see mapLegacyStatus below for the
// status-to-status translation it will use).

import type { FieldValue } from '../field-value.js';
import type { ClassifiedEvidence, EvidenceProvenance } from '../ingestion/evidence-input.js';

export type { FieldValue };

export type ProofProduct = 'invoiceproof' | 'auditproof' | 'verifyapi';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/**
 * A pointer back to the exact evidence that supports a finding. The more of these
 * fields are populated, the more "citable" the finding is. At minimum a ref names
 * the document it came from.
 */
export type EvidenceRef = {
  documentId: string;
  documentType: string;
  filename?: string;
  field?: string;
  rawValue?: string;
  normalizedValue?: string;
  lineNumber?: number;
  sectionHeading?: string;
  sourcePassage?: string;
  /** Provenance class of the evidence this ref points at (absent = customer_submitted). */
  provenance?: EvidenceProvenance;
};

/**
 * A surfaced problem. `status` distinguishes a hard failure from a soft warning
 * from an "insufficient evidence to decide" outcome. Every finding must carry at
 * least the controlId, a human message, and a recommendedAction.
 */
export type ProofFinding = {
  id: string;
  controlId: string;
  severity: Severity;
  status: 'failed' | 'warning' | 'needs_more_evidence';
  message: string;
  evidenceRefs: EvidenceRef[];
  recommendedAction: string;
};

/** Kernel control status. 'skipped' here collapses the legacy split-skip statuses. */
export type ControlStatus = 'passed' | 'failed' | 'skipped' | 'needs_more_evidence';

export type SkipReason =
  | 'field_absent'
  | 'uninterpretable'
  | 'missing_document'
  | 'insufficient_evidence';

/**
 * Discriminated union — a control either passed (with citations), failed (with
 * severity + citations + remediation), or was skipped (with the precise reason and
 * the list of evidence that would have been required). There is no silent-pass path.
 */
export type ControlResult =
  | { status: 'passed'; controlId: string; evidenceRefs: EvidenceRef[] }
  | {
      status: 'failed';
      controlId: string;
      severity: Severity;
      evidenceRefs: EvidenceRef[];
      recommendedAction: string;
      message?: string;
    }
  | {
      status: 'skipped';
      controlId: string;
      reason: SkipReason;
      missingEvidence: string[];
    };

export type CoverageSummary = {
  total_controls: number;
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
};

/** Per-control outcome used by the report's coverage section. */
export type CoverageOutcome = 'passed' | 'failed' | 'warned' | 'skipped' | 'unable_to_run';

export type ControlCoverageDetail = {
  control_id: string;
  outcome: CoverageOutcome;
  /** Plain-English reason (always set; for skipped / unable_to_run it says why). */
  reason: string;
};

/**
 * Full control-coverage accounting for one proof run. Invariant:
 * passed + failed + warned + skipped + unable_to_run === controls_expected, and
 * controls_executed === passed + failed + warned.
 */
export type ControlCoverageReport = {
  controls_expected: number;
  controls_executed: number;
  passed: number;
  failed: number;
  warned: number;
  skipped: number;
  unable_to_run: number;
  details: ControlCoverageDetail[];
};

/**
 * The evaluation context passed to every control. `documents` is the full set of
 * classified evidence; the registry fills convenience typed accessors keyed by
 * document type (e.g. ctx.byType('invoice')). The index signature keeps it open for
 * product-specific projections built by adapters.
 */
export type EvidenceContext = {
  product: ProofProduct;
  documents: ClassifiedEvidence[];
  [k: string]: unknown;
};

/**
 * A declarative control. `requiredEvidence` and `alternativeEvidence` are document
 * types (matching ClassifiedEvidence.documentType) that MUST be present before
 * run() is called; the registry short-circuits to a 'skipped' result otherwise so
 * run() can assume its evidence exists.
 *
 *   - requiredEvidence: every entry must be present.
 *   - alternativeEvidence: at least one of the inner OR-groups must be fully present
 *     (each group is an AND of document types). Satisfies "either a PO register OR
 *     an inline authorized-amount column" style requirements.
 */
export type ControlDefinition = {
  id: string;
  product: ProofProduct;
  name: string;
  severityDefault: Severity;
  requiredEvidence: string[];
  alternativeEvidence?: string[][];
  /** Set true for controls that MUST be evaluated; skipping one degrades confidence. */
  mustCheck?: boolean;
  run: (context: EvidenceContext) => ControlResult;
};

/** Legacy control-readiness.ts status values (for the Phase B1 adapter). */
export type LegacyControlStatus =
  | 'passed'
  | 'failed'
  | 'skipped_field_absent'
  | 'skipped_uninterpretable'
  | 'needs_more_evidence';

/**
 * Map a legacy control-readiness status onto a kernel ControlStatus. Used by the
 * Phase B1 adapter so the existing 15 InvoiceProof controls can report through the
 * new kernel without rewriting their internals.
 */
export function mapLegacyStatus(legacy: LegacyControlStatus): ControlStatus {
  switch (legacy) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'needs_more_evidence':
      return 'needs_more_evidence';
    case 'skipped_field_absent':
    case 'skipped_uninterpretable':
      return 'skipped';
  }
}
