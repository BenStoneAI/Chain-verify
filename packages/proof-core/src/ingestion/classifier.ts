// Deterministic document-type classifier for the proof kernel.
//
// Given parsed rows (header-keyed records), free text, and/or a JSON payload, decide
// what KIND of document this evidence is — invoice, vendor master, PO register,
// payment register, approval matrix, policy, risk register, exception log,
// requirements doc, delivery statement, deployment evidence, defect log — or
// 'unknown' when nothing scores high enough.
//
// Scoring is fully deterministic (no Date/random/network). Two evidence channels
// feed the score:
//   (a) STRUCTURED — header/key signatures resolved via the canonical alias
//       registry plus known column sets per document type.
//   (b) TEXTUAL — keyword presence in free text or stringified JSON.
// The best-scoring type wins; ties resolve by a fixed priority order so the same
// input always yields the same label.

import { resolveCanonicalField, type CanonicalField } from '../field-aliases.js';

export type DocumentType =
  | 'invoice'
  | 'vendor_master'
  | 'purchase_order_register'
  | 'payment_register'
  | 'approval_matrix'
  | 'policy'
  | 'risk_register'
  | 'exception_log'
  | 'requirements_doc'
  | 'delivery_statement'
  | 'deployment_evidence'
  | 'defect_log'
  | 'unknown';

export type ClassificationResult = {
  documentType: DocumentType;
  confidence: number;
  reasons: string[];
};

// Fixed tie-break priority. Earlier = preferred when scores are equal. Tabular,
// high-signal document types come first; prose-only types come later because their
// keyword evidence is weaker and more easily matched incidentally.
const TYPE_PRIORITY: DocumentType[] = [
  'invoice',
  'payment_register',
  'purchase_order_register',
  'vendor_master',
  'approval_matrix',
  'defect_log',
  'risk_register',
  'exception_log',
  'requirements_doc',
  'delivery_statement',
  'deployment_evidence',
  'policy',
];

// Canonical fields whose presence is a strong structural signal for a type. These
// are matched against the resolved canonical fields of the row headers/keys.
const CANONICAL_SIGNALS: Partial<Record<DocumentType, CanonicalField[]>> = {
  invoice: ['invoiceNo', 'amount'],
  vendor_master: ['vendor', 'bankRouting', 'vendorCity'],
  purchase_order_register: ['po', 'authorizedAmount'],
  payment_register: ['invoiceNo'],
  approval_matrix: ['approverRole', 'approvalAmount'],
};

// Raw (un-aliased) header tokens that signal a type but are not in the InvoiceProof
// canonical registry. Matched case-insensitively against normalized header keys.
const RAW_HEADER_SIGNALS: Partial<Record<DocumentType, string[]>> = {
  payment_register: ['payment date', 'paid date', 'payment_date', 'paymentdate', 'check number'],
  purchase_order_register: ['authorized amount', 'po amount', 'authorized qty'],
  approval_matrix: ['approval limit', 'approver role', 'approval threshold', 'approval_matrix'],
  risk_register: ['risk', 'likelihood', 'impact', 'risk owner', 'mitigation'],
  exception_log: ['exception', 'exception id', 'resolution'],
  defect_log: ['defect', 'severity', 'defect id', 'bug id'],
  requirements_doc: ['requirement', 'acceptance criteria', 'requirement id'],
  delivery_statement: ['delivery', 'delivery statement', 'deliverable'],
  deployment_evidence: ['deployment', 'deployment report', 'deployment evidence', 'release notes'],
  // 'policy' previously had NO raw-header signal at all (every other AuditProof
  // container type does). When a policy document arrives as JSON wrapped under its
  // logical evidence-splitter key (`{ policy: ... }` / `{ policies: [...] }` — see
  // evidence-splitter.ts's AUDITPROOF_PROOF_INPUT_KEYS), the resulting single-row
  // header is literally "policy"/"policies". Without a structural signal here, a
  // policy whose title/prose happens to also contain an incidental phrase like
  // "vendor master" (e.g. "Vendor Master Data Policy") ties on KEYWORD_SIGNALS
  // alone and loses to 'vendor_master' on the TYPE_PRIORITY tie-break — silently
  // reclassifying it away from 'policy' and skipping every policy-gated control
  // (AP-C3, AP-C4) with missing_evidence "policy".
  policy: ['policy', 'policies', 'policy text', 'policy document', 'governance policy', 'procurement policy'],
};

