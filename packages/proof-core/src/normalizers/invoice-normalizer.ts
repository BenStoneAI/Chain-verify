// Invoice evidence normalizer.
//
// Converts messy customer input (CSV, TSV, JSON array/object, labeled prose) into
// header-keyed records, then maps those records onto canonical FieldValues. The key
// guarantee: when a value cannot be confidently interpreted (e.g. an amount that
// will not parse to a number), we emit a FieldValue with source 'unknown' and a
// normalization warning — we never silently coerce to 0 / '' / null.

import { absent, present, unknownField, type FieldValue } from '../field-value.js';
import { resolveCanonicalField, type CanonicalField } from '../field-aliases.js';

export type NormalizedInvoice = {
  invoiceNo: FieldValue<string>;
  vendor: FieldValue<string>;
  amount: FieldValue<number>;
  rawAmount?: string;
  po: FieldValue<string>;
  bankRouting?: FieldValue<string>;
  bankAccount?: FieldValue<string>;
  lineItemsTotal?: FieldValue<number>;
  vendorCity?: FieldValue<string>;
  vendorState?: FieldValue<string>;
  invoiceDate?: FieldValue<string>;
  dueDate?: FieldValue<string>;
  emailDomain?: FieldValue<string>;
  remitAddress?: FieldValue<string>;
  vendorStatus?: FieldValue<string>;
  authorizedQty?: FieldValue<number>;
  billedQty?: FieldValue<number>;
  authorizedAmount?: FieldValue<number>;
  approvalAmount?: FieldValue<number>;
  approverRole?: FieldValue<string>;
  tax?: FieldValue<number>;
  unknownFields: Record<string, unknown>;
  normalizationWarnings: string[];
};

// ---------------------------------------------------------------------------
// Tabular parsing (CSV / TSV)
// ---------------------------------------------------------------------------

/** Detect comma vs tab delimiter from the header line. */
function detectDelimiter(headerLine: string): ',' | '\t' {
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

/** RFC4180-aware single-line splitter honoring double-quoted fields. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++; // escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** True if at least one header cell resolves to a known canonical field. */
function looksLikeHeader(cells: string[]): boolean {
  return cells.some((c) => resolveCanonicalField(c) !== null);
}

/**
 * Parse tabular text into header-keyed rows. Handles CSV/TSV, BOM, quoted
 * values, mixed casing, reordered columns, and unknown extra columns. If the
 * first line is not a recognizable header, falls back to positional parsing using
 * the legacy canonical order and records a warning on each row.
 */
export function parseTabular(text: string): {
  headers: string[];
  rows: Record<string, unknown>[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return { headers: [], rows: [], warnings };

  const delimiter = detectDelimiter(lines[0]);
  const firstCells = splitDelimited(lines[0], delimiter);
  const hasHeader = looksLikeHeader(firstCells);

  if (!hasHeader) {
    // Legacy positional fallback: vendor, invoiceNo, amount, po, bank, lineItems.
    warnings.push(
      'No recognizable header row detected — falling back to positional column order (vendor, invoiceNo, amount, po, bank, lineItemsTotal). Provide a header row for reliable parsing.',
    );
    const positional: CanonicalField[] = [
      'vendor',
      'invoiceNo',
      'amount',
      'po',
      'bankRouting',
      'lineItemsTotal',
    ];
    const rows: Record<string, unknown>[] = [];
    for (const line of lines) {
      const cells = splitDelimited(line, delimiter);
      if (cells.length < 3) continue;
      const row: Record<string, unknown> = {};
      positional.forEach((field, i) => {
        if (cells[i] !== undefined && cells[i] !== '') row[field] = cells[i];
      });
      rows.push(row);
    }
    return { headers: positional, rows, warnings };
  }

  const headers = firstCells;
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitDelimited(lines[i], delimiter);
    if (cells.every((c) => c === '')) continue;
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (cells[idx] !== undefined && cells[idx] !== '') row[h] = cells[idx];
    });
    rows.push(row);
  }
  return { headers, rows, warnings };
}

// ---------------------------------------------------------------------------
// Prose parsing
// ---------------------------------------------------------------------------

