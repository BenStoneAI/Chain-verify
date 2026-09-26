// Control-readiness / coverage layer for InvoiceProof.
//
// Each control DECLARES the evidence it needs. When that evidence is absent we
// return `skipped_field_absent` / `needs_more_evidence` (with `missingEvidence`
// populated) instead of a silent pass. This is what guarantees that "no findings"
// no longer implies "clean" — the coverage summary tells the caller exactly what
// was checked, what failed, and what could not be evaluated.

import { isUsable } from './field-value.js';
import { normalizeVendorName } from './field-aliases.js';
import type { NormalizedInvoice } from './normalizers/invoice-normalizer.js';

export type ControlStatus =
  | 'passed'
  | 'failed'
  | 'skipped_field_absent'
  | 'skipped_uninterpretable'
  | 'needs_more_evidence';

export type ControlResult = {
  controlId: string;
  name: string;
  status: ControlStatus;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  detail?: string;
  rows?: string[];
  evidence?: string;
  missingEvidence?: string[];
};

export type CoverageSummary = {
  total_controls: number;
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
  needs_more_evidence: number;
};

/** External evidence supplied alongside the invoices. */
export type ApprovalMatrixEntry = { approverRole: string; approvalLimit: number };

export type VendorMasterLike = {
  vendorName: string;
  city?: string;
  state?: string;
  expectedEmailDomain?: string;
  bankRoutingNumber?: string;
  bankAccountNumber?: string;
  bankAccountLast4?: string;
  remitAddress?: string;
  status?: string;
};

export type PORegisterLike = {
  poNumber: string;
  vendorName: string;
  authorizedQty?: number;
  authorizedAmount: number;
};

export type HistoryLike = {
  invoiceNo: string;
  vendor: string;
  amount: number;
  po: string;
  submittedAt: Date;
};

export type ControlContext = {
  invoices: NormalizedInvoice[];
  vendorMaster?: VendorMasterLike[];
  poRegister?: PORegisterLike[];
  approvalMatrix?: ApprovalMatrixEntry[];
  history?: HistoryLike[];
  seedContext?: HistoryLike[];
  /** Inactive/suspended status keywords (lowercased). */
  inactiveStatusKeywords?: string[];
  now?: Date;
};

const INACTIVE_KEYWORDS = [
  'inactive',
  'suspended',
  'noncompliant',
  'non-compliant',
  'blocked',
  'terminated',
  'hold',
  'on hold',
];

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function invNo(inv: NormalizedInvoice): string {
  return isUsable(inv.invoiceNo) ? inv.invoiceNo.value : '(no invoice #)';
}

// ---------------------------------------------------------------------------
// Individual controls. Each returns one ControlResult.
// ---------------------------------------------------------------------------

// IP-C1 — exact duplicate within this submission (same invoice # + same amount).
function c1ExactDuplicate(ctx: ControlContext): ControlResult {
  const id = 'IP-C1';
  const name = 'Exact duplicate (same invoice number + amount)';
  const usable = ctx.invoices.filter((i) => isUsable(i.invoiceNo) && isUsable(i.amount));
  if (usable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['invoiceNo', 'amount'],
      detail: 'No invoices with both an invoice number and a parseable amount.',
    };
  }
  const seen = new Map<string, number>();
  const hits: string[] = [];
  for (const inv of usable) {
    const key = inv.invoiceNo.value!.toLowerCase();
    const prevAmt = seen.get(key);
    if (prevAmt !== undefined && prevAmt === inv.amount.value!) {
      hits.push(inv.invoiceNo.value!);
    } else if (prevAmt === undefined) {
      seen.set(key, inv.amount.value!);
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'critical',
      rows: hits,
      detail: `${hits.length} invoice number(s) appear twice at an identical amount in this batch.`,
      evidence: `Duplicate invoice numbers at identical amount: ${hits.join(', ')}`,
    };
  }
  return { controlId: id, name, status: 'passed', detail: 'No exact duplicates in this batch.' };
}

