'use client';

import Link from 'next/link';
import { useEffect, useState, type KeyboardEvent } from 'react';

import { readStoredKey } from '@/lib/invoice-proof/api-key-store';

import { ExtractionReview } from './ExtractionReview';
import { ScanInputPanel } from './ScanInputPanel';
import { ScanResultPanel } from './ScanResultPanel';
import { useInvoiceScan, type ScanSource } from './useInvoiceScan';

const TABS: Array<{ id: ScanSource; label: string }> = [
  { id: 'text', label: 'Paste CSV / JSON' },
  { id: 'pdf', label: 'Upload PDF' },
  { id: 'url', label: 'Scan a URL' },
];

export function InvoiceBatchScan() {
  const { state, run, reset } = useInvoiceScan();
  const [source, setSource] = useState<ScanSource>('text');
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    setHasKey(readStoredKey() !== null);
  }, [state.result]);

  function selectSource(next: ScanSource) {
    setSource(next);
    reset();
  }

  function handleTabKeys(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === source);
    const next = TABS[(index + step + TABS.length) % TABS.length];
    selectSource(next.id);
    document.getElementById(`ipa-tab-${next.id}`)?.focus();
  }

  return (
    <div className="ipa-list">
      <p className="ipa-faint">
        {hasKey ? (
          'Scanning with your API key. Results count against your plan.'
        ) : (
          <>
            Running as an anonymous free scan. <Link href="/invoice-proof/dashboard" className="ipa-link">Sign in with your API key</Link>{' '}
            to use your plan and save results.
          </>
        )}
      </p>

      <div role="tablist" aria-label="Invoice input method" className="ipa-tabs" onKeyDown={handleTabKeys}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`ipa-tab-${tab.id}`}
            aria-selected={source === tab.id}
            aria-controls="ipa-scan-panel"
            tabIndex={source === tab.id ? 0 : -1}
            className="ipa-tab"
            onClick={() => selectSource(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id="ipa-scan-panel" role="tabpanel" aria-labelledby={`ipa-tab-${source}`}>
        <ScanInputPanel
          source={source}
          loading={state.loading}
          freeLabel={hasKey ? '' : ' (1 free)'}
          onSubmit={(payload) => void run(source, payload)}
          onInputChange={reset}
        />
      </div>

      {state.error ? (
        <p className="ipa-alert ipa-alert-error" role="alert">
          {state.error}{' '}
          {state.upgradeUrl ? (
            <Link href={state.upgradeUrl} className="ipa-link">
              See InvoiceProof plans
            </Link>
          ) : null}
        </p>
      ) : null}

      {state.document ? <ExtractionReview document={state.document} /> : null}
      {state.result ? <ScanResultPanel result={state.result} canReview={hasKey} /> : null}
    </div>
  );
}
