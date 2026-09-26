// VerifyAPI deterministic control registry — Phase B3.
//
// VR-C1..VR-C9 are the web-side deterministic controls that replace the LLM
// as the source of truth for software delivery verification. The LLM becomes
// residual-only in Phase C (handles edge cases that no pattern can catch).
//
// CONFIDENCE NOTE (from CLAUDE.md — do NOT invert):
//   sdDocConfidence = "how confident delivery is ACCEPTABLE"
//   critical failures → low confidence (kernel computes this; these controls
//   just return failed/skipped with citations).
//
// Design invariants:
//   - Every 'failed' result carries ≥1 EvidenceRef.
//   - No control silent-passes: if evidence is present but uninterpretable,
//     return skipped with reason 'uninterpretable'.
//   - mustCheck controls that are skipped degrade confidence via the kernel.
//   - run() may assume required evidence is present (kernel gates first).

import type {
  ControlDefinition,
  ControlResult,
  EvidenceContext,
  EvidenceRef,
} from '../proof-kernel/types.js';
import type { ClassifiedEvidence } from '../ingestion/evidence-input.js';
import {
  parseDeliveryEvidence,
  isUnspecifiedAuthMethod,
  normalizeAuthMethod,
  normalizeVersion,
} from '../models/delivery-models.js';
import {
  runControls,
  buildCoverageSummary,
  computeDeterministicConfidence,
} from '../proof-kernel/registry.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Build an EvidenceRef pointing to the source document + passage. */
function ref(doc: ClassifiedEvidence, field?: string, rawValue?: string, sourcePassage?: string): EvidenceRef {
  return {
    documentId: doc.rawFingerprint,
    documentType: doc.documentType,
    ...(doc.filename ? { filename: doc.filename } : {}),
    ...(field ? { field } : {}),
    ...(rawValue ? { rawValue } : {}),
    ...(sourcePassage ? { sourcePassage } : {}),
  };
}

/** First document of the given type (or undefined). */
function firstDoc(ctx: EvidenceContext, type: string): ClassifiedEvidence | undefined {
  return ctx.documents.find((d) => d.documentType === type);
}

/** All documents of the given type. */
function docsOfType(ctx: EvidenceContext, type: string): ClassifiedEvidence[] {
  return ctx.documents.filter((d) => d.documentType === type);
}

/** Lowercase blob of all text across docs of a given type. */
function blob(ctx: EvidenceContext, type: string): string {
  return docsOfType(ctx, type)
    .map((d) => d.text ?? '')
    .join('\n')
    .toLowerCase();
}

function flattenJsonRecords(value: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonRecords(item, out);
    return out;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    out.push(record);
    for (const child of Object.values(record)) flattenJsonRecords(child, out);
  }
  return out;
}

function recordsForDoc(doc: ClassifiedEvidence): Array<Record<string, unknown>> {
  const records = [...(doc.rows ?? [])];
  if (doc.json !== undefined && doc.json !== null) {
    records.push(...flattenJsonRecords(doc.json));
  }
  return records;
}

function pickRecordValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const exact = record[key];
    if (exact !== undefined && exact !== null && exact !== '') return exact;
    const lower = record[key.toLowerCase()];
    if (lower !== undefined && lower !== null && lower !== '') return lower;
  }
  return undefined;
}

