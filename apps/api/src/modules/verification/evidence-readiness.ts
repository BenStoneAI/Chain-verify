// Evidence-readiness gate for VerifyAPI (software_delivery documents) and
// AuditProof (audit_proof payloads).
//
// 48-hour stabilization principle (NOT a rebuild): when a control's required
// evidence is absent, we MUST emit a `needs_more_evidence` finding and cap the
// acceptable-confidence rather than silently reporting "verified / clean /
// audit-ready / delivery accepted". A skipped control is never a pass.
//
// Local mirror of the shared ControlStatus vocabulary used by proof-core
// control-readiness. These response string values stay stable so downstream
// consumers see consistent naming.
export type ControlStatus =
  | 'passed'
  | 'failed'
  | 'skipped_field_absent'
  | 'skipped_uninterpretable'
  | 'needs_more_evidence';

export interface ControlSkipped {
  controlId: string;
  reason: string;
}

export interface EvidenceReadiness {
  // Human-readable list of missing-evidence gaps surfaced on the response.
  evidence_gaps: string[];
  // Controls that could not run because their required evidence was absent.
  controls_skipped: ControlSkipped[];
  // When true, at least one must-check control could not run — callers MUST
  // deterministically cap acceptable-confidence and must NOT report accepted.
  hasGaps: boolean;
  // The deterministic upper bound on acceptable-confidence (0.0–1.0). When
  // hasGaps is true this is <= 0.40; otherwise it is 1 (no cap).
  confidenceCap: number;
}

const EVIDENCE_GAP_CONFIDENCE_CAP = 0.4;

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

function firstPresent(obj: Record<string, unknown>, keys: string[]): unknown {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 8 || value === null || value === undefined) return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (isPresent(found)) return found;
      }
      return undefined;
    }
    if (typeof value !== 'object') return undefined;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (wanted.has(key.toLowerCase()) && isPresent(nested)) return nested;
      const found = visit(nested, depth + 1);
      if (isPresent(found)) return found;
    }
    return undefined;
  };

  for (const key of keys) {
    if (isPresent(obj[key])) return obj[key];
  }
  return visit(obj, 0);
}

function blobOf(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj).toLowerCase();
  } catch {
    return '';
  }
}

/**
 * VerifyAPI (software_delivery document path) evidence-readiness check.
 *
 * Emits needs_more_evidence findings (status, not a hard fail) and a
 * deterministic confidence cap when required delivery evidence is absent:
 *  1. Requirement document missing/empty -> needs_more_evidence + cap <= 0.40.
 *  2. No deployment target -> skip staging_not_production control + cap.
 *  3. Bidirectional sync required but delivered direction not extractable ->
 *     needs_more_evidence for sync_direction_mismatch (don't pass).
 */
export function assessSoftwareDeliveryReadiness(
  output: Record<string, unknown>,
  presentDocFields: string[],
): EvidenceReadiness {
  const evidence_gaps: string[] = [];
  const controls_skipped: ControlSkipped[] = [];
  const blob = blobOf(output);

  // 1. Requirement / acceptance-criteria document missing or empty. Without a
  // contract to check the delivery against, "accepted" cannot be asserted.
  const hasRequirementDoc =
    isPresent(
      firstPresent(output, [
        'requirements',
        'acceptance_criteria',
        'contract_scope',
        'integration_scope',
        'requirements_traceability',
      ]),
    ) || presentDocFields.length > 0;
  if (!hasRequirementDoc) {
    evidence_gaps.push(
      'No requirement, acceptance-criteria, or contract-scope document supplied — cannot confirm the delivery meets contracted requirements.',
    );
    controls_skipped.push({
      controlId: 'requirements_present',
      reason: 'needs_more_evidence: requirement/acceptance-criteria document absent',
    });
  }

  // 2. Deployment target absent -> the staging_not_production control cannot run.
  const deploymentTarget = firstPresent(output, [
    'deployment_target',
    'delivered_deployment_target',
    'target_environment',
    'required_deployment_target',
    'expected_deployment_target',
    'contract_deployment_target',
  ]);
  const mentionsEnvironment =
    /\b(prod(?:uction)?|stag(?:e|ing)|uat|pre[-\s]?prod)\b/.test(blob);
  if (!isPresent(deploymentTarget) && !mentionsEnvironment) {
    evidence_gaps.push(
      'No deployment target or environment evidence supplied — the staging-vs-production control could not run.',
    );
    controls_skipped.push({
      controlId: 'staging_not_production',
      reason: 'skipped_field_absent: no deployment target / environment evidence',
    });
  }

  // 3. Bidirectional sync required but delivered direction not extractable.
  const requiredSync = String(
    firstPresent(output, [
      'required_sync_direction',
      'expected_sync_direction',
      'contract_sync_direction',
    ]) ?? '',
  ).toLowerCase();
  const requiresBidirectional =
    /bidirectional|two[-\s]?way|both directions/.test(requiredSync) ||
    /\bbidirectional\b|\btwo[-\s]?way sync\b|sync in both directions/.test(blob);
  const deliveredSync = firstPresent(output, [
    'sync_direction',
    'delivered_sync_direction',
    'actual_sync_direction',
  ]);
  const deliveredDirectionExtractable =
    isPresent(deliveredSync) ||
    /one[-\s]?way|unidirectional|single direction|both directions|two[-\s]?way|bidirectional/.test(
      blob,
    );
  if (requiresBidirectional && !deliveredDirectionExtractable) {
    evidence_gaps.push(
      'Bidirectional sync is required but the delivered sync direction could not be extracted from the evidence — cannot confirm both directions are live.',
    );
    controls_skipped.push({
      controlId: 'sync_direction_mismatch',
      reason: 'needs_more_evidence: delivered sync direction not extractable',
    });
  }

  const hasGaps = evidence_gaps.length > 0;
  return {
    evidence_gaps,
    controls_skipped,
    hasGaps,
    confidenceCap: hasGaps ? EVIDENCE_GAP_CONFIDENCE_CAP : 1,
  };
}

