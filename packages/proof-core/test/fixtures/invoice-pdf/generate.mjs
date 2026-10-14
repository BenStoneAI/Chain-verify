/**
 * Generates the committed InvoiceProof PDF test fixtures.
 *
 * Run from packages/proof-core:  npm run fixtures:pdf-intake
 * (needs pdfkit and @napi-rs/canvas, which are hoisted from apps/api).
 *
 * These are SAFE, synthetic invoices (fictional vendors/amounts) used by the PDF
 * intake unit + smoke tests. Regenerate and re-commit if the set changes.
 */
import PDFDocument from 'pdfkit';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createCanvas } from '@napi-rs/canvas';

const outDir = dirname(fileURLToPath(import.meta.url));
mkdirSync(outDir, { recursive: true });

function buildPdf(render, opts = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 50, ...opts });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    render(doc);
    doc.end();
  });
}

// Build a "scanned" invoice fixture: renders invoice text onto a raster canvas
// (via @napi-rs/canvas, the same rasterizer the OCR intake path uses) and
// embeds that PNG as a full-page IMAGE in a pdfkit PDF with NO digital text
// layer at all — a stand-in for a real scanned/photographed invoice, so the
// OCR fallback path (packages/proof-core applyOcrExtraction +
// apps/api/.../invoice-pdf-ocr.ts) has a real fixture to run Tesseract
// against, the same way clean.pdf exercises the digital-text path.
function buildScannedPdf(lines, opts = {}) {
  const width = 900;
  const height = 1100;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000000';
  ctx.font = opts.titleFont ?? '32px sans-serif';
  ctx.fillText(lines[0], 40, 60);
  ctx.font = opts.bodyFont ?? '24px sans-serif';
  let y = 120;
  for (const line of lines.slice(1)) {
    ctx.fillText(line, 40, y);
    y += 40;
  }
  const png = canvas.toBuffer('image/png');

  return buildPdf((doc) => {
    doc.image(png, 0, 0, { width, height });
  }, { margin: 0, size: [width, height] });
}

// A deliberately DEGRADED "scan": tiny low-contrast text over a noisy/speckled
// background, at low resolution — simulates a poor-quality scan/photo so
// Tesseract's own confidence score comes back meaningfully lower than the
// clean scan above (proving the confidence gate, not just presence/absence of
// text, drives the NEEDS_REVIEW decision), while still usually recovering
// SOME text (this is not the "garbage/no text at all" case — that's
// image-only.pdf).
function buildNoisyScannedPdf(lines) {
  const width = 900;
  const height = 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  // Speckled grey background (deterministic PRNG, no real randomness in a test fixture).
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 6000; i++) {
    const shade = Math.floor(150 + rand() * 80);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.fillRect(rand() * width, rand() * height, 2, 2);
  }
  // Low-contrast, small text over the noisy background.
  ctx.fillStyle = '#666666';
  ctx.font = '11px sans-serif';
  let y = 40;
  for (const line of lines) {
    ctx.fillText(line, 20, y);
    y += 22;
  }
  const png = canvas.toBuffer('image/png');

  return buildPdf((doc) => {
    doc.image(png, 0, 0, { width, height });
  }, { margin: 0, size: [width, height] });
}

// A standard, fully-labelled invoice. `fields` overrides defaults.
function invoiceLines(doc, fields) {
  const f = {
    vendor: 'Redwood Industrial Supply',
    invoiceNo: 'INV-1001',
    invoiceDate: '03/14/2026',
    po: 'PO-5001',
    terms: 'Net 30',
    total: '4,500.00',
    routing: '021000021',
    accountLast4: '6789',
    ...fields,
  };
  doc.fontSize(18).text(f.vendor);
  doc.moveDown();
  doc.fontSize(11);
  doc.text(`Invoice #: ${f.invoiceNo}`);
  doc.text(`Invoice Date: ${f.invoiceDate}`);
  if (f.po) doc.text(`PO Number: ${f.po}`);
  doc.text(`Payment Terms: ${f.terms}`);
  doc.moveDown();
  doc.text('Description            Qty      Amount');
  doc.text('Steel brackets          10      $2,700.00');
  doc.text('Mounting hardware        5      $1,800.00');
  doc.moveDown();
  doc.text(`Total Due: $${f.total}`);
  doc.moveDown();
  doc.text('Remit to:');
  doc.text(`Routing #: ${f.routing}`);
  doc.text(`Account #: ****${f.accountLast4}`);
}

