'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { adminApi, AdminApiError, type AdminApiKey, type CreatedAdminApiKey } from './admin-api';
import { ApiKeyModal } from './ApiKeyModal';

interface ApiKeysPanelProps {
  adminKey: string;
  organizationId: string;
  onKeyCountChanged: () => void;
}

/** Per-org key management: list, mint, and revoke — expanded under an OrganizationRow. */
export function ApiKeysPanel({ adminKey, organizationId, onKeyCountChanged }: ApiKeysPanelProps) {
  const [keys, setKeys] = useState<AdminApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [reason, setReason] = useState('');
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedAdminApiKey | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  async function refresh() {
    try {
      setKeys(await adminApi.listApiKeys(adminKey, organizationId));
      setError(null);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Failed to load API keys.');
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await adminApi.createApiKey(adminKey, organizationId, label.trim(), reason.trim());
      setJustCreated(created);
      setLabel('');
      setReason('');
      await refresh();
      onKeyCountChanged();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Failed to create API key.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(apiIdentityId: string) {
    if (!revokeReason.trim()) return;
    setError(null);
    try {
      await adminApi.revokeApiKey(adminKey, apiIdentityId, revokeReason.trim());
      setRevokingId(null);
      setRevokeReason('');
      await refresh();
      onKeyCountChanged();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Failed to revoke API key.');
    }
  }

  return (
    <div className="cva-keys-panel">
      {error && <p className="cva-error">{error}</p>}

      <table className="cva-table cva-table-compact">
        <thead>
          <tr>
            <th>Label</th>
            <th>Status</th>
            <th>Last used</th>
            <th>Created</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {keys?.length === 0 && (
            <tr>
              <td colSpan={5} className="cva-empty">
                No API keys yet.
              </td>
            </tr>
          )}
          {keys?.map((k) => (
            <tr key={k.id}>
              <td>{k.label || <span className="cva-muted">(no label)</span>}</td>
              <td>
                <span className={`cva-badge ${k.active ? 'cva-badge-active' : 'cva-badge-revoked'}`}>
                  {k.active ? 'Active' : 'Revoked'}
                </span>
              </td>
              <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}</td>
              <td>{new Date(k.createdAt).toLocaleDateString()}</td>
              <td>
                {k.active &&
                  (revokingId === k.id ? (
                    <span className="cva-inline-confirm">
                      <input
                        placeholder="Reason for revoking (required)"
                        value={revokeReason}
                        onChange={(e) => setRevokeReason(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="cva-btn-danger"
                        disabled={!revokeReason.trim()}
                        onClick={() => handleRevoke(k.id)}
                      >
                        Confirm revoke
                      </button>
                      <button
                        type="button"
                        className="cva-btn-secondary"
                        onClick={() => {
                          setRevokingId(null);
                          setRevokeReason('');
                        }}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="cva-btn-danger" onClick={() => setRevokingId(k.id)}>
                      Revoke
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form className="cva-inline-form" onSubmit={handleCreate}>
        <input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input
          placeholder="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button type="submit" className="cva-btn-primary" disabled={creating || !reason.trim()}>
          {creating ? 'Creating…' : '+ New API Key'}
        </button>
      </form>

      {justCreated && <ApiKeyModal created={justCreated} onDismiss={() => setJustCreated(null)} />}
    </div>
  );
}
