// Phase B1 — InvoiceProof control registry.
//
// Adapts the 15 legacy controls from control-readiness.ts into the Phase A kernel
// ControlDefinition[] contract. Each definition:
//   1. Declares requiredEvidence / alternativeEvidence so the kernel registry can
//      gate the control before run() is called. run() can therefore assume evidence
//      exists and never re-checks.
//   2. Builds the legacy ControlContext from ctx.documents / ctx typed projections,
//      calls the matching legacy c-function via the re-exported runControls, and
//      translates the legacy ControlResult into the kernel ControlResult shape.
//   3. Lifts every legacy rows[] / evidence string into structured EvidenceRef[] so
//      every failure carries at least one citation.
//
// IMPORTANT: this file MUST NOT edit control-readiness.ts, the kernel, or any
// other registry. It is a pure adapter.

import {
  runControls as legacyRunControls,
  type ControlContext,
  type ControlResult as LegacyResult,
} from '../control-readiness.js';
import { normalizeMany } from '../normalizers/invoice-normalizer.js';
import type { ClassifiedEvidence } from '../ingestion/evidence-input.js';
import {
  runControls,
  buildCoverageSummary,
  computeDeterministicConfidence,
} from '../proof-kernel/registry.js';
import { mapLegacyStatus } from '../proof-kernel/types.js';
import type {
  ControlDefinition,
  ControlResult,
  EvidenceContext,
  EvidenceRef,
} from '../proof-kernel/types.js';

// ---------------------------------------------------------------------------
// Helper: build a ControlContext from an EvidenceContext.
//
// The kernel already gated on requiredEvidence before run() is called, so
// invoice docs are guaranteed present. We project each ClassifiedEvidence by
// documentType into the legacy typed slots.
// ---------------------------------------------------------------------------

