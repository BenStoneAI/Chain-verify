// AuditProof deterministic control registry — AP-C1 through AP-C11.
//
// Every control body can assume its required evidence exists (the kernel gates
// on requiredEvidence/alternativeEvidence before calling run()). Controls that
// find NO signal (evidence present but no problems detected) return 'passed'
// with the evidence refs that were examined. Controls whose specific field is
// present-but-uninterpretable return 'skipped' with reason 'field_absent' or
// 'uninterpretable' — NEVER a silent pass.

import {
  runControls,
  buildCoverageSummary,
  computeDeterministicConfidence,
} from '../proof-kernel/registry.js';
import type {
  ControlDefinition,
  ControlResult,
  EvidenceContext,
  EvidenceRef,
} from '../proof-kernel/types.js';
import type { ClassifiedEvidence } from '../ingestion/evidence-input.js';
import {
  parseAuditEvidence,
  isInPast,
  isOlderThanMonths,
  type ApprovalMatrixEntry,
  type ExceptionLogItem,
  type RiskRegisterItem,
  type SignatureRecord,
  type Policy,
} from '../models/audit-models.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Build an EvidenceRef pointing at an approval matrix row. */
function matrixRef(
  entry: ApprovalMatrixEntry,
  field?: string,
  rawValue?: string,
): EvidenceRef {
  return {
    documentId: entry._docId,
    documentType: 'approval_matrix',
    field,
    rawValue: rawValue ?? (field ? String(entry._raw[field] ?? '') : undefined),
    sectionHeading: 'Approval Matrix',
    sourcePassage: `Role: ${entry.role}`,
  };
}

/** Build an EvidenceRef pointing at a risk register row. */
function riskRef(item: RiskRegisterItem, field?: string, rawValue?: string): EvidenceRef {
  return {
    documentId: item._docId,
    documentType: 'risk_register',
    field,
    rawValue,
    sectionHeading: 'Risk Register',
    sourcePassage: item.id ? `Risk ID: ${item.id} — ${item.description}` : item.description,
  };
}

/** Build an EvidenceRef pointing at an exception log row. */
function exceptionRef(
  item: ExceptionLogItem,
  field?: string,
  rawValue?: string,
): EvidenceRef {
  return {
    documentId: item._docId,
    documentType: 'exception_log',
    field,
    rawValue,
    sectionHeading: 'Exception Log',
    sourcePassage: item.id ? `Exception ID: ${item.id} — ${item.description}` : item.description,
  };
}

/** Build an EvidenceRef pointing at a policy section. */
function policyRef(
  policy: Policy,
  field?: string,
  rawValue?: string,
  passage?: string,
): EvidenceRef {
  return {
    documentId: policy._docId,
    documentType: 'policy',
    filename: policy._filename,
    field,
    rawValue,
    sectionHeading: policy.title,
    sourcePassage: passage,
  };
}

/** Build an EvidenceRef pointing at a signature record. */
function sigRef(sig: SignatureRecord, field?: string, rawValue?: string): EvidenceRef {
  return {
    documentId: sig._docId,
    documentType: 'approval_matrix',
    field,
    rawValue,
    sectionHeading: 'Signatures',
    sourcePassage: `Role: ${sig.role}${sig.name ? ` (${sig.name})` : ''}`,
  };
}

// ─── Evidence normalization helpers (buildAuditContext) ──────────────────────
//
// AuditProof evidence commonly arrives as JSON wrapped under its logical
// evidence-splitter key, e.g. `{ approval_matrix: [...] }` or `{ policies: [...] }`
// (see evidence-splitter.ts's AUDITPROOF_PROOF_INPUT_KEYS). The shared tabular/JSON
// normalizer (invoice-normalizer.ts's parseInput, built for InvoiceProof rows) has
// no invoice-shaped signal to key off of and falls back to treating the WHOLE
// wrapper object as a single opaque row: `rows === [{ approval_matrix: [...] }]`.
// Every per-item field (role, signed, owner, impact, mitigationDue, ...) is then
// invisible to the per-document-type parsers in audit-models.ts, which only ever
// look at `doc.rows[i]` directly — so controls silently see zero real approval
// rows / risk rows / exception rows and either report a false "all good" pass or,
// worse, synthesize a single bogus item (e.g. from an explicitly *empty* wrapped
// array) that then fails a control for the wrong reason.
//
// buildAuditContext() runs every document's `rows` through this normalization
// pass BEFORE constructing the EvidenceContext, so every control body — and
// audit-models.ts's parsers, unmodified — see the real per-item rows with
// alias-normalized keys.

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Detect the "one row, one key, array/object value" wrapper shape produced when
 * a JSON evidence bucket is parsed without any invoice-shaped columns to key off
 * of, and unwrap it into the real per-item rows.
 *   - `{ key: [ {...}, {...} ] }` -> the array items themselves become the rows.
 *   - `{ key: [] }` (explicitly empty)  -> zero rows (NOT one phantom row).
 *   - `{ key: {...} }` (single object)  -> one row: that object.
 * Intentionally narrow: only fires on a single row with a single top-level key,
 * so genuinely tabular/multi-column data (CSV, prose-extracted rows, multi-row
 * JSON arrays) is never touched.
 */