// Keyword signatures for prose / text-dominant document types. Each keyword that
// appears (case-insensitive, word-ish boundary) contributes to that type's score.
const KEYWORD_SIGNALS: Record<DocumentType, string[]> = {
  invoice: ['invoice', 'remit to', 'amount due', 'bill to'],
  vendor_master: ['vendor master', 'supplier master', 'routing number', 'remittance'],
  purchase_order_register: ['purchase order', 'po register', 'authorized amount'],
  payment_register: ['payment register', 'payment date', 'check number', 'ach paid'],
  approval_matrix: [
    'approval matrix',
    'approval_matrix',
    'approval limit',
    'approver',
    'approve vendor payments',
    'segregation of duties',
    'delegation of authority',
  ],
  policy: ['policy', 'shall', 'procedure', 'must comply', 'governance', 'this policy'],
  risk_register: [
    'risk',
    'likelihood',
    'risk owner',
    'mitigation',
    'residual risk',
    'inherent risk',
  ],
  exception_log: ['exception', 'waiver', 'deviation', 'compensating control'],
  requirements_doc: [
    'requirement',
    'acceptance criteria',
    'shall',
    'user story',
    'functional requirement',
    'traceability',
  ],
  delivery_statement: [
    'delivered',
    'deliverable',
    'delivery statement',
    'handover',
    'completed and delivered',
  ],
  deployment_evidence: [
    'deployed',
    'deployment',
    'environment',
    'production',
    'staging',
    'release notes',
    'rollback',
  ],
  defect_log: ['defect', 'severity', 'p1', 'p2', 'open defect', 'bug report'],
  unknown: [],
};

// Per-keyword weight. Prose types lean on these; keep weights modest so a single
// incidental keyword cannot dominate a structurally clear table.
const KEYWORD_WEIGHT = 0.18;
const CANONICAL_SIGNAL_WEIGHT = 0.55;
const RAW_HEADER_WEIGHT = 0.35;

/** Lowercase, collapse whitespace; safe for null/odd inputs. */
function normText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ');
}

/** Build a searchable lowercase blob from text + stringified JSON. */
function buildTextBlob(text: string | undefined, json: unknown): string {
  const parts: string[] = [];
  if (typeof text === 'string' && text.trim()) parts.push(text);
  if (json !== undefined && json !== null) {
    try {
      parts.push(typeof json === 'string' ? json : JSON.stringify(json));
    } catch {
      // Non-serializable JSON (cycles) — ignore the JSON channel for keywords.
    }
  }
  return normText(parts.join('\n'));
}

/** Collect the set of canonical fields the row headers/keys resolve to. */
function resolveRowFields(rows: Record<string, unknown>[] | undefined): Set<CanonicalField> {
  const out = new Set<CanonicalField>();
  if (!rows || rows.length === 0) return out;
  // Inspect headers from the first handful of rows (union of keys) to be robust to
  // sparse rows where a column is blank on row 0.
  const keys = new Set<string>();
  for (const row of rows.slice(0, 25)) {
    for (const k of Object.keys(row)) keys.add(k);
  }
  for (const k of keys) {
    const match = resolveCanonicalField(k);
    if (match) out.add(match.canonical);
  }
  return out;
}

/** Normalized header keys present across the sampled rows. */
function collectHeaderKeys(rows: Record<string, unknown>[] | undefined): string[] {
  if (!rows || rows.length === 0) return [];
  const keys = new Set<string>();
  for (const row of rows.slice(0, 25)) {
    for (const k of Object.keys(row)) keys.add(normText(k).replace(/[_-]+/g, ' ').trim());
  }
  return [...keys];
}

/**
 * Classify evidence into a DocumentType with a 0–1 confidence and human-readable
 * reasons. Deterministic: identical inputs always produce identical output.
 */