export function buildInvoiceContext(documents: ClassifiedEvidence[]): EvidenceContext {
  // Invoice docs → NormalizedInvoice[] via normalizeMany.
  const invoiceDocs = documents.filter((d) => d.documentType === 'invoice');
  const invoiceRows = invoiceDocs.flatMap((d) => d.rows ?? []);
  const invoices = normalizeMany(invoiceRows);

  // Vendor master: each row in a vendor_master doc.
  const vendorMasterDocs = documents.filter((d) => d.documentType === 'vendor_master');
  const vendorMasterRows = vendorMasterDocs.flatMap((d) => d.rows ?? []);
  const vendorMaster =
    vendorMasterRows.length > 0
      ? vendorMasterRows.map((r) => ({
          vendorName: String(
            r['vendorName'] ??
              r['vendor_name'] ??
              r['vendor'] ??
              r['VENDOR_NAME'] ??
              r['Vendor Name'] ??
              r['supplier'] ??
              '',
          ),
          city: stringOrUndef(
            r['city'] ?? r['CITY'] ?? r['vendorCity'] ?? r['VENDOR_CITY'] ?? r['City'],
          ),
          state: stringOrUndef(
            r['state'] ?? r['STATE'] ?? r['vendorState'] ?? r['VENDOR_STATE'] ?? r['State'],
          ),
          expectedEmailDomain: stringOrUndef(
            r['expectedEmailDomain'] ??
              r['email_domain'] ??
              r['emailDomain'] ??
              r['EMAIL_DOMAIN'],
          ),
          bankRoutingNumber: stringOrUndef(
            r['bankRoutingNumber'] ??
              r['routing_number'] ??
              r['ROUTING_NUMBER'] ??
              r['bankRouting'],
          ),
          bankAccountLast4: stringOrUndef(
            r['bankAccountLast4'] ?? r['account_last4'] ?? r['ACCOUNT_LAST4'],
          ),
          remitAddress: stringOrUndef(
            r['remitAddress'] ??
              r['remit_address'] ??
              r['REMIT_ADDRESS'] ??
              r['remit_to'] ??
              r['Remit To'],
          ),
          status: stringOrUndef(
            r['status'] ?? r['STATUS'] ?? r['vendorStatus'] ?? r['VENDOR_STATUS'],
          ),
        }))
      : undefined;

  // PO register: each row in a purchase_order_register doc.
  const poDocs = documents.filter((d) => d.documentType === 'purchase_order_register');
  const poRows = poDocs.flatMap((d) => d.rows ?? []);
  const poRegister =
    poRows.length > 0
      ? poRows.map((r) => ({
          poNumber: String(
            r['poNumber'] ??
              r['po_number'] ??
              r['PO_NUMBER'] ??
              r['po'] ??
              r['PO'] ??
              r['purchase_order_number'] ??
              '',
          ),
          vendorName: String(
            r['vendorName'] ??
              r['vendor_name'] ??
              r['vendor'] ??
              r['VENDOR_NAME'] ??
              r['supplier'] ??
              '',
          ),
          authorizedQty: numOrUndef(
            r['authorizedQty'] ??
              r['authorized_qty'] ??
              r['AUTHORIZED_QTY'] ??
              r['ordered_qty'] ??
              r['qty'],
          ),
          authorizedAmount: Number(
            r['authorizedAmount'] ??
              r['authorized_amount'] ??
              r['AUTHORIZED_AMOUNT'] ??
              r['po_amount'] ??
              r['PO_AMOUNT'] ??
              0,
          ),
        }))
      : undefined;

  // Approval matrix: each row in an approval_matrix doc.
  const approvalDocs = documents.filter((d) => d.documentType === 'approval_matrix');
  const approvalRows = approvalDocs.flatMap((d) => d.rows ?? []);
  const approvalMatrix =
    approvalRows.length > 0
      ? approvalRows.map((r) => ({
          approverRole: String(
            r['approverRole'] ??
              r['approver_role'] ??
              r['APPROVER_ROLE'] ??
              r['role'] ??
              '',
          ),
          approvalLimit: Number(
            r['approvalLimit'] ??
              r['approval_limit'] ??
              r['APPROVAL_LIMIT'] ??
              r['limit'] ??
              0,
          ),
        }))
      : undefined;

  // Payment register: each row in a payment_register doc.
  const paymentDocs = documents.filter((d) => d.documentType === 'payment_register');
  const paymentRows = paymentDocs.flatMap((d) => d.rows ?? []);
  const history =
    paymentRows.length > 0
      ? paymentRows.map((r) => ({
          invoiceNo: String(
            r['invoiceNo'] ??
              r['INVOICE_NUMBER'] ??
              r['invoiceNumber'] ??
              r['invoice_number'] ??
              r['invoice_no'] ??
              '',
          ),
          vendor: String(
            r['vendor'] ?? r['vendor_name'] ?? r['VENDOR_NAME'] ?? r['supplier'] ?? '',
          ),
          amount: Number(r['amount'] ?? r['AMOUNT'] ?? r['grand_total'] ?? 0),
          po: String(r['po'] ?? r['po_number'] ?? r['PO_NUMBER'] ?? ''),
          submittedAt: new Date(
            String(
              r['submittedAt'] ?? r['payment_date'] ?? r['PAYMENT_DATE'] ?? r['paid_date'] ?? '2000-01-01',
            ),
          ),
        }))
      : undefined;

  // Build the typed context the legacy controls expect.
  const legacyCtx: ControlContext = {
    invoices,
    vendorMaster,
    poRegister,
    approvalMatrix,
    history,
  };

  // Expose as an EvidenceContext, carrying the legacy context so run() doesn't
  // have to re-project. Cast through unknown to satisfy the open index-signature
  // on EvidenceContext — _legacyCtx is a private adapter slot, not a protocol field.
  const ctx = {
    product: 'invoiceproof',
    documents,
    _legacyCtx: legacyCtx,
  } as unknown as EvidenceContext;
  return ctx;
}

// ---------------------------------------------------------------------------
// Helper: extract a ControlContext from an EvidenceContext.
// Memoized in the context under _legacyCtx if buildInvoiceContext was used;
// otherwise projects fresh.
// ---------------------------------------------------------------------------

function getLegacyCtx(ctx: EvidenceContext): ControlContext {
  const cached = (ctx as { _legacyCtx?: ControlContext })._legacyCtx;
  if (cached) return cached;
  return (buildInvoiceContext(ctx.documents) as unknown as { _legacyCtx: ControlContext })._legacyCtx;
}

// ---------------------------------------------------------------------------
// Helper utilities for row-projection.
// ---------------------------------------------------------------------------

function stringOrUndef(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  return String(v);
}

function numOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Legacy-to-kernel result translation.
//
// Translates a LegacyResult into the kernel ControlResult shape. The key
// transformation is lifting legacy rows[] / evidence string into EvidenceRef[]
// so every failure carries at least one citation.
//
// Strategy for documentId: use the rawFingerprint of the first invoice doc in
// the context, since all 15 controls operate on invoice rows.
// ---------------------------------------------------------------------------