function unwrapContainerRows(rows: PlainObject[]): PlainObject[] {
  if (rows.length !== 1) return rows;
  const [row] = rows;
  const keys = Object.keys(row);
  if (keys.length !== 1) return rows;
  const value = row[keys[0]];
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (value.every(isPlainObject)) return value as PlainObject[];
    return rows;
  }
  if (isPlainObject(value)) return [value];
  return rows;
}

/** camelCase / snake_case / kebab-case -> lowercase, space-separated words. */
function spacedKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Field-name variants audit-models.ts's own pick() alias lists cannot already
// resolve because they are singular/plural mismatches rather than spacing/casing
// differences (camelCase compounds are already handled generically by spacedKey
// above, e.g. "mitigationDue" -> "mitigation due" already matches an existing
// alias). Maps a normalized incoming key to the exact alias string audit-models.ts
// already recognizes for that field, so audit-models.ts itself never needs to
// change.
const EXTRA_FIELD_ALIASES: Record<string, string> = {
  'is signed': 'signed',
  detail: 'description',
};

/**
 * Add alias-normalized DUPLICATE keys to a row so audit-models.ts's existing,
 * already-lenient pick() alias lists can resolve camelCase or singular/plural
 * field-name variants they were not written to expect ("approverRole",
 * "mitigationDue", "assignedTo", "isSigned", "detail", ...). Purely additive —
 * never overwrites an existing key, so original data and precedence are
 * preserved.
 */
function expandAliasKeys(row: PlainObject): PlainObject {
  const out: PlainObject = { ...row };
  for (const [key, value] of Object.entries(row)) {
    if (value === undefined) continue;
    const spaced = spacedKey(key);
    const collapsedOriginal = key.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (spaced && spaced !== collapsedOriginal && !(spaced in out)) {
      out[spaced] = value;
    }
    const explicit = EXTRA_FIELD_ALIASES[spaced] ?? EXTRA_FIELD_ALIASES[collapsedOriginal];
    if (explicit && !(explicit in out)) {
      out[explicit] = value;
    }
  }
  return out;
}

// Approval-matrix duty MARKERS (e.g. `requester: true` / `approver: true`) are not
// consumed anywhere in audit-models.ts's parseApprovalMatrix — it only derives
// requester/approver signal from role TEXT keywords or a 'type'/'duty'/'category'
// marker field. A row shaped `{ role: 'AP Clerk', requester: true }` carries no
// such keyword, so AP-C2's existing role-text heuristics silently miss it. These
// helpers read the raw duty flags directly by KEY NAME (never by incidental value
// text) so AP-C2 can detect this shape without touching audit-models.ts.
const REQUESTER_FLAG_ALIASES = ['requester', 'is requester', 'requested by'];
const APPROVER_FLAG_ALIASES = ['approver', 'is approver', 'approved by'];
const TRUTHY_FLAG_PATTERN = /^(true|yes|y|1|x)$/i;

function rawFlagTrue(raw: Record<string, unknown> | undefined, aliases: string[]): boolean {
  if (!raw) return false;
  const wanted = new Set(aliases.map(spacedKey));
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (!wanted.has(spacedKey(rawKey))) continue;
    if (rawValue === true || rawValue === 1) return true;
    if (typeof rawValue === 'string' && TRUTHY_FLAG_PATTERN.test(rawValue.trim())) return true;
  }
  return false;
}

/**
 * True if a raw evidence row carries at least one non-blank value. Guards against
 * "phantom" items — an explicitly empty source array that still yielded a wrapper
 * row (see unwrapContainerRows), or a genuinely empty `{}` entry inside an array —
 * from being counted as a real open exception/finding just because a parser fell
 * back to a 'No description' placeholder.
 */
function hasMeaningfulContent(raw: Record<string, unknown> | undefined): boolean {
  if (!raw) return false;
  return Object.values(raw).some((v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    return true;
  });
}

// ─── Impact/likelihood severity helpers ──────────────────────────────────────

const HIGH_IMPACT_TOKENS = [
  'high',
  'critical',
  'severe',
  'very high',
  '5',
  '4',
  'catastrophic',
  'significant',
];
const HIGH_LIKELIHOOD_TOKENS = ['high', 'very high', 'frequent', 'likely', '5', '4', 'probable'];

function isHighImpact(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  return HIGH_IMPACT_TOKENS.some((t) => s.includes(t));
}

function isHighLikelihood(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.toLowerCase();
  return HIGH_LIKELIHOOD_TOKENS.some((t) => s.includes(t));
}

