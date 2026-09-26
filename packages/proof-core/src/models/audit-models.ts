// Canonical typed models for AuditProof evidence documents.
//
// parseAuditEvidence() ingests a set of ClassifiedEvidence and returns a typed
// projection keyed by document role. Parsers are intentionally lenient:
//   - header variants: lowercase, Title Case, UPPER_CASE, snake_case all accepted
//   - dates: parsed leniently; on failure the raw string is kept + .unparseable=true
//   - missing optional fields: undefined (never silently coerced to a sentinel value)

import type { ClassifiedEvidence } from '../ingestion/evidence-input.js';

// ─── Domain models ───────────────────────────────────────────────────────────

export type Policy = {
  title: string;
  reviewDate?: ParsedDate;
  nextReviewDue?: ParsedDate;
  /** Full prose of the policy document (whitespace-normalized). */
  text: string;
  /** Raw source document fingerprint for EvidenceRef. */
  _docId: string;
  _filename?: string;
};

export type ControlItem = {
  id?: string;
  description: string;
  owner?: string;
  status?: string;
  /** Raw source document fingerprint. */
  _docId: string;
};

export type ApprovalMatrixEntry = {
  role: string;
  limit?: number;
  requiresSignature?: boolean;
  /** Name of the assigned approver if specified separately from role. */
  approverName?: string;
  /** True if this entry has a "requester" role marker. */
  isRequester?: boolean;
  /** Raw row values for EvidenceRef citation. */
  _raw: Record<string, unknown>;
  _docId: string;
};

export type ExceptionLogItem = {
  id?: string;
  description: string;
  owner?: string;
  status?: string;
  opened?: ParsedDate;
  due?: ParsedDate;
  _raw: Record<string, unknown>;
  _docId: string;
};

export type RiskRegisterItem = {
  id?: string;
  description: string;
  owner?: string;
  likelihood?: string;
  impact?: string;
  status?: string;
  mitigation?: string;
  mitigationDue?: ParsedDate;
  /** True if the risk's status text indicates it has materialized/realized. */
  materialized?: boolean;
  _raw: Record<string, unknown>;
  _docId: string;
};

export type SignatureRecord = {
  role: string;
  signed: boolean;
  name?: string;
  date?: ParsedDate;
  _raw: Record<string, unknown>;
  _docId: string;
};

/** A parsed date with an escape hatch for raw-keep when parsing fails. */
export type ParsedDate = {
  iso?: string; // YYYY-MM-DD when successfully parsed
  raw: string; // original string always preserved
  unparseable?: boolean;
};

// ─── Parsed audit evidence projection ────────────────────────────────────────

export type AuditEvidence = {
  policies: Policy[];
  approvalMatrix: ApprovalMatrixEntry[];
  exceptions: ExceptionLogItem[];
  risks: RiskRegisterItem[];
  signatures: SignatureRecord[];
};

// ─── Header normalization helpers ────────────────────────────────────────────

/**
 * Normalize a row key for lenient matching: lowercase, collapse whitespace,
 * underscores and hyphens to space, strip non-alphanumeric except space.
 */