/**
 * Parse a labeled prose block such as:
 *   Invoice Number: INV-001
 *   Vendor: Acme
 *   Amount: $1,200
 * into one record. Blank lines separate multiple invoices.
 */
export function parseProse(text: string): Record<string, unknown>[] {
  const clean = text.replace(/^\uFEFF/, '');
  const blocks = clean
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const records: Record<string, unknown>[] = [];
  for (const block of blocks) {
    const record: Record<string, unknown> = {};
    const lines = block.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([^:]+?)\s*:\s*(.+?)\s*$/);
      if (m) record[m[1].trim()] = m[2].trim();
    }
    if (Object.keys(record).length > 0) records.push(record);
  }
  return records;
}

function parseFreeformInvoice(text: string): Record<string, unknown>[] {
  const clean = text
    .replace(/^\uFEFF/, '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];

  const invoiceMatch =
    clean.match(/\binvoice\s+(?!no\b|number\b)([a-z0-9][a-z0-9._-]*)\b/i) ??
    clean.match(/\binv[.:#\s-]+([a-z0-9][a-z0-9._-]*)\b/i);
  const amountMatch =
    clean.match(/\b(?:pay this am[o0]unt|amount due|balance due|grand total|total|pay)\s*:?\s*\$?\s*([0-9][0-9,]*\.[0-9]{2})\b/i) ??
    clean.match(/\$\s*([0-9][0-9,]*\.[0-9]{2})\b/);
  const vendorMatch =
    clean.match(/\binvoice\s+[a-z0-9][a-z0-9._-]*\s+from\s+(.+?)(?:\.|,|\s+for\s+|\s+please\s+pay\s+|\s+pay\s+)/i) ??
    clean.match(/\bvendor\s*(?:[:.]|\.\.)+\s*(.+?)(?:\.|,|\s+invoice\s+|\s+amount\s+|\s+inv\s*:|\s+pay\s+)/i);

  if (!invoiceMatch || !amountMatch) return [];

  const record: Record<string, unknown> = {
    invoiceNo: invoiceMatch[1],
    amount: amountMatch[1],
  };
  if (vendorMatch) {
    record.vendor = vendorMatch[1].trim();
  }

  const poMatch = clean.match(/\bPO(?:\s+REF)?\s*:?\s*([a-z]{2,}-[a-z0-9._-]+)\b/i);
  if (poMatch && !/^is$/i.test(poMatch[1])) {
    record.po = poMatch[1];
  }
  const approverMatch = clean.match(/\b(?:approved by|approver)\s*:?\s*([A-Za-z][A-Za-z\s.-]+?)(?:\.|,|$)/i);
  if (approverMatch) {
    record.approver = approverMatch[1].trim();
  }
  const remitMatch = clean.match(/\b(?:remit|bank)\s*:?\s*([^.;]+?)(?:\.|;|$)/i);
  if (remitMatch) {
    record.bank = remitMatch[1].trim();
  }

  return [record];
}

// ---------------------------------------------------------------------------
// Input dispatch
// ---------------------------------------------------------------------------

/** True if a text block looks like labeled prose rather than a table. */
function looksLikeProse(text: string): boolean {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const firstNonEmpty = lines.find((line) => !/^#{1,6}\s+\S/.test(line));
  if (!firstNonEmpty) return false;
  const labeledLines = lines.filter((line) => /^\s*[^:,\t]+?\s*:\s*\S/.test(line)).length;
  if (labeledLines >= 2) return true;
  // Prose: "Label: value" with no delimiter table structure on the first data line.
  const hasColonLabel = /^[^:,\t]+:\s*\S/.test(firstNonEmpty);
  const hasTableDelim = /[,\t]/.test(firstNonEmpty);
  return hasColonLabel && !hasTableDelim;
}

function tryParseJsonText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function flattenRecord(value: Record<string, unknown>): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};

  const visit = (node: unknown, prefix?: string) => {
    if (node === undefined || node === null) return;
    if (Array.isArray(node)) return;
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        const nextKey = prefix ? `${prefix}_${key}` : key;
        if (child && typeof child === 'object' && !Array.isArray(child)) {
          visit(child, nextKey);
        } else if (!Array.isArray(child)) {
          flattened[nextKey] = child;
          flattened[key] ??= child;
        }
      }
      return;
    }
    if (prefix) flattened[prefix] = node;
  };

  visit(value);
  return flattened;
}