function isHighRisk(item: RiskRegisterItem): boolean {
  return isHighImpact(item.impact) || isHighLikelihood(item.likelihood);
}

// ─── Control bodies ───────────────────────────────────────────────────────────

// AP-C1: Missing executive signature
// Required approver/exec roles are present in the approval matrix but unsigned.
const AP_C1: ControlDefinition = {
  id: 'AP-C1',
  product: 'auditproof',
  name: 'Missing executive signature',
  severityDefault: 'critical',
  requiredEvidence: ['approval_matrix'],
  alternativeEvidence: [['policy']],
  mustCheck: true,
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);

    // First priority: explicit signature records from the approval matrix.
    const unsigned: SignatureRecord[] = ev.signatures.filter(
      (s) => !s.signed && isExecOrApprover(s.role),
    );

    if (ev.signatures.length === 0 && ev.approvalMatrix.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C1',
        reason: 'field_absent',
        missingEvidence: ['signature fields in approval_matrix'],
      };
    }

    if (unsigned.length > 0) {
      return {
        status: 'failed',
        controlId: 'AP-C1',
        severity: 'critical',
        evidenceRefs: unsigned.map((s) => sigRef(s, 'signed', String(s._raw['signed'] ?? ''))),
        recommendedAction:
          'Obtain sign-off from all required executive/approver roles before considering this audit complete.',
        message: `${unsigned.length} required executive/approver role(s) have not signed off: ${unsigned.map((s) => s.role).join('; ')}.`,
      };
    }

    // All signatures present are signed — surface them as positive citations.
    const refs: EvidenceRef[] = ev.signatures.slice(0, 5).map((s) => sigRef(s, 'signed'));
    return { status: 'passed', controlId: 'AP-C1', evidenceRefs: refs };
  },
};

const EXEC_ROLES = [
  'cfo',
  'ceo',
  'coo',
  'cto',
  'chief',
  'vp',
  'vice president',
  'director',
  'executive',
  'svp',
  'evp',
  'president',
  'controller',
  'treasurer',
  'approver',
  'authorizer',
  'authorized',
  'signatory',
];

function isExecOrApprover(role: string): boolean {
  const r = role.toLowerCase();
  return EXEC_ROLES.some((t) => r.includes(t));
}

// AP-C2: Segregation of duties violation
// Same person appears as both requester and approver, OR one role has both flags.
const AP_C2: ControlDefinition = {
  id: 'AP-C2',
  product: 'auditproof',
  name: 'Segregation of duties violation',
  severityDefault: 'critical',
  requiredEvidence: ['approval_matrix'],
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);
    if (ev.approvalMatrix.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C2',
        reason: 'field_absent',
        missingEvidence: ['approval_matrix rows'],
      };
    }

    // Find entries that are both requester and approver (by role keywords).
    const violations: ApprovalMatrixEntry[] = [];
    const addViolation = (e: ApprovalMatrixEntry) => {
      if (!violations.includes(e)) violations.push(e);
    };

    // Case 1: a single entry whose role text contains BOTH requester and approver signals.
    for (const entry of ev.approvalMatrix) {
      const r = entry.role.toLowerCase();
      const hasApprover = /approv|authoriz|sign/i.test(r);
      const hasRequester = /requester|requestor|initiat|prepar|submitter/i.test(r);
      if (hasApprover && hasRequester) {
        addViolation(entry);
      }
    }

    // Case 2: same name or same person appears in both a requester-type and an approver-type row.
    const namesToRoles: Record<string, string[]> = {};
    for (const entry of ev.approvalMatrix) {
      const name = (entry.approverName ?? entry.role).trim().toLowerCase();
      if (!namesToRoles[name]) namesToRoles[name] = [];
      namesToRoles[name].push(entry.role);
    }

    for (const [name, roles] of Object.entries(namesToRoles)) {
      // Skip generic/empty role labels.
      if (!name || name.length < 2) continue;
      const hasApprover = roles.some((r) => /approv|authoriz|sign/i.test(r));
      const hasRequester = roles.some((r) =>
        /requester|requestor|initiat|prepar|submitter/i.test(r),
      );
      if (hasApprover && hasRequester) {
        // Find the entries for citation.
        const conflicting = ev.approvalMatrix.filter(
          (e) => (e.approverName ?? e.role).trim().toLowerCase() === name,
        );
        conflicting.forEach(addViolation);
      }
    }

    // Case 3: explicit requester/approver DUTY FLAGS on the raw row (e.g.
    // `requester: true` / `approver: true`, or is_/By-suffixed variants). Role
    // text alone (Cases 1-2) misses this shape entirely whenever the role is a
    // plain job title ("AP Clerk") that carries no approv/request keyword — the
    // only signal is the boolean duty marker itself.
    const flagBucketsByName: Record<
      string,
      { requester: boolean; approver: boolean; entries: ApprovalMatrixEntry[] }
    > = {};
    for (const entry of ev.approvalMatrix) {
      const hasRequesterFlag = rawFlagTrue(entry._raw, REQUESTER_FLAG_ALIASES);
      const hasApproverFlag = rawFlagTrue(entry._raw, APPROVER_FLAG_ALIASES);

      // Same row carries both flags.
      if (hasRequesterFlag && hasApproverFlag) {
        addViolation(entry);
      }

      const name = (entry.approverName ?? entry.role).trim().toLowerCase();
      if (!name || name.length < 2) continue;
      const bucket = flagBucketsByName[name] ?? { requester: false, approver: false, entries: [] };
      bucket.requester = bucket.requester || hasRequesterFlag;
      bucket.approver = bucket.approver || hasApproverFlag;
      bucket.entries.push(entry);
      flagBucketsByName[name] = bucket;
    }
    for (const bucket of Object.values(flagBucketsByName)) {
      if (bucket.requester && bucket.approver) {
        bucket.entries.forEach(addViolation);
      }
    }

    if (violations.length > 0) {
      return {
        status: 'failed',
        controlId: 'AP-C2',
        severity: 'critical',
        evidenceRefs: violations.map((e) =>
          matrixRef(e, 'role', e.role),
        ),
        recommendedAction:
          'Separate the requester and approver roles so no individual can both initiate and authorize the same transaction.',
        message: `Segregation of duties conflict detected: ${violations.map((e) => `"${e.role}"`).join('; ')} holds conflicting requester/approver duties.`,
      };
    }

    const refs: EvidenceRef[] = ev.approvalMatrix.slice(0, 3).map((e) => matrixRef(e, 'role'));
    return { status: 'passed', controlId: 'AP-C2', evidenceRefs: refs };
  },
};

