'use client';

import { useCallback, useEffect, useState } from 'react';

import { adminApi, AdminApiError, type AdminOrganization, type AdminOverview } from './admin-api';
import { AuditLogTable } from './AuditLogTable';
import { OrganizationsPanel } from './OrganizationsPanel';
import { OverviewCards } from './OverviewCards';

interface AdminDashboardProps {
  adminKey: string;
  onAuthError: () => void;
}

export function AdminDashboard({ adminKey, onAuthError }: AdminDashboardProps) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [organizations, setOrganizations] = useState<AdminOrganization[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every refresh() so AuditLogTable (which owns its own paginated
  // state) knows to reload its first page — otherwise a mutation made via
  // OrganizationsPanel/ApiKeysPanel would update the KPI cards and org list
  // but leave the audit log table showing stale (or empty) data underneath.
  const [auditLogVersion, setAuditLogVersion] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [nextOverview, nextOrgs] = await Promise.all([
        adminApi.getOverview(adminKey),
        adminApi.listOrganizations(adminKey),
      ]);
      setOverview(nextOverview);
      setOrganizations(nextOrgs);
      setError(null);
      setAuditLogVersion((v) => v + 1);
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 401) {
        onAuthError();
        return;
      }
      setError(err instanceof AdminApiError ? err.message : 'Failed to load the admin dashboard.');
    }
  }, [adminKey, onAuthError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) {
    return (
      <div className="cva-shell">
        <p className="cva-error">{error}</p>
        <button type="button" className="cva-btn-secondary" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  }

  if (!overview || !organizations) {
    return (
      <div className="cva-shell">
        <p className="cva-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="cva-shell">
      <OverviewCards overview={overview} />
      <OrganizationsPanel adminKey={adminKey} organizations={organizations} onChanged={refresh} />
      <AuditLogTable adminKey={adminKey} refreshSignal={auditLogVersion} />
    </div>
  );
}
