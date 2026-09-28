'use client';

import { useState } from 'react';

import type { CreatedAdminApiKey } from './admin-api';

interface ApiKeyModalProps {
  created: CreatedAdminApiKey;
  onDismiss: () => void;
}

/** Shows a freshly minted raw API key exactly once. There is no way to see it again. */
export function ApiKeyModal({ created, onDismiss }: ApiKeyModalProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.apiKey);
      setCopied(true);
    } catch {
      // Clipboard API can be unavailable (permissions, insecure context) —
      // the key text is still selectable/visible in the <code> block below.
    }
  }

  return (
    <div className="cva-modal-backdrop" role="dialog" aria-modal="true" aria-label="New API key created">
      <div className="cva-modal">
        <h2>API key created</h2>
        <p className="cva-warning">{created.warning}</p>
        <code className="cva-key-display">{created.apiKey}</code>
        <div className="cva-modal-actions">
          <button type="button" className="cva-btn-secondary" onClick={copy}>
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
          <button type="button" className="cva-btn-primary" onClick={onDismiss}>
            I have stored this key
          </button>
        </div>
      </div>
    </div>
  );
}
