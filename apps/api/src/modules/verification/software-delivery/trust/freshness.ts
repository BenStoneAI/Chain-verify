/**
 * Staleness: a verification is bound to a repo, HEAD SHA, evidence
 * fingerprint, and a validity window. It stops being CURRENT when the HEAD
 * moves, the evidence it rested on changes, the deployed SHA moves, or the
 * window elapses.
 */
import { canonicalJson, sha256Hex } from './canonical-json.js';
import type { Provenance } from './provenance.js';
import { shasMatch, shortSha } from './sha.js';
import { evidenceMaxAgeHours } from './trust-config.js';

export interface EvidenceItem {
  /** Stable evidence kind, e.g. "diff", "ci", "deploy", "agent_gate_receipt". */
  kind: string;
  provenance: Provenance;
  /** sha256 of the evidence content, or null when none was obtained. */
  digest: string | null;
}

export interface EvidenceFingerprintInput {
  repoOwner: string;
  repoName: string;
  afterSha: string;
  items: EvidenceItem[];
}

/**
 * sha256 of the canonical JSON of {repo, afterSha, evidence items}. Items are
 * sorted by kind so the fingerprint does not depend on collection order.
 * Volatile values (timings, fetch timestamps) must not be part of an item.
 */
export function computeEvidenceFingerprint(input: EvidenceFingerprintInput): string {
  const items = [...input.items]
    .map((i) => ({ kind: i.kind, provenance: i.provenance, digest: i.digest }))
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return sha256Hex(
    canonicalJson({
      repo: `${input.repoOwner.trim().toLowerCase()}/${input.repoName.trim().toLowerCase()}`,
      afterSha: input.afterSha.trim().toLowerCase(),
      evidence: items,
    }),
  );
}

export function computeStaleAfter(now: Date, maxAgeHours: number = evidenceMaxAgeHours()): Date {
  return new Date(now.getTime() + maxAgeHours * 3_600_000);
}

export type FreshnessState = 'CURRENT' | 'STALE';

export type FreshnessReasonCode =
  | 'HEAD_CHANGED'
  | 'EVIDENCE_CHANGED'
  | 'DEPLOY_SHA_CHANGED'
  | 'AGE_EXPIRED'
  | 'NO_FRESHNESS_BINDING';

export interface FreshnessReason {
  code: FreshnessReasonCode;
  message: string;
}

export interface FreshnessBinding {
  headSha?: string | null;
  evidenceFingerprint?: string | null;
  staleAfter?: Date | string | null;
  /** SHA the deployment was running when verified; falls back to headSha. */
  deploySha?: string | null;
}

export interface FreshnessInput {
  stored: FreshnessBinding;
  /** Current branch/commit tip, when the caller has just looked it up. */
  liveHeadSha?: string | null;
  /** SHA currently running in the deployment, when freshly observed. */
  liveDeploySha?: string | null;
  /** Fingerprint recomputed from currently available evidence. */
  evidenceFingerprint?: string | null;
  now: Date;
}

export interface FreshnessResult {
  state: FreshnessState;
  reasons: FreshnessReason[];
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pure: no clock, no I/O. Supply whichever live observations you have. */
export function evaluateFreshness(input: FreshnessInput): FreshnessResult {
  const { stored, now } = input;
  const reasons: FreshnessReason[] = [];

  const staleAfter = toDate(stored.staleAfter);
  const hasBinding = Boolean(stored.headSha) || Boolean(stored.evidenceFingerprint) || staleAfter !== null;
  if (!hasBinding) {
    reasons.push({
      code: 'NO_FRESHNESS_BINDING',
      message:
        'This verification carries no HEAD SHA, evidence fingerprint or validity window, so it cannot be shown to be current.',
    });
  }

  if (input.liveHeadSha && stored.headSha && !shasMatch(stored.headSha, input.liveHeadSha)) {
    reasons.push({
      code: 'HEAD_CHANGED',
      message: `The verified commit ${shortSha(stored.headSha)} is no longer the current HEAD ${shortSha(input.liveHeadSha)}.`,
    });
  }

  if (
    input.evidenceFingerprint &&
    stored.evidenceFingerprint &&
    input.evidenceFingerprint !== stored.evidenceFingerprint
  ) {
    reasons.push({
      code: 'EVIDENCE_CHANGED',
      message: 'The evidence this verification rested on has changed since it was recorded.',
    });
  }

  const deployBaseline = stored.deploySha || stored.headSha;
  if (input.liveDeploySha && deployBaseline && !shasMatch(deployBaseline, input.liveDeploySha)) {
    reasons.push({
      code: 'DEPLOY_SHA_CHANGED',
      message: `The deployment now runs ${shortSha(input.liveDeploySha)}, not the verified ${shortSha(deployBaseline)}.`,
    });
  }

  if (staleAfter && now.getTime() >= staleAfter.getTime()) {
    reasons.push({
      code: 'AGE_EXPIRED',
      message: `The evidence validity window ended at ${staleAfter.toISOString()}.`,
    });
  }

  return { state: reasons.length === 0 ? 'CURRENT' : 'STALE', reasons };
}