function invoiceDocId(ctx: EvidenceContext): string {
  const inv = ctx.documents.find((d) => d.documentType === 'invoice');
  return inv?.rawFingerprint ?? 'invoice-unknown';
}

function liftToEvidenceRefs(
  legacy: LegacyResult,
  ctx: EvidenceContext,
): EvidenceRef[] {
  const docId = invoiceDocId(ctx);
  const refs: EvidenceRef[] = [];

  // Primary citation: each entry in legacy.rows[] becomes its own EvidenceRef.
  if (legacy.rows && legacy.rows.length > 0) {
    for (const row of legacy.rows) {
      refs.push({
        documentId: docId,
        documentType: 'invoice',
        field: 'invoiceNo',
        rawValue: row,
        // Use legacy.evidence as the sourcePassage for the first row, then
        // use the row string itself for subsequent rows.
        sourcePassage: legacy.evidence ?? row,
      });
    }
    return refs;
  }

  // Fallback: if no rows but evidence string exists, emit a single ref.
  if (legacy.evidence) {
    refs.push({
      documentId: docId,
      documentType: 'invoice',
      sourcePassage: legacy.evidence,
    });
  }

  return refs;
}

// Derive a recommendedAction from legacy detail + standard per-control guidance.
function recommendedAction(legacy: LegacyResult): string {
  const detail = legacy.detail ?? '';
  // Per-control actionable guidance keyed by controlId.
  const actions: Record<string, string> = {
    'IP-C1': 'Remove the exact-duplicate invoice from the batch before payment.',
    'IP-C2': 'Investigate the modified-amount re-submission; hold payment pending vendor confirmation.',
    'IP-C3': 'Contact vendor to confirm the invoice was not already paid; block until resolved.',
    'IP-C4': 'Verify bank-detail change via a known-good contact channel; do not pay until confirmed.',
    'IP-C5': 'Obtain a valid PO number for each invoice before approving payment.',
    'IP-C6': 'Contact the PO owner to confirm the authorized amount before releasing payment.',
    'IP-C7': 'Verify shipped quantities with receiving before approving payment for excess units.',
    'IP-C8': 'Request a corrected invoice with reconciled line-item totals.',
    'IP-C9': 'Request itemized support for any round-dollar invoice over $1,000.',
    'IP-C10': 'Confirm vendor address via vendor-master update request before payment.',
    'IP-C11': 'Verify the sender email with the vendor directly before processing payment.',
    'IP-C12': 'Route the invoice to a higher-authority approver before payment.',
    'IP-C13': 'Suspend payment and reactivate the vendor in the master if appropriate.',
    'IP-C14': 'Do not re-direct payment; confirm the correct remit address via vendor-master.',
    'IP-C15': 'Confirm with the vendor whether separate invoices were issued for the same work.',
  };
  return actions[legacy.controlId] ?? (detail || 'Review this control result before approving payment.');
}

// Translate a LegacyResult to the kernel ControlResult union.
function translateLegacy(legacy: LegacyResult, ctx: EvidenceContext): ControlResult {
  const mappedStatus = mapLegacyStatus(legacy.status as Parameters<typeof mapLegacyStatus>[0]);

  switch (mappedStatus) {
    case 'passed':
      return {
        status: 'passed',
        controlId: legacy.controlId,
        evidenceRefs: liftToEvidenceRefs(legacy, ctx),
      };

    case 'failed': {
      const refs = liftToEvidenceRefs(legacy, ctx);
      return {
        status: 'failed',
        controlId: legacy.controlId,
        severity: legacy.severity ?? 'medium',
        evidenceRefs: refs,
        recommendedAction: recommendedAction(legacy),
        message: legacy.detail,
      };
    }

    case 'skipped': {
      // Determine the skip reason from the original legacy status.
      const reason: 'field_absent' | 'uninterpretable' | 'insufficient_evidence' =
        legacy.status === 'skipped_uninterpretable'
          ? 'uninterpretable'
          : legacy.status === 'needs_more_evidence'
            ? 'insufficient_evidence'
            : 'field_absent';
      return {
        status: 'skipped',
        controlId: legacy.controlId,
        reason,
        missingEvidence: legacy.missingEvidence ?? [],
      };
    }

    case 'needs_more_evidence':
      // The kernel collapses needs_more_evidence into skipped/insufficient_evidence
      // for the gate-short-circuit path. When the gate passes but the legacy control
      // itself returns needs_more_evidence (e.g. IP-C13 no vendor status at all),
      // treat it as a skipped/insufficient_evidence result.
      return {
        status: 'skipped',
        controlId: legacy.controlId,
        reason: 'insufficient_evidence',
        missingEvidence: legacy.missingEvidence ?? [],
      };
  }
}

