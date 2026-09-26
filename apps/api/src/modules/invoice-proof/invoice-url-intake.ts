// Pure helpers for InvoiceProof URL intake (Work Item 2). No I/O, no Conduit,
// no Prisma — the actual browser automation lives in
// apps/api/src/modules/conduit/conduit-browser.service.ts (reused, not
// forked) and orchestration lives in invoice-proof.service.ts. Kept separate
// and side-effect-free so the text-shaping logic below is unit-testable
// without a real browser, mirroring how invoice-pdf-extract.ts stays pure
// while invoice-pdf.service.ts does the actual I/O.

/**
 * True when a NAVIGATE response's Content-Type header indicates the URL
 * resolved directly to a PDF (as opposed to an HTML-rendered page).
 */
export function isPdfContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  return /application\/pdf/i.test(contentType);
}

/**
 * Extract plain readable text from a Conduit ACCESSIBILITY_SNAPSHOT result.
 *
 * Conduit's ACCESSIBILITY_SNAPSHOT action returns Playwright's
 * `locator.ariaSnapshot()` output — a YAML-ish string, one node per line,
 * shaped like `- heading "Acme Corp" [level=1]` or `- paragraph: "Total Due:
 * $500.00"` (NOT the old JSON {role,name,children} tree `page.accessibility
 * .snapshot()` used to return — that API was removed by Playwright; see the
 * doc comment on the ACCESSIBILITY_SNAPSHOT case in
 * conduit-browser.service.ts for what broke and when this was fixed).
 *
 * Pulls every quoted text segment out (the actual visible/accessible text)
 * and joins them, discarding role names and `[attr=value]` noise, so the
 * result can be concatenated with EXTRACT_MAIN's text and fed through the
 * SAME `extractInvoiceFieldsFromText` parser every other intake path uses —
 * never a second/parallel HTML-invoice parser.
 *
 * Never throws: malformed/empty input yields an empty string so the caller
 * can fall back to EXTRACT_MAIN's text alone.
 */
export function extractTextFromAriaSnapshot(raw: string | null | undefined): string {
  if (!raw) return '';
  const matches = raw.match(/"([^"]*)"/g);
  if (!matches) return '';
  return matches.map((m) => m.slice(1, -1)).join(' ');
}

/**
 * Combine EXTRACT_MAIN's readable text with the flattened accessibility
 * snapshot into one text blob for the shared field parser. Order matters
 * only for readability in logs; the parser itself is whitespace/order
 * tolerant (see extractInvoiceFieldsFromText's own token-scanning approach).
 */
export function combineUrlHtmlText(mainText: string | null | undefined, snapshotText: string): string {
  return [mainText ?? '', snapshotText].filter((t) => t.trim().length > 0).join('\n');
}