// AP-C3: Lapsed policy review
// nextReviewDue is in the past, OR reviewDate is older than 12 months.
const AP_C3: ControlDefinition = {
  id: 'AP-C3',
  product: 'auditproof',
  name: 'Lapsed policy review',
  severityDefault: 'high',
  requiredEvidence: ['policy'],
  mustCheck: true,
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);
    if (ev.policies.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C3',
        reason: 'field_absent',
        missingEvidence: ['policy review date fields'],
      };
    }

    const lapsed: Array<{ policy: Policy; reason: string; dateRaw: string }> = [];

    for (const policy of ev.policies) {
      if (policy.nextReviewDue && !policy.nextReviewDue.unparseable) {
        if (isInPast(policy.nextReviewDue)) {
          lapsed.push({
            policy,
            reason: 'nextReviewDue is in the past',
            dateRaw: policy.nextReviewDue.raw,
          });
        }
        // nextReviewDue is present and parseable — it is the authoritative freshness
        // indicator. Do NOT also evaluate reviewDate for this policy; a future
        // nextReviewDue overrides an old last-reviewed date.
        continue;
      }
      // Only fall through to reviewDate when nextReviewDue is absent or unparseable.
      if (policy.reviewDate && !policy.reviewDate.unparseable) {
        if (isOlderThanMonths(policy.reviewDate, 12)) {
          lapsed.push({
            policy,
            reason: 'last review date is older than 12 months',
            dateRaw: policy.reviewDate.raw,
          });
        }
      }
    }

    if (lapsed.length > 0) {
      return {
        status: 'failed',
        controlId: 'AP-C3',
        severity: 'high',
        evidenceRefs: lapsed.map(({ policy, reason, dateRaw }) =>
          policyRef(
            policy,
            lapsed[0].reason.includes('next') ? 'nextReviewDue' : 'reviewDate',
            dateRaw,
            reason,
          ),
        ),
        recommendedAction:
          'Schedule an immediate policy review. Update the review date and next-review-due date once the review is complete.',
        message: `${lapsed.length} policy document(s) have a lapsed review schedule: ${lapsed.map((l) => `"${l.policy.title}" (${l.reason}: ${l.dateRaw})`).join('; ')}.`,
      };
    }

    // If policies exist but have no parseable dates, we cannot determine lapse.
    const hasDates = ev.policies.some((p) => p.reviewDate?.iso || p.nextReviewDue?.iso);
    if (!hasDates) {
      return {
        status: 'skipped',
        controlId: 'AP-C3',
        reason: 'field_absent',
        missingEvidence: ['review_date', 'next_review_due'],
      };
    }

    const refs: EvidenceRef[] = ev.policies.slice(0, 3).map((p) =>
      policyRef(
        p,
        p.nextReviewDue ? 'nextReviewDue' : 'reviewDate',
        (p.nextReviewDue ?? p.reviewDate)?.raw,
      ),
    );
    return { status: 'passed', controlId: 'AP-C3', evidenceRefs: refs };
  },
};

