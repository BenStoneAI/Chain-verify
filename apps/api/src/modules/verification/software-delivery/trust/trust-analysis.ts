/**
 * Orchestrates the Agent Gate trust layer over a finished set of check
 * results: provenance per check, critical-evidence assessment and confidence
 * cap, lifecycle, coverage, evidence fingerprint and freshness binding.
 *
 * Pure: no I/O, no clock (the caller passes `now`), no mutation of its input.
 */
import type { CheckResult } from '../software-delivery.types.js';
import { canonicalJson, sha256Hex } from './canonical-json.js';
import { applyConfidenceCap, assessCriticalEvidence, type CriticalEvidenceAssessment } from './confidence.js';
import { summarizeCoverage, type CoverageSummary } from './coverage.js';
import {
  computeEvidenceFingerprint,
  computeStaleAfter,
  evaluateFreshness,
  type EvidenceItem,
  type FreshnessResult,
} from './freshness.js';
import { computeLifecycle, type LifecycleResult } from './lifecycle.js';
import {
  emptyProvenanceCounts,
  provenanceForCheck,
  type Provenance,
  type ProvenanceCounts,
} from './provenance.js';
import { recommendedActionFor } from './recommendations.js';
import type { ReceiptValidation } from './receipt.js';
import { selfReportedConfidenceCap } from './trust-config.js';

export interface TrustAnalysisInput {
  dto: {
    repoOwner: string;
    repoName: string;
    afterSha: string;
    jobType: string;
    jobDescription?: string;
    aiReport?: string;
    deployUrl?: string;
    deployPlatform?: string;
    semgrepFindings?: unknown[];
  };
  checkList: string[];
  results: CheckResult[];
  diffText: string;
  diffFiles: string[];
  receipt: ReceiptValidation;
  engine: { status: string; confidence: number; summary: string; escalated: boolean };
  now: Date;
  /** Override for tests; defaults to AGENT_GATE_SELF_REPORTED_CONFIDENCE_CAP / 0.6. */
  confidenceCap?: number;
  /** Override for tests; defaults to AGENT_GATE_EVIDENCE_MAX_AGE_HOURS / 24. */
  evidenceMaxAgeHours?: number;
}

export interface ReceiptSummary {
  submitted: boolean;
  receiptId: string | null;
  accepted: boolean;
  integrityOk: boolean;
  signatureTrusted: boolean;
  signingKeyId: string | null;
  bindingOk: boolean;
  fresh: boolean;
  testsObserved: boolean;
  status: ReceiptValidation['status'];
  headSha: string | null;
  createdAt: string | null;
  repository: string | null;
  observedTests: ReceiptValidation['observedTests'];
  findings: ReceiptValidation['findings'];
}

export interface TrustAnalysis {
  results: CheckResult[];
  status: string;
  confidence: number;
  summary: string;
  engineConfidence: number;
  confidenceCapped: boolean;
  confidenceCapReason: string | null;
  criticalEvidence: CriticalEvidenceAssessment[];
  lifecycle: LifecycleResult;
  coverage: CoverageSummary;
  provenanceCounts: ProvenanceCounts;
  evidenceItems: EvidenceItem[];
  evidenceFingerprint: string;
  headSha: string;
  staleAfter: Date;
  freshness: FreshnessResult;
  receipt: ReceiptSummary;
  /** JSON-safe summary persisted in SoftwareDeliveryVerification.provenanceSummary. */
  provenanceSummary: Record<string, unknown>;
}

export function summarizeReceipt(receipt: ReceiptValidation): ReceiptSummary {
  return {
    submitted: receipt.submitted,
    receiptId: receipt.receiptId,
    accepted: receipt.accepted,
    integrityOk: receipt.integrityOk,
    signatureTrusted: receipt.signatureTrusted,
    signingKeyId: receipt.signingKeyId,
    bindingOk: receipt.bindingOk,
    fresh: receipt.fresh,
    testsObserved: receipt.testsObserved,
    status: receipt.status,
    headSha: receipt.headSha,
    createdAt: receipt.createdAt,
    repository: receipt.repository,
    observedTests: receipt.observedTests,
    findings: receipt.findings,
  };
}

