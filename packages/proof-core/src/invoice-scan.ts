import { isUsable } from './field-value.js';
import {
  normalizeInvoice,
  normalizeMany,
  parseInput,
  type NormalizedInvoice,
} from './normalizers/invoice-normalizer.js';
import {
  buildCoverageSummary,
  runControls,
  type ApprovalMatrixEntry,
  type ControlResult,
  type CoverageSummary,
} from './control-readiness.js';

export type Row = {
  vendor: string;
  invoiceNo: string;
  amount: number;
  rawAmount: string;
  po: string;
  bank: string;
  /** Sum of line items parsed from the 6th CSV column, if provided. */
  lineItemsTotal?: number;
  /** Tax column when Amount is subtotal and Total is payable. */
  tax?: number;
  /** Explicit vendor city from structured invoice input (avoids comma-parsing the vendor name). */
  vendorCity?: string;
  /** Explicit vendor state from structured invoice input. */
  vendorState?: string;
};

export type Finding = {
  severity: 'critical' | 'high' | 'medium';
  pattern: string;
  detail: string;
  rows: string[];
  /** Concrete data point that triggered this finding — machine-readable audit trail. */
  evidence?: string;
};

/** One entry in the PO register supplied by the caller. */
export type PORegisterEntry = {
  poNumber: string;
  vendorName: string;
  authorizedQty?: number;
  authorizedAmount: number;
};

/** One entry in the vendor master supplied by the caller. */
export type VendorMasterEntry = {
  vendorName: string;
  city?: string;
  state?: string;
  expectedEmailDomain?: string;
  // Optional banking fields for BEC / FRAUD-004 detection
  bankRoutingNumber?: string;
  bankAccountNumber?: string;
  bankAccountLast4?: string;
};

/** Stored record written to per-org history after each successful scan. */
export type HistoryRecord = {
  invoiceNo: string;
  vendor: string;
  amount: number;
  po: string;
  submittedAt: Date;
};

/**
 * Detect standing orders: invoices from same vendor with same PO and
 * numerically sequential invoice numbers (e.g. INV-001, INV-002, INV-003).
 *
 * Two-tier heuristic:
 *   - Strong pattern (3+ entries in group, ≥3 sequential): mark as confirmed standing order.
 *   - Likely pattern (2+ entries in group, same amount, ≥2 sequential): mark as likely
 *     standing order — sufficient to suppress the duplicate warning (VALID-002).
 *
 * Returns a Set of invoiceNo strings that are part of a standing order so
 * callers can suppress duplicate warnings for them.
 */
export function detectStandingOrders(records: HistoryRecord[]): Set<string> {
  const standingInvoiceNos = new Set<string>();

  // Group by vendor + po
  const groups = new Map<string, HistoryRecord[]>();
  for (const r of records) {
    if (!r.po) continue;
    const k = `${r.vendor.toLowerCase()}|${r.po.toLowerCase()}`;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Extract trailing numeric suffixes from invoice numbers, e.g. INV-007 → 7
    const parsed = group
      .map((r) => {
        const m = r.invoiceNo.match(/(\d+)\s*$/);
        return m ? { record: r, seq: parseInt(m[1], 10) } : null;
      })
      .filter((x): x is { record: HistoryRecord; seq: number } => x !== null)
      .sort((a, b) => a.seq - b.seq);

    if (parsed.length < 2) continue;

    // Determine minimum consecutive streak required:
    //   - 3+ group members  → require streak of 3 (confirmed)
    //   - 2 group members with same amount → require streak of 2 (likely standing order)
    const sameAmount = group.every((r) => r.amount === group[0].amount);
    const minStreak = group.length >= 3 ? 3 : sameAmount ? 2 : 3;

    let streak = 1;
    const streakNos = [parsed[0].record.invoiceNo];
    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i].seq === parsed[i - 1].seq + 1) {
        streak++;
        streakNos.push(parsed[i].record.invoiceNo);
      } else {
        if (streak >= minStreak) break;
        streak = 1;
        streakNos.length = 0;
        streakNos.push(parsed[i].record.invoiceNo);
      }
    }

    if (streak >= minStreak) {
      for (const no of streakNos) standingInvoiceNos.add(no);
    }
  }

  return standingInvoiceNos;
}

/**
 * Map a NormalizedInvoice (FieldValue-wrapped) down to the legacy flat Row used by
 * the existing scanInvoices Finding logic. Unusable numeric fields collapse to 0
 * here ONLY for the legacy path — the authoritative skipped-control accounting is
 * surfaced separately via scanInvoicesWithCoverage so a failure to parse never
 * silently reads as "clean".
 */