// AP-C4: Missing banking change procedure
// No policy or procedure text covers vendor bank/banking change controls.
const AP_C4: ControlDefinition = {
  id: 'AP-C4',
  product: 'auditproof',
  name: 'Missing banking change procedure',
  severityDefault: 'high',
  requiredEvidence: ['policy'],
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);
    if (ev.policies.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C4',
        reason: 'field_absent',
        missingEvidence: ['policy text'],
      };
    }

    const BANK_CHANGE_KEYWORDS = [
      'bank account change',
      'banking change',
      'vendor bank',
      'bank routing change',
      'change of bank',
      'change banking',
      'payment detail change',
      'payment details change',
      'bank detail',
      'banking detail',
      'remittance change',
      'ach change',
      'wire change',
      'bec',
      'business email compromise',
    ];

    for (const policy of ev.policies) {
      const lower = policy.text.toLowerCase();
      const hit = BANK_CHANGE_KEYWORDS.find((kw) => lower.includes(kw));
      if (hit) {
        return {
          status: 'passed',
          controlId: 'AP-C4',
          evidenceRefs: [policyRef(policy, undefined, undefined, `Keyword found: "${hit}"`)],
        };
      }
    }

    // No policy covers bank change — this is a gap.
    return {
      status: 'failed',
      controlId: 'AP-C4',
      severity: 'high',
      evidenceRefs: ev.policies.map((p) => policyRef(p)),
      recommendedAction:
        'Add a vendor banking change procedure to your AP policy: require dual-approval, out-of-band verification, and a mandatory waiting period before any new banking details are used for payment.',
      message:
        'No policy document contains a procedure for handling vendor banking/payment detail changes (BEC risk).',
    };
  },
};

// AP-C5: Unowned high risk
// A risk register entry with high impact or likelihood has no owner assigned.
const AP_C5: ControlDefinition = {
  id: 'AP-C5',
  product: 'auditproof',
  name: 'Unowned high risk',
  severityDefault: 'high',
  requiredEvidence: ['risk_register'],
  mustCheck: true,
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);
    if (ev.risks.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C5',
        reason: 'field_absent',
        missingEvidence: ['risk_register rows'],
      };
    }

    const unowned = ev.risks.filter((r) => isHighRisk(r) && !r.owner);

    if (unowned.length > 0) {
      return {
        status: 'failed',
        controlId: 'AP-C5',
        severity: 'high',
        evidenceRefs: unowned.map((r) => riskRef(r, 'owner', '')),
        recommendedAction:
          'Assign a named risk owner to every high-impact or high-likelihood risk. The owner is accountable for monitoring and driving mitigation.',
        message: `${unowned.length} high-severity risk(s) have no owner: ${unowned.map((r) => r.id ?? r.description.slice(0, 40)).join('; ')}.`,
      };
    }

    const highRisks = ev.risks.filter(isHighRisk);
    const refs: EvidenceRef[] = (highRisks.length > 0 ? highRisks : ev.risks)
      .slice(0, 3)
      .map((r) => riskRef(r, 'owner', r.owner));
    return { status: 'passed', controlId: 'AP-C5', evidenceRefs: refs };
  },
};

// AP-C6: Materialized risk
// A risk register entry has a status indicating the risk has occurred/materialized.
const AP_C6: ControlDefinition = {
  id: 'AP-C6',
  product: 'auditproof',
  name: 'Materialized risk',
  severityDefault: 'critical',
  requiredEvidence: ['risk_register'],
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);
    if (ev.risks.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C6',
        reason: 'field_absent',
        missingEvidence: ['risk_register rows'],
      };
    }

    const materialized = ev.risks.filter((r) => r.materialized);

    if (materialized.length > 0) {
      return {
        status: 'failed',
        controlId: 'AP-C6',
        severity: 'critical',
        evidenceRefs: materialized.map((r) => riskRef(r, 'status', r.status)),
        recommendedAction:
          'Escalate materialized risks immediately. Document the incident timeline, activate your incident response plan, and update the risk register with actual impact data.',
        message: `${materialized.length} risk(s) show materialized/realized status: ${materialized.map((r) => `"${r.status ?? 'unknown'}"${r.id ? ` (${r.id})` : ''}`).join('; ')}.`,
      };
    }

    const refs: EvidenceRef[] = ev.risks.slice(0, 3).map((r) => riskRef(r, 'status', r.status));
    return { status: 'passed', controlId: 'AP-C6', evidenceRefs: refs };
  },
};