// ---------------------------------------------------------------------------
// Convenience: run a single legacy c-function and translate to kernel result.
// ---------------------------------------------------------------------------

function runOne(
  controlId: string,
  ctx: EvidenceContext,
): ControlResult {
  const legacyCtx = getLegacyCtx(ctx);
  // Run only the target control via the legacy runControls and pick the result.
  const all = legacyRunControls(legacyCtx);
  const legacy = all.find((r) => r.controlId === controlId);
  if (!legacy) {
    // Defensive: control not found in legacy suite — return a skipped result.
    return {
      status: 'skipped',
      controlId,
      reason: 'insufficient_evidence',
      missingEvidence: [],
    };
  }
  return translateLegacy(legacy, ctx);
}

// ---------------------------------------------------------------------------
// INVOICEPROOF_CONTROLS: 15 ControlDefinition entries, one per IP-C1..IP-C15.
//
// requiredEvidence / alternativeEvidence declare the document types the kernel
// registry gates on BEFORE calling run(). run() can therefore assume the declared
// documents are present in ctx.documents.
//
// mustCheck: true on controls that require only invoices (always-runnable given
// ANY invoice submission) so skipping them degrades confidence appropriately.
// ---------------------------------------------------------------------------

export const INVOICEPROOF_CONTROLS: ControlDefinition[] = [
  // IP-C1: Exact duplicate within batch. Requires only invoices.
  {
    id: 'IP-C1',
    product: 'invoiceproof',
    name: 'Exact duplicate (same invoice number + amount)',
    severityDefault: 'critical',
    requiredEvidence: ['invoice'],
    mustCheck: true,
    run: (ctx) => runOne('IP-C1', ctx),
  },

  // IP-C2: Modified duplicate within batch. Requires only invoices.
  {
    id: 'IP-C2',
    product: 'invoiceproof',
    name: 'Modified duplicate (same invoice number, different amount)',
    severityDefault: 'critical',
    requiredEvidence: ['invoice'],
    mustCheck: true,
    run: (ctx) => runOne('IP-C2', ctx),
  },

  // IP-C3: Cross-submission duplicate. Requires invoice + payment_register OR
  // just the invoice with inline history (alternativeEvidence covers both paths).
  {
    id: 'IP-C3',
    product: 'invoiceproof',
    name: 'Cross-submission duplicate (matches prior history)',
    severityDefault: 'critical',
    requiredEvidence: ['invoice'],
    alternativeEvidence: [['payment_register'], ['invoice']],
    mustCheck: false,
    run: (ctx) => runOne('IP-C3', ctx),
  },

  // IP-C4: Bank account / routing mismatch. Requires invoice + vendor_master.
  {
    id: 'IP-C4',
    product: 'invoiceproof',
    name: 'Bank account / routing mismatch',
    severityDefault: 'critical',
    requiredEvidence: ['invoice', 'vendor_master'],
    mustCheck: false,
    run: (ctx) => runOne('IP-C4', ctx),
  },

  // IP-C5: Missing PO reference. Requires only invoices.
  {
    id: 'IP-C5',
    product: 'invoiceproof',
    name: 'Missing PO reference',
    severityDefault: 'high',
    requiredEvidence: ['invoice'],
    mustCheck: true,
    run: (ctx) => runOne('IP-C5', ctx),
  },

  // IP-C6: PO amount overage. Requires invoice + purchase_order_register.
  {
    id: 'IP-C6',
    product: 'invoiceproof',
    name: 'PO amount overage',
    severityDefault: 'high',
    requiredEvidence: ['invoice', 'purchase_order_register'],
    mustCheck: false,
    run: (ctx) => runOne('IP-C6', ctx),
  },

  // IP-C7: PO quantity overage. Can fire from inline invoice qty (authorizedQty
  // on invoice) without a PO register. alternativeEvidence covers both paths:
  //   - group 1: invoice + purchase_order_register (qty from PO register)
  //   - group 2: invoice alone (authorized qty is inline on the invoice row)
  {
    id: 'IP-C7',
    product: 'invoiceproof',
    name: 'PO quantity overage',
    severityDefault: 'high',
    requiredEvidence: ['invoice'],
    alternativeEvidence: [['purchase_order_register'], ['invoice']],
    mustCheck: false,
    run: (ctx) => runOne('IP-C7', ctx),
  },

  // IP-C8: Line-item math error. Requires only invoices.
  {
    id: 'IP-C8',
    product: 'invoiceproof',
    name: 'Line-item math error',
    severityDefault: 'high',
    requiredEvidence: ['invoice'],
    mustCheck: true,
    run: (ctx) => runOne('IP-C8', ctx),
  },

  // IP-C9: Round-dollar anomaly. Requires only invoices.
  {
    id: 'IP-C9',
    product: 'invoiceproof',
    name: 'Round-dollar anomaly',
    severityDefault: 'medium',
    requiredEvidence: ['invoice'],
    mustCheck: true,
    run: (ctx) => runOne('IP-C9', ctx),
  },

  // IP-C10: Vendor address mismatch. Requires invoice + vendor_master.
  {
    id: 'IP-C10',
    product: 'invoiceproof',
    name: 'Vendor address mismatch',
    severityDefault: 'high',
    requiredEvidence: ['invoice', 'vendor_master'],
    mustCheck: false,
    run: (ctx) => runOne('IP-C10', ctx),
  },

  // IP-C11: Email / domain mismatch. Requires invoice + vendor_master.
  {
    id: 'IP-C11',
    product: 'invoiceproof',
    name: 'Email / domain mismatch',
    severityDefault: 'high',
    requiredEvidence: ['invoice', 'vendor_master'],
    mustCheck: false,
    run: (ctx) => runOne('IP-C11', ctx),
  },

  // IP-C12: Approval authority mismatch. Requires invoice + approval_matrix.
  {
    id: 'IP-C12',
    product: 'invoiceproof',
    name: 'Approval authority mismatch',
    severityDefault: 'high',
    requiredEvidence: ['invoice', 'approval_matrix'],
    mustCheck: false,
    run: (ctx) => runOne('IP-C12', ctx),
  },

  // IP-C13: Inactive / suspended vendor. Requires only invoice; alternativeEvidence
  // covers the vendor-master-status path (status can come from vendor_master too).
  {
    id: 'IP-C13',
    product: 'invoiceproof',
    name: 'Inactive / suspended vendor',
    severityDefault: 'high',
    requiredEvidence: ['invoice'],
    alternativeEvidence: [['vendor_master'], ['invoice']],
    mustCheck: true,
    run: (ctx) => runOne('IP-C13', ctx),
  },

  // IP-C14: Remit address mismatch. Requires invoice + vendor_master.
  {
    id: 'IP-C14',
    product: 'invoiceproof',
    name: 'Remit address mismatch',
    severityDefault: 'high',
    requiredEvidence: ['invoice', 'vendor_master'],
    mustCheck: false,
    run: (ctx) => runOne('IP-C14', ctx),
  },

  // IP-C15: Near duplicate (same vendor + same amount, different invoice numbers).
  // Requires only invoices.
  {
    id: 'IP-C15',
    product: 'invoiceproof',
    name: 'Near duplicate (same vendor + same amount)',
    severityDefault: 'high',
    requiredEvidence: ['invoice'],
    mustCheck: true,
    run: (ctx) => runOne('IP-C15', ctx),
  },
];

// ---------------------------------------------------------------------------
// runInvoiceProof: convenience entry-point.
// ---------------------------------------------------------------------------

export type InvoiceProofRunResult = {
  results: ControlResult[];
  coverage: ReturnType<typeof buildCoverageSummary>;
  confidence: ReturnType<typeof computeDeterministicConfidence>;
};

/**
 * Run all 15 InvoiceProof controls against a set of classified evidence documents.
 * Returns the kernel ControlResult[], a coverage summary, and a deterministic
 * confidence breakdown.
 */
export function runInvoiceProof(documents: ClassifiedEvidence[]): InvoiceProofRunResult {
  const ctx = buildInvoiceContext(documents);
  const mustCheckIds = new Set(
    INVOICEPROOF_CONTROLS.filter((c) => c.mustCheck).map((c) => c.id),
  );
  const results = runControls(INVOICEPROOF_CONTROLS, ctx);
  const coverage = buildCoverageSummary(results);
  const confidence = computeDeterministicConfidence(results, { mustCheckIds });
  return { results, coverage, confidence };
}
