// Deterministic invoice-field extraction from already-extracted PDF text.
//
// PURE + side-effect-free: no PDF decoding, no I/O, no Date/random/network. The
// binary→text step (unpdf) lives in the API runtime; this module only turns the
// resulting plain text into structured invoice fields so it is fully unit-testable
// without binary fixtures.
//
// Honesty contract: when the text is empty (scanned/image-only PDF) or the core
// fields cannot be found, we return a NEEDS_REVIEW / TEXT_EXTRACTION_FAILED status
// and a low confidence rather than fabricating fields.
//
// OCR (scanned/image-only PDFs): rasterization + the Tesseract OCR engine live in
// the API runtime (apps/api/src/modules/invoice-proof/invoice-pdf-ocr.ts) — this
// module never does image decoding or OCR itself, staying pure. OCR-sourced text
// is fed through the exact same `extractInvoiceFieldsFromText` below (no forked
// parser), then `applyOcrExtraction` (also pure, see bottom of this file) combines
// the OCR engine's own confidence with the parse confidence and applies a
// stricter, non-negotiable review gate for fraud-critical fields — never
// silently promoting an OCR-derived guess to OK.

export type PdfExtractStatus = 'OK' | 'NEEDS_REVIEW' | 'TEXT_EXTRACTION_FAILED';

/**
 * Where the text fed into `extractInvoiceFieldsFromText` actually came from.
 * Mandatory on every `PdfExtractionResult` a caller returns downstream (API
 * responses, ProofRecord evidence) so a customer, an auditor, or the fraud-scan
 * rules themselves can always tell OCR-derived data from digital-text data — an
 * OCR misread digit changing a bank account number or a dollar amount is a real
 * false-positive/false-negative risk this repo has been burned by before.
 */
export type ExtractionMethod = 'digital_text' | 'ocr' | 'url_html' | 'url_pdf';

export type ExtractedInvoiceFields = {
  vendor?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  amount?: number;
  paymentTerms?: string;
  po?: string;
  bankRouting?: string;
  bankAccountLast4?: string;
  lineItemsTotal?: number;
};

export type PdfExtractionResult = {
  status: PdfExtractStatus;
  /** Confidence the parse is usable for an automated scan (0–1). */
  confidence: number;
  fields: ExtractedInvoiceFields;
  /** Non-fatal notes (e.g. "vendor inferred from first line"). Never contains raw amounts/account numbers. */
  warnings: string[];
  pageCount: number;
  charCount: number;
  /**
   * Optional so existing callers/fixtures that predate OCR support (and every
   * digital-text call this module has always made) remain valid without
   * change. Callers that produce a result for return to the API/customer
   * SHOULD set this explicitly — see invoice-pdf.service.ts.
   */
  extraction_method?: ExtractionMethod;
};

// A page with almost no extractable text is almost certainly a scanned/image-only
// document. Below this many characters per page we decline rather than guess.
// Exported so the API-layer OCR orchestration (invoice-pdf.service.ts) can use
// the exact same "is this page's digital text usable" threshold to decide,
// per page, whether that page needs OCR — one definition, not two.
export const MIN_CHARS_PER_PAGE = 10;
const MIN_TOTAL_CHARS = 20;

function cleanToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().replace(/[.,;:]+$/, '');
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseAmount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function matchFirst(text: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m[1]) {
      const cleaned = cleanToken(m[1]);
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

// --- Header-row-then-values handling ------------------------------------------------
//
// unpdf/pdf.js frequently flattens a multi-column table into a single run of text: the
// header row is emitted first, then the values row, e.g.
//   "Invoice No. Balance Due 06/04/2026 154249 $3,500.00 Due Date: 07/04/2026"
// A naive "grab the next word after the label" regex grabs "Balance" (the NEXT HEADER
// WORD), not "154249" (the actual value two columns over). The helpers below walk the
// tokens following a matched label, skip over other column-header words/placeholder
// values, and stop at the first token that actually looks like the field being sought.

// Deliberately NOT included: "inv"/"invoice"/"po"/"num"/"number"/"id" — those are
// common PREFIXES of real invoice/PO numbers ("INV-4471", "PO-9920", "ID-118"), so
// treating them as noise would eat the very value we're trying to extract (proven by
// a regression caught while hand-verifying this file: "INV-4471" collapsed to "4471"
// until "inv" was removed from this set).
const ID_HEADER_NOISE_WORDS = new Set([
  'balance', 'due', 'date', 'total', 'terms', 'enclosed', 'amount', 'no', 'bill',
  'activity', 'description', 'qty', 'rate', 'subtotal', 'tax', 'ways', 'pay',
  'gross', 'grand', 'payable',
]);

function looksLikeDateToken(tok: string): boolean {
  return /^[0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}$/.test(tok);
}

function looksLikeCurrencyToken(tok: string): boolean {
  return /^\$?[0-9][0-9,]*\.[0-9]{2}$/.test(tok);
}

function looksLikeBareInteger(tok: string): boolean {
  return /^[0-9]+$/.test(tok);
}

function isHeaderNoiseWord(tok: string): boolean {
  const lower = tok.toLowerCase().replace(/[^a-z]/g, '');
  return lower.length > 0 && ID_HEADER_NOISE_WORDS.has(lower);
}

// Walk the tokens immediately after every match of `labelRe`, skipping tokens the
// caller says are non-values (other headers, dates, etc.), and return the first token
// that looks like a real value per the caller's `isCandidate` test. If a token is hit
// that is neither skippable nor a candidate (e.g. a person's name in a Bill To block),
// this occurrence is abandoned and the next match of `labelRe` (if any) is tried.
function findValueAfterLabel(
  text: string,
  labelRe: RegExp,
  isCandidate: (tok: string) => boolean,
  shouldSkip: (tok: string) => boolean,
  maxTokens = 14,
): string | undefined {
  const re = new RegExp(labelRe.source, labelRe.flags.includes('g') ? labelRe.flags : `${labelRe.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tail = text.slice(m.index + m[0].length);
    const tokens = tail.trim().split(/\s+/).slice(0, maxTokens);
    for (const raw of tokens) {
      const tok = raw.replace(/[.,;:]+$/, '');
      if (tok.length === 0) continue;
      if (shouldSkip(tok)) continue;
      if (isCandidate(tok)) return tok;
      break; // hit unrelated content (e.g. a name) — no value in this occurrence
    }
    if (m.index === re.lastIndex) re.lastIndex += 1; // guard against zero-width matches
  }
  return undefined;
}

function extractInvoiceNo(text: string): string | undefined {
  const labels = [
    /invoice\s*(?:#|no\.?|num(?:ber)?\.?|id)\s*[:#-]?\s*/i,
    /\binv\s*[:#-]?\s*/i,
  ];
  const isCandidate = (tok: string) =>
    /\d/.test(tok) &&
    !looksLikeDateToken(tok) &&
    !looksLikeCurrencyToken(tok) &&
    /^[A-Za-z0-9][A-Za-z0-9/_-]{0,30}$/.test(tok);
  const shouldSkip = (tok: string) =>
    isHeaderNoiseWord(tok) || looksLikeDateToken(tok) || looksLikeCurrencyToken(tok);

  for (const labelRe of labels) {
    const value = findValueAfterLabel(text, labelRe, isCandidate, shouldSkip);
    const cleaned = cleanToken(value);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function extractPo(text: string): string | undefined {
  return matchFirst(text, [
    /\b(?:p\.?\s*o\.?|purchase\s*order)\s*(?:#|no\.?|num(?:ber)?\.?)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9_/-]{1,30})/i,
  ]);
}

function extractDate(text: string): string | undefined {
  return matchFirst(text, [
    /invoice\s*date\s*[:-]?\s*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4})/i,
    /invoice\s*date\s*[:-]?\s*([A-Za-z]{3,9}\.?\s+[0-9]{1,2},?\s+[0-9]{4})/i,
    /\bdate\s*[:-]?\s*([0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4})/i,
    /\bdate\s*[:-]?\s*([A-Za-z]{3,9}\.?\s+[0-9]{1,2},?\s+[0-9]{4})/i,
  ]);
}

function extractTerms(text: string): string | undefined {
  return matchFirst(text, [
    /(?:payment\s*)?terms\s*[:-]?\s*(net\s*[0-9]{1,3})/i,
    /(?:payment\s*)?terms\s*[:-]?\s*(due\s*on\s*receipt)/i,
  ]);
}

// The grand total: prefer the most specific label, then fall back to the largest
// labelled currency amount so we don't accidentally pick a line-item or subtotal.
//
// Same header-row-then-values problem as the invoice number: a column layout like
// "Invoice No. Balance Due 06/04/2026 154249 $3,500.00" puts unrelated header words
// and even a *different* column's value (the date, the invoice number itself) between
// the "Balance Due" label and its actual amount. We skip header-noise words and dates,
// also skip bare integers (an invoice/account number, not a dollar amount), and stop at
// the first token that is actually currency-shaped.
function extractAmount(text: string): number | undefined {
  const labels = [
    /(?:grand\s*total|amount\s*due|balance\s*due|total\s*due|amount\s*payable|invoice\s*total|total\s*amount\s*due)\s*[:#-]?\s*/i,
    /\btotal\b\s*[:#-]?\s*/i,
    /\bamount\s*[:#-]?\s*/i,
  ];
  const isCandidate = (tok: string) => looksLikeCurrencyToken(tok);
  const shouldSkip = (tok: string) =>
    isHeaderNoiseWord(tok) ||
    looksLikeDateToken(tok) ||
    (looksLikeBareInteger(tok) && !looksLikeCurrencyToken(tok));

  for (const labelRe of labels) {
    const re = new RegExp(labelRe.source, 'gi');
    let best: number | undefined;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const tail = text.slice(m.index + m[0].length);
      const tokens = tail.trim().split(/\s+/).slice(0, 14);
      for (const raw of tokens) {
        const tok = raw.replace(/[.,;:]+$/, '');
        if (tok.length === 0) continue;
        if (shouldSkip(tok)) continue;
        if (isCandidate(tok)) {
          const v = parseAmount(tok);
          if (v !== undefined && (best === undefined || v > best)) best = v;
        }
        break; // either consumed the value or hit unrelated content — done with this occurrence
      }
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
    if (best !== undefined) return best;
  }
  return undefined;
}

function extractBankRouting(text: string): string | undefined {
  const m =
    /(?:routing|aba|rtn)\s*(?:#|no\.?|number)?\s*[:-]?\s*([0-9]{9})\b/i.exec(text);
  return m ? m[1] : undefined;
}

function extractAccountLast4(text: string): string | undefined {
  const m =
    /(?:account|acct|a\/c)\s*(?:#|no\.?|number)?\s*[:-]?\s*[xX*•.\s-]*([0-9]{4})\b/i.exec(
      text,
    );
  return m ? m[1] : undefined;
}

// Boundary that marks the end of letterhead / start of invoice fields. Used both to
// terminate a labelled vendor capture and to slice the leading company name. "remit
// to"/"from" are intentionally NOT vendor labels — they head the payee/bank section,
// which is often a different entity than the billing vendor.
const FIELD_BOUNDARY =
  /\s(?:invoice|inv|po|p\.?\s*o|purchase\s*order|date|total|amount|terms|tax|bill|ship|remit|account|routing|due|balance|subtotal|qty|description)\b/i;

// Drop an address-ish tail so "Acme Corp 123 Market St" → "Acme Corp".
function tidyVendorName(raw: string): string | undefined {
  let name = raw.trim().replace(/[.,;:]+$/, '');
  const addr = /\s\d{1,6}\s+\S/.exec(name); // first " <number> <word>" = street number
  if (addr && addr.index >= 2) name = name.slice(0, addr.index).trim();
  if (name.length < 2 || name.length > 60) return undefined;
  if (/^[0-9$.,\s-]+$/.test(name)) return undefined;
  return name;
}

// Letterheads often lead with "Phone: 435-259-5123 Fax: 435-259-4135 CITY OF MOAB ..."
// — strip that contact-info noise so it doesn't get captured (or confuse the
// street-address trimmer in tidyVendorName, since a phone number itself looks
// address-ish) before we take the company name.
function stripLeadingContactNoise(raw: string): string {
  return raw
    .replace(/^(\s*(?:phone|fax|tel\.?|ph\.?)\s*:?\s*[0-9()+.\-\s]{6,20}(?=\s|$))+/i, '')
    .trim();
}

// Recipient sections ("Bill To" / "Ship To" / "Sold To") name the customer, never the
// vendor — even if a candidate string happens to start with one of these markers.
function isRecipientMarked(raw: string): boolean {
  return /^\s*(?:bill\s*to|ship\s*to|sold\s*to)\b/i.test(raw);
}

function extractVendor(text: string): { vendor?: string; inferred: boolean } {
  // 1) Explicit, high-confidence label. "vendor"/"supplier"/"bill from" only —
  //    intentionally excludes "bill to"/"ship to"/"sold to", which name the customer.
  const labelled = matchFirst(text, [
    /(?:vendor|supplier|bill\s*from)[^\S\n]*[:-][^\S\n]*([A-Za-z0-9][^\n]{1,58}?)(?=\s{2,}|\s(?:invoice|inv|po|p\.?\s*o|purchase|date|total|amount|terms|tax|account|routing|due|balance|subtotal)\b|\n|$)/i,
  ]);
  if (labelled && !isRecipientMarked(labelled)) {
    const tidy = tidyVendorName(labelled);
    if (tidy) return { vendor: tidy, inferred: false };
  }

  // 2) Leading company name: the letterhead text before the first field label.
  //    This is what works on space-joined PDF text (unpdf returns few newlines).
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? '';
  const noiseStripped = stripLeadingContactNoise(firstLine);
  const boundary = FIELD_BOUNDARY.exec(noiseStripped);
  const leading = boundary ? noiseStripped.slice(0, boundary.index) : noiseStripped;
  if (!isRecipientMarked(leading)) {
    const tidyLeading = tidyVendorName(leading);
    if (tidyLeading) return { vendor: tidyLeading, inferred: true };
  }

  return { vendor: undefined, inferred: false };
}

function sumLineItems(text: string): number | undefined {
  const re = /(?:^|\n)\s*(?:[0-9]+\s+)?.*?\$?\s*([0-9][0-9,]*\.[0-9]{2})\s*$/gm;
  const values: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = parseAmount(m[1]);
    if (v !== undefined) values.push(v);
  }
  // Need at least two line-amount-looking rows to claim a line-item subtotal.
  if (values.length < 2) return undefined;
  // Drop the single largest value (likely the grand total itself) before summing.
  const sorted = [...values].sort((a, b) => b - a);
  const lineValues = sorted.slice(1);
  const total = lineValues.reduce((acc, v) => acc + v, 0);
  return total > 0 ? Number(total.toFixed(2)) : undefined;
}

/**
 * Convert raw PDF-extracted text into structured invoice fields with an honest
 * status + confidence. Never throws.
 */
export function extractInvoiceFieldsFromText(
  rawText: string,
  pageCount: number,
): PdfExtractionResult {
  // Normalise non-breaking spaces and other horizontal whitespace that PDF
  // extraction emits (collapse runs to a single space; keep newlines).
  const text = (rawText ?? '').replace(/[^\S\n]+/g, ' ');
  const charCount = text.trim().length;
  const pages = Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1;
  const warnings: string[] = [];

  if (charCount < MIN_TOTAL_CHARS || charCount / pages < MIN_CHARS_PER_PAGE) {
    return {
      status: 'TEXT_EXTRACTION_FAILED',
      confidence: 0,
      fields: {},
      warnings: ['No usable text layer found — likely a scanned/image-only PDF that could not be read automatically.'],
      pageCount: pages,
      charCount,
    };
  }

  const vendorResult = extractVendor(text);
  if (vendorResult.inferred && vendorResult.vendor) {
    warnings.push('Vendor inferred from document letterhead — verify before approving.');
  }

  const fields: ExtractedInvoiceFields = {
    vendor: vendorResult.vendor,
    invoiceNo: extractInvoiceNo(text),
    invoiceDate: extractDate(text),
    amount: extractAmount(text),
    paymentTerms: extractTerms(text),
    po: extractPo(text),
    bankRouting: extractBankRouting(text),
    bankAccountLast4: extractAccountLast4(text),
    lineItemsTotal: sumLineItems(text),
  };

  // Core fields required for a meaningful automated fraud scan.
  const hasVendor = Boolean(fields.vendor);
  const hasInvoiceNo = Boolean(fields.invoiceNo);
  const hasAmount = fields.amount !== undefined;
  const coreCount = [hasVendor, hasInvoiceNo, hasAmount].filter(Boolean).length;

  let confidence: number;
  let status: PdfExtractStatus;
  if (coreCount === 3) {
    // High confidence; nudge down slightly if vendor was only inferred.
    confidence = vendorResult.inferred ? 0.78 : 0.9;
    status = 'OK';
  } else if (coreCount === 2) {
    confidence = 0.5;
    status = 'NEEDS_REVIEW';
  } else {
    confidence = coreCount === 1 ? 0.3 : 0.15;
    status = 'NEEDS_REVIEW';
  }

  if (status === 'NEEDS_REVIEW') {
    const missing = [
      !hasVendor && 'vendor',
      !hasInvoiceNo && 'invoice number',
      !hasAmount && 'amount',
    ].filter(Boolean);
    if (missing.length > 0) {
      warnings.push(`Could not confidently extract: ${missing.join(', ')}. Review before scanning.`);
    }
  }

  return { status, confidence, fields, warnings, pageCount: pages, charCount };
}

// ---------------------------------------------------------------------------
// OCR support — combining an OCR engine's own confidence with the SAME field
// parser above. This function does NOT do rasterization or run an OCR engine
// (that is async I/O, and belongs in the API runtime) — it only takes OCR
// engine output (text + a 0-100 confidence score) and decides how much to
// trust it, using the identical `extractInvoiceFieldsFromText` parser used
// for the digital-text path above. Pure, deterministic, no I/O.
// ---------------------------------------------------------------------------

/**
 * Below this Tesseract engine confidence (0-100 scale), OCR output is treated
 * as unusable for an automated decision — status is forced to NEEDS_REVIEW
 * regardless of how clean the resulting text happens to look to the (OCR-
 * blind) field parser. 60 is a conservative floor: Tesseract's own docs treat
 * sub-60 as "low confidence"; character-level confusions (0/O, 1/l/I, 5/S,
 * 6/9, 8/B) are exactly the failure mode a fraud-detection product cannot
 * silently pass through.
 */
export const OCR_ENGINE_MIN_CONFIDENCE = 60;

/**
 * Combined (parse confidence × normalised OCR confidence) floor required to
 * ever reach an automated OK on OCR-derived text — and ONLY when no fraud-
 * critical field was extracted (see below). Deliberately higher than the
 * digital-text OK floor (which can be as low as the parser's own 0.78/0.9),
 * because OCR adds a second, independent source of error on top of the parser.
 */
export const OCR_MIN_CONFIDENCE_FOR_OK = 0.75;

/**
 * Convert OCR engine output (text + the engine's own 0–100 confidence score)
 * into a `PdfExtractionResult`, via the SAME `extractInvoiceFieldsFromText`
 * parser the digital-text path uses — never a forked/parallel parser.
 *
 * Non-negotiable gates (the entire reason this function exists, rather than
 * just calling `extractInvoiceFieldsFromText` directly and stamping
 * `extraction_method: 'ocr'` on the result):
 *
 *   1. TEXT_EXTRACTION_FAILED from the parser (OCR found no usable text
 *      either — e.g. a blank/garbage image) is never promoted to anything
 *      else. Nothing is fabricated.
 *   2. Below `OCR_ENGINE_MIN_CONFIDENCE`, status is forced to NEEDS_REVIEW
 *      even if the parser alone would have said OK.
 *   3. Fraud-critical fields (bank routing/account number, total amount) read
 *      via OCR ALWAYS force NEEDS_REVIEW, with NO confidence carve-out —
 *      see the doc comment on `OCR_ENGINE_MIN_CONFIDENCE`. A misread digit in
 *      exactly these fields is the highest-consequence failure mode this
 *      product has (BANK_ACCOUNT_CHANGE_DETECTED / LINE_ITEM_MATH_ERROR), so
 *      it is always routed to a human, regardless of how "confident" either
 *      signal claims to be.
 *   4. Otherwise (no fraud-critical field present), OK requires the combined
 *      confidence to clear `OCR_MIN_CONFIDENCE_FOR_OK`.
 *   5. Status can only ever move TOWARD NEEDS_REVIEW / TEXT_EXTRACTION_FAILED
 *      here, never the reverse — this function cannot upgrade what the
 *      parser itself decided.
 *
 * @param ocrText       - Text the OCR engine produced for the (possibly
 *                        multi-page-merged) document.
 * @param pageCount      - Same page count semantics as `extractInvoiceFieldsFromText`.
 * @param ocrConfidence  - The OCR engine's own confidence, 0-100 (Tesseract's
 *                         scale). Values outside 0-100 are clamped.
 */
export function applyOcrExtraction(
  ocrText: string,
  pageCount: number,
  ocrConfidence: number,
): PdfExtractionResult {
  const parsed = extractInvoiceFieldsFromText(ocrText, pageCount);
  const clampedOcrConfidence = Math.max(0, Math.min(100, Number.isFinite(ocrConfidence) ? ocrConfidence : 0));

  if (parsed.status === 'TEXT_EXTRACTION_FAILED') {
    // OCR found nothing usable either — an honest failure, not a fabrication.
    return { ...parsed, extraction_method: 'ocr' };
  }

  const ocrConfidenceFactor = clampedOcrConfidence / 100;
  const combinedConfidence = Number((parsed.confidence * ocrConfidenceFactor).toFixed(2));

  const hasFraudCriticalField =
    parsed.fields.amount !== undefined ||
    Boolean(parsed.fields.bankRouting) ||
    Boolean(parsed.fields.bankAccountLast4);

  const warnings = [...parsed.warnings];
  let status: PdfExtractStatus = parsed.status;

  if (clampedOcrConfidence < OCR_ENGINE_MIN_CONFIDENCE) {
    status = 'NEEDS_REVIEW';
    warnings.push(
      `OCR engine confidence (${clampedOcrConfidence.toFixed(0)}/100) is below the ` +
        `${OCR_ENGINE_MIN_CONFIDENCE} review threshold — verify all fields against the original scan.`,
    );
  }

  if (hasFraudCriticalField) {
    if (status === 'OK') {
      status = 'NEEDS_REVIEW';
    }
    warnings.push(
      'A bank/routing number, account number, or total amount on this proof was read via OCR — ' +
        'always routed to manual review regardless of confidence (never auto-approved).',
    );
  } else if (
    // NOTE: `amount` is one of the three fields extractInvoiceFieldsFromText
    // itself requires (coreCount===3) to ever report OK, and `amount` is ALSO
    // on the fraud-critical list above with no carve-out — so in practice
    // `hasFraudCriticalField` is already true whenever `status === 'OK'`,
    // meaning this branch is not reachable through a real parse today. It is
    // kept as defense-in-depth (not dead code to delete) in case the base
    // parser's OK criteria are ever relaxed to not require `amount` — see
    // invoice-pdf-ocr-extract.spec.ts and the Work Item 1 report for the full
    // reasoning. This is also why OCR-derived invoices land at NEEDS_REVIEW
    // in practice almost every time, not an edge case.
    status === 'OK' &&
    combinedConfidence < OCR_MIN_CONFIDENCE_FOR_OK
  ) {
    status = 'NEEDS_REVIEW';
    warnings.push(
      `Combined OCR + parse confidence (${combinedConfidence}) is below the ` +
        `${OCR_MIN_CONFIDENCE_FOR_OK} threshold required for an automated OK on OCR-derived text.`,
    );
  }

  return {
    ...parsed,
    status,
    confidence: combinedConfidence,
    warnings,
    extraction_method: 'ocr',
  };
}