// IP-C2 — modified duplicate within this submission (same invoice #, different amount).
function c2ModifiedDuplicate(ctx: ControlContext): ControlResult {
  const id = 'IP-C2';
  const name = 'Modified duplicate (same invoice number, different amount)';
  const usable = ctx.invoices.filter((i) => isUsable(i.invoiceNo) && isUsable(i.amount));
  if (usable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['invoiceNo', 'amount'],
    };
  }
  const seen = new Map<string, number>();
  const hits: string[] = [];
  for (const inv of usable) {
    const key = inv.invoiceNo.value!.toLowerCase();
    const prevAmt = seen.get(key);
    if (prevAmt !== undefined && prevAmt !== inv.amount.value!) {
      hits.push(inv.invoiceNo.value!);
    } else if (prevAmt === undefined) {
      seen.set(key, inv.amount.value!);
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'critical',
      rows: hits,
      detail: `${hits.length} invoice number(s) appear twice with different amounts in this batch.`,
      evidence: `Modified-duplicate invoice numbers: ${hits.join(', ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C3 — cross-submission duplicate against prior history / payment register.
function c3CrossSubmissionDuplicate(ctx: ControlContext): ControlResult {
  const id = 'IP-C3';
  const name = 'Cross-submission duplicate (matches prior history)';
  const prior = [...(ctx.history ?? []), ...(ctx.seedContext ?? [])];
  if (prior.length === 0) {
    return {
      controlId: id,
      name,
      status: 'needs_more_evidence',
      missingEvidence: ['history', 'paymentHistory'],
      detail:
        'No prior submission history or payment register provided — cannot check for resubmitted invoices.',
    };
  }
  const usable = ctx.invoices.filter((i) => isUsable(i.invoiceNo) && isUsable(i.amount));
  if (usable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['invoiceNo', 'amount'],
    };
  }
  const priorMap = new Map<string, number>();
  for (const p of prior) priorMap.set(p.invoiceNo.toLowerCase(), p.amount);
  const hits: string[] = [];
  for (const inv of usable) {
    if (priorMap.has(inv.invoiceNo.value!.toLowerCase())) hits.push(inv.invoiceNo.value!);
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'critical',
      rows: hits,
      detail: `${hits.length} invoice(s) match a prior submission or payment record.`,
      evidence: `Previously-seen invoice numbers: ${hits.join(', ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C4 — bank account / routing mismatch vs vendor master.
function c4BankMismatch(ctx: ControlContext): ControlResult {
  const id = 'IP-C4';
  const name = 'Bank account / routing mismatch';
  if (!ctx.vendorMaster || ctx.vendorMaster.length === 0) {
    return {
      controlId: id,
      name,
      status: 'needs_more_evidence',
      missingEvidence: ['vendorMaster'],
      detail: 'No vendor master provided — cannot verify bank details against a baseline.',
    };
  }
  const withBank = ctx.invoices.filter((i) => isUsable(i.bankRouting) || isUsable(i.bankAccount));
  if (withBank.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['bankRouting', 'bankAccount'],
      detail: 'No bank routing/account fields on any invoice.',
    };
  }
  const masterByVendor = new Map<string, VendorMasterLike>();
  for (const m of ctx.vendorMaster) masterByVendor.set(normalizeVendorName(m.vendorName), m);

  const hits: string[] = [];
  for (const inv of withBank) {
    if (!isUsable(inv.vendor)) continue;
    const m = masterByVendor.get(normalizeVendorName(inv.vendor.value));
    if (!m) continue;
    const invRouting = (inv.bankRouting?.value ?? '').replace(/\D/g, '');
    const masterRouting = (m.bankRoutingNumber ?? '').replace(/\D/g, '');
    if (invRouting && masterRouting && invRouting !== masterRouting) {
      hits.push(invNo(inv));
      continue;
    }
    const invAcct = (inv.bankAccount?.value ?? '').replace(/\D/g, '');
    const masterLast4 = (m.bankAccountLast4 ?? '').replace(/\D/g, '');
    if (invAcct && masterLast4 && invAcct.slice(-4) !== masterLast4) {
      hits.push(invNo(inv));
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'critical',
      rows: hits,
      detail: `${hits.length} invoice(s) show bank details that differ from the vendor master (BEC red flag).`,
      evidence: `Bank-detail mismatch on: ${hits.join(', ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C5 — missing PO reference.
function c5MissingPo(ctx: ControlContext): ControlResult {
  const id = 'IP-C5';
  const name = 'Missing PO reference';
  if (ctx.invoices.length === 0) {
    return { controlId: id, name, status: 'skipped_field_absent', missingEvidence: ['invoices'] };
  }
  const missing = ctx.invoices.filter((i) => !isUsable(i.po));
  if (missing.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: missing.map(invNo),
      detail: `${missing.length} invoice(s) reference no purchase order.`,
      evidence: `Invoices with no PO: ${missing.map(invNo).join(', ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C6 — PO amount overage vs PO register.
function c6PoAmountOverage(ctx: ControlContext): ControlResult {
  const id = 'IP-C6';
  const name = 'PO amount overage';
  if (!ctx.poRegister || ctx.poRegister.length === 0) {
    return {
      controlId: id,
      name,
      status: 'needs_more_evidence',
      missingEvidence: ['poRegister'],
      detail: 'No PO register provided — cannot compare billed amounts to authorized amounts.',
    };
  }
  const poMap = new Map<string, PORegisterLike>();
  for (const p of ctx.poRegister) poMap.set(p.poNumber.toLowerCase().trim(), p);
  const checkable = ctx.invoices.filter((i) => isUsable(i.po) && isUsable(i.amount));
  if (checkable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['po', 'amount'],
    };
  }
  const hits: string[] = [];
  for (const inv of checkable) {
    const po = poMap.get(inv.po.value!.toLowerCase().trim());
    if (po && inv.amount.value! > po.authorizedAmount) {
      hits.push(`${invNo(inv)} (${fmtUsd(inv.amount.value!)} > ${fmtUsd(po.authorizedAmount)})`);
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: hits,
      detail: `${hits.length} invoice(s) bill more than the authorized PO amount.`,
      evidence: `PO amount overage: ${hits.join('; ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C7 — PO quantity overage (authorizedQty vs billedQty).
function c7PoQuantityOverage(ctx: ControlContext): ControlResult {
  const id = 'IP-C7';
  const name = 'PO quantity overage';
  // Quantity evidence can come either from the invoice rows (authorizedQty/billedQty)
  // or by joining billedQty on the invoice to authorizedQty in the PO register.
  const haveInvoiceQty = ctx.invoices.some((i) => isUsable(i.billedQty));
  const havePoQty = (ctx.poRegister ?? []).some((p) => p.authorizedQty !== undefined);
  const haveInlineAuthQty = ctx.invoices.some((i) => isUsable(i.authorizedQty));

  if (!haveInvoiceQty) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['billedQty'],
      detail: 'No billed-quantity field on invoices — cannot evaluate quantity overage.',
    };
  }
  if (!havePoQty && !haveInlineAuthQty) {
    return {
      controlId: id,
      name,
      status: 'needs_more_evidence',
      missingEvidence: ['authorizedQty (PO register or invoice)'],
      detail: 'Billed quantities present but no authorized quantity to compare against.',
    };
  }

  const poQtyMap = new Map<string, number>();
  for (const p of ctx.poRegister ?? []) {
    if (p.authorizedQty !== undefined)
      poQtyMap.set(p.poNumber.toLowerCase().trim(), p.authorizedQty);
  }

  const hits: string[] = [];
  for (const inv of ctx.invoices) {
    if (!isUsable(inv.billedQty)) continue;
    let authQty: number | undefined;
    if (isUsable(inv.authorizedQty)) authQty = inv.authorizedQty.value;
    else if (isUsable(inv.po)) authQty = poQtyMap.get(inv.po.value.toLowerCase().trim());
    if (authQty !== undefined && inv.billedQty.value > authQty) {
      hits.push(`${invNo(inv)} (billed ${inv.billedQty.value} > authorized ${authQty})`);
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: hits,
      detail: `${hits.length} invoice(s) bill more units than the PO authorized.`,
      evidence: `PO quantity overage: ${hits.join('; ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C8 — line-item math error (lineItemsTotal vs amount).
function c8LineItemMathError(ctx: ControlContext): ControlResult {
  const id = 'IP-C8';
  const name = 'Line-item math error';
  const checkable = ctx.invoices.filter((i) => isUsable(i.lineItemsTotal) && isUsable(i.amount));
  if (checkable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['lineItemsTotal', 'amount'],
      detail: 'No line-item total on any invoice — cannot reconcile against stated total.',
    };
  }
  const hits: string[] = [];
  for (const inv of checkable) {
    const lineTotal = inv.lineItemsTotal!.value!;
    const payable = inv.amount.value!;
    const tax = isUsable(inv.tax) ? inv.tax.value! : 0;
    const withTax = lineTotal + tax;
    const taxReconciles = tax > 0 && Math.abs(withTax - payable) <= Math.max(1, payable * 0.01);
    if (taxReconciles) continue;

    const diff = Math.abs(lineTotal - payable);
    // Documented rule: flag when line items differ from the stated total by
    // >15% OR >$500. The union fires when diff exceeds the SMALLER of the two
    // thresholds (Math.min), matching the route's own pre-filter. Using max here
    // collapsed the rule to "diff > $500 only" and missed small-invoice
    // percentage discrepancies.
    if (diff > Math.min(payable * 0.15, 500)) {
      hits.push(
        `${invNo(inv)} (line items ${fmtUsd(lineTotal)} vs total ${fmtUsd(payable)}${tax > 0 ? `; tax ${fmtUsd(tax)}` : ''})`,
      );
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: hits,
      detail: `${hits.length} invoice(s) have a stated total that does not match line items.`,
      evidence: `Line-item math error: ${hits.join('; ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// amount_total_ambiguity — Amount/Subtotal, Tax, and Total columns disagree on payable.
function amountTotalAmbiguity(ctx: ControlContext): ControlResult {
  const id = 'amount_total_ambiguity';
  const name = 'Amount vs total ambiguity';
  const hits: string[] = [];
  for (const inv of ctx.invoices) {
    if (!isUsable(inv.amount) || !isUsable(inv.tax) || !isUsable(inv.lineItemsTotal)) continue;
    const payable = inv.amount.value!;
    const subtotal = inv.lineItemsTotal.value!;
    const tax = inv.tax.value!;
    const taxReconciles =
      tax > 0 && Math.abs(subtotal + tax - payable) <= Math.max(1, payable * 0.01);
    if (taxReconciles && Math.abs(subtotal - payable) > 0.01) {
      hits.push(
        `${invNo(inv)} (Amount/subtotal ${fmtUsd(subtotal)} + Tax ${fmtUsd(tax)} = payable ${fmtUsd(payable)})`,
      );
    }
  }
  if (hits.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['amount', 'tax', 'lineItemsTotal'],
    };
  }
  return {
    controlId: id,
    name,
    status: 'failed',
    severity: 'critical',
    rows: hits,
    detail: `${hits.length} invoice(s) have Amount/subtotal, Tax, and Total columns that require payable-total precedence.`,
    evidence: `Amount/total ambiguity: ${hits.join('; ')}`,
  };
}

// payable_total_must_win — payable Total column was chosen over Amount subtotal.
function payableTotalMustWin(ctx: ControlContext): ControlResult {
  const id = 'payable_total_must_win';
  const name = 'Payable total precedence';
  const checkable = ctx.invoices.filter(
    (i) => isUsable(i.amount) && isUsable(i.tax) && isUsable(i.lineItemsTotal),
  );
  if (checkable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['amount', 'tax', 'lineItemsTotal'],
    };
  }
  const hits: string[] = [];
  for (const inv of checkable) {
    if (!isUsable(inv.amount) || !isUsable(inv.tax) || !isUsable(inv.lineItemsTotal)) continue;
    const payable = inv.amount.value!;
    const subtotal = inv.lineItemsTotal.value!;
    const tax = inv.tax.value!;
    const taxReconciles =
      tax > 0 && Math.abs(subtotal + tax - payable) <= Math.max(1, payable * 0.01);
    if (!taxReconciles || Math.abs(subtotal - payable) <= 0.01) {
      hits.push(`${invNo(inv)} (payable ${fmtUsd(payable)})`);
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'critical',
      rows: hits,
      detail: 'Payable Total did not win over Amount/subtotal where tax reconciles the gap.',
      evidence: hits.join('; '),
    };
  }
  return {
    controlId: id,
    name,
    status: 'passed',
    detail: 'Payable Total column used as authoritative amount where Amount+Tax reconciles.',
  };
}

// IP-C9 — round-dollar anomaly.
function c9RoundDollar(ctx: ControlContext): ControlResult {
  const id = 'IP-C9';
  const name = 'Round-dollar anomaly';
  const checkable = ctx.invoices.filter((i) => isUsable(i.amount));
  if (checkable.length === 0) {
    return { controlId: id, name, status: 'skipped_field_absent', missingEvidence: ['amount'] };
  }
  const hits: string[] = [];
  for (const inv of checkable) {
    const amt = inv.amount.value!;
    if (amt >= 1000 && (amt % 500 === 0 || (amt >= 10000 && amt % 100 === 0))) {
      hits.push(`${invNo(inv)} (${fmtUsd(amt)})`);
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'medium',
      rows: hits,
      detail: `${hits.length} invoice(s) bill a suspiciously round amount.`,
      evidence: `Round-dollar amounts: ${hits.join('; ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C10 — vendor address (city/state) mismatch vs vendor master.
function c10VendorAddressMismatch(ctx: ControlContext): ControlResult {
  const id = 'IP-C10';
  const name = 'Vendor address mismatch';
  if (!ctx.vendorMaster || ctx.vendorMaster.length === 0) {
    return {
      controlId: id,
      name,
      status: 'needs_more_evidence',
      missingEvidence: ['vendorMaster'],
    };
  }
  const checkable = ctx.invoices.filter(
    (i) => isUsable(i.vendor) && (isUsable(i.vendorCity) || isUsable(i.vendorState)),
  );
  if (checkable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['vendorCity', 'vendorState'],
    };
  }
  const masterByVendor = new Map<string, VendorMasterLike>();
  for (const m of ctx.vendorMaster) masterByVendor.set(normalizeVendorName(m.vendorName), m);
  const hits: string[] = [];
  for (const inv of checkable) {
    const m = masterByVendor.get(normalizeVendorName(inv.vendor.value!));
    if (!m) continue;
    const invCity = (inv.vendorCity?.value ?? '').toLowerCase().trim();
    const invState = (inv.vendorState?.value ?? '').toLowerCase().trim();
    const mCity = (m.city ?? '').toLowerCase().trim();
    const mState = (m.state ?? '').toLowerCase().trim();
    if ((mCity && invCity && invCity !== mCity) || (mState && invState && invState !== mState)) {
      hits.push(invNo(inv));
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: hits,
      detail: `${hits.length} invoice(s) show a city/state that differs from the vendor master.`,
      evidence: `Vendor address mismatch: ${hits.join(', ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C11 — email / domain mismatch vs vendor master.
function c11EmailDomainMismatch(ctx: ControlContext): ControlResult {
  const id = 'IP-C11';
  const name = 'Email / domain mismatch';
  if (!ctx.vendorMaster || ctx.vendorMaster.length === 0) {
    return {
      controlId: id,
      name,
      status: 'needs_more_evidence',
      missingEvidence: ['vendorMaster'],
    };
  }
  const checkable = ctx.invoices.filter((i) => isUsable(i.vendor) && isUsable(i.emailDomain));
  if (checkable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['emailDomain'],
    };
  }
  const masterByVendor = new Map<string, VendorMasterLike>();
  for (const m of ctx.vendorMaster) masterByVendor.set(normalizeVendorName(m.vendorName), m);
  const hits: string[] = [];
  for (const inv of checkable) {
    const m = masterByVendor.get(normalizeVendorName(inv.vendor.value!));
    if (!m || !m.expectedEmailDomain) continue;
    const expected = m.expectedEmailDomain.replace(/^@/, '').toLowerCase();
    if (inv.emailDomain!.value!.toLowerCase() !== expected) {
      hits.push(`${invNo(inv)} (@${inv.emailDomain!.value} vs @${expected})`);
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: hits,
      detail: `${hits.length} invoice(s) use an email domain that differs from the vendor master.`,
      evidence: `Email domain mismatch: ${hits.join('; ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C12 — approval authority mismatch (amount exceeds approver's limit).
function c12ApprovalAuthority(ctx: ControlContext): ControlResult {
  const id = 'IP-C12';
  const name = 'Approval authority mismatch';
  if (!ctx.approvalMatrix || ctx.approvalMatrix.length === 0) {
    return {
      controlId: id,
      name,
      status: 'needs_more_evidence',
      missingEvidence: ['approvalMatrix'],
      detail: 'No approval matrix provided — cannot verify approver limits.',
    };
  }
  const checkable = ctx.invoices.filter((i) => isUsable(i.amount) && isUsable(i.approverRole));
  if (checkable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['approverRole', 'amount'],
      detail: 'No approver role on any invoice — cannot map to an approval limit.',
    };
  }
  const limitByRole = new Map<string, number>();
  for (const a of ctx.approvalMatrix)
    limitByRole.set(a.approverRole.toLowerCase().trim(), a.approvalLimit);
  const hits: string[] = [];
  for (const inv of checkable) {
    const limit = limitByRole.get(inv.approverRole!.value!.toLowerCase().trim());
    if (limit !== undefined && inv.amount.value! > limit) {
      hits.push(
        `${invNo(inv)} (${fmtUsd(inv.amount.value!)} approved by ${inv.approverRole!.value} whose limit is ${fmtUsd(limit)})`,
      );
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: hits,
      detail: `${hits.length} invoice(s) exceed the approving role's authority limit.`,
      evidence: `Approval authority exceeded: ${hits.join('; ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C13 — inactive / suspended vendor.
function c13InactiveVendor(ctx: ControlContext): ControlResult {
  const id = 'IP-C13';
  const name = 'Inactive / suspended vendor';
  const keywords = (ctx.inactiveStatusKeywords ?? INACTIVE_KEYWORDS).map((k) => k.toLowerCase());

  // Status can be carried on the invoice (vendorStatus) or on the vendor master.
  const masterStatus = new Map<string, string>();
  for (const m of ctx.vendorMaster ?? []) {
    if (m.status) masterStatus.set(normalizeVendorName(m.vendorName), m.status.toLowerCase());
  }
  const haveInvoiceStatus = ctx.invoices.some((i) => isUsable(i.vendorStatus));
  const haveMasterStatus = masterStatus.size > 0;

  if (!haveInvoiceStatus && !haveMasterStatus) {
    return {
      controlId: id,
      name,
      status: 'needs_more_evidence',
      missingEvidence: ['vendorStatus (invoice or vendorMaster)'],
      detail: 'No vendor status on invoices or vendor master — cannot evaluate vendor standing.',
    };
  }

  const hits: string[] = [];
  for (const inv of ctx.invoices) {
    let status: string | undefined;
    if (isUsable(inv.vendorStatus)) status = inv.vendorStatus.value.toLowerCase();
    else if (isUsable(inv.vendor)) status = masterStatus.get(normalizeVendorName(inv.vendor.value));
    if (status && keywords.some((k) => status!.includes(k))) {
      hits.push(`${invNo(inv)} (status: ${status})`);
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: hits,
      detail: `${hits.length} invoice(s) are from a vendor flagged inactive/suspended/noncompliant.`,
      evidence: `Inactive/suspended vendor: ${hits.join('; ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C14 — remit address mismatch vs vendor master.
function c14RemitAddressMismatch(ctx: ControlContext): ControlResult {
  const id = 'IP-C14';
  const name = 'Remit address mismatch';
  if (!ctx.vendorMaster || ctx.vendorMaster.length === 0) {
    return {
      controlId: id,
      name,
      status: 'needs_more_evidence',
      missingEvidence: ['vendorMaster'],
    };
  }
  const checkable = ctx.invoices.filter((i) => isUsable(i.vendor) && isUsable(i.remitAddress));
  if (checkable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['remitAddress'],
    };
  }
  const masterByVendor = new Map<string, VendorMasterLike>();
  for (const m of ctx.vendorMaster) masterByVendor.set(normalizeVendorName(m.vendorName), m);

  const normAddr = (a: string) =>
    a.toLowerCase().replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim();
  const hits: string[] = [];
  for (const inv of checkable) {
    const m = masterByVendor.get(normalizeVendorName(inv.vendor.value!));
    if (!m || !m.remitAddress) continue;
    if (normAddr(inv.remitAddress!.value!) !== normAddr(m.remitAddress)) {
      hits.push(invNo(inv));
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: hits,
      detail: `${hits.length} invoice(s) list a remit-to address that differs from the vendor master.`,
      evidence: `Remit address mismatch: ${hits.join(', ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

// IP-C15 — near duplicate: same vendor + same amount, different invoice numbers.
function c15NearDuplicate(ctx: ControlContext): ControlResult {
  const id = 'IP-C15';
  const name = 'Near duplicate (same vendor + same amount)';
  const usable = ctx.invoices.filter(
    (i) => isUsable(i.vendor) && isUsable(i.amount) && isUsable(i.invoiceNo),
  );
  if (usable.length === 0) {
    return {
      controlId: id,
      name,
      status: 'skipped_field_absent',
      missingEvidence: ['vendor', 'amount', 'invoiceNo'],
    };
  }
  const groups = new Map<string, NormalizedInvoice[]>();
  for (const inv of usable) {
    const key = `${normalizeVendorName(inv.vendor.value!)}|${inv.amount.value!}`;
    groups.set(key, [...(groups.get(key) ?? []), inv]);
  }
  const hits: string[] = [];
  for (const group of groups.values()) {
    const distinctNos = new Set(group.map((g) => g.invoiceNo.value!.toLowerCase()));
    if (group.length > 1 && distinctNos.size > 1) {
      hits.push(group.map(invNo).join(' + '));
    }
  }
  if (hits.length > 0) {
    return {
      controlId: id,
      name,
      status: 'failed',
      severity: 'high',
      rows: hits,
      detail: `${hits.length} vendor/amount group(s) bill the same amount under different invoice numbers.`,
      evidence: `Near-duplicate groups: ${hits.join('; ')}`,
    };
  }
  return { controlId: id, name, status: 'passed' };
}

/** Run all invoice controls against the context. */
export function runControls(ctx: ControlContext): ControlResult[] {
  return [
    c1ExactDuplicate(ctx),
    c2ModifiedDuplicate(ctx),
    c3CrossSubmissionDuplicate(ctx),
    c4BankMismatch(ctx),
    c5MissingPo(ctx),
    c6PoAmountOverage(ctx),
    c7PoQuantityOverage(ctx),
    c8LineItemMathError(ctx),
    amountTotalAmbiguity(ctx),
    payableTotalMustWin(ctx),
    c9RoundDollar(ctx),
    c10VendorAddressMismatch(ctx),
    c11EmailDomainMismatch(ctx),
    c12ApprovalAuthority(ctx),
    c13InactiveVendor(ctx),
    c14RemitAddressMismatch(ctx),
    c15NearDuplicate(ctx),
  ];
}

/** Aggregate control results into a coverage summary. */
export function buildCoverageSummary(results: ControlResult[]): CoverageSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let needs = 0;
  for (const r of results) {
    switch (r.status) {
      case 'passed':
        passed++;
        break;
      case 'failed':
        failed++;
        break;
      case 'needs_more_evidence':
        needs++;
        break;
      case 'skipped_field_absent':
      case 'skipped_uninterpretable':
        skipped++;
        break;
    }
  }
  return {
    total_controls: results.length,
    checked: passed + failed,
    passed,
    failed,
    skipped,
    needs_more_evidence: needs,
  };
}