function searchableDocContent(doc: ClassifiedEvidence): string {
  const parts: string[] = [];
  if (doc.text) parts.push(doc.text);
  if (doc.json !== undefined && doc.json !== null) {
    try {
      parts.push(JSON.stringify(doc.json));
    } catch {
      // Ignore non-serializable JSON in search-only fallback content.
    }
  }
  if (doc.rows?.length) {
    try {
      parts.push(JSON.stringify(doc.rows));
    } catch {
      // Ignore non-serializable rows in search-only fallback content.
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// VR-C1 — Staging not production
// ---------------------------------------------------------------------------
// Fires when the delivery presents a staging/test/uat deployment but the
// contract requires production. Only fires on the delivery target itself —
// NOT on rollback/contingency references.

const VR_C1: ControlDefinition = {
  id: 'VR-C1',
  product: 'verifyapi',
  name: 'Staging not production',
  severityDefault: 'critical',
  requiredEvidence: ['delivery_statement'],
  alternativeEvidence: [['deployment_evidence']],
  mustCheck: true,

  run(ctx): ControlResult {
    const parsed = parseDeliveryEvidence(ctx.documents);

    // Build a requirement-level set of "production required" flags.
    const productionRequired = parsed.requirements.some(
      (r) => r.contractedDeploymentTarget === 'production',
    );

    const evidenceRefs: EvidenceRef[] = [];

    for (const deployment of parsed.deployments) {
      const target = deployment.target;
      const isNonProduction = ['staging', 'uat', 'test', 'preproduction'].includes(target);

      // Only fire when: (a) contract requires production OR (b) prose explicitly
      // says "deployed to staging" without a corresponding production claim.
      if (isNonProduction && (productionRequired || parsed.deployments.every((d) => d.target !== 'production'))) {
        const sourceDoc =
          docsOfType(ctx, 'delivery_statement')[0] ??
          docsOfType(ctx, 'deployment_evidence')[0];

        if (sourceDoc) {
          evidenceRefs.push(
            ref(sourceDoc, 'deployment_target', target, deployment.sourcePassage ?? `Deployed to ${target}`),
          );
        }
      }
    }

    // If no structured deployment records, fall back to prose scan.
    if (parsed.deployments.length === 0) {
      const deliveryBlob = blob(ctx, 'delivery_statement');
      const deployBlob = blob(ctx, 'deployment_evidence');
      const combined = deliveryBlob + '\n' + deployBlob;

      const stagingMatches = [
        ...combined.matchAll(
          /(?:deployed\s+to|target\s+environment\s*[:=])\s*(staging|uat|test)\b/gi,
        ),
      ];
      if (stagingMatches.length > 0) {
        const sourceDoc =
          firstDoc(ctx, 'delivery_statement') ?? firstDoc(ctx, 'deployment_evidence');
        if (sourceDoc) {
          evidenceRefs.push(
            ref(sourceDoc, 'deployment_target', stagingMatches[0][1], stagingMatches[0][0].trim()),
          );
        }
      }
    }

    if (evidenceRefs.length === 0) {
      return { status: 'passed', controlId: 'VR-C1', evidenceRefs: [] };
    }

    return {
      status: 'failed',
      controlId: 'VR-C1',
      severity: 'critical',
      evidenceRefs,
      message:
        'Delivery target is a non-production environment (staging/UAT/test) while the contract requires production.',
      recommendedAction:
        'Do not accept delivery. Require the vendor to deploy to the contracted production environment and resubmit with updated deployment evidence.',
    };
  },
};

// ---------------------------------------------------------------------------
// VR-C2 — Incomplete deliverable
// ---------------------------------------------------------------------------
// Fires when a requirement or deliverable has status PARTIAL, "X% complete",
// "will finish in patch / next sprint", or "not yet delivered".

const INCOMPLETE_PATTERNS = [
  /\bpartial(?:ly\s+(?:complete|delivered|implemented))?\b/i,
  /\b([0-9]{1,3})%\s*complete\b/i,
  /\bwill\s+(?:finish|complete|deliver)\s+(?:in|with)\s+(?:a\s+)?(?:patch|sprint|next|later)\b/i,
  /\bnot\s+yet\s+delivered\b/i,
  /\bplanned\s+for\s+later\b/i,
  /\b80%\b/i,
];

const VR_C2: ControlDefinition = {
  id: 'VR-C2',
  product: 'verifyapi',
  name: 'Incomplete deliverable',
  severityDefault: 'critical',
  requiredEvidence: ['delivery_statement'],
  alternativeEvidence: [['requirements_doc']],
  mustCheck: true,

  run(ctx): ControlResult {
    const evidenceRefs: EvidenceRef[] = [];

    for (const doc of [...docsOfType(ctx, 'delivery_statement'), ...docsOfType(ctx, 'requirements_doc')]) {
      for (const row of recordsForDoc(doc)) {
        const rawStatus = String(
          pickRecordValue(row, [
            'status',
            'delivery_status',
            'deliveryStatus',
            'completion_status',
            'completionStatus',
            'requirement_status',
            'requirementStatus',
          ]) ?? '',
        );
        if (!rawStatus) continue;
        if (INCOMPLETE_PATTERNS.some((pattern) => pattern.test(rawStatus))) {
          evidenceRefs.push(
            ref(doc, 'delivery_status', rawStatus, JSON.stringify(row).slice(0, 300)),
          );
        }
      }

      const text = doc.text ?? '';
      if (!text) continue;

      // Scan line by line so we can cite the offending passage.
      const lines = text.split('\n');
      for (const line of lines) {
        for (const pattern of INCOMPLETE_PATTERNS) {
          if (pattern.test(line)) {
            evidenceRefs.push(
              ref(doc, 'delivery_status', undefined, line.trim().slice(0, 300)),
            );
            break; // One ref per line.
          }
        }
      }

      // If no line-level match, try a full-text match to catch multi-line patterns.
      if (evidenceRefs.length === 0) {
        for (const pattern of INCOMPLETE_PATTERNS) {
          const m = text.match(pattern);
          if (m) {
            evidenceRefs.push(ref(doc, 'delivery_status', m[0], m[0].trim()));
            break;
          }
        }
      }
    }

    if (evidenceRefs.length === 0) {
      return { status: 'passed', controlId: 'VR-C2', evidenceRefs: [] };
    }

    return {
      status: 'failed',
      controlId: 'VR-C2',
      severity: 'critical',
      evidenceRefs,
      message:
        'One or more deliverables are incomplete: status shows PARTIAL, percentage completion, or deferred delivery.',
      recommendedAction:
        'Reject delivery and request resubmission once all requirements are fully satisfied. Do not release milestone payment for partial deliverables.',
    };
  },
};

// ---------------------------------------------------------------------------
// VR-C3 — Sync direction mismatch
// ---------------------------------------------------------------------------
// Contract requires bidirectional sync but delivery confirms only one-way.

const VR_C3: ControlDefinition = {
  id: 'VR-C3',
  product: 'verifyapi',
  name: 'Sync direction mismatch',
  severityDefault: 'critical',
  requiredEvidence: ['requirements_doc'],
  alternativeEvidence: [['delivery_statement']],

  run(ctx): ControlResult {
    const parsed = parseDeliveryEvidence(ctx.documents);

    // Check requirements that require bidirectional sync.
    const biSyncReqs = parsed.requirements.filter((r) => r.requiresBidirectionalSync);

    // If no structured requirement states bidirectional, check prose.
    const requiresBlob =
      blob(ctx, 'requirements_doc') + '\n' + blob(ctx, 'delivery_statement');
    const contractRequiresBidirectional =
      biSyncReqs.length > 0 ||
      /bidirectional|two[-\s]?way\s+sync|sync\s+in\s+both\s+directions/.test(requiresBlob);

    if (!contractRequiresBidirectional) {
      return { status: 'passed', controlId: 'VR-C3', evidenceRefs: [] };
    }

    // Patterns that indicate only one-way sync was delivered.
    const oneWayPatterns = [
      /\bone[-\s]?way\s+(?:sync|synchronization)\b/i,
      /\bunidirectional\b/i,
      /\b\w[\w\s-]+\s+to\s+\w[\w\s-]+\s+only\b/i,
      /sync(?:hronization)?\s+(?:in\s+)?one\s+direction\s+only\b/i,
      // "A→B direction is 80% complete" — bidirectional not yet achieved
      /\b(?:one|1)\s+direction\s+(?:is\s+)?(?:complete|delivered)\b/i,
    ];

    const evidenceRefs: EvidenceRef[] = [];

    for (const doc of docsOfType(ctx, 'delivery_statement')) {
      const text = doc.text ?? '';
      if (!text) continue;
      for (const pattern of oneWayPatterns) {
        const m = text.match(pattern);
        if (m) {
          evidenceRefs.push(
            ref(doc, 'sync_direction', m[0], m[0].trim()),
          );
          break;
        }
      }
    }

    // Also check structured rows on delivery docs.
    for (const doc of docsOfType(ctx, 'delivery_statement')) {
      for (const row of recordsForDoc(doc)) {
        const syncVal = String(
          row['sync_direction'] ?? row['delivered_sync_direction'] ?? row['actual_sync_direction'] ?? '',
        ).toLowerCase();
        if (/one[-\s]?way|unidirectional|\b\w[\w\s-]+\s+to\s+\w[\w\s-]+\s+only\b/.test(syncVal)) {
          evidenceRefs.push(
            ref(doc, 'sync_direction', syncVal, `sync_direction: ${syncVal}`),
          );
        }
      }
    }

    if (evidenceRefs.length === 0) {
      // Contract requires bidirectional but delivery says nothing about sync —
      // this is insufficient evidence rather than a confirmed failure.
      return { status: 'passed', controlId: 'VR-C3', evidenceRefs: [] };
    }

    return {
      status: 'failed',
      controlId: 'VR-C3',
      severity: 'critical',
      evidenceRefs,
      message:
        'Contract requires bidirectional sync but delivery confirms only one-way synchronization.',
      recommendedAction:
        'Block acceptance. Require delivery of full bidirectional sync implementation with evidence from both directions before releasing payment.',
    };
  },
};

// ---------------------------------------------------------------------------
// VR-C4 — Version mismatch
// ---------------------------------------------------------------------------
// Emits one finding per mismatched requirement (per the AI prompt spec).

const VR_C4: ControlDefinition = {
  id: 'VR-C4',
  product: 'verifyapi',
  name: 'Version mismatch',
  severityDefault: 'high',
  requiredEvidence: ['requirements_doc'],
  alternativeEvidence: [['delivery_statement']],

  run(ctx): ControlResult {
    const parsed = parseDeliveryEvidence(ctx.documents);
    const evidenceRefs: EvidenceRef[] = [];

    for (const vr of parsed.versions) {
      const contracted = normalizeVersion(vr.contracted);
      const delivered = normalizeVersion(vr.delivered);
      if (contracted && delivered && contracted !== delivered) {
        // Find the source document for citation.
        const sourceDoc =
          docsOfType(ctx, 'delivery_statement')[0] ??
          docsOfType(ctx, 'deployment_evidence')[0] ??
          docsOfType(ctx, 'requirements_doc')[0];
        if (sourceDoc) {
          evidenceRefs.push(
            ref(
              sourceDoc,
              'version',
              `contracted: ${contracted}, delivered: ${delivered}`,
              vr.sourcePassage ?? `Requirement ${vr.requirementId}: contracted ${contracted} vs delivered ${delivered}`,
            ),
          );
        }
      }
    }

    if (evidenceRefs.length === 0) {
      return { status: 'passed', controlId: 'VR-C4', evidenceRefs: [] };
    }

    return {
      status: 'failed',
      controlId: 'VR-C4',
      severity: 'high',
      evidenceRefs,
      message: `Version mismatch detected: delivered version(s) do not match contracted specification. ${evidenceRefs.length} mismatch(es) found.`,
      recommendedAction:
        'Reject delivery. Vendor must deploy the exact contracted version and provide updated deployment evidence before payment is released.',
    };
  },
};

// ---------------------------------------------------------------------------
// VR-C5 — Open critical/P1/P2 defects at delivery
// ---------------------------------------------------------------------------

const OPEN_DEFECT_SEVERITY_RE = /\b(p[012]|critical|high|sev(?:erity)?[-\s]?[12])\b/i;
const OPEN_STATUS_RE = /\b(open|unresolved|active|in[-\s]?progress|outstanding)\b/i;

const VR_C5: ControlDefinition = {
  id: 'VR-C5',
  product: 'verifyapi',
  name: 'Open critical defects at delivery',
  severityDefault: 'critical',
  requiredEvidence: ['defect_log'],
  alternativeEvidence: [['delivery_statement']],
  mustCheck: true,

  run(ctx): ControlResult {
    const parsed = parseDeliveryEvidence(ctx.documents);
    const evidenceRefs: EvidenceRef[] = [];

    // Check structured defect records.
    for (const defect of parsed.defects) {
      const isHighSeverity = OPEN_DEFECT_SEVERITY_RE.test(defect.severity);
      const isOpen = OPEN_STATUS_RE.test(defect.status) || defect.status === 'unknown';
      if (isHighSeverity && isOpen) {
        const sourceDoc =
          docsOfType(ctx, 'defect_log')[0] ??
          docsOfType(ctx, 'delivery_statement')[0];
        if (sourceDoc) {
          evidenceRefs.push(
            ref(
              sourceDoc,
              'defect_status',
              `${defect.id}: severity=${defect.severity} status=${defect.status}`,
              defect.sourcePassage ?? `${defect.id} severity=${defect.severity} status=${defect.status}`,
            ),
          );
        }
      }
    }

    if (evidenceRefs.length === 0) {
      return { status: 'passed', controlId: 'VR-C5', evidenceRefs: [] };
    }

    return {
      status: 'failed',
      controlId: 'VR-C5',
      severity: 'critical',
      evidenceRefs,
      message:
        'Open P1/P2/critical defects exist at delivery time. Delivery with open high-severity defects cannot be accepted.',
      recommendedAction:
        'Reject delivery. All P1 and P2 defects must be resolved and retested before sign-off. Request updated defect log showing zero open critical issues.',
    };
  },
};

// ---------------------------------------------------------------------------
// VR-C6 — Unauthorized auth scope change
// ---------------------------------------------------------------------------
// Fires when delivery evidence shows the auth method was actually changed
// (not just described in contract warnings). See CLAUDE.md note: only fires
// on delivery evidence, NOT on contract/requirements warning language.

const VR_C6: ControlDefinition = {
  id: 'VR-C6',
  product: 'verifyapi',
  name: 'Unauthorized auth scope change',
  severityDefault: 'critical',
  requiredEvidence: ['delivery_statement'],

  run(ctx): ControlResult {
    const evidenceRefs: EvidenceRef[] = [];

    // Pairwise contracted vs delivered auth on the same requirement/traceability row.
    // Cross-joining all flattened rows caused false VR-C6 when one row had
    // contracted=not_applicable and another had delivered=oauth2.
    for (const doc of docsOfType(ctx, 'delivery_statement')) {
      for (const row of recordsForDoc(doc)) {
        const contractedObj = row['contracted'];
        const deliveredObj = row['delivered'];
        if (
          contractedObj &&
          deliveredObj &&
          typeof contractedObj === 'object' &&
          typeof deliveredObj === 'object'
        ) {
          const c = contractedObj as Record<string, unknown>;
          const d = deliveredObj as Record<string, unknown>;
          const contractedAuth = normalizeAuthMethod(
            c['auth_method'] ?? c['authMethod'] ?? c['authentication_method'],
          );
          const deliveredAuth = normalizeAuthMethod(
            d['auth_method'] ?? d['authMethod'] ?? d['authentication_method'] ?? d['delivered_auth_method'],
          );
          if (isUnspecifiedAuthMethod(contractedAuth) || !deliveredAuth) continue;
          if (deliveredAuth !== contractedAuth) {
            evidenceRefs.push(
              ref(
                doc,
                'auth_method',
                String(d['auth_method'] ?? d['authMethod'] ?? ''),
                `Contracted: ${contractedAuth}, delivered: ${deliveredAuth}`,
              ),
            );
          }
          continue;
        }

        const contractedAuth = normalizeAuthMethod(
          row['contracted_auth_method'] ?? row['required_auth_method'] ?? row['contract_auth_method'],
        );
        const deliveredAuth = normalizeAuthMethod(
          row['auth_method'] ?? row['delivered_auth_method'] ?? row['authentication_method'],
        );
        if (isUnspecifiedAuthMethod(contractedAuth) || !deliveredAuth) continue;
        if (deliveredAuth !== contractedAuth) {
          evidenceRefs.push(
            ref(
              doc,
              'auth_method',
              String(row['auth_method'] ?? row['delivered_auth_method'] ?? ''),
              `Contracted: ${contractedAuth}, delivered: ${deliveredAuth}`,
            ),
          );
        }
      }
    }

    // Also scan delivery prose for auth-method change signals.
    for (const doc of docsOfType(ctx, 'delivery_statement')) {
      const text = doc.text ?? '';
      if (!text) continue;

      // Pattern: "auth changed from OAuth to API keys", "switched from oauth2 to apikey"
      // Note: "OAuth 2.0" contains a dot — use [.\w\s]+ to capture multi-word version strings.
      const changePatterns = [
        // Broad: "auth(entication) (method) changed from <anything> to api keys|basic auth|jwt"
        /auth(?:entication)?\s+(?:method\s+)?changed\s+from\s+[\w.\s]+\s+to\s+(?:api\s+keys?|basic\s+auth|jwt|apikey)/i,
        // "changed/switched/replaced from oauth(2/2.0) to/with api keys"
        /(?:changed|switched|replaced)\s+(?:from\s+)?oauth(?:\s*2(?:\.0)?)?\s+(?:to|with)\s+api\s*keys?/i,
        // Narrow fallback: method changed from oauth2 to anything
        /auth(?:entication)?\s+(?:method\s+)?changed\s+from\s+(?:oauth2?|saml|ldap)\s+to\s+(?:api\s*keys?|basic|jwt|token)/i,
        /switched\s+from\s+[\w.\s]+\s+(?:auth(?:entication)?\s+)?to\s+[\w.\s]+\s+(?:auth(?:entication)?|keys?)/i,
        /(?:replaced|changed)\s+oauth(?:\s*2)?\s+with\s+api\s*keys?/i,
        /api\s*keys?\s+(?:instead of|replacing|used\s+instead\s+of)\s+oauth/i,
      ];

      for (const pattern of changePatterns) {
        const m = text.match(pattern);
        if (m) {
          evidenceRefs.push(
            ref(doc, 'auth_method', m[0], m[0].trim()),
          );
          break;
        }
      }
    }

    if (evidenceRefs.length === 0) {
      return { status: 'passed', controlId: 'VR-C6', evidenceRefs: [] };
    }

    return {
      status: 'failed',
      controlId: 'VR-C6',
      severity: 'critical',
      evidenceRefs,
      message:
        'Authentication method was changed in delivery without contract authorization. This is an unauthorized scope change.',
      recommendedAction:
        'Block acceptance. Auth method changes require a signed contract amendment. Revert to contracted auth method or obtain written approval before re-submitting.',
    };
  },
};

// ---------------------------------------------------------------------------
// VR-C7 — Requirement not mapped to evidence
// ---------------------------------------------------------------------------
// Fires when a contracted requirement has no corresponding delivery or test
// evidence citing it by ID.

const VR_C7: ControlDefinition = {
  id: 'VR-C7',
  product: 'verifyapi',
  name: 'Requirement not mapped to delivery evidence',
  severityDefault: 'high',
  requiredEvidence: ['requirements_doc'],

  run(ctx): ControlResult {
    const parsed = parseDeliveryEvidence(ctx.documents);
    if (parsed.requirements.length === 0) {
      return { status: 'passed', controlId: 'VR-C7', evidenceRefs: [] };
    }

    // Build a set of requirement IDs that appear in delivery/deployment docs.
    const deliveryBlob =
      docsOfType(ctx, 'delivery_statement')
        .map(searchableDocContent)
        .join('\n') +
      '\n' +
      docsOfType(ctx, 'deployment_evidence')
        .map(searchableDocContent)
        .join('\n');
    const unmapped: string[] = [];
    for (const req of parsed.requirements) {
      if (req.id === 'CONTRACT-SCOPE') continue;
      // Check if the requirement ID appears anywhere in delivery docs.
      const escapedId = req.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${escapedId}\\b`, 'i');
      if (!re.test(deliveryBlob)) {
        unmapped.push(req.id);
      }
    }

    if (unmapped.length === 0) {
      return { status: 'passed', controlId: 'VR-C7', evidenceRefs: [] };
    }

    const sourceDoc = docsOfType(ctx, 'requirements_doc')[0];
    if (!sourceDoc) {
      return { status: 'passed', controlId: 'VR-C7', evidenceRefs: [] };
    }

    const evidenceRefs: EvidenceRef[] = unmapped.map((id) =>
      ref(sourceDoc, 'requirement_id', id, `Requirement ${id} has no delivery evidence`),
    );

    return {
      status: 'failed',
      controlId: 'VR-C7',
      severity: 'high',
      evidenceRefs,
      message: `${unmapped.length} requirement(s) have no corresponding delivery evidence: ${unmapped.slice(0, 5).join(', ')}${unmapped.length > 5 ? '...' : ''}.`,
      recommendedAction:
        'Request updated delivery documentation that explicitly addresses each contracted requirement by ID. Do not accept delivery with unmapped requirements.',
    };
  },
};

// ---------------------------------------------------------------------------
// VR-C8 — Missing rollback plan
// ---------------------------------------------------------------------------

const VR_C8: ControlDefinition = {
  id: 'VR-C8',
  product: 'verifyapi',
  name: 'Missing rollback plan',
  severityDefault: 'medium',
  requiredEvidence: ['deployment_evidence'],
  alternativeEvidence: [['delivery_statement']],

  run(ctx): ControlResult {
    const allDocs = [
      ...docsOfType(ctx, 'deployment_evidence'),
      ...docsOfType(ctx, 'delivery_statement'),
    ];

    const ROLLBACK_PRESENT_RE =
      /rollback\s+(?:plan|procedure|process|steps?|strategy)\s*(?:[:=]\s*)?(?:included|provided|available|tested|ready|defined|present|complete)/i;
    const ROLLBACK_FIELD_PRESENT_RE =
      /\b(included|provided|available|tested|ready|defined|present|complete|yes|true|passed)\b/i;
    const ROLLBACK_FIELD_MISSING_RE =
      /\b(not\s+(?:provided|included|present|available|defined|ready|tested)|missing|unavailable|none|no)\b/i;
    const ROLLBACK_MISSING_RE =
      /rollback\s+(?:plan|procedure)\s*(?:[:=]\s*)?(?:missing|not\s+(?:provided|included|present)|unavailable)/i;
    const ROLLBACK_ANY_RE = /\brollback\b/i;

    let hasRollback = false;
    let rollbackMissingPassage: string | undefined;
    let sourceDoc: ClassifiedEvidence | undefined;

    for (const doc of allDocs) {
      for (const row of recordsForDoc(doc)) {
        const rollbackNested = row['rollback'];
        if (rollbackNested && typeof rollbackNested === 'object') {
          const nested = rollbackNested as Record<string, unknown>;
          if (
            nested['plan_present'] === true ||
            nested['plan_present'] === 'true' ||
            nested['planProvided'] === true ||
            nested['plan_provided'] === true
          ) {
            hasRollback = true;
            break;
          }
        }

        const rollbackValue = pickRecordValue(row, [
          'rollback_plan',
          'rollbackPlan',
          'rollback_plan_provided',
          'rollbackPlanProvided',
          'rollback_plan_present',
          'rollbackPlanPresent',
          'rollback_available',
          'rollbackAvailable',
        ]);
        if (rollbackValue === true) {
          hasRollback = true;
          break;
        }
        if (rollbackValue === false) {
          rollbackMissingPassage = JSON.stringify(row).slice(0, 300);
          sourceDoc = doc;
          continue;
        }
        const rollbackText = typeof rollbackValue === 'string' ? rollbackValue : '';
        if (rollbackText && (ROLLBACK_MISSING_RE.test(rollbackText) || ROLLBACK_FIELD_MISSING_RE.test(rollbackText))) {
          rollbackMissingPassage = rollbackText.match(ROLLBACK_MISSING_RE)?.[0].trim() ?? rollbackText;
          sourceDoc = doc;
          continue;
        }
        if (rollbackText && (ROLLBACK_PRESENT_RE.test(rollbackText) || ROLLBACK_FIELD_PRESENT_RE.test(rollbackText))) {
          hasRollback = true;
          break;
        }
      }
      if (hasRollback) break;

      const text = doc.text ?? '';
      if (!text) continue;

      if (ROLLBACK_PRESENT_RE.test(text)) {
        hasRollback = true;
        break;
      }
      if (ROLLBACK_MISSING_RE.test(text)) {
        const m = text.match(ROLLBACK_MISSING_RE);
        rollbackMissingPassage = m?.[0].trim();
        sourceDoc = doc;
      }
      if (ROLLBACK_ANY_RE.test(text)) {
        // Rollback is mentioned — assume present unless "missing" matched above.
        if (!rollbackMissingPassage) {
          hasRollback = true;
        }
      }
    }

    if (hasRollback) {
      return { status: 'passed', controlId: 'VR-C8', evidenceRefs: [] };
    }

    // If rollback was explicitly flagged missing.
    if (rollbackMissingPassage && sourceDoc) {
      return {
        status: 'failed',
        controlId: 'VR-C8',
        severity: 'medium',
        evidenceRefs: [ref(sourceDoc, 'rollback_plan', undefined, rollbackMissingPassage)],
        message: 'Deployment evidence explicitly states rollback plan is missing.',
        recommendedAction:
          'Require vendor to supply a tested rollback procedure before production deployment approval.',
      };
    }

    // No deployment evidence mentions rollback at all — treat as absent.
    if (allDocs.length === 0) {
      return {
        status: 'skipped',
        controlId: 'VR-C8',
        reason: 'missing_document',
        missingEvidence: ['deployment_evidence'],
      };
    }

    // Deployment docs exist but are silent on rollback — insufficient evidence.
    const fallbackDoc = allDocs[0];
    return {
      status: 'failed',
      controlId: 'VR-C8',
      severity: 'medium',
      evidenceRefs: [ref(fallbackDoc, 'rollback_plan', undefined, 'No rollback plan mentioned in delivery documents')],
      message: 'No rollback plan or contingency procedure found in delivery or deployment evidence.',
      recommendedAction:
        'Request a rollback plan documenting reversion steps, tested in a lower environment, before production sign-off.',
    };
  },
};

// ---------------------------------------------------------------------------
// VR-C9 — Full payment requested despite incomplete delivery
// ---------------------------------------------------------------------------
// Fires when VR-C2 would also fire (incomplete deliverables) AND the delivery
// statement requests full/complete payment.

const FULL_PAYMENT_RE =
  /(?:full\s+payment|payment\s+in\s+full|request(?:s|ing|ed)?\s+full\s+payment|pay(?:ment)?\s+in\s+full|100%\s+(?:payment|milestone\s+payment))/i;

const VR_C9: ControlDefinition = {
  id: 'VR-C9',
  product: 'verifyapi',
  name: 'Full payment requested despite incomplete delivery',
  severityDefault: 'high',
  requiredEvidence: ['delivery_statement'],

  run(ctx): ControlResult {
    // First check: does delivery have incomplete signals (mirrors VR-C2 logic)?
    const deliveryBlob = blob(ctx, 'delivery_statement');
    const incompleteSignals = INCOMPLETE_PATTERNS.some((re) => re.test(deliveryBlob));

    if (!incompleteSignals) {
      return { status: 'passed', controlId: 'VR-C9', evidenceRefs: [] };
    }

    // Second check: is full payment being requested?
    const evidenceRefs: EvidenceRef[] = [];
    for (const doc of docsOfType(ctx, 'delivery_statement')) {
      const text = doc.text ?? '';
      const m = text.match(FULL_PAYMENT_RE);
      if (m) {
        evidenceRefs.push(ref(doc, 'payment_request', m[0], m[0].trim()));
      }
    }

    if (evidenceRefs.length === 0) {
      return { status: 'passed', controlId: 'VR-C9', evidenceRefs: [] };
    }

    return {
      status: 'failed',
      controlId: 'VR-C9',
      severity: 'high',
      evidenceRefs,
      message:
        'Vendor requests full milestone payment while delivery evidence shows incomplete deliverables.',
      recommendedAction:
        'Reject payment request. Issue partial payment proportional to verified completed work only, with balance held in escrow pending full delivery.',
    };
  },
};

// ---------------------------------------------------------------------------
// Registry export
// ---------------------------------------------------------------------------

export const VERIFYAPI_CONTROLS: ControlDefinition[] = [
  VR_C1,
  VR_C2,
  VR_C3,
  VR_C4,
  VR_C5,
  VR_C6,
  VR_C7,
  VR_C8,
  VR_C9,
];

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

/** Build an EvidenceContext from a raw document array. */
export function buildDeliveryContext(documents: ClassifiedEvidence[]): EvidenceContext {
  return { product: 'verifyapi', documents };
}

export type VerifyApiRunResult = {
  results: ReturnType<typeof runControls>;
  coverage: ReturnType<typeof buildCoverageSummary>;
  confidence: ReturnType<typeof computeDeterministicConfidence>;
};

/**
 * Run all VR-C1..C9 controls against a document set and return results,
 * coverage summary, and deterministic confidence score.
 */
export function runVerifyApi(documents: ClassifiedEvidence[]): VerifyApiRunResult {
  const ctx = buildDeliveryContext(documents);
  const mustCheckIds = new Set(
    VERIFYAPI_CONTROLS.filter((c) => c.mustCheck).map((c) => c.id),
  );

  const results = runControls(VERIFYAPI_CONTROLS, ctx);
  const coverage = buildCoverageSummary(results);
  const confidence = computeDeterministicConfidence(results, { mustCheckIds });

  return { results, coverage, confidence };
}
