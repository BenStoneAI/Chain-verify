// Canonical alias registry for InvoiceProof field normalization.
//
// Maps messy customer header/key names to canonical field names so that
// "Invoice Number", "invoice_number", "INVOICE NUMBER", "inv #" all resolve to
// `invoiceNo`. Matching is case-insensitive, BOM-stripped, and whitespace /
// underscore / space collapsed. A fuzzy fallback (token-overlap + edit distance)
// handles near-miss headers with a reduced confidence.

export type CanonicalField =
  | 'invoiceNo'
  | 'vendor'
  | 'amount'
  | 'rawAmount'
  | 'po'
  | 'bankRouting'
  | 'bankAccount'
  | 'lineItemsTotal'
  | 'vendorCity'
  | 'vendorState'
  | 'invoiceDate'
  | 'dueDate'
  | 'emailDomain'
  | 'remitAddress'
  | 'approvalAmount'
  | 'approverRole'
  | 'vendorStatus'
  | 'authorizedQty'
  | 'billedQty'
  | 'authorizedAmount'
  | 'tax';

/**
 * Canonical field -> alias list. Aliases are stored verbatim and normalized at
 * lookup time, so "invoice number" and "invoice_number" both reduce to the same
 * key. Order does not matter; lookup is by normalized exact match first.
 */
export const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  invoiceNo: [
    'invoiceNo',
    'invoice_no',
    'invoice_number',
    'invoice number',
    'inv #',
    'invoice #',
    'invoice#',
    'inv#',
    'inv',
    'voucher',
    'voucher number',
    'voucher no',
    'invoice no',
    'invoice no.',
    'inv',
    'inv_no',
    'inv no',
    'document number',
    'doc',
    'doc no',
    'doc_no',
    'bill no',
    'bill_no',
    'reference no',
    'reference_no',
    'invoice id',
    'invoice_id',
  ],
  vendor: [
    'vendor',
    'vendor_name',
    'vendor name',
    'supplier',
    'supplier_name',
    'supplier name',
    'payee',
    'payee_name',
    'payee name',
    'company',
    'company_name',
    'company name',
    'vendor legal entity',
    'vendor_legal_entity',
  ],
  amount: [
    'amount',
    'amount_total',
    'invoice_total',
    'invoice total',
    'total',
    'grand_total',
    'grand total',
    'billed_amount',
    'billed amount',
    'net_amount',
    'net amount',
    'amount_due',
    'amount due',
    'pay this amount',
    'pay this am0unt',
    'gross amount',
    'gross_amount',
    'payment total',
    'payment_total',
    'balance_due',
    'balance due',
    'payable',
    'payable_amount',
    'payable amount',
  ],
  rawAmount: ['raw_amount', 'raw amount', 'amount_text'],
  po: [
    'po',
    'po_number',
    'po number',
    'po num',
    'po_num',
    'purchase_order',
    'purchase order',
    'purchase_order_number',
    'purchase order number',
    'order_no',
    'order no',
    'po_ref',
    'po ref',
    'po reference',
    'po_reference',
    'standing_order_id',
    'standing order id',
    'standing order',
  ],
  bankRouting: [
    'routing_number',
    'routing number',
    'bank_routing',
    'bank routing',
    'ach routing',
    'ach_routing',
    'aba',
    'ach aba',
    'ach_aba',
    'routing no',
    'routing_no',
    'bank routing number',
    'bank_routing_number',
    'bank',
    'bank_or_payment_details',
    'bank or payment details',
    'bank_details',
    'bank details',
    'approved_bank_details',
    'approved bank details',
    'approved_bank_or_payment_details',
    'approved bank or payment details',
    'bank_token',
    'approved_bank_token',
  ],
  bankAccount: [
    'account_number',
    'account number',
    'bank_account',
    'bank account',
    'bank acct',
    'bank_acct',
    'acct no',
    'acct_no',
    'ach account',
    'ach_account',
    'bank instructions',
    'bank_instructions',
  ],
  tax: ['tax', 'sales_tax', 'sales tax', 'tax_amount', 'tax amount', 'vat', 'gst', 'hst'],
  lineItemsTotal: [
    'line_items_total',
    'line items total',
    'lineitemstotal',
    'line_item_total',
    'subtotal',
    'sub_total',
    'items_total',
  ],
  vendorCity: [
    'city',
    'vendor_city',
    'vendor city',
    'remit city',
    'remit_city',
    'billing_city',
    'billing city',
    'supplier city',
    'supplier_city',
  ],
  vendorState: [
    'state',
    'vendor_state',
    'vendor state',
    'remit state',
    'remit_state',
    'billing_state',
    'billing state',
    'supplier state',
    'supplier_state',
  ],
  invoiceDate: ['invoice_date', 'invoice date', 'date', 'issue_date', 'issue date', 'billing_date'],
  dueDate: ['due_date', 'due date', 'payment_due', 'payment due', 'net_due'],
  emailDomain: [
    'email',
    'vendor_email',
    'vendor email',
    'remit_email',
    'remit email',
    'sender_email',
    'sender email',
    'contact_email',
    'contact email',
    'email_domain',
    'email domain',
    'sender_domain',
    'sender domain',
    'approved_domain',
    'approved domain',
    'expected_sender_domain',
    'expected sender domain',
    'approved_sender_domain',
    'approved sender domain',
  ],
  remitAddress: [
    'remit_to',
    'remit to',
    'remit address',
    'remit_address',
    'remittance address',
    'remittance_address',
    'payment address',
    'payment_address',
    'mailing address',
    'mailing_address',
    'approved_address',
    'approved address',
    'approved_remit_address',
    'approved remit address',
  ],
  approvalAmount: [
    'approval_limit',
    'approval limit',
    'approver_limit',
    'approver limit',
    'authorized_limit',
    'authorized limit',
    'approval threshold',
    'approval_threshold',
    'approval_amount',
    'approval amount',
  ],
  approverRole: [
    'approver_role',
    'approver role',
    'approver',
    'approved_by',
    'approved by',
    'role',
    'authorized_approver_role',
    'authorized approver role',
  ],
  vendorStatus: [
    'status',
    'vendor_status',
    'vendor status',
    'supplier_status',
    'supplier status',
    'compliance_status',
    'compliance status',
    'active_status',
    'active status',
  ],
  authorizedQty: [
    'authorized_qty',
    'authorized qty',
    'ordered_qty',
    'ordered qty',
    'po_qty',
    'po qty',
    'quantity_ordered',
    'quantity ordered',
    'qty_ordered',
    'qty ordered',
    'authorized_quantity',
    'authorized quantity',
  ],
  billedQty: [
    'billed_qty',
    'billed qty',
    'invoice_qty',
    'invoice qty',
    'quantity',
    'qty',
    'delivered_qty',
    'delivered qty',
    'quantity_billed',
    'quantity billed',
    'billed_quantity',
    'billed quantity',
  ],
  authorizedAmount: [
    'authorized_amount',
    'authorized amount',
    'po_amount',
    'po amount',
    'po_total',
    'po total',
  ],
};