// AP-C7: Past-due mitigation
// A risk has a mitigationDue date in the past and status is not closed/resolved.
const AP_C7: ControlDefinition = {
  id: 'AP-C7',
  product: 'auditproof',
  name: 'Past-due mitigation',
  severityDefault: 'high',
  requiredEvidence: ['risk_register'],
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);
    if (ev.risks.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C7',
        reason: 'field_absent',
        missingEvidence: ['risk_register rows'],
      };
    }

    const CLOSED_TOKENS = ['closed', 'resolved', 'complete', 'completed', 'done', 'accepted', 'mitigated'];

    const pastDue = ev.risks.filter((r) => {
      if (!r.mitigationDue || r.mitigationDue.unparseable) return false;
      const isClosed = r.status
        ? CLOSED_TOKENS.some((t) => r.status!.toLowerCase().includes(t))
        : false;
      return !isClosed && isInPast(r.mitigationDue);
    });

    if (pastDue.length > 0) {
      return {
        status: 'failed',
        controlId: 'AP-C7',
        severity: 'high',
        evidenceRefs: pastDue.map((r) =>
          riskRef(r, 'mitigationDue', r.mitigationDue?.raw),
        ),
        recommendedAction:
          'Review all overdue mitigations. Either complete the mitigation, extend the due date with documented approval, or formally accept the residual risk.',
        message: `${pastDue.length} risk(s) have past-due mitigations that are not closed: ${pastDue.map((r) => (r.id ?? r.description.slice(0, 40)) + ` (due: ${r.mitigationDue?.raw})`).join('; ')}.`,
      };
    }

    // Surface any items that have mitigation dates for positive citation.
    const withDates = ev.risks.filter((r) => r.mitigationDue?.iso);
    const refs: EvidenceRef[] = (withDates.length > 0 ? withDates : ev.risks)
      .slice(0, 3)
      .map((r) => riskRef(r, 'mitigationDue', r.mitigationDue?.raw ?? r.status));
    return { status: 'passed', controlId: 'AP-C7', evidenceRefs: refs };
  },
};

// AP-C8: Open exception without owner
// An exception log entry with status "open" (or no-status) has no owner.
const AP_C8: ControlDefinition = {
  id: 'AP-C8',
  product: 'auditproof',
  name: 'Open exception without owner',
  severityDefault: 'high',
  requiredEvidence: ['exception_log'],
  mustCheck: true,
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);
    if (ev.exceptions.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C8',
        reason: 'field_absent',
        missingEvidence: ['exception_log rows'],
      };
    }

    const CLOSED_TOKENS = ['closed', 'resolved', 'complete', 'completed', 'done', 'approved'];

    const unowned = ev.exceptions.filter((e) => {
      // Guard against phantom rows: an explicitly empty exception_log array (or a
      // content-free `{}` entry) must never be counted as an "open exception" just
      // because the parser fell back to a 'No description' placeholder.
      if (!hasMeaningfulContent(e._raw)) return false;
      const isClosed = e.status
        ? CLOSED_TOKENS.some((t) => e.status!.toLowerCase().includes(t))
        : false;
      return !isClosed && !e.owner;
    });

    if (unowned.length > 0) {
      return {
        status: 'failed',
        controlId: 'AP-C8',
        severity: 'high',
        evidenceRefs: unowned.map((e) => exceptionRef(e, 'owner', '')),
        recommendedAction:
          'Assign a named owner to every open exception. The owner is responsible for tracking, escalating, and closing the exception within the approved timeframe.',
        message: `${unowned.length} open exception(s) have no owner: ${unowned.map((e) => e.id ?? e.description.slice(0, 40)).join('; ')}.`,
      };
    }

    const refs: EvidenceRef[] = ev.exceptions
      .slice(0, 3)
      .map((e) => exceptionRef(e, 'owner', e.owner));
    return { status: 'passed', controlId: 'AP-C8', evidenceRefs: refs };
  },
};