export function normalizedToRow(n: NormalizedInvoice): Row {
  const amount = isUsable(n.amount) ? n.amount.value : 0;
  const rawPo = isUsable(n.po) ? n.po.value.trim() : '';
  const po =
    /^(?:--|n\/?a|none|null)$/i.test(rawPo) ||
    /\b(?:not available|unavailable|missing|per phone ok|verbal)\b/i.test(rawPo)
      ? ''
      : rawPo;
  const row: Row = {
    vendor: isUsable(n.vendor) ? n.vendor.value : '',
    invoiceNo: isUsable(n.invoiceNo) ? n.invoiceNo.value : '',
    amount,
    rawAmount: n.rawAmount ?? (isUsable(n.amount) ? String(n.amount.value) : ''),
    po,
    bank: isUsable(n.bankRouting)
      ? n.bankRouting.value.replace(/[^0-9]/g, '')
      : isUsable(n.bankAccount)
        ? n.bankAccount.value.replace(/[^0-9]/g, '')
        : '',
  };
  if (isUsable(n.tax)) row.tax = n.tax.value;
  if (isUsable(n.lineItemsTotal) && isUsable(n.amount)) {
    const payable = n.amount.value!;
    const subtotal = n.lineItemsTotal.value!;
    const tax = isUsable(n.tax) ? n.tax.value! : 0;
    const taxReconciles =
      tax > 0 && Math.abs(subtotal + tax - payable) <= Math.max(1, payable * 0.01);
    if (!taxReconciles) {
      row.lineItemsTotal = subtotal;
    }
  } else if (isUsable(n.lineItemsTotal)) {
    row.lineItemsTotal = n.lineItemsTotal.value;
  }
  if (isUsable(n.vendorCity)) row.vendorCity = n.vendorCity.value;
  if (isUsable(n.vendorState)) row.vendorState = n.vendorState.value;
  return row;
}

/**
 * Parse raw invoice text into legacy Row[]. Backward-compatible signature, but the
 * internals now delegate to the header-keyed normalizer (CSV/TSV/prose, BOM,
 * quoted values, reordered/unknown columns). Positional parsing is only used as a
 * last-resort fallback when no header row is recognized.
 */
export function parseInvoices(text: string): Row[] {
  const { rows } = parseInput({ text });
  if (rows.length === 0) return [];
  return normalizeMany(rows).map(normalizedToRow);
}

/**
 * @param rows         Parsed rows from the current submission.
 * @param history      Optional stored records from previous submissions for this
 *                     org/IP. Used for cross-submission duplicate detection (C-1)
 *                     and standing-order suppression (C-2).
 *                     Bug 1 fix: this must be IP-only history, NOT merged with seededHistory.
 * @param poRegister   Optional PO register for quantity/amount overage checks (H-2).
 * @param vendorMaster Optional vendor master for address/domain mismatch checks (H-3, L-1).
 * @param seedContext  Optional prior-payment-register records. Used for two purposes:
 *                     (1) supplementary bank-change detection context; and
 *                     (2) recency-windowed duplicate detection — if a seed record's
 *                     submittedAt is within 90 days of `now`, resubmitting that invoice
 *                     is flagged as EXACT_DUPLICATE or MODIFIED_DUPLICATE. Seed records
 *                     older than 90 days are ignored to avoid false positives on
 *                     historical payment archives.
 * @param now          Reference date for the 90-day recency window (defaults to today).
 *                     Inject in tests to get deterministic results.
 */