export function classifyEvidence(
  rows: Record<string, unknown>[] | undefined,
  text: string | undefined,
  json: unknown,
): ClassificationResult {
  const canonicalFields = resolveRowFields(rows);
  const headerKeys = collectHeaderKeys(rows);
  const blob = buildTextBlob(text, json);

  const labeledSection = blob.trimStart();
  if (/^(risk_register|risk register)\b/i.test(labeledSection)) {
    return {
      documentType: 'risk_register',
      confidence: 0.95,
      reasons: ['Explicit risk register section label present.'],
    };
  }
  if (/^(approval_matrix|approval matrix|segregation of duties)\b/i.test(labeledSection)) {
    return {
      documentType: 'approval_matrix',
      confidence: 0.95,
      reasons: ['Explicit approval matrix / segregation-of-duties section label present.'],
    };
  }
  if (/^(exception_log|exception log)\b/i.test(labeledSection)) {
    return {
      documentType: 'exception_log',
      confidence: 0.95,
      reasons: ['Explicit exception log section label present.'],
    };
  }
  if (/^(delivery_statement|delivery statement)\b/i.test(labeledSection)) {
    return {
      documentType: 'delivery_statement',
      confidence: 0.95,
      reasons: ['Explicit delivery statement section label present.'],
    };
  }
  if (
    /^(deployment_report|deployment report|deployment_evidence|deployment evidence|release_notes|release notes)\b/i.test(
      labeledSection,
    )
  ) {
    return {
      documentType: 'deployment_evidence',
      confidence: 0.95,
      reasons: ['Explicit deployment evidence section label present.'],
    };
  }
  if (
    /^(defect_list|defect list|defects|open_defects|open defects|issues)\b/i.test(
      labeledSection,
    )
  ) {
    return {
      documentType: 'defect_log',
      confidence: 0.95,
      reasons: ['Explicit defect log section label present.'],
    };
  }

  const scores = new Map<DocumentType, number>();
  const reasonsByType = new Map<DocumentType, string[]>();

  const addScore = (type: DocumentType, amount: number, reason: string) => {
    scores.set(type, (scores.get(type) ?? 0) + amount);
    const list = reasonsByType.get(type) ?? [];
    list.push(reason);
    reasonsByType.set(type, list);
  };

  // (a) Structured signals — canonical field presence.
  for (const [type, fields] of Object.entries(CANONICAL_SIGNALS) as [
    DocumentType,
    CanonicalField[],
  ][]) {
    // vendor_master is MASTER data. If the row carries invoice transaction fields
    // (invoiceNo / amount) it is an INVOICE that merely includes vendor/bank/address
    // columns — a normal ERP export shape — not a vendor master. Do not award the
    // master-data signal in that case, or the extra bank/city columns would make an
    // invoice outscore 'invoice' and silently skip every InvoiceProof control.
    if (
      type === 'vendor_master' &&
      (canonicalFields.has('invoiceNo') || canonicalFields.has('amount'))
    ) {
      continue;
    }
    const hit = fields.filter((f) => canonicalFields.has(f));
    if (hit.length > 0) {
      addScore(
        type,
        CANONICAL_SIGNAL_WEIGHT * hit.length,
        `Columns resolved to canonical field(s): ${hit.join(', ')}`,
      );
    }
  }

  // Disambiguation between invoice / vendor_master / payment_register, which can all
  // share an invoiceNo or vendor column.
  //  - vendor_master: has vendor + bank/city signals but NO invoiceNo.
  //  - payment_register: has invoiceNo AND a payment-date header.
  if (canonicalFields.has('invoiceNo')) {
    const hasPaymentDate = headerKeys.some((k) => k.includes('payment date') || k.includes('paid'));
    if (hasPaymentDate) {
      addScore(
        'payment_register',
        CANONICAL_SIGNAL_WEIGHT,
        'invoiceNo present with a payment-date column',
      );
    }
  }
  if (
    (canonicalFields.has('vendor') || canonicalFields.has('bankRouting')) &&
    !canonicalFields.has('invoiceNo') &&
    !canonicalFields.has('amount')
  ) {
    addScore(
      'vendor_master',
      CANONICAL_SIGNAL_WEIGHT,
      'Vendor/bank columns present without invoiceNo or amount (master-data shape)',
    );
  }

  // (b) Raw header token signals for types outside the InvoiceProof registry.
  for (const [type, tokens] of Object.entries(RAW_HEADER_SIGNALS) as [DocumentType, string[]][]) {
    const hit = tokens.filter((t) => headerKeys.some((k) => k.includes(t)));
    if (hit.length > 0) {
      addScore(type, RAW_HEADER_WEIGHT * hit.length, `Header token(s) present: ${hit.join(', ')}`);
    }
  }

  if (headerKeys.some((k) => k === 'delivery')) {
    addScore(
      'delivery_statement',
      CANONICAL_SIGNAL_WEIGHT,
      'Top-level delivery object present',
    );
  }
  if (headerKeys.some((k) => k === 'requirements traceability')) {
    addScore(
      'requirements_doc',
      CANONICAL_SIGNAL_WEIGHT * 2,
      'Requirements traceability maps contract requirements to delivered evidence',
    );
  }
  if (
    headerKeys.some((k) =>
      [
        'requirements',
        'contract requirements',
        'contract scope',
        'integration scope',
        'acceptance criteria',
      ].includes(k),
    )
  ) {
    addScore(
      'requirements_doc',
      CANONICAL_SIGNAL_WEIGHT * 2,
      'Top-level contract requirements/scope present',
    );
  }

  // (c) Textual keyword signals.
  if (blob) {
    for (const [type, keywords] of Object.entries(KEYWORD_SIGNALS) as [DocumentType, string[]][]) {
      if (type === 'unknown') continue;
      const hit = keywords.filter((kw) => blob.includes(kw));
      if (hit.length > 0) {
        addScore(type, KEYWORD_WEIGHT * hit.length, `Keyword(s) present: ${hit.join(', ')}`);
      }
    }
  }

  if (scores.size === 0) {
    return {
      documentType: 'unknown',
      confidence: 0.1,
      reasons: ['No structural or keyword signature matched a known document type.'],
    };
  }

  // Pick the best score; break ties by the fixed priority order.
  let best: DocumentType = 'unknown';
  let bestScore = -1;
  for (const type of TYPE_PRIORITY) {
    const score = scores.get(type) ?? 0;
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  // Any type not in the priority list (defensive — all are listed) still considered.
  for (const [type, score] of scores) {
    if (!TYPE_PRIORITY.includes(type) && score > bestScore) {
      best = type;
      bestScore = score;
    }
  }

  // Map the raw additive score onto a 0–1 confidence with diminishing returns so a
  // single weak signal stays low-confidence and stacked signals approach (not reach) 1.
  const confidence = Number((1 - Math.exp(-bestScore)).toFixed(3));
  return {
    documentType: best,
    confidence,
    reasons: reasonsByType.get(best) ?? [],
  };
}
