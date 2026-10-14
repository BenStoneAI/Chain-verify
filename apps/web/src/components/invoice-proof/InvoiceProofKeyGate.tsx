'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { clearStoredKey, readStoredKey, writeStoredKey } from '@/lib/invoice-proof/api-key-store';

import { InvoiceProofSessionContext } from './useInvoiceProofSession';

export interface InvoiceProofKeyGateProps {
  children: ReactNode;
}

/**
 * Asks for the customer's Chain Verify API key and holds it in sessionStorage only
 * (cleared when the tab closes). Pages below the gate read it via useInvoiceProofSession().
 * A key the API rejects is cleared by the page that detects the 401 through signOut(reason).
 */
export function InvoiceProofKeyGate({ children }: InvoiceProofKeyGateProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setApiKey(readStoredKey());
    setReady(true);
  }, []);

  const signOut = useCallback((reason?: string) => {
    clearStoredKey();
    setApiKey(null);
    setInput('');
    setNotice(reason ?? null);
  }, []);

  const session = useMemo(() => (apiKey ? { apiKey, signOut } : null), [apiKey, signOut]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const candidate = input.trim();
    if (!candidate) return;
    writeStoredKey(candidate);
    setNotice(null);
    setApiKey(candidate);
  }

  if (!ready) return null;
  if (session) {
    return (
      <InvoiceProofSessionContext.Provider value={session}>{children}</InvoiceProofSessionContext.Provider>
    );
  }

  return (
    <div className="ipa-gate">
      <form className="ipa-card ipa-gate-card" onSubmit={handleSubmit} aria-labelledby="ipa-gate-title">
        <h1 id="ipa-gate-title">InvoiceProof sign in</h1>
        <p className="ipa-sub">
          Enter the Chain Verify API key issued for your organization. It is kept in this browser tab
          only and is cleared when you close the tab.
        </p>
        <div className="ipa-field">
          <label className="ipa-label" htmlFor="ipa-api-key">
            API key
          </label>
          <input
            id="ipa-api-key"
            className="ipa-input"
            type="password"
            autoComplete="off"
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Paste your API key"
          />
        </div>
        {notice ? (
          <p className="ipa-alert ipa-alert-error" role="alert">
            {notice}
          </p>
        ) : null}
        <button type="submit" className="ipa-btn ipa-btn-primary" disabled={!input.trim()}>
          Continue
        </button>
        <p className="ipa-faint">
          No key yet? Start an InvoiceProof pilot from the <Link className="ipa-link" href="/invoice-proof#plans">plans section</Link>.
        </p>
      </form>
    </div>
  );
}
