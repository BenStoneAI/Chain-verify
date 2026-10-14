// Thin adapter between a stored ProofRecord / proof-core report and the pure
// freshness evaluator in proof-core. No DB access.

import { evaluateAuditFreshness, type AuditFreshness } from '@chain-verify/proof-core';

/** What createProof persists: the new ProofRecord columns. */
export interface ProofFreshnessOptions {
  evidenceFingerprint?: string;
  staleAfter?: Date;
}

/** Minimal slice of a proof-core ProofReport (avoids a hard type dependency). */
export interface FreshnessReportSlice {
  evidence_fingerprint?: string | null;
  stale_after?: string | null;
}

/**
 * Turn an AuditProof report into createProof's trailing `options` argument.
 * Unreadable / missing values are simply omitted (never invented).
 */
export function auditProofCreateOptions(
  report: FreshnessReportSlice | null | undefined,
): ProofFreshnessOptions {
  const out: ProofFreshnessOptions = {};
  if (!report) return out;
  if (typeof report.evidence_fingerprint === 'string' && report.evidence_fingerprint !== '') {
    out.evidenceFingerprint = report.evidence_fingerprint;
  }
  if (typeof report.stale_after === 'string') {
    const d = new Date(report.stale_after);
    if (!Number.isNaN(d.getTime())) out.staleAfter = d;
  }
  return out;
}

export interface FreshnessPresentable {
  evidenceFingerprint?: string | null;
  staleAfter?: Date | string | null;
}

/** CURRENT / STALE for a stored proof, optionally against a freshly computed fingerprint. */
export function evaluateProofFreshness(
  proof: FreshnessPresentable,
  currentFingerprint?: string | null,
  now: Date = new Date(),
): AuditFreshness {
  return evaluateAuditFreshness({
    stored: { evidenceFingerprint: proof.evidenceFingerprint, staleAfter: proof.staleAfter },
    currentFingerprint,
    now,
  });
}
