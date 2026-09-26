// Rasterization + OCR for InvoiceProof PDF intake. This is the ONLY place in the
// repo that does image decoding / OCR for invoice PDFs — packages/proof-core's
// invoice-pdf-extract.ts stays pure (no I/O); this module produces plain text
// (+ an engine confidence score) that gets fed into that exact same parser via
// `applyOcrExtraction` (see invoice-pdf.service.ts).
//
// Engine choice: Tesseract (via tesseract.js, Apache-2.0) — a deterministic,
// pixel-to-text OCR engine, not a vision-language model. A VLM can hallucinate
// plausible-but-wrong field values (a fabricated bank account number that reads
// as perfectly formatted); a low-confidence Tesseract miss instead correctly
// routes to NEEDS_REVIEW via applyOcrExtraction's confidence gate. No VLM
// fallback is implemented in this change — see the CLAUDE.md-facing report for
// why, and what would be required (forced NEEDS_REVIEW, never OK) if one is
// added later.
//
// Rasterization: unpdf's `renderPageAsImage`, which unpdf already depends on
// pdfjs-dist for (no new rasterizer dependency needed) and which pairs with the
// `@napi-rs/canvas` peer dependency (MIT, prebuilt native binary — no node-gyp
// compile) it explicitly documents. Both are already installed by this change.
//
// IMPORTANT gotcha (found by hand while building this): `renderPageAsImage`
// MUST be called with the raw PDF bytes (Uint8Array), not an already-opened
// PDFDocumentProxy from a prior `getDocumentProxy()` call. unpdf only wires its
// working CanvasFactory through when IT calls `getDocumentProxy()` internally;
// reusing an externally-opened proxy silently falls back to pdfjs-dist's own
// internal Node canvas stub, which throws "@napi-rs/canvas is not available in
// this environment" the moment a page's content stream contains an embedded
// raster image — which is exactly what a real scanned/photographed invoice is.
// (Pure vector/text pages render fine either way, which is why this only shows
// up on real scanned input, not in a naive smoke test against a text PDF.)
// invoice-pdf.service.ts therefore re-reads the raw buffer for OCR rather than
// reusing the digital-text-extraction pass's already-open document proxy.

import { renderPageAsImage } from 'unpdf';

export interface OcrPageResult {
  /** Raw OCR text for this one page. */
  text: string;
  /** Tesseract's own overall confidence for this page, 0-100. */
  confidence: number;
}

// Upscaling the rendered page measurably improves small-font OCR accuracy;
// 2.5x is a pragmatic middle ground between accuracy and per-page latency.
const RENDER_SCALE = 2.5;

// Passed straight through as unpdf's `canvasImport` option below (unpdf
// memoizes the resolved module itself — see resolveCanvasModule — so no
// caching is duplicated here). Written as an inline `() => import(...)`
// rather than a named wrapper function: unpdf's own declared type for this
// option is structurally strict about the imported module's shape, and a
// wrapper re-annotated with `typeof import('@napi-rs/canvas')` resolves to a
// second, TS-incompatible identity for the same module in this monorepo's
// hoisted node_modules layout.
const importCanvasModule = () => import('@napi-rs/canvas');

type TesseractModule = typeof import('tesseract.js');
let tesseractPromise: Promise<TesseractModule> | null = null;
function loadTesseract(): Promise<TesseractModule> {
  tesseractPromise ??= import('tesseract.js');
  return tesseractPromise;
}

/**
 * Whether OCR intake is enabled. Opt-out kill switch (default ON): OCR adds a
 * WASM OCR engine + a native rasterization dependency to the request path, so
 * ops needs a way to disable it without a deploy if either misbehaves on a
 * given host, without reverting the whole feature.
 */
export function invoiceProofOcrEnabled(): boolean {
  return (process.env.INVOICE_PROOF_OCR_ENABLED ?? '').trim().toLowerCase() !== 'false';
}

/**
 * Rasterize one page of a PDF and run Tesseract OCR over it.
 *
 * Never throws for "the page has no readable text" (a blank/garbage scan
 * legitimately produces empty text + low/zero confidence — that is a correct,
 * honest result, handled by applyOcrExtraction). This function DOES throw for
 * a genuine engine/rendering failure (corrupt page, OCR engine crash); the
 * caller (invoice-pdf.service.ts) treats that as a soft failure and falls back
 * to the pre-existing TEXT_EXTRACTION_FAILED outcome rather than a 500 — OCR is
 * a best-effort enhancement layered on top of the original digital-text path,
 * never a hard dependency of it.
 *
 * @param pdfBytes   - The RAW PDF bytes (see the module-level gotcha above —
 *                     must not be a pre-opened PDFDocumentProxy).
 * @param pageNumber - 1-indexed page to rasterize + OCR.
 */
export async function ocrPdfPage(pdfBytes: Uint8Array, pageNumber: number): Promise<OcrPageResult> {
  const imageArrayBuffer = await renderPageAsImage(pdfBytes, pageNumber, {
    canvasImport: importCanvasModule,
    scale: RENDER_SCALE,
  });

  const { createWorker } = await loadTesseract();
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(Buffer.from(imageArrayBuffer));
    return {
      text: data.text ?? '',
      confidence: Number.isFinite(data.confidence) ? data.confidence : 0,
    };
  } finally {
    await worker.terminate();
  }
}