/**
 * Normalize a header/key for matching: strip BOM, lowercase, trim, and collapse
 * any run of whitespace / underscores / hyphens / extra punctuation into a single
 * space so "Invoice_Number", "INVOICE NUMBER", "invoice  number" all collapse to
 * "invoice number".
 */
export function normalizeHeaderKey(header: string): string {
  return header
    .replace(/^\uFEFF/, '') // strip BOM
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/[^a-z0-9 #&.-]/g, '') // keep meaningful symbols (# for "inv #")
    .trim();
}

// Pre-build a normalized exact-match lookup: normalizedAlias -> canonical field.
const EXACT_LOOKUP: Map<string, CanonicalField> = (() => {
  const m = new Map<string, CanonicalField>();
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES) as [
    CanonicalField,
    string[],
  ][]) {
    // Canonical name itself is always a valid alias.
    m.set(normalizeHeaderKey(canonical), canonical);
    for (const alias of aliases) {
      m.set(normalizeHeaderKey(alias), canonical);
    }
  }
  return m;
})();

/** Levenshtein edit distance (small strings only — header keys). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Token-overlap ratio between two normalized header strings. */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

export type ResolvedField = {
  canonical: CanonicalField;
  source: 'exact' | 'alias' | 'fuzzy';
  confidence: number;
};

/**
 * Resolve a raw header to a canonical field.
 *   - exact canonical-name match    → source 'exact'
 *   - normalized alias match        → source 'alias'
 *   - fuzzy (token overlap / edit)  → source 'fuzzy' with confidence < 1
 * Returns null when nothing clears the fuzzy threshold (caller keeps it as an
 * unknown field rather than guessing).
 */
export function resolveCanonicalField(header: string): ResolvedField | null {
  const norm = normalizeHeaderKey(header);
  if (!norm) return null;

  // Exact / alias match.
  const direct = EXACT_LOOKUP.get(norm);
  if (direct) {
    const isCanonicalName = normalizeHeaderKey(direct) === norm;
    return {
      canonical: direct,
      source: isCanonicalName ? 'exact' : 'alias',
      confidence: isCanonicalName ? 1 : 0.95,
    };
  }

  // Fuzzy fallback — score every known alias, take the best above threshold.
  let best: { canonical: CanonicalField; score: number } | null = null;
  for (const [alias, canonical] of EXACT_LOOKUP.entries()) {
    const overlap = tokenOverlap(norm, alias);
    const dist = levenshtein(norm, alias);
    const maxLen = Math.max(norm.length, alias.length) || 1;
    const editScore = 1 - dist / maxLen;
    // Weighted blend: token overlap dominates, edit score breaks ties.
    const score = overlap * 0.7 + editScore * 0.3;
    if (!best || score > best.score) best = { canonical, score };
  }

  if (best && best.score >= 0.6) {
    return {
      canonical: best.canonical,
      source: 'fuzzy',
      confidence: Number(best.score.toFixed(2)),
    };
  }
  return null;
}

const LEGAL_SUFFIXES = [
  'incorporated',
  'corporation',
  'company',
  'inc',
  'llc',
  'ltd',
  'corp',
  'co',
];

/**
 * Normalize a vendor name for cross-record comparison: lowercase, strip
 * punctuation, collapse whitespace, and remove trailing legal suffixes so
 * "Acme Industrial, Inc." and "acme industrial llc" both reduce to
 * "acme industrial".
 */
export function normalizeVendorName(name: string): string {
  let n = name
    .toLowerCase()
    .replace(/[.,&/\\#!$%^*;:{}=\-_`~()'"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Remove legal suffixes from the end, possibly several stacked.
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      const re = new RegExp(`\\s${suffix}$`);
      if (re.test(n)) {
        n = n.replace(re, '').trim();
        changed = true;
      }
    }
  }
  return n;
}
