// Evidence staleness: a deterministic evidence fingerprint, an as-of time, a
// stale-after deadline, and a pure CURRENT / STALE evaluator.
//
// A proof reports a point-in-time conclusion about a specific body of evidence.
// If that evidence changes, or simply gets old, the conclusion no longer holds
// and a consumer must be able to see that without re-running anything.

import { createHash } from 'node:crypto';

import type { ClassifiedEvidence } from '../ingestion/evidence-input.js';

export const DEFAULT_EVIDENCE_MAX_AGE_DAYS = 30;
export const EVIDENCE_MAX_AGE_ENV = 'AUDIT_PROOF_EVIDENCE_MAX_AGE_DAYS';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Evidence max age in days. Reads AUDIT_PROOF_EVIDENCE_MAX_AGE_DAYS; a missing,
 * non-numeric, zero or negative value falls back to the 30-day default (a
 * misconfigured env var must not silently disable staleness).
 */
export function resolveEvidenceMaxAgeDays(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): number {
  const raw = env[EVIDENCE_MAX_AGE_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_EVIDENCE_MAX_AGE_DAYS;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_EVIDENCE_MAX_AGE_DAYS;
}

/** Deterministic JSON with recursively sorted keys; undefined keys are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
    }
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

/**
 * sha256 (hex) over the canonical JSON of the classified evidence CONTENT:
 * document type, provenance, capture time, rows, text and json. Filenames and
 * mime types are labels, not content, and are excluded. Items are sorted so the
 * result does not depend on submission order.
 */
export function computeEvidenceFingerprint(documents: ClassifiedEvidence[]): string {
  const items = documents
    .map((d) =>
      canonicalJson({
        documentType: d.documentType,
        provenance: d.provenance ?? 'customer_submitted',
        observedAt: d.observedAt ?? null,
        rows: d.rows ?? null,
        text: typeof d.text === 'string' ? d.text.replace(/\s+/g, ' ').trim() : null,
        json: d.json ?? null,
      }),
    )
    .sort();
  return createHash('sha256').update(`[${items.join(',')}]`).digest('hex');
}

/**
 * The moment the evidence is "as of": the latest supplied evidence timestamp, or
 * the verification time when none was supplied. Clamped to the verification time
 * so a future-dated timestamp can never extend how long a proof stays current.
 */
export function resolveEvidenceAsOf(documents: ClassifiedEvidence[], verifiedAt: Date): Date {
  let latest: number | null = null;
  for (const d of documents) {
    if (!d.observedAt) continue;
    const ms = Date.parse(d.observedAt);
    if (Number.isNaN(ms)) continue;
    if (latest === null || ms > latest) latest = ms;
  }
  if (latest === null) return verifiedAt;
  return new Date(Math.min(latest, verifiedAt.getTime()));
}

export function computeStaleAfter(asOf: Date, maxAgeDays: number): Date {
  return new Date(asOf.getTime() + maxAgeDays * MS_PER_DAY);
}

export type AuditFreshnessState = 'CURRENT' | 'STALE';

export type AuditFreshnessReasonCode =
  | 'fingerprint_changed'
  | 'age_expired'
  | 'no_freshness_binding'
  | 'unreadable_stale_after';

export type AuditFreshness = {
  state: AuditFreshnessState;
  /** Plain-English reasons; empty when CURRENT. */
  reasons: string[];
  reason_codes: AuditFreshnessReasonCode[];
};

export type StoredFreshness = {
  evidenceFingerprint?: string | null;
  staleAfter?: Date | string | null;
};

/**
 * Pure freshness evaluation. STALE when ANY of:
 *   - a current fingerprint was supplied and differs from the stored one;
 *   - the stored stale_after deadline has passed;
 *   - the record carries no freshness binding at all (legacy record) - we refuse
 *     to call something CURRENT that we cannot show is current.
 * A stale_after that cannot be parsed is also STALE.
 */
export function evaluateAuditFreshness(args: {
  stored: StoredFreshness;
  currentFingerprint?: string | null;
  now: Date;
}): AuditFreshness {
  const { stored, currentFingerprint, now } = args;
  const reasons: string[] = [];
  const codes: AuditFreshnessReasonCode[] = [];

  const hasFingerprint = typeof stored.evidenceFingerprint === 'string' && stored.evidenceFingerprint !== '';
  const hasStaleAfter = stored.staleAfter !== null && stored.staleAfter !== undefined;

  if (!hasFingerprint && !hasStaleAfter) {
    reasons.push(
      'This proof has no recorded evidence fingerprint or expiry, so it cannot be shown to reflect current evidence.',
    );
    codes.push('no_freshness_binding');
  }

  if (hasFingerprint && typeof currentFingerprint === 'string' && currentFingerprint !== '') {
    if (currentFingerprint !== stored.evidenceFingerprint) {
      reasons.push('The evidence has changed since this proof was issued (fingerprint mismatch).');
      codes.push('fingerprint_changed');
    }
  }

  if (hasStaleAfter) {
    const deadline =
      stored.staleAfter instanceof Date ? stored.staleAfter : new Date(String(stored.staleAfter));
    if (Number.isNaN(deadline.getTime())) {
      reasons.push('The proof expiry date could not be read, so it cannot be shown to be current.');
      codes.push('unreadable_stale_after');
    } else if (now.getTime() > deadline.getTime()) {
      reasons.push(`The evidence is older than the allowed window (expired ${deadline.toISOString()}).`);
      codes.push('age_expired');
    }
  }

  return { state: reasons.length === 0 ? 'CURRENT' : 'STALE', reasons, reason_codes: codes };
}