export function scanInvoices(
  rows: Row[],
  history: HistoryRecord[] = [],
  poRegister: PORegisterEntry[] = [],
  vendorMaster: VendorMasterEntry[] = [],
  seedContext: HistoryRecord[] = [],
  now: Date = new Date(),
): Finding[] {
  const findings: Finding[] = [];
  const exactDupNos = new Set<string>();
  const markExactOrModifiedDup = (invoiceNo: string) => {
    if (invoiceNo.trim()) exactDupNos.add(invoiceNo.toLowerCase());
  };

  // --- Intra-batch duplicate detection (no history needed) ---
  // Two rows with the same invoice number in the same submission = pay-twice risk.
  {
    const batchSeen = new Map<string, Row>();
    for (const r of rows) {
      const key = r.invoiceNo.toLowerCase();
      const prev = batchSeen.get(key);
      if (prev) {
        const fmtAmt = r.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        if (prev.amount === r.amount) {
          markExactOrModifiedDup(r.invoiceNo);
          findings.push({
            severity: 'critical',
            pattern: 'Exact duplicate (EXACT_DUPLICATE)',
            detail: `EXACT_DUPLICATE — Invoice ${r.invoiceNo} appears twice in this submission at ${fmtAmt}. Do not pay both.`,
            rows: [r.invoiceNo],
            evidence: `Invoice ${r.invoiceNo} submitted twice in same batch at identical amount ${fmtAmt}`,
          });
        } else {
          markExactOrModifiedDup(r.invoiceNo);
          const fmtPrev = prev.amount.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
          });
          findings.push({
            severity: 'critical',
            pattern: 'Modified duplicate (MODIFIED_DUPLICATE)',
            detail: `Invoice ${r.invoiceNo} appears twice in this submission with different amounts (${fmtPrev} vs ${fmtAmt}).`,
            rows: [r.invoiceNo],
            evidence: `Invoice ${r.invoiceNo} submitted twice — first ${fmtPrev}, then ${fmtAmt}`,
          });
        }
      } else {
        batchSeen.set(key, r);
      }
    }
  }

  // --- Cross-submission checks (require history) ---

  // C-3: MODIFIED_DUPLICATE — same invoice number, different amount across submissions.
  // This is the most dangerous fraud vector: re-presenting an invoice with an inflated amount.
  if (history.length > 0) {
    const histByInvoiceNo = new Map<string, HistoryRecord>();
    for (const h of history) histByInvoiceNo.set(h.invoiceNo.toLowerCase(), h);

    for (const r of rows) {
      const prev = histByInvoiceNo.get(r.invoiceNo.toLowerCase());
      if (!prev) continue;

      const prevDate =
        prev.submittedAt instanceof Date
          ? prev.submittedAt.toISOString().slice(0, 10)
          : String(prev.submittedAt).slice(0, 10);

      if (prev.amount === r.amount) {
        // FRAUD-001: Exact duplicate — same invoice number AND same amount resubmitted
        markExactOrModifiedDup(r.invoiceNo);
        const fmtAmt = r.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        findings.push({
          severity: 'critical',
          pattern: 'Exact duplicate (EXACT_DUPLICATE)',
          detail: `EXACT_DUPLICATE — Invoice ${r.invoiceNo} for ${fmtAmt} was already paid on ${prevDate}. Do not pay again.`,
          rows: [r.invoiceNo],
          evidence: `Invoice ${r.invoiceNo} resubmitted at identical amount ${fmtAmt} (originally submitted ${prevDate})`,
        });
      } else {
        // FRAUD-001 / C-3: Modified duplicate — same invoice number, different amount
        markExactOrModifiedDup(r.invoiceNo);
        const fmtPrev = prev.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        const fmtNew = r.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        findings.push({
          severity: 'critical',
          pattern: 'Modified duplicate (MODIFIED_DUPLICATE)',
          detail: `Invoice ${r.invoiceNo} from ${r.vendor} was previously submitted at ${fmtPrev} but is now presented at ${fmtNew} — a re-presented invoice with an altered amount is the highest-risk fraud vector.`,
          rows: [r.invoiceNo],
          evidence: `Invoice ${r.invoiceNo} resubmitted — prior amount ${fmtPrev} (submitted ${prevDate}), new amount ${fmtNew}`,
        });
      }
    }
  }

  // Seed-context recency check: flag invoices that were recently paid (within 90 days)
  // according to the caller-supplied payment register (seedContext). Invoices paid more
  // than 90 days ago are NOT flagged — historical archives must not produce false positives.
  if (seedContext.length > 0) {
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const seedByInvoiceNo = new Map<string, HistoryRecord>();
    for (const s of seedContext) {
      seedByInvoiceNo.set(s.invoiceNo.toLowerCase(), s);
    }

    for (const r of rows) {
      const seed = seedByInvoiceNo.get(r.invoiceNo.toLowerCase());
      if (!seed) continue;

      const seedDate =
        seed.submittedAt instanceof Date ? seed.submittedAt : new Date(seed.submittedAt);
      const ageMs = now.getTime() - seedDate.getTime();
      const isExactMatch = seed.amount === r.amount;
      // Exact duplicates (same invoice + same amount) are always fraud regardless of age.
      // Only skip old records for modified-duplicate detection (price changes can be legitimate).
      if (ageMs > NINETY_DAYS_MS && !isExactMatch) continue;

      const seedDateStr = seedDate.toISOString().slice(0, 10);
      if (seed.amount === r.amount) {
        markExactOrModifiedDup(r.invoiceNo);
        const fmtAmt = r.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        findings.push({
          severity: 'critical',
          pattern: 'Exact duplicate (EXACT_DUPLICATE)',
          detail: `EXACT_DUPLICATE — Invoice ${r.invoiceNo} for ${fmtAmt} was already paid on ${seedDateStr} (within the last 90 days). Do not pay again.`,
          rows: [r.invoiceNo],
          evidence: `Invoice ${r.invoiceNo} matches payment register record from ${seedDateStr} at identical amount ${fmtAmt}`,
        });
      } else {
        markExactOrModifiedDup(r.invoiceNo);
        const fmtSeed = seed.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        const fmtNew = r.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        findings.push({
          severity: 'critical',
          pattern: 'Modified duplicate (MODIFIED_DUPLICATE)',
          detail: `MODIFIED_DUPLICATE — Invoice ${r.invoiceNo} from ${r.vendor} was paid on ${seedDateStr} at ${fmtSeed} but is now resubmitted at ${fmtNew} — a recently-paid invoice with an altered amount is the highest-risk fraud vector.`,
          rows: [r.invoiceNo],
          evidence: `Invoice ${r.invoiceNo} matches payment register record from ${seedDateStr} — prior amount ${fmtSeed}, resubmitted at ${fmtNew}`,
        });
      }
    }
  }

  // C-2: Standing order detection — build the combined record set (history + current rows
  // coerced to HistoryRecord) so the detector has the full picture.
  const combinedHistory: HistoryRecord[] = [
    ...history,
    ...rows.map((r) => ({
      invoiceNo: r.invoiceNo,
      vendor: r.vendor,
      amount: r.amount,
      po: r.po,
      submittedAt: new Date(),
    })),
  ];
  const standingOrderNos = detectStandingOrders(combinedHistory);

  // 1. Exact + near duplicates: same vendor + same amount, different invoice no.
  // Suppress for invoices that are part of a standing order (C-2).
  const byKey = new Map<string, Row[]>();
  rows.forEach((r) => {
    const k = `${r.vendor.toLowerCase()}|${r.amount}`;
    byKey.set(k, [...(byKey.get(k) || []), r]);
  });
  byKey.forEach((group) => {
    // Filter out standing-order members and invoices already caught as exact /
    // modified duplicates before raising a near-duplicate warning.
    const nonStanding = group.filter(
      (r) => !standingOrderNos.has(r.invoiceNo) && !exactDupNos.has(r.invoiceNo.toLowerCase()),
    );
    const distinctInvoiceNos = new Set(nonStanding.map((r) => r.invoiceNo.toLowerCase()));
    if (nonStanding.length > 1 && distinctInvoiceNos.size > 1) {
      const invoiceList = nonStanding.map((g) => g.invoiceNo).join(', ');
      findings.push({
        severity: 'high',
        pattern: 'Duplicate / near-duplicate payment',
        detail: `${nonStanding[0].vendor} appears ${nonStanding.length}× at the same amount (${nonStanding[0].rawAmount}) under different invoice numbers — a classic pay-twice pattern.`,
        rows: nonStanding.map((g) => g.invoiceNo),
        evidence: `Invoice numbers ${invoiceList} all bill ${nonStanding[0].rawAmount} from vendor ${nonStanding[0].vendor}`,
      });
    }
  });

  // 2. Bank-detail change: same vendor, differing bank identifiers
  const byVendor = new Map<string, Set<string>>();
  const vendorRows = new Map<string, string[]>();
  rows.forEach((r) => {
    if (!r.bank) return;
    const v = r.vendor.toLowerCase();
    byVendor.set(v, (byVendor.get(v) || new Set()).add(r.bank));
    vendorRows.set(v, [...(vendorRows.get(v) || []), r.invoiceNo]);
  });
  byVendor.forEach((banks, v) => {
    if (banks.size > 1) {
      const vendorName = rows.find((r) => r.vendor.toLowerCase() === v)?.vendor || v;
      const bankList = Array.from(banks).join(', ');
      findings.push({
        severity: 'high',
        pattern: 'Bank-detail change',
        detail: `${vendorName} has ${banks.size} different bank identifiers across its invoices — the leading wire-fraud (BEC) signal.`,
        rows: vendorRows.get(v) || [],
        evidence: `Vendor ${vendorName} bank identifiers found: ${bankList}`,
      });
    }
  });

  // 3. Missing PO — M-1: severity escalates to HIGH when any invoice exceeds $2,499
  const noPo = rows.filter((r) => !r.po);
  if (noPo.length) {
    const highValueNoPo = noPo.filter((r) => r.amount > 2499);
    const severity: 'high' | 'medium' = highValueNoPo.length > 0 ? 'high' : 'medium';
    const evidenceRows = noPo.map((r) => `${r.invoiceNo} (${r.rawAmount})`).join(', ');
    findings.push({
      severity,
      pattern: 'Missing / ghost PO',
      detail: `${noPo.length} invoice${noPo.length === 1 ? '' : 's'} reference no purchase order — unmatched spend that bypasses procurement control.${highValueNoPo.length > 0 ? ` ${highValueNoPo.length} exceed${'s'} the $2,499 high-value threshold.` : ''}`,
      rows: noPo.map((r) => r.invoiceNo),
      evidence: `Invoices with no PO: ${evidenceRows}`,
    });
  }

  // 4. Line-item math error: stated total doesn't match sum of line items.
  // The 6th CSV column (lineItemsTotal) carries the computed sum. If present and
  // it differs from the stated amount by more than $0.01 we flag it at high severity —
  // this is the correct finding for the Rocky Mountain Hydraulics ($11,000 stated vs
  // $10,000 line-item sum) scenario, not a round-number anomaly.
  const mathErrorNos = new Set<string>();
  const mathErrors = rows.filter((r) => {
    if (r.lineItemsTotal === undefined) return false;
    if (
      r.tax !== undefined &&
      r.tax > 0 &&
      Math.abs(r.lineItemsTotal + r.tax - r.amount) <= Math.max(1, r.amount * 0.01)
    ) {
      return false;
    }
    return Math.abs(r.lineItemsTotal - r.amount) > 0.01;
  });
  if (mathErrors.length) {
    mathErrors.forEach((r) => mathErrorNos.add(r.invoiceNo));
    mathErrors.forEach((r) => {
      const diff = r.amount - r.lineItemsTotal!;
      const fmt = (n: number) =>
        Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      findings.push({
        severity: 'high',
        pattern: 'Line-item math error',
        detail: `Invoice ${r.invoiceNo} from ${r.vendor}: stated total (${fmt(r.amount)}) does not match line items (${fmt(r.lineItemsTotal!)}). Difference: ${diff > 0 ? '+' : '-'}${fmt(diff)}.`,
        rows: [r.invoiceNo],
        evidence: `Line items sum to ${fmt(r.lineItemsTotal!)} but invoice total states ${fmt(r.amount)} (difference: ${diff > 0 ? '+' : '-'}${fmt(diff)})`,
      });
    });
  }

  // 5. Round-dollar suspicion — FRAUD-007: amounts that are suspiciously round with no cents.
  // Two tiers: (a) any multiple of $500 at ≥$1,000; (b) any multiple of $100 at ≥$10,000.
  // Tier (b) catches amounts like $18,900 which are round to humans but not $500 multiples.
  // Suppressed for invoices that already have a math error (more specific finding takes priority).
  const round = rows.filter(
    (r) =>
      !mathErrorNos.has(r.invoiceNo) &&
      r.amount >= 1000 &&
      (r.amount % 500 === 0 || (r.amount >= 10000 && r.amount % 100 === 0)),
  );
  if (round.length) {
    round.forEach((r) => {
      const fmtAmt = r.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
      findings.push({
        severity: 'medium',
        pattern: 'Round-dollar amount (ROUND_DOLLAR_AMOUNT)',
        detail: `ROUND_DOLLAR_AMOUNT — Invoice total ${fmtAmt} is a suspiciously round number with no cents. Verify against approved PO or prior invoices.`,
        rows: [r.invoiceNo],
        evidence: `Invoice ${r.invoiceNo} amount ${fmtAmt} is a round number (no cents) — statistically unusual for genuine vendor billing`,
      });
    });
  }

  // H-2: PO register checks — overage and unknown PO references
  if (poRegister.length > 0) {
    const poMap = new Map<string, PORegisterEntry>();
    for (const entry of poRegister) {
      poMap.set(entry.poNumber.toLowerCase().trim(), entry);
    }

    for (const r of rows) {
      if (!r.po) continue; // already caught by missing PO check above
      const poKey = r.po.toLowerCase().trim();
      const poEntry = poMap.get(poKey);

      if (!poEntry) {
        // Invoice references a PO that doesn't exist in the register
        findings.push({
          severity: 'high',
          pattern: 'Unknown PO reference',
          detail: `Invoice ${r.invoiceNo} from ${r.vendor} references PO ${r.po} but this PO is not in the register.`,
          rows: [r.invoiceNo],
          evidence: `PO ${r.po} not found in register (invoice ${r.invoiceNo}, amount ${r.rawAmount})`,
        });
      } else {
        // PO exists — check if invoice amount exceeds authorized amount
        if (r.amount > poEntry.authorizedAmount) {
          const fmtBilled = r.amount.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
          });
          const fmtAuth = poEntry.authorizedAmount.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
          });
          findings.push({
            severity: 'high',
            pattern: 'PO amount exceeded',
            detail: `PO quantity/amount exceeded — Invoice ${r.invoiceNo} bills ${fmtBilled} but PO ${r.po} authorizes ${fmtAuth}.`,
            rows: [r.invoiceNo],
            evidence: `Invoice ${r.invoiceNo} amount ${fmtBilled} exceeds PO ${r.po} authorized amount ${fmtAuth} (overage: ${(r.amount - poEntry.authorizedAmount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })})`,
          });
        }
      }
    }
  }

  // H-3 / L-1 / FRAUD-004: Vendor master checks — address mismatch, email domain mismatch,
  // and BEC bank-account-change detection.
  if (vendorMaster.length > 0) {
    // Build a normalized lookup: lowercase vendor name → master entry.
    // FRAUD-008: Accept multiple field name conventions from CSV imports so the parser
    // doesn't silently drop entries when column headers differ from the canonical names.
    const masterMap = new Map<string, VendorMasterEntry>();
    for (const rawEntry of vendorMaster) {
      // Defensive cast — entries may arrive as plain objects with varied field names.
      const e = rawEntry as Record<string, unknown>;

      // Resolve vendor name — try multiple field names
      const resolvedName =
        (e['vendorName'] as string | undefined) ??
        (e['vendor_name'] as string | undefined) ??
        (e['VENDOR_NAME'] as string | undefined) ??
        (e['vendor'] as string | undefined) ??
        (e['name'] as string | undefined) ??
        (e['company'] as string | undefined);
      if (!resolvedName) continue; // skip malformed entries silently

      // Resolve city — try camelCase, UPPERCASE CSV, and snake_case variants
      let resolvedCity: string | undefined =
        (e['city'] as string | undefined) ??
        (e['CITY'] as string | undefined) ??
        (e['vendor_city'] as string | undefined) ??
        (e['VENDOR_CITY'] as string | undefined);
      if (!resolvedCity) {
        const cityState = e['city_state'] as string | undefined;
        if (cityState) resolvedCity = cityState.split(',')[0]?.trim();
      }

      // Resolve state — try camelCase, UPPERCASE CSV, and snake_case variants
      let resolvedState: string | undefined =
        (e['state'] as string | undefined) ??
        (e['STATE'] as string | undefined) ??
        (e['vendor_state'] as string | undefined) ??
        (e['VENDOR_STATE'] as string | undefined);
      if (!resolvedState) {
        const cityState = e['city_state'] as string | undefined;
        if (cityState) {
          const parts = cityState.split(',');
          resolvedState = parts[1]?.trim();
        }
      }

      const normalizedEntry: VendorMasterEntry = {
        vendorName: resolvedName,
        city: resolvedCity,
        state: resolvedState,
        expectedEmailDomain:
          (e['expectedEmailDomain'] as string | undefined) ??
          (e['email_domain'] as string | undefined),
        bankRoutingNumber:
          (e['bankRoutingNumber'] as string | undefined) ??
          (e['routingNumber'] as string | undefined) ??
          (e['routing_number'] as string | undefined) ??
          (e['ROUTING_NUMBER'] as string | undefined) ??
          (e['BANK_ROUTING_USED'] as string | undefined),
        bankAccountNumber:
          (e['bankAccountNumber'] as string | undefined) ??
          (e['accountNumber'] as string | undefined) ??
          (e['account_number'] as string | undefined),
        bankAccountLast4:
          (e['bankAccountLast4'] as string | undefined) ??
          (e['account_last4'] as string | undefined) ??
          (e['ACCOUNT_LAST4'] as string | undefined) ??
          (e['BANK_ACCT_LAST4_USED'] as string | undefined),
      };

      masterMap.set(resolvedName.toLowerCase().trim(), normalizedEntry);
    }

    for (const r of rows) {
      const masterEntry = masterMap.get(r.vendor.toLowerCase().trim());
      if (!masterEntry) continue;

      // City/state mismatch — prefer explicit vendorCity/vendorState fields from structured input.
      // Fall back to comma-parsing the vendor name for legacy CSV text mode.
      const vendorParts = r.vendor.split(',').map((p) => p.trim());
      const invoiceCity = r.vendorCity?.trim() ?? vendorParts[1] ?? '';
      const invoiceState = r.vendorState?.trim() ?? vendorParts[2] ?? '';

      const masterCity = masterEntry.city?.trim() ?? '';
      const masterState = masterEntry.state?.trim() ?? '';

      const cityMismatch =
        masterCity && invoiceCity && invoiceCity.toLowerCase() !== masterCity.toLowerCase();
      const stateMismatch =
        masterState && invoiceState && invoiceState.toLowerCase() !== masterState.toLowerCase();

      if (cityMismatch || stateMismatch) {
        findings.push({
          severity: 'high',
          pattern: 'vendor_address_mismatch',
          detail: `Vendor address mismatch for ${r.vendor}: invoice shows ${[invoiceCity, invoiceState].filter(Boolean).join(', ')} but vendor master expects ${[masterCity, masterState].filter(Boolean).join(', ')}.`,
          rows: [r.invoiceNo],
          evidence: `Invoice ${r.invoiceNo} vendor address "${[invoiceCity, invoiceState].filter(Boolean).join(', ')}" differs from master record "${[masterCity, masterState].filter(Boolean).join(', ')}"`,
        });
      }

      // Email domain mismatch — check if bank/email field contains an @domain
      // The Row type doesn't have a dedicated email field; we scan the raw vendor or bank field.
      if (masterEntry.expectedEmailDomain) {
        const emailMatch = r.vendor.match(/@([\w.-]+)/);
        const bankEmailMatch = r.bank && r.bank.includes('@') ? r.bank.match(/@([\w.-]+)/) : null;
        const foundDomain = emailMatch?.[1] ?? bankEmailMatch?.[1];

        if (foundDomain) {
          const expectedDomain = masterEntry.expectedEmailDomain.replace(/^@/, '').toLowerCase();
          if (foundDomain.toLowerCase() !== expectedDomain) {
            findings.push({
              severity: 'high',
              pattern: 'vendor_address_mismatch',
              detail: `Email domain mismatch for ${masterEntry.vendorName}: invoice uses @${foundDomain} but vendor master expects @${expectedDomain}.`,
              rows: [r.invoiceNo],
              evidence: `Invoice ${r.invoiceNo} sender domain @${foundDomain} does not match expected corporate domain @${expectedDomain}`,
            });
          }
        }
      }

      // FRAUD-004: BEC bank-account-change detection.
      // Bug 2 fix: ONLY compare r.bank (column 5 of the CSV, digits stripped).
      // Do NOT extract 4-digit sequences from invoice numbers, amounts, PO numbers,
      // or any other field. If r.bank is empty, skip the check entirely.
      if ((masterEntry.bankRoutingNumber || masterEntry.bankAccountLast4) && r.bank) {
        const bankField = r.bank;

        // Routing number candidate: exactly 9 leading digits in the bank field.
        const routingCandidate = bankField.match(/^(\d{9})/)?.[1];

        const masterRouting = (masterEntry.bankRoutingNumber ?? '').replace(/\D/g, '');
        const masterLast4 = (masterEntry.bankAccountLast4 ?? '').replace(/\D/g, '');

        // If both sides have a routing number and they differ → BEC flag
        if (routingCandidate && masterRouting && routingCandidate !== masterRouting) {
          findings.push({
            severity: 'critical',
            pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
            detail: `BANK_ACCOUNT_CHANGE — Invoice from ${r.vendor} shows routing ${routingCandidate} but vendor master has ${masterRouting}. This is a Business Email Compromise (BEC) red flag — do not pay.`,
            rows: [r.invoiceNo],
            evidence: `Invoice ${r.invoiceNo} routing ${routingCandidate} differs from vendor master routing ${masterRouting}`,
          });
        } else if (!routingCandidate && masterLast4 && bankField.length > 4) {
          // Fallback: check last-4 of account number only when NO routing number candidate
          // was present in the invoice bank field. If routing was found and matched above,
          // do NOT fall through here — the last-4 of a routing number is not an account number.
          const invoiceLast4 = bankField.slice(-4);
          if (invoiceLast4 !== masterLast4) {
            findings.push({
              severity: 'critical',
              pattern: 'Bank account change (BANK_ACCOUNT_CHANGE)',
              detail: `BANK_ACCOUNT_CHANGE — Invoice from ${r.vendor} shows account ending ${invoiceLast4} but vendor master has account ending ${masterLast4}. This is a Business Email Compromise (BEC) red flag — do not pay.`,
              rows: [r.invoiceNo],
              evidence: `Invoice ${r.invoiceNo} account last-4 ${invoiceLast4} differs from vendor master account last-4 ${masterLast4}`,
            });
          }
        }
      }
    }
  }

  const severityRank = { critical: 0, high: 1, medium: 2 } as const;
  return findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

