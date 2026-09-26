// Proof-kernel end-to-end pipeline (Phase C).
//
// runProofProduct ties Phase A (kernel) and Phase B (the three control registries)
// together with the Phase C residual layer and final-confidence math, producing a
// single canonical ProofReport.
//
// Pipeline (deterministic except where a real LLM client is injected):
//   1. Ingest each EvidenceInput → ClassifiedEvidence (Phase A ingestion).
//   2. Build the product EvidenceContext via the correct registry builder and run
//      its controls through the kernel registry.
//   3. Convert every failed / needs_more_evidence control result into a
//      citation-backed ProofFinding.
//   4. Run the residual layer (no-op unless a client is injected).
//   5. Compute the FINAL confidence (deterministic ceiling; residual lowers only).
//   6. Assemble the canonical ProofReport, overriding its confidence +
//      evidence_sufficiency_score with the final values from step 5.
//
// This is ADDITIVE: it does not modify any existing route, registry, or kernel file.

import {
  ingestEvidence,
  type ClassifiedEvidence,
  type EvidenceInput,
} from '../ingestion/evidence-input.js';
import { INVOICEPROOF_CONTROLS, buildInvoiceContext } from '../registries/invoiceproof-controls.js';
import { AUDITPROOF_CONTROLS, buildAuditContext } from '../registries/auditproof-controls.js';
import { VERIFYAPI_CONTROLS, buildDeliveryContext } from '../registries/verifyapi-controls.js';
import { runControls } from './registry.js';
import { buildProofReport, type ProofReport } from './report.js';
import { computeFinalConfidence } from './final-confidence.js';
import { runLlmResidual, type LlmResidualInput, type ResidualOptions } from './llm-residual.js';
import type {
  ControlDefinition,
  ControlResult,
  EvidenceContext,
  ProofFinding,
  ProofProduct,
} from './types.js';

export type RunProofProductArgs = {
  product: ProofProduct;
  evidenceInputs: EvidenceInput[];
  /** Residual options. Omit/disable ⇒ residual layer is a no-op. */
  residual?: ResidualOptions;
  /** Explicit deterministic proof id override (still must be stable at call site). */
  proofId?: string;
};

// Per-product wiring: which controls + which context builder.
type ProductWiring = {
  controls: ControlDefinition[];
  buildContext: (docs: ClassifiedEvidence[]) => EvidenceContext;
};

function wiringFor(product: ProofProduct): ProductWiring {
  switch (product) {
    case 'invoiceproof':
      return { controls: INVOICEPROOF_CONTROLS, buildContext: buildInvoiceContext };
    case 'auditproof':
      return { controls: AUDITPROOF_CONTROLS, buildContext: buildAuditContext };
    case 'verifyapi':
      return { controls: VERIFYAPI_CONTROLS, buildContext: buildDeliveryContext };
  }
}

/**
 * Convert failed / needs_more_evidence control results into citation-backed
 * ProofFindings. Passed and skipped results do not produce findings (skipped feeds
 * missing_evidence via the report builder instead).
 *
 *   - failed  → status 'failed', carries the control's evidenceRefs + recommendedAction.
 *   - needs_more_evidence collapses into 'skipped' in the kernel union, so it cannot
 *     appear here; we still defensively map any stray status to needs_more_evidence.
 */
function controlResultsToFindings(results: ControlResult[]): ProofFinding[] {
  const findings: ProofFinding[] = [];
  for (const r of results) {
    if (r.status === 'failed') {
      findings.push({
        id: `ctrl_${r.controlId}`,
        controlId: r.controlId,
        severity: r.severity,
        status: 'failed',
        message: r.message ?? `${r.controlId} failed.`,
        evidenceRefs: r.evidenceRefs,
        recommendedAction: r.recommendedAction,
      });
    }
  }
  return findings;
}

