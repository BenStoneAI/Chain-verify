import { Injectable, Logger } from '@nestjs/common';
import {
  applyOcrExtraction,
  extractInvoiceFieldsFromText,
  MIN_CHARS_PER_PAGE,
  type PdfExtractionResult,
} from '@chain-verify/proof-core/invoice-pdf-extract.js';

import { invoiceProofOcrEnabled, ocrPdfPage } from './invoice-pdf-ocr.js';

/** Hard ceiling on uploaded PDF size. Multer enforces the same limit at the edge. */
export const PDF_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
/** Reject documents above this page count — invoice PDFs are a handful of pages. */
export const PDF_MAX_PAGES = 50;
/**
 * OCR is only attempted on pages whose OWN digital text falls below this many
 * characters — i.e. per-page, not whole-document, so a mixed PDF (some digital
 * pages, some scanned pages/attachments) only pays the OCR cost on the pages
 * that actually need it. Reuses proof-core's own "page is unusable" threshold
 * so there is exactly one definition of "this page has no usable text".
 */
const OCR_TRIGGER_MIN_CHARS_PER_PAGE = MIN_CHARS_PER_PAGE;

export type PdfExtractFailureReason =
  | 'EMPTY'
  | 'NOT_PDF'
  | 'TOO_LARGE'
  | 'TOO_MANY_PAGES'
  | 'ENCRYPTED'
  | 'CORRUPT'
  | 'EXTRACTION_ERROR';

export type PdfExtractOutcome =
  | { ok: true; extraction: PdfExtractionResult }
  | { ok: false; reason: PdfExtractFailureReason; message: string; pageCount?: number };

