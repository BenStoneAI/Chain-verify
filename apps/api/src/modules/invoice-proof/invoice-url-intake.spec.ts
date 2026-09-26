/**
 * Work Item 2 (URL intake for InvoiceProof) — unit tests for the pure,
 * side-effect-free helpers in invoice-url-intake.ts. No Conduit, no network,
 * no browser — mirrors invoice-pdf-extract.spec.ts's convention for
 * proof-core. The real Conduit + SSRF end-to-end behavior is covered by
 * scripts/url-intake-smoke.ts (real browser, real local HTTP server, no mocks).
 */
import {
  combineUrlHtmlText,
  extractTextFromAriaSnapshot,
  isPdfContentType,
} from './invoice-url-intake.js';

describe('isPdfContentType', () => {
  it('recognizes application/pdf', () => {
    expect(isPdfContentType('application/pdf')).toBe(true);
  });

  it('recognizes application/pdf with a charset/parameter suffix', () => {
    expect(isPdfContentType('application/pdf; charset=binary')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isPdfContentType('Application/PDF')).toBe(true);
  });

  it('rejects text/html', () => {
    expect(isPdfContentType('text/html; charset=utf-8')).toBe(false);
  });

  it('rejects null/undefined/empty', () => {
    expect(isPdfContentType(null)).toBe(false);
    expect(isPdfContentType(undefined)).toBe(false);
    expect(isPdfContentType('')).toBe(false);
  });
});

describe('extractTextFromAriaSnapshot', () => {
  it('extracts the quoted text from a single-line ariaSnapshot entry', () => {
    expect(extractTextFromAriaSnapshot('- paragraph: "Invoice Total: $500.00"')).toBe(
      'Invoice Total: $500.00',
    );
  });

  it('extracts and joins text across multiple lines, discarding role/attribute noise', () => {
    const snapshot = [
      '- heading "Acme Corp" [level=1]',
      '- paragraph: "Invoice #: INV-1"',
      '- paragraph: "Total Due: $100.00"',
    ].join('\n');
    const text = extractTextFromAriaSnapshot(snapshot);
    expect(text).toContain('Acme Corp');
    expect(text).toContain('Invoice #: INV-1');
    expect(text).toContain('Total Due: $100.00');
    // Role names / bracketed attributes must not leak into the parsed text.
    expect(text).not.toContain('heading');
    expect(text).not.toContain('[level=1]');
  });

  it('never throws on malformed/unexpected input', () => {
    expect(() => extractTextFromAriaSnapshot(null)).not.toThrow();
    expect(() => extractTextFromAriaSnapshot(undefined)).not.toThrow();
    expect(() => extractTextFromAriaSnapshot('')).not.toThrow();
    expect(() => extractTextFromAriaSnapshot('no quotes in this line at all')).not.toThrow();
  });

  it('returns an empty string for null/undefined/empty/no-quotes input', () => {
    expect(extractTextFromAriaSnapshot(null)).toBe('');
    expect(extractTextFromAriaSnapshot(undefined)).toBe('');
    expect(extractTextFromAriaSnapshot('')).toBe('');
    expect(extractTextFromAriaSnapshot('- generic [ref=e1]')).toBe('');
  });
});

describe('combineUrlHtmlText', () => {
  it('joins main text and snapshot text with a newline', () => {
    expect(combineUrlHtmlText('main text', 'snapshot text')).toBe('main text\nsnapshot text');
  });

  it('omits an empty/whitespace-only side rather than leaving a stray newline', () => {
    expect(combineUrlHtmlText('main text', '')).toBe('main text');
    expect(combineUrlHtmlText('', 'snapshot text')).toBe('snapshot text');
    expect(combineUrlHtmlText('   ', 'snapshot text')).toBe('snapshot text');
  });

  it('handles null/undefined main text without throwing', () => {
    expect(() => combineUrlHtmlText(null, 'snapshot text')).not.toThrow();
    expect(combineUrlHtmlText(null, 'snapshot text')).toBe('snapshot text');
    expect(combineUrlHtmlText(undefined, '')).toBe('');
  });
});
