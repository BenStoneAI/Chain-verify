import { createHash } from 'crypto';

import {
  normalizedToRow,
  scanInvoicesWithCoverage,
  type HistoryRecord,
  type PORegisterEntry,
  type Row,
  type VendorMasterEntry,
} from '@chain-verify/proof-core/invoice-scan.js';
import {
  normalizeMany,
  parseInput,
  type NormalizedInvoice,
} from '@chain-verify/proof-core/normalizers/invoice-normalizer.js';
import type { ApprovalMatrixEntry } from '@chain-verify/proof-core/control-readiness.js';

const MAX_BYTES = 200_000;

type InvoiceObject = {
  vendor: string;
  invoiceNo: string;
  amount: number | string;
  po?: string;
  bank?: string;
  bankRouting?: string;
  lineItemsTotal?: number;
  vendorCity?: string;
  vendorState?: string;
};

export type InvoiceScanRequestBody = {
  text?: unknown;
  invoices?: unknown;
  poRegister?: unknown;
  vendorMaster?: unknown;
  paymentHistory?: unknown;
  approvalMatrix?: unknown;
  useSessionHistory?: unknown;
};

function strOrUndef(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function numberOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(record)) {
    normalized.set(key.toLowerCase().replace(/[\s_-]+/g, ''), value);
  }
  for (const key of keys) {
    const exact = record[key];
    if (exact !== undefined && exact !== null && exact !== '') return exact;
    const compact = key.toLowerCase().replace(/[\s_-]+/g, '');
    const matched = normalized.get(compact);
    if (matched !== undefined && matched !== null && matched !== '') return matched;
  }
  return undefined;
}

function canonicalInvoiceObject(inv: Record<string, unknown>): InvoiceObject & Record<string, unknown> {
  const amount =
    firstValue(inv, [
      'total',
      'grand_total',
      'amount_total',
      'invoice_total',
      'amount_due',
      'payable',
      'amount',
      'subtotal',
    ]) ?? 0;
  return {
    ...inv,
    vendor: String(firstValue(inv, ['vendor', 'vendorName', 'vendor_name', 'supplier']) ?? ''),
    invoiceNo: String(
      firstValue(inv, ['invoiceNo', 'invoice_number', 'invoice_no', 'invoice_id', 'invoiceId']) ?? '',
    ),
    amount: typeof amount === 'number' ? amount : String(amount),
    po: String(
      firstValue(inv, ['po', 'poNumber', 'po_number', 'purchase_order_number', 'work_order']) ?? '',
    ),
    bank: String(
      firstValue(inv, [
        'bank',
        'bankRouting',
        'bank_or_payment_details',
        'bank_details',
        'bank_token',
      ]) ?? '',
    ),
    lineItemsTotal: numberOrUndef(
      firstValue(inv, ['lineItemsTotal', 'line_items_total', 'subtotal', 'amount']),
    ),
    tax: numberOrUndef(firstValue(inv, ['tax', 'sales_tax', 'tax_amount', 'vat'])),
    vendorCity: strOrUndef(firstValue(inv, ['vendorCity', 'vendor_city', 'city'])),
    vendorState: strOrUndef(firstValue(inv, ['vendorState', 'vendor_state', 'state'])),
  };
}

function mapPoRegister(raw: unknown): PORegisterEntry[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .map((r) => ({
      poNumber: String(r['poNumber'] ?? r['PO_NUMBER'] ?? r['po_number'] ?? r['po'] ?? ''),
      vendorName: String(
        r['vendorName'] ?? r['VENDOR_NAME'] ?? r['vendor_name'] ?? r['vendor'] ?? '',
      ),
      authorizedQty:
        r['authorizedQty'] !== undefined
          ? Number(r['authorizedQty'])
          : r['AUTHORIZED_QTY'] !== undefined
            ? Number(r['AUTHORIZED_QTY'])
            : r['authorized_qty'] !== undefined
              ? Number(r['authorized_qty'])
              : undefined,
      authorizedAmount: Number(
        r['authorizedAmount'] ??
          r['AUTHORIZED_AMOUNT'] ??
          r['PO_AMOUNT'] ??
          r['authorized_amount'] ??
          r['PO_TOTAL'] ??
          0,
      ),
    }))
    .filter((r) => r.poNumber.length > 0);
}

function mapVendorMaster(raw: unknown): VendorMasterEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw as VendorMasterEntry[];
}

