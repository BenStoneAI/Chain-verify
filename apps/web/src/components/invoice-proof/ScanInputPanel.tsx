'use client';

import { useState } from 'react';

import type { ScanSource } from './useInvoiceScan';

export interface ScanInputPanelProps {
  source: ScanSource;
  loading: boolean;
  /** Suffix for the submit label, for example " (1 free)". */
  freeLabel: string;
  onSubmit: (payload: string | File) => void;
  /** Called when the user edits the input so stale results can be cleared. */
  onInputChange: () => void;
}

const HELP: Record<Exclude<ScanSource, 'text'>, string> = {
  pdf:
    'One invoice per file, max 10 MB / 50 pages. Digital PDFs are read directly. Scanned PDFs are read via OCR ' +
    'on a best-effort basis; because OCR can misread digits, any bank or routing number, account number, or ' +
    'total amount it reads is always flagged for your manual review rather than auto-approved.',
  url:
    'A link that resolves to a PDF is scanned like an uploaded PDF; an HTML invoice page has its visible content ' +
    'extracted. Private and internal network addresses and non-http(s) links are rejected before any page is ' +
    'loaded. Bank, routing, account, or total amounts read from a live page are always flagged for manual review.',
};

export function ScanInputPanel({ source, loading, freeLabel, onSubmit, onInputChange }: ScanInputPanelProps) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const value = source === 'text' ? text.trim() : source === 'url' ? url.trim() : file;
  const submitLabel =
    source === 'text'
      ? loading ? 'Scanning...' : `Run batch scan${freeLabel}`
      : source === 'pdf'
        ? loading ? 'Reading PDF...' : `Upload and scan PDF${freeLabel}`
        : loading ? 'Loading page...' : `Scan URL${freeLabel}`;

  function submit() {
    if (source === 'text') onSubmit(text);
    else if (source === 'url') onSubmit(url.trim());
    else if (file) onSubmit(file);
  }

  return (
    <div className="ipa-field">
      {source === 'text' ? (
        <>
          <label className="ipa-label" htmlFor="ipa-scan-text">
            Invoice rows (CSV or JSON)
          </label>
          <textarea
            id="ipa-scan-text"
            className="ipa-textarea"
            rows={8}
            value={text}
            placeholder="vendor, invoice_no, amount, po, bank"
            onChange={(event) => {
              setText(event.target.value);
              onInputChange();
            }}
          />
        </>
      ) : null}

      {source === 'pdf' ? (
        <>
          <label className="ipa-label" htmlFor="ipa-scan-file">
            Invoice PDF
          </label>
          <input
            id="ipa-scan-file"
            className="ipa-input"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              onInputChange();
            }}
          />
          <p className="ipa-faint">{HELP.pdf}</p>
        </>
      ) : null}

      {source === 'url' ? (
        <>
          <label className="ipa-label" htmlFor="ipa-scan-url">
            Invoice URL
          </label>
          <input
            id="ipa-scan-url"
            className="ipa-input"
            type="url"
            inputMode="url"
            value={url}
            placeholder="https://vendor-portal.example.com/invoices/12345"
            onChange={(event) => {
              setUrl(event.target.value);
              onInputChange();
            }}
          />
          <p className="ipa-faint">{HELP.url}</p>
        </>
      ) : null}

      <div className="ipa-actions">
        <button type="button" className="ipa-btn ipa-btn-primary" disabled={loading || !value} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
