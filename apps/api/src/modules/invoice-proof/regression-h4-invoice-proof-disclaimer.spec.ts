/**
 * Regression: H4 — InvoiceProof hero overclaims advanced features
 *
 * The InvoiceProof page previously implied that BEC protection and
 * vendor-master reconciliation were available in the self-serve demo.
 * The fix added a disclaimer stating these require enterprise data feed
 * integration and are "Not available in self-serve demo."
 *
 * This is a content-guard test. It reads the page source as a string
 * and asserts the disclaimer text is present. It will fail if someone
 * removes or rewrites the disclaimer.
 *
 * No compilation or rendering is required — the raw TSX source is sufficient
 * for a content guard of static text.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { beforeAll, describe, expect, it } from 'vitest';

// The /invoice-proof route was refactored to a thin server wrapper that renders
// the InvoiceProofClient component; the disclaimer renders inside that client
// component, so the content guard reads it there.
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(HERE, '../../../../web/src/components/proof/InvoiceProofClient.tsx');

describe('Regression H4: InvoiceProof disclaimer text present', () => {
  let source: string;

  beforeAll(() => {
    source = readFileSync(PAGE_PATH, 'utf-8');
  });

  it('contains the enterprise data feed integration disclaimer', () => {
    expect(source).toContain('enterprise data feed integration');
  });

  it('contains context-free self-serve limitation text', () => {
    expect(source).toContain('not available from a context-free self-serve sample alone');
  });

  it('contains the BEC protection disclaimer reference', () => {
    // The disclaimer must mention BEC protection (the overclaimed feature) so
    // a future edit that moves to a different section still includes the caveat.
    expect(source).toContain('BEC protection');
  });

  it('disclaimer appears at least once in the rendered component body (not just in a comment)', () => {
    // Ensure the text is in JSX markup, not stripped in a comment.
    // We check that the phrase occurs outside of a block comment (// or /* … */).
    // Simple heuristic: remove all TS/TSX comments and confirm the text still present.
    const withoutLineComments = source.replace(/\/\/[^\n]*/g, '');
    const withoutBlockComments = withoutLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(withoutBlockComments).toContain('not available from a context-free self-serve sample alone');
  });
});