function mapVendorMasterExtended(raw: unknown) {
  if (!Array.isArray(raw)) return undefined;
  return (raw as Record<string, unknown>[])
    .map((e) => ({
      vendorName: String(
        e['vendorName'] ??
          e['vendor_name'] ??
          e['VENDOR_NAME'] ??
          e['vendor'] ??
          e['name'] ??
          e['company'] ??
          '',
      ),
      city: strOrUndef(e['city'] ?? e['CITY'] ?? e['vendor_city'] ?? e['VENDOR_CITY']),
      state: strOrUndef(e['state'] ?? e['STATE'] ?? e['vendor_state'] ?? e['VENDOR_STATE']),
      expectedEmailDomain: strOrUndef(
        e['expectedEmailDomain'] ??
          e['email_domain'] ??
          e['emailDomain'] ??
          e['approved_domain'] ??
          e['approvedDomain'] ??
          e['expected_sender_domain'],
      ),
      bankRoutingNumber: strOrUndef(
        e['bankRoutingNumber'] ??
          e['routingNumber'] ??
          e['routing_number'] ??
          e['ROUTING_NUMBER'] ??
          e['approved_bank_details'] ??
          e['approvedBankDetails'],
      ),
      bankAccountNumber: strOrUndef(
        e['bankAccountNumber'] ?? e['accountNumber'] ?? e['account_number'],
      ),
      bankAccountLast4: strOrUndef(
        e['bankAccountLast4'] ?? e['account_last4'] ?? e['ACCOUNT_LAST4'],
      ),
      remitAddress: strOrUndef(
        e['remitAddress'] ??
          e['remit_address'] ??
          e['remit_to'] ??
          e['REMIT_ADDRESS'] ??
          e['remittance_address'],
      ),
      status: strOrUndef(
        e['status'] ?? e['vendorStatus'] ?? e['vendor_status'] ?? e['VENDOR_STATUS'],
      ),
    }))
    .filter((e) => e.vendorName.length > 0);
}

function mapPaymentHistory(raw: unknown): HistoryRecord[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .map((r) => ({
      invoiceNo: String(
        r['invoiceNo'] ??
          r['invoiceNumber'] ??
          r['INVOICE_NUMBER'] ??
          r['invoice_number'] ??
          r['invoice_no'] ??
          '',
      ),
      vendor: String(r['vendor'] ?? r['VENDOR_NAME'] ?? r['vendor_name'] ?? ''),
      amount: Number(
        r['amount'] ?? r['INVOICE_AMOUNT'] ?? r['PAYMENT_AMOUNT'] ?? r['invoice_amount'] ?? 0,
      ),
      po: String(r['po'] ?? r['PO_NUMBER'] ?? r['po_number'] ?? ''),
      submittedAt: new Date(
        String(
          r['submittedAt'] ??
            r['PAYMENT_DATE'] ??
            r['payment_date'] ??
            r['INVOICE_DATE'] ??
            new Date(),
        ),
      ),
    }))
    .filter((r) => r.invoiceNo.length > 0 && r.amount > 0);
}

function mapApprovalMatrix(raw: unknown): ApprovalMatrixEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return (raw as Record<string, unknown>[])
    .map((e) => ({
      approverRole: String(
        e['approverRole'] ?? e['approver_role'] ?? e['role'] ?? e['APPROVER_ROLE'] ?? '',
      ),
      approvalLimit: Number(
        e['approvalLimit'] ??
          e['approval_limit'] ??
          e['approvalAmount'] ??
          e['approval_amount'] ??
          e['limit'] ??
          NaN,
      ),
    }))
    .filter((e) => e.approverRole.length > 0 && Number.isFinite(e.approvalLimit));
}

export function hashFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export type ParsedInvoiceScanInput = {
  rows: Row[];
  normalized: NormalizedInvoice[];
  poRegister: PORegisterEntry[];
  vendorMaster: VendorMasterEntry[];
  vendorMasterExtended: ReturnType<typeof mapVendorMasterExtended>;
  seededHistory: HistoryRecord[];
  approvalMatrix?: ApprovalMatrixEntry[];
};