/**
 * AuditProof (audit_proof task) evidence-readiness check.
 *
 * Emits needs_more_evidence findings when major audit control evidence is
 * absent. The caller must NOT report "audit-ready" when any gap is present.
 *  1. Policy text missing -> needs_more_evidence.
 *  2. Risk register missing -> needs_more_evidence.
 *  3. Approval matrix / signature evidence missing -> needs_more_evidence.
 */
export function assessAuditProofReadiness(
  output: Record<string, unknown>,
): EvidenceReadiness {
  const evidence_gaps: string[] = [];
  const controls_skipped: ControlSkipped[] = [];
  const blob = blobOf(output);

  // 1. Policy text.
  const hasPolicy =
    isPresent(
      firstPresent(output, [
        'policy',
        'policy_text',
        'policies',
        'policy_document',
        'governance_policy',
        'procurement_policy',
      ]),
    ) || /\bpolicy\b/.test(blob);
  if (!hasPolicy) {
    evidence_gaps.push(
      'No policy text supplied — governance/policy controls cannot be audited.',
    );
    controls_skipped.push({
      controlId: 'policy_present',
      reason: 'needs_more_evidence: policy text absent',
    });
  }

  // 2. Risk register.
  const hasRiskRegister =
    isPresent(
      firstPresent(output, [
        'risk_register',
        'risk_registry',
        'risks',
        'risk_log',
        'risk_assessment',
      ]),
    ) || /risk[\s_-]?register/.test(blob);
  if (!hasRiskRegister) {
    evidence_gaps.push(
      'No risk register supplied — open/unowned/materialized risks cannot be audited.',
    );
    controls_skipped.push({
      controlId: 'risk_register_present',
      reason: 'needs_more_evidence: risk register absent',
    });
  }

  // 3. Approval matrix / signature evidence.
  const hasApprovalEvidence =
    isPresent(
      firstPresent(output, [
        'approval_matrix',
        'approvals',
        'signatures',
        'signature',
        'sign_off',
        'sign_offs',
        'approval_workflow',
        'authorization_matrix',
      ]),
    ) || /approval matrix|sign[-\s]?off|signature|approver/.test(blob);
  if (!hasApprovalEvidence) {
    evidence_gaps.push(
      'No approval matrix or signature/sign-off evidence supplied — authorization controls cannot be audited.',
    );
    controls_skipped.push({
      controlId: 'approval_matrix_present',
      reason: 'needs_more_evidence: approval matrix / signature evidence absent',
    });
  }

  const hasGaps = evidence_gaps.length > 0;
  return {
    evidence_gaps,
    controls_skipped,
    hasGaps,
    confidenceCap: hasGaps ? EVIDENCE_GAP_CONFIDENCE_CAP : 1,
  };
}