/** Result of the coverage-aware scan: legacy findings + full control accounting. */
export type ScanWithCoverageResult = {
  findings: Finding[];
  controlResults: ControlResult[];
  coverage: CoverageSummary;
  normalizationWarnings: string[];
  unknownFields: string[];
};

export type ScanCoverageOpts = {
  /** Pre-normalized invoices. When omitted, rows are re-normalized from Row[]. */
  normalized?: NormalizedInvoice[];
  approvalMatrix?: ApprovalMatrixEntry[];
  /** Vendor master with extended fields (remitAddress, status) for new controls. */
  vendorMasterExtended?: Array<{
    vendorName: string;
    city?: string;
    state?: string;
    expectedEmailDomain?: string;
    bankRoutingNumber?: string;
    bankAccountNumber?: string;
    bankAccountLast4?: string;
    remitAddress?: string;
    status?: string;
  }>;
};

/**
 * Coverage-aware scan. Runs the existing Finding logic (backward-compatible
 * `findings`) AND the 15-control readiness engine. The control engine is the
 * authoritative coverage accounting: it reports which controls passed, failed, or
 * could not run because evidence was absent — so an empty `findings` array can no
 * longer be misread as "clean".
 *
 * Findings and controls overlap by design; coverage counts come from runControls,
 * not from findings, to avoid double-counting.
 */