// AP-C9: Blank/TBD control step
// A policy or approval matrix contains steps that are blank, "TBD", "TODO", or "N/A".
const AP_C9: ControlDefinition = {
  id: 'AP-C9',
  product: 'auditproof',
  name: 'Blank or TBD control step',
  severityDefault: 'medium',
  requiredEvidence: ['policy'],
  alternativeEvidence: [['approval_matrix']],
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);

    const TBD_PATTERN = /\b(tbd|todo|to do|to be determined|n\/a|not applicable|pending|placeholder)\b/i;
    const BLANK_STEP_PATTERN = /^step\s+\d+[:\s]*$/im;

    const hits: Array<{ docId: string; passage: string; docType: string; filename?: string }> = [];

    for (const policy of ev.policies) {
      // Check for TBD in text.
      const lines = policy.text.split(/[\n.]/);
      for (const line of lines) {
        if (TBD_PATTERN.test(line) || BLANK_STEP_PATTERN.test(line)) {
          hits.push({
            docId: policy._docId,
            passage: line.slice(0, 120).trim(),
            docType: 'policy',
            filename: policy._filename,
          });
          if (hits.length >= 5) break;
        }
      }
    }

    // Also check approval matrix rows.
    for (const entry of ev.approvalMatrix) {
      for (const [, v] of Object.entries(entry._raw)) {
        if (TBD_PATTERN.test(String(v ?? ''))) {
          hits.push({
            docId: entry._docId,
            passage: `${entry.role}: ${String(v)}`,
            docType: 'approval_matrix',
          });
          if (hits.length >= 5) break;
        }
      }
    }

    if (hits.length > 0) {
      return {
        status: 'failed',
        controlId: 'AP-C9',
        severity: 'medium',
        evidenceRefs: hits.map((h) => ({
          documentId: h.docId,
          documentType: h.docType,
          filename: h.filename,
          sourcePassage: h.passage,
          field: 'control_step',
          rawValue: h.passage,
        })),
        recommendedAction:
          'Replace all TBD/placeholder control steps with specific, actionable procedures before this policy is considered audit-ready.',
        message: `${hits.length} control step(s) contain TBD/TODO/blank content.`,
      };
    }

    if (ev.policies.length === 0 && ev.approvalMatrix.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C9',
        reason: 'field_absent',
        missingEvidence: ['policy text or approval_matrix rows'],
      };
    }

    const refs: EvidenceRef[] = ev.policies.slice(0, 2).map((p) => policyRef(p));
    return { status: 'passed', controlId: 'AP-C9', evidenceRefs: refs };
  },
};

// AP-C10: Missing vendor onboarding gates
// No policy or approval matrix contains vendor onboarding/approval gate evidence.
const AP_C10: ControlDefinition = {
  id: 'AP-C10',
  product: 'auditproof',
  name: 'Missing vendor onboarding gates',
  severityDefault: 'high',
  requiredEvidence: ['policy'],
  alternativeEvidence: [['approval_matrix']],
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);

    const ONBOARDING_KEYWORDS = [
      'vendor onboarding',
      'supplier onboarding',
      'vendor approval',
      'vendor vetting',
      'vendor qualification',
      'new vendor',
      'new supplier',
      'vendor registration',
      'supplier registration',
      'vendor due diligence',
      'supplier due diligence',
      'onboarding approval',
      'onboarding gate',
    ];

    for (const policy of ev.policies) {
      const lower = policy.text.toLowerCase();
      const hit = ONBOARDING_KEYWORDS.find((kw) => lower.includes(kw));
      if (hit) {
        return {
          status: 'passed',
          controlId: 'AP-C10',
          evidenceRefs: [policyRef(policy, undefined, undefined, `Keyword found: "${hit}"`)],
        };
      }
    }

    // Also check approval matrix role names for onboarding markers.
    for (const entry of ev.approvalMatrix) {
      if (/onboard|new vendor|new supplier|vendor approv/i.test(entry.role)) {
        return {
          status: 'passed',
          controlId: 'AP-C10',
          evidenceRefs: [matrixRef(entry, 'role', entry.role)],
        };
      }
    }

    return {
      status: 'failed',
      controlId: 'AP-C10',
      severity: 'high',
      evidenceRefs: [
        ...ev.policies.slice(0, 2).map((p) => policyRef(p)),
        ...ev.approvalMatrix.slice(0, 2).map((e) => matrixRef(e, 'role')),
      ],
      recommendedAction:
        'Document vendor onboarding gates in your AP policy: define who approves new vendors, what due diligence is required, and how banking details are verified before a first payment.',
      message:
        'No policy or approval matrix evidence of vendor onboarding/approval gates was found.',
    };
  },
};