export function parseInvoiceScanBody(body: InvoiceScanRequestBody): ParsedInvoiceScanInput {
  let rows: Row[];
  let normalized: NormalizedInvoice[] = [];

  const invoicesArray =
    Array.isArray(body?.invoices) && (body.invoices as unknown[]).length > 0
      ? (body.invoices as InvoiceObject[])
      : null;

  if (invoicesArray) {
    const canonicalInvoices = invoicesArray.map((inv) =>
      canonicalInvoiceObject(inv as Record<string, unknown>),
    );
    rows = canonicalInvoices.map((inv) => {
      const rawAmount = String(inv.amount ?? '0');
      const numericAmount =
        typeof inv.amount === 'number'
          ? inv.amount
          : Number(rawAmount.replace(/[^0-9.]/g, '')) || 0;
      const bank = String(inv.bank ?? inv.bankRouting ?? '').replace(/[^0-9]/g, '');
      const result: Row = {
        vendor: String(inv.vendor ?? ''),
        invoiceNo: String(inv.invoiceNo ?? ''),
        amount: numericAmount,
        rawAmount,
        po: String(inv.po ?? ''),
        bank,
        ...(inv.vendorCity ? { vendorCity: String(inv.vendorCity) } : {}),
        ...(inv.vendorState ? { vendorState: String(inv.vendorState) } : {}),
      };
      if (inv.lineItemsTotal !== undefined) {
        const parsed =
          typeof inv.lineItemsTotal === 'number'
            ? inv.lineItemsTotal
            : Number(String(inv.lineItemsTotal).replace(/[^0-9.]/g, '')) || 0;
        const diff = Math.abs(parsed - numericAmount);
        const threshold = Math.min(numericAmount * 0.15, 500);
        if (diff > threshold) {
          result.lineItemsTotal = parsed;
        }
      }
      return result;
    });
    normalized = normalizeMany(canonicalInvoices.map((inv) => ({ ...inv })));
  } else {
    const text = body?.text;
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Provide invoice rows as { "text": "..." } or { "invoices": [...] }');
    }
    if (text.trim().length < 10) {
      throw new Error('Input too short — provide at least 10 characters of invoice data');
    }
    if (text.length > MAX_BYTES) {
      throw new Error('Input too large (200KB max)');
    }
    const parsed = parseInput({ text });
    normalized = normalizeMany(parsed.rows);
    rows = normalized.map(normalizedToRow);
  }

  const poRegister = mapPoRegister(body?.poRegister);
  const vendorMaster = mapVendorMaster(body?.vendorMaster);
  const vendorMasterExtended = mapVendorMasterExtended(body?.vendorMaster);
  const seededHistory = mapPaymentHistory(body?.paymentHistory);
  const approvalMatrix = mapApprovalMatrix(body?.approvalMatrix);

  return {
    rows,
    normalized,
    poRegister,
    vendorMaster,
    vendorMasterExtended,
    seededHistory,
    approvalMatrix,
  };
}

export function runInvoiceScan(
  parsed: ParsedInvoiceScanInput,
  sessionHistory: HistoryRecord[] = [],
) {
  const { findings, controlResults, coverage, normalizationWarnings, unknownFields } =
    scanInvoicesWithCoverage(
      parsed.rows,
      sessionHistory,
      parsed.poRegister,
      parsed.vendorMaster,
      parsed.seededHistory,
      new Date(),
      {
        normalized: parsed.normalized,
        approvalMatrix: parsed.approvalMatrix,
        vendorMasterExtended: parsed.vendorMasterExtended,
      },
    );

  const checksPassed = controlResults.filter((c) => c.status === 'passed');
  const checksFailed = controlResults.filter((c) => c.status === 'failed');
  const checksSkipped = controlResults.filter(
    (c) =>
      c.status === 'skipped_field_absent' ||
      c.status === 'skipped_uninterpretable' ||
      c.status === 'needs_more_evidence',
  );

  const evidenceSufficiencyScore =
    coverage.total_controls > 0
      ? Number((coverage.checked / coverage.total_controls).toFixed(2))
      : 0;

  return {
    rowCount: parsed.rows.length,
    findingCount: findings.length,
    findings,
    checks_passed: checksPassed,
    checks_failed: checksFailed,
    checks_skipped: checksSkipped,
    evidence_sufficiency_score: evidenceSufficiencyScore,
    normalization_warnings: normalizationWarnings,
    unknown_fields: unknownFields,
    coverage_summary: {
      total_controls: coverage.total_controls,
      checked: coverage.checked,
      failed: coverage.failed,
      skipped: coverage.skipped + coverage.needs_more_evidence,
    },
    rows: parsed.rows,
  };
}