// unpdf is ESM-only; import it lazily so the (CJS) Jest runtime can mock this
// service without resolving pdf.js, and so the heavy dependency only loads when a
// PDF is actually uploaded.
type UnpdfModule = typeof import('unpdf');
let unpdfPromise: Promise<UnpdfModule> | null = null;
function loadUnpdf(): Promise<UnpdfModule> {
  if (!unpdfPromise) unpdfPromise = import('unpdf');
  return unpdfPromise;
}

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  /**
   * Decode a PDF buffer to text and structured invoice fields. Never throws —
   * every failure (not a PDF, too large, too many pages, encrypted, corrupt,
   * image-only) is returned as a typed outcome. Raw invoice text is never logged.
   */
  async extract(buffer: Buffer): Promise<PdfExtractOutcome> {
    if (!buffer || buffer.length === 0) {
      return { ok: false, reason: 'EMPTY', message: 'No file content received.' };
    }
    if (buffer.length > PDF_MAX_BYTES) {
      return {
        ok: false,
        reason: 'TOO_LARGE',
        message: `PDF exceeds the ${Math.round(PDF_MAX_BYTES / (1024 * 1024))} MB limit.`,
      };
    }
    // Magic-byte check: a real PDF starts with "%PDF-". Cheap defence against
    // mislabelled / renamed non-PDF uploads before we hand bytes to the parser.
    if (!buffer.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
      return { ok: false, reason: 'NOT_PDF', message: 'File is not a valid PDF.' };
    }

    const { getDocumentProxy, extractText } = await loadUnpdf();

    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(new Uint8Array(buffer));
    } catch (err) {
      return this.mapParseError(err);
    }

    const pageCount = pdf.numPages ?? 0;
    if (pageCount > PDF_MAX_PAGES) {
      return {
        ok: false,
        reason: 'TOO_MANY_PAGES',
        message: `PDF has ${pageCount} pages; the limit is ${PDF_MAX_PAGES}.`,
        pageCount,
      };
    }

    let perPageTexts: string[];
    try {
      const result = await extractText(pdf, { mergePages: false });
      perPageTexts = Array.isArray(result.text) ? result.text : [result.text];
    } catch (err) {
      return this.mapParseError(err, pageCount);
    }

    const mergedDigitalText = perPageTexts.join('\n').replace(/\s+/g, ' ');
    const digitalExtraction = extractInvoiceFieldsFromText(mergedDigitalText, pageCount);
    const digitalTextIsUsable = digitalExtraction.status !== 'TEXT_EXTRACTION_FAILED';

    // Per-page (not whole-document) weakness check, so a mixed PDF — some
    // digital pages, some scanned pages/attachments — only sends the pages
    // that actually lack usable text through OCR, not the whole document.
    const weakPageIndexes = perPageTexts
      .map((pageText, index) => ({ index, chars: pageText.trim().length }))
      .filter((p) => p.chars < OCR_TRIGGER_MIN_CHARS_PER_PAGE)
      .map((p) => p.index);

    // Kraken audit fix (chain-walk/OCR/url-intake review): a document whose
    // digital text already parses to a confident OK (all three core fields —
    // vendor/invoiceNo/amount — found) is never sent through the per-page OCR
    // path, even if one incidental page is sparse/blank (a trailing signature
    // page, a mostly-blank terms-and-conditions page, a cover sheet). Before
    // this fix, ANY weak page — regardless of whether the document as a whole
    // already extracted cleanly — forced the whole document through OCR and
    // applyOcrExtraction's stricter gate, which downgrades every OCR-tagged
    // result with a fraud-critical field to NEEDS_REVIEW unconditionally. That
    // silently regressed the pre-OCR baseline (which only ever checked the
    // document-wide average chars/page, not each page individually) by
    // routing previously-OK multi-page invoices to unnecessary manual review
    // and unnecessary OCR compute, purely because of an unrelated blank page.
    // A weak page is still worth OCR-ing when the digital pass DIDN'T already
    // reach OK — the weak page may be the ONLY place a missing field lives
    // (see mixed.pdf's fixture/tests), so this only short-circuits the
    // already-confident case, not the mixed-PDF recovery case.
    if (digitalTextIsUsable && (digitalExtraction.status === 'OK' || weakPageIndexes.length === 0)) {
      // Fully digital document — unchanged v1 path, no OCR attempted.
      const extraction: PdfExtractionResult = {
        ...digitalExtraction,
        extraction_method: 'digital_text',
      };
      this.logExtraction(extraction, 'digital_text');
      return { ok: true, extraction };
    }

    if (!invoiceProofOcrEnabled()) {
      const extraction: PdfExtractionResult = {
        ...digitalExtraction,
        extraction_method: 'digital_text',
      };
      this.logExtraction(extraction, 'digital_text (ocr disabled)');
      return { ok: true, extraction };
    }

    // Pages to OCR: every page with weak/no digital text. If the WHOLE
    // document's merged text was unusable, OCR every page (weakPageIndexes
    // may already cover this, but a page can individually clear the per-page
    // floor while the merged total still fails MIN_TOTAL_CHARS — OCR it too).
    const pagesToOcr = digitalTextIsUsable
      ? weakPageIndexes
      : Array.from({ length: perPageTexts.length }, (_, i) => i);

    const mergedTexts = [...perPageTexts];
    const ocrConfidences: number[] = [];
    try {
      for (const pageIndex of pagesToOcr) {
        const { text: pageOcrText, confidence } = await ocrPdfPage(new Uint8Array(buffer), pageIndex + 1);
        mergedTexts[pageIndex] = pageOcrText;
        ocrConfidences.push(confidence);
      }
    } catch (err) {
      // OCR is a best-effort enhancement layered on the digital-text path,
      // never a hard dependency of it — fall back to the honest digital-only
      // result (which may itself be TEXT_EXTRACTION_FAILED) rather than a 500.
      this.logger.warn(
        `pdf OCR failed, falling back to digital-text result: ${err instanceof Error ? err.message : String(err)}`,
      );
      const extraction: PdfExtractionResult = {
        ...digitalExtraction,
        extraction_method: 'digital_text',
      };
      this.logExtraction(extraction, 'digital_text (ocr error)');
      return { ok: true, extraction };
    }

    const combinedText = mergedTexts.join('\n').replace(/\s+/g, ' ');
    // Conservative on purpose: use the WEAKEST page's OCR confidence, not an
    // average. A fraud-critical field can live on the single worst-scanned
    // page of a multi-page document, and averaging would let a clean page
    // mask a bad one.
    const worstOcrConfidence = Math.min(...ocrConfidences);
    const extraction = applyOcrExtraction(combinedText, pageCount, worstOcrConfidence);
    this.logExtraction(extraction, 'ocr', worstOcrConfidence);
    return { ok: true, extraction };
  }

  // Log only non-sensitive shape/decision metadata — never the document text.
  private logExtraction(extraction: PdfExtractionResult, method: string, ocrEngineConfidence?: number): void {
    const ocrSuffix = ocrEngineConfidence === undefined ? '' : ` ocrEngineConfidence=${ocrEngineConfidence}`;
    this.logger.log(
      `pdf extract: pages=${extraction.pageCount} chars=${extraction.charCount} ` +
        `status=${extraction.status} confidence=${extraction.confidence} method=${method}${ocrSuffix}`,
    );
  }

  private mapParseError(err: unknown, pageCount?: number): PdfExtractOutcome {
    const name = (err as { name?: string })?.name ?? '';
    const message = String((err as { message?: string })?.message ?? '');
    if (name === 'PasswordException' || /password/i.test(message)) {
      return {
        ok: false,
        reason: 'ENCRYPTED',
        message: 'PDF is encrypted/password-protected. Remove the password and re-upload.',
        pageCount,
      };
    }
    if (name === 'InvalidPDFException' || /invalid pdf/i.test(message)) {
      return {
        ok: false,
        reason: 'CORRUPT',
        message: 'PDF appears to be corrupt or malformed.',
        pageCount,
      };
    }
    this.logger.warn(`pdf parse error: ${name || 'unknown'}`);
    return {
      ok: false,
      reason: 'EXTRACTION_ERROR',
      message: 'Could not read the PDF. Try a different file.',
      pageCount,
    };
  }
}
