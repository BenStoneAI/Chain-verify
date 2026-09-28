'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { ADMIN_KEY_STORAGE_KEY, adminApi, AdminApiError } from './admin-api';

interface AdminKeyGateProps {
  /** Rendered once a valid key is confirmed. Receives the key so children
   * don't need to re-read sessionStorage themselves. */
  children: (key: string, signOut: () => void) => React.ReactNode;
}

/**
 * Gatekeeper for the whole /admin surface. Holds the admin master key in
 * sessionStorage only (never localStorage) so it clears on tab close, and
 * verifies it against GET /overview before rendering the dashboard — a
 * stored-but-since-revoked key bounces back to this form instead of showing
 * a broken dashboard.
 */
export function AdminKeyGate({ children }: AdminKeyGateProps) {
  const [key, setKey] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY);
    } catch {
      // sessionStorage unavailable (private mode, etc.) — fall through to the form.
    }
    if (!stored) {
      setChecking(false);
      return;
    }
    void verifyAndSet(stored, { silent: true });
  }, []);

  async function verifyAndSet(candidate: string, opts: { silent?: boolean } = {}) {
    setChecking(true);
    setError(null);
    try {
      await adminApi.getOverview(candidate);
      try {
        sessionStorage.setItem(ADMIN_KEY_STORAGE_KEY, candidate);
      } catch {
        // Non-fatal — the session just won't persist across a refresh.
      }
      setKey(candidate);
    } catch (err) {
      if (!opts.silent) {
        setError(err instanceof AdminApiError ? err.message : 'Could not reach the admin API.');
      }
      try {
        sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
      } catch {
        // ignore
      }
      setKey(null);
    } finally {
      setChecking(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    void verifyAndSet(input.trim());
  }

  function signOut() {
    try {
      sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
    } catch {
      // ignore
    }
    setKey(null);
    setInput('');
  }

  if (key) return <>{children(key, signOut)}</>;

  return (
    <div className="cva-gate">
      <form className="cva-gate-card" onSubmit={handleSubmit}>
        <h1>Chain Verify Admin</h1>
        <p className="cva-muted">Enter the platform admin key to continue.</p>
        <input
          type="password"
          autoFocus
          placeholder="cv_admin_…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={checking}
        />
        {error && <p className="cva-error">{error}</p>}
        <button type="submit" disabled={checking || !input.trim()}>
          {checking ? 'Checking…' : 'Continue'}
        </button>
        <p className="cva-hint">
          No key yet? Run <code>npx tsx apps/api/scripts/create-admin-key.ts &quot;&lt;label&gt;&quot;</code> against
          the target database.
        </p>
      </form>
    </div>
  );
}