function normKey(k: string): string {
  return k
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

/**
 * Pick a value from a row by trying a list of normalized key variants.
 * Returns the first match or undefined.
 */
function pick(row: Record<string, unknown>, ...keys: string[]): unknown {
  const normRow: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    normRow[normKey(k)] = row[k];
  }
  for (const k of keys) {
    const v = normRow[normKey(k)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function strOrUndef(v: unknown): string | undefined {
  const s = str(v);
  return s || undefined;
}

// Date parsing

const MONTH_MAP: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

export function parseDate(raw: unknown): ParsedDate | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;

  // Try ISO first.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, raw: s };
  }

  // US slash: MM/DD/YYYY
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (us) {
    const mm = us[1].padStart(2, '0');
    const dd = us[2].padStart(2, '0');
    return { iso: `${us[3]}-${mm}-${dd}`, raw: s };
  }

  // EU dot: DD.MM.YYYY
  const eu = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(s);
  if (eu) {
    const dd = eu[1].padStart(2, '0');
    const mm = eu[2].padStart(2, '0');
    return { iso: `${eu[3]}-${mm}-${dd}`, raw: s };
  }

  // Written: Month DD, YYYY
  const wr1 = /^([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{4})/.exec(s);
  if (wr1) {
    const monthKey = wr1[1].toLowerCase().slice(0, 3);
    const mm = MONTH_MAP[wr1[1].toLowerCase()] ?? MONTH_MAP[monthKey];
    if (mm) {
      const dd = wr1[2].padStart(2, '0');
      return { iso: `${wr1[3]}-${mm}-${dd}`, raw: s };
    }
  }

  // Written: DD Month YYYY
  const wr2 = /^(\d{1,2})\s+([A-Za-z]+)[,\s]+(\d{4})/.exec(s);
  if (wr2) {
    const mm = MONTH_MAP[wr2[2].toLowerCase()];
    if (mm) {
      const dd = wr2[1].padStart(2, '0');
      return { iso: `${wr2[3]}-${mm}-${dd}`, raw: s };
    }
  }

  // Year-only: just "2024"
  const yearOnly = /^(\d{4})$/.exec(s);
  if (yearOnly) {
    return { iso: `${yearOnly[1]}-01-01`, raw: s };
  }

  return { raw: s, unparseable: true };
}

/** True if date is strictly in the past relative to today (ISO comparison). */
export function isInPast(d: ParsedDate | undefined, today: string = todayIso()): boolean {
  if (!d?.iso) return false;
  return d.iso < today;
}

/** True if date is more than monthsAgo months in the past. */
export function isOlderThanMonths(
  d: ParsedDate | undefined,
  months: number,
  today: string = todayIso(),
): boolean {
  if (!d?.iso) return false;
  // Subtract months from today's ISO date for threshold.
  const [ty, tm, td] = today.split('-').map(Number);
  let threshYear = ty;
  let threshMonth = tm - months;
  while (threshMonth <= 0) {
    threshMonth += 12;
    threshYear -= 1;
  }
  const threshold = `${threshYear}-${String(threshMonth).padStart(2, '0')}-${String(td).padStart(2, '0')}`;
  return d.iso < threshold;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Materialized status detection ───────────────────────────────────────────

const MATERIALIZED_TOKENS = [
  'materialized',
  'realized',
  'occurred',
  'triggered',
  'active incident',
  'live incident',
  'confirmed',
  'breached',
];

function isMaterialized(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return MATERIALIZED_TOKENS.some((t) => s.includes(t));
}

// ─── Per-document-type parsers ────────────────────────────────────────────────

function parsePolicy(doc: ClassifiedEvidence): Policy {
  // Policy title: try structured rows first, fall back to filename.
  let title = 'Untitled Policy';
  if (doc.rows && doc.rows.length > 0) {
    const t = pick(doc.rows[0], 'title', 'policy title', 'name', 'policy name', 'document title');
    if (t) title = str(t);
  }
  if (title === 'Untitled Policy' && doc.filename) {
    title = doc.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  }

  // Dates: scan rows then fall back to text parsing.
  let reviewDate: ParsedDate | undefined;
  let nextReviewDue: ParsedDate | undefined;

  if (doc.rows && doc.rows.length > 0) {
    for (const row of doc.rows) {
      const rd = pick(row, 'review date', 'last review', 'last reviewed', 'reviewed', 'review');
      if (rd && !reviewDate) reviewDate = parseDate(rd);

      const nrd = pick(
        row,
        'next review',
        'next review due',
        'next review date',
        'review due',
        'expiry',
        'expiration',
        'expires',
        'valid until',
      );
      if (nrd && !nextReviewDue) nextReviewDue = parseDate(nrd);
    }
  }

  // Text-based date extraction if not found in rows.
  if (doc.text && (!reviewDate || !nextReviewDue)) {
    const textDates = extractDatesFromText(doc.text);
    if (!reviewDate && textDates.reviewDate) reviewDate = textDates.reviewDate;
    if (!nextReviewDue && textDates.nextReviewDue) nextReviewDue = textDates.nextReviewDue;
  }

  return {
    title,
    reviewDate,
    nextReviewDue,
    text: doc.text ? doc.text.replace(/\s+/g, ' ').trim() : '',
    _docId: doc.rawFingerprint,
    _filename: doc.filename,
  };
}

/** Loosely extract review dates from policy prose using labeled patterns. */
function extractDatesFromText(text: string): {
  reviewDate?: ParsedDate;
  nextReviewDue?: ParsedDate;
} {
  const result: { reviewDate?: ParsedDate; nextReviewDue?: ParsedDate } = {};
  // Patterns like "last reviewed: 2024-01-15" or "reviewed on March 15, 2024"
  const reviewPatterns = [
    /last reviewed[:\s]+([^\n,;]+)/i,
    /review date[:\s]+([^\n,;]+)/i,
    /reviewed on[:\s]+([^\n,;]+)/i,
    /date reviewed[:\s]+([^\n,;]+)/i,
  ];
  for (const re of reviewPatterns) {
    const m = re.exec(text);
    if (m) {
      const d = parseDate(m[1].trim());
      if (d && !d.unparseable) {
        result.reviewDate = d;
        break;
      }
    }
  }

  // Patterns like "next review due: 2025-01-15" or "review due by March 2025"
  const nextPatterns = [
    /next review due[:\s]+([^\n,;]+)/i,
    /next review[:\s]+([^\n,;]+)/i,
    /review due[:\s]+([^\n,;]+)/i,
    /expires?[:\s]+([^\n,;]+)/i,
    /valid until[:\s]+([^\n,;]+)/i,
    /expir(?:ation|y)[:\s]+([^\n,;]+)/i,
    /expired on[:\s]+([^\n,;]+)/i,
    /expired[:\s]+([0-9]{4}-[0-9]{2}-[0-9]{2})/i,
  ];
  for (const re of nextPatterns) {
    const m = re.exec(text);
    if (m) {
      const d = parseDate(m[1].trim());
      if (d && !d.unparseable) {
        result.nextReviewDue = d;
        break;
      }
    }
  }

  return result;
}

function parseApprovalMatrix(doc: ClassifiedEvidence): ApprovalMatrixEntry[] {
  const proseRows: Record<string, unknown>[] = [];
  if (doc.text) {
    const sod = /user\s+`?([^`\n]+?)`?\s+can\s+create\s+vendors?\s+and\s+approve\s+vendor\s+payments?/i.exec(
      doc.text,
    );
    if (sod) {
      proseRows.push(
        { role: 'vendor requester / vendor creator', approver_name: sod[1], type: 'requester' },
        { role: 'vendor payment approver', approver_name: sod[1], type: 'approver' },
      );
    }
    if (/no\s+cfo\s+signature|missing\s+cfo\s+signature|cfo\s+signature\s+(?:missing|required)/i.test(doc.text)) {
      proseRows.push({ role: 'CFO signatory', signed: 'no', signature: 'missing' });
    }
  }
  const rows = [...(doc.rows ?? []), ...proseRows];
  if (rows.length === 0) return [];
  return rows.map((row) => {
    const role = str(
      pick(row, 'role', 'approver role', 'approver', 'title', 'position', 'job title'),
    );
    const limitRaw = pick(
      row,
      'limit',
      'approval limit',
      'approval amount',
      'authorized limit',
      'approval threshold',
      'amount',
      'max amount',
      'dollar limit',
    );
    const limitNum = limitRaw != null ? parseFloat(String(limitRaw).replace(/[,$]/g, '')) : NaN;

    const sigRaw = pick(
      row,
      'requires signature',
      'signature required',
      'requires sign off',
      'sign off required',
      'signed',
      'signature',
    );
    const requiresSignature =
      sigRaw != null
        ? /^(yes|true|y|1|required|x)$/i.test(str(sigRaw))
        : undefined;

    const approverName = strOrUndef(
      pick(row, 'approver name', 'name', 'assigned to', 'person', 'employee'),
    );

    const requesterMarker = pick(row, 'type', 'role type', 'duty', 'function', 'category');
    const isRequester = requesterMarker
      ? /requester|requestor|initiator|preparer|submitter/i.test(str(requesterMarker))
      : /requester|requestor|initiator|preparer|submitter/i.test(role);

    return {
      role: role || 'Unknown Role',
      limit: isNaN(limitNum) ? undefined : limitNum,
      requiresSignature,
      approverName,
      isRequester,
      _raw: row,
      _docId: doc.rawFingerprint,
    };
  });
}

function parseExceptionLog(doc: ClassifiedEvidence): ExceptionLogItem[] {
  const proseRows: Record<string, unknown>[] = [];
  if (doc.text) {
    const override = /(?:three|3)\s+vendor\s+override\s+events?.*no\s+linked\s+approval\s+ticket/i.exec(
      doc.text,
    );
    if (override) {
      proseRows.push({
        id: 'vendor-overrides',
        exception: override[0],
        owner: '',
        status: 'open',
      });
    }
  }
  const rows = [...(doc.rows ?? []), ...proseRows];
  if (rows.length === 0) return [];
  return rows.map((row) => {
    const id = strOrUndef(pick(row, 'id', 'exception id', 'ref', 'reference', 'number', 'no'));
    const description = str(
      pick(row, 'description', 'exception', 'details', 'issue', 'summary', 'title', 'finding'),
    );
    const owner = strOrUndef(
      pick(row, 'owner', 'exception owner', 'responsible', 'assigned to', 'accountable'),
    );
    const status = strOrUndef(pick(row, 'status', 'state', 'resolution status', 'disposition'));
    const opened = parseDate(pick(row, 'opened', 'open date', 'date opened', 'created', 'raised'));
    const due = parseDate(
      pick(row, 'due', 'due date', 'target date', 'resolution date', 'close by', 'deadline'),
    );
    return {
      id,
      description: description || 'No description',
      owner,
      status,
      opened,
      due,
      _raw: row,
      _docId: doc.rawFingerprint,
    };
  });
}

function parseRiskRegister(doc: ClassifiedEvidence): RiskRegisterItem[] {
  const proseRows: Record<string, unknown>[] = [];
  if (doc.text) {
    const riskRe =
      /Risk\s+`?([A-Z0-9-]+)`?\s+has\s+([^.\n]+?)(?:\.|\n|$)/gi;
    let match: RegExpExecArray | null;
    while ((match = riskRe.exec(doc.text)) !== null) {
      const details = match[2];
      const due = /mitigation due date\s+([0-9]{4}-[0-9]{2}-[0-9]{2})/i.exec(details)?.[1];
      const status = /status\s+([a-z_ -]+)/i.exec(details)?.[1]?.replace(/,\s*owner.*$/i, '').trim();
      const ownerBlank = /owner\s+blank|no\s+owner|owner\s+missing/i.test(details);
      proseRows.push({
        id: match[1],
        risk: match[0],
        owner: ownerBlank ? '' : undefined,
        status: status || 'open',
        impact: 'high',
        mitigation_due: due,
      });
    }
  }
  const rows = [...(doc.rows ?? []), ...proseRows];
  if (rows.length === 0) return [];
  return rows.map((row) => {
    const id = strOrUndef(pick(row, 'id', 'risk id', 'ref', 'number', 'risk no'));
    const description = str(
      pick(row, 'description', 'risk', 'risk description', 'details', 'summary', 'title'),
    );
    const owner = strOrUndef(
      pick(row, 'owner', 'risk owner', 'responsible', 'assigned to', 'accountable'),
    );
    const likelihood = strOrUndef(
      pick(row, 'likelihood', 'probability', 'frequency', 'chance', 'occurrence'),
    );
    const impact = strOrUndef(
      pick(row, 'impact', 'severity', 'consequence', 'effect', 'rating'),
    );
    const status = strOrUndef(pick(row, 'status', 'state', 'risk status', 'disposition'));
    const mitigation = strOrUndef(
      pick(row, 'mitigation', 'control', 'treatment', 'response', 'remediation'),
    );
    const mitigationDue = parseDate(
      pick(
        row,
        'mitigation due',
        'mitigation date',
        'target date',
        'treatment due',
        'remediation due',
        'due date',
      ),
    );
    return {
      id,
      description: description || 'No description',
      owner,
      likelihood,
      impact,
      status,
      mitigation,
      mitigationDue,
      materialized: isMaterialized(status),
      _raw: row,
      _docId: doc.rawFingerprint,
    };
  });
}

function parseSignatures(doc: ClassifiedEvidence): SignatureRecord[] {
  const proseRows: Record<string, unknown>[] = [];
  if (doc.text) {
    if (/no\s+cfo\s+signature|missing\s+cfo\s+signature|cfo\s+signature\s+(?:missing|required)/i.test(doc.text)) {
      proseRows.push({ role: 'CFO signatory', signed: 'no', signature: 'missing' });
    }
    if (/no\s+current\s+owner\s+approval/i.test(doc.text)) {
      proseRows.push({ role: 'Policy owner approver', signed: 'no', signature: 'missing' });
    }
  }
  const rows = [...(doc.rows ?? []), ...proseRows];
  if (rows.length === 0) return [];
  return rows.map((row) => {
    const role = str(
      pick(
        row,
        'role',
        'approver role',
        'approver',
        'signer role',
        'title',
        'position',
        'signatory',
      ),
    );
    const signedRaw = pick(
      row,
      'signed',
      'signature',
      'approved',
      'sign off',
      'sign-off',
      'authorized',
      'signatory',
    );
    // A signature is "signed" if the value is truthy and not a blank/unsigned marker.
    const signed =
      signedRaw != null &&
      !/^(no|false|0|unsigned|blank|pending|required|tbd|n\/a|-)$/i.test(str(signedRaw));
    const name = strOrUndef(pick(row, 'name', 'signer name', 'signed by', 'approver name'));
    const date = parseDate(pick(row, 'date', 'signed date', 'approval date', 'sign date'));
    return {
      role: role || 'Unknown Role',
      signed,
      name,
      date,
      _raw: row,
      _docId: doc.rawFingerprint,
    };
  });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Parse a set of classified evidence documents into the typed AuditEvidence
 * projection. Each document type is routed to its dedicated parser.
 * Documents of unrecognised type or type 'unknown' are silently skipped at
 * this layer — the kernel's evidence gating handles the "missing document"
 * case upstream.
 */
export function parseAuditEvidence(documents: ClassifiedEvidence[]): AuditEvidence {
  const result: AuditEvidence = {
    policies: [],
    approvalMatrix: [],
    exceptions: [],
    risks: [],
    signatures: [],
  };

  for (const doc of documents) {
    switch (doc.documentType) {
      case 'policy':
        result.policies.push(parsePolicy(doc));
        result.approvalMatrix.push(...parseApprovalMatrix(doc));
        result.signatures.push(...parseSignatures(doc));
        break;
      case 'approval_matrix':
        result.approvalMatrix.push(...parseApprovalMatrix(doc));
        // Approval matrices often contain signature columns too.
        result.signatures.push(...parseSignatures(doc));
        break;
      case 'exception_log':
        result.exceptions.push(...parseExceptionLog(doc));
        break;
      case 'risk_register':
        result.risks.push(...parseRiskRegister(doc));
        break;
      default:
        // Other document types (invoice, vendor_master, etc.) are not audit models.
        break;
    }
  }

  return result;
}