const fixtures = {
  // Clean baseline — all core fields present, matches vendor master / PO register.
  'clean.pdf': await buildPdf((doc) => invoiceLines(doc, {})),

  // Bank/routing differs from vendor master → BANK_ACCOUNT_CHANGE (BEC).
  'bank-change.pdf': await buildPdf((doc) =>
    invoiceLines(doc, { invoiceNo: 'INV-1002', po: 'PO-5002', total: '3,200.00', routing: '999999999' }),
  ),

  // No PO reference → MISSING_PO_REFERENCE.
  'missing-po.pdf': await buildPdf((doc) =>
    invoiceLines(doc, { vendor: 'Globex Manufacturing', invoiceNo: 'INV-1003', po: '', total: '1,200.00' }),
  ),

  // Amount far above PO-5001 authorized amount → PO_AMOUNT_EXCEEDED.
  'po-overage.pdf': await buildPdf((doc) =>
    invoiceLines(doc, { invoiceNo: 'INV-1004', po: 'PO-5001', total: '9,000.00' }),
  ),

  // Same invoice number as clean, different amount → MODIFIED_DUPLICATE vs history.
  'modified-duplicate.pdf': await buildPdf((doc) =>
    invoiceLines(doc, { invoiceNo: 'INV-1001', total: '5,750.00' }),
  ),

  // Multi-page document; invoice content on page 1.
  'multipage.pdf': await buildPdf((doc) => {
    invoiceLines(doc, { invoiceNo: 'INV-1005' });
    doc.addPage().fontSize(11).text('Page 2 — Terms and conditions. Standard remittance applies.');
    doc.addPage().fontSize(11).text('Page 3 — Authorized signatures and appendix.');
  }),

  // Image-only / scanned proxy: a filled rectangle, NO text layer. Garbage
  // input for OCR — proves OCR-on-nothing stays TEXT_EXTRACTION_FAILED
  // (never fabricates a field) rather than a digital text extractor decision.
  'image-only.pdf': await buildPdf((doc) => {
    doc.rect(80, 80, 400, 500).fill('#cccccc');
  }),

  // Mixed PDF: page 1 has a real digital text layer (vendor/invoice#/date/PO/
  // terms — deliberately WITHOUT amount or bank fields); page 2 is a scanned
  // IMAGE (no digital text at all) carrying the amount + bank routing. Proves
  // the per-page digital/OCR merge in invoice-pdf.service.ts: page 1's text
  // is kept as-is, only page 2 goes through OCR, and the merged result still
  // reaches the fraud-critical gate correctly (amount/bank came from OCR).
  'mixed.pdf': await (async () => {
    const width = 612;
    const height = 792;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    ctx.font = '22px sans-serif';
    ctx.fillText('Total Due: $4,500.00', 50, 100);
    ctx.fillText('Routing #: 021000021', 50, 140);
    ctx.fillText('Account #: ****6789', 50, 180);
    const page2Png = canvas.toBuffer('image/png');

    return buildPdf((doc) => {
      doc.fontSize(18).text('Redwood Industrial Supply');
      doc.moveDown();
      doc.fontSize(11);
      doc.text('Invoice #: INV-3001');
      doc.text('Invoice Date: 03/14/2026');
      doc.text('PO Number: PO-5001');
      doc.text('Payment Terms: Net 30');
      doc.addPage({ margin: 0, size: [width, height] }).image(page2Png, 0, 0, { width, height });
    });
  })(),

  // Real OCR fixture: invoice TEXT rendered onto a raster canvas and embedded
  // as a page IMAGE — no digital text layer, so this can only be read via the
  // OCR path. Same fields as clean.pdf (high quality "scan").
  'scanned-clean.pdf': await buildScannedPdf([
    'Redwood Industrial Supply',
    'Invoice #: INV-2001',
    'Invoice Date: 03/14/2026',
    'PO Number: PO-5001',
    'Payment Terms: Net 30',
    'Total Due: $4,500.00',
    'Routing #: 021000021',
    'Account #: ****6789',
  ]),

  // Same as scanned-clean.pdf but with a DIFFERENT bank routing number than
  // vendor master — proves BANK_ACCOUNT_CHANGE_DETECTED still fires on
  // OCR-extracted text (Work Item 1's required fraud-rule regression test).
  'scanned-bank-change.pdf': await buildScannedPdf([
    'Redwood Industrial Supply',
    'Invoice #: INV-2002',
    'Invoice Date: 03/14/2026',
    'PO Number: PO-5002',
    'Payment Terms: Net 30',
    'Total Due: $3,200.00',
    'Routing #: 999999999',
    'Account #: ****6789',
  ]),

  // Deliberately low-quality "scan": tiny, faint, rotated-looking text via a
  // small font on a busy background — Tesseract should still emit SOME text
  // but at meaningfully lower confidence than the clean scan above, proving
  // the confidence gate (not just presence/absence of text) drives the
  // NEEDS_REVIEW decision.
  'scanned-noisy.pdf': await buildNoisyScannedPdf([
    'Redwood Industrial Supply',
    'Invoice #: INV-2003',
    'Total Due: $4,500.00',
  ]),

  // Encrypted / password-protected.
  'encrypted.pdf': await buildPdf((doc) => invoiceLines(doc, { invoiceNo: 'INV-1006' }), {
    userPassword: 'fixture-password',
    ownerPassword: 'fixture-password',
  }),
};

for (const [name, buf] of Object.entries(fixtures)) {
  writeFileSync(resolve(outDir, name), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}

// Corrupt PDF: valid header magic bytes but garbage body → InvalidPDFException.
const corrupt = Buffer.from('%PDF-1.4\n<<< this is not a valid pdf body >>>\n%%EOF');
writeFileSync(resolve(outDir, 'corrupt.pdf'), corrupt);
console.log(`wrote corrupt.pdf (${corrupt.length} bytes)`);

// Unsupported file type (PNG magic bytes) for NOT_PDF validation tests.
const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
writeFileSync(resolve(outDir, 'not-a-pdf.png'), fakePng);
console.log(`wrote not-a-pdf.png (${fakePng.length} bytes)`);
