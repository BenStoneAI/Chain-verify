// Evidence ingestion entry point for the proof kernel.
//
// Takes a raw EvidenceInput (a file's text / json + provenance), parses it into
// header-keyed rows via the existing invoice-normalizer parseInput (tabular/prose/
// json dispatch), computes a deterministic content fingerprint, classifies the
// document type, and returns a ClassifiedEvidence. Unknown documents are NEVER
// discarded — their rows/text/json are preserved on the result so later phases can
// still surface "we received this but could not interpret it".

import { parseInput } from '../normalizers/invoice-normalizer.js';
import { classifyEvidence, type DocumentType } from './classifier.js';

/**
 * How much independent weight a piece of evidence carries.
 *
 *   customer_submitted     - the customer's own say-so (the default; self-reported).
 *   independently_observed - collected by the platform / a system the customer
 *                            does not control.
 *   externally_verified    - confirmed against a third-party source of record.
 *   derived                - computed or generated from other evidence.
 *   human_approved         - reviewed and approved by a named human reviewer.
 *
 * SECURITY: provenance must only ever be set from a trusted server-side source.
 * A value copied straight out of a customer request body is itself customer
 * input and must NOT be forwarded here.
 */
export type EvidenceProvenance =
  | 'customer_submitted'
  | 'independently_observed'
  | 'externally_verified'
  | 'derived'
  | 'human_approved';

/** Declared order is also the "weakest first" order used to resolve collisions. */
export const EVIDENCE_PROVENANCE_VALUES: readonly EvidenceProvenance[] = [
  'customer_submitted',
  'derived',
  'independently_observed',
  'externally_verified',
  'human_approved',
];

export const DEFAULT_EVIDENCE_PROVENANCE: EvidenceProvenance = 'customer_submitted';

/**
 * Normalise an untrusted provenance value. Anything that is not an exact (trimmed)
 * member of the closed set - unknown strings, other types, undefined - becomes
 * `customer_submitted`. This function can only ever return the default or the
 * value the caller explicitly named; it never upgrades an unrecognised input.
 */
export function normaliseProvenance(value: unknown): EvidenceProvenance {
  if (typeof value !== 'string') return DEFAULT_EVIDENCE_PROVENANCE;
  const candidate = value.trim();
  return (EVIDENCE_PROVENANCE_VALUES as readonly string[]).includes(candidate)
    ? (candidate as EvidenceProvenance)
    : DEFAULT_EVIDENCE_PROVENANCE;
}

/** Rank used to pick the weakest provenance when two items share a fingerprint. */
export function provenanceRank(p: EvidenceProvenance): number {
  return EVIDENCE_PROVENANCE_VALUES.indexOf(p);
}

/** Normalise an evidence timestamp to ISO-8601, or undefined when unreadable. */
export function normaliseObservedAt(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

export type EvidenceInput = {
  filename?: string;
  mimeType?: string;
  text?: string;
  json?: unknown;
  sourceProduct: 'invoiceproof' | 'auditproof' | 'verifyapi';
  /** Optional provenance class. Defaults to `customer_submitted`; unknown strings normalise to it. */
  provenance?: EvidenceProvenance | string;
  /** Optional time the evidence was captured / observed (ISO string or Date). */
  observedAt?: string | Date;
};

export type ClassifiedEvidence = {
  documentType: DocumentType;
  confidence: number;
  reasons: string[];
  rawFingerprint: string;
  rows?: Record<string, unknown>[];
  text?: string;
  json?: unknown;
  filename?: string;
  mimeType?: string;
  sourceProduct: 'invoiceproof' | 'auditproof' | 'verifyapi';
  /** Parser warnings surfaced from parseInput (e.g. positional-fallback notice). */
  normalizationWarnings: string[];
  /** Provenance class (always set by ingestEvidence; absent means customer_submitted). */
  provenance?: EvidenceProvenance;
  /** ISO-8601 capture time supplied with the evidence, when valid. */
  observedAt?: string;
};

export type { DocumentType };

/**
 * FNV-1a 32-bit hash, returned as zero-padded 8-char hex. Non-cryptographic but
 * stable and deterministic — used purely as a content fingerprint / proof id seed.
 * No Date, no random, no platform-specific behavior.
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in 32-bit integer space.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned 32-bit and hex-encode.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Build a canonical, order-stable string from parsed content so the fingerprint is
 * invariant to incidental key ordering. Rows are serialized with sorted keys; text
 * is whitespace-normalized; json is stably stringified.
 */
function canonicalizeForFingerprint(args: {
  rows?: Record<string, unknown>[];
  text?: string;
  json?: unknown;
}): string {
  const parts: string[] = [];
  if (args.rows && args.rows.length > 0) {
    for (const row of args.rows) {
      const keys = Object.keys(row).sort();
      parts.push(keys.map((k) => `${k}=${stableValue(row[k])}`).join('|'));
    }
  }
  if (typeof args.text === 'string' && args.text.trim()) {
    parts.push('TEXT:' + args.text.replace(/\s+/g, ' ').trim());
  }
  if (args.json !== undefined && args.json !== null && !args.rows?.length) {
    parts.push('JSON:' + stableValue(args.json));
  }
  return parts.join('\n');
}

/** Deterministic stringify with sorted object keys (recursive). */
function stableValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return String(v);
  if (Array.isArray(v)) return '[' + v.map(stableValue).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => `${k}:${stableValue(obj[k])}`).join(',') + '}';
}

/**
 * Ingest one piece of evidence: parse → fingerprint → classify. Always returns a
 * ClassifiedEvidence (never throws on parse miss; unknown docs keep their payload).
 */
export function ingestEvidence(input: EvidenceInput): ClassifiedEvidence {
  let rows: Record<string, unknown>[] | undefined;
  let normalizationWarnings: string[] = [];

  // Parse text/json into header-keyed rows when possible. JSON arrays/objects and
  // tabular/prose text all flow through parseInput.
  const hasText = typeof input.text === 'string' && input.text.trim().length > 0;
  const hasJson = input.json !== undefined && input.json !== null;
  if (hasText || hasJson) {
    const parsed = parseInput({ text: input.text, json: input.json });
    rows = parsed.rows.length > 0 ? parsed.rows : undefined;
    normalizationWarnings = parsed.warnings;
  }

  const rawFingerprint = fnv1a(
    canonicalizeForFingerprint({ rows, text: input.text, json: input.json }),
  );

  const classification = classifyEvidence(rows, input.text, input.json);

  return {
    documentType: classification.documentType,
    confidence: classification.confidence,
    reasons: classification.reasons,
    rawFingerprint,
    // Preserve everything — unknown docs are never discarded.
    rows,
    text: hasText ? input.text : undefined,
    json: hasJson ? input.json : undefined,
    filename: input.filename,
    mimeType: input.mimeType,
    sourceProduct: input.sourceProduct,
    normalizationWarnings,
    provenance: normaliseProvenance(input.provenance),
    observedAt: normaliseObservedAt(input.observedAt),
  };
}