function canonicalScore(record: Record<string, unknown>): number {
  const fields = new Set<CanonicalField>();
  for (const key of Object.keys(record)) {
    const match = resolveCanonicalField(key);
    if (match) fields.add(match.canonical);
  }
  let score = 0;
  if (fields.has('invoiceNo')) score += 2;
  if (fields.has('amount')) score += 2;
  if (fields.has('vendor')) score += 1;
  if (fields.has('po')) score += 1;
  if (fields.has('bankRouting') || fields.has('bankAccount') || fields.has('remitAddress')) score += 1;
  return score;
}

function extractInvoiceRecords(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) {
    return json.flatMap((item) => extractInvoiceRecords(item));
  }
  if (!json || typeof json !== 'object') {
    return [];
  }

  const object = json as Record<string, unknown>;
  const flattened = flattenRecord(object);
  const currentScore = canonicalScore(flattened);
  const childRecords = Object.values(object).flatMap((child) => extractInvoiceRecords(child));

  if (currentScore >= 4) {
    return [flattened];
  }
  return childRecords;
}

/**
 * Dispatch any input into header-keyed records.
 *   - JSON array        → rows as-is
 *   - JSON object       → single-row array
 *   - text prose        → parseProse
 *   - text tabular      → parseTabular
 */
export function parseInput(input: { text?: string; json?: unknown }): {
  rows: Record<string, unknown>[];
  warnings: string[];
} {
  const warnings: string[] = [];

  if (input.json !== undefined && input.json !== null) {
    const extracted = extractInvoiceRecords(input.json);
    if (extracted.length > 0) return { rows: extracted, warnings };
    if (Array.isArray(input.json)) return { rows: input.json.map(asRecord), warnings };
    if (typeof input.json === 'object') return { rows: [asRecord(input.json)], warnings };
  }

  const text = input.text ?? '';
  if (text.trim().length === 0) return { rows: [], warnings };

  const parsedJson = tryParseJsonText(text);
  if (parsedJson !== null) {
    const extracted = extractInvoiceRecords(parsedJson);
    if (extracted.length > 0) return { rows: extracted, warnings };
    return parseInput({ json: parsedJson });
  }

  if (looksLikeProse(text)) {
    const prose = parseProse(text);
    const freeform = parseFreeformInvoice(text);
    if (prose.length > 0 && freeform.length > 0) {
      return { rows: [{ ...freeform[0], ...prose[0] }, ...prose.slice(1)], warnings };
    }
    return { rows: prose.length > 0 ? prose : freeform, warnings };
  }
  const freeform = parseFreeformInvoice(text);
  if (freeform.length > 0) {
    return { rows: freeform, warnings };
  }
  const tab = parseTabular(text);
  return { rows: tab.rows, warnings: tab.warnings };
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return { value: v };
}

// ---------------------------------------------------------------------------
// Value parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a currency/number string. Returns null when the value is not an
 * unambiguous number so the caller can emit an 'unknown' FieldValue + warning
 * instead of silently coercing to a wrong-but-confident number.
 *
 * Critically, this does NOT blindly strip non-numeric characters: doing so turns
 * "USD 1.2k" into 1.2 and "~$500" into 500, which are wrong-but-confident values
 * a fraud product must never produce. Only bare currency symbols and thousands
 * separators are removed; any residual letters (magnitude suffixes like "k",
 * prose like "dollars"/"USD", "approx") or approximation qualifiers ("~"), more
 * than one decimal point, or a missing digit make the value uninterpretable.
 */