function digestOf(value: unknown): string {
  try {
    return sha256Hex(canonicalJson(value));
  } catch {
    // Not canonicalizable (e.g. floats): fall back to plain JSON, still deterministic per input.
    return sha256Hex(JSON.stringify(value) ?? 'null');
  }
}

function stablePrimitive(value: unknown): string | number | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  return null;
}

function buildEvidenceItems(input: TrustAnalysisInput, results: CheckResult[]): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const byId = (id: string) => results.find((r) => r.checkId === id);

  items.push({
    kind: 'diff',
    provenance: 'OBSERVED_BY_REMOTE_PROVIDER',
    digest: input.diffText ? sha256Hex(input.diffText) : null,
  });
  items.push({
    kind: 'changed_files',
    provenance: 'OBSERVED_BY_REMOTE_PROVIDER',
    digest: input.diffFiles.length > 0 ? digestOf([...input.diffFiles].sort()) : null,
  });

  const ci = ['S9', 'S2', 'B5', 'S4', 'S5']
    .map((id) => byId(id))
    .filter((r): r is CheckResult => r !== undefined && r.status !== 'SKIP')
    .map((r) => ({
      id: r.checkId,
      status: r.status,
      runId: stablePrimitive(r.evidence?.['runId']),
      conclusion: stablePrimitive(r.evidence?.['conclusion']),
    }));
  items.push({
    kind: 'ci',
    provenance: 'OBSERVED_BY_REMOTE_PROVIDER',
    digest: ci.length > 0 ? digestOf(ci) : null,
  });

  const dep = byId('DEP3') ?? byId('S10');
  const depEv = dep?.evidence;
  const deployedSha = stablePrimitive(depEv?.['deployedSha'] ?? depEv?.['commitSha'] ?? depEv?.['commitRef']);
  items.push({
    kind: 'deploy',
    provenance: 'OBSERVED_BY_REMOTE_PROVIDER',
    digest:
      dep && dep.status !== 'SKIP'
        ? digestOf({
            status: dep.status,
            deployedSha,
            deploymentId: stablePrimitive(depEv?.['deploymentId'] ?? depEv?.['deployId']),
          })
        : null,
  });

  const pr = byId('B7');
  items.push({
    kind: 'pull_request',
    provenance: 'OBSERVED_BY_REMOTE_PROVIDER',
    digest:
      pr && pr.status !== 'SKIP'
        ? digestOf({ status: pr.status, mergedAt: stablePrimitive(pr.evidence?.['merged_at']) })
        : null,
  });

  if (input.receipt.submitted) {
    items.push({
      kind: 'agent_gate_receipt',
      provenance: input.receipt.accepted ? 'OBSERVED_BY_AGENT_GATE' : 'SUBMITTED_BY_CUSTOMER',
      digest: digestOf({ receiptId: input.receipt.receiptId, accepted: input.receipt.accepted }),
    });
  }
  if (input.dto.aiReport) {
    items.push({ kind: 'ai_report', provenance: 'SELF_REPORTED', digest: sha256Hex(input.dto.aiReport) });
  }
  if (input.dto.semgrepFindings && input.dto.semgrepFindings.length > 0) {
    items.push({
      kind: 'semgrep_findings',
      provenance: 'SELF_REPORTED',
      digest: digestOf(input.dto.semgrepFindings),
    });
  }
  if (input.dto.jobDescription) {
    items.push({
      kind: 'job_description',
      provenance: 'SUBMITTED_BY_CUSTOMER',
      digest: sha256Hex(input.dto.jobDescription),
    });
  }
  if (input.dto.deployUrl) {
    items.push({
      kind: 'deploy_url',
      provenance: 'SUBMITTED_BY_CUSTOMER',
      digest: sha256Hex(input.dto.deployUrl),
    });
  }
  return items;
}

/**
 * Persisted form of a check's evidence: the original evidence plus a
 * `_provenance` object naming who observed it.
 */
export function evidenceWithProvenance(result: CheckResult): Record<string, unknown> {
  return {
    ...(result.evidence ?? {}),
    _provenance: {
      provenance: result.provenance ?? null,
      basis: result.provenanceBasis ?? null,
    },
  };
}

