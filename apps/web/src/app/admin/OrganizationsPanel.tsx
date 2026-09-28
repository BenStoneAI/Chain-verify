'use client';

import { Fragment, useState, type FormEvent } from 'react';

import { adminApi, AdminApiError, type AdminOrganization } from './admin-api';
import { ApiKeysPanel } from './ApiKeysPanel';

interface OrganizationsPanelProps {
  adminKey: string;
  organizations: AdminOrganization[];
  onChanged: () => void;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function OrganizationsPanel({ adminKey, organizations, onChanged }: OrganizationsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [reason, setReason] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim() || !reason.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await adminApi.createOrganization(adminKey, name.trim(), slug.trim(), reason.trim());
      setName('');
      setSlug('');
      setReason('');
      setShowCreateForm(false);
      onChanged();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : 'Failed to create organization.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="cva-panel" aria-label="Organizations">
      <div className="cva-panel-header">
        <h2>Organizations</h2>
        <button type="button" className="cva-btn-primary" onClick={() => setShowCreateForm((v) => !v)}>
          {showCreateForm ? 'Cancel' : '+ New Organization'}
        </button>
      </div>

      {showCreateForm && (
        <form className="cva-inline-form" onSubmit={handleCreate}>
          <input
            placeholder="Organization name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug || slug === slugify(name)) setSlug(slugify(e.target.value));
            }}
          />
          <input placeholder="slug" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
          <input
            placeholder="Reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button type="submit" disabled={creating || !name.trim() || !slug.trim() || !reason.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}
      {error && <p className="cva-error">{error}</p>}

      <div className="cva-table-wrap">
        <table className="cva-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Active keys</th>
              <th>Usage this month</th>
              <th aria-label="Expand" />
            </tr>
          </thead>
          <tbody>
            {organizations.length === 0 && (
              <tr>
                <td colSpan={5} className="cva-empty">
                  No organizations yet.
                </td>
              </tr>
            )}
            {organizations.map((org) => (
              <Fragment key={org.id}>
                <tr>
                  <td>{org.name}</td>
                  <td>
                    <code>{org.slug}</code>
                  </td>
                  <td>{org.activeApiKeyCount}</td>
                  <td>
                    {org.usageThisMonth.length === 0
                      ? '—'
                      : org.usageThisMonth.map((u) => `${u.product}: ${u.count}`).join(', ')}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cva-btn-secondary"
                      onClick={() => setExpandedId(expandedId === org.id ? null : org.id)}
                    >
                      {expandedId === org.id ? 'Hide keys' : 'Manage keys'}
                    </button>
                  </td>
                </tr>
                {expandedId === org.id && (
                  <tr>
                    <td colSpan={5}>
                      <ApiKeysPanel adminKey={adminKey} organizationId={org.id} onKeyCountChanged={onChanged} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