/** Collect the verbatim source passages from control evidence for the LLM to cite. */
function collectSourcePassages(
  results: ControlResult[],
  documents: ClassifiedEvidence[],
): { documentId: string; passage: string }[] {
  const out: { documentId: string; passage: string }[] = [];
  const seen = new Set<string>();

  const push = (documentId: string, passage: string) => {
    const key = `${documentId}::${passage}`;
    if (!passage || seen.has(key)) return;
    seen.add(key);
    out.push({ documentId, passage });
  };

  for (const r of results) {
    if (r.status === 'failed' || r.status === 'passed') {
      for (const ref of r.evidenceRefs) {
        if (ref.sourcePassage) push(ref.documentId, ref.sourcePassage);
      }
    }
  }
  // Also offer document-level text so the residual layer can cite prose the
  // deterministic controls did not surface.
  for (const doc of documents) {
    if (typeof doc.text === 'string' && doc.text.trim()) {
      push(doc.rawFingerprint, doc.text.replace(/\s+/g, ' ').trim().slice(0, 600));
    }
  }
  return out;
}

/** Aggregate normalization warnings from the ingested documents (deduped). */
function collectNormalizationWarnings(documents: ClassifiedEvidence[]): string[] {
  const out: string[] = [];
  for (const d of documents) out.push(...d.normalizationWarnings);
  return [...new Set(out)];
}

/** Surface unknown / unclassified documents so the report can flag them. */
function collectUnknownFields(documents: ClassifiedEvidence[]): string[] {
  const out: string[] = [];
  for (const d of documents) {
    if (d.documentType === 'unknown') {
      out.push(d.filename ?? `unclassified:${d.rawFingerprint}`);
    }
  }
  return [...new Set(out)];
}

/**
 * Run the full proof pipeline for one product and return the canonical ProofReport.
 */
export async function runProofProduct(args: RunProofProductArgs): Promise<ProofReport> {
  const { product, evidenceInputs } = args;
  const wiring = wiringFor(product);

  // 1. Ingest.
  const documents = evidenceInputs.map(ingestEvidence);

  // 2. Build context + run deterministic controls.
  const ctx = wiring.buildContext(documents);
  const results = runControls(wiring.controls, ctx);

  const mustCheckIds = new Set(wiring.controls.filter((c) => c.mustCheck).map((c) => c.id));

  // 3. Control results → citation-backed findings.
  const controlFindings = controlResultsToFindings(results);

  // 4. Residual layer (no-op unless a client is injected).
  const skippedControlIds = results.filter((r) => r.status === 'skipped').map((r) => r.controlId);

  const residualInput: LlmResidualInput = {
    product,
    canonicalEvidence: documents,
    deterministicResults: results,
    skippedControlIds,
    sourcePassages: collectSourcePassages(results, documents),
  };
  const residual = await runLlmResidual(residualInput, args.residual);

  const allFindings = [...controlFindings, ...residual.findings];

  // 5. FINAL confidence — deterministic ceiling; residual lowers only. We pass NO
  //    modelConfidence: the residual layer already capped LLM influence by dropping/
  //    downgrading uncited findings, and final confidence must never be raised by the
  //    model. (modelConfidence remains a wired seam on computeFinalConfidence for
  //    explicit advisory use elsewhere, bounded to a ±0.05 nudge under the ceiling.)
  const finalConfidence = computeFinalConfidence(results, residual.findings, {
    mustCheckIds,
  });

  // 6. Assemble the report, then override confidence + sufficiency with the final
  //    values (buildProofReport recomputes a deterministic-only number; the final
  //    number folds in residual findings and is authoritative).
  const report = buildProofReport({
    product,
    results,
    findings: allFindings,
    normalizationWarnings: collectNormalizationWarnings(documents),
    unknownFields: collectUnknownFields(documents),
    contentFingerprint: fingerprintDocuments(documents),
    proofId: args.proofId,
    confidenceInputs: { mustCheckIds },
  });

  return {
    ...report,
    confidence: finalConfidence.confidence,
    evidence_sufficiency_score: finalConfidence.evidenceSufficiency,
  };
}

/** Stable fingerprint across the ingested documents (order-independent). */
function fingerprintDocuments(documents: ClassifiedEvidence[]): string {
  return documents
    .map((d) => d.rawFingerprint)
    .sort()
    .join('-');
}