function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // Remove only bare currency symbols, thousands separators, and whitespace.
  // Everything else (letters, '~', extra punctuation) is preserved so it can be
  // detected and rejected below rather than silently dropped.
  const cleaned = trimmed.replace(/[$€£¥,\s]/g, '');
  if (cleaned === '') return null;
  // Reject any uninterpretable residual: letters (magnitude/prose qualifiers),
  // approximation qualifiers, ranges/extra symbols, or more than one decimal point.
  if (/[a-z~]/i.test(cleaned)) return null;
  if ((cleaned.match(/\./g) ?? []).length > 1) return null;
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Extract a bare domain from an email or raw domain string. */
function parseEmailDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const at = raw.match(/@([\w.-]+)/);
  if (at) return at[1].toLowerCase();
  const trimmed = raw.trim().toLowerCase();
  if (/^[\w.-]+\.[a-z]{2,}$/.test(trimmed)) return trimmed;
  return null;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

type ResolvedCandidate = {
  rawKey: string;
  rawValue: unknown;
  source: 'exact' | 'alias' | 'fuzzy' | 'derived';
  confidence: number;
};

const AMOUNT_ALIAS_PRECEDENCE: string[][] = [
  ['amount_due', 'amount due'],
  ['grand_total', 'grand total', 'total', 'payment_total', 'payment total', 'gross_amount', 'gross amount'],
  ['invoice_total', 'invoice total'],
  ['amount'],
  ['net_amount', 'net amount'],
  ['subtotal', 'sub_total', 'sub total', 'line_items_total', 'line items total', 'items_total'],
];

function normalizeAliasKey(rawKey: string): string {
  return rawKey.toLowerCase().replace(/[-\s]+/g, '_').trim();
}

function amountAliasRank(rawKey: string): number {
  const normalized = normalizeAliasKey(rawKey);
  const spaced = normalized.replace(/_/g, ' ');
  const rank = AMOUNT_ALIAS_PRECEDENCE.findIndex((aliases) =>
    aliases.some((alias) => alias === normalized || alias === spaced),
  );
  return rank === -1 ? AMOUNT_ALIAS_PRECEDENCE.length : rank;
}

function canDeriveLineItemsTotal(rawKey: string): boolean {
  const normalized = normalizeAliasKey(rawKey);
  const spaced = normalized.replace(/_/g, ' ');
  return [
    'amount',
    'subtotal',
    'sub total',
    'line items total',
    'line item total',
    'items total',
    'lineitemstotal',
  ].includes(normalized) || [
    'amount',
    'subtotal',
    'sub total',
    'line items total',
    'line item total',
    'items total',
    'lineitemstotal',
  ].includes(spaced);
}

function chooseAmountCandidate(candidates: ResolvedCandidate[]): {
  chosen: ResolvedCandidate;
  losers: ResolvedCandidate[];
} {
  const sorted = [...candidates].sort((a, b) => {
    const rankDiff = amountAliasRank(a.rawKey) - amountAliasRank(b.rawKey);
    if (rankDiff !== 0) return rankDiff;
    return b.confidence - a.confidence;
  });
  const [chosen, ...losers] = sorted;
  return { chosen, losers };
}

/**
 * Map a raw header-keyed record onto a NormalizedInvoice. Resolves each key via
 * the alias registry; unmatched keys land in unknownFields. Number fields that
 * fail to parse become 'unknown' FieldValues with a warning.
 */