export function analyzeTrust(input: TrustAnalysisInput): TrustAnalysis {
  const { dto, receipt, engine, now } = input;

  // 1. Provenance + recommended action on every result.
  const results: CheckResult[] = input.results.map((r) => {
    const assignment = provenanceForCheck(r, receipt);
    return {
      ...r,
      skipKind: r.status === 'SKIP' ? (r.skipKind ?? 'UNABLE') : undefined,
      provenance: assignment.provenance,
      provenanceBasis: assignment.basis,
      recommendedAction: recommendedActionFor(r),
    };
  });

  const provenanceCounts = emptyProvenanceCounts();
  for (const r of results) {
    if (r.status !== 'SKIP' && r.provenance) provenanceCounts[r.provenance as Provenance] += 1;
  }

  // 2. Critical evidence and confidence cap (never raises the engine's score).
  const criticalEvidence = assessCriticalEvidence({
    checkList: input.checkList,
    results,
    jobType: dto.jobType,
    aiReport: dto.aiReport,
    deployUrl: dto.deployUrl,
    deployPlatform: dto.deployPlatform,
    afterSha: dto.afterSha,
    receipt,
  });
  const cap = applyConfidenceCap(
    engine.confidence,
    criticalEvidence,
    input.confidenceCap ?? selfReportedConfidenceCap(),
  );

  let status = engine.status;
  let summary = engine.summary;
  if (cap.applies && cap.reason) {
    if (status === 'PASSED') {
      const passed = results.filter((r) => r.status === 'PASS').length;
      const total = results.filter((r) => r.status !== 'SKIP').length;
      status = 'NEEDS_REVIEW';
      summary = `${passed} of ${total} checks passed, but critical evidence is not independently confirmed. ${cap.reason} Human review is required.`;
    } else {
      summary = `${summary} ${cap.reason}`;
    }
  }

  // 3. Lifecycle, coverage.
  const lifecycle = computeLifecycle({
    results,
    afterSha: dto.afterSha,
    receipt,
    fetchedDiffFileCount: input.diffFiles.length,
  });
  const coverage = summarizeCoverage(input.checkList, results);

  // 4. Binding for staleness.
  const evidenceItems = buildEvidenceItems(input, results);
  const evidenceFingerprint = computeEvidenceFingerprint({
    repoOwner: dto.repoOwner,
    repoName: dto.repoName,
    afterSha: dto.afterSha,
    items: evidenceItems,
  });
  const staleAfter = computeStaleAfter(now, input.evidenceMaxAgeHours);
  const freshness = evaluateFreshness({
    stored: {
      headSha: dto.afterSha,
      evidenceFingerprint,
      staleAfter,
      deploySha: lifecycle.deploy.deployedSha,
    },
    liveHeadSha: dto.afterSha,
    liveDeploySha: lifecycle.deploy.deployedSha,
    evidenceFingerprint,
    now,
  });
  if (freshness.state === 'STALE') lifecycle.flags.stale = true;

  const receiptSummary = summarizeReceipt(receipt);
  const provenanceSummary: Record<string, unknown> = {
    version: 1,
    counts: provenanceCounts,
    evidenceItems,
    criticalEvidence,
    receipt: receiptSummary,
    deploy: lifecycle.deploy,
    deploySha: lifecycle.deploy.deployedSha,
    lifecycle: {
      status: lifecycle.status,
      reached: lifecycle.reached,
      blocked: lifecycle.blocked,
      flags: lifecycle.flags,
    },
    coverage,
    confidence: {
      engine: engine.confidence,
      final: cap.confidence,
      capped: cap.lowered,
      capReason: cap.reason,
    },
  };

  return {
    results,
    status,
    confidence: cap.confidence,
    summary,
    engineConfidence: engine.confidence,
    confidenceCapped: cap.lowered,
    confidenceCapReason: cap.reason,
    criticalEvidence,
    lifecycle,
    coverage,
    provenanceCounts,
    evidenceItems,
    evidenceFingerprint,
    headSha: dto.afterSha,
    staleAfter,
    freshness,
    receipt: receiptSummary,
    provenanceSummary,
  };
}
