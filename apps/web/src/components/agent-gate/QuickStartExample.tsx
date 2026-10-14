'use client';

import Link from 'next/link';

import { CopyButton } from './CopyButton';

export interface QuickStartExampleProps {
  /** API base URL, e.g. https://chain-verify-api.onrender.com (no trailing slash needed). */
  endpoint: string;
}

/**
 * Builds the quick-start request. The credential is always the literal
 * placeholder YOUR_API_KEY; the real key is never interpolated here.
 */
export function buildQuickStartCurl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, '');
  return [
    `curl -X POST "${base}/api/verify" \\`,
    '  -H "Authorization: Bearer YOUR_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{"source_type":"api_output","task":"invoice_extraction","output":{"vendor_name":"Acme Cloud Services","amount_total":8450,"invoice_number":"INV-10492"},"rules":["vendor_name_present","amount_total_present","missing_po_check"],"evidence":[{"expected_total":8450}]}'`,
  ].join('\n');
}

export function QuickStartExample({ endpoint }: QuickStartExampleProps) {
  const command = buildQuickStartCurl(endpoint);

  return (
    <section className="ag-panel" aria-labelledby="ag-quickstart-title">
      <h2 id="ag-quickstart-title">Quick start</h2>
      <p className="ag-note">
        Replace <code>YOUR_API_KEY</code> with the key above, then run:
      </p>
      <pre className="ag-code" tabIndex={0}>
        <code>{command}</code>
      </pre>
      <div className="ag-actions">
        <CopyButton text={command} label="Copy example" copiedLabel="Example copied" />
        <Link className="pm-btn pm-btn-secondary" href="/agent-gate/docs">
          Read the Agent Gate docs
        </Link>
      </div>
    </section>
  );
}

export default QuickStartExample;