export function normalizeInvoice(raw: Record<string, unknown>): NormalizedInvoice {
  const warnings: string[] = [];
  const unknownFields: Record<string, unknown> = {};

  // Bucket each raw key under its canonical field (first non-empty wins).
  const resolved: Partial<
    Record<CanonicalField, ResolvedCandidate>
  > = {};
  const amountCandidates: ResolvedCandidate[] = [];

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const match = resolveCanonicalField(rawKey);
    if (!match) {
      unknownFields[rawKey] = rawValue;
      continue;
    }
    if (match.canonical === 'amount') {
      amountCandidates.push({
        rawKey,
        rawValue,
        source: match.source,
        confidence: match.confidence,
      });
      continue;
    }
    const existing = resolved[match.canonical];
    // Prefer the higher-confidence source if two raw keys map to the same field.
    if (!existing || match.confidence > existing.confidence) {
      resolved[match.canonical] = {
        rawKey,
        rawValue,
        source: match.source,
        confidence: match.confidence,
      };
      if (existing) {
        warnings.push(
          `Multiple columns mapped to "${match.canonical}" ("${existing.rawKey}", "${rawKey}") — kept the higher-confidence match.`,
        );
      }
    }
  }

  if (amountCandidates.length > 0) {
    const { chosen, losers } = chooseAmountCandidate(amountCandidates);
    resolved['amount'] = chosen;
    if (losers.length > 0) {
      warnings.push(
        `Multiple amount columns present (${[chosen, ...losers].map((c) => `"${c.rawKey}"`).join(', ')}) — used "${chosen.rawKey}" as the payable amount.`,
      );
      const lineItemCandidate = losers.find(
        (candidate) =>
          canDeriveLineItemsTotal(candidate.rawKey) && parseAmount(candidate.rawValue) !== null,
      );
      if (lineItemCandidate && !resolved['lineItemsTotal']) {
        resolved['lineItemsTotal'] = {
          ...lineItemCandidate,
          source: 'derived',
        };
      }
    }
  }

  const strFV = (field: CanonicalField): FieldValue<string> => {
    const r = resolved[field];
    if (!r) return absent<string>(`No column mapped to ${field}`);
    return present(String(r.rawValue).trim(), r.source, {
      rawValue: r.rawValue,
      confidence: r.confidence,
      normalizedFrom: r.rawKey,
    });
  };

  const numFV = (field: CanonicalField): FieldValue<number> => {
    const r = resolved[field];
    if (!r) return absent<number>(`No column mapped to ${field}`);
    const parsed = parseAmount(r.rawValue);
    if (parsed === null) {
      const reason = `Column "${r.rawKey}" mapped to ${field} but value "${String(
        r.rawValue,
      )}" could not be parsed as a number`;
      warnings.push(reason);
      return unknownField<number>(r.rawValue, reason);
    }
    return present(parsed, r.source, {
      rawValue: r.rawValue,
      confidence: r.confidence,
      normalizedFrom: r.rawKey,
    });
  };

  // Email domain is derived from the raw email column.
  const emailFV = (): FieldValue<string> | undefined => {
    const r = resolved['emailDomain'];
    if (!r) return undefined;
    const domain = parseEmailDomain(r.rawValue);
    if (domain === null) {
      const reason = `Column "${r.rawKey}" mapped to emailDomain but "${String(
        r.rawValue,
      )}" had no extractable domain`;
      warnings.push(reason);
      return unknownField<string>(r.rawValue, reason);
    }
    return present(domain, 'derived', { rawValue: r.rawValue, normalizedFrom: r.rawKey });
  };

  const normalized: NormalizedInvoice = {
    invoiceNo: strFV('invoiceNo'),
    vendor: strFV('vendor'),
    amount: numFV('amount'),
    po: strFV('po'),
    unknownFields,
    normalizationWarnings: warnings,
  };

  // rawAmount preserves the original text for reporting.
  const amtRaw = resolved['amount'];
  if (amtRaw) normalized.rawAmount = String(amtRaw.rawValue);

  // Optional fields — only attach when the source key was present.
  const attachStr = (field: Exclude<CanonicalField, 'invoiceNo' | 'vendor' | 'po' | 'amount'>) => {
    if (resolved[field]) (normalized as Record<string, unknown>)[field] = strFV(field);
  };
  const attachNum = (field: Exclude<CanonicalField, 'amount'>) => {
    if (resolved[field]) (normalized as Record<string, unknown>)[field] = numFV(field);
  };

  attachStr('bankRouting');
  attachStr('bankAccount');
  attachStr('vendorCity');
  attachStr('vendorState');
  attachStr('invoiceDate');
  attachStr('dueDate');
  attachStr('remitAddress');
  attachStr('vendorStatus');
  attachStr('approverRole');

  attachNum('lineItemsTotal');
  attachNum('tax');
  attachNum('authorizedQty');
  attachNum('billedQty');
  attachNum('authorizedAmount');
  attachNum('approvalAmount');

  const email = emailFV();
  if (email) normalized.emailDomain = email;

  return normalized;
}

/** Normalize an array of raw rows. */
export function normalizeMany(rows: Record<string, unknown>[]): NormalizedInvoice[] {
  return rows.map(normalizeInvoice);
}