// AP-C11: Evidence contradicts conclusion
// A document states "compliant" or "audit-ready" while open criticals or unowned risks exist.
const AP_C11: ControlDefinition = {
  id: 'AP-C11',
  product: 'auditproof',
  name: 'Evidence contradicts stated conclusion',
  severityDefault: 'critical',
  requiredEvidence: ['risk_register'],
  alternativeEvidence: [['exception_log']],
  run(ctx: EvidenceContext): ControlResult {
    const ev = parseAuditEvidence(ctx.documents);

    // Gather open-criticals: unowned high risks + open unowned exceptions.
    const CLOSED_TOKENS = ['closed', 'resolved', 'complete', 'completed', 'done'];

    const openHighUnownedRisks = ev.risks.filter((r) => isHighRisk(r) && !r.owner);
    const openUnownedExceptions = ev.exceptions.filter((e) => {
      // Same phantom-row guard as AP-C8 — keep the two controls consistent.
      if (!hasMeaningfulContent(e._raw)) return false;
      const isClosed = e.status ? CLOSED_TOKENS.some((t) => e.status!.toLowerCase().includes(t)) : false;
      return !isClosed && !e.owner;
    });

    const hasOpenCriticals = openHighUnownedRisks.length > 0 || openUnownedExceptions.length > 0;

    // Check if any policy prose claims compliant / audit-ready despite open criticals.
    const POSITIVE_CONCLUSION_KEYWORDS = [
      'compliant',
      'audit-ready',
      'audit ready',
      'in compliance',
      'fully compliant',
      'no findings',
      'all controls effective',
      'all risks closed',
      'all exceptions resolved',
    ];

    const contradictions: Array<{ passage: string; policy: Policy }> = [];
    for (const policy of ev.policies) {
      const lower = policy.text.toLowerCase();
      const hit = POSITIVE_CONCLUSION_KEYWORDS.find((kw) => lower.includes(kw));
      if (hit && hasOpenCriticals) {
        contradictions.push({ passage: `Stated: "${hit}"`, policy });
      }
    }

    if (contradictions.length > 0) {
      const refs: EvidenceRef[] = [
        ...contradictions.map(({ passage, policy }) =>
          policyRef(policy, undefined, undefined, passage),
        ),
        ...openHighUnownedRisks.slice(0, 2).map((r) => riskRef(r, 'owner', '')),
        ...openUnownedExceptions.slice(0, 2).map((e) => exceptionRef(e, 'owner', '')),
      ];
      return {
        status: 'failed',
        controlId: 'AP-C11',
        severity: 'critical',
        evidenceRefs: refs,
        recommendedAction:
          'Remove or qualify the "compliant/audit-ready" statement until all open critical findings and unowned high risks are resolved.',
        message: `Documentation claims a positive compliance conclusion while ${openHighUnownedRisks.length} unowned high risk(s) and ${openUnownedExceptions.length} open unowned exception(s) remain.`,
      };
    }

    // No positive-conclusion claim, or no open criticals — check for consistency.
    if (ev.risks.length === 0 && ev.exceptions.length === 0) {
      return {
        status: 'skipped',
        controlId: 'AP-C11',
        reason: 'field_absent',
        missingEvidence: ['risk_register or exception_log'],
      };
    }

    const refs: EvidenceRef[] = [
      ...ev.risks.slice(0, 2).map((r) => riskRef(r, 'status', r.status)),
      ...ev.exceptions.slice(0, 2).map((e) => exceptionRef(e, 'status', e.status)),
    ];
    return { status: 'passed', controlId: 'AP-C11', evidenceRefs: refs };
  },
};

// ─── Registry export ──────────────────────────────────────────────────────────

export const AUDITPROOF_CONTROLS: ControlDefinition[] = [
  AP_C1,
  AP_C2,
  AP_C3,
  AP_C4,
  AP_C5,
  AP_C6,
  AP_C7,
  AP_C8,
  AP_C9,
  AP_C10,
  AP_C11,
];

// ─── Public API ───────────────────────────────────────────────────────────────

export type AuditProofRunResult = {
  results: ControlResult[];
  coverage: ReturnType<typeof buildCoverageSummary>;
  confidence: ReturnType<typeof computeDeterministicConfidence>;
};

/**
 * Build an EvidenceContext for AuditProof from a set of classified documents.
 *
 * Before handing documents to the control registry, this normalizes each
 * document's `rows`:
 *   1. unwrapContainerRows — undoes the "whole JSON bucket became one opaque
 *      row" shape produced by the shared tabular/JSON normalizer when AuditProof
 *      evidence arrives wrapped under its logical evidence-splitter key (see
 *      evidence-splitter.ts), e.g. `{ approval_matrix: [...] }`,
 *      `{ policies: [...] }`, `{ risk_register: [] }`.
 *   2. expandAliasKeys — adds alias-normalized duplicate keys per row so
 *      audit-models.ts's existing pick() alias lists resolve camelCase /
 *      singular-plural field-name variants (e.g. "approverRole",
 *      "mitigationDue", "assignedTo", "isSigned", "detail") without any change
 *      to audit-models.ts itself.
 * Both steps are additive/narrow — see each helper's doc comment — so already
 * well-formed tabular/prose rows pass through unchanged.
 */
export function buildAuditContext(documents: ClassifiedEvidence[]): EvidenceContext {
  const normalized = documents.map((doc) => {
    if (!doc.rows) return doc;
    const rows = unwrapContainerRows(doc.rows).map(expandAliasKeys);
    return { ...doc, rows };
  });
  return { product: 'auditproof', documents: normalized };
}

/**
 * Run all AuditProof controls against a set of classified evidence documents.
 * Returns control results, coverage summary, and deterministic confidence.
 */
export function runAuditProof(documents: ClassifiedEvidence[]): AuditProofRunResult {
  const ctx = buildAuditContext(documents);
  const mustCheckIds = new Set(
    AUDITPROOF_CONTROLS.filter((c) => c.mustCheck).map((c) => c.id),
  );
  const results = runControls(AUDITPROOF_CONTROLS, ctx);
  const coverage = buildCoverageSummary(results);
  const confidence = computeDeterministicConfidence(results, { mustCheckIds });
  return { results, coverage, confidence };
}
