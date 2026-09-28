'use client';

import { useEffect, useState } from 'react';

import { adminApi, AdminApiError, type AdminAuditEntry } from './admin-api';

interface AuditLogTableProps {
  adminKey: string;
  /** Incremented by the parent whenever a mutation happens elsewhere on the
   * page (new org, new key, revoke) — triggers reloading the first page so
   * this table never shows stale data next to a KPI row that just updated. */
  refreshSignal: number;
}

/**
 * Full paginated audit trail — the permanent record of every admin action.
 * Fetches its own first page independently of the overview's 10-entry
 * preview so its pagination cursor is always self-consistent.
 */
export function AuditLogTable({ adminKey, refreshSignal }: AuditLogTableProps) {
  const [items, setItems] = useState<AdminAuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadPage(null, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminKey, refreshSignal]);

  async function loadPage(after: string | null, opts: { replace?: boolean } = {}) {
    setLoading(true);
    setError(null);
    try {
      const page = await adminApi.getAuditLog(adminKey, after);
      setItems((prev) => (opts.replace ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Failed to load audit entries.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="cva-panel" aria-label="Audit log">
      <h2>Audit log</h2>
      <p className="cva-muted">Every admin mutation, with the reason given at the time. Append-only.</p>
      <div className="cva-table-wrap">
        <table className="cva-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Action</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="cva-empty">
                  {loading ? 'Loading…' : 'No audit entries yet.'}
                </td>
              </tr>
            )}
            {items.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleString()}</td>
                <td>{entry.adminLabel}</td>
                <td>
                  <code>{entry.action}</code>
                </td>
                <td>{entry.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="cva-error">{error}</p>}
      {cursor && (
        <button type="button" className="cva-btn-secondary" onClick={() => void loadPage(cursor)} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