export function scanInvoicesWithCoverage(
  rows: Row[],
  history: HistoryRecord[] = [],
  poRegister: PORegisterEntry[] = [],
  vendorMaster: VendorMasterEntry[] = [],
  seedContext: HistoryRecord[] = [],
  now: Date = new Date(),
  opts: ScanCoverageOpts = {},
): ScanWithCoverageResult {
  const findings = scanInvoices(rows, history, poRegister, vendorMaster, seedContext, now);

  // Reconstruct NormalizedInvoices for the control engine. Callers that already
  // normalized (the route) pass them in via opts to preserve FieldValue fidelity.
  const normalized: NormalizedInvoice[] =
    opts.normalized ??
    rows.map((r) =>
      normalizeInvoice({
        vendor: r.vendor,
        invoiceNo: r.invoiceNo,
        amount: r.rawAmount || String(r.amount),
        po: r.po,
        ...(r.bank ? { bankRouting: r.bank } : {}),
        ...(r.lineItemsTotal !== undefined ? { lineItemsTotal: r.lineItemsTotal } : {}),
        ...(r.vendorCity ? { vendorCity: r.vendorCity } : {}),
        ...(r.vendorState ? { vendorState: r.vendorState } : {}),
      }),
    );

  const controlResults = runControls({
    invoices: normalized,
    vendorMaster:
      opts.vendorMasterExtended ??
      (vendorMaster.length > 0 ? vendorMaster.map((v) => ({ ...v })) : undefined),
    poRegister: poRegister.length > 0 ? poRegister : undefined,
    approvalMatrix: opts.approvalMatrix,
    history: history.length > 0 ? history : undefined,
    seedContext: seedContext.length > 0 ? seedContext : undefined,
    now,
  });

  const coverage = buildCoverageSummary(controlResults);

  const normalizationWarnings = Array.from(
    new Set(normalized.flatMap((n) => n.normalizationWarnings)),
  );
  const unknownFields = Array.from(
    new Set(normalized.flatMap((n) => Object.keys(n.unknownFields))),
  );

  return { findings, controlResults, coverage, normalizationWarnings, unknownFields };
}
